import { test, expect } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';
import type { Page } from '@playwright/test';

/**
 * NOT a test: the browser walk for the sidebar density change (2026-10-02). Lives OUTSIDE
 * `e2e/specs/` on purpose (see capture.ts). Run it deliberately:
 *   npx playwright test -c playwright.design.config.ts --grep "sidebar density"
 *
 * At 1366x740 and 1280x900, light + dark, on /meal-planner (a flag-gated route: if the
 * Treehouse row is missing, enable the Meal Planner flag in the test family first):
 *   1. only The Treehouse is open; Piggy Bank and Bean Pod show peek strips;
 *   2. no row label wraps;
 *   3. the default state (one section open) is not `can-scroll` at 900 and is `can-scroll` at 740 (accepted quiet scroll); with Piggy Bank
 *      open too, `can-scroll` mirrors real overflow (it must be set at 740; no fixed expectation
 *      at 900);
 *   3b. in every variant the Share feedback and Settings rows are visible without scrolling:
 *      inside the viewport and outside the scroll container (they live in the fixed footer);
 *   4. a Bean Pod peek chip (Emergency Contacts) navigates and opens Bean Pod;
 *   5. the member card's tools row (Help, Discord) is captured, and Share feedback and
 *      Settings sit in the fixed footer above it.
 */
const SHOTS = 'screenshots/sidebar-density';
const SIZES = [
  { width: 1366, height: 740 },
  { width: 1280, height: 900 },
] as const;

async function setDark(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark);
  await page.waitForTimeout(250);
}

/** Share feedback + Settings must be on screen with no scrolling: in the viewport, not inside the scroller. */
async function expectPinnedRowsVisible(page: Page, state: string) {
  const sidebar = page.locator('aside').first();
  const vp = page.viewportSize()!;
  for (const name of [/share feedback/i, /^.{0,4}\s*settings/i]) {
    const btn = sidebar.getByTestId('sidebar-pinned').getByRole('button', { name });
    await expect(btn, `${state}: ${name} row`).toBeVisible();
    const box = (await btn.boundingBox())!;
    expect(box.y, `${state}: ${name} top`).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, `${state}: ${name} bottom`).toBeLessThanOrEqual(vp.height);
    const inScroller = await btn.evaluate((el) => !!el.closest('.sidebar-nav-scroll'));
    expect(inScroller, `${state}: ${name} must not be in the scroll container`).toBe(false);
  }
}

async function expectNoWrappedLabels(page: Page) {
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(
      'aside nav button:not([aria-expanded]) span.whitespace-nowrap'
    )) {
      if (el.offsetParent === null) continue;
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 24;
      const wrapped = el.getBoundingClientRect().height >= lineHeight * 1.5;
      const clipped = el.scrollWidth > el.clientWidth + 1;
      if (wrapped || clipped) out.push(el.textContent ?? '');
    }
    return out;
  });
  expect(bad, 'labels that wrap or overflow').toEqual([]);
}

for (const size of SIZES)
  for (const dark of [false, true]) {
    const tag = `${size.width}x${size.height}-${dark ? 'dark' : 'light'}`;
    test(`sidebar density ${tag}`, async ({ page }) => {
      await page.setViewportSize(size);
      await gotoRoot(page);
      await bypassLoginIfNeeded(page);
      // First visit: drop any remembered accordion state so the new default applies.
      await page.evaluate(() => localStorage.removeItem('sidebar-accordion-state-v2'));
      await gotoRoute(page, '/meal-planner');
      await page.waitForLoadState('networkidle');
      await setDark(page, dark);

      const sidebar = page.locator('aside').first();
      await expect(sidebar).toBeVisible({ timeout: 15_000 });
      const expanded = async (name: RegExp) =>
        sidebar.getByRole('button', { name }).first().getAttribute('aria-expanded');
      expect(await expanded(/treehouse/i)).toBe('true');
      expect(await expanded(/piggy bank/i)).toBe('false');
      expect(await expanded(/bean pod/i)).toBe('false');
      await expect(sidebar.getByTestId('nav-peek-/accounts')).toBeVisible();
      await expect(sidebar.getByTestId('nav-peek-/pod/contacts')).toBeVisible();
      await expectNoWrappedLabels(page);
      const navDefault = sidebar.locator('.sidebar-nav-scroll');
      // 900 fits without scrolling. At 740 the default state overflows by design (decision:
      // accept the quiet scroll there); the overflow px is logged either way.
      const defaultOverflowPx = await navDefault.evaluate(
        (el) => el.scrollHeight - el.clientHeight
      );
      const defaultNavHeight = await navDefault.evaluate((el) => el.scrollHeight);
      console.log(
        `[${tag}] default nav content ${defaultNavHeight}px, overflow ${defaultOverflowPx}px`
      );
      expect(
        await navDefault.evaluate((el) => el.classList.contains('can-scroll')),
        size.height === 740
          ? `default state scrolls quietly at 740 (overflow ${defaultOverflowPx}px)`
          : `default state fits at ${size.height} (overflow ${defaultOverflowPx}px)`
      ).toBe(size.height === 740);
      await expectPinnedRowsVisible(page, 'default');
      await sidebar.screenshot({ path: `${SHOTS}/01-default-${tag}.png` });

      // Open a second section.
      await sidebar
        .getByRole('button', { name: /piggy bank/i })
        .first()
        .click();
      await page.waitForTimeout(300);
      const nav = sidebar.locator('.sidebar-nav-scroll');
      const overflows = await nav.evaluate((el) => el.scrollHeight > el.clientHeight);
      const hasClass = await nav.evaluate((el) => el.classList.contains('can-scroll'));
      expect(hasClass, 'can-scroll mirrors real overflow').toBe(overflows);
      if (size.height === 740) expect(hasClass, 'overflows at 740').toBe(true);
      await expectNoWrappedLabels(page);
      await expectPinnedRowsVisible(page, 'two open');
      await sidebar.screenshot({ path: `${SHOTS}/02-two-open-${tag}.png` });

      // A peek chip navigates and opens its section.
      await sidebar.getByTestId('nav-peek-/pod/contacts').click();
      await expect(page).toHaveURL(/\/pod\/contacts/);
      expect(await expanded(/bean pod/i)).toBe('true');
      await expectPinnedRowsVisible(page, 'after chip');
      await sidebar.screenshot({ path: `${SHOTS}/03-after-chip-${tag}.png` });

      // The member card with its tools row.
      const tools = sidebar.getByTestId('sidebar-tools');
      await expect(tools.locator('button')).toHaveCount(2);
      await expect(sidebar.locator('[data-testid^="sidebar-tool-"]')).toHaveCount(2);
      await tools.locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]').screenshot({
        path: `${SHOTS}/04-member-card-${tag}.png`,
      });
    });
  }
