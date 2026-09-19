import { test } from '../../e2e/fixtures/test';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';

/**
 * NOT a test — a marketing-asset harness that captures the two beanie wall
 * frames a Pinterest pin needs: a BUSY week on the calendar, and a chore board
 * with real progress on it.
 *
 * It exists because the two wall images in `packages/brand/assets/blog/` cannot
 * carry a pin. The chore board one shows "0 of 22 done today" with every circle
 * empty and a scrollbar down the first column, and the calendar one is a thin
 * week with a stray "test photo" in it. A pin has to promise that the thing
 * works, and an untouched chore board promises the opposite.
 *
 * ⚠️ THE TICK BUG THIS HARNESS EXISTS TO AVOID. `FamilyListItem.completed` is
 * the field (src/types/models.ts:722). `wall-grid-capture.ts` seeds list items
 * as `isCompleted`, which is silently dropped — which is exactly how the blog
 * screenshot ended up with nothing ticked. Seed `completed`, and assert the
 * rendered tally afterwards rather than trusting the frame.
 *
 * Deliberately NOT in `e2e/specs/`: zero assertions about product behaviour,
 * English labels, timeout-driven. Same reasoning as `capture.ts` and
 * `wall-grid-capture.ts`.
 *
 *   npx playwright test -c playwright.design.config.ts --grep "pin wall"
 *
 * ⚠️ TWO ENVIRONMENT TRAPS on greg's WSL box, both of which produce a plausible
 * WRONG result rather than an error:
 *   - An ssh tunnel LISTENS on 5173 here, so `reuseExistingServer` points the
 *     capture at a stale site served from another machine. Run the dev server
 *     yourself on a free port (`npm run dev -- --port=5199 --strictPort`, with
 *     the equals sign) and point baseURL at it.
 *   - A COLD vite compiles /nook on demand and blows the 30s app-content ceiling
 *     inside `bypassLoginIfNeeded`, which looks like a broken harness. Capture
 *     against an already-warm server.
 *
 * Output: scratch-shots/pin-wall-calendar.png + pin-wall-chores.png
 */

const MEMBERS = [
  { id: 'm-daddy', name: 'daddy', color: '#2C3E50', ageGroup: 'adult', gender: 'male' },
  { id: 'm-mommy', name: 'mommy', color: '#E67E22', ageGroup: 'adult', gender: 'female' },
  { id: 'm-neily', name: 'neily', color: '#F15D22', ageGroup: 'child', gender: 'male' },
  { id: 'm-jojo', name: 'jojo', color: '#3D8FD1', ageGroup: 'child', gender: 'male' },
];

/** Local calendar date — `toISOString()` is UTC and would seed on the wrong day. */
function ymd(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * A full, lived-in week — greg's brief was "lots of activities including
 * celebrations". Celebrations are spread across the week rather than clustered,
 * so the orange birthday/anniversary blocks read as colour THROUGHOUT the grid
 * at thumbnail size, which is the whole job of this frame.
 */
const ACTIVITIES = [
  // ── today ──
  { t: 'School run', c: 'other_school', s: '07:30', e: '08:00', w: ['m-neily', 'm-jojo'], d: 0 },
  { t: 'Swim lessons', c: 'swimming', s: '09:00', e: '10:00', w: ['m-jojo'], d: 0 },
  { t: 'Dance', c: 'dance', s: '10:30', e: '11:30', w: ['m-neily'], d: 0 },
  { t: 'Pickup', c: 'other_school', s: '15:20', e: '15:50', w: ['m-mommy'], d: 0 },
  { t: 'Football training', c: 'football', s: '16:00', e: '17:30', w: ['m-neily'], d: 0 },
  { t: 'Family dinner', c: 'dining_out', s: '18:30', e: '19:30', w: [], d: 0 },

  // ── +1: the birthday ──
  { t: 'School run', c: 'other_school', s: '07:30', e: '08:00', w: ['m-neily', 'm-jojo'], d: 1 },
  { t: 'Piano lesson', c: 'piano', s: '10:00', e: '10:45', w: ['m-jojo'], d: 1 },
  { t: "Jojo's birthday!", c: 'birthday', s: '14:00', e: '17:00', w: [], d: 1 },
  { t: 'Cake + candles', c: 'other_celebration', s: '18:00', e: '19:00', w: [], d: 1 },

  // ── +2 ──
  { t: 'School run', c: 'other_school', s: '07:30', e: '08:00', w: ['m-neily', 'm-jojo'], d: 2 },
  { t: 'Chess club', c: 'other_hobby', s: '15:30', e: '16:30', w: ['m-jojo'], d: 2 },
  { t: 'Football training', c: 'football', s: '17:00', e: '18:30', w: ['m-neily'], d: 2 },
  { t: 'Family dinner', c: 'dining_out', s: '19:00', e: '20:00', w: [], d: 2 },

  // ── +3: the anniversary ──
  { t: 'School run', c: 'other_school', s: '07:30', e: '08:00', w: ['m-neily', 'm-jojo'], d: 3 },
  { t: 'Swim lessons', c: 'swimming', s: '09:30', e: '10:30', w: ['m-jojo'], d: 3 },
  {
    t: 'Our anniversary',
    c: 'anniversary',
    s: '19:00',
    e: '21:30',
    w: ['m-daddy', 'm-mommy'],
    d: 3,
  },

  // ── +4 ──
  { t: 'Dance', c: 'dance', s: '09:30', e: '10:30', w: ['m-neily'], d: 4 },
  { t: "Grandma's visit", c: 'other_celebration', s: '12:00', e: '15:00', w: [], d: 4 },
  { t: 'Film night', c: 'movie', s: '19:30', e: '21:00', w: [], d: 4 },

  // ── +5 ──
  { t: 'Swim gala', c: 'swimming', s: '10:00', e: '11:30', w: ['m-jojo'], d: 5 },
  { t: "Ella's party", c: 'birthday', s: '14:00', e: '16:30', w: ['m-neily'], d: 5 },
  { t: "Lunch at Gran's", c: 'picnic', s: '12:30', e: '14:00', w: [], d: 5 },

  // ── +6 ──
  { t: 'Graduation day', c: 'graduation', s: '11:00', e: '13:00', w: ['m-neily'], d: 6 },
  { t: 'Family dinner', c: 'dining_out', s: '18:30', e: '19:30', w: [], d: 6 },
];

/** A multi-day all-day item, so the band is populated too. */
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

/**
 * One SHORT recurring list per bean, so no column scrolls, and most items
 * ticked so the board reads as a family that actually uses it.
 *
 * FIVE items per column, not six: at six the last row clipped under the column
 * footer and the column became scrollable, which is the cramped look greg
 * called out in the blog screenshot. The harness warns when anything scrolls.
 *
 * 14 of 20 done. Deliberately not 20/20 — a perfect board looks staged.
 */
const LISTS = [
  {
    id: 'pl-neily',
    title: "neily's chores",
    emoji: '✅',
    ownerId: 'm-neily',
    items: [
      ['Make the bed', true],
      ['Feed the dog', true],
      ['Tidy toy bins', true],
      ['Water the plants', true],
      ['Read for 20 min', false],
    ],
  },
  {
    id: 'pl-jojo',
    title: "jojo's chores",
    emoji: '✅',
    ownerId: 'm-jojo',
    items: [
      ['Make the bed', true],
      ['Feed the dog', true],
      ['Tidy toy bins', true],
      ['Homework', true],
      ['Read for 20 min', false],
    ],
  },
  {
    id: 'pl-daddy',
    title: "daddy's jobs",
    emoji: '🧰',
    ownerId: 'm-daddy',
    items: [
      ['Take out the bins', true],
      ['Walk the dog', true],
      ['Book the MOT', true],
      ['Fix the shed door', false],
      ['Pay the water bill', false],
    ],
  },
  {
    id: 'pl-mommy',
    title: "mommy's jobs",
    emoji: '🌿',
    ownerId: 'm-mommy',
    items: [
      ['Big shop', true],
      ['Reply to school', true],
      ['Swim bag ready', true],
      ['Call the dentist', true],
      ['Water the herbs', false],
    ],
  },
] as const;

const EXPECTED_DONE = LISTS.reduce((n, l) => n + l.items.filter(([, c]) => c).length, 0);
const EXPECTED_TOTAL = LISTS.reduce((n, l) => n + l.items.length, 0);

test.describe('design screenshots', () => {
  test('pin wall', async ({ page }) => {
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

    const at = new Date().toISOString();
    const seeded = await page.evaluate(
      async ({ members, activities, trip, lists, at: stamp, dates }) => {
        const bridge = (
          window as unknown as {
            __e2eDataBridge?: {
              seedData: (d: unknown) => Promise<void>;
              exportData: () => Record<string, Array<Record<string, unknown>>>;
            };
          }
        ).__e2eDataBridge;
        if (!bridge) return { error: 'no bridge' };

        /*
         * The create flow already made an owner called "John Doe" (auth.ts's
         * placeholder). Seeding four more members leaves him in the pod, and he
         * turns up in the footer bean row and as "NO CHORES TODAY · John Doe" on
         * the board — a stranger in a family photo. Overwrite that record by
         * REUSING ITS ID rather than adding a fifth member. Same trick, same
         * reason, as scripts/promo-video/seed.ts.
         */
        const ownerId = bridge.exportData().familyMembers?.[0]?.id as string | undefined;
        const realId = (id: string) => (id === 'm-daddy' && ownerId ? ownerId : id);

        const all = [...activities, trip];
        await bridge.seedData({
          familyMembers: members.map((m) => ({
            ...m,
            id: realId(m.id),
            email: `${m.id}@example.invalid`,
            role: 'member',
            requiresPassword: false,
            createdAt: stamp,
            updatedAt: stamp,
          })),
          // Empty: the chore board renders LISTS, and a pile of loose to-dos
          // would only crowd the peripheral rail in the calendar frame.
          todos: [],
          lists: lists.map((l) => ({
            id: l.id,
            title: l.title,
            emoji: l.emoji,
            category: 'home',
            ownerId: realId(l.ownerId),
            lifecycle: 'recurring',
            frequency: 'daily',
            lastResetDate: dates[0],
            completed: false,
            // ⚠️ `completed`, NOT `isCompleted` — see the header note. This one
            // word is the difference between a board that sells the app and the
            // "0 of 22 done today" frame in the blog post.
            items: l.items.map(([title, done], i) => ({
              id: `${l.id}-i${i}`,
              title,
              completed: done,
              ...(done ? { completedBy: realId(l.ownerId), completedAt: stamp } : {}),
            })),
            createdAt: stamp,
            updatedAt: stamp,
          })),
          activities: all.map((a, i) => ({
            id: `pa-${i}`,
            title: a.t,
            category: a.c,
            date: dates[a.d],
            endDate: (a as { endDate?: string }).endDate,
            startTime: a.s,
            endTime: a.e,
            isAllDay: !!(a as { allDay?: boolean }).allDay,
            assigneeIds: (a.w as string[]).map(realId),
            recurrence: 'none',
            // Required: `activeActivities` filters on it, so a seeded activity
            // without it is in the document and invisible everywhere.
            isActive: true,
            createdAt: stamp,
            updatedAt: stamp,
          })),
        });
        return { ok: all.length, ownerId: ownerId ?? null };
      },
      {
        members: MEMBERS,
        activities: ACTIVITIES,
        trip: TRIP,
        lists: LISTS.map((l) => ({ ...l, items: l.items.map(([t, c]) => [t, c]) })),
        at,
        dates: Array.from({ length: 7 }, (_, i) => ymd(i)),
      }
    );
    console.log('[pin-wall] seed:', JSON.stringify(seeded));

    // Seeding mutates the Automerge doc; the Pinia projections do not refresh on
    // their own. Without this the members appear while every activity stays
    // invisible — an empty calendar over a document holding twenty-five.
    await page.evaluate(async () => {
      const mod = await import('/src/stores/syncStore.ts');
      await (mod as { useSyncStore: () => { reloadAllStores: () => Promise<void> } })
        .useSyncStore()
        .reloadAllStores();
    });
    await page.waitForTimeout(2500);

    // ⚠️ Reach the wall WITHOUT a page load — a reload drops the seeded in-memory
    // Automerge doc. pushState + popstate is what Vue Router listens to.
    /*
     * 1600, not 1280. The wall picks its column count off the width, and at
     * 1280 the week rendered only THREE days beside the peripheral rail — a
     * "week" view that shows half a weekend is a poor promise on a pin. 1600
     * gives a full working week and roomier chore columns.
     */
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.evaluate(() => {
      window.history.pushState({}, '', '/wall');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.locator('.wall-root').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(2000);

    // ── frame 1: the week ──────────────────────────────────────────────────
    await page
      .getByRole('button', { name: /^the week$/i })
      .first()
      .click();
    await page.waitForTimeout(1200);

    // Fail loudly rather than shipping a blank frame: a harness that asserts
    // nothing is how six empty screenshots passed review last time.
    const blocks = await page.locator('.wall-tblock').count();
    if (blocks === 0) throw new Error('[pin-wall] the week rendered no activity blocks');
    console.log('[pin-wall] blocks on the week:', blocks);

    await page.screenshot({ path: 'scratch-shots/pin-wall-calendar.png' });

    // ── frame 2: the chore board ───────────────────────────────────────────
    await page
      .getByRole('button', { name: /^the chore board$/i })
      .first()
      .click();
    await page.waitForTimeout(1200);

    /*
     * The assertion this harness is FOR. The frame looks plausible whether the
     * ticks landed or not — an all-empty board is a perfectly pretty picture.
     * Read the tally out of the DOM instead, and refuse to write a pin frame
     * that says nothing is done.
     */
    const tally = await page.evaluate(() => {
      const root = document.querySelector('.wall-root');
      const text = root instanceof HTMLElement ? root.innerText : '';
      // The board's own progress line ("15 of 22 done today") is the hook: it is
      // literally the thing that read "0 of 22" in the blog screenshot, so it is
      // the right thing to assert on. NOT input[type=checkbox] - the wall renders
      // its own tick control, so a checkbox query finds nothing and an assertion
      // built on it passes vacuously whatever the board actually shows.
      const m = /(\d+)\s+of\s+(\d+)\s+done/i.exec(text);
      return {
        done: m ? Number(m[1]) : -1,
        total: m ? Number(m[2]) : -1,
        ticks: (text.match(/Done\s/g) || []).length,
      };
    });
    console.log('[pin-wall] chore tally:', JSON.stringify(tally));

    if (tally.done !== EXPECTED_DONE || tally.total !== EXPECTED_TOTAL) {
      await page.screenshot({ path: 'scratch-shots/DEBUG-pin-wall-chores.png' });
      throw new Error(
        `[pin-wall] the chore board reads ${tally.done}/${tally.total} done, expected ` +
          `${EXPECTED_DONE}/${EXPECTED_TOTAL}. A board showing nothing done is the exact ` +
          `defect this harness exists to catch - check the item field is \`completed\`, ` +
          `not \`isCompleted\` (src/types/models.ts:722).`
      );
    }

    // A scrollbar in a column is what made the blog frame look cramped. The
    // lists here are short enough that nothing should overflow; prove it.
    const scrollers = await page.evaluate(
      () =>
        [...document.querySelectorAll('.wall-root *')].filter(
          (el) => el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 120
        ).length
    );
    if (scrollers > 0) {
      console.warn(`[pin-wall] ⚠️ ${scrollers} scrollable region(s) on the chore board`);
    }

    await page.screenshot({ path: 'scratch-shots/pin-wall-chores.png' });
  });
});
