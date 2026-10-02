import { test, expect } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';
import type { Page } from '@playwright/test';

/**
 * NOT a test: the phone + tablet half of the sidebar-density walk (2026-10-02). Lives OUTSIDE
 * `e2e/specs/` on purpose (see capture.ts). Run it deliberately:
 *   npx playwright test -c playwright.design.config.ts --grep "sidebar density mobile"
 *
 * Breakpoints (useBreakpoint.ts): <=767 phone and 768..1023 tablet use the hamburger drawer;
 * >=1024 shows the desktop sidebar. The drawer shares AppNavMenu, so it inherits the peek
 * strips; it must keep its four pinned rows (Discord, Share feedback, Help, Settings).
 */
const SHOTS = 'screenshots/sidebar-density-mobile';
const VIEWPORTS = [
  { name: 'phone-390', size: { width: 390, height: 844 }, drawer: true },
  { name: 'tablet-portrait-820', size: { width: 820, height: 1180 }, drawer: true },
  { name: 'tablet-landscape-1180', size: { width: 1180, height: 820 }, drawer: false },
  { name: 'small-landscape-1024', size: { width: 1024, height: 768 }, drawer: false },
] as const;

async function setDark(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark);
  await page.waitForTimeout(250);
}

for (const vp of VIEWPORTS)
  for (const dark of [false, true]) {
    const tag = `${vp.name}-${dark ? 'dark' : 'light'}`;
    test(`sidebar density mobile ${tag}`, async ({ page }) => {
      await page.setViewportSize(vp.size);
      await gotoRoot(page);
      await bypassLoginIfNeeded(page);
      await gotoRoute(page, '/meal-planner');
      await page.waitForLoadState('networkidle');
      await setDark(page, dark);

      if (vp.drawer) {
        const sidebarTools = page.getByTestId('sidebar-tools');
        expect(await sidebarTools.count(), 'no desktop sidebar below 1024').toBe(0);
        await page.getByRole('button', { name: /^Menu/ }).first().click();
        // The drawer panel carries no dialog role; find it by its fixed-width slate panel.
        const drawer = page
          .locator('div.w-80')
          .filter({ hasText: /The Treehouse/i })
          .first();
        await drawer.waitFor({ timeout: 8000 });
        await page.waitForTimeout(350);
        const text = (await drawer.innerText()).toLowerCase();
        for (const label of ['share feedback', 'settings', 'help', 'beanies discord']) {
          expect(text, `drawer keeps the ${label} row`).toContain(label);
        }
        // Peek strips for the two collapsed sections.
        const chips = drawer.locator('[data-testid^="nav-peek-"]');
        expect(await chips.count(), 'peek chips in the drawer').toBeGreaterThan(0);
        // No horizontal overflow inside the drawer.
        const overflowX = await drawer.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
        expect(overflowX, 'drawer has no horizontal overflow').toBe(false);
        await page.screenshot({ path: `${SHOTS}/drawer-${tag}.png` });
        // A chip navigates and closes the drawer.
        const emergency = drawer.locator('[data-testid="nav-peek-/pod/contacts"]');
        const chip = (await emergency.count()) ? emergency : chips.last();
        await chip.first().click();
        await expect(drawer).toHaveCount(0, { timeout: 5000 });
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${SHOTS}/after-chip-${tag}.png` });
      } else {
        const sidebar = page.locator('aside').first();
        await expect(sidebar).toBeVisible({ timeout: 8000 });
        const tools = page.getByTestId('sidebar-tools');
        await expect(tools).toBeVisible();
        const pinnedText = (await sidebar.innerText()).toLowerCase();
        expect(pinnedText).toContain('share feedback');
        expect(pinnedText).toContain('settings');
        // No label wraps: every row label is a single line.
        const wrapped = await sidebar
          .locator('nav button span:nth-child(2)')
          .evaluateAll((els) =>
            els.filter((e) => e.getBoundingClientRect().height > 28).map((e) => e.textContent)
          );
        expect(wrapped, 'no wrapped labels').toEqual([]);
        await sidebar.screenshot({ path: `${SHOTS}/sidebar-${tag}.png` });
      }
    });
  }
