// Shared AI-extraction failure → toast mapping (ADR-030, #133 + #30).
//
// Both document wedges (activity extraction and travel extraction) classify failures into
// the same stable `ExtractionErrorCode`, so the code→toast mapping lives here ONCE rather
// than being copy-pasted into each composable. Every code maps to an informative toast at
// the right severity (see docs/lessons.md — no silent failures); transient provider 5xx
// deliberately gets a friendly retry toast with NO error surface so flapping can't spam
// #beanies-errors.

import { useToast } from './useToast';
import { useTranslation } from './useTranslation';
import type { ExtractionErrorCode } from '@/services/ai/types';

const ERROR_SURFACE = 'ai-extract';

export function useExtractionErrorToast() {
  const { showToast } = useToast();
  const { t } = useTranslation();

  function reportExtractionFailure(code: ExtractionErrorCode | undefined): void {
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
      case 'upstream_busy':
        // The AI provider is temporarily overloaded/down — transient, not our bug. Friendly
        // retry toast only; deliberately NO error surface so provider 5xx flapping can't spam
        // #beanies-errors.
        showToast('warning', t('ai.error.busy.title'), t('ai.error.busy.message'));
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

  return { reportExtractionFailure };
}
