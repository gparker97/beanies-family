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
 * ⚠️ WIP (2026-07-09). The seed + nook render correctly (verified on camera:
 * "welcome to your nook, John Bean", Wolf camp on the schedule, 3 to-dos). The
 * last run hit the 300s test ceiling somewhere in the fan-out navigation, which
 * is why the config timeout is now 600s. NEXT: run this and read the per-beat
 * console marks to find which tapTab() stalls — most likely a card label that
 * doesn't match (`our activities` / `to-dos` / `overview` / `meet the beans`
 * are guesses at the beanie-mode strings; the plain-`en` values differ). Resolve
 * them from src/constants/navigation.ts CATEGORY_META + NAV_ITEMS labelKeys via
 * the e2e `ui()` helper rather than hardcoding, then the compositing step
 * (ffmpeg → phone frame → 1920x1080 H.264) still has to be written.
 */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import { mockRegistry } from '../../e2e/helpers/registry-mock';
import { installCursor, glideTo } from './cursor';
import { buildDemoFamily } from './seed';

const OUT = path.join(process.cwd(), 'scripts', 'promo-video', '.out');
const beats: Array<{ name: string; atMs: number }> = [];
let pageOpenedAt = 0;

const mark = (name: string) => {
  const atMs = Date.now() - pageOpenedAt;
  beats.push({ name, atMs });
  console.log(`  ${name.padEnd(14)} @ ${(atMs / 1000).toFixed(2)}s`);
};

/** Glide onto a locator's centre and click. Returns false if it isn't there. */
async function glideClick(page: Page, target: ReturnType<Page['locator']>): Promise<boolean> {
  const box = await target.boundingBox().catch(() => null);
  if (!box) return false;
  await glideTo(page, box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(240);
  await target.click();
  return true;
}

/**
 * Tap a bottom-nav tab. `nook` and `calendar` route directly; `planning`,
 * `money` and `pod` are accordions that fan out side-cards behind a
 * full-screen close-menu overlay — so those need a second click on the card.
 * Labels come from t(): lower-case in beanie mode, Title Case in plain en,
 * hence the case-insensitive match.
 */
async function tapTab(page: Page, label: string, name: string, dwellMs: number, card?: string) {
  const tab = page.getByLabel(new RegExp(`^${label}$`, 'i')).last();
  if (!(await glideClick(page, tab))) {
    console.warn(`  ! tab "${label}" not found — skipping`);
    return;
  }
  if (card) {
    const target = page.getByText(new RegExp(`^${card}$`, 'i')).last();
    await target.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    if (!(await glideClick(page, target))) {
      console.warn(`  ! card "${card}" not found under "${label}" — skipping`);
      return;
    }
  }
  await page.getByTestId('app-content').waitFor({ state: 'visible', timeout: 20000 });
  mark(name);
  await page.waitForTimeout(dwellMs);
}

test('record promo footage', async ({ page }) => {
  pageOpenedAt = Date.now();
  await installCursor(page);
  await mockRegistry(page);

  // ---- Setup (trimmed off the front in post) -------------------------------
  await page.goto('/');
  await bypassLoginIfNeeded(page);

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

  await tapTab(page, 'planning', 'planner', 3400, 'our activities');

  await tapTab(page, 'planning', 'todos', 1600, 'to-dos');

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
      await page.waitForTimeout(2400); // let the celebration play
    }
  } else {
    console.warn('  ! no to-do toggle visible — skipping the tick beat');
  }

  await tapTab(page, 'money', 'money', 3200, 'overview');
  await tapTab(page, 'your pod', 'beans', 3200, 'meet the beans');
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
