import { test, expect } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';
import { ui } from '../../e2e/helpers/ui-strings';
import type { Page } from '@playwright/test';

/**
 * NOT a test: the browser walk for docs/plans/2026-09-30-who-owns-what-briefing-trim.md.
 * Lives OUTSIDE `e2e/specs/` on purpose (see capture.ts). Run it deliberately:
 *   npx playwright test -c playwright.design.config.ts --grep "who owns what badge walk"
 *
 * Keeps three cards (one dealt, two "decide later") and checks the orange `stillToDeal`
 * count on the Who Owns What nav row (desktop sidebar), the Planning-tab dot and the
 * bean-stack count (phone), light + dark, and that the Nook briefing shows no
 * "your cards" / "cards with nobody" rows.
 */

const SHOTS = 'scratch-shots/wow-badge';
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function setDark(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark);
  await page.waitForTimeout(250);
}

async function go(page: Page, path: string) {
  await gotoRoute(page, path);
  await page.getByTestId('app-content').waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
}

test('who owns what badge walk', async ({ page }) => {
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));

  await page.setViewportSize(DESKTOP);
  await gotoRoot(page);
  await bypassLoginIfNeeded(page);

  const navRow = () =>
    page.locator('aside').getByRole('button', { name: new RegExp(ui('nav.whoOwnsWhat')) });

  // Before any card is kept: no count.
  await go(page, '/who-owns-what');
  console.log(`[before] nav row label: ${await navRow().getAttribute('aria-label')}`);
  expect(await navRow().innerText()).not.toMatch(/\d/);

  // Keep three cards: the first dealt to the owner, the next two "decide later".
  await page.getByTestId('first-deal-start').click();
  await page.getByTestId('deal-pile').waitFor();
  const decideLater = () =>
    page.getByRole('button', { name: ui('whoOwnsWhat.pile.decideLater'), exact: true });
  await page.getByTestId('deal-pile-keep').click();
  await page.locator('[data-testid^="deal-pick-"]').first().click();
  await page.waitForTimeout(700);
  for (let i = 0; i < 2; i++) {
    await page.getByTestId('deal-pile-keep').click();
    await decideLater().click();
    await page.waitForTimeout(700);
    if (
      await page
        .getByTestId('deal-pile-next')
        .isVisible()
        .catch(() => false)
    )
      await page.getByTestId('deal-pile-next').click();
    await page.waitForTimeout(400);
  }

  const label = await navRow().getAttribute('aria-label');
  const text = await navRow().innerText();
  console.log(`[after] nav row label: ${label} | text: ${JSON.stringify(text)}`);
  expect(text).toMatch(/\b2\b/);

  for (const dark of [false, true]) {
    await setDark(page, dark);
    await shot(page, `desktop-${dark ? 'dark' : 'light'}`);
    const clip = (await page.locator('aside').boundingBox())!;
    await page.screenshot({
      path: `${SHOTS}/sidebar-${dark ? 'dark' : 'light'}.png`,
      clip: { x: clip.x, y: clip.y, width: clip.width, height: Math.min(clip.height, 900) },
    });
  }
  await setDark(page, false);

  // Nook briefing: no standing card rows.
  await go(page, '/nook');
  const body = await page.getByTestId('app-content').innerText();
  const stale = ['Your cards in Who Owns What', 'has nobody yet', 'have nobody yet'].filter((s) =>
    body.includes(s)
  );
  console.log(`[nook] stale card rows found: ${JSON.stringify(stale)}`);
  console.log(
    `[nook desktop after reload] nav row label: ${await navRow().getAttribute('aria-label')}`
  );
  expect(stale).toEqual([]);
  await shot(page, 'nook-desktop-light');

  // Phone: the Planning tab's attention dot (closed state), then the bean-stack count.
  await page.setViewportSize(PHONE);
  await go(page, '/nook');
  for (const dark of [false, true]) {
    await setDark(page, dark);
    const info = await page.evaluate((title) => {
      const dots = [...document.querySelectorAll<HTMLElement>(`[title="${title}"]`)];
      return dots.map((d) => {
        const inner = d.firstElementChild as HTMLElement | null;
        const r = (inner ?? d).getBoundingClientRect();
        return {
          tab: d.closest('button')?.getAttribute('aria-label'),
          box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
          bg: inner ? getComputedStyle(inner).backgroundColor : null,
          innerHtml: d.innerHTML.slice(0, 200),
        };
      });
    }, ui('mobileNav.attentionBadge'));
    console.log(`[phone ${dark ? 'dark' : 'light'}] dots: ${JSON.stringify(info)}`);
    const tabBar = page.locator('nav').last();
    const bb = (await tabBar.boundingBox())!;
    await page.screenshot({
      path: `${SHOTS}/phone-tabs-${dark ? 'dark' : 'light'}.png`,
      clip: { x: 0, y: bb.y - 10, width: 390, height: bb.height + 10 },
    });
    expect(info.some((d) => d.tab === ui('mobile.planning'))).toBe(true);
  }
});
