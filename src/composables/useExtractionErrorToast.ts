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
import { useAiCapability } from './useAiCapability';
import { storeToRefs } from 'pinia';
import { useTranslationStore } from '@/stores/translationStore';
import { fillTemplate } from '@/utils/fillTemplate';
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
  const { tier } = useAiCapability();
  const { isEnglish } = storeToRefs(useTranslationStore());

  /**
   * The generic "something went wrong" message, with the two facts that make it diagnosable.
   *
   * WHY THIS EXISTS. A family reported that nothing would read at all, and the toast said only
   * "Something went wrong reading that. Please try again." It took a CloudWatch query and a
   * trip through API Gateway metrics to establish the cause: their AI provider had been
   * switched to BYOK and their key was not working. The toast knew the tier and knew the
   * provider's own message, and told them neither.
   *
   * Two additions, both deliberate:
   *  · the TIER, because "managed" and "your own key" fail for completely different reasons and
   *    only one of them is ours to fix. A BYOK family needs to check their key; a managed
   *    family needs to tell us.
   *  · the provider's DETAIL when there is one, because "invalid api key" ends the
   *    investigation on the spot.
   *
   * ⚠️ The detail comes from our own provider layer's error message, never from raw response
   * text: an upstream body could carry anything, and putting that in front of a user is how a
   * provider's internals end up in a screenshot.
   */
  function genericFailure(detail?: string): void {
    const tierLabel = tier.value === 'managed' ? t('ai.tier.managed') : t('ai.tier.byok');
    const base = fillTemplate(t('ai.error.genericWithTier'), { tier: tierLabel });
    // ⚠️ The TOAST is English-only. The detail is our provider layer's own message — "invalid
    // api key", "managed proxy rate-limited this request" — a hardcoded English literal no
    // translation pass can reach, and appending it to a Chinese toast reads worse than the
    // generic line it was meant to improve.
    //
    // But it must not vanish either: for a non-English family this string is the whole answer
    // to "why can't beanies read anything", and they are the users least able to self-diagnose.
    // The provider layer does NOT log it (`openaiCompatible` has no console call at all), so
    // the console line is here, unconditionally, and it is the one channel that always carries
    // it. Deliberately not telemetry: the firehose context is an allowlist and a provider
    // message is free-form text that could carry anything.
    if (detail) {
      console.error(
        `[ai-extract] extraction failed on the ${tier.value} tier: ${detail}\n` +
          'On "byok" check the key in Settings → AI & Privacy; on "managed" this is ours to fix.'
      );
    }
    const useDetail = detail && isEnglish.value ? detail : undefined;
    showToast('error', t('ai.error.title'), useDetail ? `${base} ${useDetail}` : base, {
      surface: ERROR_SURFACE,
    });
  }

  function reportExtractionFailure(
    code: ExtractionErrorCode | undefined,
    /** The provider's own message, when it carried one worth showing. */
    detail?: string
  ): void {
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
      case 'correction_refused':
        // Expected, and nothing is broken: the grant had already been spent, had aged out, or
        // belonged to a different document. Nothing was read and nothing was charged, so this
        // is info with deliberately NO error surface — the same treatment `rate_limited` gets
        // for the same reason.
        showToast('info', t('ai.correct.refused.title'), t('ai.correct.refused.message'));
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
        genericFailure(detail);
        return;
    }
  }

  return { reportExtractionFailure };
}
