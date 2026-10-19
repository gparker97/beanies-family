import { useRouter, type RouteLocationRaw } from 'vue-router';

export interface GoBackOptions {
  /**
   * Go back only when the previous entry is exactly this full path (query included); otherwise
   * push `fallback`. For a back affordance whose label names one place ("All trips" means the
   * plain `/travel` list), so arriving from the planner or from another trip still lands there.
   */
  onlyTo?: string;
}

/**
 * History-aware back for in-app back buttons.
 *
 * Goes back in history when the previous entry belongs to this app (Vue Router stamps its path
 * on `history.state.back`; null on the first entry of the tab, and kept through the overlay
 * markers that `useBackGestureClose` and `useQuickAdd` push, since both spread the existing
 * state). Otherwise (a deep link, a fresh tab) it pushes `fallback`, the button's fixed parent.
 * Going back, not forward, is what lets `useMainScrollRestoration` return the list to the item
 * you opened, and it is what Android's hardware back already does.
 */
export function useAppBack() {
  const router = useRouter();

  function goBack(fallback: RouteLocationRaw, options: GoBackOptions = {}): void {
    const back = (window.history.state as { back?: unknown } | null)?.back;
    const canGoBack =
      typeof back === 'string' && (options.onlyTo === undefined || back === options.onlyTo);
    if (canGoBack) router.back();
    else void router.push(fallback);
  }

  return { goBack };
}
