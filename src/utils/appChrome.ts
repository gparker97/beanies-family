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
