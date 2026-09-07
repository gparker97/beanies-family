import { useClipboard } from './useClipboard';
import { showToast } from './useToast';
import { useTranslationStore } from '@/stores/translationStore';
import { reportError } from '@/utils/errorReporter';
import { isNative } from '@/services/sync/capabilities';
import { isAbortError, isPluginCancel } from '@/utils/shareOrDownloadFile';

/**
 * Share an arbitrary plain-text body through the OS share sheet, falling back to the
 * clipboard.
 *
 * ⚠️ RE-HOMED, NOT PARAMETERISED (#92). This had zero callers, its toast copy was hardwired
 * to `mealPlanner.share.*`, and its `reportError` surface was hardcoded to `'meal-planner'` —
 * so its first real caller would have reported a recipe share as a meal-planner failure.
 * Rather than bolt on override props, the copy moved to neutral `share.*` keys and `surface`
 * became a required argument. One behaviour, no knobs, and every caller's telemetry lands on
 * its own surface.
 *
 * Distinct from `utils/shareOrDownloadFile.ts`, which shares a FILE (a `.beanpod`, a PDF) and
 * carries a whole Filesystem hand-off with a deletion race. This shares TEXT. They share only
 * the two cancel predicates, which are imported from there rather than re-written here.
 *
 * Never fails silently: a clipboard refusal shows an error toast and logs dev guidance.
 */
export function useShareText() {
  const { copy } = useClipboard();

  /**
   * Returns true when the content was actually shared or copied; false when the user
   * dismissed the sheet or the copy failed — so callers only record a success (and dismiss
   * their UI) on a real share.
   *
   * @param surface kebab-case telemetry surface of the CALLER (e.g. `'recipe-share'`).
   */
  async function share(title: string, text: string, surface: string): Promise<boolean> {
    const t = useTranslationStore().t;

    // Native shell first: `navigator.share` is unreliable inside a Capacitor WebView, and
    // the plugin is the path the rest of the app already uses.
    if (isNative()) {
      try {
        const { Share } = await import('@capacitor/share');
        await Share.share({ title, text, dialogTitle: title });
        return true;
      } catch (err) {
        // A dismissed sheet is a cancel, not a failure — and the plugin signals it with a
        // MESSAGE rather than a DOM AbortError, hence both predicates.
        if (isAbortError(err) || isPluginCancel(err)) return false;
        reportError({
          surface,
          message: 'native share sheet failed; falling back to clipboard',
          severity: 'warning',
          error: err instanceof Error ? err : undefined,
        });
      }
    } else {
      const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
      if (typeof nav.share === 'function') {
        try {
          await nav.share({ title, text });
          return true;
        } catch (err) {
          if (isAbortError(err)) return false;
          reportError({
            surface,
            message: 'navigator.share failed; falling back to clipboard',
            severity: 'warning',
            error: err instanceof Error ? err : undefined,
          });
        }
      }
    }

    const ok = await copy(text);
    if (ok) {
      showToast('success', t('share.copied'));
      return true;
    }
    showToast('error', t('share.copyFailed'), t('share.copyFailedHelp'));
    // Dev guidance on the console: the clipboard write is blocked or unavailable.
    console.error(
      `[${surface}] clipboard copy failed for the share text — the document may not be ` +
        'focused, or clipboard-write is blocked by permissions policy.'
    );
    return false;
  }

  return { share };
}
