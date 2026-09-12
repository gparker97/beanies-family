import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A source scan, because the bug it exists for was a COUNTING error, not a logic
 * error.
 *
 * Family birthdays shipped on the month grid and the desktop week lane but not
 * on the mobile week view, the day view, or the agenda sidebar — greg found it
 * on his phone within the hour. The cause: the surfaces were enumerated by
 * grepping for `HolidayChip`, and the three that were missed render their
 * reference day through `HolidayBanner` instead. The grep answered a narrower
 * question than the one being asked, and the answer looked complete.
 *
 * So the rule is stated here instead of remembered: a birthday is a reference
 * day about somebody in this family, and every planner surface that shows a
 * PUBLIC holiday must also show a family birthday. Add a fourth holiday surface
 * and this test names it on the next run.
 */
const PLANNER_DIR = join(process.cwd(), 'src/components/planner');
const WALL_DIR = join(process.cwd(), 'src/components/wall');

/** Renders a public holiday in any of its forms. */
function showsHoliday(src: string): boolean {
  return /<HolidayChip|<HolidayBanner/.test(src);
}

function showsBirthday(src: string): boolean {
  return /<BirthdayChip/.test(src);
}

/**
 * Surfaces that legitimately show a holiday and NOT a birthday, each with the
 * reason. Keep this list short and argued — it is the escape hatch, and an
 * unexplained entry in it is how the rule above quietly stops meaning anything.
 */
const EXEMPT: Record<string, string> = {
  // The generic chip/banner primitives themselves: they render whatever a domain
  // adapter hands them and know nothing about either subject.
  'HolidayChip.vue': 'the holiday adapter itself',
  'HolidayBanner.vue': 'the holiday banner primitive',
};

describe('every planner surface that shows a holiday also shows a birthday', () => {
  const files = readdirSync(PLANNER_DIR).filter((f) => f.endsWith('.vue'));

  it('finds the planner components at all (guards against a silent empty scan)', () => {
    // Without this, moving the directory would make every assertion below pass
    // vacuously — the failure mode a source scan is most prone to.
    expect(files.length).toBeGreaterThan(10);
  });

  it('has no surface showing a public holiday but not a family birthday', () => {
    const missing: string[] = [];
    for (const file of files) {
      if (file in EXEMPT) continue;
      const src = readFileSync(join(PLANNER_DIR, file), 'utf8');
      if (showsHoliday(src) && !showsBirthday(src)) missing.push(file);
    }
    expect(
      missing,
      `these render a public holiday but no family birthday: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('still finds holiday surfaces to check, so the rule has teeth', () => {
    const checked = files.filter(
      (f) => !(f in EXEMPT) && showsHoliday(readFileSync(join(PLANNER_DIR, f), 'utf8'))
    );
    expect(checked.length).toBeGreaterThanOrEqual(4);
  });
});

/**
 * The same rule, stated for the beanie wall — where it has to be checked
 * DIFFERENTLY, which is exactly why it gets its own assertion rather than being
 * assumed covered by the one above.
 *
 * The wall does not import chips. Its three calendar views hand `WallTimeGrid` a
 * band of all-day content, and reference days ride the same band as a second
 * prop. So the invariant is: a view that gives the grid the family's own all-day
 * events must also give it the birthdays and holidays for the same window.
 * Passing one without the other is how the wall would end up showing a family's
 * events but not their birthdays - which is the state it shipped in.
 */
describe('every wall view that fills the all-day band also fills its reference days', () => {
  const files = readdirSync(WALL_DIR).filter((f) => f.endsWith('.vue'));

  it('finds the wall components at all', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('has no view passing all-day spans without reference days', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const file of files) {
      const src = readFileSync(join(WALL_DIR, file), 'utf8');
      // The GRID is the consumer, not a producer - it declares both props.
      if (file === 'WallTimeGrid.vue') continue;
      if (!/:all-day-spans=/.test(src)) continue;
      checked += 1;
      if (!/:band-references=/.test(src)) missing.push(file);
    }
    expect(
      missing,
      `these fill the wall's all-day band but pass no reference days: ${missing.join(', ')}`
    ).toEqual([]);
    // Three views today (days, today, lanes). If this ever reads 0 the scan has
    // stopped matching and is asserting nothing.
    expect(checked).toBeGreaterThanOrEqual(3);
  });
});

/**
 * The rule that replaces the two above, and the reason they existed.
 *
 * Both of those guards check that a surface RENDERS the right things. Neither
 * can catch the failure that actually happened twice: two calendars asking
 * DIFFERENT questions about what a day contains. The wall read only
 * `activityStore` and therefore had no concept of a public holiday at all, while
 * the planner read holidays and trips separately - so there was no single place
 * that knew the answer, and adding a kind meant remembering nine call sites.
 *
 * `useDayExtras` is now that single place. This asserts nothing else reaches
 * around it.
 */
describe('one query for what a day contains', () => {
  const OWNER = 'useDayExtras.ts';
  /** Reaching past the shared query, in either calendar. */
  const BYPASS = /birthdaysInRange\(|holidaysInRange\(|holidayForDate\(/;

  function scan(dir: string): string[] {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.vue') || f.endsWith('.ts'))
      .filter((f) => !f.endsWith('.test.ts'));
  }

  it('no planner or wall surface asks the stores directly', () => {
    const offenders: string[] = [];
    for (const dir of [PLANNER_DIR, WALL_DIR]) {
      for (const file of scan(dir)) {
        const src = readFileSync(join(dir, file), 'utf8');
        if (BYPASS.test(src)) offenders.push(`${dir.split('/').pop()}/${file}`);
      }
    }
    expect(
      offenders,
      `these bypass useDayExtras and can drift from the other calendar: ${offenders.join(', ')}`
    ).toEqual([]);
  });

  it('the owner really does make those calls, so the rule is not vacuous', () => {
    const owner = readFileSync(join(process.cwd(), 'src/composables', OWNER), 'utf8');
    expect(BYPASS.test(owner)).toBe(true);
  });

  it('both calendars consume it', () => {
    const users: string[] = [];
    for (const dir of [PLANNER_DIR, WALL_DIR, join(process.cwd(), 'src/composables')]) {
      for (const file of scan(dir)) {
        if (file === OWNER) continue;
        if (/useDayExtras/.test(readFileSync(join(dir, file), 'utf8'))) users.push(file);
      }
    }
    // The planner's month/week/day/agenda surfaces plus the wall's placement
    // composable. If this collapses toward zero, the shared query has been
    // routed around rather than deleted.
    expect(users.length).toBeGreaterThanOrEqual(4);
  });
});

/**
 * The bug this exists for: the birthday drawer shipped reachable ONLY from the
 * beanie wall. `MonthDayCard` emitted `birthday-click`, `BirthdayChip` emitted
 * `click`, and `FamilyPlannerPage` listened for `birthday-click` on five
 * components - but nothing in between ever re-emitted it. A listener bound to an
 * event a child never emits is legal Vue, invisible to the typechecker and the
 * linter, and invisible to unit tests that mount each component in isolation.
 * Two review agents found it independently; none of the 27 tests did.
 *
 * So the wiring is asserted as SOURCE, at the two places it can break: a chip
 * rendered without a handler, and an emit a parent forgets to forward.
 */
describe('a birthday chip is wired to something, everywhere it is rendered', () => {
  const files = readdirSync(PLANNER_DIR).filter((f) => f.endsWith('.vue'));

  it('every <BirthdayChip> carries a click handler', () => {
    const unwired: string[] = [];
    for (const file of files) {
      if (file === 'BirthdayChip.vue') continue;
      const src = readFileSync(join(PLANNER_DIR, file), 'utf8');
      for (const tag of src.match(/<BirthdayChip[\s\S]*?\/>/g) ?? []) {
        if (!/@click/.test(tag)) unwired.push(file);
      }
    }
    expect(
      unwired,
      `these render a birthday chip that does nothing when tapped: ${unwired.join(', ')}`
    ).toEqual([]);
  });

  it('every component emitting birthday-click has a parent that forwards it', () => {
    // A `birthday-click` emit is only useful if somebody above re-emits or
    // handles it. Anything declaring the emit must also be consumed somewhere.
    const emitters = files.filter((f) =>
      /'birthday-click':/.test(readFileSync(join(PLANNER_DIR, f), 'utf8'))
    );
    expect(emitters.length).toBeGreaterThanOrEqual(4);

    const consumers = new Set<string>();
    for (const dir of [PLANNER_DIR, join(process.cwd(), 'src/pages')]) {
      for (const f of readdirSync(dir).filter((x) => x.endsWith('.vue'))) {
        if (/@birthday-click=/.test(readFileSync(join(dir, f), 'utf8'))) consumers.add(f);
      }
    }
    // The page plus the month parents, at minimum.
    expect(consumers.size).toBeGreaterThanOrEqual(3);
  });
});

/**
 * ONE definition of "all-day", everywhere.
 *
 * There were three. The month grid tested `activity.isAllDay`; the week, day and
 * mobile-timeline views tested `!activity.startTime`; and `isAllDayActivity` —
 * the canonical one, which every other part of the app already used — is
 * `isAllDay === true || !startTime`. An activity carrying BOTH the flag and a
 * leftover time was therefore an all-day chip on the month and a timed block on
 * the week and the day, which is what greg saw and correctly diagnosed as "an
 * issue of showing all day events on the weekly and on the daily calendar".
 *
 * A predicate this easy to re-derive inline is one a future change WILL
 * re-derive, so it is asserted rather than remembered.
 */
describe('one definition of all-day', () => {
  /** Deciding all-day from `startTime` or the raw flag, instead of the helper. */
  const HAND_ROLLED = /\.startTime\s*&&|!\s*\w+\.activity\.startTime|activity\.isAllDay\b/;

  /** Files that legitimately read the raw fields. */
  const EXEMPT = new Set([
    // Renders a time and must ask whether there IS one.
    'ActivityListCard.vue',
    'ActivityModal.vue',
    'ActivityViewEditModal.vue',
    'DayTimeline.vue', // formats "9:00am" for a timed block; splits via the helper
  ]);

  it('no calendar surface re-derives it from raw fields', () => {
    const offenders: string[] = [];
    for (const dir of [PLANNER_DIR, WALL_DIR]) {
      for (const file of readdirSync(dir).filter((f) => f.endsWith('.vue'))) {
        if (EXEMPT.has(file)) continue;
        const src = readFileSync(join(dir, file), 'utf8');
        if (HAND_ROLLED.test(src)) offenders.push(file);
      }
    }
    expect(
      offenders,
      `these decide "all-day" themselves instead of using isAllDayActivity: ${offenders.join(', ')}`
    ).toEqual([]);
  });

  it('the surfaces that split timed from all-day DO use the helper', () => {
    const users = ['WeeklyCalendarView.vue', 'DailyCalendarView.vue', 'DayTimeline.vue'].filter(
      (f) => /isAllDayActivity/.test(readFileSync(join(PLANNER_DIR, f), 'utf8'))
    );
    expect(users).toHaveLength(3);
    expect(
      /isAllDayActivity/.test(readFileSync(join(process.cwd(), 'src/utils/monthCells.ts'), 'utf8'))
    ).toBe(true);
  });
});
