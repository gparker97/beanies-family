import { ref } from 'vue';
import { reportError } from '@/utils/errorReporter';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastActionOptions {
  /** Label rendered on the action button (e.g. "Undo"). */
  actionLabel?: string;
  /**
   * Handler invoked when the user clicks the action button. The toast
   * dismisses first, then the handler runs. Errors are caught and
   * surfaced as a separate error toast — no silent failures.
   */
  actionFn?: () => void | Promise<void>;
  /**
   * Override the auto-dismiss delay (ms). Useful when an action button
   * is present and the user needs more time to react (e.g., 6000 for
   * an Undo flow). Error toasts ignore this — they stay sticky.
   */
  durationMs?: number;
  /**
   * Skip the automatic error reporter for this toast. Use ONLY for
   * validation / user-recoverable errors (e.g. clipboard permission
   * denied, stale URL filter). System errors that warrant support
   * notification should NOT set this — that's the default behavior.
   *
   * No-op for non-error toasts (success/info/warning never report).
   */
  silent?: boolean;
  /**
   * Override the auto-detected surface name for the error report.
   * If unset, the reporter falls back to a generic 'app' surface.
   * Use kebab-case: 'create-activity', 'drive-sync-write', etc.
   */
  surface?: string;
  /**
   * Extra structured context for the error report. Filtered through the
   * reporter's allowlist before send — anything not on the allowlist is
   * dropped with a console.warn.
   */
  context?: Record<string, unknown>;
  /**
   * The Error object, if any. Lets the reporter ship the stack trace.
   * Pass when you have one; safe to omit.
   */
  error?: unknown;
}

export interface Toast {
  id: number;
  type: ToastType;
  title: string;
  message?: string;
  timestamp: number;
  actionLabel?: string;
  actionFn?: () => void | Promise<void>;
  /** True if the reporter was fired for this toast. Drives the
   *  "Support has been notified" line in the toast component. */
  reported: boolean;
}

let nextId = 0;
const MAX_VISIBLE = 5;
const AUTO_DISMISS_MS = 5000;

// Module-level state — shared across all callers
const toasts = ref<Toast[]>([]);

/**
 * Show a toast notification.
 *
 * Error toasts are sticky (require manual dismiss). Success/info/warning
 * toasts auto-dismiss after 5s by default, or after `options.durationMs`
 * when supplied — callers adding an Undo affordance should bump this to
 * 6000 so users have time to react.
 *
 * An optional `actionLabel` + `actionFn` renders a secondary action
 * button in the toast (e.g., "Undo"). The action handler runs AFTER
 * the toast dismisses; exceptions it throws are caught and re-surfaced
 * as an error toast + console.error — never silent.
 */
export function showToast(
  type: ToastType,
  title: string,
  message?: string,
  options?: ToastActionOptions
): void {
  // Auto-report system errors. Wrapped in try/catch — a reporter failure
  // must NEVER prevent the toast from rendering. The user always sees
  // their error, even if Slack is down or the reporter itself bugs out.
  let reported = false;
  if (type === 'error' && !options?.silent) {
    try {
      // The toast's `title` is the error class name (e.g. "Couldn't save");
      // `message` is the user-facing detail, included as the reporter's
      // `message` so support sees the full toast text in Slack. If the
      // caller passed an Error, its stack is attached separately.
      const reportMessage = message ? `${title} — ${message}` : title;
      reportError({
        surface: options?.surface ?? 'app',
        message: reportMessage,
        error: options?.error,
        context: options?.context,
      });
      reported = true;
    } catch (e) {
      console.warn('[useToast] reportError threw — toast still rendering:', e);
    }
  }

  const toast: Toast = {
    id: nextId++,
    type,
    title,
    message,
    timestamp: Date.now(),
    actionLabel: options?.actionLabel,
    actionFn: options?.actionFn,
    reported,
  };

  toasts.value.push(toast);

  // Enforce max visible — remove oldest non-error toasts first
  while (toasts.value.length > MAX_VISIBLE) {
    const oldestDismissable = toasts.value.find((t) => t.type !== 'error');
    if (oldestDismissable) {
      toasts.value = toasts.value.filter((t) => t.id !== oldestDismissable.id);
    } else {
      // All are errors — remove oldest
      toasts.value.shift();
    }
  }

  // Auto-dismiss non-error toasts after `durationMs` (or default)
  if (type !== 'error') {
    const delay = options?.durationMs ?? AUTO_DISMISS_MS;
    setTimeout(() => {
      dismissToast(toast.id);
    }, delay);
  }
}

export function dismissToast(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

/**
 * Fire the toast's bound action (if any), then dismiss it. Runs the
 * handler AFTER dismissal so the toast doesn't linger while the action
 * resolves. Catches thrown exceptions and surfaces them as an error
 * toast + console.error — callers' wrapAsync-wrapped actions already
 * surface their own errors, but this guard covers unwrapped handlers
 * and guarantees no silent failure.
 */
export async function invokeToastAction(id: number): Promise<void> {
  const toast = toasts.value.find((t) => t.id === id);
  if (!toast?.actionFn) {
    dismissToast(id);
    return;
  }
  const fn = toast.actionFn;
  dismissToast(id);
  try {
    await fn();
  } catch (err) {
    console.error('[useToast] toast action handler threw:', err);
    showToast(
      'error',
      "Hmm, that didn't work",
      err instanceof Error ? err.message : 'Please try again.'
    );
  }
}

export function useToast() {
  return { toasts, showToast, dismissToast, invokeToastAction };
}
