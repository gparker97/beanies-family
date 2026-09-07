import { describe, it, expect } from 'vitest';
import type { RouteLocationNormalizedLoaded } from 'vue-router';
import {
  shouldShowAppLayout,
  isPublicEntryRoute,
  isExternalLandingRoute,
  isNavigationCancelled,
} from '../appChrome';

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

describe('isPublicEntryRoute', () => {
  function namedRoute(name: string | null) {
    return { name } as Pick<RouteLocationNormalizedLoaded, 'name'>;
  }

  it('is true for the onboarding entry routes (podless is normal there)', () => {
    for (const n of ['Welcome', 'Login', 'JoinFamily', 'CreateFamily', 'OpenFromDrive']) {
      expect(isPublicEntryRoute(namedRoute(n))).toBe(true);
    }
  });

  it('covers ShareTarget — it must mount signed-out to clear its Cache-Storage stash', () => {
    // The regression this merge fixed: `ShareTarget` is `requiresAuth: false` but was
    // missing from `App.vue`'s inline copy of this list, so a signed-out document share
    // was bounced to /welcome and its stashed file stayed in Cache Storage forever.
    expect(isPublicEntryRoute(namedRoute('ShareTarget'))).toBe(true);
  });

  it('covers SharedRecipe — a shared recipe reads from the fragment, with no pod', () => {
    expect(isPublicEntryRoute(namedRoute('SharedRecipe'))).toBe(true);
  });

  it('is false for NotFound / PlausibleExclude / app routes (podless IS anomalous → still alert)', () => {
    expect(isPublicEntryRoute(namedRoute('NotFound'))).toBe(false);
    expect(isPublicEntryRoute(namedRoute('PlausibleExclude'))).toBe(false);
    expect(isPublicEntryRoute(namedRoute('Nook'))).toBe(false);
    expect(isPublicEntryRoute(namedRoute(null))).toBe(false);
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

describe('the beanie wall route', () => {
  it('renders WITHOUT app chrome — a wall shows the family, not the app furniture', () => {
    expect(
      shouldShowAppLayout(
        { meta: { noChrome: true } },
        { isAuthenticated: true, needsPodSetup: false }
      )
    ).toBe(false);
  });
});

describe('isExternalLandingRoute', () => {
  function namedRoute(name: string | null) {
    return { name } as Pick<RouteLocationNormalizedLoaded, 'name'>;
  }

  it('covers exactly the two routes a redirect would destroy state on', () => {
    // `/recipe` carries the whole shared recipe in its FRAGMENT and `/share` is the only
    // code that deletes its Cache-Storage stash, so App.vue's podless redirect must not run
    // on either — suppressing the alert alone was not enough.
    expect(isExternalLandingRoute(namedRoute('SharedRecipe'))).toBe(true);
    expect(isExternalLandingRoute(namedRoute('ShareTarget'))).toBe(true);
  });

  it('does NOT cover the onboarding entries — steering those continues their flow', () => {
    for (const n of ['Welcome', 'Login', 'JoinFamily', 'CreateFamily', 'OpenFromDrive']) {
      expect(isExternalLandingRoute(namedRoute(n))).toBe(false);
    }
    expect(isExternalLandingRoute(namedRoute('Nook'))).toBe(false);
    expect(isExternalLandingRoute(namedRoute(null))).toBe(false);
  });

  it('is a strict subset of isPublicEntryRoute — derived, so it cannot drift', () => {
    for (const n of ['SharedRecipe', 'ShareTarget']) {
      expect(isPublicEntryRoute(namedRoute(n))).toBe(true);
    }
  });
});
