import { describe, it, expect } from 'vitest';
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import { shouldShowAppLayout, isPodlessExpectedRoute, isNavigationCancelled } from '../appChrome';

/** Minimal route stub — only `meta` is read by the helper. */
function route(meta: Record<string, unknown> = {}): Pick<RouteLocationNormalizedLoaded, 'meta'> {
  return { meta } as Pick<RouteLocationNormalizedLoaded, 'meta'>;
}

describe('shouldShowAppLayout', () => {
  const authed = { isAuthenticated: true, needsPodSetup: false };

  it('hides chrome when not authenticated (even on a normal app route)', () => {
    expect(shouldShowAppLayout(route(), { isAuthenticated: false, needsPodSetup: false })).toBe(
      false
    );
  });

  it('hides chrome for a podless session on every route (the remount-race guard)', () => {
    // Normal app route (no noChrome) but mid-onboarding → must stay false.
    expect(shouldShowAppLayout(route(), { isAuthenticated: true, needsPodSetup: true })).toBe(
      false
    );
    // Even a route with no meta at all.
    expect(
      shouldShowAppLayout(route({ requiresAuth: true }), {
        isAuthenticated: true,
        needsPodSetup: true,
      })
    ).toBe(false);
  });

  it('hides chrome on routes flagged meta.noChrome', () => {
    expect(shouldShowAppLayout(route({ noChrome: true }), authed)).toBe(false);
  });

  it('shows chrome for an authenticated, pod-having session on a normal app route', () => {
    expect(shouldShowAppLayout(route({ requiresAuth: true }), authed)).toBe(true);
    expect(shouldShowAppLayout(route(), authed)).toBe(true);
  });

  it('is meta-driven, not name-driven (drift resistance)', () => {
    // A brand-new no-chrome route — unknown to any list — is hidden purely
    // because it carries meta.noChrome. Adding such a route never needs an edit
    // here; this asserts the helper reads meta, not a hardcoded name list.
    expect(shouldShowAppLayout(route({ noChrome: true, name: 'SomeFutureRoute' }), authed)).toBe(
      false
    );
  });
});

describe('isPodlessExpectedRoute', () => {
  function namedRoute(name: string | null) {
    return { name } as Pick<RouteLocationNormalizedLoaded, 'name'>;
  }

  it('is true for the onboarding entry routes (podless is normal there)', () => {
    for (const n of ['Welcome', 'Login', 'JoinFamily', 'CreateFamily', 'OpenFromDrive']) {
      expect(isPodlessExpectedRoute(namedRoute(n))).toBe(true);
    }
  });

  it('is false for NotFound / PlausibleExclude / app routes (podless IS anomalous → still alert)', () => {
    expect(isPodlessExpectedRoute(namedRoute('NotFound'))).toBe(false);
    expect(isPodlessExpectedRoute(namedRoute('PlausibleExclude'))).toBe(false);
    expect(isPodlessExpectedRoute(namedRoute('Nook'))).toBe(false);
    expect(isPodlessExpectedRoute(namedRoute(null))).toBe(false);
  });
});

describe('isNavigationCancelled', () => {
  it('is true for a NavigationFailure (numeric type), false otherwise', () => {
    expect(isNavigationCancelled({ type: 8 })).toBe(true);
    expect(isNavigationCancelled(undefined)).toBe(false); // success
    expect(isNavigationCancelled(null)).toBe(false);
    expect(isNavigationCancelled({})).toBe(false);
    expect(isNavigationCancelled({ type: 'x' })).toBe(false);
  });
});
