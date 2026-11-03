/**
 * Every in-app way into the family planner lands on today.
 *
 * **The invariant this rests on.** Nothing keeps the planner alive (there is no
 * `<KeepAlive>` around the router-view) and `usePlannerNavigation` seeds
 * `referenceDate` from the live `startOfToday` on every mount, so a FRESH mount of
 * `/activities` whose URL carries no `d` is on today by construction. A cross-route
 * `<router-link to="/activities">` (the Nook's "Full calendar" links) therefore needs
 * nothing. What the invariant cannot cover is a navigation that lands on a planner
 * that is ALREADY mounted: a tab-bar or sidebar tap while on `/activities` is a
 * duplicate navigation (vue-router resolves it with a `NavigationFailure` before any
 * guard or watch runs), and a warm native widget tap arrives as a `router.replace`
 * into the mounted page. Neither remounts it, so neither resets the day.
 *
 * **The rule.** Every programmatic navigation goes through `navigateTo`; a
 * cross-route `<router-link>` needs nothing. (If a `<router-link to="/activities">`
 * is ever placed on the planner itself, make it a button that calls `navigateTo`.)
 *
 * **Why the flag is set AFTER the navigation settles.** A flag set before the push
 * is consumed in the next pre-flush, before the push's guard chain reaches its
 * first checkpoint. The page's `handleToday` moves `referenceDate`, the planner's
 * state→URL watch still sees the OLD route, and whenever that route carries `d`
 * (after a drill-in, or a widget row tap) it issues a `router.replace`; vue-router
 * then cancels the pending push because a newer navigation started. The user lands
 * on the replace's URL instead of where they tapped. Setting the flag once the
 * navigation has settled removes the race, and lets the decision read the route we
 * actually landed on ("the planner?") instead of string-matching the
 * requested path, so duplicate, guard-redirected and superseded navigations are all
 * right by construction. vue-router RESOLVES duplicate and guard-cancelled
 * navigations with a `NavigationFailure` (it does not reject). Only two outcomes set
 * the flag: a real arrival, and a DUPLICATE (the user tapped Calendar while already
 * on it). An aborted or cancelled navigation (a guard returned `false`, e.g. while a
 * critical write is in flight, or a newer navigation superseded it) leaves the user
 * where they were, so the planner keeps whatever day they were looking at. Only a
 * genuine throw reaches the failure branch, which logs it.
 *
 * **An explicit `d` always wins.** A URL that names a day (a widget row, a drill-in,
 * an external link) is never overridden. The consumer alone owns that rule: it skips
 * the nav reset and the rollover while the current route carries `d` (and logs the
 * skip), so a stale flag consumed by a later mount cannot pull a widget row tap back
 * to today.
 *
 * **Day rollover.** `usePlannerTodayConsumer` also follows `useToday().today`: when
 * the day turns over (a PWA left open overnight, a native resume) and the planner was
 * on the previous today with no explicit `d`, it snaps to the new today. A planner the
 * user deliberately moved elsewhere is left alone. This is also the safety net for a
 * native resume where the deep link is delivered before `visibilitychange` has
 * advanced `today`.
 *
 * The flag is a tiny module singleton in the `useMagicReader` / `useQuickAdd` idiom,
 * consumed once by `FamilyPlannerPage`, which wires a `watch` (the planner is already
 * mounted) and `onMounted` (the navigation settled before the page's first render)
 * onto one idempotent consume. The flag is cleared the instant it is read, so a stale
 * request can never re-fire on a later navigation.
 */
import { onMounted, ref, watch, type Ref } from 'vue';
import {
  isNavigationFailure,
  NavigationFailureType,
  useRoute,
  type RouteLocationRaw,
  type Router,
} from 'vue-router';
import { useToday } from '@/composables/useToday';
import { PLANNER_ROUTE_NAME } from '@/constants/navigation';
import { logEvent } from '@/services/telemetry';
import { toDateInputValue } from '@/utils/date';

/** Set once a navigation settled on the planner, consumed once by the planner page. */
const pendingGoToday = ref(false);

/**
 * Ask the planner to jump to today. Safe to call from outside `setup()`.
 * `navigateTo` is its only product caller; do not call it from a nav surface
 * before navigating (see "Why the flag is set AFTER the navigation settles").
 */
export function requestGoToday(): void {
  pendingGoToday.value = true;
}

/**
 * Navigate, then ask the planner to go to today if that is where we landed. The one
 * entry point for every programmatic navigation that can land on a mounted planner
 * (tab bar, sidebar and drawer rows, the native inbound-link callback). Whether an
 * explicit `d` in the URL overrides the request is the consumer's call, not this one's.
 */
export function navigateTo(
  router: Pick<Router, 'push' | 'replace' | 'currentRoute'>,
  to: RouteLocationRaw,
  opts?: { replace?: boolean }
): void {
  const method = opts?.replace ? 'replace' : 'push';
  void router[method](to).then(
    (result: unknown) => {
      // Aborted (a guard returned false) or cancelled (a newer navigation won): the
      // user did not go anywhere, so leave their day alone. A duplicate falls through.
      if (
        isNavigationFailure(result, NavigationFailureType.aborted | NavigationFailureType.cancelled)
      ) {
        logEvent({
          level: 'debug',
          surface: 'app-nav',
          message: 'navigation did not complete; the current page was kept',
          context: {
            action: 'nav_not_completed',
            detail: isNavigationFailure(result, NavigationFailureType.aborted)
              ? 'aborted'
              : 'cancelled',
          },
        });
        return;
      }
      if (router.currentRoute.value.name === PLANNER_ROUTE_NAME) requestGoToday();
    },
    (error: unknown) => {
      logEvent({
        level: 'warn',
        surface: 'app-nav',
        message: 'navigation failed; the destination did not open. Check the route and its guards.',
        context: { action: 'nav_failed', detail: method },
        error,
      });
    }
  );
}

/**
 * Host-page wiring. Call once in `FamilyPlannerPage` setup with its `handleToday`
 * handler and its `referenceDate`. Idempotent: whichever nav trigger (watch /
 * onMounted) fires first runs the handler; the other no-ops because the flag is
 * already cleared.
 */
export function usePlannerTodayConsumer(handler: () => void, referenceDate: Ref<Date>): void {
  const { today } = useToday();
  const route = useRoute();
  // A URL that names a day (widget row, drill-in, external link) is never overridden.
  const urlNamesADay = (): boolean => route.query.d !== undefined;

  /** Reset to today, unless the URL names a day; either way the decision is logged. */
  const run = (reason: 'nav' | 'rollover'): void => {
    const skipped = urlNamesADay();
    logEvent({
      level: 'debug',
      surface: 'calendar-nav',
      message: skipped ? 'planner kept the day the URL names' : 'planner reset to today',
      context: { action: skipped ? 'reset-today-skipped' : 'reset-today', detail: reason },
    });
    if (!skipped) handler();
  };

  const consume = (): void => {
    if (!pendingGoToday.value) return;
    pendingGoToday.value = false;
    run('nav');
  };
  watch(pendingGoToday, consume);
  onMounted(consume);

  // Both sides are local `YYYY-MM-DD`, whatever the reference Date's time of day.
  watch(today, (_next, prev) => {
    if (toDateInputValue(referenceDate.value) === prev) run('rollover');
  });
}
