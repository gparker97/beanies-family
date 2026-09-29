// Wedge orchestration (ADR-030, #133, Phase 3): photo/document → extraction → prefilled
// activity. Kept deliberately THIN — file intake, the extraction call, and mapping to a
// prefill. Consent is gated by the CALLER before the file picker even opens (see
// FamilyPlannerPage.handleAddFromPhoto), and the resulting `ConsentGrant` is threaded in so
// the extraction call type-checks — nothing here runs until the document is picked, which
// only happens post-consent. The generic concerns (tier/availability) live in
// useAiCapability; the only wedge-specific code is the pure mapper (extractionToActivity).
//
// Every outcome is explicit and non-silent (see docs/lessons.md): offline is guarded before
// any work; every failure code maps to an informative toast at the right severity.

import { useToast } from './useToast';
import { useTranslation } from './useTranslation';
import type { FieldConfidence } from '@/services/ai/types';
import { reportError } from '@/utils/errorReporter';
import { extractionToActivityPrefill } from '@/utils/extractionToActivity';
import type { ResultEnvelope } from '@/types/magicPayload';
import type { ExtractionResult, TodoExtractionResult } from '@/services/ai/types';
import { sanitiseAttachmentBase } from '@/utils/sanitiseFilename';
import type { CreateFamilyActivityInput } from '@/types/models';

export interface UseDocumentToActivityOptions {
  /**
   * Called once extraction succeeds (so the page can open ActivityModal pre-filled, flag
   * low-confidence fields, and attach the source photo). Nothing is auto-created. Takes a
   * single options object — this callback is expected to grow, so avoid positional args.
   */
  onActivityReady: (ready: {
    prefill: Partial<CreateFamilyActivityInput>;
    confidence: FieldConfidence;
    /** The client-compressed source document (#133), to attach to the created activity. */
    sourcePhoto?: File;
    /**
     * The envelope this result arrived in, carried whole so the review modal can offer the
     * free correction. Passed rather than flattened: `sourcePhoto` above is already a derived
     * copy of one envelope field, and a second derived copy is a second thing to keep in step.
     */
    env: ResultEnvelope;
    /**
     * The to-dos the same read found for this event (#113), when it was a shared result.
     * The page reviews them before the activity form opens; absent for a plain event.
     */
    todo?: TodoExtractionResult;
  }) => void;
}

export function useDocumentToActivity(options: UseDocumentToActivityOptions) {
  const { showToast } = useToast();
  const { t } = useTranslation();

  /**
   * The post-extraction half: notices, mapping, and the hand-off to the review modal.
   *
   * Split out of `processFile` (#64) so a SHARED document can be delivered without a second
   * AI call — the share path has already run the extraction, and re-entering `processFile`
   * would re-send the page images. In-app behaviour is unchanged: `processFile` calls this.
   */
  /**
   * Wrap a delivery so a throw cannot vanish.
   *
   * `deliverX` is called from TWO places: `processFile`, which has a try/catch around it,
   * and the magic-reader consumer, which is a Vue WATCH callback with no catch anywhere in
   * the chain. Splitting the mapping out of `processFile` moved it out from under that catch
   * — the same shape as the incident the catch was originally added for: the spinner clears,
   * the modal never opens, the user is told nothing and CloudWatch records nothing.
   */
  function deliverEvent(
    data: ExtractionResult,
    env: ResultEnvelope,
    todo?: TodoExtractionResult
  ): void {
    try {
      deliverEventInner(data, env, todo);
    } catch (err) {
      reportError({
        surface: 'ai-activity-capture',
        message: 'delivering an extracted activity threw',
        severity: 'error',
        error: err,
        context: { action: 'threw' },
      });
      showToast('error', t('ai.error.title'), t('ai.error.generic'));
    }
  }

  function deliverEventInner(
    data: ExtractionResult,
    env: ResultEnvelope,
    todo?: TodoExtractionResult
  ): void {
    // Loud-but-non-blocking notice FIRST, so a >cap document whose recognisable content sat
    // on a dropped page still tells the user pages weren't read (never silent).
    if (env.truncated) {
      showToast('info', t('ai.pdfTruncated.title'), t('ai.pdfTruncated.message'));
    }
    if (!data.isEvent) {
      // Not recognised as an event — still open the form so nothing is silently dropped.
      showToast('info', t('ai.notEvent.title'), t('ai.notEvent.message'));
    }
    // Reuse the already-compressed image (a JPEG) as the source photo to attach — no second
    // compression pass. `blob.type` carries the mime. The base name is sanitised because on
    // the share path it originates in another app and reaches storage from here.
    const sourcePhoto = env.compressedBlob
      ? new File(
          [env.compressedBlob],
          `${sanitiseAttachmentBase(env.sourceFile?.name ?? 'shared')}.jpg`,
          {
            type: env.compressedBlob.type || 'image/jpeg',
          }
        )
      : undefined;
    const prefill = extractionToActivityPrefill(data);
    // The link rule, worked out once (#113). The activity's link field holds the event's own
    // web address when the read found one, else the page that was shared. A shared LINK has
    // no file to attach, so its URL is also the record of where the activity came from: when
    // it is not already the link, it goes on its own line in the notes (`notes`, not
    // `description`: ActivityModal renders and edits `notes`, so provenance stays visible).
    // A URL needs no translation, so this adds no string.
    const provenanceUrl = env.link?.provenanceUrl;
    if (!prefill.link && provenanceUrl) prefill.link = provenanceUrl;
    if (provenanceUrl && provenanceUrl !== prefill.link) {
      const existing = prefill.notes?.trim();
      prefill.notes = existing ? `${existing}\n${provenanceUrl}` : provenanceUrl;
    }
    options.onActivityReady({
      prefill,
      confidence: data.confidence,
      sourcePhoto,
      env,
      ...(todo?.items.length ? { todo } : {}),
    });
  }

  return { deliverEvent };
}
