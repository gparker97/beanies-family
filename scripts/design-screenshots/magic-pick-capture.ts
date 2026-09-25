import { test, expect } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot } from '../../e2e/helpers/navigation';
import type { Page } from '@playwright/test';

/**
 * NOT a test — the browser walk for the magic-beans sheet's optional pick (#108,
 * plan docs/plans/2026-09-25-magic-beans-category-preselect.md). Lives OUTSIDE
 * `e2e/specs/` on purpose (see capture.ts). Run it deliberately:
 *   npx playwright test -c playwright.design.config.ts --grep "magic pick"
 *
 * Opens the REAL sheet from the quick-add FAB, so the tiles are the component's own
 * markup on the compiled stylesheet, then walks: nothing picked → one picked → picked
 * again (cleared) → keyboard focus ring → a SIX-kind fixture (real tiles cloned in the
 * DOM, same classes) to prove the grid re-flows at phone width with no truncation and
 * no sideways scroll.
 */

const SHOTS = 'scratch-shots/magic-pick';

const WIDTHS = [
  { name: 'se', size: { width: 320, height: 660 } },
  { name: 'phone', size: { width: 360, height: 780 } },
  { name: 'desktop', size: { width: 1280, height: 800 } },
];

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function openSheet(page: Page) {
  // The FAB animates continuously, so Playwright never sees it "stable": click through it.
  await page.getByRole('button', { name: 'Quick add' }).click({ force: true });
  await page.getByTestId('quick-add-sheet').waitFor();
  await page
    .getByTestId('quick-add-sheet')
    .getByRole('button', { name: /read something for me/i })
    .click();
  await page.locator('[role="group"][aria-label="Tell us what this is"]').waitFor();
}

const tiles = (page: Page) =>
  page.locator('[role="group"][aria-label="Tell us what this is"] > button');

for (const theme of ['light', 'dark'] as const)
  for (const w of WIDTHS) {
    test(`magic pick ${theme} ${w.name}`, async ({ page }) => {
      page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
      await page.setViewportSize(w.size);
      await gotoRoot(page);
      await bypassLoginIfNeeded(page);
      await page.evaluate((t) => {
        document.documentElement.classList.toggle('dark', t === 'dark');
      }, theme);

      await openSheet(page);

      // 1. Nothing picked is the default — three tiles, none pressed, the idle line — and ONE
      //    row at this width, also under Large reading mode (1.1875x root, per the theme skill).
      await expect(tiles(page)).toHaveCount(3);
      const rowsAt = () =>
        page.evaluate(() => {
          const group = document.querySelector(
            '[role="group"][aria-label="Tell us what this is"]'
          )!;
          return new Set([...group.children].map((c) => (c as HTMLElement).offsetTop)).size;
        });
      expect(await rowsAt(), 'three tiles must share one row').toBe(1);
      await page.evaluate(() => (document.documentElement.style.fontSize = '19px'));
      await page.waitForTimeout(150);
      const rowsLarge = await rowsAt();
      await page.evaluate(() => (document.documentElement.style.fontSize = ''));
      console.log(theme, w.name, 'rows with three tiles at 19px root:', rowsLarge);
      expect(rowsLarge, 'three tiles must share one row in Large reading mode').toBe(1);
      for (let i = 0; i < 3; i++)
        await expect(tiles(page).nth(i)).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByText('Pick one, or let beanies work it out.')).toBeVisible();
      await shot(page, `${theme}-${w.name}-1-idle`);

      // 2. One tap picks; the state line names the kind with the right article.
      await tiles(page).nth(1).click();
      await expect(tiles(page).nth(1)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByText("We'll read this as a trip.")).toBeVisible();
      await expect(page.getByText('Tap again to let beanies decide.')).toBeVisible();
      const picked = await tiles(page)
        .nth(1)
        .evaluate((el) => {
          const s = getComputedStyle(el);
          const label = getComputedStyle(el.querySelector('span:last-child') as HTMLElement);
          return { border: s.borderTopColor, bg: s.backgroundColor, ink: label.color };
        });
      console.log(theme, w.name, 'picked tile:', JSON.stringify(picked));
      await shot(page, `${theme}-${w.name}-2-picked`);

      // 3. A second tap on the same tile clears it.
      await tiles(page).nth(1).click();
      await expect(tiles(page).nth(1)).toHaveAttribute('aria-pressed', 'false');
      await expect(page.getByText('Pick one, or let beanies work it out.')).toBeVisible();

      // 4. Keyboard: tab from the field down to the first tile; the Sky Silk ring must show.
      await page.locator('textarea').focus();
      for (let i = 0; i < 3; i++) await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        return { pressed: el?.getAttribute('aria-pressed'), text: el?.textContent?.trim() };
      });
      console.log(theme, w.name, 'focused after 3 tabs:', JSON.stringify(focused));
      await shot(page, `${theme}-${w.name}-3-focus`);

      // 5. SIX kinds: clone the real tiles (same classes) so the grid is exercised as shipped.
      await page.evaluate(() => {
        const group = document.querySelector('[role="group"][aria-label="Tell us what this is"]')!;
        const extra = [
          ['💳', 'Transactions'],
          ['📋', 'List'],
          ['🎂', 'Milestone'],
        ];
        for (const [emoji, label] of extra) {
          const clone = group.children[0]!.cloneNode(true) as HTMLElement;
          clone.setAttribute('aria-pressed', 'false');
          (clone.querySelector('span:first-child') as HTMLElement).textContent = emoji;
          (clone.querySelector('span:last-child') as HTMLElement).textContent = label;
          group.appendChild(clone);
        }
      });
      await expect(tiles(page)).toHaveCount(6);
      const layout = await page.evaluate(() => {
        const group = document.querySelector('[role="group"][aria-label="Tell us what this is"]')!;
        const rows = new Set([...group.children].map((c) => (c as HTMLElement).offsetTop));
        const labels = [...group.querySelectorAll('span:last-child')].map((s) => ({
          text: s.textContent,
          need: (s as HTMLElement).scrollWidth,
          have: (s as HTMLElement).clientWidth,
        }));
        const truncated = labels.filter((l) => l.need > l.have + 1).length;
        const sheet = group.closest('[role="dialog"]') ?? document.body;
        return {
          rows: rows.size,
          truncatedLabels: truncated,
          labels,
          sheetOverflowsX: sheet.scrollWidth > sheet.clientWidth,
          pageOverflowsX:
            document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      });
      console.log(theme, w.name, 'six tiles:', JSON.stringify(layout));
      expect(layout.truncatedLabels, 'a label is clipped').toBe(0);
      expect(layout.pageOverflowsX, 'the page scrolls sideways').toBe(false);
      await shot(page, `${theme}-${w.name}-4-six`);
    });
  }
