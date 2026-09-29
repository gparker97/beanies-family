import { test, expect } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import { TestDataFactory } from '../../e2e/fixtures/data';
import { ui } from '../../e2e/helpers/ui-strings';
import type { Locator, Page } from '@playwright/test';
import type { FamilyList } from '../../src/types/models';

/**
 * NOT a test: the browser walk for #114, an activity's to-dos and lists (plan
 * docs/plans/2026-09-29-activity-todos-and-lists.md, mockup direction A). Lives OUTSIDE
 * `e2e/specs/` on purpose (see capture.ts). Run it deliberately:
 *   npx playwright test -c playwright.design.config.ts --grep "activity todos walk"
 *
 * Walks: a one-off party (empty state, add a to-do, tick it, From a Template with the
 * Suggested party template), a weekly soccer practice (a whole-activity to-do on every
 * session, a to-do added on one session showing only there), the stacked to-do drawer's
 * date picker layering, the To-Dos page chip opening the right session, and the To-Dos
 * quick bar still adding. Asserts on exported data, and shoots light + dark, phone + desktop.
 */

const SHOTS = 'screenshots/activity-todos';
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function addDays(n: number, from = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + n);
  return d;
}
const PARTY = ymd(addDays(10));
const PARTY_EVE = ymd(addDays(9));
const sat1 = (() => {
  const d = new Date();
  return addDays(((6 - d.getDay() + 7) % 7 || 7) + 7, d); // the Saturday after next
})();
const SAT1 = ymd(sat1);
const SAT1_EVE = ymd(addDays(-1, sat1));
const SAT2 = ymd(addDays(7, sat1));
const SERIES_START = ymd(addDays(-14, sat1));

async function shot(page: Page, name: string) {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}
async function setDark(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark);
  await page.waitForTimeout(250);
}
/** Scroll the drawer's sections into view, then shoot light + dark at phone and desktop. */
async function shotMatrix(page: Page, name: string, scrollTo?: () => Locator) {
  for (const [vp, vpName] of [
    [PHONE, 'phone'],
    [DESKTOP, 'desktop'],
  ] as const) {
    await page.setViewportSize(vp);
    for (const dark of [false, true]) {
      await setDark(page, dark);
      if (scrollTo) await scrollTo().scrollIntoViewIfNeeded();
      await shot(page, `${name}-${dark ? 'dark' : 'light'}-${vpName}`);
    }
  }
  await setDark(page, false);
  await page.setViewportSize(PHONE);
}
async function probe(page: Page, scope: Locator, label: string) {
  const r = await scope.evaluate((root) => ({
    pageOverflowsX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    rootOverflowsX: root.scrollWidth > root.clientWidth + 1,
  }));
  console.log(`[probe] ${label}:`, JSON.stringify(r));
  expect(r.pageOverflowsX, `${label}: no sideways page scroll`).toBe(false);
}

test('activity todos walk', async ({ page }) => {
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    const txt = m.text();
    if (
      (m.type() === 'error' && !txt.includes('Failed to load resource')) ||
      /activity-links|todo-create|split_relink|deeplink_date/.test(txt)
    )
      console.log(`[console.${m.type()}] ${txt.slice(0, 300)}`);
  });

  await page.setViewportSize(PHONE);
  await gotoRoot(page);
  await bypassLoginIfNeeded(page);
  const db = new IndexedDBHelper(page);
  const before = await db.exportData();
  const owner = before.familyMembers[0]!;
  const now = new Date().toISOString();

  const party = TestDataFactory.createActivity(owner.id, {
    id: 'act-party',
    title: "Mia's birthday party",
    date: PARTY,
    recurrence: 'none',
    daysOfWeek: undefined,
    category: 'birthday',
    startTime: '15:00',
    endTime: '17:00',
  });
  const soccer = TestDataFactory.createActivity(owner.id, {
    id: 'act-soccer',
    title: 'Soccer practice',
    date: SERIES_START,
    recurrence: 'weekly',
    daysOfWeek: [6],
    category: 'soccer',
    startTime: '09:00',
    endTime: '10:30',
  });
  await db.seedData({
    activities: [party, soccer],
    todos: [
      {
        id: 'todo-fees',
        title: 'Pay the term fees',
        completed: false,
        activityId: 'act-soccer',
        dueDate: SAT2,
        assigneeIds: [owner.id],
        createdBy: owner.id,
        createdAt: now,
        updatedAt: now,
      },
    ] as never,
  });

  const drawer = () => page.getByRole('dialog').filter({ has: page.getByTestId('activity-todos') });
  const todosSection = () => page.getByTestId('activity-todos');
  const listsSection = () => page.getByTestId('activity-lists');

  // ── 1. One-off party: the empty state ────────────────────────────────────────
  await gotoRoute(page, `/activities?activity=${party.id}`);
  await drawer().waitFor({ timeout: 15000 });
  await expect(page.getByTestId('activity-lists-empty')).toBeVisible();
  await probe(page, drawer(), '1 party empty');
  await shotMatrix(page, '01-party-empty', listsSection);

  // ── 2. Add a to-do from the drawer ───────────────────────────────────────────
  const addInput = todosSection().getByRole('textbox', {
    name: ui('activityTodos.addPlaceholder'),
  });
  await addInput.click();
  await addInput.fill('Buy balloons');
  await shotMatrix(page, '02-party-add-focused', todosSection);
  await addInput.press('Enter');
  await expect(todosSection().getByText('Buy balloons')).toBeVisible();
  let data = await db.exportData();
  const balloons = data.todos.find((t) => t.title === 'Buy balloons');
  console.log('[2] created:', JSON.stringify(balloons));
  expect(balloons?.activityId).toBe(party.id);
  expect(balloons?.activityDate).toBeUndefined();
  expect(balloons?.dueDate).toBe(PARTY_EVE);
  expect(balloons?.assigneeIds).toEqual([owner.id]);
  // A second press on an empty row adds nothing.
  await addInput.press('Enter');
  data = await db.exportData();
  expect(data.todos.filter((t) => t.title === 'Buy balloons')).toHaveLength(1);

  // ── 3. Tick it in place ───────────────────────────────────────────────────────
  const row = todosSection().locator('div.group').filter({ hasText: 'Buy balloons' });
  await row.locator('button').first().click();
  await expect(todosSection().getByTestId('activity-todos-done')).toBeVisible({ timeout: 5000 });
  // The usual completion celebration sits over everything; dismiss it as a person would.
  const celebrate = page.getByRole('button', { name: "Let's go!" });
  await celebrate.waitFor({ timeout: 5000 }).catch(() => {});
  if (await celebrate.isVisible()) await celebrate.click();
  await page.waitForTimeout(400);
  data = await db.exportData();
  expect(data.todos.find((t) => t.id === balloons!.id)?.completed).toBe(true);
  await shotMatrix(page, '03-party-ticked', todosSection);

  // ── 4. From a Template: Suggested party prep, linked ─────────────────────────
  await page.getByTestId('activity-lists-template').first().click();
  const sheet = page.getByRole('dialog').filter({ has: page.getByTestId('suggested-badge') });
  await sheet.waitFor({ timeout: 5000 });
  await shotMatrix(page, '04-template-suggested');
  await sheet.getByTestId('suggested-badge').click();
  await page.waitForTimeout(800);
  data = await db.exportData();
  const lists = (data as unknown as { lists?: FamilyList[] }).lists ?? [];
  const partyList = lists.find((l) => l.linkedActivityId === party.id);
  console.log(
    '[4] list:',
    JSON.stringify({ title: partyList?.title, key: partyList?.templateKey })
  );
  expect(partyList?.templateKey).toBe('party-prep');
  expect(partyList?.activityDate).toBeUndefined();
  await shot(page, '04b-list-opened-light-phone');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await expect(listsSection().getByText(partyList!.title)).toBeVisible();
  await shotMatrix(page, '04c-party-with-list', listsSection);

  // ── 4d. "+ New List" closed untouched leaves nothing behind ──────────────────
  const listsBefore = ((await db.exportData()) as unknown as { lists?: FamilyList[] }).lists ?? [];
  await listsSection().getByTestId('activity-lists-blank').first().click();
  await page.waitForTimeout(800);
  const afterCreate = ((await db.exportData()) as unknown as { lists?: FamilyList[] }).lists ?? [];
  expect(afterCreate.length, 'the blank list exists while it is open').toBe(listsBefore.length + 1);
  await page.keyboard.press('Escape');
  await expect
    .poll(
      async () =>
        (((await db.exportData()) as unknown as { lists?: FamilyList[] }).lists ?? []).length,
      { timeout: 8000, message: 'an untouched blank list is discarded on close' }
    )
    .toBe(listsBefore.length);
  console.log('[4d] untouched blank list discarded');

  // ── 5. Repeating soccer, session 1: whole-activity to-do + a session to-do ───
  await gotoRoute(page, `/activities?activity=${soccer.id}&date=${SAT1}`);
  await drawer().waitFor({ timeout: 15000 });
  await expect(todosSection().getByText('Pay the term fees')).toBeVisible();
  await expect(todosSection().getByText(ui('activityLinks.everySession'))).toBeVisible();
  const sessionInput = todosSection().getByRole('textbox', {
    name: ui('activityTodos.addSessionPlaceholder'),
  });
  await sessionInput.fill('Bring orange slices');
  await sessionInput.press('Enter');
  await expect(todosSection().getByText('Bring orange slices')).toBeVisible();
  data = await db.exportData();
  const slices = data.todos.find((t) => t.title === 'Bring orange slices');
  console.log('[5] session to-do:', JSON.stringify(slices));
  expect(slices?.activityId).toBe(soccer.id);
  expect(slices?.activityDate).toBe(SAT1);
  expect(slices?.dueDate).toBe(SAT1_EVE);
  await probe(page, drawer(), '5 soccer session 1');
  await shotMatrix(page, '05-soccer-session1', todosSection);

  // ── 6. Stacked to-do drawer: its date picker opens on top ────────────────────
  await todosSection().getByText('Bring orange slices').click();
  const todoDrawer = page.getByRole('dialog').filter({ hasText: 'Bring orange slices' }).last();
  await todoDrawer.waitFor({ timeout: 5000 });
  await shot(page, '06-stacked-todo-light-phone');
  // Open its due-date picker: the teleported calendar must sit ABOVE the stacked drawer.
  await todoDrawer
    .getByText(/Fri, \d+ Oct/)
    .first()
    .click();
  await page.waitForTimeout(500);
  // The inline edit now shows the picker trigger; open the calendar itself.
  await todoDrawer
    .getByRole('button', { name: /Fri, \d+ Oct/ })
    .first()
    .click();
  await page.waitForTimeout(600);
  const onTop = await page.evaluate(() => {
    const pops = [...document.querySelectorAll<HTMLElement>('[class*="z-[70]"]')];
    const el = pops.find((p) => p.getBoundingClientRect().height > 40);
    if (!el) return { found: false, count: pops.length };
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { found: true, hitInsidePicker: !!hit && el.contains(hit) };
  });
  console.log('[6] picker layering:', JSON.stringify(onTop));
  await shot(page, '06b-stacked-todo-picker-light-phone');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // ── 7. Session 2: the session to-do is absent, the whole-activity one is there ─
  await page.keyboard.press('Escape');
  await gotoRoute(page, `/activities?activity=${soccer.id}&date=${SAT2}`);
  await drawer().waitFor({ timeout: 15000 });
  await expect(todosSection().getByText('Pay the term fees')).toBeVisible();
  await expect(todosSection().getByText('Bring orange slices')).toHaveCount(0);
  await shot(page, '07-soccer-session2-light-phone');
  await page.keyboard.press('Escape');

  // ── 8. To-Dos page: the chip carries the session and opens it ────────────────
  await gotoRoute(page, '/todo');
  const chip = page.getByRole('button', { name: ui('todo.linkedActivity.open') }).filter({
    hasText: 'Soccer practice',
  });
  await chip.first().waitFor({ timeout: 10000 });
  console.log('[8] chips:', JSON.stringify(await chip.allTextContents()));
  await shotMatrix(page, '08-todo-page-chips');
  const sliceRow = page.locator('div.group').filter({ hasText: 'Bring orange slices' });
  await sliceRow.getByRole('button', { name: ui('todo.linkedActivity.open') }).click();
  await page.waitForURL(/\/activities/);
  await drawer().waitFor({ timeout: 15000 });
  await expect(todosSection().getByText('Bring orange slices')).toBeVisible();
  await shot(page, '08b-chip-opened-session-light-phone');
  await page.keyboard.press('Escape');

  // ── 9. The To-Dos page quick bar still adds ──────────────────────────────────
  await gotoRoute(page, '/todo');
  const bar = page.getByRole('textbox', { name: ui('todo.quickAddPlaceholder') }).first();
  await bar.fill('Call the plumber');
  await bar.press('Enter');
  await expect
    .poll(async () => (await db.exportData()).todos.some((t) => t.title === 'Call the plumber'), {
      timeout: 8000,
    })
    .toBe(true);
  await expect(bar).toHaveValue('');
  await shotMatrix(page, '09-todo-page-quickbar');
});
