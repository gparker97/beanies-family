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

import { ref } from 'vue';
import { useAiCapability } from './useAiCapability';
import { useOnline } from './useOnline';
import { useToast } from './useToast';
import { useTranslation } from './useTranslation';
import { useExtractionErrorToast } from './useExtractionErrorToast';
import type { ConsentGrant } from './useDocumentConsent';
import { extractEventFromDocument } from '@/services/ai/documentExtractionService';
import type { FieldConfidence } from '@/services/ai/types';
import { reportError } from '@/utils/errorReporter';
import { extractionToActivityPrefill } from '@/utils/extractionToActivity';
import type { ResultEnvelope } from '@/types/magicPayload';
import type { ExtractionResult } from '@/services/ai/types';
import { sanitiseAttachmentBase } from '@/utils/sanitiseFilename';
import { toDateInputValue } from '@/utils/date';
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
  }) => void;
}

export function useDocumentToActivity(options: UseDocumentToActivityOptions) {
  const { tier, byokConfig } = useAiCapability();
  const { isOnline } = useOnline();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const { reportExtractionFailure } = useExtractionErrorToast();

  const isProcessing = ref(false);

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
  function deliverEvent(data: ExtractionResult, env: ResultEnvelope): void {
    try {
      deliverEventInner(data, env);
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

  function deliverEventInner(data: ExtractionResult, env: ResultEnvelope): void {
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
      ? new File([env.compressedBlob], `${sanitiseAttachmentBase(env.sourceFile.name)}.jpg`, {
          type: env.compressedBlob.type || 'image/jpeg',
        })
      : undefined;
    options.onActivityReady({
      prefill: extractionToActivityPrefill(data),
      confidence: data.confidence,
      sourcePhoto,
    });
  }

  /** Run the full intake → extract → prefill flow for one document. */
  async function processFile(file: File, grant: ConsentGrant): Promise<void> {
    if (isProcessing.value) return; // ignore a second pick while one is in flight

    if (!isOnline.value) {
      showToast('info', t('ai.offline.title'), t('ai.offline.message'));
      return;
    }

    isProcessing.value = true;
    try {
      // The service owns document preparation: a PDF is rasterized to its first pages
      // (up to MAX_EXTRACT_PAGES) and a photo is used as-is, then each page is compressed.
      // Preparation failures come back classified as `compression`, never silent.
      const result = await extractEventFromDocument(file, {
        // Local YYYY-MM-DD (not a full ISO timestamp) so the model resolves relative dates
        // against the user's calendar date, and the proxy's date validation passes.
        tier: tier.value,
        todayIso: toDateInputValue(new Date()),
        byok: byokConfig.value ?? undefined,
        grant,
      });

      if (result.success && result.data) {
        deliverEvent(result.data, {
          sourceFile: file,
          compressedBlob: result.compressedBlob,
          truncated: result.truncated,
        });
        return;
      }

      reportExtractionFailure(result.errorCode);
    } finally {
      isProcessing.value = false;
    }
  }

  return { isProcessing, processFile, deliverEvent };
}
