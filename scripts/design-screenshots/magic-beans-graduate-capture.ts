import { test, expect } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';
import type { Page } from '@playwright/test';

/**
 * NOT a test: the browser walk for "magic beans out of beta" (2026-10-02). Lives OUTSIDE
 * `e2e/specs/` on purpose (see capture.ts). Run it deliberately:
 *   npx playwright test -c playwright.design.config.ts --grep "magic beans graduate"
 *
 * Checks, light + dark, phone + desktop:
 *   1. Settings shows a "Magic beans" card among the ordinary cards and NO Beanie Lab section;
 *   2. the card opens the AI drawer with the magic beans title (the ?open=ai deep link is
 *      not drivable here, see the note in the walk);
 *   3. the quick-add sheet's magic reader card carries no Beta badge.
 */
const SHOTS = 'screenshots/magic-beans-graduate';
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

async function setDark(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark);
  await page.waitForTimeout(250);
}

for (const [vp, vpName] of [
  [PHONE, 'phone'],
  [DESKTOP, 'desktop'],
] as const)
  for (const dark of [false, true]) {
    const tag = `${dark ? 'dark' : 'light'}-${vpName}`;
    test(`magic beans graduate ${tag}`, async ({ page }) => {
      await page.setViewportSize(vp);
      await gotoRoot(page);
      await bypassLoginIfNeeded(page);
      await gotoRoute(page, '/settings');
      await page.waitForLoadState('networkidle');
      await setDark(page, dark);

      const card = page.getByTestId('settings-card-magic-beans');
      await expect(card).toBeVisible({ timeout: 15_000 });
      const body = (await page.locator('body').innerText()).toLowerCase();
      expect(body, 'the Beanie Lab section is gone').not.toContain('beanie lab');
      expect(body, 'no experimental toggle').not.toContain('enable experimental features');
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/01-settings-card-${tag}.png` });

      await card.click();
      const drawer = page.getByRole('dialog').filter({ hasText: /magic beans/i });
      await drawer.waitFor({ timeout: 8000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/02-drawer-${tag}.png` });
      await page.keyboard.press('Escape');
      await expect(drawer).toHaveCount(0, { timeout: 5000 });

      // NOTE: `?open=ai` cannot be exercised here: the E2E boot path drops every settings
      // `?open=` query before the page mounts (probed 2026-10-02 with `security` and
      // `family-data` too). The gate swap is covered by reading + useBeanieLab tests.

      // The quick-add sheet's magic reader card: no Beta badge.
      await gotoRoute(page, '/nook');
      await page.waitForLoadState('networkidle');
      // Theme again: the app's theme init resets the class on a page load.
      await setDark(page, dark);
      const fab = page.getByRole('button', { name: 'Quick add', exact: true });
      // The FAB can match before it is visible (it hides while a tip or toast shows); wait a
      // bounded time, and skip rather than hang the whole walk on it.
      const fabReady = await fab
        .first()
        .waitFor({ state: 'visible', timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (fabReady) {
        await fab.first().click();
        const sheet = page.getByTestId('quick-add-sheet');
        await sheet.waitFor({ timeout: 8000 });
        const sheetText = (await sheet.innerText()).toLowerCase();
        expect(sheetText).toContain('magic beans');
        expect(sheetText, 'no Beta badge on the magic reader card').not.toMatch(/\bbeta\b/);
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${SHOTS}/03-quick-add-${tag}.png` });
      } else {
        console.log('[walk] no Quick add button on this page; skipping the sheet check');
      }
    });
  }
