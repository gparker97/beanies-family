import { ref } from 'vue';

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
}

export interface Toast {
  id: number;
  type: ToastType;
  title: string;
  message?: string;
  timestamp: number;
  actionLabel?: string;
  actionFn?: () => void | Promise<void>;
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
  const toast: Toast = {
    id: nextId++,
    type,
    title,
    message,
    timestamp: Date.now(),
    actionLabel: options?.actionLabel,
    actionFn: options?.actionFn,
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
