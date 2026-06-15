import type { RouteLocationNormalizedLoaded } from 'vue-router';

/**
 * Whether the authenticated app shell (sidebar / header / main content frame)
 * should render for the current route + auth state.
 *
 * Routes opt OUT of the chrome via `meta.noChrome` (set in `router/index.ts`),
 * so there is no route-name list to keep in sync here — adding a future
 * chrome-less route is a single `meta.noChrome: true` next to the route.
 *
 * Crucially, a session with no `.beanpod` file yet (`needsPodSetup`) NEVER gets
 * the shell. This is the root-cause guard for the create-pod remount race: the
 * shell branch and the chrome-less branch each render `<router-view>`, so
 * flipping this value mid-onboarding would destroy + remount the login page and
 * strand it on an infinite spinner. Keeping it stable (false) while podless
 * prevents that. See `docs/plans/2026-06-15-onboarding-remount-race.md`.
 */
export function shouldShowAppLayout(
  route: Pick<RouteLocationNormalizedLoaded, 'meta'>,
  flags: { isAuthenticated: boolean; needsPodSetup: boolean }
): boolean {
  if (!flags.isAuthenticated) return false;
  if (flags.needsPodSetup) return false; // never frame a podless / mid-onboarding session
  return route.meta?.noChrome !== true;
}

/**
 * Routes where an authenticated session with no pod yet is EXPECTED (the
 * onboarding entry points). Used to suppress the `app.onboardingZombieState`
 * alert — a podless session here is normal, not an anomaly.
 *
 * This is a DERIVED predicate keyed on the route NAME, deliberately NOT a second
 * `meta` flag: `meta.noChrome` answers "render the shell?" and is also set on
 * NotFound + PlausibleExclude, where a podless session genuinely IS anomalous
 * and SHOULD still alert. One source of truth (this name list), no overlapping
 * booleans to drift. The recovery screen `/welcome?resume=setup` resolves to the
 * `Welcome` name, so it is covered here without inspecting the query.
 */
const PODLESS_EXPECTED_ROUTE_NAMES: ReadonlyArray<string> = [
  'Welcome',
  'Login',
  'JoinFamily',
  'CreateFamily',
  'OpenFromDrive',
];

export function isPodlessExpectedRoute(
  route: Pick<RouteLocationNormalizedLoaded, 'name'>
): boolean {
  return typeof route.name === 'string' && PODLESS_EXPECTED_ROUTE_NAMES.includes(route.name);
}

/**
 * Whether a `router.replace()`/`push()` result is a cancelled navigation. Vue
 * Router RESOLVES (does not reject) with a `NavigationFailure` when a guard
 * blocks a nav; the failure object always carries a numeric `type`. Detect it
 * that way without importing `isNavigationFailure`. Shared by App.vue's
 * `safeRouterReplace` and LoginPage's `replaceOrSurface`.
 */
export function isNavigationCancelled(result: unknown): result is { type: number } {
  return !!result && typeof (result as { type?: number }).type === 'number';
}
