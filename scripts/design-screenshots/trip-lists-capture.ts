import { test, expect } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import { TestDataFactory } from '../../e2e/fixtures/data';
import type { Locator, Page } from '@playwright/test';
import type { FamilyList, FamilyVacation } from '../../src/types/models';

/**
 * NOT a test: the browser walk for "create or attach a list from a trip" (plan
 * ~/projects/beanies-ops/docs/plans/2026-11-04-trip-lists-create-attach.md). Lives OUTSIDE
 * `e2e/specs/` on purpose (see capture.ts). Run it deliberately:
 *   npx playwright test -c playwright.design.config.ts --grep "trip lists walk"
 *
 * Walks, on a trip: the empty Lists section, Attach a List (two lists in one write; a list
 * already on another trip is not offered), the three pills wrapping in the ideas column,
 * + New List (blank in Trips, discarded when closed untouched), From a Template (Vacation
 * Packing suggested), + Add a Plan → List; then the activity drawer's Attach a List and its
 * blank still landing in Home. Asserts on exported data; shoots light + dark, phone + desktop.
 */

const SHOTS = 'screenshots/trip-lists';
const PHONE = { width: 400, height: 860 };
const DESKTOP = { width: 1280, height: 900 };

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function addDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ymd(d);
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}
async function setDark(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark);
  await page.waitForTimeout(250);
}
async function noSidewaysScroll(page: Page, label: string) {
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  console.log(`[probe] ${label}: pageOverflowsX=${overflows}`);
  expect(overflows, `${label}: no sideways page scroll`).toBe(false);
}
/** Each action pill sits inside its section horizontally (the wrap fix). */
async function pillsInside(section: Locator, label: string) {
  const r = await section.evaluate((root) => {
    const box = root.getBoundingClientRect();
    return [...root.querySelectorAll<HTMLElement>('[data-testid^="linked-lists-"]')]
      .filter((el) => el.tagName === 'BUTTON')
      .map((el) => {
        const b = el.getBoundingClientRect();
        return {
          id: el.dataset.testid,
          inside: b.left >= box.left - 1 && b.right <= box.right + 1,
        };
      });
  });
  console.log(`[pills] ${label}: ${JSON.stringify(r)}`);
  expect(r.length).toBe(3);
  for (const p of r) expect(p.inside, `${label}: ${p.id} inside the section`).toBe(true);
}
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
const listsOf = async (db: IndexedDBHelper) =>
  ((await db.exportData()) as unknown as { lists?: FamilyList[] }).lists ?? [];

test('trip lists walk', async ({ page }) => {
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    const txt = m.text();
    if (
      (m.type() === 'error' && !txt.includes('Failed to load resource')) ||
      /trip-lists|activity-links|lists_attach/.test(txt)
    )
      console.log(`[console.${m.type()}] ${txt.slice(0, 300)}`);
  });

  await page.setViewportSize(PHONE);
  await gotoRoot(page);
  await bypassLoginIfNeeded(page);
  const db = new IndexedDBHelper(page);
  const owner = (await db.exportData()).familyMembers[0]!;
  const now = new Date().toISOString();

  const trip = {
    id: 'vac-japan',
    name: 'Japan Trip',
    tripType: 'fly_and_stay',
    startDate: addDays(20),
    endDate: addDays(30),
    assigneeIds: [owner.id],
    travelSegments: [],
    accommodations: [],
    transportation: [],
    ideas: [],
    createdBy: owner.id,
    createdAt: now,
    updatedAt: now,
  } as unknown as FamilyVacation;
  const mkList = (id: string, title: string, extra: Partial<FamilyList> = {}): FamilyList =>
    ({
      id,
      title,
      emoji: '📝',
      category: 'home',
      ownerId: owner.id,
      items: [{ id: `${id}-i`, title: 'Something', completed: false }],
      lifecycle: 'oneoff',
      completed: false,
      createdBy: owner.id,
      createdAt: now,
      updatedAt: now,
      ...extra,
    }) as FamilyList;
  const soccer = TestDataFactory.createActivity(owner.id, {
    id: 'act-soccer',
    title: 'Soccer practice',
    date: addDays(5),
    recurrence: 'none',
    daysOfWeek: undefined,
    category: 'soccer',
    startTime: '09:00',
    endTime: '10:30',
  });
  await db.seedData({
    vacations: [trip],
    activities: [soccer],
    lists: [
      mkList('l-snacks', 'Plane snacks'),
      mkList('l-pharmacy', 'Pharmacy run'),
      mkList('l-ski', 'Ski gear', { linkedVacationId: 'vac-other' }),
      mkList('l-chores', 'Weekend chores'),
    ],
  } as never);

  const section = () => page.getByTestId('linked-lists');

  // ── 1. The trip's empty Lists section ─────────────────────────────────────────
  await gotoRoute(page, `/travel?vacation=${trip.id}`);
  await section().waitFor({ timeout: 15000 });
  await expect(page.getByTestId('linked-lists-empty')).toBeVisible();
  await noSidewaysScroll(page, '1 empty');
  await shotMatrix(page, '01-trip-empty', section);

  // ── 2. Attach a List: two lists, one write; another trip's list is not offered ─
  await section().getByTestId('linked-lists-attach').click();
  const attachSheet = page.getByRole('dialog').filter({ hasText: 'Plane snacks' });
  await attachSheet.waitFor({ timeout: 5000 });
  await expect(attachSheet.getByText('Ski gear')).toHaveCount(0);
  await shotMatrix(page, '02-attach-sheet');
  await attachSheet.getByText('Plane snacks').click();
  await attachSheet.getByText('Pharmacy run').click();
  await shotMatrix(page, '02b-attach-picked');
  await attachSheet.getByRole('button', { name: 'Attach', exact: true }).click();
  await page.waitForTimeout(800);
  let lists = await listsOf(db);
  expect(
    lists
      .filter((l) => l.linkedVacationId === trip.id)
      .map((l) => l.id)
      .sort()
  ).toEqual(['l-pharmacy', 'l-snacks']);
  expect(lists.find((l) => l.id === 'l-ski')?.linkedVacationId).toBe('vac-other');

  // ── 3. Lists linked: the three pills wrap in the column ───────────────────────
  await expect(page.getByTestId('linked-lists-empty')).toHaveCount(0);
  for (const vp of [PHONE, DESKTOP]) {
    await page.setViewportSize(vp);
    await section().scrollIntoViewIfNeeded();
    await pillsInside(section(), `3 pills ${vp.width}`);
    await noSidewaysScroll(page, `3 linked ${vp.width}`);
  }
  await page.setViewportSize(PHONE);
  await shotMatrix(page, '03-trip-linked', section);

  // ── 4. + New List: blank in Trips, opened, discarded when closed untouched ────
  await section().getByTestId('linked-lists-blank').click();
  await page.waitForTimeout(900);
  lists = await listsOf(db);
  const blank = lists.find(
    (l) => l.linkedVacationId === trip.id && !['l-pharmacy', 'l-snacks'].includes(l.id)
  );
  console.log('[4] blank:', JSON.stringify({ category: blank?.category, items: blank?.items }));
  expect(blank?.category).toBe('trips');
  await shot(page, '04-blank-opened-light-phone');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  lists = await listsOf(db);
  expect(lists.find((l) => l.id === blank?.id)).toBeUndefined();

  // ── 5. From a Template: Vacation Packing suggested, linked to the trip ────────
  await section().getByTestId('linked-lists-template').click();
  const newSheet = page.getByRole('dialog').filter({ has: page.getByTestId('suggested-badge') });
  await newSheet.waitFor({ timeout: 5000 });
  await shotMatrix(page, '05-template-suggested');
  await newSheet.getByTestId('suggested-badge').click();
  await page.waitForTimeout(900);
  lists = await listsOf(db);
  const packing = lists.find((l) => l.templateKey === 'vacation-packing');
  console.log(
    '[5] packing:',
    JSON.stringify({ trip: packing?.linkedVacationId, cat: packing?.category })
  );
  expect(packing?.linkedVacationId).toBe(trip.id);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  expect((await listsOf(db)).find((l) => l.id === packing?.id)).toBeDefined(); // never discarded

  // ── 6. + Add a Plan → List opens the new-list sheet ───────────────────────────
  await page.getByRole('button', { name: /travel\.addAPlan|Add a Plan/ }).click();
  await page.getByTestId('add-plan-list').click();
  await newSheet.waitFor({ timeout: 5000 });
  await shot(page, '06-add-plan-list-light-phone');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await shotMatrix(page, '06b-trip-final', section);

  // ── 7. The activity drawer: Attach a List, and its blank still lands in Home ──
  await gotoRoute(page, `/activities?activity=${soccer.id}`);
  const drawerLists = () => page.getByRole('dialog').getByTestId('linked-lists');
  await drawerLists().waitFor({ timeout: 15000 });
  await shotMatrix(page, '07-activity-empty', drawerLists);
  await drawerLists().getByTestId('linked-lists-attach').click();
  const drawerAttach = page.getByRole('dialog').filter({ hasText: 'Weekend chores' }).last();
  await drawerAttach.waitFor({ timeout: 5000 });
  await shotMatrix(page, '07b-activity-attach-sheet');
  await drawerAttach.getByText('Weekend chores').click();
  await drawerAttach.getByRole('button', { name: 'Attach', exact: true }).click();
  await page.waitForTimeout(800);
  lists = await listsOf(db);
  expect(lists.find((l) => l.id === 'l-chores')?.linkedActivityId).toBe(soccer.id);
  await shotMatrix(page, '07c-activity-linked', drawerLists);

  await drawerLists().getByTestId('linked-lists-blank').click();
  await page.waitForTimeout(900);
  lists = await listsOf(db);
  const actBlank = lists.find((l) => l.linkedActivityId === soccer.id && l.id !== 'l-chores');
  expect(actBlank?.category).toBe('home');
});
