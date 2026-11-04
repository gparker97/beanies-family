/**
 * Records the raw promo footage against the REAL app, with a synthetic family.
 *
 *   npx playwright test -c playwright.video.config.ts
 *
 * Output: scripts/promo-video/.out/raw.webm + beats.json (cut points, ms from
 * video start — `trimStartMs` marks where the take begins and the off-camera
 * setup ends).
 *
 * TWO CONSTRAINTS SHAPE THIS SCRIPT:
 *
 * 1. Everything happens on ONE page. A memory-provider family survives a reload
 *    only via the `__e2eSeedDoc` sessionStorage snapshot (see dataBridge
 *    `stageSnapshot`), and sessionStorage is per-tab — so a second page opens to
 *    an empty family.
 * 2. Navigation is by CLICKING the bottom tab bar, never `page.goto`. A full-page
 *    nav would reload and depend on that same snapshot dance. Clicking is also
 *    the better footage: it shows a person using the app.
 *
 * Beats are STRAWMAN — the narrative is greg's to write. Each is guarded so a
 * missing selector logs and skips instead of throwing away the whole take.
 *
 * FIXED (2026-07-10) — what stalled the first take:
 *   The fan-out cards are matched by their rendered label. `nav.overview` renders
 *   as "finance corner" in beanie mode (the app's default), NOT "overview". The
 *   card was never found, so the stack's full-screen close-menu overlay stayed
 *   OPEN, and the next tab click was intercepted by it — blocking until the test
 *   ceiling. Two fixes: labels now come from the string table via `labelExact` /
 *   `labelLoose` (matching either the `en` or `beanie` variant, so the take works
 *   in both modes), and a card miss now DISMISSES the overlay before returning so
 *   one bad beat can't poison the rest of the take. Clicks are bounded so a block
 *   fails fast and loudly instead of eating the whole run.
 *
 * Compositing lives in `compose.sh` (trim + centre on a brand canvas + H.264).
 * Full pipeline: `npm run promo:record && npm run promo:compose`.
 */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import type { UIStringKey } from '../../src/services/translation/uiStrings';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import { mockRegistry } from '../../e2e/helpers/registry-mock';
import { installCursor, glideTo } from './cursor';
import { buildDemoFamily } from './seed';
import { dismissCelebration as dismissCelebrationIn, openTab } from './take';

const DEMO_FAMILY_NAME = 'The Bean Family';
const OUT = path.join(process.cwd(), 'scripts', 'promo-video', '.out');
const beats: Array<{ name: string; atMs: number }> = [];
let pageOpenedAt = 0;

const mark = (name: string) => {
  const atMs = Date.now() - pageOpenedAt;
  beats.push({ name, atMs });
  console.log(`  ${name.padEnd(14)} @ ${(atMs / 1000).toFixed(2)}s`);
};

/** The shared dismisser, bound to this take's output folder. */
const dismissCelebration = (page: Page) => dismissCelebrationIn(page, OUT);

/** Tap a bottom-nav tab (and its fan-out card), mark the beat and dwell on it. */
async function tapTab(
  page: Page,
  tabKey: UIStringKey,
  name: string,
  dwellMs: number,
  cardKey?: UIStringKey
) {
  if (!(await openTab(page, tabKey, OUT, cardKey))) return;
  mark(name);
  await page.waitForTimeout(dwellMs);
}

test('record promo footage', async ({ page }) => {
  pageOpenedAt = Date.now();
  await installCursor(page);
  await mockRegistry(page);

  // ---- Setup (trimmed off the front in post) -------------------------------
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

  await page.waitForTimeout(800); // let the seeded nook settle before the take
  const trimStartMs = Date.now() - pageOpenedAt;
  console.log(`\n-- take starts at ${(trimStartMs / 1000).toFixed(2)}s --`);

  // ---- The take ------------------------------------------------------------
  mark('nook');
  await glideTo(page, 200, 300);
  await page.waitForTimeout(2800);

  await tapTab(page, 'mobile.planning', 'planner', 3400, 'nav.activities');

  await tapTab(page, 'mobile.planning', 'todos', 1600, 'nav.todo');

  // Tick a to-do. It's an unnamed <button>, not a checkbox role — hence the
  // class-based selector. Guarded.
  const toggle = page.locator('button.h-6.w-6').first();
  if (await toggle.isVisible().catch(() => false)) {
    const bb = await toggle.boundingBox();
    if (bb) {
      await glideTo(page, bb.x + bb.width / 2, bb.y + bb.height / 2);
      await page.waitForTimeout(300);
      await toggle.click();
      mark('todo-ticked');
      await page.waitForTimeout(2400); // let the celebration play — it's good footage
      if (await dismissCelebration(page)) mark('celebrate');
    }
  } else {
    console.warn('  ! no to-do toggle visible — skipping the tick beat');
  }

  // `nav.overview` renders as "finance corner" in beanie mode — resolving from the
  // key is what makes this beat work at all (the old hardcoded "overview" never matched).
  await tapTab(page, 'mobile.money', 'money', 3200, 'nav.overview');
  await tapTab(page, 'mobile.pod', 'beans', 3200, 'nav.pod.meetBeans');
  await page.waitForTimeout(600);

  // ---- Persist -------------------------------------------------------------
  const video = page.video();
  await page.close(); // video path only resolves once the page is closed
  const src = await video?.path();
  if (!src) throw new Error('no video captured — check `video: on` in playwright.video.config.ts');

  fs.mkdirSync(OUT, { recursive: true });
  fs.copyFileSync(src, path.join(OUT, 'raw.webm'));
  fs.writeFileSync(path.join(OUT, 'beats.json'), JSON.stringify({ trimStartMs, beats }, null, 2));
  console.log(`\nraw footage : ${path.join(OUT, 'raw.webm')}`);
  console.log(`beat marks  : ${path.join(OUT, 'beats.json')}`);
});
