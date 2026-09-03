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

// ⚠️ COPY RULE: every string below is shown by THREE readers now — activity (#133), travel
// (#30) and recipe (#72) — so it must stay SURFACE-NEUTRAL. These were originally written
// when only the activity reader existed and said "photo"/"activity"; the recipe reader
// surfaced that ("reading photos isn't set up yet. you can add the activity manually",
// shown on the cookbook). If a message needs to name the thing being created, it does not
// belong here — put it on the calling composable, like `recipeExtract.notRecipe.*`.

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
      case 'fetch_blocked':
        // Not an outage — we refused the link on purpose (not https, unreachable, or the
        // SSRF guard caught it). Info, not error: nothing is broken on our side.
        showToast('info', t('recipeExtract.badLink.title'), t('recipeExtract.badLink.message'));
        return;
      case 'video_blocked':
        // Actionable: the recipe link in the description almost always works, because that
        // is an ordinary website rather than YouTube's bot-protected API.
        showToast(
          'info',
          t('recipeExtract.videoBlocked.title'),
          t('recipeExtract.videoBlocked.message')
        );
        return;
      case 'source_unreachable':
        // The link is dead, or the site blocks automated readers. Actionable by the user,
        // and nothing is broken here — so info, and never an error surface.
        showToast(
          'info',
          t('recipeExtract.unreachable.title'),
          t('recipeExtract.unreachable.message')
        );
        return;
      case 'rate_limited':
        // We refused on purpose — too many extractions from this family or IP in the window
        // (#83). NOT the per-device client budget: that refuses before any provider call and
        // shows `shareTarget.text.quota.*`, so it can never produce this code. Nothing is
        // broken, so info and deliberately NO error surface: an
        // expected, intentional refusal must never page #beanies-errors. Same treatment
        // `fetch_blocked` and `upstream_busy` already get.
        showToast('info', t('ai.error.rateLimited.title'), t('ai.error.rateLimited.message'));
        return;
      case 'no_content':
        // The fetch worked; the page/video just had nothing readable in it.
        showToast('info', t('recipeExtract.noContent.title'), t('recipeExtract.noContent.message'));
        return;
      case 'provider_error':
      default:
        showToast('error', t('ai.error.title'), t('ai.error.generic'), { surface: ERROR_SURFACE });
        return;
    }
  }

  return { reportExtractionFailure };
}
