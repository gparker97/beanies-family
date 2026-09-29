import { test, expect } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import { ui } from '../../e2e/helpers/ui-strings';
import type { Page } from '@playwright/test';

/**
 * NOT a test: the browser walk for "Add To-do" + magic beans on the To-Dos page (plan
 * docs/plans/2026-09-29-todo-page-add-and-magic.md). Lives OUTSIDE `e2e/specs/` on purpose
 * (see capture.ts). Run it deliberately:
 *   npx playwright test -c playwright.design.config.ts --grep "todo add walk"
 *
 * Covers: the header (✨ + "+ Add To-do") at phone and desktop, light and dark; the sidebar
 * from the header button, filled and saved, then the new row's pulse; the quick-add sheet's
 * To-do tile opening the sidebar; ✨ opening the magic beans sheet with To-do pre-picked.
 */

const SHOTS = 'screenshots/todo-add';
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const TOMORROW = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d;
})();

async function shot(page: Page, name: string, wait = 450) {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function setDark(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark);
  await page.waitForTimeout(250);
}

/** Light + dark at phone and desktop, leaving the page at phone/light. */
async function shotMatrix(page: Page, name: string) {
  for (const [vp, vpName] of [
    [PHONE, 'phone'],
    [DESKTOP, 'desktop'],
  ] as const) {
    await page.setViewportSize(vp);
    for (const dark of [false, true]) {
      await setDark(page, dark);
      await shot(page, `${name}-${dark ? 'dark' : 'light'}-${vpName}`);
    }
  }
  await setDark(page, false);
  await page.setViewportSize(PHONE);
}

const sidebarOf = (page: Page) => page.getByRole('dialog').filter({ hasText: ui('todo.newTask') });

test('todo add walk', async ({ page }) => {
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    const txt = m.text();
    if (
      (m.type() === 'error' && !txt.includes('Failed to load resource')) ||
      /todo-create/.test(txt)
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
  const bean = (id: string, name: string, color: string, ageGroup: 'adult' | 'child') =>
    ({
      id,
      name,
      color,
      ageGroup,
      email: `${id}@example.test`,
      role: 'member',
      createdAt: now,
      updatedAt: now,
    }) as never;
  // Enough to-dos that a new one lands below the fold on a phone, so the reveal has to scroll.
  const filler = Array.from({ length: 12 }, (_, i) => ({
    id: `e2e-filler-${i}`,
    title: `Existing chore ${i + 1}`,
    completed: false,
    createdBy: owner.id,
    dueDate: ymd(new Date(Date.now() - (12 - i) * 86_400_000 + 86_400_000 * 14)),
    createdAt: now,
    updatedAt: now,
  }));
  await db.seedData({
    familyMembers: [
      owner,
      bean('e2e-sofia', 'Sofia', '#ec4899', 'adult'),
      bean('e2e-mia', 'Mia', '#10b981', 'child'),
    ],
    todos: filler as never,
    settings: {
      ...(before.settings as object),
      aiTier: 'byok',
      aiProvider: 'openai',
      aiApiKeys: { openai: 'sk-test-todo-add' },
    } as never,
  });

  // ── 1. Header ────────────────────────────────────────────────────────────────
  await gotoRoute(page, '/todo');
  await page.getByTestId('app-content').waitFor();
  const addBtn = page.getByRole('button', { name: ui('todo.addTodo') });
  const magicBtn = page.getByRole('button', { name: ui('ai.magic.perform') });
  await expect(addBtn).toBeVisible();
  await expect(magicBtn).toBeVisible();
  await shotMatrix(page, '01-header');

  // Activities header for side-by-side comparison.
  await gotoRoute(page, '/activities');
  await page.getByTestId('app-content').waitFor();
  await shot(page, '01b-activities-header-light-phone', 900);
  await page.setViewportSize(DESKTOP);
  await shot(page, '01b-activities-header-light-desktop', 900);
  await page.setViewportSize(PHONE);

  // ── 2. + Add To-do → sidebar → save → pulse ─────────────────────────────────
  await gotoRoute(page, '/todo');
  await page.getByTestId('app-content').waitFor();
  await addBtn.click();
  const sidebar = sidebarOf(page);
  await sidebar.waitFor();
  await shot(page, '02-sidebar-empty-light-phone');
  await setDark(page, true);
  await shot(page, '02-sidebar-empty-dark-phone');
  await setDark(page, false);

  // Save with no title: not-ready, marks the field.
  await sidebar.getByRole('button', { name: ui('todo.addTodo') }).click();
  await shot(page, '02b-sidebar-missing-title-light-phone', 700);

  await sidebar.getByPlaceholder(ui('todo.quickAddPlaceholder')).fill('Book the dentist for Mia');
  await sidebar
    .locator('textarea')
    .fill('Ask about the Saturday slots https://dentist.example.org');
  await sidebar.getByRole('button', { name: 'Mia' }).first().click();
  // Time is offered only once there is a date.
  await expect(sidebar.getByTestId('time-preset-picker-trigger')).toHaveCount(0);
  await sidebar.getByTestId('beanie-date-picker-trigger').click();
  await page.waitForTimeout(300);
  await shot(page, '02c-date-picker-open-light-phone');
  await page
    .getByRole('button', { name: ui('date.tomorrow'), exact: true })
    .first()
    .click();
  await page.waitForTimeout(300);
  const timeTrigger = sidebar.getByTestId('time-preset-picker-trigger');
  await timeTrigger.waitFor({ timeout: 5000 });
  await timeTrigger.click();
  await page
    .getByRole('button', { name: /9:30 AM|09:30/ })
    .first()
    .click();
  await page.waitForTimeout(300);
  await sidebar
    .getByRole('heading')
    .first()
    .click()
    .catch(() => {});
  await shot(page, '02d-sidebar-filled-light-phone');
  await setDark(page, true);
  await shot(page, '02d-sidebar-filled-dark-phone');
  await setDark(page, false);
  await page.setViewportSize(DESKTOP);
  await shot(page, '02d-sidebar-filled-light-desktop');
  await setDark(page, true);
  await shot(page, '02d-sidebar-filled-dark-desktop');
  await setDark(page, false);
  await page.setViewportSize(PHONE);

  await sidebar.getByRole('button', { name: ui('todo.addTodo') }).click();
  await expect(sidebar).toBeHidden({ timeout: 10000 });
  const row = page.locator('[data-todo-id]').filter({ hasText: 'Book the dentist for Mia' });
  await row.waitFor();
  // Mid-pulse: the reveal scrolls (≈400ms) then rings for two beats.
  await page.waitForTimeout(650);
  const ringing = await row.evaluate((el) => el.classList.contains('attention-ring'));
  console.log('[2] row has attention-ring mid-pulse:', ringing);
  await page.screenshot({ path: `${SHOTS}/03-new-row-pulse-light-phone.png` });
  const inView = await row.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight;
  });
  console.log('[2] new row in view:', inView);

  const data = await db.exportData();
  const saved = data.todos.find((t) => t.title === 'Book the dentist for Mia');
  console.log(
    '[2] saved:',
    JSON.stringify(
      saved && {
        due: saved.dueDate,
        time: saved.dueTime,
        who: (saved as { assigneeIds?: string[] }).assigneeIds,
        desc: saved.description,
        by: saved.createdBy,
      }
    )
  );
  expect(saved?.dueDate).toBe(ymd(TOMORROW));
  expect(saved?.dueTime).toBe('09:30');

  // Pulse in dark, via the quick-add bar (also pulses).
  await setDark(page, true);
  await page.getByPlaceholder(ui('todo.quickAddPlaceholder')).first().fill('Water the plants');
  await page.keyboard.press('Enter');
  const row2 = page.locator('[data-todo-id]').filter({ hasText: 'Water the plants' });
  await row2.waitFor();
  await page.waitForTimeout(650);
  console.log(
    '[2] quick-bar row ringing:',
    await row2.evaluate((el) => el.classList.contains('attention-ring'))
  );
  await page.screenshot({ path: `${SHOTS}/03b-quick-bar-row-pulse-dark-phone.png` });
  await setDark(page, false);

  // ── 3. Quick-add sheet To-do tile → sidebar ─────────────────────────────────
  await gotoRoute(page, '/');
  await page.getByTestId('app-content').waitFor();
  await page.getByRole('button', { name: 'Quick add' }).click({ force: true });
  const sheet = page.getByTestId('quick-add-sheet');
  await sheet.waitFor();
  await page.waitForTimeout(400);
  await sheet
    .getByRole('button', { name: new RegExp(ui('quickAdd.todo.label')) })
    .first()
    .click();
  await page.waitForURL(/\/todo/);
  await sidebar.waitFor({ timeout: 10000 });
  console.log('[3] sidebar open from the tile:', await sidebar.isVisible());
  await shot(page, '04-tile-opens-sidebar-light-phone');

  // ── 4. The sidebar's quick card and the header ✨ ────────────────────────────
  const group = page.locator(`[role="group"][aria-label="${ui('ai.capture.pick.title')}"]`);
  await sidebar.getByText(ui('todo.magicHint')).click();
  await group.waitFor({ timeout: 10000 });
  console.log(
    '[4] quick card pre-picked kind:',
    (await group.locator('button[aria-pressed="true"]').innerText()).replace(/\s+/g, ' ').trim()
  );
  await shot(page, '04b-quick-card-sheet-over-sidebar-light-phone');
  await page.keyboard.press('Escape');
  await group.waitFor({ state: 'hidden', timeout: 5000 });
  await page.keyboard.press('Escape');
  await expect(sidebar).toBeHidden({ timeout: 5000 });
  await magicBtn.click();
  await group.waitFor({ timeout: 10000 });
  const pressed = await group.locator('button[aria-pressed="true"]').innerText();
  console.log('[4] pre-picked kind:', pressed.replace(/\s+/g, ' ').trim());
  await shot(page, '05-magic-sheet-todo-picked-light-phone');
  await setDark(page, true);
  await shot(page, '05-magic-sheet-todo-picked-dark-phone');
  await setDark(page, false);
});
