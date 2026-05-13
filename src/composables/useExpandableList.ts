import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue';

/**
 * Window a long list down to a "show first N, then expand" view.
 *
 * The standard primitive behind every list-disclosure surface in the app
 * (the Nook daily briefing, "Upcoming activities", the planner to-do
 * preview, …) — pair it with `<ShowMoreToggle>` for the affordance.
 * See ADR-025.
 *
 * - `step` set    → incremental: `showMore()` reveals `step` more items
 *   each call (and `showLess()` jumps straight back to `initial`).
 * - `step` omitted → all-or-nothing: `showMore()` reveals everything,
 *   `showLess()` collapses back to `initial`.
 *
 * Pure derived view state — no async, nothing that can fail. `slice` is
 * already total; the lone `watch` just keeps `limit` from lingering above
 * the source length if the list shrinks while expanded (so `canShowLess`
 * and the "+N" copy stay truthful).
 */
export function useExpandableList<T>(
  source: MaybeRefOrGetter<T[]>,
  options: { initial: number; step?: number }
) {
  const all = computed<T[]>(() => toValue(source));
  const limit = ref(options.initial);

  watch(all, (arr) => {
    const max = Math.max(options.initial, arr.length);
    if (limit.value > max) limit.value = max;
  });

  /** The items to render right now. */
  const visible = computed<T[]>(() => all.value.slice(0, limit.value));
  /** Total items in the source (handy for "Show all {total}" copy). */
  const total = computed(() => all.value.length);
  const canShowMore = computed(() => limit.value < all.value.length);
  const canShowLess = computed(() => limit.value > options.initial);

  function showMore() {
    limit.value = options.step
      ? Math.min(limit.value + options.step, all.value.length)
      : all.value.length;
  }
  function showLess() {
    limit.value = options.initial;
  }

  return { visible, total, canShowMore, canShowLess, showMore, showLess };
}
