import { test, expect } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import { ui } from '../../e2e/helpers/ui-strings';
import type { Browser, Locator, Page } from '@playwright/test';
import type { MealPlanEntry, Recipe } from '../../src/types/models';
import { mkdirSync } from 'node:fs';

/**
 * PRODUCTION-BUILD CHECK: the fridge-sheet exports embed their fonts.
 *
 * Pins the bug where every production export (Who Owns What, meal plan) drew the header's
 * Caveat accent, the title and the footer tagline in a fallback face, so the title ran into
 * the accent. It never reproduced on localhost: in a production build every stylesheet is a
 * `<link>`, and html-to-image's `getFontEmbedCSS` then inserted the refetched Google Fonts rules
 * into the unreadable Google Fonts sheet itself, threw, swallowed it, and returned "". The dev
 * server injects `<style>` tags, which gave it somewhere writable. The service worker was never
 * the whole story. The exporter now builds the font CSS itself (`buildFontEmbedCss`).
 *
 * Run (builds the app, a few minutes):
 *   npx playwright test -c playwright.prodcheck.config.ts
 *
 * What it ASSERTS, for every page of both sheets, with the service worker controlling the page
 * for the later exports (the prod-only condition):
 *   1. the exact SVG html-to-image rasterised carries `@font-face` rules for Caveat, Outfit and
 *      Inter whose `src` is a `data:` URL (nothing left pointing at the network, which an
 *      isolated SVG image cannot load);
 *   2. re-rendered in a page that CANNOT reach Google Fonts, i.e. with only what the capture
 *      embedded, the header title's text ends before the Caveat accent starts (the reported
 *      overlap), and Caveat itself is loaded.
 * Artifacts (PNG + PDF + the rendered SVG) land in `scratch-shots/export-fonts/`: look at them.
 */

const SHOTS = 'scratch-shots/export-fonts';

/** Every SVG data URL html-to-image hands an <img>, in order, reset per export. */
function recordCaptureSvgs(): void {
  const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    ...desc,
    set(this: HTMLImageElement, v: string) {
      if (typeof v === 'string' && v.startsWith('data:image/svg+xml')) {
        const w = window as unknown as { __exportSvgs?: string[] };
        (w.__exportSvgs ??= []).push(v);
      }
      desc.set!.call(this, v);
    },
  });
}

interface EmbedReport {
  faces: Array<{ family: string; inline: boolean }>;
  svg: string;
}

/** The capture SVGs of the last export, decoded, with the `@font-face` rules they embed. */
async function takeCaptures(page: Page): Promise<EmbedReport[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __exportSvgs?: string[] };
    const urls = w.__exportSvgs ?? [];
    w.__exportSvgs = [];
    return urls.map((url) => {
      const svg = decodeURIComponent(url.slice(url.indexOf(',') + 1));
      const faces = [...svg.matchAll(/@font-face\s*\{[^}]*\}/g)].map(([block]) => ({
        family: (/font-family:\s*['"]?([^;'"]+)/.exec(block)?.[1] ?? '').toLowerCase(),
        inline: !/url\(\s*['"]?https?:/.test(block) && /url\(\s*['"]?data:font\//.test(block),
      }));
      return { faces, svg };
    });
  });
}

/**
 * Re-render a captured SVG with ONLY its embedded fonts (Google Fonts blocked) and measure the
 * header: the title's text must end before the accent starts.
 */
async function measureHeader(browser: Browser, svg: string, name: string) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const iso = await ctx.newPage();
  await iso.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await iso.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
  await iso.evaluate(() => document.fonts.ready);
  const m = await iso.evaluate(() => {
    const heading = document.querySelector('.export-heading');
    const accent = document.querySelector('.export-accent');
    if (!heading || !accent) return null;
    const range = document.createRange();
    range.selectNodeContents(heading);
    return {
      titleTextRight: range.getBoundingClientRect().right,
      accentLeft: accent.getBoundingClientRect().left,
      caveat: document.fonts.check('700 22px Caveat'),
      outfit: document.fonts.check('800 24px Outfit'),
    };
  });
  await iso.screenshot({ path: `${SHOTS}/${name}-isolated.png` });
  await ctx.close();
  return m;
}

async function assertEmbedded(page: Page, browser: Browser, name: string, pages: number) {
  const captures = await takeCaptures(page);
  const controlled = await page.evaluate(() => !!navigator.serviceWorker?.controller);
  console.log(
    `[export-fonts] ${name}: ${captures.length} capture(s), SW controlling: ${controlled}`
  );
  expect(captures.length).toBe(pages);
  for (const [i, { faces, svg }] of captures.entries()) {
    const summary = faces.map((f) => `${f.family}${f.inline ? '' : '(NOT INLINE)'}`).join(', ');
    console.log(`[export-fonts] ${name} page ${i + 1}: @font-face = ${summary || '(none)'}`);
    for (const family of ['caveat', 'outfit', 'inter']) {
      expect(
        faces.some((f) => f.family === family && f.inline),
        `${name} p${i + 1} embeds ${family}`
      ).toBe(true);
    }
    expect(
      faces.every((f) => f.inline),
      `${name} p${i + 1}: no network font URLs`
    ).toBe(true);
    // Only the first page carries the accent (continuation pages are compact).
    if (i === 0) {
      const m = await measureHeader(browser, svg, `${name}-p1`);
      console.log(`[export-fonts] ${name} header:`, JSON.stringify(m));
      expect(m, `${name}: header has a title and an accent`).not.toBeNull();
      expect(m!.caveat, `${name}: Caveat loaded from the capture alone`).toBe(true);
      expect(m!.outfit, `${name}: Outfit loaded from the capture alone`).toBe(true);
      expect(m!.titleTextRight, `${name}: title overlaps the accent`).toBeLessThanOrEqual(
        m!.accentLeft + 0.5
      );
    }
  }
  return controlled;
}

/** Click an export button and save what it downloads. */
async function download(page: Page, button: Locator, file: string): Promise<void> {
  const [dl] = await Promise.all([page.waitForEvent('download'), button.click()]);
  await dl.saveAs(`${SHOTS}/${file}`);
}

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

test('export fonts are embedded in a production build', async ({ page, browser }) => {
  mkdirSync(SHOTS, { recursive: true });
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    const txt = m.text();
    if (/sheet-export|font/i.test(txt)) console.log(`[console.${m.type()}] ${txt.slice(0, 300)}`);
  });
  await page.addInitScript(recordCaptureSvgs);
  await page.setViewportSize({ width: 1280, height: 900 });

  // ── A family, and the service worker installed ─────────────────────────────
  await gotoRoot(page);
  await bypassLoginIfNeeded(page);
  const swReady = await page.evaluate(() =>
    Promise.race([
      navigator.serviceWorker.ready.then(() => true),
      new Promise<boolean>((r) => setTimeout(() => r(false), 60_000)),
    ])
  );
  console.log('[export-fonts] service worker ready:', swReady);
  expect(swReady, 'the production build registers its service worker').toBe(true);

  const db = new IndexedDBHelper(page);
  const owner = (await db.exportData()).familyMembers[0]!;

  // ── Who Owns What: deal three cards, export (Share = PNG, Export = PDF) ─────
  await gotoRoute(page, '/who-owns-what');
  await page.getByTestId('first-deal-start').click();
  await page.getByTestId('deal-pile').waitFor();
  for (let i = 0; i < 3; i++) {
    await page.getByTestId('deal-pile-keep').click();
    await page.getByTestId(`deal-pick-${owner.id}`).click();
    await page.waitForTimeout(700);
  }
  await page.evaluate(() => ((window as unknown as { __exportSvgs?: string[] }).__exportSvgs = []));
  await download(page, page.getByTestId('who-owns-what-share'), 'who-owns-what.png');
  const firstControlled = await assertEmbedded(page, browser, 'who-owns-what-share', 1);

  // ── Meal plan: a full page load (SW controlling), seeded week, export ───────
  const now = new Date().toISOString();
  const mon = new Date();
  mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
  const day = (i: number) => {
    const d = new Date(mon);
    d.setDate(d.getDate() + i);
    return ymd(d);
  };
  const recipe: Recipe = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Chicken Tikka Masala',
    servings: '4',
    ingredients: ['600 g chicken thighs'],
    steps: ['Cook it.'],
    createdAt: now,
    updatedAt: now,
  } as Recipe;
  const meal = (id: string, date: string): MealPlanEntry =>
    ({
      id,
      date,
      slot: 'dinner',
      position: 0,
      kind: 'recipe',
      recipeId: recipe.id,
      cooked: false,
      createdAt: now,
      updatedAt: now,
    }) as MealPlanEntry;
  await db.seedData({
    recipes: [recipe],
    ...({ mealPlans: [meal('mp-mon', day(0)), meal('mp-thu', day(3))] } as object),
  });
  await gotoRoute(page, '/meal-planner');
  const mealExport = page.getByRole('button', { name: ui('sheetExport.exportPdf') });
  await mealExport.waitFor({ timeout: 20_000 });
  await page.evaluate(() => ((window as unknown as { __exportSvgs?: string[] }).__exportSvgs = []));
  await download(page, mealExport, 'meal-plan.pdf');
  const mealControlled = await assertEmbedded(page, browser, 'meal-plan-pdf', 1);

  // ── Who Owns What again: second load, SW controlling, caches warm ───────────
  await gotoRoute(page, '/who-owns-what');
  await page.getByTestId('who-owns-what-export').waitFor();
  await page.evaluate(() => ((window as unknown as { __exportSvgs?: string[] }).__exportSvgs = []));
  await download(page, page.getByTestId('who-owns-what-export'), 'who-owns-what.pdf');
  const lastControlled = await assertEmbedded(page, browser, 'who-owns-what-pdf', 1);

  console.log('[export-fonts] SW controlling per export:', {
    firstControlled,
    mealControlled,
    lastControlled,
  });
  expect(lastControlled, 'the last export ran under the service worker').toBe(true);
});
