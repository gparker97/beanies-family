import { test, expect } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import type { Page } from '@playwright/test';

/**
 * NOT a test: the browser walk for "dismiss anything in the daily briefing"
 * (plan ~/projects/beanies-ops/docs/plans/2026-10-05-briefing-dismiss.md). Run it deliberately:
 *   npx playwright test -c playwright.design.config.ts --grep "briefing dismiss"
 *
 * Seeds a pickup duty today, a to-do due today and three hint sources (a party in 2
 * days, two anniversaries in 5 and 6 days). Then: tick the duty and ✕ it; ✕ the
 * to-do (it stays a to-do); ✕ the party hint (deleted, key recorded, NOT regenerated
 * after a reload); Dismiss one anniversary hint and Keep the other from the to-do
 * drawer. Light + dark, desktop + phone.
 */

const SHOTS = 'scratch-shots/briefing-dismiss';

async function shot(page: Page, name: string) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function setDark(page: Page, on: boolean) {
  await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), on);
}

function ymd(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type Hinted = { id: string; title: string; hintType?: string; hintKey?: string };

test('briefing dismiss: every row, hints stay gone', async ({ page }) => {
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    const text = m.text();
    if (
      /hint dismissed|briefing item dismissed|dismissed hint|persist|helpful-hints — reconcile/i.test(
        text
      )
    )
      console.log(`[page] ${text}`);
  });

  await gotoRoot(page);
  await bypassLoginIfNeeded(page);
  const db = new IndexedDBHelper(page);
  const owner = (await db.exportData()).familyMembers.find((m) => m.role === 'owner')!;
  expect(owner).toBeTruthy();
  const now = new Date().toISOString();
  const activity = (id: string, title: string, date: string, category: string, extra = {}) =>
    ({
      id,
      title,
      date,
      startTime: '15:00',
      endTime: '17:00',
      recurrence: 'none',
      category,
      assigneeIds: [owner.id],
      feeSchedule: 'none',
      reminderMinutes: 0,
      isActive: true,
      createdBy: owner.id,
      createdAt: now,
      updatedAt: now,
      ...extra,
    }) as never;

  await db.seedData({
    activities: [
      activity('act-swim', 'Swim class', ymd(0), 'swimming', { pickupMemberId: owner.id }),
      activity('act-party', "Emma's birthday party", ymd(2), 'birthday'),
      activity('act-anniv-a', 'Grandparents anniversary', ymd(5), 'anniversary'),
      activity('act-anniv-b', 'Our anniversary', ymd(6), 'anniversary'),
    ],
    todos: [
      {
        id: 'todo-forms',
        title: 'Sign the school forms',
        completed: false,
        dueDate: ymd(0),
        assigneeIds: [owner.id],
        createdBy: owner.id,
        createdAt: now,
        updatedAt: now,
      } as never,
    ],
  });

  const hints = async () => ((await db.exportData()).todos as Hinted[]).filter((t) => t.hintType);
  await expect
    .poll(async () => (await hints()).length, {
      timeout: 30000,
      message: 'reconcile never generated the three hints',
    })
    .toBe(3);
  const all = await hints();
  const party = all.find((h) => h.hintType === 'birthday-party-gift')!;
  const [annivA, annivB] = all.filter((h) => h.hintType === 'anniversary-plan');
  console.log(`[data] hints: ${all.map((h) => h.hintKey).join(', ')}`);

  const toast = page.locator('.status-toast');
  await toast.waitFor({ state: 'visible', timeout: 15000 });
  const items = toast.locator('.critical-item');
  const row = (re: RegExp) => items.filter({ hasText: re });
  const showAll = toast.getByRole('button', { name: /show all/i });
  if (await showAll.isVisible().catch(() => false)) await showAll.click();
  await expect(row(/swim class/i)).toHaveCount(1);
  await expect(row(/school forms/i)).toHaveCount(1);
  console.log(
    `[briefing] ${(await items.allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()).join(' | ')}`
  );
  expect(await toast.locator('[data-testid="briefing-dismiss"]').count()).toBe(await items.count());

  await shot(page, '01-briefing-light-desktop');
  await setDark(page, true);
  await shot(page, '02-briefing-dark-desktop');
  await setDark(page, false);
  await page.setViewportSize({ width: 390, height: 860 });
  await toast.scrollIntoViewIfNeeded();
  await shot(page, '03-briefing-light-phone');
  await setDark(page, true);
  await shot(page, '04-briefing-dark-phone');
  await setDark(page, false);
  await page.setViewportSize({ width: 1280, height: 900 });

  // 1. Duty: tick it (done, struck through), then ✕ it.
  await row(/swim class/i)
    .locator('button')
    .first()
    .click();
  await expect(row(/swim class/i)).toHaveClass(/opacity-50/);
  await shot(page, '05-duty-done');
  await row(/swim class/i)
    .getByTestId('briefing-dismiss')
    .click();
  await expect(row(/swim class/i)).toHaveCount(0);

  // 2. To-do: ✕ hides it from the briefing; the to-do itself is untouched.
  // The toast says it is still open; Undo brings the row back.
  const formsRow = () => row(/school forms/i);
  const toastBody = () => page.getByTestId('toast-body').filter({ hasText: /still open/i });
  await formsRow().getByTestId('briefing-dismiss').click();
  await expect(formsRow()).toHaveCount(0);
  expect((await db.exportData()).todos.some((t) => t.id === 'todo-forms')).toBe(true);
  await toastBody().waitFor({ state: 'visible', timeout: 5000 });
  await shot(page, '05b-hide-toast');
  await page
    .getByRole('button', { name: /^undo$/i })
    .last()
    .click();
  await expect(formsRow()).toHaveCount(1);
  console.log('[ui] hide toast: still-open copy shown; Undo restored the row');
  // Hide it again, then tap the toast: the to-do opens.
  await formsRow().getByTestId('briefing-dismiss').click();
  await expect(formsRow()).toHaveCount(0);
  await toastBody().click();
  const todoDrawer = page.locator('[role="dialog"]').last();
  await expect(todoDrawer).toContainText('Sign the school forms');
  await shot(page, '05c-toast-opened-todo');
  await page.keyboard.press('Escape');
  await todoDrawer.waitFor({ state: 'hidden', timeout: 10000 });
  await expect(formsRow()).toHaveCount(0);
  console.log('[ui] tapping the hide toast opened the to-do');

  // 3. Party hint: ✕ deletes it, records its key family-wide, and offers Undo.
  const partyRow = () => row(/helpful hint:.*party/i);
  await partyRow().getByTestId('briefing-dismiss').click();
  await expect(partyRow()).toHaveCount(0);
  const undo = page.getByRole('button', { name: /^undo$/i }).last();
  await undo.waitFor({ state: 'visible', timeout: 5000 });
  await shot(page, '06a-undo-toast');
  await undo.click();
  // Undo forgets the key and restores the same hint (same id).
  await expect(partyRow()).toHaveCount(1);
  await expect
    .poll(async () => {
      const d = await db.exportData();
      const keys = (d.settings as { dismissedHintKeys?: Record<string, string> })
        ?.dismissedHintKeys;
      return !keys?.[party.hintKey!] && d.todos.some((t) => t.id === party.id);
    })
    .toBe(true);
  await page.waitForTimeout(2500); // past the reconcile debounce: the restored hint must stay
  await expect(partyRow()).toHaveCount(1);
  expect((await hints()).filter((h) => h.hintKey === party.hintKey)).toHaveLength(1);
  console.log('[data] undo restored the party hint (same id), key forgotten, no duplicate');
  // Dismiss it again for the rest of the walk.
  await partyRow().getByTestId('briefing-dismiss').click();
  await expect(partyRow()).toHaveCount(0);
  await expect
    .poll(async () => {
      const d = await db.exportData();
      const keys = (d.settings as { dismissedHintKeys?: Record<string, string> })
        ?.dismissedHintKeys;
      return !!keys?.[party.hintKey!] && !d.todos.some((t) => t.id === party.id);
    })
    .toBe(true);
  await shot(page, '06-after-three-dismissals');

  // Reload: the hide keys persist, and the reconcile on mount must NOT regenerate the hint.
  // `gotoRoute` stages the live doc first; a bare reload would restore the seed snapshot.
  await gotoRoute(page, '/nook');
  await page.getByTestId('app-content').waitFor({ state: 'visible', timeout: 30000 });
  // Prove the doc survived the reload, so "nothing came back" is not an empty doc.
  await expect
    .poll(async () => {
      const d = await db.exportData();
      return [
        d.activities.some((a) => a.id === 'act-swim'),
        d.todos.some((t) => t.id === 'todo-forms'),
        (d.todos as Hinted[]).filter((t) => t.hintType).length,
      ];
    })
    .toEqual([true, true, 2]);
  await toast.waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(4000); // the reconcile is debounced; give it time to run
  if (await showAll.isVisible().catch(() => false)) await showAll.click();
  await expect(row(/swim class/i)).toHaveCount(0);
  await expect(row(/school forms/i)).toHaveCount(0);
  await expect(row(/helpful hint:.*party/i)).toHaveCount(0);
  expect((await hints()).some((h) => h.hintKey === party.hintKey)).toBe(false);
  console.log('[data] after reload: duty + to-do still hidden, party hint not regenerated');

  // 4. Drawer: Dismiss anniversary A, Keep anniversary B (from the to-do page).
  await gotoRoute(page, '/todo');
  await page.getByTestId('app-content').waitFor({ state: 'visible', timeout: 30000 });
  await page.getByText(annivA!.title).first().click();
  const drawer = page.locator('[role="dialog"]').last();
  await drawer.getByTestId('todo-drawer-hint-actions').waitFor({ state: 'visible' });
  await shot(page, '07-drawer-hint-light');
  await setDark(page, true);
  await shot(page, '08-drawer-hint-dark');
  await setDark(page, false);
  await drawer.getByTestId('todo-drawer-hint-dismiss').click();
  await expect.poll(async () => (await hints()).some((h) => h.id === annivA!.id)).toBe(false);

  await page.getByText(annivB!.title).first().click();
  const drawer2 = page.locator('[role="dialog"]').last();
  await drawer2.getByTestId('todo-drawer-hint-keep').click();
  await expect(drawer2.getByTestId('todo-drawer-hint-actions')).toHaveCount(0);
  await expect
    .poll(async () => {
      const b = (await db.exportData()).todos.find((t) => t.id === annivB!.id) as
        { hintAcknowledged?: boolean } | undefined;
      return b?.hintAcknowledged === true;
    })
    .toBe(true);
  await shot(page, '09-drawer-after-keep');

  const keys = Object.keys(
    ((await db.exportData()).settings as { dismissedHintKeys?: Record<string, string> })
      ?.dismissedHintKeys ?? {}
  );
  console.log(`[data] dismissedHintKeys: ${keys.join(', ')}`);
  expect(keys).toEqual(expect.arrayContaining([party.hintKey!, annivA!.hintKey!]));
});
