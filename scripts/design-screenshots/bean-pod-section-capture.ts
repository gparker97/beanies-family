import { test, expect } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import { ui } from '../../e2e/helpers/ui-strings';
import type { Page } from '@playwright/test';

/**
 * NOT a test: the browser walk for The Bean Pod sidebar section (plan
 * docs/plans/2026-09-27-bean-pod-sidebar-section.md). Lives OUTSIDE `e2e/specs/` on purpose
 * (see capture.ts). Run it deliberately:
 *   npx playwright test -c playwright.design.config.ts --grep "bean pod section"
 */

const SHOTS = 'scratch-shots/bean-pod';

async function shot(page: Page, name: string) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function setDark(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark);
  await page.waitForTimeout(300);
}

/** Texts of the rows currently marked aria-current in the visible nav. */
async function currentRows(page: Page, scope: string) {
  // gotoRoute is a full reload: wait for the menu to render before reading it.
  await page.locator(`${scope} button[aria-expanded]`).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
  return page.locator(`${scope} [aria-current="page"]`).allInnerTexts();
}

test('bean pod section walk', async ({ page }) => {
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning')
      console.log(`[console.${m.type()}] ${m.text()}`);
  });

  // ── Desktop ────────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 1280, height: 900 });
  await gotoRoot(page);
  await bypassLoginIfNeeded(page);
  const db = new IndexedDBHelper(page);
  const ownerId = (await db.exportData()).familyMembers[0]!.id;

  const aside = 'aside nav';
  const headers = await page.locator(`${aside} button[aria-expanded]`).allInnerTexts();
  console.log('[walk] section headers:', JSON.stringify(headers));
  expect(headers.map((h) => h.split('\n').pop()!.trim().toUpperCase())).toEqual([
    ui('nav.section.treehouse').toUpperCase(),
    ui('nav.section.piggyBank').toUpperCase(),
    ui('nav.section.beanPod').toUpperCase(),
  ]);
  const anchor = page.locator(`${aside} button[aria-expanded] img`);
  await expect(anchor).toHaveCount(1);
  const natural = await anchor.evaluate((img: HTMLImageElement) => img.naturalWidth);
  console.log('[walk] anchor naturalWidth:', natural);
  expect(natural).toBeGreaterThan(0);

  const colours = await page
    .locator(`${aside} button[aria-expanded]`)
    .evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
  console.log('[walk] section label colours:', JSON.stringify(colours));

  await gotoRoute(page, '/pod/cookbook');
  const cookbookCurrent = await currentRows(page, aside);
  console.log('[walk] /pod/cookbook current:', JSON.stringify(cookbookCurrent));
  expect(cookbookCurrent).toHaveLength(1);
  expect(cookbookCurrent[0]).toContain(ui('nav.pod.cookbook'));
  // Visible inside the scrolling nav, not merely inside the page viewport.
  await page.waitForTimeout(800);
  const clipped = await page.evaluate((scope) => {
    const nav = document.querySelector(scope)!;
    const row = nav.querySelector('[aria-current="page"]')!;
    const n = nav.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    return r.top < n.top || r.bottom > n.bottom;
  }, aside);
  console.log('[walk] current row clipped by the nav:', clipped);
  expect(clipped).toBe(false);
  await shot(page, '01-desktop-cookbook-light');

  // Once the person scrolls the sidebar, a resize must not yank it back.
  await page.locator(aside).hover();
  await page.mouse.wheel(0, -2000);
  await page.waitForTimeout(400);
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.waitForTimeout(600);
  const navTop = await page.locator(aside).evaluate((el) => el.scrollTop);
  console.log('[walk] sidebar scrollTop after user scroll + resize:', navTop);
  expect(navTop).toBe(0);
  await page.setViewportSize({ width: 1280, height: 900 });

  await gotoRoute(page, `/pod/${ownerId}`);
  const memberCurrent = await currentRows(page, aside);
  console.log('[walk] /pod/<member> current:', JSON.stringify(memberCurrent));
  expect(memberCurrent).toHaveLength(1);
  expect(memberCurrent[0]).toContain(ui('nav.pod.meetBeans'));

  // Collapse The Bean Pod, leave, come back: it re-opens for a Pod route.
  const podHeader = page.locator(`${aside} button[aria-expanded]`).nth(2);
  await podHeader.click();
  await expect(podHeader).toHaveAttribute('aria-expanded', 'false');
  await shot(page, '02-desktop-pod-collapsed');
  await page
    .locator(`${aside} button`, { hasText: ui('nav.nook') })
    .first()
    .click();
  await expect(podHeader).toHaveAttribute('aria-expanded', 'false');
  await gotoRoute(page, '/pod/safety');
  await expect(podHeader).toHaveAttribute('aria-expanded', 'true');

  await setDark(page, true);
  await shot(page, '03-desktop-safety-dark');
  await setDark(page, false);

  // ── Phone ──────────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 400, height: 860 });
  await gotoRoute(page, '/nook');
  await page.getByTestId('app-content').waitFor({ state: 'visible', timeout: 30000 });
  const podTab = page.getByRole('button', { name: ui('mobile.pod'), exact: true });
  await expect(podTab.locator('img')).toBeVisible();
  const tabBoxes = await page.locator('nav > button').evaluateAll((els) =>
    els.map((e) => {
      const label = e.querySelector('.font-outfit') as HTMLElement | null;
      return label ? Math.round(label.getBoundingClientRect().top) : null;
    })
  );
  console.log('[walk] phone tab label tops:', JSON.stringify(tabBoxes));
  await shot(page, '04-phone-tabs-light');

  await podTab.click();
  await page.waitForTimeout(600);
  await shot(page, '05-phone-pod-stack-light');
  await page
    .getByRole('menuitem')
    .filter({ hasText: ui('nav.pod.cookbook') })
    .last()
    .click();
  await page.waitForURL('**/pod/cookbook');
  await podTab.click();
  await page.waitForTimeout(600);
  const stackCurrent = await page.locator('[role=menuitem][aria-current="page"]').allInnerTexts();
  console.log('[walk] phone stack current on /pod/cookbook:', JSON.stringify(stackCurrent));
  expect(stackCurrent).toHaveLength(1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  await setDark(page, true);
  await shot(page, '06-phone-tabs-dark');

  // Hamburger drawer mirrors the sidebar.
  await page
    .getByRole('button', { name: ui('mobile.menu') })
    .first()
    .click();
  await page.waitForTimeout(600);
  const drawer = 'div.w-80 nav';
  const panelScrollTop = await page
    .locator('div.w-80')
    .first()
    .evaluate((el) => el.scrollTop);
  console.log('[walk] drawer panel scrollTop on open:', panelScrollTop);
  expect(panelScrollTop).toBe(0);
  const drawerHeaders = await page.locator(`${drawer} button[aria-expanded]`).allInnerTexts();
  console.log('[walk] drawer headers:', JSON.stringify(drawerHeaders));
  expect(drawerHeaders).toHaveLength(3);
  await page.locator(`${drawer} button[aria-expanded]`).nth(2).scrollIntoViewIfNeeded();
  await shot(page, '07-phone-drawer-dark');

  // Help opens externally (a new tab), not an in-app route.
  const popupPromise = page
    .context()
    .waitForEvent('page', { timeout: 5000 })
    .catch(() => null);
  await page
    .locator(`${drawer} button`, { hasText: ui('nav.help') })
    .first()
    .click();
  const popup = await popupPromise;
  console.log('[walk] help popup url:', popup ? popup.url() : 'none', '| app url:', page.url());
  expect(popup).not.toBeNull();
  await popup?.close();
});
