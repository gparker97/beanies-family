import { test, expect } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import { selectBeanieDate } from '../../e2e/helpers/date-picker';
import { ui } from '../../e2e/helpers/ui-strings';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * NOT a test: the browser walk for "Lists work like to-dos" (tracker #147). Lives outside
 * `e2e/specs/` on purpose (see capture.ts). Run it deliberately:
 *   npx playwright test -c playwright.design.config.ts --grep "lists like todos walk"
 */

const OUT = path.join(process.cwd(), 'scratch-shots', 'lists-like-todos');
const MAMA = 'walk-mama';
const PIP = 'walk-pip';

const ymd = (offsetDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function setDark(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark);
  await page.waitForTimeout(300);
}

/** `gotoRoute` returns on load; the Nook and the wall paint about 3 s later. */
async function settled(page: Page) {
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(500);
    const txt = (
      await page
        .locator('body')
        .innerText()
        .catch(() => '')
    ).trim();
    if (txt.length > 40 && !/^Loading/.test(txt)) return;
  }
  throw new Error('page never left the loading splash');
}

async function both(page: Page, name: string) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${name}-light.png`) });
  await setDark(page, true);
  await page.screenshot({ path: path.join(OUT, `${name}-dark.png`) });
  await setDark(page, false);
}

async function walk(page: Page, tag: string) {
  await gotoRoot(page);
  await bypassLoginIfNeeded(page, { familyName: 'The Bean Family' });
  const db = new IndexedDBHelper(page);
  const owner = (await db.exportData()).familyMembers[0]!;
  const now = new Date().toISOString();
  const bean = (id: string, name: string, color: string, ageGroup: 'adult' | 'child') =>
    ({
      id,
      name,
      color,
      gender: 'female',
      ageGroup,
      email: `${id}@thebeanfamily.example`,
      role: 'member',
      passwordHash: 'demo-seed-not-a-real-hash',
      createdAt: now,
      updatedAt: now,
    }) as never;
  await db.seedData({
    familyMembers: [
      { ...owner, name: 'Papa Bean' } as never,
      bean(MAMA, 'Mama Bean', '#E67E22', 'adult'),
      bean(PIP, 'Pip', '#10b981', 'child'),
    ],
  });

  // ── New list: the people row ────────────────────────────────────────────
  await gotoRoute(page, '/lists');
  await page
    .getByRole('button', { name: ui('lists.newList') })
    .first()
    .click();
  const peopleRow = page.getByTestId('new-list-people');
  await peopleRow.waitFor();
  await peopleRow.getByText('Mama Bean').click();
  await both(page, `${tag}-01-new-list-sheet`);
  await page.getByRole('button', { name: ui('lists.new.blank') }).click();

  // ── Drawer: two people, then a due date and the show field ──────────────
  const pill = page.getByTestId('list-people-pill');
  await pill.waitFor();
  const pillText = await pill.innerText();
  console.log(`[walk:${tag}] people pill:`, JSON.stringify(pillText));
  expect(pillText).toContain('Mama');
  expect(pillText).toContain('Papa');

  const add = page.getByPlaceholder(ui('lists.detail.addItem'));
  for (const item of ['Passports', 'Swimsuits', 'Sunscreen']) {
    await add.fill(item);
    await add.press('Enter');
    await page.waitForTimeout(250);
  }

  const when = page.getByTestId('list-when');
  await when.scrollIntoViewIfNeeded();
  await selectBeanieDate(when, ymd(8));
  await page.getByTestId('show-rule-field').waitFor();
  await page.waitForTimeout(500);
  console.log(
    `[walk:${tag}] show pill after a due date (default = on the due date):`,
    JSON.stringify(
      await page
        .getByTestId('list-show-pill')
        .innerText()
        .catch(() => 'none')
    )
  );
  await when.scrollIntoViewIfNeeded();
  await both(page, `${tag}-02-drawer-oneoff-default`);

  // Show From: 2 days from now (the second picker in the section).
  await selectBeanieDate(when, ymd(2), { index: 1 });
  await page.waitForTimeout(600);
  const showPill = await page.getByTestId('list-show-pill').innerText();
  console.log(`[walk:${tag}] show pill after Show From:`, JSON.stringify(showPill));
  expect(showPill.toLowerCase()).toContain('shows from');
  await both(page, `${tag}-03-drawer-oneoff-showfrom`);

  // People picker: try to remove everyone; the last one is kept, with a hint.
  await pill.click();
  const picker = page.getByTestId('list-people-picker');
  await picker.waitFor();
  await picker.getByText('Mama Bean').click();
  await page.waitForTimeout(300);
  await picker.getByText('Papa Bean').click();
  await page.waitForTimeout(400);
  console.log(
    `[walk:${tag}] keep-one hint visible:`,
    await page.getByTestId('list-people-hint').isVisible()
  );
  await picker.getByText('Mama Bean').click();
  await page.waitForTimeout(400);
  await pill.scrollIntoViewIfNeeded();
  await both(page, `${tag}-04-drawer-people-picker`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ── Lists page: stack + "Shows from" tag ────────────────────────────────
  const tile = page.getByTestId('list-tile-open').first();
  await tile.waitFor();
  console.log(
    `[walk:${tag}] tile tag:`,
    JSON.stringify(
      await page
        .getByTestId('list-tile-show-tag')
        .first()
        .innerText()
        .catch(() => 'none')
    ),
    '| tile people:',
    await page.getByTestId('list-tile-people').count()
  );
  await both(page, `${tag}-05-lists-page`);

  // ── Nook: a list not showing yet is absent from the briefing ────────────
  await gotoRoute(page, '/nook');
  await settled(page);
  const nookText = await page.locator('body').innerText();
  console.log(`[walk:${tag}] nook mentions the waiting list:`, nookText.includes('My List'));
  expect(nookText.includes('My List')).toBe(false);
  await both(page, `${tag}-06-nook-waiting`);

  // Make it due today: it must now appear.
  await gotoRoute(page, '/lists');
  await page.getByTestId('list-tile-open').first().click();
  await page.getByTestId('list-when').scrollIntoViewIfNeeded();
  await selectBeanieDate(page.getByTestId('list-when'), ymd(0));
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await gotoRoute(page, '/nook');
  await settled(page);
  const nookNow = await page.locator('body').innerText();
  console.log(`[walk:${tag}] nook mentions the list once due today:`, nookNow.includes('My List'));
  expect(nookNow.includes('My List')).toBe(true);
  await both(page, `${tag}-07-nook-due-today`);

  // ── Repeating: the Show row ─────────────────────────────────────────────
  await gotoRoute(page, '/lists');
  await page.getByTestId('list-tile-open').first().click();
  await page
    .getByRole('button', { name: ui('lists.detail.recurring'), exact: true })
    .first()
    .click();
  const rep = page.getByTestId('list-show-repeat');
  await rep.waitFor();
  await rep.scrollIntoViewIfNeeded();
  await both(page, `${tag}-08-drawer-repeat-default`);
  await rep.getByRole('button', { name: ui('todo.show.repeat.lead') }).click();
  await page.waitForTimeout(500);
  console.log(
    `[walk:${tag}] lead wall note visible:`,
    await page.getByTestId('list-show-lead-wall').isVisible()
  );
  await rep.scrollIntoViewIfNeeded();
  await both(page, `${tag}-09-drawer-repeat-lead`);
  await rep.getByRole('button', { name: ui('todo.show.repeat.now') }).click();
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');

  // ── Wall: an Every Day repeating list for two people ────────────────────
  await gotoRoute(page, '/wall');
  await settled(page);
  const wallText = await page.locator('body').innerText();
  console.log(`[walk:${tag}] wall shows the Every Day list:`, wallText.includes('My List'));
  await both(page, `${tag}-10-wall`);
}

test.describe('lists like todos walk', () => {
  test('lists like todos walk desktop', async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
    await page.setViewportSize({ width: 1280, height: 900 });
    await walk(page, 'desk');
  });

  test('lists like todos walk phone', async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
    await page.setViewportSize({ width: 400, height: 860 });
    await walk(page, 'phone');
  });
});
