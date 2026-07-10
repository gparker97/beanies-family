/**
 * Captures Google Play listing screenshots against the REAL app, with the same
 * synthetic family the promo video uses.
 *
 *   npm run store:screenshots                       # all four form factors
 *   npx playwright test -c playwright.screenshots.config.ts --project=phone
 *
 * Output: scripts/store-screenshots/.out/<profile>/NN-<name>.png
 * These are LISTING ASSETS — they belong in Notion, never committed (CLAUDE.md
 * + docs/runbooks/native-store-submission.md). The `.out/` dir is git-ignored.
 *
 * THREE CONSTRAINTS SHAPE THIS SCRIPT:
 *
 * 1. Everything happens on ONE page. A memory-provider family survives a reload
 *    only via the `__e2eSeedDoc` sessionStorage snapshot (see dataBridge
 *    `stageSnapshot`), and sessionStorage is per-tab — a second page opens to an
 *    empty family. So navigation CLICKS; it never `page.goto`s.
 * 2. Navigation differs by layout. `useBreakpoint` has three tiers; the profiles
 *    straddle two of them (see playwright.screenshots.config.ts). Below 768px CSS
 *    the app shows a bottom tab bar; at 1024px and up, a sidebar. `goTo()` branches.
 * 3. Photos are not stored in the app — `PhotoAttachment` holds only a Google
 *    Drive file id and the UI renders `lh3.googleusercontent.com/d/<id>`. We
 *    intercept that CDN and serve brand art from `public/`, so the app is
 *    untouched and unaware. See `mockPhotoCdn`.
 *
 * A missing screen is a HARD failure: a store submission with a silently-absent
 * or wrong screenshot is worse than a red run. Every navigation asserts it
 * arrived, and every shot asserts its own output dimensions.
 */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import type { UIStringKey } from '../../src/services/translation/uiStrings';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import { mockRegistry } from '../../e2e/helpers/registry-mock';
import { labelExact, labelLoose } from '../promo-video/labels';
import { buildDemoFamily, DEMO_PHOTO_FILES } from '../promo-video/seed';
import { PROFILES } from '../../playwright.screenshots.config';

const DEMO_FAMILY_NAME = 'The Bean Family';
const CLICK_TIMEOUT = 6000;
const ROOT = process.cwd();

/** CSS widths below this render the mobile layout (bottom tab bar). */
const MOBILE_MAX_WIDTH = 767;

/**
 * Serve brand art in place of the Google Drive photo CDN.
 *
 * `photoStore.getPublicUrl` is pure — it builds the URL from `driveFileId` and
 * never checks whether Drive is configured — so seeded photo metadata renders as
 * long as the request resolves. Unmapped ids abort rather than 404, because a
 * 404 pushes the photo into `unresolvedIds` and the app then renders a permanent
 * broken tile for it.
 */
async function mockPhotoCdn(page: Page): Promise<void> {
  await page.route('https://lh3.googleusercontent.com/**', async (route) => {
    // URL shape: /d/<driveFileId>=w<px>
    const match = /\/d\/([^=/?]+)/.exec(route.request().url());
    const rel = match ? DEMO_PHOTO_FILES[decodeURIComponent(match[1]!)] : undefined;
    if (!rel) return route.abort();

    const file = path.join(ROOT, 'public', rel);
    if (!fs.existsSync(file)) return route.abort();
    await route.fulfill({
      status: 200,
      contentType: rel.endsWith('.webp') ? 'image/webp' : 'image/png',
      body: fs.readFileSync(file),
    });
  });
}

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

type Destination = {
  /** Bottom-nav category tab, when the destination hides behind a fan-out. */
  tab?: UIStringKey;
  /** The nav item itself. Used as the fan-out card AND the sidebar button. */
  item: UIStringKey;
  /** Sidebar parent to click first (the pod's children live under it). */
  sidebarParent?: UIStringKey;
};

const NOOK: Destination = { item: 'nav.nook' };
const PLANNER: Destination = { tab: 'mobile.planning', item: 'nav.activities' };
const TRAVEL: Destination = { tab: 'mobile.planning', item: 'nav.travel' };
const MONEY: Destination = { tab: 'mobile.money', item: 'nav.overview' };
const BEANS: Destination = {
  tab: 'mobile.pod',
  item: 'nav.pod.meetBeans',
  sidebarParent: 'nav.pod',
};
const SCRAPBOOK: Destination = {
  tab: 'mobile.pod',
  item: 'nav.pod.scrapbook',
  sidebarParent: 'nav.pod',
};

/**
 * Navigate to a destination, whichever layout is on screen. Throws on a miss —
 * see the file header.
 */
async function goTo(page: Page, dest: Destination, mobile: boolean): Promise<void> {
  if (mobile) {
    const tabKey = dest.tab ?? 'mobile.nook';
    const tab = page.getByLabel(labelExact(tabKey)).last();
    await expect(tab, `bottom-nav tab "${tabKey}"`).toBeVisible({ timeout: 10000 });
    await tab.click({ timeout: CLICK_TIMEOUT });

    if (dest.tab) {
      const card = page
        .getByRole('menuitem')
        .filter({ hasText: labelLoose(dest.item) })
        .last();
      try {
        await expect(card, `fan-out card "${dest.item}"`).toBeVisible({ timeout: 5000 });
        await card.click({ timeout: CLICK_TIMEOUT });
      } catch (err) {
        await dismissStack(page); // don't poison the next navigation
        throw err;
      }
    }
  } else {
    // Sidebar. Both accordions default open (useSidebarAccordion), but a parent
    // with children must be clicked before its children mount.
    //
    // Matching is LOOSE here, not anchored: `AppSidebar.ariaLabelFor` builds the
    // accessible name from a template that appends badge text, so a nav item can
    // read "travel plans, 1 unbooked" and an exact match never fires.
    if (dest.sidebarParent) {
      const parent = page.getByRole('button', { name: labelLoose(dest.sidebarParent) }).first();
      await expect(parent, `sidebar parent "${dest.sidebarParent}"`).toBeVisible({
        timeout: 10000,
      });
      await parent.click({ timeout: CLICK_TIMEOUT });
      await page.waitForTimeout(400);
    }
    const item = page.getByRole('button', { name: labelLoose(dest.item) }).first();
    await expect(item, `sidebar item "${dest.item}"`).toBeVisible({ timeout: 10000 });
    await item.click({ timeout: CLICK_TIMEOUT });
  }

  await page.getByTestId('app-content').waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(600);
}

/** Open the Quick Add sheet and pick an entry, which routes and opens its modal. */
async function quickAdd(page: Page, itemKey: UIStringKey): Promise<void> {
  const fab = page.getByRole('button', { name: labelExact('quickAdd.fab.label') }).last();
  await expect(fab, 'quick-add FAB').toBeVisible({ timeout: 10000 });
  // `force` because the FAB runs an infinite `fab-peek` bob, so Playwright's
  // stability check never settles. Visibility is already asserted above, so the
  // only actionability check we skip is "has stopped moving".
  await fab.click({ timeout: CLICK_TIMEOUT, force: true });

  const entry = page.getByRole('button', { name: labelLoose(itemKey) }).last();
  await expect(entry, `quick-add entry "${itemKey}"`).toBeVisible({ timeout: 5000 });
  await entry.click({ timeout: CLICK_TIMEOUT });

  await expect(page.getByRole('dialog').last(), 'modal should open').toBeVisible({
    timeout: 10000,
  });
  await page.waitForTimeout(700); // let the modal settle open
}

test('capture store screenshots', async ({ page }, testInfo) => {
  const profile = PROFILES.find((p) => p.name === testInfo.project.name);
  expect(profile, `unknown profile "${testInfo.project.name}"`).toBeTruthy();
  const mobile = profile!.viewport.width <= MOBILE_MAX_WIDTH;

  const OUT = path.join(ROOT, 'scripts', 'store-screenshots', '.out', profile!.name);
  const expectedW = Math.round(profile!.viewport.width * profile!.deviceScaleFactor);
  const expectedH = Math.round(profile!.viewport.height * profile!.deviceScaleFactor);
  let shotNo = 0;

  /** Settle the route, then capture the screen and assert its dimensions. */
  async function shot(
    name: string,
    opts: { resetScroll?: boolean; nudgeUpPx?: number; scrollTo?: UIStringKey } = {}
  ) {
    const { resetScroll = !opts.scrollTo, nudgeUpPx = 0, scrollTo } = opts;
    await page.getByTestId('app-content').waitFor({ state: 'visible', timeout: 20000 });
    await revealFigures(page); // no-op once unlocked; the prompt only mounts on money surfaces
    await page.waitForTimeout(900); // settle: images, avatars, chart paint

    // Scroll a named heading into view rather than nudging by a pixel count: the
    // fold sits at a different place in every one of the four viewports.
    if (scrollTo) {
      const anchor = page.getByText(labelLoose(scrollTo)).first();
      await expect(anchor, `scroll anchor "${scrollTo}"`).toBeVisible({ timeout: 10000 });
      // NOT scrollIntoViewIfNeeded: the anchor is already "visible" clinging to
      // the bottom edge, so that call no-ops and the shot stays on the cover.
      // Force it to the top, then back off so the sticky header doesn't cover it.
      await anchor.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      await page.waitForTimeout(300);
      await page.evaluate(() => {
        document.querySelectorAll('*').forEach((el) => {
          if (el.scrollTop > 0) el.scrollTop = Math.max(0, el.scrollTop - 90);
        });
      });
      await page.waitForTimeout(400);
    }

    if (resetScroll) {
      // After settling, not before — a route that self-scrolls on mount would undo
      // an earlier reset. The scroller isn't always `app-content`.
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

    // Play rejects the upload if a side is out of bounds, and a silently-wrong
    // size is exactly the kind of thing nobody notices until submission.
    const { width, height } = pngSize(file);
    expect({ width, height }, `${name} dimensions`).toEqual({
      width: expectedW,
      height: expectedH,
    });
    const mb = fs.statSync(file).size / 1_000_000;
    expect(mb, `${name} must be under Play's 8MB cap`).toBeLessThan(8);
    console.log(
      `  ✓ ${profile!.name}/${path.basename(file)}  ${width}x${height}  ${mb.toFixed(2)}MB`
    );
  }

  await mockPhotoCdn(page);
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
  // The bridge used to silently drop any collection missing from a hardcoded
  // list. Assert the ones that were dropped, so a regression fails loudly here
  // rather than as an empty page in a store asset.
  expect(seeded.vacations?.length, 'vacations must seed').toBeGreaterThan(0);
  expect(seeded.photos?.length, 'photos must seed').toBeGreaterThan(0);
  expect(seeded.sayings?.length, 'sayings must seed').toBeGreaterThan(0);
  expect(seeded.assets?.length, 'assets must seed').toBeGreaterThan(0);

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  await page.waitForTimeout(800);

  // Order is the listing order — the first two carry the most weight on Play.
  await shot('nook');

  // Month agenda (the default view). The week and day views are hour timelines
  // that auto-scroll to an empty evening; only the agenda shows the events. It
  // self-scrolls to today, so keep that position and back it off the sticky
  // toolbar — resetting to the top lands on last week, all "nothing planned".
  await goTo(page, PLANNER, mobile);
  await shot('planner', { resetScroll: false, nudgeUpPx: 130 });

  await quickAdd(page, 'quickAdd.activity.label');
  await shot('create-activity', { resetScroll: false });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  await goTo(page, TRAVEL, mobile);
  await shot('travel');

  const planTrip = page.getByRole('button', { name: labelLoose('travel.planATrip') }).first();
  await expect(planTrip, '"plan a trip" button').toBeVisible({ timeout: 10000 });
  await planTrip.click({ timeout: CLICK_TIMEOUT });
  await expect(page.getByRole('dialog').last(), 'vacation wizard').toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(700);
  await shot('create-travel', { resetScroll: false });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  await goTo(page, MONEY, mobile);
  await shot('money');

  // The scrapbook opens on its cover (header + bean picker), and the "everyone"
  // feed below it truncates card titles at phone width. A single bean's spread is
  // the better shot: polaroid hero, her sayings, her favourites, her milestones.
  // Neily carries the richest content, by design in the seed.
  await goTo(page, SCRAPBOOK, mobile);
  const neilyTab = page.getByText('neily bean', { exact: true }).first();
  await expect(neilyTab, 'scrapbook bean tab').toBeVisible({ timeout: 10000 });
  await neilyTab.click({ timeout: CLICK_TIMEOUT });
  await page.waitForTimeout(900); // page-flip animation
  await shot('scrapbook', { scrollTo: 'scrapbook.section.sayings' });

  await goTo(page, BEANS, mobile);
  await shot('meet-the-beans');

  console.log(`\n${shotNo} screenshots -> ${OUT}`);
  // Play's per-form-factor minimums: phone needs 2+, Chromebook needs 4+.
  expect(shotNo, 'Play requires at least 4 screenshots for Chromebook').toBeGreaterThanOrEqual(4);
});

/** Read a PNG's dimensions from its IHDR chunk. No image library needed. */
function pngSize(file: string): { width: number; height: number } {
  const buf = fs.readFileSync(file).subarray(0, 24);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
