import { onMounted, watch, type WatchSource } from 'vue';
import { useRoute, useRouter } from 'vue-router';

/**
 * Opens an item referenced by a URL query param — a "deep link", e.g. a Google
 * Calendar event linking back to `/activities?activity=<id>`.
 *
 * Naive deep-link handlers read the param on mount, look the item up in a store,
 * and clear the param — all in one shot. On a cold start (opening the link from
 * an external app), the store hasn't hydrated yet, so the lookup misses and the
 * param gets cleared anyway: the item never opens. This composable fixes that
 * race with two rules:
 *
 *  - `open(id)` returns `true` only when it actually opened the target. The param
 *    is cleared from the URL *only* after a successful open, so a miss leaves the
 *    link intact for a retry.
 *  - The attempt re-runs whenever `ready` changes (the backing data finished
 *    loading), so a link clicked on a cold boot opens as soon as the item exists.
 *
 * It also re-runs when the param itself changes, so deep-linking works while
 * already on the page (e.g. from global search).
 *
 * Pass `ready` as the store's "data present" signal — typically
 * `() => someStore.items.length`.
 *
 * @example
 * useDeepLinkParam({
 *   param: 'activity',
 *   open: (id) => openViewModal(id), // returns true when the activity was found
 *   ready: () => activityStore.activities.length,
 * });
 */
export function useDeepLinkParam(options: {
  param: string;
  open: (id: string) => boolean;
  ready: WatchSource<unknown>;
}): void {
  const route = useRoute();
  const router = useRouter();

  function attempt(): void {
    const raw = route.query[options.param];
    const id = typeof raw === 'string' ? raw : undefined;
    if (!id) return;
    if (options.open(id)) {
      // Clear only the consumed param, preserving any others in the URL.
      const next = { ...route.query };
      delete next[options.param];
      router.replace({ query: next });
    }
  }

  onMounted(attempt);
  // Deep-link while already on the page (param changes without a remount).
  watch(
    () => route.query[options.param],
    (val) => {
      if (val) attempt();
    }
  );
  // Retry once the backing store hydrates (fixes the cold-start race).
  watch(options.ready, () => attempt());
}
