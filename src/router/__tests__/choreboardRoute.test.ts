/**
 * The choreboard route (#146) is gated by its feature flag through the shared
 * `meta.requiresFlag` guard (`router.beforeEach`: an off flag redirects to the Nook), the same
 * gate the meal planner uses (commit de48d63f). This pins the production record's meta, so the
 * route can never ship ungated; the guard itself is shared by every flagged route.
 */
import { describe, it, expect } from 'vitest';
import router from '@/router';

describe('/choreboard route', () => {
  it('exists, is titled The Choreboard, and is gated by the `choreboard` flag', () => {
    const record = router.getRoutes().find((r) => r.path === '/choreboard');
    expect(record).toBeDefined();
    expect(record!.name).toBe('Choreboard');
    expect(record!.meta).toMatchObject({
      titleKey: 'nav.choreboard',
      requiresAuth: true,
      requiresFlag: 'choreboard',
    });
  });
});
