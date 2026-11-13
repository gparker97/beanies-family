import { test, expect } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * NOT a test: the browser walk for the choreboard (tracker #146). Lives outside `e2e/specs/`
 * on purpose (see capture.ts). The `choreboard` flag is on in DEV. Run it deliberately:
 *   npx playwright test -c playwright.design.config.ts --grep "choreboard walk"
 * Output: scratch-shots/choreboard/ (gitignored).
 */

const OUT = path.join(process.cwd(), 'scratch-shots', 'choreboard');
const MAMA = 'walk-mama';
const PIP = 'walk-pip';
const JUNO = 'walk-juno';

async function setDark(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark);
  await page.waitForTimeout(300);
}

async function both(page: Page, name: string) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, `${name}-light.png`) });
  await setDark(page, true);
  await page.screenshot({ path: path.join(OUT, `${name}-dark.png`) });
  await setDark(page, false);
}

/** `gotoRoute` returns on load; pages paint a few seconds later. */
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

async function seedFamily(page: Page) {
  await gotoRoot(page);
  await bypassLoginIfNeeded(page, { familyName: 'The Bean Family' });
  const db = new IndexedDBHelper(page);
  const owner = (await db.exportData()).familyMembers[0]!;
  const now = new Date().toISOString();
  const bean = (
    id: string,
    name: string,
    color: string,
    gender: 'male' | 'female',
    ageGroup: 'adult' | 'child'
  ) =>
    ({
      id,
      name,
      color,
      gender,
      ageGroup,
      email: `${id}@thebeanfamily.example`,
      role: 'member',
      passwordHash: 'demo-seed-not-a-real-hash',
      createdAt: now,
      updatedAt: now,
    }) as never;
  await db.seedData({
    familyMembers: [
      { ...owner, name: 'Papa Bean', gender: 'male', ageGroup: 'adult' } as never,
      bean(MAMA, 'Mama Bean', '#E67E22', 'female', 'adult'),
      bean(PIP, 'Pip', '#10b981', 'male', 'child'),
      bean(JUNO, 'Juno', '#ec4899', 'female', 'child'),
    ],
  });
  return owner.id as string;
}

async function walk(page: Page, tag: string) {
  const say = (k: string, v: unknown) => console.log(`[walk:${tag}] ${k}:`, v);
  page.setDefaultTimeout(20000);
  // A school morning, so the Now block is Morning and has chores (the mockup's 7:42).
  await page.clock.install({ time: new Date('2026-11-13T07:42:00') });
  await seedFamily(page);

  // ── Empty state, then a starter set for the two kids (edited before creating) ──
  await gotoRoute(page, '/choreboard');
  await settled(page);
  await page.getByTestId('chore-home-empty').waitFor();
  await both(page, `${tag}-01-empty`);

  await page.getByTestId('chore-empty-starters').click();
  const sheet = page.getByTestId('chore-starter-sheet');
  await sheet.waitFor();
  await both(page, `${tag}-02a-add-sheet-empty`);
  // Preview a set, then add it: nothing lands in the list until the button is pressed.
  const chip = (key: string) =>
    sheet.locator(`[data-testid="chore-suggest-chip"][data-set="${key}"]`);
  await chip('school-morning').click();
  await sheet.getByTestId('chore-set-preview').waitFor();
  say(
    'rows before adding the previewed set (expect 0)',
    await sheet.getByTestId('chore-draft-row').count()
  );
  await both(page, `${tag}-02b-set-preview`);
  await sheet.getByTestId('chore-set-preview-add').click();
  await page.waitForTimeout(400);
  const rows = sheet.locator('[data-testid="chore-draft-row"]');
  say('rows after the first set', await rows.count());
  // A second set into the SAME list (the old sheet could not leave an edited set).
  await rows.first().getByTestId('chore-draft-title').fill('Make the bed nicely');
  await rows.first().getByTestId('chore-draft-title').press('Enter');
  await chip('bedtime').click();
  await sheet.getByTestId('chore-set-preview').waitFor();
  await sheet.getByTestId('chore-set-preview-add').click();
  await page.waitForTimeout(400);
  say('rows after a second set', await rows.count());
  say(
    'chips on',
    await sheet
      .locator('[data-testid="chore-suggest-chip"]')
      .evaluateAll((els) =>
        els.map((e) => `${e.getAttribute('data-set')}=${e.getAttribute('data-on')}`)
      )
  );
  // Remove one with its ✕, move one to another time, add one of our own with Enter.
  const before = await rows.count();
  await rows.last().getByTestId('chore-draft-remove').click();
  await page.waitForTimeout(200);
  say('rows after one ✕ (expect -1)', `${before} -> ${await rows.count()}`);
  await rows.nth(1).getByTestId('chore-draft-time').click();
  await sheet.getByTestId('chore-draft-time-choices').waitFor();
  await both(page, `${tag}-02c-time-chooser`);
  await sheet.getByTestId('chore-draft-time-choices').locator('[data-block="afternoon"]').click();
  await page.waitForTimeout(300);
  await sheet.locator('[data-testid="chore-add-row"][data-block="evening"]').click();
  await page.keyboard.type('Feed the fish');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  say(
    'draft list',
    await rows.evaluateAll((els) =>
      els.map(
        (e) =>
          `${e.getAttribute('data-block')}:${(e.querySelector('textarea') as HTMLTextAreaElement | null)?.value}`
      )
    )
  );
  // Close and reopen: the list is kept for this session.
  // Escape first drops the empty row Enter opened, then closes the sheet.
  for (let i = 0; i < 4 && (await sheet.isVisible()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  await sheet.waitFor({ state: 'hidden' });
  await page.getByTestId('chore-empty-starters').click();
  await sheet.waitFor();
  say('rows after close + reopen (expect the same)', await rows.count());
  say('add button', await page.getByTestId('chore-starter-add').innerText());
  await both(page, `${tag}-02-add-sheet-list`);
  await page.getByTestId('chore-starter-add').click();
  await sheet.waitFor({ state: 'hidden' });
  await page.waitForTimeout(700);

  const cards = page.locator('[data-testid="chore-bean-card"]');
  say('bean cards', await cards.count());
  say(
    'rows on home',
    await page
      .locator('[data-testid="chore-row"]')
      .evaluateAll((els) =>
        els.map(
          (e) => `${e.getAttribute('data-member-id')}:${(e.textContent ?? '').trim().slice(0, 24)}`
        )
      )
  );
  say(
    'blocks',
    await page
      .locator('[data-testid="chore-block"]')
      .evaluateAll((els) =>
        els.map(
          (e) =>
            `${e.getAttribute('data-block')}/${e.getAttribute('data-state')}/${e.getAttribute('data-now')}`
        )
      )
  );
  await both(page, `${tag}-03-home`);

  // ── A bean's day: tick through the open block ──
  await page
    .locator(`[data-testid="chore-bean-card"][data-member-id="${PIP}"]`)
    .getByTestId('chore-bean-open')
    .click();
  await page.getByTestId('chore-day-head').waitFor();
  await both(page, `${tag}-05-day`);

  // ── The bean's list editor: everything in one list, saved as you go ──
  await page.getByTestId('chore-day-edit').click();
  const editor = page.getByTestId('chore-bean-editor');
  await editor.waitFor();
  const erows = editor.getByTestId('chore-draft-row');
  const eBefore = await erows.count();
  await both(page, `${tag}-04a-bean-editor`);
  // Rename with Enter, move the time, set School Days off -> Weekends, remove one.
  const second = erows.nth(1);
  await second.getByTestId('chore-draft-title').fill('Brush teeth for two minutes');
  await second.getByTestId('chore-draft-title').press('Enter');
  await page.waitForTimeout(400);
  const lastRow = erows.last();
  const daysCtl = lastRow
    .locator('[data-testid="chore-draft-days-pick"], [data-testid="chore-draft-days"]')
    .first();
  await daysCtl.scrollIntoViewIfNeeded();
  await daysCtl.click();
  await editor.getByTestId('chore-draft-days-choices').waitFor();
  await both(page, `${tag}-04b-days-chooser`);
  await editor
    .locator('[data-testid="chore-draft-days-choices"] [data-mode="weekends"] button')
    .click();
  await page.waitForTimeout(400);
  await erows.nth(2).getByTestId('chore-draft-remove').click();
  await page.waitForTimeout(600);
  say('editor rows before / after one ✕', `${eBefore} -> ${await erows.count()}`);
  say(
    'parents switch present (child)',
    await editor.getByTestId('chore-bean-editor-notify-parents').count()
  );
  await editor.getByTestId('chore-bean-editor-notify-parents').scrollIntoViewIfNeeded();
  await both(page, `${tag}-04c-bean-editor-edited`);
  await page.getByTestId('chore-bean-editor-done').click();
  await editor.waitFor({ state: 'hidden' });
  await page.waitForTimeout(500);
  say(
    'day rows after editing',
    await page
      .locator('[data-testid="chore-row"]')
      .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim().slice(0, 30)))
  );
  const open = page.locator('[data-testid="chore-block"][data-state="open"]').first();
  const openBlock = await open.getAttribute('data-block');
  const ticks = open.getByTestId('chore-tick');
  const n = await ticks.count();
  say('open block / chores', `${openBlock} / ${n}`);
  for (let i = 0; i < n; i++) {
    await open.getByTestId('chore-tick').nth(i).click();
    await page.waitForTimeout(450);
    if (i === n - 1) {
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(OUT, `${tag}-06-celebration.png`) });
    }
  }
  await page.waitForTimeout(5200); // let the shower finish
  say('banner after finishing', await page.getByTestId('chore-done-banner').count());
  await both(page, `${tag}-07-all-done`);

  // Untick and re-tick: banner only, no second celebration.
  const banner = page.getByTestId('chore-done-banner').first();
  if (await banner.count()) {
    const action = banner.getByTestId('celebration-banner-action');
    if (await action.count()) await action.click();
    await page.waitForTimeout(400);
    const blk = page.locator(`[data-testid="chore-block"][data-block="${openBlock}"]`).first();
    const t = blk.getByTestId('chore-tick').first();
    if (await t.count()) {
      await t.click();
      await page.waitForTimeout(500);
      await t.click();
      await page.waitForTimeout(900);
      const shower = await page
        .locator('[data-testid*="celebration-shower"], .celebration-shower')
        .count();
      say('celebration elements on re-tick (expect 0)', shower);
      await page.screenshot({ path: path.join(OUT, `${tag}-08-retick.png`) });
    }
  }
  say('week row', await page.getByTestId('chore-week-row').count());

  // ── Home again: hours and copy ──
  await page.getByTestId('chore-day-back').click();
  await page.getByTestId('chore-open-hours').waitFor();
  await page.getByTestId('chore-open-hours').click();
  await page.getByTestId('chore-hours-modal').waitFor();
  await both(page, `${tag}-09-hours`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  say('week panel', await page.getByTestId('chore-week-panel').count());
  await page
    .getByTestId('chore-week-panel')
    .scrollIntoViewIfNeeded()
    .catch(() => {});
  await both(page, `${tag}-10-home-after`);

  // ── Nook briefing ──
  await gotoRoute(page, '/nook');
  await settled(page);
  const nook = await page.locator('body').innerText();
  say('nook mentions chores', /chore/i.test(nook));
  await both(page, `${tag}-11-nook`);

  // ── Beanie Lists: the redirect ──
  await gotoRoute(page, '/lists');
  await settled(page);
  await page
    .getByRole('button', { name: /new list/i })
    .first()
    .click();
  await page.waitForTimeout(600);
  await both(page, `${tag}-12-new-list-sheet`);
  const kidsRow = page.getByTestId('new-list-chores-row');
  say('kids row present', await kidsRow.count());
  if (await kidsRow.count()) {
    await kidsRow.click();
    await page.waitForTimeout(500);
    await both(page, `${tag}-13-redirect-confirm`);
    await page.getByTestId('chores-redirect-go').click();
    await page.waitForURL(/\/choreboard/);
    await page.getByTestId('chore-starter-sheet').waitFor();
    await page.waitForTimeout(500);
    say(
      'landed with the sheet; rows added by the redirect',
      await page.getByTestId('chore-draft-row').count()
    );
    await both(page, `${tag}-14-redirect-landing`);
    await page.keyboard.press('Escape');
  }
}

test.describe('choreboard walk', () => {
  test('choreboard walk desktop', async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
    await page.setViewportSize({ width: 1280, height: 900 });
    await walk(page, 'desk');

    // ── The wall, tablet landscape ──
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoRoute(page, '/wall');
    await settled(page);
    console.log('[walk:wall] cards:', {
      chores: await page.getByTestId('wall-card-chores').count(),
      lists: await page.getByTestId('wall-card-lists').count(),
    });
    await both(page, 'wall-01-home');
    const choresCard = page.getByTestId('wall-card-chores');
    if (await choresCard.count()) {
      await choresCard.first().click();
      await page.getByTestId('wall-chores-view').waitFor();
      console.log(
        '[walk:wall] lanes:',
        await page.locator('[data-testid="wall-chore-lane"]').count(),
        'blocks:',
        await page
          .locator('[data-testid="wall-chore-block"]')
          .evaluateAll((els) =>
            els.map((e) => `${e.getAttribute('data-block')}/${e.getAttribute('data-state')}`)
          )
      );
      await both(page, 'wall-02-chores');
      const tick = page.locator('[data-testid="wall-chore-lane"] .wall-tick-hit').first();
      if (await tick.count()) {
        await tick.click();
        await page.waitForTimeout(900);
        await page.screenshot({ path: path.join(OUT, 'wall-03-ticked-light.png') });
      }
    }
    expect(true).toBe(true);
  });

  test('choreboard walk phone', async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
    await page.setViewportSize({ width: 400, height: 860 });
    await walk(page, 'phone');
  });
});
