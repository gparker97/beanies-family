import { test, expect } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import type { Page } from '@playwright/test';
import type { FamilyList } from '../../src/types/models';

/**
 * NOT a test: the browser walk for "repeating lists are due today on the day they reset"
 * (plan ~/projects/beanies-ops/docs/plans/2026-10-28-repeating-lists-due-on-reset-day.md).
 * Lives OUTSIDE `e2e/specs/` on purpose (see capture.ts). Run it deliberately:
 *   npx playwright test -c playwright.design.config.ts --grep "recurring list reset day"
 *
 * Seeds three repeating lists (reset today with open items; reset today but all ticked;
 * reset yesterday) plus a one-off due today as the control, then checks the Nook briefing
 * shows exactly the right ones and shoots light + dark at phone + desktop.
 */

const SHOTS = 'screenshots/recurring-list-reset-day';
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const TODAY = ymd(new Date());
const YESTERDAY = ymd(new Date(Date.now() - 86400000));
/** Local noon as an ISO timestamp, so `extractDatePart` lands on the same calendar day in any zone. */
const localNoon = (day: string) => new Date(`${day}T12:00:00`).toISOString();

async function setDark(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark);
  await page.waitForTimeout(250);
}
async function shotMatrix(page: Page, name: string) {
  for (const [vp, vpName] of [
    [PHONE, 'phone'],
    [DESKTOP, 'desktop'],
  ] as const) {
    await page.setViewportSize(vp);
    for (const dark of [false, true]) {
      await setDark(page, dark);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/${name}-${dark ? 'dark' : 'light'}-${vpName}.png` });
    }
  }
  await setDark(page, false);
  await page.setViewportSize(DESKTOP);
}

test('recurring list reset day walk', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await gotoRoot(page);
  await bypassLoginIfNeeded(page);
  const db = new IndexedDBHelper(page);
  const before = await db.exportData();
  const owner = before.familyMembers[0]!;
  const now = new Date().toISOString();

  const list = (over: Partial<FamilyList>): FamilyList =>
    ({
      emoji: '🧹',
      category: 'home',
      ownerId: owner.id,
      completed: false,
      createdBy: owner.id,
      createdAt: now,
      updatedAt: now,
      items: [],
      ...over,
    }) as FamilyList;

  await db.seedData({
    ...({
      lists: [
        list({
          id: 'l-reset-today',
          title: 'Reset Routine',
          lifecycle: 'recurring',
          cadence: { unit: 'day', interval: 2 },
          lastResetDate: TODAY,
          createdAt: localNoon(TODAY),
          items: [
            { id: 'r1', title: 'Water plants', completed: false },
            { id: 'r2', title: 'Empty trash', completed: true },
            { id: 'r3', title: 'Wipe counters', completed: false },
          ],
        }),
        list({
          id: 'l-reset-done',
          title: 'All Ticked Routine',
          lifecycle: 'recurring',
          frequency: 'daily',
          lastResetDate: TODAY,
          createdAt: localNoon(TODAY),
          items: [{ id: 'd1', title: 'Feed cat', completed: true }],
        }),
        list({
          id: 'l-between',
          title: 'Between Rounds',
          lifecycle: 'recurring',
          cadence: { unit: 'day', interval: 2 },
          lastResetDate: YESTERDAY,
          createdAt: localNoon(YESTERDAY),
          items: [{ id: 'b1', title: 'Sweep porch', completed: false }],
        }),
        list({
          id: 'l-oneoff',
          title: 'Party Prep',
          emoji: '🎈',
          lifecycle: 'oneoff',
          dueDate: TODAY,
          items: [{ id: 'o1', title: 'Balloons', completed: false }],
        }),
      ],
    } as object),
  });

  await gotoRoute(page, '/nook');
  const toast = page.locator('.status-toast');
  await toast.waitFor({ timeout: 20000 });
  // The heading paints before the seeded lists project into the briefing rows; wait for a row.
  await toast.locator('.critical-item').first().waitFor({ timeout: 20000 });
  // Show every briefing row if the list is capped.
  const showAll = toast.getByRole('button', { name: /show all|all \d+/i });
  if (await showAll.isVisible().catch(() => false)) await showAll.click();
  const text = (await toast.innerText()).replace(/\s+/g, ' ');
  console.log('[briefing]', text);

  expect(text, 'reset-today list is on the plate').toMatch(/Reset Routine/);
  expect(text, 'reset-today list reads as due today').toMatch(/Reset Routine[^.]*due today/i);
  expect(text, 'one-off control is on the plate').toMatch(/Party Prep/);
  expect(text, 'all-ticked reset list is hidden').not.toMatch(/All Ticked Routine/);
  expect(text, 'between-rounds list is hidden').not.toMatch(/Between Rounds/);
  expect(text, 'nothing is labelled overdue for the repeating list').not.toMatch(
    /Reset Routine[^.]*overdue/i
  );

  await shotMatrix(page, 'nook-briefing');

  // Lists page: the due-soon shelf and the tile chip.
  await gotoRoute(page, '/lists');
  await page.waitForTimeout(800);
  const listsText = (
    await page
      .locator('main')
      .innerText()
      .catch(() => '')
  ).replace(/\s+/g, ' ');
  console.log('[lists page]', listsText.slice(0, 600));
  await shotMatrix(page, 'lists-page');
});
