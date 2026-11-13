import { test } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import { ui } from '../../e2e/helpers/ui-strings';
import type { Page, CDPSession } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * NOT a test: the blog-image capture for Who Owns What (beanstalk post #63). Stills for a
 * montage (desktop + phone, 2x) and a phone screencast of dealing cards, both against a
 * synthetic family. Lives outside `e2e/specs/` on purpose (see capture.ts). Run it:
 *   npx playwright test -c playwright.design.config.ts --grep "blog 63"
 * Output: scratch-shots/who-owns-what-blog/ (gitignored). The montage and the GIF are
 * composed from these afterwards; nothing here writes into the repo's assets.
 */

const OUT = path.join(process.cwd(), 'scratch-shots', 'who-owns-what-blog');
const PAPA = 'blog-papa';
const MAMA = 'blog-mama';
const PIP = 'blog-pip';
const JUNO = 'blog-juno';

/** Sign in, then replace the family with two parents and two kids. Returns the owner id. */
async function seedFamily(page: Page, kids: 1 | 2 = 2): Promise<string> {
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
      { ...owner, name: 'Papa Bean', gender: 'male', ageGroup: 'adult', color: '#2C3E50' } as never,
      bean(MAMA, 'Mama Bean', '#E67E22', 'female', 'adult'),
      bean(PIP, 'Pip', '#10b981', 'male', 'child'),
      ...(kids === 2 ? [bean(JUNO, 'Juno', '#ec4899', 'female', 'child')] : []),
    ],
  });
  void PAPA;
  // Beanie mode (the app's default, and the blog's voice): the e2e fixture forces standard
  // English on every load, so flip it back from here on. Toasts are hidden: they sit over
  // the picker and swallow the next tap.
  await page.evaluate(() => sessionStorage.setItem('__blog_beanie', '1'));
  return owner.id;
}

async function beanieModeAndQuietToasts(page: Page, hideFab = false) {
  await page.addInitScript((fab) => {
    if (sessionStorage.getItem('__blog_beanie')) (window as any).__e2e_beanie_off = false;
    const add = () => {
      const st = document.createElement('style');
      st.textContent =
        'div.fixed.z-\\[270\\]{display:none!important}' +
        (fab ? 'button.fab{display:none!important}' : '');
      document.head.appendChild(st);
    };
    if (document.head) add();
    else document.addEventListener('DOMContentLoaded', add);
  }, hideFab);
}

async function view(page: Page, key: 'overview' | 'deal' | 'deck') {
  await page
    .getByTestId('who-owns-what-views')
    .getByRole('button', { name: new RegExp(`^${ui(`whoOwnsWhat.view.${key}`)}$`, 'i') })
    .click();
  await page.waitForTimeout(600);
}

async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage });
}

test.describe('blog 63 stills', () => {
  test.use({ viewport: { width: 1280, height: 1500 }, deviceScaleFactor: 2 });

  test('blog 63 stills', async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    await beanieModeAndQuietToasts(page);
    const papa = await seedFamily(page);

    await gotoRoute(page, '/who-owns-what');
    await page.getByTestId('first-deal-start').click();
    await page.getByTestId('deal-pile').waitFor();
    await shot(page, 'd-01-pile');

    // Deal the whole deck from the board: mostly the two parents, a few to the kids, a few
    // skipped, the last three left waiting (so the overview has something still to deal).
    await page.getByTestId('deal-mode-board').click();
    await page.getByTestId('deal-board').waitFor();
    const ids = await page
      .locator('[data-testid^="deal-rail-"]')
      .evaluateAll((els) =>
        els.map((e) => e.getAttribute('data-testid')!.slice('deal-rail-'.length))
      );
    console.log('[blog63] cards on the rail:', ids.length);
    const SKIP = [
      'snow-and-ice',
      'potty-training-and-diapers',
      'the-pool',
      'the-fireplace',
      'moving',
      'the-renovation',
    ];
    const LEAVE = ['seeing-my-friends', 'date-nights', 'giving-back'];
    const KIDS: Record<string, string> = {
      'trash-night': PIP,
      plants: PIP,
      'pet-care': PIP,
      dishes: JUNO,
      'kids-bags-for-the-day': JUNO,
      bikes: JUNO,
    };
    let parent = 0;
    for (const id of ids) {
      if (LEAVE.includes(id)) continue;
      const rail = page.getByTestId(`deal-rail-${id}`);
      await rail.scrollIntoViewIfNeeded();
      await rail.click();
      const pick = SKIP.includes(id)
        ? 'deal-board-pick-skip'
        : `deal-board-pick-${KIDS[id] ?? (parent++ % 2 === 0 ? papa : MAMA)}`;
      await page.getByTestId(pick).click();
      await page.waitForTimeout(220);
    }
    await shot(page, 'd-02-board');

    await view(page, 'overview');
    await page.getByTestId('deck-overview').waitFor();
    await shot(page, 'd-03-overview');
    const panels = page.locator('[data-testid="deck-overview"] > div > *');
    for (let i = 0; i < (await panels.count()); i++)
      await panels.nth(i).screenshot({ path: path.join(OUT, `ov-panel-${i}.png`) });

    await view(page, 'deck');
    await shot(page, 'd-04-deck');
    const byBean = page.getByRole('button', { name: /by bean/i });
    if (await byBean.count()) {
      await byBean.first().click();
      await shot(page, 'd-05-deck-by-bean');
      const beans = page.locator('[data-testid="deck-by-bean"] > div');
      for (let i = 0; i < (await beans.count()); i++)
        await beans.nth(i).screenshot({ path: path.join(OUT, `bean-panel-${i}.png`) });
      await page.getByRole('button', { name: /^all$/i }).first().click();
    }

    await page.getByTestId('card-open-cooking-dinner').click();
    await page.getByTestId('card-view-name').waitFor();
    await shot(page, 'd-06-card-drawer');
    await page.keyboard.press('Escape');

    // The same family on a phone.
    await page.setViewportSize({ width: 393, height: 852 });
    await gotoRoute(page, '/who-owns-what');
    await view(page, 'overview');
    await shot(page, 'p-01-overview');
    await view(page, 'deck');
    await shot(page, 'p-02-deck');
    await view(page, 'deal');
    await shot(page, 'p-03-pile');
    await view(page, 'deck');
    await page.getByTestId('card-open-cooking-dinner').click();
    await page.getByTestId('card-view-name').waitFor();
    await shot(page, 'p-04-card-drawer');
  });
});

// ── The phone take: swipe through the pile, keep a card, pick who owns it ────────────────

/**
 * Touch feedback for the recording, driven by the real touch events: a soft dot rides a
 * swipe, and a tap pops a small starburst (a ring and eight rays) where it landed.
 */
async function installFinger(page: Page) {
  await page.addInitScript(() => {
    const ORANGE = '#F15D22';
    const AMBER = '#E67E22';
    const draw = () => {
      if (document.getElementById('__blog_finger')) return;
      const layer = document.createElement('div');
      layer.id = '__blog_finger';
      layer.style.cssText =
        'position:fixed;inset:0;pointer-events:none;z-index:2147483647;overflow:hidden';
      document.body.appendChild(layer);

      const dot = document.createElement('div');
      dot.style.cssText = [
        'position:absolute',
        'width:30px',
        'height:30px',
        'margin:-15px 0 0 -15px',
        'border-radius:50%',
        'background:rgba(241,93,34,0.22)',
        'border:2px solid rgba(241,93,34,0.75)',
        'box-shadow:0 2px 10px rgba(44,62,80,0.25)',
        'opacity:0',
        'transition:opacity .15s ease',
      ].join(';');
      layer.appendChild(dot);

      const burst = (x: number, y: number) => {
        const ring = document.createElement('div');
        ring.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;border:3px solid ${ORANGE};`;
        layer.appendChild(ring);
        ring
          .animate(
            [
              { transform: 'scale(0.5)', opacity: 0.95 },
              { transform: 'scale(2.9)', opacity: 0 },
            ],
            { duration: 520, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' }
          )
          .finished.then(() => ring.remove());
        for (let i = 0; i < 8; i++) {
          const ray = document.createElement('div');
          const long = i % 2 === 0;
          ray.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${long ? 12 : 8}px;height:3.5px;margin:-1.75px 0 0 0;border-radius:3px;background:${long ? ORANGE : AMBER};transform-origin:0 50%;`;
          layer.appendChild(ray);
          const turn = `rotate(${i * 45 + 22.5}deg)`;
          const reach = long ? 34 : 26;
          ray
            .animate(
              [
                { transform: `${turn} translateX(12px) scaleX(0.4)`, opacity: 1 },
                { transform: `${turn} translateX(${reach}px) scaleX(1)`, opacity: 1, offset: 0.55 },
                { transform: `${turn} translateX(${reach + 8}px) scaleX(0.2)`, opacity: 0 },
              ],
              { duration: 480, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' }
            )
            .finished.then(() => ray.remove());
        }
      };

      let start: { x: number; y: number } | null = null;
      let last: { x: number; y: number } | null = null;
      const at = (e: TouchEvent) => {
        const t = e.touches[0] ?? e.changedTouches[0];
        return t ? { x: t.clientX, y: t.clientY } : null;
      };
      const place = (pt: { x: number; y: number }) => {
        dot.style.left = `${pt.x}px`;
        dot.style.top = `${pt.y}px`;
      };
      window.addEventListener(
        'touchstart',
        (e) => {
          start = last = at(e);
          if (start) place(start);
        },
        { capture: true, passive: true }
      );
      window.addEventListener(
        'touchmove',
        (e) => {
          last = at(e) ?? last;
          if (!start || !last) return;
          place(last);
          // Only a real drag shows the dot: a tap gets the starburst instead.
          if (Math.hypot(last.x - start.x, last.y - start.y) > 10) dot.style.opacity = '1';
        },
        { capture: true, passive: true }
      );
      const end = () => {
        const moved = start && last ? Math.hypot(last.x - start.x, last.y - start.y) : 0;
        if (start && moved <= 10) burst(start.x, start.y);
        dot.style.opacity = '0';
        start = last = null;
      };
      window.addEventListener('touchend', end, { capture: true, passive: true });
      window.addEventListener('touchcancel', end, { capture: true, passive: true });
    };
    if (document.body) draw();
    else document.addEventListener('DOMContentLoaded', draw);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function touch(
  cdp: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  x?: number,
  y?: number
) {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x: x!, y: y!, id: 1 }],
  });
}

/** A held tap, long enough for the finger dot to read on camera. */
async function tapAt(cdp: CDPSession, x: number, y: number) {
  await touch(cdp, 'touchStart', x, y);
  await sleep(70);
  await touch(cdp, 'touchEnd');
}

async function tapTestId(page: Page, cdp: CDPSession, testid: string) {
  const box = await page.getByTestId(testid).first().boundingBox({ timeout: 8000 });
  if (!box) throw new Error(`tapTestId: ${testid} has no box`);
  await tapAt(cdp, box.x + box.width / 2, box.y + box.height / 2);
}

async function swipe(cdp: CDPSession, fromX: number, toX: number, y: number) {
  const steps = 14;
  await touch(cdp, 'touchStart', fromX, y);
  await sleep(90);
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    const eased = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    await touch(cdp, 'touchMove', fromX + (toX - fromX) * eased, y + Math.sin(k * Math.PI) * 6);
    await sleep(22);
  }
  await touch(cdp, 'touchEnd');
}

test.describe('blog 63 swipe take', () => {
  test.use({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });

  test('blog 63 swipe take', async ({ page }) => {
    const frames = path.join(OUT, 'take');
    fs.rmSync(frames, { recursive: true, force: true });
    fs.mkdirSync(frames, { recursive: true });
    await installFinger(page);
    await beanieModeAndQuietToasts(page, true);
    // One row of three in the picker: a fourth bean wraps under the bottom nav on a phone.
    const papa = await seedFamily(page, 2);

    await gotoRoute(page, '/who-owns-what');
    await page.getByTestId('first-deal-start').click();
    await page.getByTestId('deal-pile').waitFor();
    await page.getByTestId('deal-pile-progress').evaluate((el) => {
      (el as HTMLElement).style.scrollMarginTop = '72px';
      el.scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, 'take-00-start.png') });

    // Screencast at device pixels (Playwright's own video records CSS pixels only).
    const cdp = await page.context().newCDPSession(page);
    const log: Array<{ file: string; t: number }> = [];
    const marks: Array<{ name: string; t: number }> = [];
    let lastT = 0;
    let n = 0;
    let recording = true;
    cdp.on('Page.screencastFrame', (f) => {
      void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
      if (!recording) return;
      const file = `f-${String(n++).padStart(5, '0')}.jpg`;
      fs.writeFileSync(path.join(frames, file), Buffer.from(f.data, 'base64'));
      lastT = f.metadata.timestamp ?? lastT;
      log.push({ file, t: lastT });
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, everyNthFrame: 1 });
    const mark = (name: string) => marks.push({ name, t: lastT });

    const card = async () => {
      const box = await page.locator('[data-testid^="deal-pile-card-"]').first().boundingBox();
      if (!box) throw new Error('no pile card');
      return box;
    };
    const swipeNext = async () => {
      const b = await card();
      await swipe(cdp, b.x + b.width * 0.82, b.x + b.width * 0.12, b.y + b.height * 0.55);
    };
    const swipePrev = async () => {
      const b = await card();
      await swipe(cdp, b.x + b.width * 0.18, b.x + b.width * 0.88, b.y + b.height * 0.55);
    };
    const tapLocator = async (loc: ReturnType<Page['getByTestId']>) => {
      await loc.scrollIntoViewIfNeeded();
      const box = await loc.boundingBox({ timeout: 8000 });
      if (!box) throw new Error('tapLocator: no box');
      await tapAt(cdp, box.x + box.width / 2, box.y + box.height / 2);
    };
    // The picker's second row sits under the bottom nav on a phone: bring it into view.
    const showPicker = async () => {
      await page.evaluate(() => {
        const el = document.querySelector('[data-testid^="deal-pick-"]')?.parentElement;
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
      await sleep(350);
    };
    const keepFor = async (memberId: string) => {
      await tapTestId(page, cdp, 'deal-pile-keep');
      await page.getByTestId(`deal-pick-${memberId}`).waitFor();
      await showPicker();
      await sleep(350);
      await tapTestId(page, cdp, `deal-pick-${memberId}`);
      await sleep(1050);
    };

    await sleep(700);
    mark('start');
    // Two flicks through the pile, then deal: one to each parent, then one split by child.
    await swipeNext();
    await sleep(550);
    await swipeNext();
    await sleep(650);
    mark('keep-1');
    await keepFor(papa);
    mark('keep-2');
    await keepFor(MAMA);
    mark('split');
    await tapTestId(page, cdp, 'deal-pile-keep');
    await page.getByTestId('deal-pile-split').waitFor();
    await showPicker();
    await sleep(500);
    await tapTestId(page, cdp, 'deal-pile-split');
    const mode = page.getByTestId('card-split-mode');
    await mode.waitFor();
    await sleep(650);
    await tapLocator(mode.getByRole('button', { name: /by child/i }));
    await page.getByTestId('card-part-1').waitFor();
    await sleep(550);
    await tapLocator(
      page
        .getByTestId('card-part-0')
        .getByText(/papa bean/i)
        .first()
    );
    await sleep(450);
    await tapLocator(
      page
        .getByTestId('card-part-1')
        .getByText(/mama bean/i)
        .first()
    );
    await sleep(700);
    // The drawer's Save button (`card-edit-done` is the "what done looks like" field).
    await tapLocator(page.getByRole('button', { name: /^save$/i }));
    await page.getByTestId('card-split-mode').waitFor({ state: 'hidden', timeout: 8000 });
    await sleep(1700);
    mark('end');
    await sleep(900);
    mark('stop');

    recording = false;
    await cdp.send('Page.stopScreencast');
    fs.writeFileSync(path.join(frames, 'frames.json'), JSON.stringify({ log, marks }, null, 2));
    console.log(`[blog63] take: ${log.length} frames, ${(lastT - log[0]!.t).toFixed(1)}s`);
    await page.screenshot({ path: path.join(OUT, 'take-99-end.png') });
  });
});
