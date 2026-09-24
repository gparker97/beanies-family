import { test, expect } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot } from '../../e2e/helpers/navigation';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import type { Page } from '@playwright/test';

/**
 * NOT a test — the browser walk for "helpful hints in the daily briefing"
 * (plan docs/plans/2026-09-24-helpful-hints-in-the-daily-briefing.md). Lives
 * OUTSIDE `e2e/specs/` on purpose (see capture.ts). Run it deliberately:
 *   npx playwright test -c playwright.design.config.ts --grep "hint briefing"
 *
 * Seeds a birthday-party activity 2 days out assigned to the owner → the app's
 * own reconcile generates the hint → the Nook briefing shows it last, framed
 * "Helpful hint: …" → tap opens the to-do modal → tick completes it and it
 * leaves the briefing.
 */

const SHOTS = 'scratch-shots/hint-briefing';

async function shot(page: Page, name: string) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function setDark(page: Page, on: boolean) {
  await page.evaluate((dark) => {
    document.documentElement.classList.toggle('dark', dark);
  }, on);
}

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

test('hint briefing: shows, opens, completes', async ({ page }) => {
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    const text = m.text();
    if (/helpful-hints|hint completed|toggleComplete/.test(text)) console.log(`[page] ${text}`);
  });

  await gotoRoot(page);
  await bypassLoginIfNeeded(page);

  const db = new IndexedDBHelper(page);
  const before = await db.exportData();
  const owner = before.familyMembers.find((m) => m.role === 'owner') ?? before.familyMembers[0];
  expect(owner, 'the E2E pod must have a member').toBeTruthy();

  const eventDate = isoDaysFromNow(2);
  const now = new Date().toISOString();
  await db.seedData({
    activities: [
      {
        id: 'act-party',
        title: "Emma's birthday party",
        date: eventDate,
        startTime: '15:00',
        endTime: '17:00',
        recurrence: 'none',
        category: 'birthday',
        assigneeIds: [owner!.id],
        feeSchedule: 'none',
        reminderMinutes: 0,
        isActive: true,
        createdBy: owner!.id,
        createdAt: now,
        updatedAt: now,
      } as never,
    ],
  });

  // The app's reconcile generates the hint on its own tick; wait for the data.
  await expect
    .poll(
      async () =>
        (await db.exportData()).todos.filter((t) => (t as { hintType?: string }).hintType).length,
      { timeout: 30000, message: 'reconcile never generated the birthday-party-gift hint' }
    )
    .toBeGreaterThan(0);
  const hint = (await db.exportData()).todos.find((t) => (t as { hintType?: string }).hintType)!;
  console.log(`[data] hint generated: ${hint.title} (${(hint as { hintType?: string }).hintType})`);

  // Briefing (the orange status toast on the Nook).
  const toast = page.locator('.status-toast');
  await toast.waitFor({ state: 'visible', timeout: 15000 });
  const items = toast.locator('.critical-item');
  await expect.poll(() => items.count(), { timeout: 15000 }).toBeGreaterThan(0);

  const texts = await items.allInnerTexts();
  console.log(
    `[briefing] ${texts.length} item(s):\n  ${texts.map((t) => t.replace(/\s+/g, ' ').trim()).join('\n  ')}`
  );
  const hintIndex = texts.findIndex((t) => /helpful hint:/i.test(t));
  expect(hintIndex, 'the hint must be in the briefing').toBeGreaterThanOrEqual(0);
  expect(hintIndex, 'the hint must be the LAST item').toBe(texts.length - 1);
  expect(texts[hintIndex]).not.toMatch(/gentle reminder|was due/i);
  expect(texts[hintIndex]).toContain('🎉');

  await shot(page, '01-briefing-light-desktop');
  await setDark(page, true);
  await shot(page, '02-briefing-dark-desktop');
  await setDark(page, false);

  await page.setViewportSize({ width: 400, height: 860 });
  await toast.scrollIntoViewIfNeeded();
  await shot(page, '03-briefing-light-phone');
  await setDark(page, true);
  await shot(page, '04-briefing-dark-phone');
  await setDark(page, false);
  await page.setViewportSize({ width: 1280, height: 900 });

  // Tap → the to-do view/edit modal opens.
  const hintRow = items.nth(hintIndex);
  await hintRow.click();
  const dialog = page.locator('[role="dialog"]').last();
  await dialog.waitFor({ state: 'visible', timeout: 10000 });
  await expect(dialog).toContainText(hint.title.slice(0, 20));
  await shot(page, '05-hint-modal-open');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(async () => {
    // Fall back to the close control if Escape isn't bound.
    await dialog.getByRole('button').first().click();
  });

  // Tick → completes the hint (data), and it leaves the briefing.
  await hintRow.locator('button').first().click();
  await expect
    .poll(
      async () => {
        const t = (await db.exportData()).todos.find((x) => x.id === hint.id);
        return t?.completed === true;
      },
      { timeout: 15000, message: 'ticking the hint in the briefing did not complete it' }
    )
    .toBe(true);
  await expect
    .poll(async () => (await items.allInnerTexts()).some((t) => /helpful hint:/i.test(t)), {
      timeout: 15000,
    })
    .toBe(false);
  await shot(page, '06-after-tick');
  console.log('[data] hint completed via the briefing tick; gone from the briefing');
});
