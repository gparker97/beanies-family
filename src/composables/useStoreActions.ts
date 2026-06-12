import type { Ref } from 'vue';
import { showToast } from '@/composables/useToast';
import { reportError } from '@/utils/errorReporter';
import { useTranslationStore } from '@/stores/translationStore';

interface WrapAsyncOptions {
  /** Show an error toast on failure (default: true) */
  errorToast?: boolean;
  /** Optional success toast message */
  successToast?: string;
  /**
   * Caller label, e.g. `'todoStore:createTodo'`. Threaded into the Slack
   * `wrapAsync:engine-panic` alert as `context.action` so engine panics
   * carry which store/action triggered the failed mutation — without this
   * the wasm stack alone is unactionable (see triage 2026-05-02).
   */
  action?: string;
}

/**
 * Engine-internal error patterns. When `wrapAsync` catches one of these,
 * the user toast renders a friendly "Something went wrong" message
 * instead of the raw engine output (e.g. wasm-bindgen's "recursive use
 * of an object detected which would lead to unsafe aliasing in rust"
 * which fires when JS re-enters Automerge mid-call). The original
 * message + stack still ship to Slack via a direct `reportError` call,
 * so engineering keeps the diagnostic value.
 */
const ENGINE_PANIC_PATTERNS: RegExp[] = [
  /recursive use of an object/i,
  /unsafe aliasing/i,
  /memory access out of bounds/i,
  /unreachable executed/i,
  /^RuntimeError\b/,
  /\bwasm\b/i,
];

function isEnginePanic(message: string): boolean {
  return ENGINE_PANIC_PATTERNS.some((p) => p.test(message));
}

/**
 * Wraps an async store action with loading/error state management.
 * Automatically shows error toasts on failure.
 *
 * On caught throw: passes the Error itself through to `showToast` so the
 * stack trace reaches the Slack alert (was previously dropped — every
 * wrapAsync-catch landed in `#beanies-errors` with surface `app` and no
 * stack frames, leaving each firing un-diagnosable). Wasm/engine panics
 * get a friendly user-facing toast plus a direct `reportError` carrying
 * the raw message and stack — see `ENGINE_PANIC_PATTERNS`.
 */
export async function wrapAsync<T>(
  isLoading: Ref<boolean>,
  error: Ref<string | null>,
  fn: () => Promise<T>,
  options?: WrapAsyncOptions
): Promise<T | undefined> {
  const { errorToast = true, successToast, action } = options ?? {};

  isLoading.value = true;
  error.value = null;

  try {
    const result = await fn();
    if (successToast) {
      showToast('success', successToast);
    }
    return result;
  } catch (e) {
    const rawMessage = e instanceof Error ? e.message : 'An unexpected error occurred';
    error.value = rawMessage;
    if (errorToast) {
      if (isEnginePanic(rawMessage)) {
        // Friendly user-facing toast with no automatic reporter — we
        // call reportError directly below so Slack gets the raw rust /
        // wasm message and stack instead of the friendly substitute.
        const t = safeT();
        showToast('error', t('unexpectedFailure'), t('unexpectedFailureHelp'), {
          silent: true,
          error: e,
        });
        reportError({
          surface: 'wrapAsync:engine-panic',
          // An Automerge engine panic means the data layer is broken — fatal.
          severity: 'critical',
          message: rawMessage,
          error: e,
          context: action ? { action } : undefined,
        });
      } else {
        // Pass `error: e` so the stack lands in the Slack alert. Without
        // this, every catch here showed up at surface `app` with no stack
        // frames — see commit history for the diagnostic backstory.
        showToast('error', rawMessage, undefined, { error: e });
      }
    }
    return undefined;
  } finally {
    isLoading.value = false;
  }
}

/**
 * Translation lookup that survives a Pinia-not-yet-initialized state.
 * `wrapAsync` runs inside store actions, so Pinia is virtually always
 * up — but the cost of a stray crash here is the user seeing nothing
 * when their action fails, so we degrade to hardcoded English.
 */
function safeT(): (key: 'unexpectedFailure' | 'unexpectedFailureHelp') => string {
  try {
    const store = useTranslationStore();
    return (key) =>
      key === 'unexpectedFailure'
        ? store.t('error.unexpectedFailure')
        : store.t('error.unexpectedFailureHelp');
  } catch {
    return (key) =>
      key === 'unexpectedFailure'
        ? 'Something went wrong'
        : 'Please refresh and try again. Support has been notified.';
  }
}
