import { test, expect } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import { ui } from '../../e2e/helpers/ui-strings';
import type { Page } from '@playwright/test';

/**
 * NOT a test: the browser walk for docs/plans/2026-09-30-phone-toolbars-and-deal-hero.md
 * (phone toolbars on the Meal Planner and Who Owns What, the deal card as hero, swipe).
 * Lives OUTSIDE `e2e/specs/` on purpose (see capture.ts). Run it deliberately:
 *   npx playwright test -c playwright.design.config.ts --grep "phone toolbars walk"
 *
 * Touch swipes go through CDP `Input.dispatchTouchEvent`, so Chrome raises real pointer
 * events with `pointerType: 'touch'` (and honours `touch-action`); a mouse drag uses
 * `page.mouse`. Every screen is shot at 390px and 1280px, light and dark, and a contrast
 * probe (text vs its composited background) runs on each. The deal pile's geometry (no
 * sideways scroll, arrows inside the stage, art inside its band) is checked at 320px,
 * 360px in Large reading mode, 390px, 768px and 1280px.
 */

const SHOTS = 'scratch-shots/phone-toolbars';
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };
const HINT_KEY = 'beanies:whoOwnsWhatSwipeHint';

test.use({ hasTouch: true });

async function shot(page: Page, name: string) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function setDark(page: Page, dark: boolean) {
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
  await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark);
  await page.waitForTimeout(250);
}

async function touchSwipe(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number }
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: from.x + ((to.x - from.x) * i) / 10, y: from.y + ((to.y - from.y) * i) / 10 },
      ],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await page.waitForTimeout(500);
}

async function mouseDrag(page: Page, from: { x: number; y: number }, dx: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + (dx * i) / 10, from.y);
  await page.mouse.up();
  await page.waitForTimeout(500);
}

const pileCardId = (page: Page) =>
  page
    .locator('[data-testid^="deal-pile-card-"]')
    .first()
    .getAttribute('data-testid')
    .then((id) => id?.replace('deal-pile-card-', ''));

async function center(page: Page, testid: string) {
  const b = (await page.getByTestId(testid).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/**
 * Text vs its actual background, WCAG AA (4.5, or 3 for large text). Backgrounds are
 * composited up the ancestor chain through a canvas (so oklch / color-mix resolve); a
 * gradient takes its worst stop.
 */
async function contrastProbe(page: Page, scope: string, label: string) {
  const fails = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return [`no scope ${sel}`];
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const rgba = (c: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r!, g!, b!, a! / 255];
    };
    const over = (top: number[], under: number[]) => {
      const a = top[3]!;
      return [0, 1, 2].map((i) => top[i]! * a + under[i]! * (1 - a)).concat(1);
    };
    const lum = (c: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!);
    };
    const ratio = (a: number[], b: number[]) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x! + 0.05) / (y! + 0.05);
    };
    /** Candidate backgrounds (several for a gradient) behind `el`, fully composited. */
    const backgrounds = (el: Element): number[][] => {
      const layers: string[][] = [];
      for (let n: Element | null = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        const img = cs.backgroundImage;
        if (img && img.includes('gradient')) {
          const stops = img.match(/(oklch|rgba?|color|hsla?)\([^)]*\)/g) ?? [];
          if (stops.length) layers.push(stops);
        }
        const bg = rgba(cs.backgroundColor);
        if (bg[3] > 0) layers.push([cs.backgroundColor]);
        if (layers.length && layers.at(-1)!.every((c) => rgba(c)[3] >= 0.99)) break;
      }
      let base: number[][] = [rgba(getComputedStyle(document.body).backgroundColor)];
      if (base[0]![3] === 0) base = [[255, 255, 255, 1]];
      for (const layer of layers.reverse()) {
        base = layer.flatMap((c) => base.map((b) => over(rgba(c), b)));
      }
      return base;
    };
    const out: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const el = t.parentElement;
      if (!el || seen.has(el) || !t.textContent?.trim()) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden') continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      if (/^[\p{Extended_Pictographic}\s️‍]+$/u.test(t.textContent.trim())) continue;
      if ((el as HTMLButtonElement).disabled || el.closest('button:disabled')) continue;
      const size = parseFloat(cs.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
      const fg = rgba(cs.color);
      const worst = Math.min(...backgrounds(el).map((b) => ratio(over(fg, b), b)));
      const need = large ? 3 : 4.5;
      if (worst < need)
        out.push(`${worst.toFixed(2)} < ${need}: "${t.textContent.trim().slice(0, 40)}"`);
    }
    return out;
  }, scope);
  console.log(`[contrast] ${label}: ${fails.length ? fails.join(' | ') : 'all pass'}`);
  return fails;
}

async function noSideScroll(page: Page, label: string) {
  const m = await page.evaluate(() => {
    const s = document.scrollingElement!;
    const main = document.querySelector('main');
    return {
      doc: [s.scrollWidth, s.clientWidth],
      main: main ? [main.scrollWidth, main.clientWidth] : null,
    };
  });
  console.log(`[overflow] ${label}: ${JSON.stringify(m)}`);
  expect(m.doc[0]).toBeLessThanOrEqual(m.doc[1]!);
  if (m.main) expect(m.main[0]).toBeLessThanOrEqual(m.main[1]!);
}

/**
 * The deal pile's geometry at the current width: no sideways scroll, the pile and both
 * arrows inside the stage (md+: 2 x 3rem arrows + 2 x 1.75rem gaps beside the pile), and
 * the card's art inside its art band (the slab), so nothing clips.
 */
async function dealGeometry(page: Page, label: string) {
  await page.getByTestId('deal-pile').waitFor();
  await page.waitForTimeout(400); // the card's 280ms entry settles
  await noSideScroll(page, label);
  const g = await page.evaluate(() => {
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height };
    };
    const root = document.querySelector('[data-testid="deal-pile"]')!;
    const card = root.querySelector('[data-testid^="deal-pile-card-"]')!;
    return {
      stage: box(root.querySelector('.stage')),
      pile: box(root.querySelector('.pile')),
      prev: box(root.querySelector('[data-testid="deal-pile-prev"]')),
      next: box(root.querySelector('[data-testid="deal-pile-next"]')),
      slab: box(card.querySelector('.slab')),
      art: box(card.querySelector('.slab > :first-child')),
      artTag: card.querySelector('.slab > :first-child')?.tagName,
    };
  });
  const r = (n: number) => Math.round(n);
  console.log(
    `[geometry] ${label}: stage ${r(g.stage!.l)}-${r(g.stage!.r)}, pile ${r(g.pile!.w)}w, prev ${r(g.prev!.l)}-${r(g.prev!.r)}, next ${r(g.next!.l)}-${r(g.next!.r)}, slab ${r(g.slab!.w)}x${r(g.slab!.h)}, art(${g.artTag}) ${r(g.art!.w)}x${r(g.art!.h)} at ${r(g.art!.t - g.slab!.t)}/${r(g.slab!.b - g.art!.b)} from slab top/bottom`
  );
  const eps = 0.5;
  expect(g.prev!.l).toBeGreaterThanOrEqual(g.stage!.l - eps);
  expect(g.next!.r).toBeLessThanOrEqual(g.stage!.r + eps);
  expect(g.art!.t).toBeGreaterThanOrEqual(g.slab!.t - eps);
  expect(g.art!.b).toBeLessThanOrEqual(g.slab!.b + eps);
  expect(g.art!.l).toBeGreaterThanOrEqual(g.slab!.l - eps);
  expect(g.art!.r).toBeLessThanOrEqual(g.slab!.r + eps);
}

/** A full navigation (stages the doc first, see gotoRoute), then waits for the app. */
async function go(page: Page, path: string) {
  await gotoRoute(page, path);
  await page.getByTestId('app-content').waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
}

async function view(page: Page, key: 'overview' | 'deal' | 'deck') {
  await page
    .getByTestId('who-owns-what-views')
    .getByRole('button', { name: ui(`whoOwnsWhat.view.${key}`) })
    .click();
  await page.waitForTimeout(500);
}

test('phone toolbars walk', async ({ page }) => {
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[console.error] ${m.text()}`);
  });

  await page.setViewportSize(DESKTOP);
  await gotoRoot(page);
  await bypassLoginIfNeeded(page);
  await page.evaluate((k) => localStorage.removeItem(k), HINT_KEY);
  const owner = (await new IndexedDBHelper(page).exportData()).familyMembers[0]!;

  // ── Meal Planner header ─────────────────────────────────────────────────
  await go(page, '/meal-planner');
  for (const [vp, tag] of [
    [PHONE, '390'],
    [DESKTOP, '1280'],
  ] as const) {
    await page.setViewportSize(vp);
    for (const dark of [false, true]) {
      await setDark(page, dark);
      await shot(page, `mp-${tag}-${dark ? 'dark' : 'light'}`);
      await contrastProbe(page, 'main', `meal planner ${tag} ${dark ? 'dark' : 'light'}`);
    }
    await setDark(page, false);
    const share = page
      .getByTestId('app-content')
      .getByRole('button', { name: ui('mealPlanner.export.share'), exact: true });
    const exportBtn = page.getByRole('button', { name: ui('sheetExport.exportPdf') });
    const copy = page.getByRole('button', { name: new RegExp(ui('mealPlanner.copyLastWeek')) });
    const sb = (await share.boundingBox())!;
    const cb = (await copy.boundingBox())!;
    console.log(
      `[mp ${tag}] share ${Math.round(sb.width)}x${Math.round(sb.height)} at y ${Math.round(sb.y)}, copy y ${Math.round(cb.y)}, export visible ${await exportBtn.isVisible()}`
    );
    if (vp === PHONE) {
      expect(await exportBtn.isVisible()).toBe(false);
      expect(Math.round(sb.width)).toBe(40);
      expect(Math.abs(sb.y + sb.height / 2 - (cb.y + cb.height / 2))).toBeLessThan(4);
      // The mockup's case: Shopping List enabled with its count badge (no recipe seeded
      // here, so the badge the page renders is cloned in for the measurement only).
      await page.evaluate(() => {
        const btn = document.querySelector<HTMLButtonElement>(
          '[data-testid="meal-shopping-button"]'
        )!;
        btn.disabled = false;
        const badge = document.createElement('span');
        badge.className =
          'grid h-5 min-w-5 place-items-center rounded-full bg-[#1e8449] px-1.5 text-xs font-bold text-white';
        badge.textContent = '3';
        badge.id = 'probe-badge';
        btn.appendChild(badge);
      });
      await page.waitForTimeout(200);
      const sb2 = (await share.boundingBox())!;
      console.log(
        `[mp 390] with a badge: share y ${Math.round(sb2.y)} vs copy y ${Math.round(cb.y)}`
      );
      await shot(page, 'mp-390-badge-light');
      expect(Math.abs(sb2.y - sb.y)).toBeLessThan(4);
      await page.evaluate(() => document.getElementById('probe-badge')?.remove());
    } else {
      expect(await exportBtn.isVisible()).toBe(true);
    }
  }

  // ── Who Owns What: keep one card at desktop so Share shows ───────────────
  await page.setViewportSize(DESKTOP);
  await go(page, '/who-owns-what');
  await page.getByTestId('first-deal-start').click();
  await page.getByTestId('deal-pile').waitFor();
  await page.getByTestId('deal-pile-keep').click();
  await page.getByTestId(`deal-pick-${owner.id}`).click();
  await page.waitForTimeout(900);

  for (const [vp, tag] of [
    [PHONE, '390'],
    [DESKTOP, '1280'],
  ] as const) {
    await page.setViewportSize(vp);
    await view(page, 'overview');
    for (const dark of [false, true]) {
      await setDark(page, dark);
      await shot(page, `wow-overview-${tag}-${dark ? 'dark' : 'light'}`);
      await contrastProbe(page, 'main', `wow overview ${tag} ${dark ? 'dark' : 'light'}`);
    }
    await setDark(page, false);
    await view(page, 'deal');
    await page.getByTestId('deal-pile').waitFor();
    for (const dark of [false, true]) {
      await setDark(page, dark);
      await shot(page, `wow-deal-${tag}-${dark ? 'dark' : 'light'}`);
      await contrastProbe(page, 'main', `wow deal ${tag} ${dark ? 'dark' : 'light'}`);
    }
    await setDark(page, false);
    await dealGeometry(page, `deal ${tag}`);

    const vis = async (id: string) => page.getByTestId(id).first().isVisible();
    const tagline = page.getByText(ui('whoOwnsWhat.welcomeSubtitle'));
    const facts = {
      tagline: await tagline.isVisible(),
      add: await page.getByTestId('who-owns-what-add').count(),
      share: await vis('who-owns-what-share'),
      export: await vis('who-owns-what-export'),
      position: await vis('deal-pile-position'),
      question: await vis('deal-pile-question'),
      chip: (await vis('deal-pile-position-chip'))
        ? await page.getByTestId('deal-pile-position-chip').textContent()
        : null,
      hint: await vis('deal-pile-swipe-hint'),
      pileWidth: Math.round(
        (await page.locator('[data-testid="deal-pile"] .pile').boundingBox())!.width
      ),
      keepHeight: Math.round((await page.getByTestId('deal-pile-keep').boundingBox())!.height),
    };
    console.log(`[wow ${tag}] ${JSON.stringify(facts)}`);
    if (vp === PHONE) {
      expect(facts.tagline).toBe(false);
      expect(facts.add).toBe(1);
      expect(facts.export).toBe(false);
      expect(facts.position).toBe(false);
      expect(facts.question).toBe(false);
      expect(facts.chip).toMatch(/ · \d+ of \d+$/);
      expect(facts.pileWidth).toBe(300);
      // One row: toggle, ＋, Share, ⋯ share a centre line.
      const ys = await Promise.all(
        ['who-owns-what-views', 'who-owns-what-add', 'who-owns-what-share'].map(async (id) => {
          const b = (await page.getByTestId(id).boundingBox())!;
          return Math.round(b.y + b.height / 2);
        })
      );
      const menu = (await page
        .getByRole('button', { name: ui('action.moreOptions') })
        .boundingBox())!;
      ys.push(Math.round(menu.y + menu.height / 2));
      console.log(`[wow 390] toolbar centre lines ${JSON.stringify(ys)}`);
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(6);
      // Arrows overlap the pile's edges, and stay visible.
      const pile = (await page.locator('[data-testid="deal-pile"] .pile').boundingBox())!;
      const prev = (await page.getByTestId('deal-pile-prev').boundingBox())!;
      const next = (await page.getByTestId('deal-pile-next').boundingBox())!;
      console.log(
        `[wow 390] pile x ${Math.round(pile.x)}-${Math.round(pile.x + pile.width)}, prev ${Math.round(prev.x)}-${Math.round(prev.x + prev.width)}, next ${Math.round(next.x)}-${Math.round(next.x + next.width)}`
      );
      expect(prev.x + prev.width).toBeGreaterThan(pile.x);
      expect(next.x).toBeLessThan(pile.x + pile.width);
      expect(await page.getByTestId('deal-pile-prev').isVisible()).toBe(true);
    } else {
      expect(facts.tagline).toBe(true);
      expect(facts.export).toBe(true);
      expect(facts.position).toBe(true);
      expect(facts.question).toBe(true);
      expect(facts.hint).toBe(false);
    }
  }

  // ── Swipe on the phone pile ─────────────────────────────────────────────
  await page.setViewportSize(PHONE);
  await page.waitForTimeout(400);
  await expect(page.getByTestId('deal-pile-swipe-hint')).toBeVisible();
  await shot(page, 'swipe-0-hint-light');
  const first = await pileCardId(page);
  const c = await center(page, `deal-pile-card-${first}`);

  await mouseDrag(page, c, -160);
  const afterMouse = await pileCardId(page);
  console.log(`[swipe] mouse drag: ${first} -> ${afterMouse}`);
  expect(afterMouse).toBe(first);
  await expect(page.getByTestId('deal-pile-swipe-hint')).toBeVisible();

  await touchSwipe(page, c, { x: c.x - 160, y: c.y + 6 });
  const afterLeft = await pileCardId(page);
  console.log(`[swipe] touch left: ${first} -> ${afterLeft}`);
  expect(afterLeft).not.toBe(first);
  await expect(page.getByTestId('deal-pile-swipe-hint')).toHaveCount(0);
  await shot(page, 'swipe-1-after-left-light');
  expect(await page.evaluate((k) => localStorage.getItem(k), HINT_KEY)).toBe('seen');

  await touchSwipe(page, c, { x: c.x + 160, y: c.y });
  const afterRight = await pileCardId(page);
  console.log(`[swipe] touch right: ${afterLeft} -> ${afterRight}`);
  expect(afterRight).toBe(first);

  // Vertical: the page scrolls, the pile does not step.
  const scroller = async () =>
    page.evaluate(() => {
      const m = document.querySelector('main');
      return Math.round((m?.scrollTop ?? 0) + (document.scrollingElement?.scrollTop ?? 0));
    });
  const beforeY = await scroller();
  await touchSwipe(page, c, { x: c.x + 4, y: c.y - 250 });
  const afterY = await scroller();
  const afterVertical = await pileCardId(page);
  console.log(`[swipe] vertical: scroll ${beforeY} -> ${afterY}, card ${afterVertical}`);
  expect(afterVertical).toBe(first);
  expect(afterY).toBeGreaterThan(beforeY);

  // Hint stays gone after a reload.
  await go(page, '/who-owns-what');
  await view(page, 'deal');
  await page.getByTestId('deal-pile').waitFor();
  console.log(
    `[swipe] hint after reload: ${await page.getByTestId('deal-pile-swipe-hint').count()}`
  );
  await expect(page.getByTestId('deal-pile-swipe-hint')).toHaveCount(0);

  // Dark: the pile with a disabled arrow (at the start) and the hint back on.
  await page.evaluate((k) => localStorage.removeItem(k), HINT_KEY);
  await go(page, '/who-owns-what');
  await view(page, 'deal');
  await setDark(page, true);
  await shot(page, 'swipe-2-hint-dark');
  await contrastProbe(page, '[data-testid="deal-pile"]', 'pile 390 dark (hint on)');
  await setDark(page, false);
  await contrastProbe(page, '[data-testid="deal-pile"]', 'pile 390 light (hint on)');

  // ── Card Details drawer: touch swipe through the Deck ───────────────────
  await view(page, 'deck');
  await page.locator('[data-testid^="card-open-"]').first().click();
  await page.getByTestId('card-view-name').waitFor();
  const nameBefore = await page.getByTestId('card-view-name').textContent();
  // The drawer slides in: let it land before measuring where to put the finger.
  await shot(page, 'drawer-390-before');
  const hc = await center(page, 'card-view-name');
  await touchSwipe(page, { x: hc.x, y: hc.y }, { x: hc.x - 160, y: hc.y });
  const nameAfter = await page.getByTestId('card-view-name').textContent();
  console.log(`[drawer] touch left: ${nameBefore} -> ${nameAfter}`);
  expect(nameAfter).not.toBe(nameBefore);
  await shot(page, 'drawer-390-light');
  await setDark(page, true);
  await shot(page, 'drawer-390-dark');
  await contrastProbe(page, '[role="dialog"]', 'drawer 390 dark');
  await setDark(page, false);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ── 320px and 768px (the md line) at the default text size ──────────────
  for (const [vp, tag] of [
    [{ width: 320, height: 700 }, '320'],
    [{ width: 768, height: 1024 }, '768'],
  ] as const) {
    await page.setViewportSize(vp);
    await view(page, 'deal');
    await dealGeometry(page, `deal ${tag}`);
    await shot(page, `wow-deal-${tag}-light`);
  }

  // ── 360px, Large reading mode: never sideways ───────────────────────────
  await page.setViewportSize({ width: 360, height: 780 });
  await page.evaluate(() => document.documentElement.setAttribute('data-text-size', 'large'));
  await view(page, 'deal');
  await dealGeometry(page, '360 large deal');
  await shot(page, 'large-360-deal-light');
  await view(page, 'overview');
  await noSideScroll(page, '360 large overview');
  await go(page, '/meal-planner');
  await page.evaluate(() => document.documentElement.setAttribute('data-text-size', 'large'));
  await page.waitForTimeout(600);
  await shot(page, 'large-360-mp-light');
  await noSideScroll(page, '360 large meal planner');

  // ── An illustrated card (the <img> art, not the emoji) at every width ──
  await page.evaluate(() => document.documentElement.removeAttribute('data-text-size'));
  await page.setViewportSize(PHONE);
  await go(page, '/who-owns-what');
  await view(page, 'deal');
  await page.getByTestId('deal-pile').waitFor();
  const imgArt = page.locator('[data-testid^="deal-pile-card-"] .slab > img');
  for (let i = 0; i < 40 && !(await imgArt.count()); i++) {
    await page.getByTestId('deal-pile-next').click();
    await page.waitForTimeout(150);
  }
  expect(await imgArt.count()).toBe(1);
  for (const [vp, tag, large] of [
    [{ width: 320, height: 700 }, '320', false],
    [{ width: 360, height: 780 }, '360-large', true],
    [PHONE, '390', false],
    [{ width: 768, height: 1024 }, '768', false],
    [DESKTOP, '1280', false],
  ] as const) {
    await page.setViewportSize(vp);
    await page.evaluate(
      (l) =>
        l
          ? document.documentElement.setAttribute('data-text-size', 'large')
          : document.documentElement.removeAttribute('data-text-size'),
      large
    );
    await dealGeometry(page, `illustrated deal ${tag}`);
    await shot(page, `wow-deal-illustrated-${tag}-light`);
  }
  await page.setViewportSize(PHONE);
  await page.evaluate(() => document.documentElement.removeAttribute('data-text-size'));
  await setDark(page, true);
  await shot(page, 'wow-deal-illustrated-390-dark');
  await setDark(page, false);
});
