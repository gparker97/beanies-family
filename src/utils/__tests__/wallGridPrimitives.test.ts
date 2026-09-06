/**
 * The additive primitives the beanie wall's time grid is built on.
 *
 * These are the pieces that ship in commit 1 — nothing here knows about pixels
 * or about Vue. Each test is written so the right and wrong answers are
 * DIFFERENT VALUES: a fixture where the correct and buggy results coincide is
 * not a test (docs/lessons.md).
 */
import { describe, it, expect } from 'vitest';
import { minutesOfDay, weekdayShort, dayOfMonth } from '@/utils/date';
import {
  ASSUMED_DURATION_MIN,
  activitySpanMinutes,
  wallDayAllDay,
  wallSharedAllDay,
  wallPeripheralVariant,
} from '@/utils/wallActivities';
import { computeAllDaySpans } from '@/utils/allDaySpans';
import type { FamilyActivity } from '@/types/models';

function activity(over: Partial<FamilyActivity> = {}): FamilyActivity {
  return {
    id: 'a1',
    title: 'Thing',
    date: '2026-09-03',
    category: 'other',
    assigneeIds: [],
    createdAt: '',
    updatedAt: '',
    ...over,
  } as FamilyActivity;
}

describe('minutesOfDay', () => {
  it('returns the exact offset for well-formed times', () => {
    expect(minutesOfDay('00:00')).toBe(0);
    expect(minutesOfDay('07:30')).toBe(450);
    expect(minutesOfDay('23:59')).toBe(1439);
  });

  it('returns null — never NaN and never 0 — for anything unusable', () => {
    // 0 matters as much as NaN here: a silent 0 would render at the top of the
    // axis, which is a plausible-looking wrong answer rather than an obvious one.
    for (const bad of ['', 'abc', '25:00', '12:99', '7:30:00', '7', ':30', '07:', ' 7:30']) {
      expect(minutesOfDay(bad), bad).toBeNull();
    }
    expect(minutesOfDay(undefined)).toBeNull();
    expect(minutesOfDay(null)).toBeNull();
  });

  it('never returns NaN for any of those inputs', () => {
    for (const bad of ['abc', '25:00', '12:99']) {
      expect(Number.isNaN(minutesOfDay(bad) as number)).toBe(false);
    }
  });
});

describe('weekdayShort / dayOfMonth', () => {
  it('reads the local calendar day, not a UTC-shifted one', () => {
    // 2026-09-03 is a Thursday. A UTC parse would land on the 2nd for anyone
    // east of Greenwich — which is exactly where this app's author lives.
    expect(weekdayShort('2026-09-03')).toBe('Thu');
    expect(dayOfMonth('2026-09-03')).toBe(3);
    expect(dayOfMonth('2026-08-31')).toBe(31);
  });
});

describe('activitySpanMinutes', () => {
  it('uses the real end time when there is one', () => {
    const span = activitySpanMinutes(activity({ startTime: '16:00', endTime: '18:00' }));
    expect(span).toEqual({ start: 960, end: 1080 });
  });

  it('applies the assumed duration ONLY when the end time is absent', () => {
    const span = activitySpanMinutes(activity({ startTime: '16:00' }));
    // 90, not 60 — the wall's constant, deliberately different from the planner's.
    expect(ASSUMED_DURATION_MIN).toBe(90);
    expect(span).toEqual({ start: 960, end: 960 + 90 });
  });

  it('honours a caller-supplied assumed duration', () => {
    expect(activitySpanMinutes(activity({ startTime: '16:00' }), 60)?.end).toBe(1020);
  });

  it('returns null for an all-day activity — it has no place on a time axis', () => {
    expect(activitySpanMinutes(activity({ isAllDay: true, startTime: '16:00' }))).toBeNull();
  });

  it('returns null, not a poisoned span, for an unreadable time', () => {
    expect(activitySpanMinutes(activity({ startTime: 'abc' }))).toBeNull();
  });

  it('never produces a negative or zero-length span', () => {
    const span = activitySpanMinutes(activity({ startTime: '18:00', endTime: '17:00' }));
    expect(span!.end).toBeGreaterThan(span!.start);
  });
});

describe('regressions found by review', () => {
  it('⭐ keeps an overnight activity a real span instead of a one-minute sliver', () => {
    // A sleepover / night shift / red-eye stored as 22:00-01:00 was clamped to
    // `start + 1`: a 1-minute block, an evening that folded away as "quiet", a
    // `past` state a minute after it began, and a fabricated "22:00-22:01".
    // `resolveActivityDays` has always treated this as next-day, so the wall was
    // the only surface disagreeing about how long the same record lasts.
    const span = activitySpanMinutes(activity({ startTime: '22:00', endTime: '01:00' }));
    expect(span).toEqual({ start: 1320, end: 1500 });
    expect(span!.end - span!.start).toBe(180);
  });

  it('⭐ treats a record with no start time as all-day, not as corrupt', () => {
    // `isAllDay` is optional and the form writes it as `isAllDay.value ||
    // undefined`, so a legitimately all-day record persists with the flag unset.
    // Reading the raw flag routed those to `rejected`, which styled them as
    // broken AND fired a false `wall_grid_unreadable_time` warning — poisoning
    // the one diagnostic this feature has for real data corruption.
    expect(activitySpanMinutes(activity({ startTime: undefined }))).toBeNull();
    expect(activitySpanMinutes(activity({ isAllDay: undefined, startTime: undefined }))).toBeNull();
  });
});

describe('wallDayAllDay', () => {
  const days = ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03'];
  const occurrenceFor = (a: FamilyActivity, ymd: string) => ({ activity: a, date: ymd });

  it('renders single-day all-day items as well as multi-day spans', () => {
    // ⭐ THE REGRESSION THIS FUNCTION EXISTS FOR. `computeAllDaySpans().spans` is
    // multi-day ONLY; birthdays, INSET days and bin night live in `singleByDate`.
    // Feeding the grid `spans` alone drops them from the days view entirely —
    // they are not timed, so they never reach the plot either.
    const trip = activity({
      id: 'trip',
      isAllDay: true,
      date: '2026-08-31',
      endDate: '2026-09-02',
    });
    const birthday = activity({ id: 'bday', isAllDay: true, date: '2026-09-03' });
    const inset = activity({ id: 'inset', isAllDay: true, date: '2026-09-01' });

    const result = computeAllDaySpans(
      [
        { activity: trip, date: '2026-08-31' },
        { activity: trip, date: '2026-09-01' },
        { activity: birthday, date: '2026-09-03' },
        { activity: inset, date: '2026-09-01' },
      ],
      days.map((d) => ({ dateStr: d }))
    );

    // The wrong answer here is 1, which is what `spans` alone would give.
    const rows = wallDayAllDay(result, days, occurrenceFor);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.occurrence.activity.id).sort()).toEqual(['bday', 'inset', 'trip']);
  });

  it('keeps the multi-day span width and places single-day items in their own column', () => {
    const trip = activity({
      id: 'trip',
      isAllDay: true,
      date: '2026-08-31',
      endDate: '2026-09-02',
    });
    const birthday = activity({ id: 'bday', isAllDay: true, date: '2026-09-03' });
    const result = computeAllDaySpans(
      [
        { activity: trip, date: '2026-08-31' },
        { activity: birthday, date: '2026-09-03' },
      ],
      days.map((d) => ({ dateStr: d }))
    );
    const rows = wallDayAllDay(result, days, occurrenceFor);
    const span = rows.find((r) => r.occurrence.activity.id === 'trip')!;
    const single = rows.find((r) => r.occurrence.activity.id === 'bday')!;
    expect(span).toMatchObject({ startCol: 0, span: 3, everyone: false });
    expect(single).toMatchObject({ startCol: 3, span: 1, everyone: false });
  });
});

describe('wallSharedAllDay', () => {
  const members = ['greg', 'sofia', 'leo'];

  it('spans ONCE, tagged everyone, when the item belongs to every column', () => {
    const term = activity({ id: 'term', isAllDay: true, assigneeIds: [] });
    const rows = wallSharedAllDay([{ activity: term, date: '2026-09-03' }], members);
    // The wrong answer is 3 — one repeat per lane, which is the same sentence
    // read three times.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ startCol: 0, span: 3, everyone: true });
  });

  it('renders one row per owning column when it is not everyone', () => {
    const club = activity({ id: 'club', isAllDay: true, assigneeIds: ['leo'] });
    const rows = wallSharedAllDay([{ activity: club, date: '2026-09-03' }], members);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ startCol: 2, span: 1, everyone: false });
  });

  it('never bridges two non-adjacent owners across a third who is not on it', () => {
    const swim = activity({ id: 'swim', isAllDay: true, assigneeIds: ['greg', 'leo'] });
    const rows = wallSharedAllDay([{ activity: swim, date: '2026-09-03' }], members);
    // Two separate 1-wide rows, NOT one 3-wide bar that would put Sofia on it.
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.span === 1)).toBe(true);
    expect(rows.map((r) => r.startCol)).toEqual([0, 2]);
  });

  it('ignores timed activities and dedupes repeated occurrences', () => {
    const timed = activity({ id: 't', startTime: '09:00' });
    const term = activity({ id: 'term', isAllDay: true });
    const rows = wallSharedAllDay(
      [
        { activity: timed, date: '2026-09-03' },
        { activity: term, date: '2026-09-03' },
        { activity: term, date: '2026-09-03' },
      ],
      members
    );
    expect(rows).toHaveLength(1);
  });

  it('⭐ does not call an owned event "everyone" just because the wall is filtered', () => {
    // The person filter sets visibleMemberIds to a single bean, so testing
    // coverage alone made the claim trivially true: tapping Leo relabelled
    // "Leo's birthday" as EVERYONE. "Everyone" means owned by nobody, not
    // "covers every column currently on screen".
    const birthday = activity({ id: 'bday', isAllDay: true, assigneeIds: ['leo'] });
    const rows = wallSharedAllDay([{ activity: birthday, date: '2026-09-03' }], ['leo']);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.everyone).toBe(false);
  });

  it('still calls a family-wide event everyone when the wall is filtered', () => {
    const term = activity({ id: 'term', isAllDay: true, assigneeIds: [] });
    const rows = wallSharedAllDay([{ activity: term, date: '2026-09-03' }], ['leo']);
    expect(rows[0]!.everyone).toBe(true);
  });

  it('returns nothing rather than throwing when there are no members', () => {
    expect(wallSharedAllDay([{ activity: activity({ isAllDay: true }), date: 'x' }], [])).toEqual(
      []
    );
  });
});

describe('wallPeripheralVariant', () => {
  it('downgrades a BAND to a strip once the busiest column passes the threshold', () => {
    expect(wallPeripheralVariant('band', 8, false)).toBe('strip');
  });

  it('⭐ never collapses a RAIL — a side rail buys the grid no height', () => {
    // Collapsing the today view's rail left a 40px bar stranded at the top of a
    // 296px column of white space, and gave the grid nothing: the rail sits
    // BESIDE the grid, not above it.
    expect(wallPeripheralVariant('rail', 8, false)).toBe('rail');
    expect(wallPeripheralVariant('rail', 40, false)).toBe('rail');
  });

  it('keeps the caller PREFERENCE when the day is quiet — never promotes rail to band', () => {
    // The today view renders a rail in landscape; a helper that returned a bare
    // 'band' would silently widen it beside a grid with no room for it.
    expect(wallPeripheralVariant('rail', 3, false)).toBe('rail');
    expect(wallPeripheralVariant('band', 3, false)).toBe('band');
  });

  it('allows more before collapsing in portrait, where there is more height', () => {
    expect(wallPeripheralVariant('band', 8, true)).toBe('band');
    expect(wallPeripheralVariant('band', 10, true)).toBe('strip');
  });

  it('⭐ collapses a BAND on a short window however quiet the day is', () => {
    // The 1024x768 defect: six bean lanes, a quiet day, and a full band that
    // left the grid 101px — a whole day in the height of three lines. The event
    // count cannot see this; only the window's height can.
    expect(wallPeripheralVariant('band', 0, false, false)).toBe('strip');
    expect(wallPeripheralVariant('band', 3, false, false)).toBe('strip');
    expect(wallPeripheralVariant('band', 3, true, false)).toBe('strip');
  });

  it('⚠️ a short window still never collapses a RAIL', () => {
    // A rail is beside the grid, so a short window is not an argument against
    // it — and stranding it as a strip would waste 296px of width as well.
    expect(wallPeripheralVariant('rail', 3, false, false)).toBe('rail');
  });

  it('defaults to having room, for the ONE caller that cannot know', () => {
    // ⚠️ The previous version of this test claimed to cover an SSR/jsdom
    // fallback. It covered nothing: the shell now takes `roomForBand` as a prop
    // and always passes it, so the default is reached only by a call site that
    // has no viewport to ask — and `band` is the right answer there, because the
    // band is the preference and the first real measurement corrects it.
    expect(wallPeripheralVariant('band', 3, false)).toBe('band');
  });
});
