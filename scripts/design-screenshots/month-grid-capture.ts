import { test } from '../../e2e/fixtures/test';
import type { Locator, Page } from '@playwright/test';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';
import { seedNovember2026, setDark, type SeededCounts } from './monthGridFixture';

/**
 * NOT a test: the month-grid (#141) design-review screenshots plus measured numbers. Outside
 * `e2e/specs/` on purpose. Fixed clock: today is Wed 4 Nov 2026, 09:00.
 *   npx playwright test -c playwright.design.config.ts --grep "month grid capture"
 *
 * Test ids this script expects from the components (WP3/WP5 must match them). Every control is
 * optional: when absent the script logs "skipped: <control> not present" and carries on, so it
 * runs against the app as it stands and fully once the components land.
 *   month-density-menu        desktop density menu trigger (end of the member-chips row)
 *   month-density-compact     menu option, Compact
 *   month-density-comfortable menu option, Comfortable
 *   month-more                the "+N more" button inside a day cell
 *   month-density-faces       phone density label button, Faces
 *   month-density-bars        phone density label button, Bars
 *   month-density-titles      phone density label button, Titles
 *   view-toggle-month         the M pill (second tap flips Grid/List on a phone)
 *   [data-date="YYYY-MM-DD"]  a day cell (desktop grid and phone grid)
 *   [data-activity-id]        every activity chip inside a cell (counted for "shown")
 */
const SHOTS = 'scratch-shots/month-grid';

function log(...parts: unknown[]) {
  console.log('[mg]', ...parts);
}

/** Resolve to the locator when it exists on the page right now, else log the skip and return null. */
async function optional(locator: Locator, name: string): Promise<Locator | null> {
  if (await locator.count()) return locator.first();
  log(`skipped: ${name} not present`);
  return null;
}

/** Call an action on a live Pinia store from the page (the same route `save-queued-capture.ts` uses). */
async function storeCall(page: Page, store: string, action: string, arg: unknown): Promise<void> {
  await page.evaluate(
    async ({ store, action, arg }) => {
      const root = document.querySelector('#app') ?? document.querySelector('[data-v-app]');
      const app = (
        root as unknown as {
          __vue_app__?: {
            config: {
              globalProperties: {
                $pinia?: { _s: Map<string, Record<string, (a: unknown) => unknown>> };
              };
            };
          };
        }
      )?.__vue_app__;
      const target = app?.config.globalProperties.$pinia?._s.get(store);
      if (!target || typeof target[action] !== 'function') {
        throw new Error(`store ${store}.${action} not reachable from window`);
      }
      await target[action]!(arg);
    },
    { store, action, arg }
  );
}

/** The family's holiday country: Singapore, so Deepavali (14 Nov) is the holiday sample. */
const HOLIDAY_COUNTRY = 'SG';

/**
 * A full navigation can drop the seeded session (the phone and Large captures came out empty).
 * Read the bridge back; when activities are missing, seed again; then make sure the holiday
 * country is set. Idempotent: safe to call after every navigation.
 */
async function ensureSeeded(page: Page, seeded: SeededCounts, label: string): Promise<void> {
  const have = async () =>
    page.evaluate(() => {
      const bridge = (
        window as unknown as {
          __e2eDataBridge?: { exportData: () => Record<string, unknown[]> };
        }
      ).__e2eDataBridge;
      return bridge?.exportData().activities?.length ?? 0;
    });
  const before = await have();
  if (before < seeded.activities) {
    log(
      `${label}: session lost its data (${before}/${seeded.activities} activities), seeding again`
    );
    await seedNovember2026(page);
  }
  try {
    await storeCall(page, 'settings', 'setCountry', HOLIDAY_COUNTRY);
  } catch (err) {
    log(`${label}: holiday country not set (${String(err)}); skipped`);
  }
  await page.waitForTimeout(800);
}

async function gotoMonth(page: Page, ymd: string, seeded: SeededCounts, label = ymd) {
  await gotoRoute(page, `/activities?view=month&d=${ymd}`);
  await page.getByTestId('app-content').waitFor({ state: 'visible', timeout: 30000 });
  await ensureSeeded(page, seeded, label);
  await page.waitForTimeout(1200);
}

async function shot(page: Page, name: string, dark: boolean) {
  await setDark(page, dark);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/${name}-${dark ? 'dark' : 'light'}.png` });
}

/** One screenshot per colour mode; `prepare` runs once per mode before it (idempotent actions only). */
async function bothModes(page: Page, name: string, prepare?: () => Promise<void>) {
  for (const dark of [false, true]) {
    await setDark(page, dark);
    if (prepare) await prepare();
    await shot(page, name, dark);
  }
  await setDark(page, false);
}

/** The measured numbers the plan asks for (section 15). Logged, never asserted. */
async function measure(page: Page, label: string, seeded: SeededCounts) {
  const m = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll<HTMLElement>('[data-date]'));
    const chipCount = (el: Element) => el.querySelectorAll('[data-activity-id]').length;
    const shown = (ymd: string) => {
      const cell = cells.find((c) => c.dataset.date === ymd);
      return cell ? chipCount(cell) : null;
    };
    const main = document.querySelector('main');
    const nav = document.querySelector('nav.fixed, nav[class*="bottom"]');
    const r = nav?.getBoundingClientRect();
    const ids = new Set<string>();
    for (const c of cells) {
      for (const el of c.querySelectorAll<HTMLElement>('[data-activity-id]')) {
        ids.add(el.dataset.activityId ?? '');
      }
    }
    return {
      cells: cells.length,
      rowPx: cells[0] ? cells[0].getBoundingClientRect().height : null,
      shown: {
        '3': shown('2026-11-03'),
        '12': shown('2026-11-12'),
        '20': shown('2026-11-20'),
        '24': shown('2026-11-24'),
      },
      visibleChips: cells.reduce((n, c) => n + chipCount(c), 0),
      visibleDistinct: ids.size,
      mainOverflow: main ? main.scrollHeight - main.clientHeight : null,
      tabBar: r ? { top: r.top, height: r.height, bottom: r.bottom } : null,
    };
  });
  log(label, JSON.stringify(m), `seeded activities=${seeded.activities}`);
}

/** Click a control when present, then give the layout a beat. */
async function click(page: Page, locator: Locator, name: string): Promise<boolean> {
  const el = await optional(locator, name);
  if (!el) return false;
  await el.click();
  await page.waitForTimeout(400);
  return true;
}

test.describe('design screenshots', () => {
  test('month grid capture', async ({ page }) => {
    test.setTimeout(290_000);
    await page.clock.install({ time: new Date('2026-11-04T09:00:00') });
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoRoot(page);
    await new IndexedDBHelper(page).clearAllData();
    await gotoRoot(page);
    await bypassLoginIfNeeded(page);
    await gotoRoute(page, '/activities');
    await page.getByTestId('app-content').waitFor({ state: 'visible', timeout: 30000 });
    const seeded = await seedNovember2026(page);

    // Desktop 1280x800: Compact, then Comfortable, October, popover on Tue 3.
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoMonth(page, '2026-11-15', seeded);
    const menu = page.getByTestId('month-density-menu');
    if (await click(page, menu, 'density menu')) {
      await click(page, page.getByTestId('month-density-compact'), 'compact option');
    }
    await measure(page, 'desktop-1280 compact', seeded);
    await bothModes(page, 'desktop-1280-compact');

    if (await click(page, menu, 'density menu')) {
      await click(page, page.getByTestId('month-density-comfortable'), 'comfortable option');
    }
    await measure(page, 'desktop-1280 comfortable', seeded);
    await bothModes(page, 'desktop-1280-comfortable');
    if (await click(page, menu, 'density menu')) {
      await click(page, page.getByTestId('month-density-compact'), 'compact option');
    }

    await gotoMonth(page, '2026-10-15', seeded);
    await measure(page, 'desktop-1280 october', seeded);
    await bothModes(page, 'desktop-1280-october');

    await gotoMonth(page, '2026-11-15', seeded);
    const more3 = await optional(
      page.locator('[data-date="2026-11-03"]').getByTestId('month-more'),
      'Tue 3 more button'
    );
    if (more3) {
      await more3.click();
      await page.waitForTimeout(400);
      await bothModes(page, 'desktop-1280-popover');
      await page.keyboard.press('Escape');
    }

    // 1024x768: normal, then Large reading mode.
    await page.setViewportSize({ width: 1024, height: 768 });
    await gotoMonth(page, '2026-11-15', seeded);
    await measure(page, 'desktop-1024 normal', seeded);
    await bothModes(page, 'desktop-1024');
    // Large reading mode through the settings store: no reload, so the seeded session stays.
    await storeCall(page, 'settings', 'setTextSize', 'large');
    await page.waitForTimeout(1500);
    await measure(page, 'desktop-1024 large', seeded);
    await bothModes(page, 'desktop-1024-large');
    await storeCall(page, 'settings', 'setTextSize', 'normal');
    await page.waitForTimeout(800);

    // Phone 390x844: Titles, Bars, Faces, Titles with Thu 12 open, then the List (stream).
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoMonth(page, '2026-11-15', seeded);
    const density = (mode: string) => page.getByTestId(`month-density-${mode}`);
    const setDensity = (mode: string) => click(page, density(mode), `density label ${mode}`);
    for (const mode of ['titles', 'bars', 'faces']) {
      await setDensity(mode);
      await measure(page, `phone-390 ${mode}`, seeded);
      await bothModes(page, `phone-390-${mode}`);
    }
    await setDensity('titles');
    const thu12 = await optional(page.locator('[data-date="2026-11-12"]'), 'Thu 12 cell');
    if (thu12) {
      await thu12.click();
      await page.waitForTimeout(500);
      await bothModes(page, 'phone-390-titles-open');
      await thu12.click();
      await page.waitForTimeout(300);
    }
    // The M pill flips Grid/List on a second tap; skip when the pill is absent.
    if (await click(page, page.getByTestId('view-toggle-month'), 'M pill (flip to List)')) {
      await measure(page, 'phone-390 list', seeded);
      await bothModes(page, 'phone-390-list');
    }

    // Phone 360x640: Faces, one shot, to check the face cluster wrapping.
    await page.setViewportSize({ width: 360, height: 640 });
    await gotoMonth(page, '2026-11-15', seeded);
    await setDensity('faces');
    await measure(page, 'phone-360 faces', seeded);
    await bothModes(page, 'phone-360-faces');
  });
});
