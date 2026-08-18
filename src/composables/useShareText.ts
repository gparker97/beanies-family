import { useClipboard } from './useClipboard';
import { showToast } from './useToast';
import { useTranslationStore } from '@/stores/translationStore';
import { reportError } from '@/utils/errorReporter';

/**
 * Share an arbitrary plain-text body. Prefers the native share sheet
 * (`navigator.share`) when available, otherwise falls back to copying to the
 * clipboard with a toast. Deliberately NOT built on `ShareChannelGrid`, which is
 * hard-wired to an invite URL. Never fails silently — a clipboard failure shows
 * an error toast + logs to the console.
 */
export function useShareText() {
  const { copy } = useClipboard();

  async function share(title: string, text: string): Promise<void> {
    const t = useTranslationStore().t;
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };

    if (typeof nav.share === 'function') {
      try {
        await nav.share({ title, text });
        return;
      } catch (err) {
        // User dismissed the sheet — not an error, don't fall through to copy.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        // A real share failure falls back to clipboard; log the reason.
        reportError({
          surface: 'meal-planner',
          message: 'navigator.share failed; falling back to clipboard',
          severity: 'warning',
          error: err instanceof Error ? err : undefined,
        });
      }
    }

    const ok = await copy(text);
    if (ok) {
      showToast('success', t('mealPlanner.share.copied'));
    } else {
      showToast('error', t('mealPlanner.share.copyFailed'), t('mealPlanner.share.copyFailedHelp'));
      // Dev guidance on the console (clipboard write is blocked or unavailable).
      console.error('[meal-planner] clipboard copy failed for the meal-plan share text');
    }
  }

  return { share };
}
