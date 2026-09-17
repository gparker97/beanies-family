import { test, expect } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';

/**
 * NOT a CI test — Phase 4 verification for the magic-link work.
 *
 * It lives OUTSIDE `e2e/specs/` deliberately: `playwright.config.ts` has
 * `testDir: './e2e/specs'` with NO `testIgnore`, so a scratch file dropped there joins the
 * CI matrix on every push and silently eats the ADR-007 budget (23 of a hard cap of 25).
 *
 * Run: npx playwright test -c playwright.design.config.ts --grep "magic-link"
 *
 * ⚠️ WHAT IT PROVES ABOUT THE SETTINGS CARD, precisely. It proves the card MOUNTS in the
 * Security & Recovery drawer, that its copy is present, and that its heading renders
 * legibly in both themes. It does NOT capture the card's full body: `BaseModal` is
 * fixed-position with its own scroll container, so `fullPage` photographs the document
 * while the modal stays at its viewport slot — three scrolling strategies each "passed"
 * while producing the same clipped frame, which is a good reminder that a green
 * screenshot test proves only that a file was written. Full visual review of the card
 * body is on the manual list rather than falsely claimed here.
 *
 * ⚠️ WHAT THIS CANNOT REACH, and therefore does not claim. Pod creation and joining both
 * run through real Google OAuth and a real Drive file, so the combined creation save step,
 * the joiner's save step, and redeeming a link on a genuinely cold second device are on
 * the manual list — not "unverified because I forgot", but "not reachable from here".
 * What IS reachable is every surface that renders from local state, and the one thing a
 * unit test cannot see: whether it is legible in both themes at both widths.
 */
const WIDTHS = [
  { name: 'desktop', size: { width: 1280, height: 900 } },
  // 390px is where this project's UI defects actually live.
  { name: 'phone', size: { width: 390, height: 844 } },
];

for (const theme of ['light', 'dark'] as const)
  for (const w of WIDTHS) {
    test(`magic-link: settings card ${theme} ${w.name}`, async ({ page }) => {
      await page.setViewportSize(w.size);
      await gotoRoot(page);
      await bypassLoginIfNeeded(page);
      await page.evaluate((t) => {
        document.documentElement.classList.toggle('dark', t === 'dark');
      }, theme);

      // Open the drawer the way a person does. `?open=security` did NOT open it from a
      // client-side navigation — the Settings page rendered with the card collapsed — and
      // a harness that quietly screenshots a closed drawer proves nothing.
      await gotoRoute(page, '/settings');
      await page.waitForLoadState('networkidle');
      await page.getByText('Security & Recovery', { exact: false }).first().click();

      const card = page.getByText('Your beanies magic link', { exact: false }).first();
      await expect(card).toBeVisible({ timeout: 15_000 });

      // Theme LAST: applied before the page settles, the app's own theme init overwrites
      // it and every "dark" screenshot comes out light — which is exactly what happened
      // on the first run (identical byte sizes for light and dark gave it away).
      await page.evaluate((th) => {
        document.documentElement.classList.toggle('dark', th === 'dark');
      }, theme);
      await page.waitForTimeout(250);

      // The status line must exist and must NOT claim an active link when there is none.
      const body = (await page.locator('body').innerText()).toLowerCase();
      expect(body).toContain('lasts 7 days');
      expect(body).toContain('create a magic link');

      // ⚠️ SCREENSHOT THE CARD ELEMENT, not the page. `BaseModal` is fixed-position, so
      // `fullPage: true` captures the DOCUMENT while the modal renders at its viewport
      // slot — the drawer's internal scroll never appears, and three separate scrolling
      // strategies all "passed" while photographing the same clipped frame. An element
      // shot renders the whole box regardless of where it sits in a scroll container.
      const cardBox = page
        .locator('div')
        .filter({ hasText: /Your beanies magic link/ })
        .last();
      await cardBox.screenshot({
        path: `test-results/magic-link-settings-${theme}-${w.name}.png`,
      });
    });

    test(`magic-link: paste fallback ${theme} ${w.name}`, async ({ page }) => {
      await page.setViewportSize(w.size);
      await gotoRoute(page, '/welcome');
      await page.waitForLoadState('networkidle');
      await page.evaluate((th) => {
        document.documentElement.classList.toggle('dark', th === 'dark');
      }, theme);

      const opener = page.getByTestId('open-paste-link');
      if (!(await opener.isVisible().catch(() => false))) {
        // A signed-in device does not show the welcome gate. Say so rather than
        // passing silently on a screen that was never rendered.
        test.skip(true, 'welcome gate not shown — device already has a family');
        return;
      }
      await opener.click();
      await page.getByTestId('submit-paste-link').waitFor();

      // The failure path is the point: chat apps truncate URLs, so a half-copied link is
      // EXPECTED input here and must produce a named error, not a dead-end.
      await page.locator('#pasted-link').fill('https://app.beanies.family/jo');
      await page.getByTestId('submit-paste-link').click();
      await expect(page.getByRole('alert')).toBeVisible();

      await page.evaluate((th) => {
        document.documentElement.classList.toggle('dark', th === 'dark');
      }, theme);
      await page.screenshot({
        path: `test-results/magic-link-paste-${theme}-${w.name}.png`,
        fullPage: true,
      });
    });
  }
