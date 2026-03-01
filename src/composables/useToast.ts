import { ref } from 'vue';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: number;
  type: ToastType;
  title: string;
  message?: string;
  timestamp: number;
}

let nextId = 0;
const MAX_VISIBLE = 5;
const AUTO_DISMISS_MS = 5000;

// Module-level state — shared across all callers
const toasts = ref<Toast[]>([]);

/**
 * Show a toast notification.
 * Error toasts are sticky (require manual dismiss).
 * Success/info/warning toasts auto-dismiss after 5s.
 */
export function showToast(type: ToastType, title: string, message?: string): void {
  const toast: Toast = {
    id: nextId++,
    type,
    title,
    message,
    timestamp: Date.now(),
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

  // Auto-dismiss non-error toasts
  if (type !== 'error') {
    setTimeout(() => {
      dismissToast(toast.id);
    }, AUTO_DISMISS_MS);
  }
}

export function dismissToast(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

export function useToast() {
  return { toasts, showToast, dismissToast };
}
