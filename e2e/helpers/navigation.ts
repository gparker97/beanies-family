import type { Page } from '@playwright/test';

const NAV_INTERRUPTED = /interrupted by another navigation|Frame load interrupted/i;

/**
 * Full-page navigation to an in-app route, hardened against the webkit-CI
 * navigation race.
 *
 * The SPA's router guard redirects `/` → `/nook` / `/welcome` / `/login` on
 * first paint, and the authenticated `/nook` page can fire a late client-side
 * `router.replace('/nook')` as its data settles. Either of these can interrupt
 * an in-flight `page.goto(path)`, throwing "Navigation to '…' is interrupted by
 * another navigation to '…'" (or "Frame load interrupted"). Under heavy CI
 * contention (webkit especially) the interrupting nav beats even
 * `waitUntil: 'commit'`, so a single goto is not enough.
 *
 * The interrupt is transient and self-clearing: once the outgoing page's
 * pending redirect has fired, the document is quiescent and a fresh goto lands
 * cleanly. We therefore retry the goto on exactly that error class (re-throwing
 * anything else, and the interrupt itself on the final attempt). `commit`
 * resolves as soon as the response is received — before `load` — and every
 * caller follows with its own readiness wait (`bypassLoginIfNeeded`,
 * `waitForURL`, or an element `waitFor`), so dropping the `load` wait costs
 * nothing. The non-interrupt (chromium) path returns on the first attempt with
 * behaviour identical to a bare `page.goto(path, { waitUntil: 'commit' })`.
 *
 * History: 8 webkit-CI tests across 6 spec files flaked on bare
 * `page.goto('/')` in `beforeEach` hooks on 2026-05-11; the `commit` harden
 * reduced but did not eliminate it (financial-data.spec re-flaked 2026-06-03
 * with the interrupt beating commit). See docs/E2E_HEALTH.md.
 */
export async function gotoRoute(page: Page, path: string): Promise<void> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await page.goto(path, { waitUntil: 'commit' });
      return;
    } catch (err) {
      const interrupted = err instanceof Error && NAV_INTERRUPTED.test(err.message);
      if (!interrupted || attempt === maxAttempts) throw err;
      // The interrupting redirect has now fired; let its document finish
      // loading before retrying so the next goto starts from a quiescent page
      // (no `waitForTimeout` — E2E budget rule).
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    }
  }
}

/**
 * Navigate to the app root (`/`). Thin wrapper over {@link gotoRoute} kept for
 * the many `beforeEach` call sites that read `gotoRoot(page)`.
 */
export async function gotoRoot(page: Page): Promise<void> {
  await gotoRoute(page, '/');
}
