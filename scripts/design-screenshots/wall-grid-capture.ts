import { test } from '../../e2e/fixtures/test';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';

/**
 * NOT a test — a screenshot harness for reviewing the beanie wall's time grid.
 *
 * It exists because the grid's defects are the kind reasoning does not catch. A
 * working prototype of this same algorithm shipped four separate layout bugs
 * that were invisible in code and obvious in a screenshot: a fold that silently
 * stopped firing, a fold rule that ran away and chopped one honest fold into
 * five, a real overlap that pushed every later block out of alignment, and a
 * now-line drawn through the title of the event it was marking.
 *
 * Seeds a realistic week: a shared school run, a genuine 16:00 collision, a long
 * event that must hit the cap, all-day items of BOTH shapes (a multi-day trip
 * and a single-day birthday — the days view has to render both), an event with
 * an unreadable time that must survive in the all-day band, and a deliberately
 * over-full day so the compromise ladder is exercised.
 *
 * Same reasoning as `capture.ts` for living outside `e2e/specs/`: a zero-assertion,
 * timeout-driven harness there would be run by CI on every push and could only
 * ever fail.
 *
 *   npx playwright test -c playwright.design.config.ts --grep "wall time grid"
 */

const MEMBERS = [
  { id: 'm-greg', name: 'Greg', color: '#2C3E50', ageGroup: 'adult', gender: 'male' },
  { id: 'm-sofia', name: 'Sofia', color: '#E67E22', ageGroup: 'adult', gender: 'female' },
  { id: 'm-leo', name: 'Leo', color: '#F15D22', ageGroup: 'child', gender: 'male' },
  { id: 'm-milo', name: 'Milo', color: '#3D8FD1', ageGroup: 'child', gender: 'male' },
  { id: 'm-theo', name: 'Theo', color: '#27AE60', ageGroup: 'child', gender: 'male' },
];

/** Local calendar date — `toISOString()` is UTC and would seed on the wrong day. */
function ymd(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const ACTIVITIES = [
  // ── today: the shape the whole design exists to show ──
  { t: 'School run', c: 'other_school', s: '07:30', e: '08:00', w: ['m-leo', 'm-milo'], d: 0 },
  { t: 'Nursery drop-off', c: 'other_school', s: '08:05', e: '08:20', w: ['m-theo'], d: 0 },
  // …a long quiet stretch here: this is what must fold.
  { t: 'Pickup', c: 'other_school', s: '15:20', e: '15:50', w: ['m-sofia'], d: 0 },
  // The collision: two children, one 16:00, nobody free to drive both.
  { t: 'Football training', c: 'football', s: '16:00', e: '18:00', w: ['m-leo'], d: 0 },
  { t: 'Swimming', c: 'swimming', s: '16:30', e: '17:30', w: ['m-milo'], d: 0 },
  { t: 'Dinner', c: 'dining_out', s: '18:30', e: '19:15', w: [], d: 0 },
  { t: 'Bath & bed', c: 'other_appointment', s: '19:30', e: '20:00', w: ['m-theo'], d: 0 },
  // Single-day all-day: must render in the band on EVERY view.
  { t: 'Term starts', c: 'other_school', s: undefined, e: undefined, w: [], d: 0, allDay: true },
  // An unreadable time: must survive in the band, never vanish.
  {
    t: 'Corrupt record',
    c: 'other_appointment',
    s: 'not-a-time',
    e: undefined,
    w: ['m-greg'],
    d: 0,
  },

  // ── the rest of the week ──
  { t: 'School run', c: 'other_school', s: '07:30', e: '08:00', w: ['m-leo', 'm-milo'], d: 1 },
  { t: 'Pickup', c: 'other_school', s: '15:20', e: '15:50', w: ['m-sofia'], d: 1 },
  { t: 'Piano lesson', c: 'piano', s: '17:00', e: '17:45', w: ['m-theo'], d: 1 },
  { t: 'Dinner', c: 'dining_out', s: '18:30', e: '19:15', w: [], d: 1 },
  { t: 'School run', c: 'other_school', s: '07:30', e: '08:00', w: ['m-leo', 'm-milo'], d: 2 },
  { t: 'Pickup', c: 'other_school', s: '15:20', e: '15:50', w: ['m-sofia'], d: 2 },
  { t: 'Football training', c: 'football', s: '16:00', e: '18:00', w: ['m-leo'], d: 2 },
  { t: 'Dinner', c: 'dining_out', s: '18:30', e: '19:15', w: [], d: 2 },
  // A long block that must hit MAX_BLOCK_PX and say its own duration.
  { t: 'Conference', c: 'conference', s: '09:00', e: '17:00', w: ['m-greg'], d: 3 },
  { t: 'Dinner', c: 'dining_out', s: '18:30', e: '19:15', w: [], d: 3 },
  { t: 'Swim gala', c: 'swimming', s: '10:00', e: '11:30', w: ['m-milo'], d: 4 },
  { t: "Ella's party", c: 'birthday', s: '16:00', e: '18:00', w: ['m-theo'], d: 4 },
  { t: "Lunch at Gran's", c: 'picnic', s: '12:00', e: '14:30', w: [], d: 5 },
  { t: 'Dinner', c: 'dining_out', s: '18:30', e: '19:15', w: [], d: 5 },
  { t: 'Film night', c: 'movie', s: '19:30', e: '20:45', w: [], d: 6 },
];

/** A multi-day all-day item — the OTHER all-day shape the band must handle. */
const TRIP = {
  t: 'Half term',
  c: 'field_trip',
  s: undefined,
  e: undefined,
  w: [],
  d: 4,
  allDay: true,
  endDate: ymd(6),
};

const VIEWS = [
  { id: 'days', label: 'The week' },
  { id: 'lanes', label: 'Each bean' },
  { id: 'today', label: 'Today' },
] as const;

/**
 * Six viewports, not two.
 *
 * The height rules only differ from one another ACROSS heights: the fold, the
 * hour scale and the day window all pick different rungs at 768, 800, 1200 and
 * 1440, and the column count changes at 1024 and again at 1280. A capture set
 * that only had 1280x800 could not have shown any of it.
 */
const SIZES = [
  { name: 'tablet-1024', width: 1024, height: 768 },
  { name: 'landscape', width: 1280, height: 800 },
  { name: 'tall-1600', width: 1600, height: 1200 },
  { name: 'tall-1920', width: 1920, height: 1440 },
  { name: 'portrait', width: 800, height: 1180 },
  { name: 'portrait-1024', width: 1024, height: 1366 },
] as const;

test.describe('design screenshots', () => {
  test('wall time grid', async ({ page }) => {
    test.setTimeout(280_000);

    await gotoRoot(page);
    const db = new IndexedDBHelper(page);
    await db.clearAllData();
    await gotoRoot(page);
    await bypassLoginIfNeeded(page);

    // The wall is dev-flagged; the router guard refuses `/wall` without it.
    await page.evaluate(() => localStorage.setItem('beanies:flag:beanieWall', 'true'));

    await gotoRoute(page, '/activities');
    await page.getByTestId('app-content').waitFor({ state: 'visible', timeout: 30000 });

    const stamp = new Date().toISOString();
    const seeded = await page.evaluate(
      async ({ members, activities, trip, stamp: at, dates }) => {
        const bridge = (
          window as unknown as {
            __e2eDataBridge?: { seedData: (d: unknown) => Promise<void> };
          }
        ).__e2eDataBridge;
        if (!bridge) return { error: 'no bridge' };
        const all = [...activities, trip];
        await bridge.seedData({
          familyMembers: members.map((m) => ({
            ...m,
            email: `${m.id}@example.invalid`,
            role: 'member',
            requiresPassword: false,
            createdAt: at,
            updatedAt: at,
          })),
          todos: [
            {
              id: 'wt1',
              title: 'Reading, 20 min',
              assigneeIds: ['m-leo'],
              isCompleted: false,
              priority: 'medium',
              dueDate: dates[0],
              createdAt: at,
              updatedAt: at,
            },
            {
              id: 'wt2',
              title: 'Tidy room',
              assigneeIds: ['m-leo'],
              isCompleted: false,
              priority: 'low',
              dueDate: dates[0],
              createdAt: at,
              updatedAt: at,
            },
            {
              id: 'wt3',
              title: 'Pack swim bag',
              assigneeIds: ['m-milo'],
              isCompleted: false,
              priority: 'high',
              dueDate: dates[0],
              createdAt: at,
              updatedAt: at,
            },
            {
              id: 'wt4',
              title: 'Spellings',
              assigneeIds: ['m-milo'],
              isCompleted: true,
              priority: 'medium',
              dueDate: dates[0],
              createdAt: at,
              updatedAt: at,
            },
            {
              id: 'wt5',
              title: 'Feed Bella',
              assigneeIds: ['m-theo'],
              isCompleted: true,
              priority: 'low',
              dueDate: dates[0],
              createdAt: at,
              updatedAt: at,
            },
            {
              id: 'wt6',
              title: 'Book MOT',
              assigneeIds: ['m-greg'],
              isCompleted: false,
              priority: 'medium',
              dueDate: dates[0],
              createdAt: at,
              updatedAt: at,
            },
            {
              id: 'wt7',
              title: 'Reply to school',
              assigneeIds: ['m-sofia'],
              isCompleted: true,
              priority: 'high',
              dueDate: dates[0],
              createdAt: at,
              updatedAt: at,
            },
          ],
          lists: [
            {
              id: 'wl1',
              title: 'Big shop',
              emoji: '🛒',
              ownerId: 'm-sofia',
              lifecycle: 'oneoff',
              items: [
                { id: 'wi1', title: 'Milk', isCompleted: false, createdAt: at, updatedAt: at },
                { id: 'wi2', title: 'Bread', isCompleted: true, createdAt: at, updatedAt: at },
                { id: 'wi3', title: 'Apples', isCompleted: false, createdAt: at, updatedAt: at },
              ],
              createdAt: at,
              updatedAt: at,
            },
          ],
          activities: all.map((a, i) => ({
            id: `wa-${i}`,
            title: a.t,
            category: a.c,
            date: dates[a.d],
            endDate: (a as { endDate?: string }).endDate,
            startTime: a.s,
            endTime: a.e,
            isAllDay: !!(a as { allDay?: boolean }).allDay,
            assigneeIds: a.w,
            recurrence: 'none',
            // Required: `activeActivities` filters on it, so a seeded activity
            // without it is in the document, in the store, and invisible
            // everywhere — which is exactly what it did on the first run here.
            isActive: true,
            createdAt: at,
            updatedAt: at,
          })),
        });
        return { ok: all.length };
      },
      {
        members: MEMBERS,
        activities: ACTIVITIES,
        trip: TRIP,
        stamp,
        dates: Array.from({ length: 7 }, (_, i) => ymd(i)),
      }
    );
    console.log('[wall-grid] seed:', JSON.stringify(seeded));

    // Seeding mutates the Automerge doc; the Pinia projections do not refresh on
    // their own. Without this the members appear (they load on a later path)
    // while every activity stays invisible — an empty calendar over a document
    // holding twenty-five of them. Same step, same reason, as `capture.ts`.
    await page.evaluate(async () => {
      const mod = await import('/src/stores/syncStore.ts');
      await (mod as { useSyncStore: () => { reloadAllStores: () => Promise<void> } })
        .useSyncStore()
        .reloadAllStores();
    });
    await page.waitForTimeout(2500);

    // ⚠️ Reach the wall WITHOUT a page load. `gotoRoute` is a full navigation and
    // a reload drops the seeded in-memory Automerge doc — seeding after it fails
    // outright ("no document loaded for 'mutate'"), and seeding before it renders
    // seven empty columns. `capture.ts` documents the same trap: six identical
    // blank frames that PASSED, because a screenshot harness asserts nothing.
    // A pushState + popstate is what Vue Router listens to, so this is in-app
    // navigation with the document still live.
    await page.evaluate(() => {
      window.history.pushState({}, '', '/wall');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.locator('.wall-root').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(1800);

    // Fail loudly rather than shipping blank frames: a harness that asserts
    // nothing is how six empty screenshots passed review last time.
    const rendered = await page.locator('.wall-tblock').count();
    if (rendered === 0) {
      await page.screenshot({ path: 'scratch-shots/DEBUG-wall.png' });
      const diag = await page.evaluate(() => {
        const bridge = (
          window as unknown as { __e2eDataBridge?: { exportData: () => Record<string, unknown[]> } }
        ).__e2eDataBridge;
        const data = bridge?.exportData();
        return {
          url: location.pathname,
          activities: data?.activities?.length ?? -1,
          members: data?.familyMembers?.length ?? -1,
          hasWallRoot: !!document.querySelector('.wall-root'),
          bodyText: document.body.innerText.slice(0, 300),
        };
      });
      throw new Error('[wall-grid] no blocks rendered: ' + JSON.stringify(diag));
    }
    console.log('[wall-grid] blocks on the first view:', rendered);

    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.waitForTimeout(700);
      for (const view of VIEWS) {
        await page.getByRole('button', { name: view.label, exact: true }).first().click();
        // The grid measures its plot after paint, then lays out; give it both frames.
        await page.waitForTimeout(900);
        await page.screenshot({
          path: `scratch-shots/wall-${view.id}-${size.name}.png`,
        });
      }
    }
  });
});
