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
 * The onboarding entry points: a podless session here is the NORMAL mid-flow state, and
 * steering one to the resume-setup recovery screen CONTINUES that flow rather than
 * interrupting it. The recovery screen `/welcome?resume=setup` resolves to `Welcome`, so it
 * is covered without inspecting the query.
 */
const ONBOARDING_ENTRY_ROUTE_NAMES: ReadonlyArray<string> = [
  'Welcome',
  'Login',
  'JoinFamily',
  'CreateFamily',
  'OpenFromDrive',
];

/**
 * Landing pages for content that arrived from OUTSIDE the app, and the reason they are a
 * separate list rather than more names on the one above.
 *
 * Each holds state that exists NOWHERE ELSE and dies the moment it is navigated away from:
 *
 *   - `SharedRecipe` (#92) carries the entire shared recipe in the URL FRAGMENT. A
 *     `router.replace` to the recovery screen does not defer it, it DESTROYS it — the
 *     sender's link is the only copy, and the receiver sees an unexplained onboarding
 *     screen instead of the recipe a friend sent them.
 *   - `ShareTarget` (#64) is the ONLY code that deletes its Cache-Storage stash. Steered
 *     away, someone else's shared document stays on the device permanently: nothing sweeps
 *     it, there is no TTL, and sign-out clears IndexedDB but not `caches`.
 *
 * So for these two, "an authenticated session with no pod yet" means WAIT — render the page,
 * let it do its one job — never "resume onboarding first". Both pages already handle a
 * podless visitor themselves.
 */
const EXTERNAL_LANDING_ROUTE_NAMES: ReadonlyArray<string> = ['ShareTarget', 'SharedRecipe'];

/**
 * Routes a person can legitimately arrive on BEFORE the app has a pod.
 *
 * DERIVED from the two lists above plus the dev spike, so the union can never disagree with
 * its parts. It answers "may this session be here at all?", consulted by both of `App.vue`'s
 * boot redirects and by `useNotifications`' auto-open suppression.
 *
 * It used to be two hand-maintained lists — this one and an identical inline array in
 * `App.vue` — and they had already drifted: `ShareTarget` was in one and not the other, so a
 * signed-out document share was bounced to onboarding and leaked into Cache Storage forever.
 *
 * A DERIVED predicate keyed on the route NAME, deliberately NOT a `meta` flag.
 * `meta.noChrome` answers "render the shell?" and is also set on NotFound +
 * PlausibleExclude, where a podless session genuinely IS anomalous and SHOULD still alert.
 * And a `meta.noAuthRedirect` boolean would be *forgettable*: a route author who sets
 * `requiresAuth: false` and nothing else gets a public route silently bounced at boot —
 * which is exactly what happened to `ShareTarget`.
 */
const PUBLIC_ENTRY_ROUTE_NAMES: ReadonlyArray<string> = [
  ...ONBOARDING_ENTRY_ROUTE_NAMES,
  ...EXTERNAL_LANDING_ROUTE_NAMES,
  // Dev-only ADR-032 worker spike — a standalone measurement page with no auth/pod.
  // Harmless in the podless branch, which never reaches it anyway thanks to that
  // branch's own `!route.path.startsWith('/dev')` guard.
  'DevWorkerSpike',
];

/** May this session be on this route without auth or a pod? Suppresses both boot redirects. */
export function isPublicEntryRoute(route: Pick<RouteLocationNormalizedLoaded, 'name'>): boolean {
  return typeof route.name === 'string' && PUBLIC_ENTRY_ROUTE_NAMES.includes(route.name);
}

/**
 * Must this route be left exactly where it is, even mid-onboarding?
 *
 * A STRICTER question than `isPublicEntryRoute`, and the distinction is the whole point: the
 * onboarding entries may be steered to the recovery screen (that IS their flow), while these
 * two carry state that a redirect destroys. Consulted only by `App.vue`'s podless redirect.
 */
export function isExternalLandingRoute(
  route: Pick<RouteLocationNormalizedLoaded, 'name'>
): boolean {
  return typeof route.name === 'string' && EXTERNAL_LANDING_ROUTE_NAMES.includes(route.name);
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
