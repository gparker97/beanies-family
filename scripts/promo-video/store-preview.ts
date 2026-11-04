/**
 * Films the App Store preview footage of "the morning routine musical": the real
 * app, a synthetic family, one take, timed to the song so that every lyric is
 * answered on screen by the feature it is about.
 *
 *   npm run promo:store
 *
 * Output (NOT in the repo): ~/.cache/beanies-ad/store-capture/<take>/
 *   f000001.jpg ...   screenshots at device pixels, as fast as Chromium gives them
 *   frames.json       [[captureMs, file], ...]
 *   marks.json        [{ name, previewS, captureMs }, ...] — where each beat of
 *                     the preview timeline starts in the capture
 * The Drive compositor (`05-delivery/cuts/tools/compose.py`, layout `store916`)
 * maps preview time to capture time through the marks and draws the title band,
 * the lyric line and the end card around the footage.
 *
 * WHY A SCREENSHOT LOOP: Playwright's own video is capped at CSS-pixel size
 * (~392x726 for a phone), and so is `Page.startScreencast` in headless Chromium
 * (its frames came back 443x795 whatever maxWidth said, take t1). The store wants
 * 886x1920, so the take grabs `Page.captureScreenshot` with `clip.scale: 2` as
 * fast as Chromium hands them over (~20 to 30 fps), each stamped with its time,
 * and the compositor resamples that at 25 fps.
 *
 * Pacing: the schedule below mirrors the song map in the plan; each beat waits
 * out its own length so the capture runs in real time. Everything happens on one
 * page by tapping the bottom nav (see `record.ts` for why).
 */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { UIStringKey } from '../../src/services/translation/uiStrings';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import { mockRegistry } from '../../e2e/helpers/registry-mock';
import { installCursor, glideTo } from './cursor';
import { labelExact } from './labels';
import {
  buildStoreFamily,
  STORE_ACTIVITY_BASEBALL,
  STORE_LIST_LAST_ITEM,
  STORE_LIST_TITLE,
  STORE_TODO_ROOM,
} from './store-seed';
import { dismissCelebration, glideClick, mockPhotoCdn, openTab } from './take';

const FAMILY_NAME = 'The Bean Family';
const TAKE = process.env.STORE_TAKE ?? new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const OUT = path.join(os.homedir(), '.cache', 'beanies-ad', 'store-capture', TAKE);

/**
 * The preview timeline (seconds) each beat starts at. These are the song map's
 * left-hand column; the compositor's audio segments supply the music.
 */
const SCHEDULE: Array<[name: string, previewS: number]> = [
  ['nook', 0.0],
  ['planner', 1.6],
  ['baseball', 4.0],
  ['todos', 8.0],
  ['bills', 11.2],
  ['dinner', 12.4],
  ['nook2', 14.0],
  ['lists', 17.2],
  ['end', 23.2],
];

const marks: Array<{ name: string; previewS: number; captureMs: number }> = [];
let takeStart = 0;
let holdUntil = 0; // capture ms the current beat's window runs to

/**
 * One beat. `arrive` is the transition onto the beat's screen (a tab, a modal)
 * and runs `leadS` before the beat's preview time, so the footage of the tap and
 * fan-out closes the previous beat and the new screen lands on the lyric; the
 * mark is stamped when `arrive` resolves. `play` then runs inside the beat.
 */
async function beat(
  page: Page,
  name: string,
  leadS: number,
  arrive: () => Promise<void>,
  play: () => Promise<void> = async () => {}
): Promise<void> {
  const i = SCHEDULE.findIndex(([n]) => n === name);
  const [, previewS] = SCHEDULE[i]!;
  const next = SCHEDULE[i + 1]?.[1] ?? previewS;
  const wait = holdUntil - leadS * 1000 - (Date.now() - takeStart);
  if (wait > 0) await page.waitForTimeout(wait);
  await arrive();
  const captureMs = Date.now() - takeStart;
  marks.push({ name, previewS, captureMs });
  const late = captureMs - holdUntil;
  console.log(
    `  ${name.padEnd(9)} preview ${previewS.toFixed(1).padStart(5)}s  capture ${(captureMs / 1000).toFixed(2)}s${late > 150 && i > 0 ? `  (! arrived ${(late / 1000).toFixed(2)}s late)` : ''}`
  );
  holdUntil = captureMs + (next - previewS) * 1000;
  await play();
  const remaining = holdUntil - (Date.now() - takeStart);
  if (remaining < 0 && name !== 'end')
    console.warn(`    ! "${name}" overran by ${(-remaining / 1000).toFixed(2)}s`);
}

/** Quick glides: the beats are short and the pointer travel is not the content. */
const STEPS = 10;
const tab = (page: Page, tabKey: UIStringKey, cardKey?: UIStringKey) =>
  openTab(page, tabKey, OUT, cardKey, STEPS);
const letsGo = (page: Page) =>
  page.getByRole('button', { name: labelExact('celebration.letsGo') }).last();

/** The tick button of the to-do / list row whose text matches. */
function rowToggle(page: Page, text: string) {
  return page
    .locator('li, [role="listitem"], div')
    .filter({ hasText: new RegExp(`^\\s*${text}`, 'i') })
    .locator('button')
    .first();
}

async function tick(page: Page, text: string, what: string): Promise<boolean> {
  const row = page.getByText(text, { exact: false }).first();
  if (!(await row.isVisible().catch(() => false))) {
    console.warn(`  ! "${text}" not on screen — skipping ${what}`);
    return false;
  }
  const box = await row.boundingBox({ timeout: 1200 }).catch(() => null);
  if (!box) return false;
  // The tick control sits at the row's left edge, level with its text.
  const toggle = rowToggle(page, text);
  const tb = await toggle.boundingBox({ timeout: 1200 }).catch(() => null); // no match must not wait forever
  const x = tb ? tb.x + tb.width / 2 : box!.x - 18;
  const y = tb ? tb.y + tb.height / 2 : box!.y + box!.height / 2;
  await glideTo(page, x, y, STEPS);
  await page.waitForTimeout(120);
  await page.mouse.click(x, y);
  return true;
}

/** Let a celebration modal arrive (it animates in after the tick), then clear it. */
async function clearCelebration(page: Page): Promise<void> {
  await letsGo(page)
    .waitFor({ state: 'visible', timeout: 2500 })
    .catch(() => {});
  await dismissCelebration(page, OUT);
}

test('film the App Store preview', async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await installCursor(page);
  await mockRegistry(page);
  await mockPhotoCdn(page);

  // ---- Setup (not filmed) ----------------------------------------------------
  await page.goto('/');
  await bypassLoginIfNeeded(page, { familyName: FAMILY_NAME });
  const db = new IndexedDBHelper(page);
  const owner = (await db.exportData()).familyMembers[0];
  expect(owner, 'create-a-family flow should have made an owner').toBeTruthy();
  await db.seedData(buildStoreFamily(owner!.id));
  const seeded = await db.exportData();
  console.log(
    `seeded: ${seeded.familyMembers.map((m) => m.name).join(', ')} | ${seeded.activities.length} activities, ${seeded.todos.length} todos`
  );
  await page.waitForTimeout(1200);

  // ---- Capture loop ----------------------------------------------------------
  const frames: Array<[number, string]> = [];
  const pending: Promise<void>[] = [];
  const cdp = await page.context().newCDPSession(page);
  let rolling = true;
  takeStart = Date.now();
  const capture = (async () => {
    while (rolling) {
      const t0 = Date.now() - takeStart;
      const { data } = await cdp
        .send('Page.captureScreenshot', {
          format: 'jpeg',
          quality: 85,
          clip: { x: 0, y: 0, width: 443, height: 795, scale: 2 },
          optimizeForSpeed: true,
        })
        .catch(() => ({ data: '' }));
      if (!data) continue;
      const file = `f${String(frames.length + 1).padStart(6, '0')}.jpg`;
      frames.push([t0, file]);
      pending.push(fs.promises.writeFile(path.join(OUT, file), Buffer.from(data, 'base64')));
    }
  })();

  // ---- The take --------------------------------------------------------------
  await beat(
    page,
    'nook',
    0,
    async () => {},
    async () => {
      await glideTo(page, 220, 420);
    }
  );
  await beat(page, 'planner', 1.5, async () => {
    await tab(page, 'mobile.planning', 'nav.activities');
  });
  await beat(page, 'baseball', 0.6, async () => {
    const ev = page.getByText(STORE_ACTIVITY_BASEBALL, { exact: false }).first();
    if (!(await glideClick(page, ev, 'baseball', OUT, STEPS)))
      console.warn('  ! baseball activity not found');
  });
  // "did you clean your room?" ticks the first chore; the celebration that fires
  // answers "did you tidy your bed?" and is cleared on the way to the bills.
  await beat(
    page,
    'todos',
    1.6,
    async () => {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
      await tab(page, 'mobile.planning', 'nav.todo');
    },
    async () => {
      await page.waitForTimeout(250);
      await tick(page, STORE_TODO_ROOM, 'room');
    }
  );
  await beat(page, 'bills', 1.2, async () => {
    await clearCelebration(page);
    await tab(page, 'mobile.money', 'nav.transactions');
    const reveal = page.getByRole('button', { name: labelExact('nook.showFigures') }).first();
    if (await reveal.isVisible().catch(() => false))
      await reveal.click({ force: true }).catch(() => {});
    await page.mouse.wheel(0, 760);
  });
  await beat(page, 'dinner', 1.0, async () => {
    await tab(page, 'mobile.planning', 'nav.mealPlanner');
  });
  await beat(
    page,
    'nook2',
    0.6,
    async () => {
      await tab(page, 'mobile.nook');
    },
    async () => {
      await page.waitForTimeout(900);
      await page.mouse.wheel(0, 260);
    }
  );
  await beat(
    page,
    'lists',
    1.0,
    async () => {
      await tab(page, 'mobile.planning', 'nav.lists');
    },
    async () => {
      // The tile is an <article> whose whole face is one absolutely positioned button.
      const tile = page
        .locator('article')
        .filter({ hasText: STORE_LIST_TITLE })
        .locator('button.absolute.inset-0')
        .first();
      if (await glideClick(page, tile, 'school-bag', OUT, STEPS)) {
        await page.waitForTimeout(500);
        await tick(page, STORE_LIST_LAST_ITEM, 'last item');
      }
    }
  );
  await beat(page, 'end', 0, async () => {});
  await page.waitForTimeout(400);

  // ---- Persist ---------------------------------------------------------------
  rolling = false;
  await capture;
  await Promise.all(pending);
  fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify(frames));
  fs.writeFileSync(path.join(OUT, 'marks.json'), JSON.stringify(marks, null, 2));
  const span = frames.length ? (frames[frames.length - 1]![0] - frames[0]![0]) / 1000 : 0;
  console.log(
    `\ncapture: ${OUT}\n${frames.length} frames over ${span.toFixed(1)}s (${(frames.length / Math.max(span, 1)).toFixed(1)} fps avg)`
  );
  expect(frames.length).toBeGreaterThan(50);
});
