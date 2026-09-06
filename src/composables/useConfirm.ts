import { ref } from 'vue';
import type { UIStringKey } from '@/services/translation/uiStrings';

export type ConfirmVariant = 'danger' | 'info';

interface ConfirmOptions {
  title: UIStringKey;
  message: UIStringKey;
  /** Additional detail text shown below the message (plain string, not translated) */
  detail?: string;
  /**
   * `caution` renders `detail` as the Heritage Orange caution slab the Settings
   * page uses, so a warning a person saw on the page is styled the same way
   * when it is repeated at the moment they decide. Default: a faint caption.
   */
  detailTone?: 'caution';
  /**
   * Make the confirm control a real link to this URL.
   *
   * ⚠️ THE REASON THIS EXISTS, and it is a correctness one. `confirm()` returns
   * a promise that `ConfirmModal` resolves, so a caller resumes a microtask
   * AFTER the click handler returned, which is exactly the situation
   * `openExternal` refuses to be used in (see its header: it must be called
   * synchronously inside the originating gesture or the popup blocker treats
   * the navigation as programmatic). `if (await confirm(...)) openExternal(url)`
   * reads correct and fails as "I tapped it and nothing happened". Rendering an
   * anchor makes the navigation the browser's own default action on a genuine
   * click, so no gesture has to survive a promise.
   */
  confirmHref?: string;
  variant?: ConfirmVariant;
  showCancel?: boolean;
  /** Custom confirm button label (overrides default "Delete" / "OK") */
  confirmLabel?: UIStringKey;
  /** Custom cancel button label (overrides default "Cancel") */
  cancelLabel?: UIStringKey;
}

interface ConfirmState {
  open: boolean;
  title: UIStringKey;
  message: UIStringKey;
  detail?: string;
  detailTone?: 'caution';
  confirmHref?: string;
  variant: ConfirmVariant;
  showCancel: boolean;
  confirmLabel?: UIStringKey;
  cancelLabel?: UIStringKey;
  resolve: ((value: boolean) => void) | null;
}

// Module-level state — shared across all callers
const state = ref<ConfirmState>({
  open: false,
  title: 'confirm.delete' as UIStringKey,
  message: 'confirm.delete' as UIStringKey,
  variant: 'danger',
  showCancel: true,
  resolve: null,
  detail: undefined,
  detailTone: undefined,
  confirmHref: undefined,
  confirmLabel: undefined,
  cancelLabel: undefined,
});

/**
 * Show a branded confirmation dialog. Returns a promise that resolves to
 * `true` when the user confirms, `false` when they cancel.
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    state.value = {
      open: true,
      title: options.title,
      message: options.message,
      detail: options.detail,
      detailTone: options.detailTone,
      confirmHref: options.confirmHref,
      variant: options.variant ?? 'danger',
      showCancel: options.showCancel ?? true,
      confirmLabel: options.confirmLabel,
      cancelLabel: options.cancelLabel,
      resolve,
    };
  });
}

/**
 * Show a branded info alert (OK button only, no cancel).
 */
export function alert(options: Omit<ConfirmOptions, 'variant' | 'showCancel'>): Promise<boolean> {
  return confirm({ ...options, variant: 'info', showCancel: false });
}

/**
 * Composable for the ConfirmModal renderer component.
 */
export function useConfirm() {
  function handleConfirm() {
    state.value.resolve?.(true);
    state.value.open = false;
    state.value.resolve = null;
  }

  function handleCancel() {
    state.value.resolve?.(false);
    state.value.open = false;
    state.value.resolve = null;
  }

  return { state, handleConfirm, handleCancel };
}
