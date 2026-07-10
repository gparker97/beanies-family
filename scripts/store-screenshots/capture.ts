/**
 * Captures Google Play / App Store listing screenshots against the REAL app,
 * with the same synthetic family the promo video uses.
 *
 *   npm run store:screenshots
 *
 * Output: scripts/store-screenshots/.out/NN-<name>.png at 1080x1920 (9:16).
 * These are LISTING ASSETS — they belong in Notion, never committed (CLAUDE.md
 * + docs/runbooks/native-store-submission.md). The `.out/` dir is git-ignored.
 *
 * Same two constraints as the promo recorder (see scripts/promo-video/record.ts):
 * everything happens on ONE page, and navigation CLICKS the bottom tab bar rather
 * than `page.goto` — a memory-provider family only survives a reload via the
 * per-tab `__e2eSeedDoc` snapshot.
 *
 * Unlike the promo take, a missing screen is a hard failure: a store submission
 * with a silently-absent screenshot is worse than a red run.
 */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import type { UIStringKey } from '../../src/services/translation/uiStrings';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import { mockRegistry } from '../../e2e/helpers/registry-mock';
import { labelExact, labelLoose } from '../promo-video/labels';
import { buildDemoFamily } from '../promo-video/seed';

const DEMO_FAMILY_NAME = 'The Bean Family';
const OUT = path.join(process.cwd(), 'scripts', 'store-screenshots', '.out');
const CLICK_TIMEOUT = 5000;
let shotNo = 0;

/**
 * Reveal financial figures. `usePrivacyMode` starts LOCKED on every load and is
 * never persisted, so figures render as `***` and the net-worth hero chart is
 * blurred — useless for a store listing. `isUnlocked` is a shared module ref, so
 * clicking any one "show figures" prompt reveals them everywhere for the session.
 * Idempotent: once unlocked the button unmounts and this no-ops.
 */
async function revealFigures(page: Page): Promise<void> {
  const btn = page.getByRole('button', { name: labelExact('nook.showFigures') }).first();
  if (!(await btn.isVisible().catch(() => false))) return;
  await btn.click({ timeout: CLICK_TIMEOUT });
  await page.waitForTimeout(500); // let the blur lift and the chart paint
}

/**
 * Let the route settle, then capture the phone screen (not fullPage).
 *
 * `resetScroll` defaults to true — most routes open mid-list otherwise and a
 * sliced card reads as a bug. Pass false for routes that position themselves
 * deliberately (the planner scrolls "today" into view; resetting it lands the
 * shot on last week, all "nothing planned").
 */
async function shot(
  page: Page,
  name: string,
  opts: { resetScroll?: boolean; nudgeUpPx?: number } = {}
): Promise<void> {
  const { resetScroll = true, nudgeUpPx = 0 } = opts;
  await page.getByTestId('app-content').waitFor({ state: 'visible', timeout: 20000 });
  await revealFigures(page); // no-op once unlocked; the prompt only mounts on money surfaces
  await page.waitForTimeout(900); // settle: images, avatars, chart paint
  if (resetScroll) {
    // After settling, not before — a route that self-scrolls on mount would undo an
    // earlier reset. The scroller isn't always `app-content` (routes nest their own).
    await page.evaluate(() => {
      document.querySelectorAll('*').forEach((el) => {
        if (el.scrollTop > 0) el.scrollTop = 0;
      });
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(350);
  } else if (nudgeUpPx > 0) {
    // Keep the route's own positioning (e.g. the planner scrolling "today" into
    // view) but back it off so the sticky toolbar doesn't slice the first card.
    await page.evaluate((n) => {
      document.querySelectorAll('*').forEach((el) => {
        if (el.scrollTop > 0) el.scrollTop = Math.max(0, el.scrollTop - n);
      });
    }, nudgeUpPx);
    await page.waitForTimeout(300);
  }
  const file = path.join(OUT, `${String(++shotNo).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  ✓ ${path.basename(file)}`);
}

/** Close the bean-stack overlay if a card click left it open. */
async function dismissStack(page: Page): Promise<void> {
  const closer = page.getByLabel(labelExact('mobile.closeMenu')).last();
  if (await closer.isVisible().catch(() => false)) {
    await closer.click({ timeout: CLICK_TIMEOUT }).catch(() => {});
  } else {
    await page.keyboard.press('Escape').catch(() => {});
  }
  await page.waitForTimeout(250);
}

/**
 * Click a bottom-nav tab, and (for the fan-out categories) the side-card behind
 * it. Labels resolve from the string table and match the `en` or `beanie`
 * rendering. Throws on a miss — see the file header.
 */
async function goTab(page: Page, tabKey: UIStringKey, cardKey?: UIStringKey): Promise<void> {
  const tab = page.getByLabel(labelExact(tabKey)).last();
  await expect(tab, `bottom-nav tab "${tabKey}" should exist`).toBeVisible({ timeout: 10000 });
  await tab.click({ timeout: CLICK_TIMEOUT });

  if (cardKey) {
    const card = page
      .getByRole('menuitem')
      .filter({ hasText: labelLoose(cardKey) })
      .last();
    try {
      await expect(card, `fan-out card "${cardKey}" under "${tabKey}"`).toBeVisible({
        timeout: 5000,
      });
      await card.click({ timeout: CLICK_TIMEOUT });
    } catch (err) {
      await dismissStack(page); // don't poison the next navigation
      throw err;
    }
  }
}

// A privacy/encryption screen was tried here (hamburger -> settings -> "family
// data" card) and cut: the demo family runs on the DEV in-memory provider, so the
// drawer renders its UNCONFIGURED state ("save your data to a file", "resume
// setup") rather than the Family Key / "end-to-end encrypted" card. That reads as
// a setup nag. The promo's privacy beat is a designed statement scene instead
// (see promo/Promo.tsx), using the app's own privacy copy.

test('capture store screenshots', async ({ page }) => {
  await mockRegistry(page);
  await page.goto('/');
  await bypassLoginIfNeeded(page, { familyName: DEMO_FAMILY_NAME });

  const db = new IndexedDBHelper(page);
  const pre = await db.exportData();
  const owner = pre.familyMembers[0];
  expect(owner, 'create-a-family flow should have made an owner').toBeTruthy();

  await db.seedData(buildDemoFamily(owner.id));
  const seeded = await db.exportData();
  expect(seeded.familyMembers).toHaveLength(3);
  console.log(
    `seeded: ${seeded.familyMembers.map((m) => m.name).join(', ')} | ` +
      `${seeded.accounts.length} accounts, ${seeded.transactions.length} txns, ` +
      `${seeded.activities.length} activities, ${seeded.todos.length} todos`
  );

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(800);

  // Order is the listing order — the first two carry the most weight on Play.
  //
  // Deliberately FIVE screens (Play allows 2–8). Two were tried and cut:
  //  - the `calendar` bottom tab routes to /activities, the same page as the
  //    planning→"activities" card, so it was a duplicate;
  //  - Transactions opens on a wall of filter chrome with the list below the fold.
  await shot(page, 'nook');

  // Month agenda (the default view). The week and day views are hour timelines that
  // auto-scroll to an empty evening; only the agenda actually shows the events. It
  // self-scrolls to today, so keep that position and just back it off the sticky
  // toolbar — resetting to the top lands on last week, all "nothing planned".
  await goTab(page, 'mobile.planning', 'nav.activities');
  await shot(page, 'planner', { resetScroll: false, nudgeUpPx: 130 });

  await goTab(page, 'mobile.planning', 'nav.todo');
  await shot(page, 'todos');

  await goTab(page, 'mobile.money', 'nav.overview');
  await shot(page, 'money');

  await goTab(page, 'mobile.pod', 'nav.pod.meetBeans');
  await shot(page, 'meet-the-beans');

  console.log(`\n${shotNo} screenshots -> ${OUT}`);
  expect(shotNo, 'Play requires at least 2 phone screenshots').toBeGreaterThanOrEqual(2);
});
