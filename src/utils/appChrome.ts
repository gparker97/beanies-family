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
 * Routes a person can legitimately arrive on **before** the app has a pod — the onboarding
 * entry points, plus the two surfaces that must mount for a signed-out visitor.
 *
 * ONE list, consulted by three places: both of `App.vue`'s boot redirects and
 * `useNotifications`' auto-open suppression. It used to be two — this list and an identical
 * inline array in `App.vue` — and they had already drifted: `ShareTarget` is declared
 * `requiresAuth: false` with a comment explaining it MUST mount signed-out so it can delete
 * its Cache-Storage stash (nothing sweeps it, there is no TTL, and sign-out clears IndexedDB
 * but not `caches`), yet it was absent from `App.vue`'s copy, so a signed-out document share
 * was bounced to onboarding and leaked into Cache Storage permanently.
 *
 * A DERIVED predicate keyed on the route NAME, deliberately NOT a `meta` flag.
 * `meta.noChrome` answers "render the shell?" and is also set on NotFound +
 * PlausibleExclude, where a podless session genuinely IS anomalous and SHOULD still alert.
 * And a `meta.noAuthRedirect` boolean would be *forgettable*: a route author who sets
 * `requiresAuth: false` and nothing else gets a public route silently bounced at boot —
 * which is exactly what happened to `ShareTarget`. One name list, no overlapping booleans.
 *
 * The recovery screen `/welcome?resume=setup` resolves to the `Welcome` name, so it is
 * covered here without inspecting the query.
 */
const PUBLIC_ENTRY_ROUTE_NAMES: ReadonlyArray<string> = [
  'Welcome',
  'Login',
  'JoinFamily',
  'CreateFamily',
  'OpenFromDrive',
  // Mounts signed-out on purpose, to clear its own Cache-Storage stash.
  'ShareTarget',
  // A shared recipe reads entirely from the URL fragment — no account, no pod (#92).
  'SharedRecipe',
  // Dev-only ADR-032 worker spike — a standalone measurement page with no auth/pod.
  // Harmless in the podless branch, which never reaches it anyway thanks to that
  // branch's own `!route.path.startsWith('/dev')` guard.
  'DevWorkerSpike',
];

export function isPublicEntryRoute(route: Pick<RouteLocationNormalizedLoaded, 'name'>): boolean {
  return typeof route.name === 'string' && PUBLIC_ENTRY_ROUTE_NAMES.includes(route.name);
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
