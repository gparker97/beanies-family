import { describe, it, expect } from 'vitest';

/**
 * Dated CI tripwire for the ONE-RELEASE legacy `beanies_redirect_auth` web
 * transport added during the 2026-06-20 iOS OAuth bounce-tracking fix.
 *
 * The legacy fallback exists ONLY to complete in-flight redirects started by the
 * pre-fix build. It lives in:
 *   - `src/pages/OAuthCallbackPage.vue` (the `legacyState` branch)
 *   - `src/services/google/googleAuth.ts` `completeRedirectAuth` (the
 *     `stateJson`/`codeVerifier` arm)
 *
 * This test FAILS once the removal date passes, so CI itself forces the cleanup
 * rather than relying on someone remembering a TODO. When it fails:
 *   1. Delete the two legacy branches above (NOT the native hand-off, which also
 *      reads `REDIRECT_AUTH_KEY` — see the comments at each site).
 *   2. Delete this test.
 *
 * See docs/plans/2026-06-20-ios-oauth-bounce-state-param.md.
 */
const LEGACY_REMOVAL_DEADLINE = '2026-09-30T00:00:00Z';

describe('legacy redirect-transport cleanup tripwire', () => {
  it('legacy beanies_redirect_auth web transport is still within its one-release window', () => {
    expect(Date.now()).toBeLessThan(Date.parse(LEGACY_REMOVAL_DEADLINE));
  });
});
