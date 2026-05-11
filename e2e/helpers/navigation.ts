import type { Page } from '@playwright/test';

/**
 * Navigate to the app root (`/`).
 *
 * Uses `waitUntil: 'commit'` instead of Playwright's default `'load'`.
 * The SPA's router guard redirects `/` → `/nook` / `/welcome` / `/login`
 * on first paint depending on auth + family state, so the initial
 * document's `load` event races against an immediate client-side
 * navigation. Under heavy CI contention (webkit especially) the redirect
 * wins and Playwright throws "Navigation to '...' is interrupted by
 * another navigation to '...'". `commit` resolves as soon as the
 * response is received — before `load` — so the redirect can't interrupt
 * it. Every caller follows this with its own readiness wait
 * (`bypassLoginIfNeeded` → `create-pod-button` visible, or an
 * `app-content` / element `waitFor`), so dropping the `load` wait here
 * costs nothing.
 *
 * History: 8 webkit-CI tests across 6 spec files flaked on bare
 * `page.goto('/')` in `beforeEach` hooks on 2026-05-11 (triggering
 * commit `1552d80` was unrelated to all of them); a re-run passed clean.
 * See docs/E2E_HEALTH.md.
 */
export async function gotoRoot(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'commit' });
}
