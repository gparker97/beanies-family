import { ref } from 'vue';
import { reportError } from '@/utils/errorReporter';

/**
 * Clipboard copy with auto-resetting feedback state.
 *
 * ⚠️ IT USED TO SWALLOW FAILURES. `catch { return false }`, and every call site
 * discarded the boolean — so a failed copy was a silent no-op: no toast, no banner, no
 * console line, nothing in the firehose. That is tolerable for copying a recipe URL and
 * not tolerable for a magic link, where copying IS the save action and a silent failure
 * means someone believes they have stored their way back into the family and has not.
 *
 * `navigator.clipboard.writeText` rejects for real, reachable reasons: an insecure
 * context, a permission refusal, and on iOS when the call is not inside a user gesture.
 *
 * `surface` is caller-supplied and NOT hard-coded, because there are six call sites
 * across unrelated features. `reportError` dedupes per `(surface, message)`, so a
 * hard-coded surface would file a travel-page copy failure under login and blunt the
 * dedupe for everyone.
 */
export function useClipboard(opts?: { surface?: string }) {
  const copied = ref(false);
  /** Non-null when the LAST copy attempt failed. Render it; do not discard it. */
  const error = ref<string | null>(null);

  async function copy(text: string): Promise<boolean> {
    error.value = null;
    try {
      await navigator.clipboard.writeText(text);
      copied.value = true;
      setTimeout(() => {
        copied.value = false;
      }, 2000);
      return true;
    } catch (e) {
      error.value = 'copy-failed';
      reportError({
        surface: opts?.surface ?? 'clipboard',
        message: 'clipboard write failed',
        severity: 'warning',
        error: e,
      });
      return false;
    }
  }

  return { copied, error, copy };
}
