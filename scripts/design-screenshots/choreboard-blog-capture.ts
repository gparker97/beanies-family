import { test, expect } from '../../e2e/fixtures/test';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * NOT a test: captures the blog #72 choreboard media (a screencast of the wall's chore lanes
 * ending in a block celebration, and stills of the Star Report and Rewards views). Run it
 * deliberately against a dev server:
 *   npx playwright test -c playwright.design.config.ts --grep "choreboard blog"
 * Output: scratch-shots/choreboard-blog/ (gitignored). Set CAPTURE_OUT to write elsewhere.
 */

const OUT = process.env.CAPTURE_OUT ?? path.join(process.cwd(), 'scratch-shots', 'choreboard-blog');
const TODAY = '2026-11-22'; // a Sunday: the day the beanies parachute in (moveForDate)
const WEEK = '2026-11-16'; // its Monday (weekStartDay 1)
const NOW = new Date(`${TODAY}T16:10:00`);

const MAMA = 'blog-mama';
const PIP = 'blog-pip';
const JUNO = 'blog-juno';
const MILO = 'blog-milo';
const KIDS = [PIP, JUNO, MILO];

type Block = 'morning' | 'afternoon' | 'evening' | 'anytime';
interface Def {
  id: string;
  title: string;
  emoji: string;
  block: Block;
  who: string[];
  stars?: number;
  illustration?: string;
}

const CHORES: Def[] = [
  { id: 'c-bed', title: 'Make your bed', emoji: '🛏️', block: 'morning', who: KIDS },
  { id: 'c-dress', title: 'Get dressed', emoji: '👕', block: 'morning', who: KIDS },
  { id: 'c-teeth-am', title: 'Brush teeth', emoji: '🪥', block: 'morning', who: KIDS },
  { id: 'c-breakfast', title: 'Eat breakfast', emoji: '🥣', block: 'morning', who: KIDS },
  {
    id: 'c-bag',
    title: 'Pack your school bag',
    emoji: '🎒',
    block: 'morning',
    who: KIDS,
    illustration: 'school-drop-off',
  },
  { id: 'c-lunchbox', title: 'Unpack your lunchbox', emoji: '🥪', block: 'afternoon', who: KIDS },
  { id: 'c-homework', title: 'Homework', emoji: '✏️', block: 'afternoon', who: KIDS, stars: 2 },
  {
    id: 'c-read',
    title: 'Read for 30 minutes',
    emoji: '📚',
    block: 'afternoon',
    who: KIDS,
    stars: 3,
  },
  { id: 'c-dog', title: 'Walk the dog', emoji: '🐕', block: 'afternoon', who: [PIP], stars: 2 },
  {
    id: 'c-piano',
    title: 'Practice piano',
    emoji: '🎹',
    block: 'afternoon',
    who: [JUNO],
    stars: 2,
  },
  { id: 'c-fish', title: 'Feed the fish', emoji: '🐠', block: 'afternoon', who: [MILO] },
  { id: 'c-bath', title: 'Bath time', emoji: '🛁', block: 'evening', who: KIDS },
  {
    id: 'c-pjs',
    title: 'Pajamas on',
    emoji: '🌙',
    block: 'evening',
    who: KIDS,
    illustration: 'bedtime-routine',
  },
  { id: 'c-teeth-pm', title: 'Brush teeth', emoji: '🪥', block: 'evening', who: KIDS },
  {
    id: 'c-clothes',
    title: 'Lay out clothes for tomorrow',
    emoji: '👕',
    block: 'evening',
    who: KIDS,
  },
  { id: 'c-toys', title: 'Put your toys away', emoji: '🧸', block: 'anytime', who: KIDS },
  {
    id: 'c-hamper',
    title: 'Dirty clothes in the hamper',
    emoji: '🧺',
    block: 'anytime',
    who: KIDS,
    illustration: 'laundry',
  },
  { id: 'c-plants', title: 'Water the plants', emoji: '🪴', block: 'anytime', who: [JUNO] },
  {
    id: 'c-trash',
    title: 'Take out the trash',
    emoji: '🗑️',
    block: 'anytime',
    who: [PIP],
    stars: 2,
    illustration: 'trash-night',
  },
];

/** Today's ticks before the camera rolls (morning is all done for everyone). */
const DONE_TODAY: Record<string, string[]> = {
  [PIP]: ['c-lunchbox', 'c-homework', 'c-toys'],
  [JUNO]: ['c-lunchbox', 'c-piano', 'c-toys', 'c-hamper'],
  [MILO]: ['c-lunchbox', 'c-fish'],
};
/**
 * Ticked on camera, in order. Only the last finishes a block (Milo's afternoon), so the
 * parachutes play once, at the end.
 */
const TICKS_ON_CAMERA: Array<[string, string]> = [
  [PIP, 'Walk the dog'],
  [JUNO, 'Homework'],
  [MILO, 'Homework'],
  [MILO, 'Read for 30 minutes'],
];
/**
 * The showcase still: a fuller board in greg's own chore wording, each kid at a different point
 * on the way to the weekly reward, and Milo one tick from finishing his afternoon.
 */
const SHOW_CHORES: Def[] = [
  { id: 's-bed', title: 'Make your bed', emoji: '🛏️', block: 'morning', who: KIDS },
  { id: 's-dress', title: 'Get dressed', emoji: '👕', block: 'morning', who: KIDS },
  {
    id: 's-bag',
    title: 'Pack your school bag',
    emoji: '🎒',
    block: 'morning',
    who: KIDS,
    illustration: 'school-drop-off',
  },
  { id: 's-homework', title: 'Homework', emoji: '✏️', block: 'afternoon', who: KIDS, stars: 2 },
  {
    id: 's-read',
    title: 'Read for 30 minutes',
    emoji: '📚',
    block: 'afternoon',
    who: KIDS,
    stars: 3,
  },
  {
    id: 's-soccer',
    title: 'Soccer practice',
    emoji: '⚽',
    block: 'afternoon',
    who: [PIP],
    stars: 2,
  },
  {
    id: 's-chinese',
    title: 'Chinese lesson',
    emoji: '🀄',
    block: 'afternoon',
    who: [PIP, JUNO],
    stars: 2,
  },
  {
    id: 's-piano',
    title: 'Practice piano',
    emoji: '🎹',
    block: 'afternoon',
    who: [JUNO],
    stars: 2,
  },
  {
    id: 's-softball',
    title: 'Softball practice',
    emoji: '🥎',
    block: 'afternoon',
    who: [JUNO, PIP],
    stars: 2,
  },
  { id: 's-swim', title: 'Swim lesson', emoji: '🏊', block: 'afternoon', who: [MILO], stars: 2 },
  { id: 's-taekwondo', title: 'Taekwondo', emoji: '🥋', block: 'afternoon', who: [MILO], stars: 2 },
  { id: 's-art', title: 'Art class', emoji: '🎨', block: 'afternoon', who: [MILO], stars: 2 },
  {
    id: 's-room',
    title: 'Clean your room without complaining',
    emoji: '🧹',
    block: 'anytime',
    who: KIDS,
    stars: 3,
  },
  {
    id: 's-teeth',
    title: "Brush your teeth when you're told",
    emoji: '🪥',
    block: 'anytime',
    who: KIDS,
  },
  {
    id: 's-hamper',
    title: 'Put your clothes in the hamper',
    emoji: '🧺',
    block: 'anytime',
    who: KIDS,
    illustration: 'laundry',
  },
  {
    id: 's-dinner',
    title: 'Eat ALL your dinner',
    emoji: '🍽️',
    block: 'anytime',
    who: KIDS,
    stars: 2,
  },
  { id: 's-dog', title: 'Walk the dog', emoji: '🐕', block: 'anytime', who: [PIP], stars: 2 },
  { id: 's-plants', title: 'Water the plants', emoji: '🪴', block: 'anytime', who: [JUNO] },
  { id: 's-fish', title: 'Feed the fish', emoji: '🐠', block: 'anytime', who: [MILO] },
  { id: 's-bath', title: 'Bath time', emoji: '🛁', block: 'evening', who: KIDS },
  {
    id: 's-pjs',
    title: 'Pajamas on',
    emoji: '🌙',
    block: 'evening',
    who: KIDS,
    illustration: 'bedtime-routine',
  },
];
const SHOW_DONE: Record<string, string[]> = {
  [PIP]: ['s-homework', 's-soccer', 's-softball', 's-room', 's-teeth', 's-dog'],
  [JUNO]: ['s-homework', 's-read', 's-piano', 's-hamper'],
  [MILO]: ['s-homework', 's-read', 's-swim', 's-taekwondo', 's-teeth', 's-fish'],
};
/** Share of Monday to Saturday chores done: one past the bar, one close, one behind. */
const SHOW_RATE: Record<string, number> = { [PIP]: 0.97, [JUNO]: 0.84, [MILO]: 0.6 };

/** Real time, unaffected by the page's installed clock. */
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shift = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return ymd(d);
};

/** Deterministic pseudo-random, so a re-run captures the same week. */
let seed = 7;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

/**
 * `wall`: the gif's variant. One big special reward (Disneyland, 1,000 stars) saved towards over
 * six closed weeks, so the stars sheet a head opens shows real progress. The stills keep the
 * three-week seed with the two smaller rewards the post talks about.
 */
async function seedFamily(
  page: Page,
  variant: 'report' | 'wall' = 'report',
  show?: { chores: Def[]; doneToday: Record<string, string[]>; rate: Record<string, number> }
) {
  const list = show?.chores ?? list;
  const doneToday = show?.doneToday ?? DONE_TODAY;
  const closedWeeks = variant === 'wall' ? 6 : 3;
  const firstWeek = shift(WEEK, -7 * closedWeeks);
  await gotoRoot(page);
  await bypassLoginIfNeeded(page, { familyName: 'The Bean Family' });
  const db = new IndexedDBHelper(page);
  const before = await db.exportData();
  const owner = before.familyMembers[0]!;
  const OWNER = owner.id as string;
  const now = new Date(`${TODAY}T07:00:00`).toISOString();
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

  const chores = list.map((c, i) => ({
    id: c.id,
    title: c.title,
    emoji: c.emoji,
    ...(c.illustration ? { illustration: c.illustration } : {}),
    assigneeIds: c.who,
    block: c.block,
    sortOrder: i,
    ...(c.stars ? { stars: c.stars } : {}),
    createdBy: OWNER,
    createdAt: '2026-10-20T08:00:00.000Z',
    updatedAt: '2026-10-20T08:00:00.000Z',
  }));

  const marks: Record<string, unknown>[] = [];
  const mark = (kind: 'done' | 'celebrated', member: string, day: string, ref: string) =>
    marks.push({
      id: `${kind}:${member}:${day}:${ref}`,
      kind,
      memberId: member,
      date: day,
      ref,
      by: member,
      createdAt: `${day}T10:00:00.000Z`,
      updatedAt: `${day}T10:00:00.000Z`,
    });
  // Monday to Saturday: most chores done, a few missed.
  for (let d = 0; d < 6; d++) {
    const day = shift(WEEK, d);
    for (const kid of KIDS) {
      for (const c of list.filter((x) => x.who.includes(kid))) {
        if (rand() < (show?.rate[kid] ?? 0.86)) mark('done', kid, day, c.id);
      }
    }
  }
  // Today: morning done and celebrated, plus the afternoon/anytime ticks above.
  for (const kid of KIDS) {
    for (const c of list.filter((x) => x.block === 'morning')) mark('done', kid, TODAY, c.id);
    mark('celebrated', kid, TODAY, 'morning');
    // The weekly reward's achieved banner already played earlier in the week.
    mark('celebrated', kid, WEEK, 'reward');
    for (const id of doneToday[kid]!) mark('done', kid, TODAY, id);
  }

  // Three closed weeks before this one, frozen, for the report's trend.
  const fullOf = (kid: string) =>
    7 * list.filter((c) => c.who.includes(kid)).reduce((s, c) => s + (c.stars ?? 1), 0);
  const dueOf = (kid: string) => 7 * list.filter((c) => c.who.includes(kid)).length;
  const weeks: Record<string, unknown>[] = [];
  const share: Record<string, number[]> = {
    [PIP]: [0.88, 0.79, 0.93],
    [JUNO]: [0.94, 0.97, 0.76],
    [MILO]: [0.72, 0.84, 0.86],
  };
  Array.from({ length: closedWeeks }, (_, i) => i).forEach((n) => {
    const ws = shift(firstWeek, 7 * n);
    const wi = n % 3;
    for (const kid of KIDS) {
      const full = fullOf(kid);
      const bar = Math.round(full * 0.8);
      const stars = Math.round(full * share[kid]![wi]!);
      const per = full / 7;
      const days = Array.from({ length: 7 }, () => 0);
      let left = stars;
      for (let i = 0; i < 7; i++) {
        const v =
          i === 6
            ? left
            : Math.min(left, Math.round(per * (share[kid]![wi]! + (rand() - 0.5) * 0.2)));
        days[i] = Math.max(0, Math.min(Math.round(per), v));
        left -= days[i]!;
      }
      days[6] = Math.max(0, days[6]! + left);
      let run = 0;
      let hitOn: string | undefined;
      days.forEach((v, i) => {
        run += v;
        if (!hitOn && run >= bar) hitOn = shift(ws, i);
      });
      const due = dueOf(kid);
      weeks.push({
        id: `${kid}:${ws}`,
        memberId: kid,
        weekStart: ws,
        done: Math.round(due * share[kid]![wi]!),
        due,
        stars: days.reduce((a, b) => a + b, 0),
        bonus: 0,
        full,
        bar,
        days,
        ...(hitOn ? { hitOn } : {}),
        marks: 0,
        createdAt: `${shift(ws, 7)}T00:05:00.000Z`,
        updatedAt: `${shift(ws, 7)}T00:05:00.000Z`,
      });
    }
  });

  const awardBase = {
    createdBy: OWNER,
    createdAt: '2026-10-26T09:00:00.000Z',
    updatedAt: '2026-10-26T09:00:00.000Z',
  };
  const disneyland = {
    id: 'award-disneyland',
    title: 'Disneyland',
    emoji: '🏰',
    kind: 'saved',
    unit: 'stars',
    price: 1000,
    repeats: false,
    weekStart: firstWeek,
    ...awardBase,
  };
  const reportAwards = [
    {
      id: 'award-icecream',
      title: 'Bubble Gum Ice Cream',
      emoji: '🍦',
      kind: 'saved',
      unit: 'stars',
      price: 120,
      repeats: true,
      weekStart: WEEK,
      ...awardBase,
    },
    {
      id: 'award-funzone',
      title: 'Fun Zone Indoor Playground',
      emoji: '🛝',
      kind: 'saved',
      unit: 'weeks',
      price: 4,
      repeats: true,
      weekStart: shift(WEEK, -21),
      ...awardBase,
    },
  ];
  const choreAwards = show
    ? [disneyland, ...reportAwards]
    : variant === 'wall'
      ? [disneyland]
      : reportAwards;

  const gift = (id: string, kid: string, day: string, stars: number, note: string) => ({
    id,
    memberId: kid,
    date: day,
    stars,
    by: OWNER,
    note,
    createdAt: `${day}T18:00:00.000Z`,
    updatedAt: `${day}T18:00:00.000Z`,
  });
  const choreStarGifts = [
    gift('gift-1', PIP, shift(WEEK, 1), 2, 'Helped carry in the groceries'),
    gift('gift-2', JUNO, shift(WEEK, 2), 1, 'So kind to her little brother'),
    gift('gift-3', MILO, shift(WEEK, 2), -1, 'Fighting over the iPad'),
  ];

  await db.seedData({
    familyMembers: [
      { ...owner, name: 'Papa Bean', gender: 'male', ageGroup: 'adult' } as never,
      bean(MAMA, 'Mama Bean', '#E67E22', 'female', 'adult'),
      bean(PIP, 'Pip', '#10b981', 'male', 'child'),
      bean(JUNO, 'Juno', '#ec4899', 'female', 'child'),
      bean(MILO, 'Milo', '#3b82f6', 'male', 'child'),
    ],
    chores,
    choreMarks: marks,
    choreWeeks: weeks,
    choreAwards,
    choreStarGifts,
    settings: {
      ...(before.settings ?? {}),
      weekStartDay: 1,
      choreRewards: {
        on: true,
        startedOn: firstWeek,
        weeklyOn: true,
        title: 'Beanie Allowance',
        emoji: '💰',
        barPct: 80,
      },
    },
  } as never);
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

/** CDP screencast: every painted frame as a JPEG with its timestamp. */
async function screencast(page: Page, dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames: Array<{ file: string; t: number }> = [];
  cdp.on('Page.screencastFrame', async (f) => {
    const file = path.join(dir, `f${String(frames.length).padStart(5, '0')}.jpg`);
    fs.writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, t: f.metadata.timestamp ?? Date.now() / 1000 });
    await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, everyNthFrame: 1 });
  return async () => {
    await cdp.send('Page.stopScreencast');
    fs.writeFileSync(path.join(dir, 'frames.json'), JSON.stringify(frames));
    return frames.length;
  };
}

/** A screencast shows no pointer, so a tap gets a ring drawn where the finger lands. */
async function tapRing(page: Page, target: ReturnType<Page['locator']>) {
  const box = await target.boundingBox();
  if (!box) return;
  await page.evaluate(
    ({ x, y }) => {
      const ring = document.createElement('div');
      ring.style.cssText = `position:fixed;left:${x - 34}px;top:${y - 34}px;width:68px;height:68px;border-radius:50%;background:rgba(241,93,34,.28);border:3px solid rgba(241,93,34,.85);z-index:99999;pointer-events:none;`;
      document.body.appendChild(ring);
      ring.animate(
        [
          { transform: 'scale(.35)', opacity: 0 },
          { transform: 'scale(1)', opacity: 1, offset: 0.35 },
          { transform: 'scale(1.25)', opacity: 0 },
        ],
        { duration: 900, easing: 'ease-out', fill: 'forwards' }
      );
      setTimeout(() => ring.remove(), 950);
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  );
}

test.describe('choreboard blog', () => {
  test('choreboard blog wall gif', async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
    page.setDefaultTimeout(20000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.clock.install({ time: NOW });
    await seedFamily(page, 'wall');

    await gotoRoute(page, '/wall');
    await settled(page);
    await page.getByTestId('wall-card-chores').first().click();
    await page.getByTestId('wall-chores-view').waitFor();
    await page.waitForTimeout(2500);
    console.log(
      '[blog] blocks:',
      await page
        .locator('[data-testid="wall-chore-block"]')
        .evaluateAll((els) =>
          els.map((e) => `${e.getAttribute('data-block')}/${e.getAttribute('data-state')}`)
        )
    );
    await page.screenshot({ path: path.join(OUT, 'wall-before.png') });

    const stop = await screencast(page, path.join(OUT, 'wall-frames'));
    await pause(700);
    for (const [i, [member, title]] of TICKS_ON_CAMERA.entries()) {
      const lane = page.locator(`[data-testid="wall-chore-lane"][data-member="${member}"]`);
      await lane.getByRole('button', { name: title, exact: true }).first().click();
      await pause(i === TICKS_ON_CAMERA.length - 1 ? 6200 : 850);
    }
    // Then a tap on the head of the bean who just finished: their stars sheet (#154).
    const head = page
      .locator(`[data-testid="wall-chore-lane"][data-member="${MILO}"]`)
      .getByTestId('wall-chore-lane-head-button');
    await tapRing(page, head);
    await pause(450);
    await head.click();
    await pause(4600);
    console.log('[blog] frames:', await stop());
    await page.screenshot({ path: path.join(OUT, 'wall-after.png') });
    expect(true).toBe(true);
  });
});

test.describe('choreboard blog showcase', () => {
  test.use({ deviceScaleFactor: 2, viewport: { width: 1440, height: 1150 } });

  test('choreboard blog showcase still', async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
    page.setDefaultTimeout(20000);
    await page.clock.install({ time: NOW });
    await seedFamily(page, 'wall', { chores: SHOW_CHORES, doneToday: SHOW_DONE, rate: SHOW_RATE });

    await gotoRoute(page, '/wall');
    await settled(page);
    await page.getByTestId('wall-card-chores').first().click();
    await page.getByTestId('wall-chores-view').waitFor();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, 'showcase-before.png') });
    // Milo's last afternoon chore: the parachutes, caught at several moments to pick from.
    await page
      .locator(`[data-testid="wall-chore-lane"][data-member="${MILO}"]`)
      .getByRole('button', { name: 'Art class', exact: true })
      .first()
      .click();
    for (const [i, ms] of [1700, 150, 150, 150, 150, 150].entries()) {
      await pause(ms);
      await page.screenshot({ path: path.join(OUT, `showcase-${i}.png`) });
    }
    expect(true).toBe(true);
  });
});

test.describe('choreboard blog showcase pages', () => {
  test.use({ deviceScaleFactor: 2, viewport: { width: 1180, height: 1400 } });

  test('choreboard blog showcase summary', async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
    page.setDefaultTimeout(20000);
    await page.clock.install({ time: NOW });
    await seedFamily(page, 'wall', { chores: SHOW_CHORES, doneToday: SHOW_DONE, rate: SHOW_RATE });
    for (const [name, route] of [
      ['showcase-home', '/choreboard'],
      ['showcase-report', '/choreboard?view=report'],
    ] as const) {
      await gotoRoute(page, route);
      await settled(page);
      await page.waitForTimeout(1800);
      await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
    }
    expect(true).toBe(true);
  });
});

test.describe('choreboard blog showcase desktop', () => {
  test.use({ deviceScaleFactor: 2, viewport: { width: 1840, height: 1540 } });

  test('choreboard blog showcase dashboard', async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
    page.setDefaultTimeout(20000);
    await page.clock.install({ time: NOW });
    await seedFamily(page, 'wall', { chores: SHOW_CHORES, doneToday: SHOW_DONE, rate: SHOW_RATE });
    // Both pages from ONE seed, so the numbers agree between the two images.
    for (const [name, route] of [
      ['showcase-dashboard', '/choreboard'],
      ['showcase-dashboard-report', '/choreboard?view=report'],
      ['showcase-dashboard-rewards', '/choreboard?view=rewards'],
    ] as const) {
      await gotoRoute(page, route);
      await settled(page);
      await page.waitForTimeout(2000);
      await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    }
    expect(true).toBe(true);
  });
});

test.describe('choreboard blog showcase parts', () => {
  test.use({ deviceScaleFactor: 2, viewport: { width: 1840, height: 2300 } });

  /** The montage's five cards, each shot on its own from ONE seed (composed outside the app). */
  test('choreboard blog showcase montage parts', async ({ page }) => {
    const dir = path.join(OUT, 'parts');
    fs.mkdirSync(dir, { recursive: true });
    page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
    page.setDefaultTimeout(20000);
    await page.clock.install({ time: NOW });
    await seedFamily(page, 'wall', { chores: SHOW_CHORES, doneToday: SHOW_DONE, rate: SHOW_RATE });
    const shot = (name: string, target: ReturnType<Page['locator']>) =>
      target.first().screenshot({ path: path.join(dir, `${name}.png`) });

    await gotoRoute(page, '/choreboard?view=rewards');
    await settled(page);
    await page.waitForTimeout(2000);
    await shot('worth', page.getByTestId('chore-rewards-worth'));
    await shot('weekly', page.getByTestId('chore-rewards-weekly'));
    const awards = page
      .getByTestId('chore-rewards-add-award')
      .locator('xpath=ancestor::section[1]');
    await awards.evaluate((el) => {
      (el as HTMLElement).style.width = '400px';
    });
    await page.waitForTimeout(400);
    await shot('awards', awards);

    await gotoRoute(page, '/choreboard');
    await settled(page);
    await page.waitForTimeout(2000);
    await shot('done', page.getByTestId('chore-week-panel'));
    await shot('week', page.getByTestId('chore-week-summary'));

    await gotoRoute(page, '/choreboard?view=report');
    await settled(page);
    await page.waitForTimeout(2000);
    const special = page
      .getByTestId('star-report-rewards-settings')
      .locator('xpath=ancestor::*[contains(@class,"rounded-3xl")][1]');
    // Drawn wider than its report column, so it fills the montage's bottom row.
    await special.evaluate((el) => {
      (el as HTMLElement).style.width = '760px';
      (el as HTMLElement).style.maxWidth = 'none';
    });
    await page.waitForTimeout(400);
    await shot('special', special);
    expect(true).toBe(true);
  });
});

test.describe('choreboard blog stills', () => {
  test.use({ deviceScaleFactor: 2, viewport: { width: 1180, height: 1400 } });

  test('choreboard blog star report', async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
    page.setDefaultTimeout(20000);
    await page.clock.install({ time: NOW });
    await seedFamily(page);

    await gotoRoute(page, '/choreboard?view=report');
    await settled(page);
    await page.getByTestId('star-report-view').waitFor();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, 'report-full.png'), fullPage: true });

    await gotoRoute(page, '/choreboard?view=rewards');
    await settled(page);
    await page.getByTestId('chore-rewards-view').waitFor();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, 'rewards-full.png'), fullPage: true });

    await gotoRoute(page, '/choreboard');
    await settled(page);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, 'home-full.png'), fullPage: true });
    expect(true).toBe(true);
  });
});
