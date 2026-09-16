import { test } from '../../e2e/fixtures/test';
import { IndexedDBHelper } from '../../e2e/helpers/indexeddb';
import { bypassLoginIfNeeded } from '../../e2e/helpers/auth';
import { gotoRoot, gotoRoute } from '../../e2e/helpers/navigation';

/**
 * NOT a test — the browser verification for #96 (the wall's small-tablet tier).
 *
 * It exists because the defects this change can introduce are geometric, and
 * `docs/lessons.md` records 4563 green unit tests hiding three real ones. The
 * unit suite can prove `wallTierFor(533) === 'compact'`; only a browser can show
 * that the date then fits, the day headers still sit over their columns, and
 * nothing escapes a root that is `overflow-hidden` and therefore clips its own
 * mistakes tidily.
 *
 * Every viewport below is a real device from the issue, not a round number:
 *   533x853 / 853x533 — Lenovo Tab M8 (hdpi), Galaxy Tab A9 8.7"
 *   601x961 / 961x601 — Amazon Fire HD 8, Lenovo Tab M8 (tvdpi)
 *   800x1280          — iPad-ish portrait, the tier boundary neighbour
 *   1280x800          — the shipped baseline, which must not regress
 *   430x932 / 852x393 — phones, which must STILL be refused
 *
 * It lives outside `e2e/specs/` deliberately: `playwright.config.ts` has
 * `testDir: './e2e/specs'` with no `testIgnore`, so a file there joins the CI
 * matrix on every push and counts against the ADR-007 budget (23 of 25).
 *
 *   npx playwright test -c playwright.design.config.ts --grep "wall small tablet"
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

/** Every viewport is a device from the issue. `wall` = must the wall render? */
const SIZES = [
  { name: '1280x800-baseline', width: 1280, height: 800, wall: true, tier: 'full' },
  { name: '800x1280-portrait', width: 800, height: 1280, wall: true, tier: 'full' },
  { name: '961x601-firehd8-landscape', width: 961, height: 601, wall: true, tier: 'mid' },
  { name: '601x961-firehd8-portrait', width: 601, height: 961, wall: true, tier: 'mid' },
  { name: '853x533-tabm8-landscape', width: 853, height: 533, wall: true, tier: 'compact' },
  { name: '533x853-tabm8-portrait', width: 533, height: 853, wall: true, tier: 'compact' },
];

/*
 * ⚠️ There are deliberately NO phone rows here.
 *
 * The device floor reads `screen`, and `screen` does NOT follow
 * `setViewportSize` — a desktop Chrome resized to 430x932 still reports the
 * desktop's screen, so a "phone" row here would exercise nothing and pass for
 * the wrong reason. Worse, it would pass today and keep passing if the device
 * floor were deleted entirely.
 *
 * The device floor is unit-tested instead, against a stubbed `screen`, in
 * `src/components/wall/__tests__/wallRoom.test.ts` ("the device floor: what may
 * ever be a wall"), which pins every real device including both phones. This
 * harness owns the GEOMETRY, which is the half a unit test cannot see.
 */

test.describe('design screenshots', () => {
  test('wall small tablet tier', async ({ page }) => {
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
    if ('error' in seeded) throw new Error(`[w96] seeding failed: ${seeded.error}`);

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
        `[w96] the fixture did not land: ${inDoc.activities} activities (want ` +
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
      await page.screenshot({ path: 'scratch-shots/w96-DEBUG-empty.png' });
      throw new Error('[w96] the wall rendered no time blocks — measuring an empty grid');
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
    console.log('[w96][diag]', JSON.stringify(diag));

    const failures: string[] = [];

    /*
     * Both themes and both reading modes, because the CIG requires a surface to
     * be authored for light AND dark in the same change, and Large reading mode
     * (1.1875x root) inflates every rem on the wall while `innerWidth` does not
     * move — so the smallest admitted device is also the one most likely to
     * overflow, and it is the combination that has to hold, not each half.
     */
    const MODES = [
      { name: 'light', dark: false, large: false },
      { name: 'dark', dark: true, large: false },
      { name: 'large-text', dark: false, large: true },
    ];

    for (const mode of MODES) {
      await page.evaluate(
        ({ dark, large }) => {
          document.documentElement.classList.toggle('dark', dark);
          if (large) document.documentElement.setAttribute('data-text-size', 'large');
          else document.documentElement.removeAttribute('data-text-size');
        },
        { dark: mode.dark, large: mode.large }
      );
      for (const size of SIZES) {
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `scratch-shots/w96-${mode.name}-${size.name}.png` });

        const seen = await page.evaluate(() => {
          const root = document.querySelector('.wall-root') as HTMLElement | null;
          if (!root) return { wall: false as const };
          const date = root.querySelector('.wall-date') as HTMLElement | null;
          /*
           * The alignment invariant, measured against two hooks that exist.
           *
           * The day-header row and the plot sit inside the same arrow-gutter
           * wrapper and must share both edges. Give the headers a padding the plot
           * does not have and every day label drifts off the column it names --
           * which is exactly what a tier-aware page padding can do if CSS and the
           * arithmetic disagree. A MISSING hook fails loudly rather than passing
           * quietly, because a guard that cannot fire is not a smaller guard.
           */
          const heads = root.querySelector('[data-wall-dayheads]');
          const plot = root.querySelector('.wall-plot');
          let edgeSkew: number | null = null;
          let hookMissing: string | null = null;
          if (!heads) hookMissing = '[data-wall-dayheads]';
          else if (!plot) hookMissing = '.wall-plot';
          else {
            /*
             * ⚠️ The headers' CONTENT box, not its border box. The header row
             * carries `padding-left: AXIS_WIDTH_PX` so its columns start where the
             * plot's columns do; comparing border boxes reports a constant 62px
             * skew at EVERY size, including the untouched baseline, which is how
             * this check first "failed" against code it was not testing.
             */
            const h = heads.getBoundingClientRect();
            const p = plot.getBoundingClientRect();
            const padLeft = parseFloat(getComputedStyle(heads).paddingLeft) || 0;
            edgeSkew = Math.max(
              Math.round(Math.abs(h.left + padLeft - p.left)),
              Math.round(Math.abs(h.right - p.right))
            );
          }
          return {
            wall: true as const,
            tier: root.dataset.tier ?? null,
            overflowX: root.scrollWidth > root.clientWidth + 1,
            overflowY: root.scrollHeight > root.clientHeight + 1,
            // An ellipsised date is the specific defect the header wrap fixes.
            dateTruncated: date ? date.scrollWidth > date.clientWidth + 1 : null,
            dateClipPx: date ? Math.round(date.scrollWidth - date.clientWidth) : 0,
            dateText: date?.textContent?.trim().slice(0, 40) ?? null,
            edgeSkew,
            hookMissing,
            // Which element is actually wider than the wall, for triage.
            widest: (() => {
              const rootRight = root.getBoundingClientRect().right;
              let worst: { sel: string; over: number } | null = null;
              for (const el of root.querySelectorAll('*')) {
                const r = (el as HTMLElement).getBoundingClientRect();
                const over = Math.round(r.right - rootRight);
                if (over > 1 && (!worst || over > worst.over)) {
                  const e = el as HTMLElement;
                  worst = {
                    sel: `${e.tagName.toLowerCase()}.${(e.className || '').toString().split(' ').filter(Boolean).slice(0, 3).join('.')}`,
                    over,
                  };
                }
              }
              return worst;
            })(),
          };
        });

        const where = `${size.name} [${mode.name}]`;

        if (size.wall && !seen.wall) {
          failures.push(`${where}: expected the wall, got the refusal screen`);
          continue;
        }
        if (!size.wall) {
          if (seen.wall) failures.push(`${where}: a phone was handed a wall`);
          continue;
        }
        if (size.tier && seen.tier !== size.tier) {
          failures.push(`${where}: expected tier "${size.tier}", got "${seen.tier}"`);
        }
        if (seen.overflowX) {
          failures.push(
            `${where}: content overflows the root horizontally` +
              (seen.widest ? ` — widest offender ${seen.widest.sel} by ${seen.widest.over}px` : '')
          );
        }
        if (seen.overflowY) failures.push(`${where}: content overflows the root vertically`);
        if (seen.dateTruncated) {
          failures.push(
            `${where}: the date is ellipsised by ${seen.dateClipPx}px ("${seen.dateText}")`
          );
        }
        if (seen.hookMissing) {
          failures.push(
            `${where}: ${seen.hookMissing} is missing, so the header/plot alignment check ` +
              `could not run -- which is the state it exists to stop being possible`
          );
        } else if ((seen.edgeSkew ?? 0) > 2) {
          failures.push(
            `${where}: the day-header row and the plot are ${seen.edgeSkew}px out of alignment, ` +
              `so every day label sits off the column it names`
          );
        }
      }
    }

    /*
     * ⭐ The header must stay ONE ROW in EVERY view, at every admitted size.
     *
     * greg caught this on a real Tab M8: the days view puts its step arrows
     * INSIDE the calendar (`arrowsInView`), but lanes and today keep theirs in
     * the header, which pushed the row over the line and made it wrap. Wrapping
     * costs a row of height, and on a 533px-tall wall that row is the most
     * expensive thing on the screen — so a fix for the date must not quietly
     * spend it on three views out of four.
     *
     * Measured per view rather than per size, because the trigger is which
     * controls a view puts in the header, not the width alone.
     */
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
      document.documentElement.removeAttribute('data-text-size');
    });
    /*
     * Only the HEIGHT-CONSTRAINED walls. Above 700px of height a wrap is
     * affordable and is the deliberate choice — the date keeps its width and the
     * controls take a row. Asserting "never wraps" everywhere would be asserting
     * against the design, and would have failed portrait for doing the right
     * thing.
     */
    for (const size of [...SIZES.filter((s) => s.tier === 'compact')].reverse()) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.waitForTimeout(700);
      const views = await page.evaluate(() => document.querySelectorAll('.wall-switch-btn').length);
      for (let i = 0; i < views; i += 1) {
        // Dispatched rather than clicked: the switcher lives inside a scoped
        // child and Playwright's actionability check times out on it at this
        // height. We only need the view to change, not to prove it is clickable.
        /*
         * Keep the wall awake first. It has its own idle timer and drops to the
         * night face after a few quiet minutes — which is exactly what happened
         * to the portrait chore-board capture on a long run, and looked for all
         * the world like a layout bug.
         */
        await page.evaluate((idx) => {
          // Leave the night face if the idle timer has dropped us onto it, or
          // every capture after that point is a clock on a dark screen.
          const night = document.querySelector(
            '.wall-night, [data-wall-night]'
          ) as HTMLElement | null;
          night?.click();
          document
            .querySelector('.wall-root')
            ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
          const b = document.querySelectorAll('.wall-switch-btn')[idx] as HTMLElement | undefined;
          b?.click();
        }, i);
        await page.waitForTimeout(700);
        const row = await page.evaluate(() => {
          const root = document.querySelector('.wall-root') as HTMLElement | null;
          if (!root) return null;
          const title = root.querySelector('.wall-header-title') as HTMLElement | null;
          const ctrls = root.querySelector('.wall-header-controls') as HTMLElement | null;
          if (!title || !ctrls) return null;
          const t = title.getBoundingClientRect();
          const c = ctrls.getBoundingClientRect();
          const active = root.querySelector(
            '.wall-switch-btn[aria-pressed="true"]'
          ) as HTMLElement | null;
          return {
            drop: Math.round(c.top - t.top),
            view: active?.getAttribute('aria-label') ?? active?.textContent?.trim() ?? `#${0}`,
            headerH: Math.round(
              (root.querySelector('.wall-header') as HTMLElement).getBoundingClientRect().height
            ),
          };
        });
        await page.screenshot({ path: `scratch-shots/w96-view${i}-${size.name}.png` });
        /*
         * ⭐ Does the plot overrun its slot and paint over what sits under it?
         *
         * `.wall-root` scroll overflow CANNOT see this: the plot is
         * `overflow-hidden`, so it clips its own contents tidily while sitting in
         * the wrong place, and the root reports no overflow at all. A rem-based
         * plot floor growing under Large reading mode drew the rest-days row
         * straight through the 17:00 axis label and every assertion passed.
         *
         * `wall-grid-capture.ts` carries the same check after the same bug on a
         * 1024x768 tablet. Stacked-only: beside the grid, a rail cannot overlap.
         */
        const overrun = await page.evaluate(() => {
          const plot = document.querySelector('.wall-plot') as HTMLElement | null;
          if (!plot) return null;
          const p = plot.getBoundingClientRect();
          // Everything that legitimately sits UNDER the plot. The rest-days row
          // is inside the days view and the peripheral strip is outside it; both
          // were painted over at different points, so both are checked.
          const unders = ['[data-wall-restdays]', '.wall-peripherals']
            .map((sel) => document.querySelector(sel) as HTMLElement | null)
            .filter((el): el is HTMLElement => !!el);
          let worst = 0;
          for (const el of unders) {
            const b = el.getBoundingClientRect();
            if (b.top < p.top) continue; // beside the grid, cannot overlap it
            worst = Math.max(worst, Math.round(p.bottom - b.top));
          }
          return worst;
        });
        if (overrun !== null && overrun > 2) {
          failures.push(
            `${size.name} [view ${i}]: the plot overruns its slot by ${overrun}px and paints ` +
              `over what sits beneath it — invisible to a scroll-overflow check, because the ` +
              `plot is overflow-hidden`
          );
        }
        if (!row) continue;
        if (size.height < 700 && row.drop > 8) {
          failures.push(
            `${size.name} [view ${i} "${row.view}"]: the header wrapped onto a second row ` +
              `(controls sit ${row.drop}px below the date, header is ${row.headerH}px tall) — ` +
              `that is a row of calendar lost on a wall that has no height to spare`
          );
        }
      }
    }

    // eslint-disable-next-line no-console
    console.log('[w96] checked', SIZES.length * 3, 'viewport/mode combinations');
    if (failures.length) throw new Error(`[w96]\n  ${failures.join('\n  ')}`);
  });
});
