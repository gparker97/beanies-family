import { test } from '../../e2e/fixtures/test';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';

/**
 * NOT a test: the browser walk for "the wall header stays one row" (greg, 2026-11-04).
 *
 * On a Lenovo 10" wall (1280x800) Each bean and Today pushed the calendar down by a row while
 * the week view and the chore board did not: those two views keep their step arrows in the
 * header, 24px more than the row had, so the header wrapped from 104px to 176px. A unit test
 * cannot see that (it is flexbox line-breaking), so this walks every view, on today AND on a
 * browsed day (whose label is far longer), at the real tablet viewports, and fails on:
 *   - a LANDSCAPE header on more than one row (portrait may wrap once: date row, controls row);
 *   - controls wrapping among themselves (a third row in portrait);
 *   - the date or the nav label ellipsised, or the controls running off the header.
 *
 * Outside `e2e/specs/` on purpose (see capture.ts):
 *   npx playwright test -c playwright.design.config.ts --grep "wall header rows"
 */

const MEMBERS = [
  { id: 'm-greg', name: 'Greg', color: '#2C3E50', ageGroup: 'adult', gender: 'male' },
  { id: 'm-sofia', name: 'Sofia', color: '#E67E22', ageGroup: 'adult', gender: 'female' },
  { id: 'm-leo', name: 'Leo', color: '#F15D22', ageGroup: 'child', gender: 'male' },
  { id: 'm-milo', name: 'Milo', color: '#3D8FD1', ageGroup: 'child', gender: 'male' },
  { id: 'm-theo', name: 'Theo', color: '#27AE60', ageGroup: 'child', gender: 'male' },
];

function ymd(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

const ACTIVITIES = [
  { t: 'School run', c: 'other_school', s: '07:30', e: '08:00', w: ['m-leo', 'm-milo'], d: 0 },
  { t: 'Football training', c: 'football', s: '16:00', e: '18:00', w: ['m-leo'], d: 0 },
  { t: 'Swimming', c: 'swimming', s: '16:30', e: '17:30', w: ['m-milo'], d: 0 },
  { t: 'Book club', c: 'other_appointment', s: '19:30', e: '20:45', w: ['m-sofia'], d: 0 },
  { t: 'Piano', c: 'music', s: '15:30', e: '16:15', w: ['m-theo'], d: 1 },
  { t: 'Food shop', c: 'other_errand', s: '18:00', e: '19:00', w: ['m-sofia'], d: 1 },
  { t: 'Dentist', c: 'other_appointment', s: '11:00', e: '11:45', w: ['m-theo'], d: 2 },
  { t: 'Grandma visits', c: 'other_social', s: '11:00', e: '14:00', w: [], d: 3 },
];

/** Real tablet viewports: the Lenovo 10" class, iPads, the 8" class, and portrait. */
const SIZES: [number, number][] = [
  [1280, 800], // Lenovo Tab M10 FHD, the reported wall
  [1280, 736], // the same in Chrome, with its toolbar
  [1334, 800], // Lenovo Tab M10 Plus
  [1180, 820], // iPad Air / 10th gen
  [1133, 744], // iPad mini
  [1024, 768], // iPad 9th gen
  [962, 601], // Lenovo Tab M10 HD, Fire HD 8
  [853, 533], // Lenovo Tab M8
  [800, 1280], // portrait
  [533, 853], // portrait, 8"
];

test.describe('design screenshots', () => {
  test('wall header rows', async ({ page }) => {
    test.setTimeout(280_000);

    await gotoRoot(page);
    const db = new IndexedDBHelper(page);
    await db.clearAllData();
    await gotoRoot(page);
    await bypassLoginIfNeeded(page);
    await page.evaluate(() => localStorage.setItem('beanies:flag:beanieWall', 'true'));

    await gotoRoute(page, '/activities');
    await page.getByTestId('app-content').waitFor({ state: 'visible', timeout: 30000 });

    const stamp = new Date().toISOString();
    const seeded = await page.evaluate(
      async ({ members, activities, at, dates }) => {
        const bridge = (
          window as unknown as {
            __e2eDataBridge?: { seedData: (d: unknown) => Promise<void> };
          }
        ).__e2eDataBridge;
        if (!bridge) return { error: 'no bridge' };
        await bridge.seedData({
          familyMembers: members.map((m) => ({
            ...m,
            email: `${m.id}@example.invalid`,
            role: 'member',
            requiresPassword: false,
            createdAt: at,
            updatedAt: at,
          })),
          /*
           * Chores, so the chore board renders real COLUMNS. The board groups
           * by list, not by loose to-dos — a to-do with no list produces no
           * group and the board shows its empty state, which is how the first
           * attempt here "verified" a header it never rendered.
           */
          lists: ['m-greg', 'm-sofia', 'm-leo', 'm-milo'].map((who, li) => ({
            id: `w96-l-${li}`,
            title: ['Morning jobs', 'Before school', 'Bedroom', 'Kitchen'][li],
            emoji: ['🧹', '🎒', '🛏️', '🍽️'][li],
            category: 'chores',
            ownerId: who,
            lifecycle: 'recurring',
            items: [
              'Make the bed',
              'Reading, 20 min',
              'Tidy the room',
              'Feed the cat',
              'Empty the bins',
            ].map((title, ii) => ({
              id: `w96-li-${li}-${ii}`,
              title,
              isCompleted: false,
              createdAt: at,
              updatedAt: at,
            })),
            createdAt: at,
            updatedAt: at,
          })),
          activities: activities.map((a, i) => ({
            id: `w96-a-${i}`,
            title: a.t,
            category: a.c,
            date: dates[a.d],
            startTime: a.s,
            endTime: a.e,
            isAllDay: false,
            // `assigneeIds`, not `withMemberIds`; and `isActive` is REQUIRED —
            // `activeActivities` filters on it, so an activity without it is in
            // the document, in the store, and invisible everywhere. The first
            // run of this harness lost an hour to exactly that, as did
            // `wall-grid-capture.ts` before it.
            assigneeIds: a.w,
            recurrence: 'none',
            isActive: true,
            createdAt: at,
            updatedAt: at,
          })),
        });
        return { ok: true };
      },
      {
        members: MEMBERS,
        activities: ACTIVITIES,
        at: stamp,
        dates: [ymd(0), ymd(1), ymd(2), ymd(3)],
      }
    );
    if ('error' in seeded) throw new Error(`[hdr] seeding failed: ${seeded.error}`);

    /*
     * ⭐ Prove the seed landed BEFORE measuring anything.
     *
     * The first run of this harness passed all six viewports against a wall
     * showing "Nothing on" in every column, because geometry checks are happy on
     * an empty grid. `capture.ts` and `wall-grid-capture.ts` both carry a version
     * of this guard after the same mistake; a harness that asserts nothing about
     * its own fixture is how blank frames get reviewed and approved.
     */
    await page.waitForTimeout(1500);
    const inDoc = await page.evaluate(() => {
      const bridge = (
        window as unknown as { __e2eDataBridge?: { exportData: () => Record<string, unknown[]> } }
      ).__e2eDataBridge;
      const d = bridge?.exportData();
      return { members: d?.familyMembers?.length ?? -1, activities: d?.activities?.length ?? -1 };
    });
    if (inDoc.activities < ACTIVITIES.length || inDoc.members < MEMBERS.length) {
      throw new Error(
        `[hdr] the fixture did not land: ${inDoc.activities} activities (want ` +
          `${ACTIVITIES.length}), ${inDoc.members} members (want ${MEMBERS.length}). ` +
          `Measuring an empty wall proves nothing.`
      );
    }

    await page.waitForTimeout(2500);

    /*
     * A FULL navigation, deliberately.
     *
     * An in-app `pushState` kept the seeded doc but left the stores hydrated from
     * before the seed: `exportData()` reported six members and eight activities
     * while the wall rendered "Nothing on" in every column and one member chip —
     * and every geometry assertion passed against that empty grid.
     *
     * The bridge pre-stages the Automerge binary to sessionStorage on unload and
     * `App.vue` restores it (see `src/services/e2e/dataBridge.ts`), so a reload is
     * supported here and is what re-hydrates the stores from the seeded document.
     */
    await gotoRoute(page, '/wall');
    await page.locator('.wall-root').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(2500);

    /*
     * ⭐ And prove the wall is actually DRAWING the fixture. The document having
     * the data is not the same as the page rendering it, which is the exact gap
     * that made the first passing run meaningless.
     */
    const blocks = await page.locator('.wall-tblock').count();
    if (blocks === 0) {
      await page.screenshot({ path: 'scratch-shots/hdr-DEBUG-empty.png' });
      throw new Error('[hdr] the wall rendered no time blocks — measuring an empty grid');
    }

    const diag = await page.evaluate(() => {
      const bridge = (
        window as unknown as { __e2eDataBridge?: { exportData: () => Record<string, any[]> } }
      ).__e2eDataBridge;
      const d = bridge?.exportData();
      return {
        url: location.pathname,
        members: (d?.familyMembers ?? []).map((m: any) => m.name),
        acts: (d?.activities ?? []).slice(0, 3).map((a: any) => ({
          t: a.title,
          date: a.date,
          s: a.startTime,
          cat: a.category,
          w: a.withMemberIds,
        })),
        blocks: document.querySelectorAll('.wall-tblock').length,
      };
    });
    // eslint-disable-next-line no-console
    console.log('[hdr][diag]', JSON.stringify(diag));

    const failures: string[] = [];
    for (const [w, h] of SIZES) {
      const landscape = w > h;
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(800);
      const views = await page.evaluate(() => document.querySelectorAll('.wall-switch-btn').length);
      for (let i = 0; i < views; i += 1) {
        // Dispatched, not clicked (see wall-small-tablet-capture.ts); the pointerdown keeps the
        // wall awake so the idle timer cannot drop it onto the night face mid-walk.
        await page.evaluate((idx) => {
          document.querySelector<HTMLElement>('.wall-night-time')?.parentElement?.click(); // wake
          document
            .querySelector('.wall-root')
            ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
          (document.querySelectorAll('.wall-switch-btn')[idx] as HTMLElement | undefined)?.click();
        }, i);
        await page.waitForTimeout(600);
        const hasArrows = await page.evaluate(
          () => !!document.querySelector('.wall-header .wall-nav-arrow')
        );
        for (const browse of hasArrows ? [false, true] : [false]) {
          if (browse) {
            await page.evaluate(() =>
              (document.querySelectorAll('.wall-header .wall-nav-arrow')[1] as HTMLElement)?.click()
            );
            await page.waitForTimeout(500);
          }
          const m = await page.evaluate(() => {
            const root = document.querySelector('.wall-root') as HTMLElement;
            const q = (s: string) => root.querySelector(s) as HTMLElement | null;
            const header = q('.wall-header')!.getBoundingClientRect();
            const title = q('.wall-header-title')!.getBoundingClientRect();
            const ctrls = q('.wall-header-controls')!;
            const c = ctrls.getBoundingClientRect();
            const kids = [...ctrls.children].map((k) => k.getBoundingClientRect());
            // The text's real laid-out width against the box, in fractional px. `scrollWidth`
            // rounds, and a label short by half a pixel still renders as "Tod…".
            const clip = (el: HTMLElement | null) => {
              if (!el || !el.offsetParent) return 0;
              const range = document.createRange();
              range.selectNodeContents(el);
              const text = range.getBoundingClientRect().width;
              const box = el.getBoundingClientRect().width;
              return Math.round((text - box) * 10) / 10;
            };
            return {
              view: q('.wall-switch-btn[aria-pressed="true"]')?.getAttribute('aria-label') ?? '?',
              header: Math.round(header.height),
              wrapped: c.top >= title.bottom - 1,
              // A child that starts below another one's bottom sits on a later line.
              ctrlWrapped: kids.some((k) => kids.some((o) => k.top >= o.bottom - 1)),
              date: q('.wall-date')?.textContent?.trim(),
              dateClip: clip(q('.wall-date')),
              labelClip: clip(q('.wall-nav-label')),
              subtitle: q('.wall-subtitle')?.textContent?.replace(/\s+/g, ' ').trim(),
              subClip: clip(q('.wall-subtitle')),
              overX: Math.round(c.right - header.right),
              // Today's way back lives in the header (it had a row of its own over the grid).
              backInHeader: !!q('.wall-header .wall-back'),
              plotTop: Math.round(q('.wall-plot')?.getBoundingClientRect().top ?? -1),
            };
          });
          const where = `${w}x${h} ${m.view}${browse ? ' (browsing)' : ''}`;
          console.log(`[hdr] ${where} ${JSON.stringify(m)}`);
          await page.screenshot({
            path: `scratch-shots/hdr-${w}x${h}-v${i}${browse ? 'b' : ''}.png`,
          });
          if (landscape && m.wrapped) failures.push(`${where}: header wrapped (${m.header}px)`);
          if (m.ctrlWrapped) failures.push(`${where}: the controls wrapped among themselves`);
          if (m.dateClip > 0.5) failures.push(`${where}: date "${m.date}" clipped ${m.dateClip}px`);
          if (m.labelClip > 0.5) failures.push(`${where}: nav label clipped ${m.labelClip}px`);
          if (m.subClip > 0.5)
            failures.push(`${where}: subtitle "${m.subtitle}" clipped ${m.subClip}px`);
          // Reached from Each bean, so Today always has somewhere to go back to.
          if (m.view === 'Today' && !m.backInHeader)
            failures.push(`${where}: the way back is not in the header`);
          if (m.overX > 1) failures.push(`${where}: controls overrun the header by ${m.overX}px`);
          if (browse) {
            await page.evaluate(() =>
              (document.querySelector('.wall-nav-today') as HTMLElement)?.click()
            );
            await page.waitForTimeout(400);
          }
        }
      }
    }
    // One dark pass over the reported wall, so the header pill is seen on the dark ground too.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    for (const i of [1, 2]) {
      await page.evaluate((idx) => {
        document.querySelector<HTMLElement>('.wall-night-time')?.parentElement?.click(); // wake
        (document.querySelectorAll('.wall-switch-btn')[idx] as HTMLElement | undefined)?.click();
      }, i);
      await page.waitForTimeout(700);
      await page.screenshot({ path: `scratch-shots/hdr-1280x800-v${i}-dark.png` });
    }
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    if (failures.length) throw new Error(`[hdr]\n  ${failures.join('\n  ')}`);
  });
});
