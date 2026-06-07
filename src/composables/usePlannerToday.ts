/**
 * "Jump to today" cross-boundary signal for the family planner.
 *
 * Tapping a calendar nav affordance should always land the user on today's view,
 * scrolled to the current day — even when they're ALREADY on `/activities`, where
 * `router.push('/activities')` is a no-op and no route/query watch would fire.
 * The mobile nav lives outside the page, so it can't call the page's `handleToday`
 * directly.
 *
 * Mirrors the `useMagicReader` / `useQuickAdd` module-singleton idiom: a tiny
 * ephemeral flag set by the nav and consumed once by `FamilyPlannerPage`. The
 * page wires BOTH a `watch` (catches the already-on-page case) and `onMounted`
 * (catches arriving from another page, where the flag was set before mount) onto
 * one idempotent consume. The flag is cleared the instant it's read, so a stale
 * request can never re-fire on a later navigation.
 */
import { onMounted, ref, watch } from 'vue';

/** Set by a calendar nav tap, consumed once by the planner page. */
const pendingGoToday = ref(false);

/** Ask the planner to jump to today. Safe to call from outside `setup()`. */
export function requestGoToday(): void {
  pendingGoToday.value = true;
}

/**
 * Host-page wiring. Call once in `FamilyPlannerPage` setup with its `handleToday`
 * handler. Idempotent: whichever trigger (watch / onMounted) fires first runs the
 * handler; the other no-ops because the flag is already cleared.
 */
export function usePlannerTodayConsumer(handler: () => void): void {
  const consume = (): void => {
    if (!pendingGoToday.value) return;
    pendingGoToday.value = false;
    handler();
  };
  watch(pendingGoToday, consume);
  onMounted(consume);
}
