// Wedge orchestration (ADR-030, #133, Phase 3): photo/document → consent → extraction →
// prefilled activity. Kept deliberately THIN — file intake, the consent gate, the extraction
// call, and mapping to a prefill. The generic concerns (tier/availability) live in
// useAiCapability; the only wedge-specific code is the pure mapper (extractionToActivity).
//
// Every outcome is explicit and non-silent (see docs/lessons.md): consent declined is a
// silent no-op with NO network and NO toast; offline is guarded before any work; every
// failure code maps to an informative toast at the right severity.

import { ref } from 'vue';
import { useAiCapability } from './useAiCapability';
import { useOnline } from './useOnline';
import { useToast } from './useToast';
import { useTranslation } from './useTranslation';
import { extractEventFromDocument } from '@/services/ai/documentExtractionService';
import type { ExtractionErrorCode, FieldConfidence } from '@/services/ai/types';
import { extractionToActivityPrefill } from '@/utils/extractionToActivity';
import { toDateInputValue } from '@/utils/date';
import type { CreateFamilyActivityInput } from '@/types/models';

export interface UseDocumentToActivityOptions {
  /** Show the per-action consent modal; resolve `true` only if the user agrees to send this document. */
  requestConsent: () => Promise<boolean>;
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

const ERROR_SURFACE = 'ai-extract';

export function useDocumentToActivity(options: UseDocumentToActivityOptions) {
  const { tier, byokConfig } = useAiCapability();
  const { isOnline } = useOnline();
  const { showToast } = useToast();
  const { t } = useTranslation();

  const isProcessing = ref(false);

  function reportFailure(code: ExtractionErrorCode | undefined): void {
    switch (code) {
      case 'offline':
        showToast('info', t('ai.offline.title'), t('ai.offline.message'));
        return;
      case 'not_available':
        showToast('info', t('ai.unavailable.title'), t('ai.unavailable.message'));
        return;
      case 'compression':
        // Reuse the established photo-type wording (e.g. HEIC on Chromium).
        showToast('warning', t('ai.error.title'), t('photos.invalidType'));
        return;
      case 'timeout':
        showToast('error', t('ai.error.title'), t('ai.error.timeout'), { surface: ERROR_SURFACE });
        return;
      case 'malformed_output':
        showToast('error', t('ai.error.title'), t('ai.error.unreadable'), {
          surface: ERROR_SURFACE,
        });
        return;
      case 'provider_error':
      default:
        showToast('error', t('ai.error.title'), t('ai.error.generic'), { surface: ERROR_SURFACE });
        return;
    }
  }

  /** Run the full intake → consent → extract → prefill flow for one document. */
  async function processFile(file: File): Promise<void> {
    if (isProcessing.value) return; // ignore a second pick while one is in flight

    if (!isOnline.value) {
      showToast('info', t('ai.offline.title'), t('ai.offline.message'));
      return;
    }

    const consented = await options.requestConsent();
    if (!consented) return; // silent no-op: no network, no toast

    isProcessing.value = true;
    try {
      const result = await extractEventFromDocument(file, {
        // Local YYYY-MM-DD (not a full ISO timestamp) so the model resolves relative dates
        // against the user's calendar date, and the proxy's date validation passes.
        tier: tier.value,
        todayIso: toDateInputValue(new Date()),
        byok: byokConfig.value ?? undefined,
      });

      if (result.success && result.data) {
        if (!result.data.isEvent) {
          // Not recognised as an event — still open the form so nothing is silently dropped.
          showToast('info', t('ai.notEvent.title'), t('ai.notEvent.message'));
        }
        // Reuse the already-compressed image (a JPEG) as the source photo to attach —
        // no second compression pass. `blob.type` carries the mime.
        const sourcePhoto = result.compressedBlob
          ? new File([result.compressedBlob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, {
              type: result.compressedBlob.type || 'image/jpeg',
            })
          : undefined;
        options.onActivityReady({
          prefill: extractionToActivityPrefill(result.data),
          confidence: result.data.confidence,
          sourcePhoto,
        });
        return;
      }

      reportFailure(result.errorCode);
    } finally {
      isProcessing.value = false;
    }
  }

  return { isProcessing, processFile };
}
