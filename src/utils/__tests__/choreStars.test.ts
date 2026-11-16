/**
 * Stars and rewards (#148), step 0: the pure rules closing a week needs (plan Testing Plan items
 * 1 and 2). `planWeekClose` is tested as a table, through its public answer only.
 */
import { describe, it, expect } from 'vitest';
import type { Chore, ChoreMark, ChoreStarGift, ChoreWeek, FamilyMember } from '@/types/models';
import {
  applyRewardsPatch,
  barStars,
  choreWeekId,
  closedRecords,
  closedWeek,
  coveredDays,
  isStarEarner,
  isWeekClosed,
  openWeek,
  planWeekClose,
  rewardsOf,
  starsOf,
  weekBonusEntries,
  weekBreakdown,
  type ChoreWeekDraft,
  type WeekCloseInput,
} from '../choreStars';
import { choreMarkId, choreWeekRecord, indexMarks, markCutoffYmd, shiftChoreDay } from '../chores';

// 2026-11-16 is a Monday. Weeks start Monday (weekStartDay 1) unless a test says otherwise.
const MON = '2026-11-16';
const W0 = '2026-11-09'; // last week: Mon 11-09 .. Sun 11-15
const W1 = '2026-11-02'; // the week before
const T = '2026-09-01T08:00:00.000Z'; // before every week the tests close, so chores are due

function chore(id: string, over: Partial<Chore> = {}): Chore {
  return {
    id,
    title: id,
    emoji: '🧹',
    assigneeIds: ['kid'],
    block: 'morning',
    sortOrder: 0,
    createdBy: 'mom',
    createdAt: T,
    updatedAt: T,
    ...over,
  };
}

function mark(date: string, ref: string, memberId = 'kid'): ChoreMark {
  return {
    id: choreMarkId('done', memberId, date, ref),
    kind: 'done',
    memberId,
    date,
    ref,
    by: memberId,
    createdAt: `${date}T08:00:00.000Z`,
    updatedAt: `${date}T08:00:00.000Z`,
  };
}

function gift(date: string, stars: number, memberId = 'kid'): ChoreStarGift {
  return { id: `g-${date}-${stars}`, memberId, date, stars, by: 'mom', createdAt: T, updatedAt: T };
}

const days7 = (start: string) => Array.from({ length: 7 }, (_, i) => shiftChoreDay(start, i));

/** Ticks of `ref` on each of the given days. */
const ticks = (dates: readonly string[], ref = 'c1', memberId = 'kid') =>
  dates.map((d) => mark(d, ref, memberId));

const ON = { on: true, weeklyOn: true, barPct: 100, startedOn: '2026-09-01' };

function input(over: Partial<WeekCloseInput> = {}): WeekCloseInput {
  return {
    todayYmd: MON,
    weekStartDay: 1,
    rewards: ON,
    earners: ['kid'],
    living: new Set(['kid', 'mom']),
    chores: [chore('c1')],
    marks: [],
    gifts: [],
    weeks: [],
    ...over,
  };
}

/** A stored record from a draft (what the repository writes). */
const stored = (d: ChoreWeekDraft): ChoreWeek => ({ ...d, createdAt: T, updatedAt: T });

/** Only the week starting `weekStart` from a plan's writes. */
const writeOf = (plan: { write: ChoreWeekDraft[] }, weekStart: string) =>
  plan.write.find((w) => w.weekStart === weekStart);

/** Records for every closable week as `planWeekClose` would build them from `base`. */
function frozenFrom(base: WeekCloseInput): ChoreWeek[] {
  return planWeekClose(base).write.map(stored);
}

describe('applyRewardsPatch', () => {
  const TODAY = '2026-11-18';
  it.each([
    ['absent, turned on: stamped', undefined, { on: true }, { on: true, startedOn: TODAY }],
    [
      'off, turned on: stamped again',
      { on: false, startedOn: W1 },
      { on: true },
      { on: true, startedOn: TODAY },
    ],
    [
      'on, "turned on" again: kept',
      { on: true, startedOn: W1 },
      { on: true },
      { on: true, startedOn: W1 },
    ],
    [
      'on, turned off: kept (the pause starts)',
      { on: true, startedOn: W1 },
      { on: false },
      { on: false, startedOn: W1 },
    ],
    ['absent, turned off', undefined, { on: false }, { on: false }],
    [
      'only the patched keys change; a peer’s keys stay',
      { on: true, startedOn: W1, title: 'Pizza', emoji: '🍕', barPct: 80 },
      { barPct: 90 },
      { on: true, startedOn: W1, title: 'Pizza', emoji: '🍕', barPct: 90 },
    ],
    [
      'text is trimmed; trimmed to nothing is removed',
      { on: true, title: 'Pizza', emoji: '🍕' },
      { title: '  Movie  ', emoji: '   ' },
      { on: true, title: 'Movie', emoji: undefined },
    ],
  ] as const)('%s', (_n, current, patch, want) => {
    const before = current === undefined ? undefined : structuredClone(current);
    expect(applyRewardsPatch(current, patch, TODAY)).toEqual(want);
    // Never mutates what it was handed (the projection's object).
    expect(current).toEqual(before);
  });
});

describe('rewardsOf', () => {
  it('absent, null settings and a malformed value read as off with the defaults', () => {
    for (const s of [undefined, null, {}, { choreRewards: 'yes' as never }]) {
      expect(rewardsOf(s)).toEqual({
        on: false,
        startedOn: undefined,
        weeklyOn: false,
        title: undefined,
        emoji: undefined,
        barPct: 100,
      });
    }
  });

  it('{ on: false } is off; on must be exactly true', () => {
    expect(rewardsOf({ choreRewards: { on: false } }).on).toBe(false);
    expect(rewardsOf({ choreRewards: { on: 'true' as never } }).on).toBe(false);
    expect(rewardsOf({ choreRewards: { on: true } }).on).toBe(true);
  });

  it.each([
    [0, 50],
    [47, 50],
    [52, 50],
    [53, 55],
    [85, 85],
    [300, 100],
    ['90' as never, 100],
    [Number.NaN, 100],
  ])('clamps a bar of %s to %s', (barPct, want) => {
    expect(rewardsOf({ choreRewards: { on: true, barPct } }).barPct).toBe(want);
  });

  it('keeps a valid startedOn and drops a malformed one', () => {
    expect(rewardsOf({ choreRewards: { on: true, startedOn: W0 } }).startedOn).toBe(W0);
    expect(rewardsOf({ choreRewards: { on: true, startedOn: '11/09' } }).startedOn).toBeUndefined();
  });
});

describe('starsOf / isStarEarner / ids / bars', () => {
  it.each([
    [undefined, 1],
    [0, 1],
    [1, 1],
    [3, 3],
    [9, 5],
    [2.5, 3],
    [-4, 1],
    ['4' as never, 1],
    [Number.POSITIVE_INFINITY, 1],
  ])('starsOf(%s) = %s', (stars, want) => {
    expect(starsOf({ stars })).toBe(want);
  });

  it('isStarEarner: kids earn; grown-ups, owners and pets do not', () => {
    const m = (over: Partial<FamilyMember>) => over as FamilyMember;
    expect(isStarEarner(m({ ageGroup: 'child', role: 'member' }))).toBe(true);
    expect(isStarEarner(m({ ageGroup: 'teen' as never, role: 'member' }))).toBe(true);
    expect(isStarEarner(m({ ageGroup: 'adult', role: 'member' }))).toBe(false);
    expect(isStarEarner(m({ ageGroup: 'child', role: 'owner' }))).toBe(false);
    expect(isStarEarner(m({ ageGroup: 'child', isPet: true }))).toBe(false);
  });

  it('choreWeekId is deterministic', () => {
    expect(choreWeekId('kid', W0)).toBe('kid:2026-11-09');
  });

  it('barStars rounds up and is 0 with nothing due', () => {
    expect(barStars(7, 85)).toBe(6);
    expect(barStars(20, 55)).toBe(11);
    expect(barStars(10, 100)).toBe(10);
    expect(barStars(0, 100)).toBe(0);
  });

  it('isWeekClosed / closedRecords: a week closes the day after its seventh day', () => {
    expect(isWeekClosed(W0, '2026-11-15')).toBe(false);
    expect(isWeekClosed(W0, MON)).toBe(true);
    expect(isWeekClosed('garbage', MON)).toBe(false);
    const recs = [{ weekStart: W0 }, { weekStart: MON }];
    expect(closedRecords(recs, MON)).toEqual([{ weekStart: W0 }]);
  });
});

describe('coveredDays', () => {
  it('is empty with no other frozen week, and ignores the week itself', () => {
    expect([...coveredDays(W0, [])]).toEqual([]);
    expect([...coveredDays(W0, [W0, W1])]).toEqual([]);
  });

  it('Monday to Sunday start: the new week leaves out the Sunday the old week froze', () => {
    // Old Monday week 11-02..11-08 frozen; new Sunday week starts 11-08.
    expect([...coveredDays('2026-11-08', [W1])]).toEqual(['2026-11-08']);
  });

  it('Sunday to Monday start: the new week leaves out the six days the old week froze', () => {
    // Old Sunday week 11-08..11-14 frozen; new Monday week 11-09..11-15.
    expect([...coveredDays(W0, ['2026-11-08'])]).toEqual(days7(W0).slice(0, 6));
  });
});

describe('openWeek / closedWeek', () => {
  const index = (marks: ChoreMark[]) => indexMarks(marks);
  const weekOf = (chores: Chore[], marks: ChoreMark[], start = W0) =>
    choreWeekRecord(chores, index(marks), 'kid', start, 1, new Set(['kid']));

  it('counts each tick at the chore’s value, full is all seven days, done/due run through today', () => {
    const chores = [chore('c1'), chore('c2', { stars: 2, sortOrder: 1 })];
    const marks = [...ticks([W0, '2026-11-10']), mark(W0, 'c2')];
    const w = openWeek(weekOf(chores, marks), [], ON, new Set(), '2026-11-10');
    expect(w.days).toEqual([3, 1, 0, 0, 0, 0, 0]);
    expect(w.stars).toBe(4);
    expect(w.full).toBe(21); // (1 + 2) x 7
    expect(w.bar).toBe(21);
    expect([w.done, w.due]).toEqual([3, 4]);
    expect(w.openToday).toBe(2); // c2 still open on Tuesday
    expect(w.hitOn).toBeUndefined();
  });

  it('hitOn: a bonus counts on its own day; a take-back that un-reaches the bar clears it', () => {
    const chores = [chore('c1')];
    const marks = ticks(days7(W0).slice(0, 5)); // Mon..Fri
    const bar85 = { weeklyOn: true, barPct: 85 }; // full 7 -> bar 6
    const plain = openWeek(weekOf(chores, marks), [], bar85, new Set(), MON);
    expect(plain.bar).toBe(6);
    expect(plain.hitOn).toBeUndefined();
    const bonusWed = openWeek(
      weekOf(chores, marks),
      [gift('2026-11-11', 3)],
      bar85,
      new Set(),
      MON
    );
    expect(bonusWed.total).toBe(8);
    expect(bonusWed.hitOn).toBe('2026-11-11'); // 1 + 1 + (1 + 3) = 6 at the end of Wednesday
    const takeBack = openWeek(
      weekOf(chores, marks),
      [gift('2026-11-11', 3), gift('2026-11-14', -3)],
      bar85,
      new Set(),
      MON
    );
    expect(takeBack.total).toBe(5);
    expect(takeBack.hitOn).toBeUndefined();
  });

  it('a week total never goes below zero; no weekly reward means bar 0', () => {
    const w = openWeek(
      weekOf([chore('c1')], ticks([W0])),
      [gift('2026-11-10', -4)],
      { weeklyOn: false, barPct: 100 },
      new Set(),
      MON
    );
    expect(w.stars).toBe(1);
    expect(w.bonus).toBe(-4);
    expect(w.total).toBe(0);
    expect(w.bar).toBe(0);
  });

  it('a covered day counts nothing and is not due, its gifts included', () => {
    const covered = new Set([W0]);
    const w = openWeek(weekOf([chore('c1')], ticks(days7(W0))), [gift(W0, 2)], ON, covered, MON);
    expect(w.days).toEqual([0, 1, 1, 1, 1, 1, 1]);
    expect([w.full, w.due, w.done, w.bonus]).toEqual([6, 6, 6, 0]);
  });

  it('closedWeek reads a record as the same shape, defensively', () => {
    const rec = stored({
      id: 'kid:x',
      memberId: 'kid',
      weekStart: W0,
      done: 5,
      due: 7,
      stars: 5,
      bonus: -9,
      full: 7,
      bar: 7,
      days: [1, 1, 1, 1, 1],
      marks: 5,
    });
    expect(closedWeek(rec)).toEqual({
      weekStart: W0,
      stars: 5,
      bonus: -9,
      total: 0,
      full: 7,
      bar: 7,
      days: [1, 1, 1, 1, 1, 0, 0],
      done: 5,
      due: 7,
      openToday: 0,
      ahead: 0,
      hitOn: undefined,
    });
  });
});

describe('planWeekClose', () => {
  it('off, or a bad clock, plans nothing', () => {
    const marks = ticks(days7(W0));
    expect(planWeekClose(input({ marks, rewards: { ...ON, on: false } })).write).toEqual([]);
    expect(planWeekClose(input({ marks, todayYmd: 'not-a-day' })).write).toEqual([]);
  });

  it('creates every closable week with no record, whole, from the marks', () => {
    const marks = ticks(days7(W0).slice(0, 6)); // six of seven days
    const plan = planWeekClose(input({ marks }));
    expect(plan.created).toBe(5); // 11-09, 11-02, 10-26, 10-19, 10-12 (= the cutoff)
    expect(plan.write.map((w) => w.weekStart)).toEqual([
      W0,
      W1,
      '2026-10-26',
      '2026-10-19',
      '2026-10-12',
    ]);
    expect(writeOf(plan, W0)).toEqual({
      id: 'kid:2026-11-09',
      memberId: 'kid',
      weekStart: W0,
      done: 6,
      due: 7,
      stars: 6,
      bonus: 0,
      full: 7,
      bar: 7,
      days: [1, 1, 1, 1, 1, 1, 0],
      marks: 6,
    });
  });

  it('the oldest closable week is the cutoff markCutoffYmd gives (one shared cutoff)', () => {
    const tue = shiftChoreDay(MON, 1); // cutoff 10-13: the 10-12 week has started to age out
    expect(markCutoffYmd(tue)).toBe('2026-10-13');
    const plan = planWeekClose(input({ todayYmd: tue }));
    expect(plan.write.map((w) => w.weekStart).at(-1)).toBe('2026-10-19');
    expect(plan.missed).toBe(1); // 10-12 left retention with no record
  });

  it('a pause: with startedOn the LAST turn-on, the weeks while off get no record and none counts missed', () => {
    // On from W1, off for W0, on again this Wednesday: W0 (and W1, frozen or not before the
    // pause) are not closable any more; the plan has nothing for them.
    const plan = planWeekClose(
      input({ marks: ticks(days7(W0)), rewards: { ...ON, startedOn: shiftChoreDay(MON, 2) } })
    );
    expect(plan.write).toEqual([]);
    expect(plan.missed).toBe(0);
    // Next Monday the turn-on week is frozen whole, from its first day.
    const next = planWeekClose(
      input({
        todayYmd: shiftChoreDay(MON, 7),
        marks: ticks(days7(MON)),
        rewards: { ...ON, startedOn: shiftChoreDay(MON, 2) },
      })
    );
    expect(next.write.map((w) => w.weekStart)).toEqual([MON]);
    expect(writeOf(next, MON)).toMatchObject({ marks: 7, stars: 7 });
  });

  it('nothing to write when every record matches', () => {
    const base = input({ marks: ticks(days7(W0)), rewards: { ...ON, startedOn: W1 } });
    const plan = planWeekClose({ ...base, weeks: frozenFrom(base) });
    expect(plan).toEqual({ write: [], created: 0, resettled: 0, late: 0, fewer: 0, missed: 0 });
  });

  it('re-settles last week on a late tick (raw count higher)', () => {
    const base = input({ marks: ticks(days7(W0).slice(0, 3)) });
    const weeks = frozenFrom(base);
    const plan = planWeekClose({ ...base, weeks, marks: ticks(days7(W0).slice(0, 4)) });
    expect(plan.resettled).toBe(1);
    expect(plan.write).toHaveLength(1);
    expect(writeOf(plan, W0)).toMatchObject({ marks: 4, stars: 4, done: 4 });
  });

  it('re-settles last week on a late bonus', () => {
    const base = input({ marks: ticks(days7(W0)) });
    const weeks = frozenFrom(base);
    const plan = planWeekClose({ ...base, weeks, gifts: [gift('2026-11-14', 2)] });
    expect(plan.resettled).toBe(1);
    expect(writeOf(plan, W0)).toMatchObject({ bonus: 2, marks: 7 });
  });

  it('never re-settles on a chore delete or a revalue (the raw count is unchanged)', () => {
    const chores = [chore('c1'), chore('c2', { sortOrder: 1 })];
    const marks = [...ticks(days7(W0)), ...ticks(days7(W0), 'c2')];
    const base = input({ chores, marks });
    const weeks = frozenFrom(base);
    expect(planWeekClose({ ...base, weeks, chores: [chore('c1')] }).write).toEqual([]);
    expect(
      planWeekClose({ ...base, weeks, chores: [chore('c1', { stars: 5 }), chores[1]!] }).write
    ).toEqual([]);
  });

  it('a LOWER raw count is never written and is counted fewer, with and without a bonus change', () => {
    const base = input({ marks: ticks(days7(W0)) });
    const weeks = frozenFrom(base);
    const fewer = ticks(days7(W0).slice(0, 5));
    const a = planWeekClose({ ...base, weeks, marks: fewer });
    expect(a.write).toEqual([]);
    expect(a.fewer).toBe(1);
    const b = planWeekClose({ ...base, weeks, marks: fewer, gifts: [gift(W0, 3)] });
    expect(b.write).toEqual([]);
    expect(b.fewer).toBe(1);
  });

  it('a bonus difference after the re-settle window is counted late and not written', () => {
    const base = input({ marks: ticks(days7(W1).slice(0, 2)) });
    const weeks = frozenFrom(base);
    // A bonus dated 11-03 syncs only today: the 11-02 week ended on 11-08, more than 7 days ago.
    const plan = planWeekClose({ ...base, weeks, gifts: [gift('2026-11-03', 2)] });
    expect(plan.write).toEqual([]);
    expect(plan.late).toBe(1);
    // Inside the window (the day it ends + 7) it would have re-settled.
    const inWindow = planWeekClose({
      ...base,
      todayYmd: '2026-11-15',
      weeks: frozenFrom({ ...base, todayYmd: '2026-11-15' }),
      gifts: [gift('2026-11-03', 2)],
    });
    expect(inWindow.resettled).toBe(1);
  });

  it('a HIGHER raw count re-settles at any age inside retention, bonus and all', () => {
    const base = input({ marks: ticks(days7(W1).slice(0, 2)) });
    const weeks = frozenFrom(base);
    // A tick on 11-03 syncs only today, after the 7-day window: still put right.
    const later = planWeekClose({
      ...base,
      weeks,
      marks: ticks(days7(W1).slice(0, 3)),
      gifts: [gift('2026-11-04', 1)],
    });
    expect(later.late).toBe(0);
    expect(later.resettled).toBe(1);
    expect(writeOf(later, W1)).toMatchObject({ marks: 3, stars: 3, bonus: 1 });
    // The oldest closable week (10-12, the cutoff) too.
    const oldest = input({ marks: ticks(['2026-10-12']) });
    const upward = planWeekClose({
      ...oldest,
      weeks: frozenFrom(oldest),
      marks: ticks(['2026-10-12', '2026-10-13']),
    });
    expect(writeOf(upward, '2026-10-12')).toMatchObject({ marks: 2 });
    // ...but never outside retention: a week before the cutoff is not considered at all.
    const tue = shiftChoreDay(MON, 1);
    const gone = planWeekClose({
      ...oldest,
      todayYmd: tue,
      weeks: frozenFrom(oldest),
      marks: ticks(['2026-10-12', '2026-10-13']),
    });
    expect(writeOf(gone, '2026-10-12')).toBeUndefined();
  });

  it('a LOWER raw count never rewrites at any age, even with a bonus change', () => {
    const base = input({ marks: ticks(days7(W1)) });
    const weeks = frozenFrom(base);
    const plan = planWeekClose({
      ...base,
      weeks,
      marks: ticks(days7(W1).slice(0, 2)),
      gifts: [gift('2026-11-03', 4)],
    });
    expect(writeOf(plan, W1)).toBeUndefined();
    expect(plan.fewer).toBeGreaterThanOrEqual(1);
  });

  describe('no empty records', () => {
    const none = { ...ON, startedOn: '2026-09-01' };
    it.each([
      ['no chores at all', { chores: [] as Chore[] }],
      [
        'chores only for someone else',
        { chores: [chore('c1', { assigneeIds: ['mom'] })] as Chore[] },
      ],
    ])('%s: nothing is written and nothing is missed', (_n, over) => {
      const today = shiftChoreDay(MON, 1); // the 10-12 week has just left retention
      const plan = planWeekClose(input({ ...over, rewards: none, todayYmd: today }));
      expect(plan).toEqual({ write: [], created: 0, resettled: 0, late: 0, fewer: 0, missed: 0 });
    });

    it('a week with only a gift, or only a mark of a deleted chore, IS written', () => {
      const gifted = planWeekClose(
        input({ chores: [], gifts: [gift('2026-11-11', 2)], rewards: { ...ON, startedOn: W0 } })
      );
      expect(gifted.write.map((w) => [w.weekStart, w.bonus, w.full])).toEqual([[W0, 2, 0]]);
      const orphanMark = planWeekClose(
        input({ chores: [], marks: ticks([W0], 'gone'), rewards: { ...ON, startedOn: W0 } })
      );
      expect(orphanMark.write.map((w) => [w.weekStart, w.marks, w.stars])).toEqual([[W0, 1, 0]]);
    });

    it('the weeks before a chore existed get no record', () => {
      const late = chore('c1', { createdAt: '2026-11-04T08:00:00.000Z' });
      const plan = planWeekClose(input({ chores: [late], rewards: none }));
      expect(plan.write.map((w) => w.weekStart)).toEqual([W0, W1]);
    });

    it('a week with chores due but nothing done is written (it is a real zero)', () => {
      const plan = planWeekClose(input({ rewards: { ...ON, startedOn: W0 } }));
      expect(plan.write.map((w) => [w.weekStart, w.done, w.due, w.stars])).toEqual([[W0, 0, 7, 0]]);
    });

    it('missed counts only a week that had something in it', () => {
      const today = shiftChoreDay(MON, 1);
      // Chores were due that week (c1 is daily): missed.
      expect(planWeekClose(input({ todayYmd: today, rewards: none })).missed).toBe(1);
      // A chore that starts later (only on weeks it occurs): the gift alone makes it missed.
      const sat = chore('c1', { days: [6] });
      expect(
        planWeekClose(input({ todayYmd: today, rewards: none, chores: [], gifts: [] })).missed
      ).toBe(0);
      expect(
        planWeekClose(
          input({ todayYmd: today, rewards: none, chores: [], gifts: [gift('2026-10-14', 1)] })
        ).missed
      ).toBe(1);
      expect(planWeekClose(input({ todayYmd: today, rewards: none, chores: [sat] })).missed).toBe(
        1
      );
    });
  });

  it('missed: a week that just left retention with no record; none when it has one', () => {
    const tue = shiftChoreDay(MON, 1);
    expect(planWeekClose(input({ todayYmd: tue })).missed).toBe(1);
    const old = stored({ ...planWeekClose(input()).write.at(-1)! }); // the 10-12 record
    expect(planWeekClose(input({ todayYmd: tue, weeks: [old] })).missed).toBe(0);
  });

  it('the week holding startedOn is frozen whole; the week before it is not', () => {
    const marks = ticks(days7(W0));
    const plan = planWeekClose(input({ marks, rewards: { ...ON, startedOn: '2026-11-12' } }));
    expect(plan.write.map((w) => w.weekStart)).toEqual([W0]);
    expect(writeOf(plan, W0)).toMatchObject({ marks: 7, stars: 7, days: [1, 1, 1, 1, 1, 1, 1] });
    expect(plan.missed).toBe(0);
  });

  it('only earners who are living members get records', () => {
    const marks = [...ticks(days7(W0)), ...ticks(days7(W0), 'c1', 'gone')];
    const plan = planWeekClose(
      input({ marks, earners: ['kid', 'gone'], rewards: { ...ON, startedOn: W0 } })
    );
    expect(plan.write.map((w) => w.memberId)).toEqual(['kid']);
  });

  it('after a week-start change no day counts twice; a week with every day covered is not written', () => {
    // Sunday-start weeks 11-08..11-14 and 11-15..11-21 were frozen; the family moved to Monday.
    const today = '2026-11-23';
    const sundayWeeks = ['2026-11-08', '2026-11-15'].map((ws) =>
      stored({
        id: choreWeekId('kid', ws),
        memberId: 'kid',
        weekStart: ws,
        done: 7,
        due: 7,
        stars: 7,
        bonus: 0,
        full: 7,
        bar: 7,
        days: [1, 1, 1, 1, 1, 1, 1],
        marks: 7,
      })
    );
    const marks = ticks(days7('2026-11-08').concat(days7('2026-11-15'), ['2026-11-22']));
    const plan = planWeekClose(
      input({ todayYmd: today, marks, weeks: sundayWeeks, rewards: { ...ON, startedOn: W0 } })
    );
    // 11-09..11-15 is wholly inside the two Sunday weeks: not written. 11-16..11-22 keeps only
    // 11-22, the one day no Sunday week froze.
    expect(writeOf(plan, W0)).toBeUndefined();
    expect(writeOf(plan, MON)).toMatchObject({
      days: [0, 0, 0, 0, 0, 0, 1],
      stars: 1,
      due: 1,
      full: 1,
      marks: 1,
    });
  });

  it('a clock a month ahead plans only whole records, and the later right-clock plan replaces each', () => {
    // Real today: Wed 11-18; the ticks so far this week are Mon and Tue. A device 28 days ahead
    // thinks it is 12-16 and freezes this week (and the next three) early.
    const real = '2026-11-18';
    const soFar = ticks(['2026-11-16', '2026-11-17']);
    const fast = planWeekClose(
      input({ todayYmd: '2026-12-16', marks: soFar, rewards: { ...ON, startedOn: MON } })
    );
    expect(fast.write.map((w) => w.weekStart)).toEqual([
      '2026-12-07',
      '2026-11-30',
      '2026-11-23',
      MON,
    ]);
    for (const w of fast.write) expect(w.days).toHaveLength(7);
    const early = fast.write.map(stored);
    // The right clock ignores every early record while its week is open...
    expect(closedRecords(early, real)).toEqual([]);
    expect(
      planWeekClose(
        input({ todayYmd: real, marks: soFar, weeks: early, rewards: { ...ON, startedOn: MON } })
      ).write
    ).toEqual([]);
    // ...and when the week really ends, with the rest of its ticks, it puts the record right.
    const all = ticks(days7(MON));
    const right = planWeekClose(
      input({
        todayYmd: '2026-11-23',
        marks: all,
        weeks: early,
        rewards: { ...ON, startedOn: MON },
      })
    );
    expect(right.resettled).toBe(1);
    expect(writeOf(right, MON)).toMatchObject({ marks: 7, stars: 7 });
  });

  it('a clock six weeks behind, with that period’s marks swept, plans no write', () => {
    // Records for every week since 09-28 exist (frozen when their marks were there). Real today
    // is 12-28, so marks before 11-23 are gone. A device set back six weeks thinks it is 11-16.
    const recs = ['2026-10-12', '2026-10-19', '2026-10-26', W1, W0].map((ws) =>
      stored({
        id: choreWeekId('kid', ws),
        memberId: 'kid',
        weekStart: ws,
        done: 6,
        due: 7,
        stars: 6,
        bonus: 0,
        full: 7,
        bar: 7,
        days: [1, 1, 1, 1, 1, 1, 0],
        marks: 6,
      })
    );
    const plan = planWeekClose(input({ todayYmd: MON, marks: ticks(['2026-12-21']), weeks: recs }));
    expect(plan.write).toEqual([]);
    expect(plan.fewer).toBe(5);
  });
});

describe('planWeekClose with includeOpen (the turn-off)', () => {
  const FRI = '2026-11-20';
  const at = (over: Partial<WeekCloseInput> = {}) =>
    input({ todayYmd: FRI, rewards: { ...ON, startedOn: MON }, includeOpen: true, ...over });

  it.each([
    ['ticks only', { marks: ticks(days7(MON).slice(0, 4)) }, { stars: 4, bonus: 0, marks: 4 }],
    ['a gift only', { gifts: [gift('2026-11-18', 2)] }, { stars: 0, bonus: 2, marks: 0 }],
    [
      'ticks and a take-back',
      { marks: ticks(days7(MON).slice(0, 3)), gifts: [gift('2026-11-19', -1)] },
      { stars: 3, bonus: -1, marks: 3 },
    ],
  ])('records the open week as it stands: %s', (_n, over, want) => {
    const plan = planWeekClose(at(over));
    expect(writeOf(plan, MON)).toMatchObject({ id: choreWeekId('kid', MON), ...want });
    // done / due run through today (Friday), `full` is all seven days.
    expect(writeOf(plan, MON)).toMatchObject({ due: 5, full: 7 });
  });

  it('nothing earned (chores due, nothing ticked, no gift): no record for the open week', () => {
    expect(planWeekClose(at()).write).toEqual([]);
  });

  it('without includeOpen the open week is never planned (the close)', () => {
    const plan = planWeekClose(at({ includeOpen: false, marks: ticks(days7(MON).slice(0, 4)) }));
    expect(plan.write).toEqual([]);
  });

  it('an early record from an earlier turn-off this week: equal marks write nothing, more marks re-settle', () => {
    const marks = ticks(days7(MON).slice(0, 3));
    const early = planWeekClose(at({ marks })).write.map(stored);
    expect(planWeekClose(at({ marks, weeks: early })).write).toEqual([]);
    const more = planWeekClose(at({ marks: ticks(days7(MON).slice(0, 5)), weeks: early }));
    expect(more.resettled).toBe(1);
    expect(writeOf(more, MON)).toMatchObject({ stars: 5, marks: 5 });
  });

  it('closed weeks the close would write go in the same plan', () => {
    const plan = planWeekClose(
      at({
        rewards: { ...ON, startedOn: W0 },
        marks: ticks([...days7(W0), ...days7(MON).slice(0, 2)]),
      })
    );
    expect(plan.write.map((w) => [w.weekStart, w.stars])).toEqual([
      [MON, 2],
      [W0, 7],
    ]);
  });

  it('the early record is ignored by readers while its week is open, and closes once without double counting', () => {
    const early = planWeekClose(at({ marks: ticks(days7(MON).slice(0, 3)) })).write.map(stored);
    // Readers trust it only once the week has closed on this clock.
    expect(closedRecords(early, FRI)).toEqual([]);
    // On again the same day; the week ends with two more ticks: re-settled to five, one record.
    const plan = planWeekClose(
      input({
        todayYmd: '2026-11-23',
        rewards: { ...ON, startedOn: FRI },
        marks: ticks(days7(MON).slice(0, 5)),
        weeks: early,
      })
    );
    expect(plan.write).toHaveLength(1);
    expect(writeOf(plan, MON)).toMatchObject({ stars: 5, marks: 5 });
  });
});

describe("weekBreakdown (a week bar's summary): it always adds up to the bar", () => {
  const rec = (over: Partial<ChoreWeek> = {}): ChoreWeek =>
    stored({
      id: choreWeekId('kid', W0),
      memberId: 'kid',
      weekStart: W0,
      done: 5,
      due: 7,
      stars: 7,
      bonus: 0,
      full: 9,
      bar: 9,
      days: [1, 2, 0, 3, 1, 0, 0],
      marks: 5,
      ...over,
    });
  const giftOn = (id: string, date: string, stars: number): ChoreStarGift => ({
    ...gift(date, stars),
    id,
  });

  it.each([
    ['a closed week, no bonus', rec(), [], 7, 0, false],
    [
      'a closed week, entries that add up to its bonus',
      rec({ bonus: 2 }),
      [giftOn('a', '2026-11-10', 3), giftOn('b', '2026-11-12', -1)],
      9,
      2,
      false,
    ],
    [
      'a gift the record never took in: one net line',
      rec({ bonus: 2 }),
      [giftOn('a', '2026-11-10', 2), giftOn('late', '2026-11-14', 1)],
      9,
      2,
      false,
    ],
    [
      'a take-away past the week: the total is 0, floored',
      rec({ stars: 1, days: [1, 0, 0, 0, 0, 0, 0], bonus: -3 }),
      [giftOn('t', '2026-11-11', -3)],
      0,
      -3,
      true,
    ],
  ] as const)('%s', (_n, record, gifts, total, bonus, floored) => {
    const week = closedWeek(record);
    const b = weekBreakdown(week, gifts as unknown as ChoreStarGift[], null, MON);
    expect(b.days.map((d) => d.ymd)).toEqual(days7(W0));
    expect(b.days.map((d) => d.stars)).toEqual([...record.days]);
    // The add-up property: the days plus the net bonus, floored at 0, is the bar's total.
    expect(b.stars).toBe(b.days.reduce((n, d) => n + d.stars, 0));
    expect(b.total).toBe(Math.max(0, b.stars + b.bonus));
    expect(b.total).toBe(week.total);
    expect([b.total, b.bonus, b.floored]).toEqual([total, bonus, floored]);
    const listed = b.entries?.reduce((n, g) => n + g.stars, 0);
    if (b.entries) expect(listed).toBe(b.bonus);
  });

  it('entries listed only when they add up; otherwise null (the net line)', () => {
    const good = weekBreakdown(
      closedWeek(rec({ bonus: 2 })),
      [giftOn('a', '2026-11-10', 2)],
      null,
      MON
    );
    expect(good.entries?.map((g) => g.id)).toEqual(['a']);
    const off = weekBreakdown(
      closedWeek(rec({ bonus: 2 })),
      [giftOn('a', '2026-11-10', 2), giftOn('late', '2026-11-14', 1)],
      null,
      MON
    );
    expect(off.entries).toBeNull();
    // Another week's gift is not this week's.
    const other = weekBreakdown(closedWeek(rec()), [giftOn('x', MON, 2)], null, MON);
    expect(other.entries).toBeNull();
    expect(other.bonus).toBe(0);
  });

  it('the open week reads live, with chores done of due up to today and none after', () => {
    const today = '2026-11-18'; // Wednesday
    const chores = [chore('c1'), chore('c2', { stars: 2, sortOrder: 1 })];
    const marks = [...ticks(days7(MON).slice(0, 3)), mark(MON, 'c2')];
    const record = choreWeekRecord(chores, indexMarks(marks), 'kid', MON, 1, new Set(['kid']));
    const live = openWeek(record, [gift('2026-11-17', 1)], ON, new Set(), today);
    const b = weekBreakdown(live, [gift('2026-11-17', 1)], record, today);
    expect(b.days.slice(0, 4).map((d) => [d.stars, d.chores])).toEqual([
      [3, { done: 2, due: 2 }],
      [1, { done: 1, due: 2 }],
      [1, { done: 1, due: 2 }],
      [0, null],
    ]);
    expect(b.total).toBe(live.total);
    expect(b.total).toBe(6);
    expect(b.entries).toHaveLength(1);
  });

  it('a week outside mark retention: stars only, no chore counts', () => {
    const old = '2026-10-05';
    const record = choreWeekRecord([chore('c1')], indexMarks([]), 'kid', old, 1, new Set(['kid']));
    const b = weekBreakdown(closedWeek(rec({ weekStart: old })), [], record, MON);
    expect(markCutoffYmd(MON)! > old).toBe(true);
    expect(b.days.every((d) => d.chores === null)).toBe(true);
    expect(b.total).toBe(7);
  });

  it('a closed week whose chores changed since it was frozen: a day that no longer agrees shows its stars alone', () => {
    // Frozen: Mon 1, Tue 2 (two chores ticked), Wed..Sun 0. Since then `c2` was deleted, so
    // the live Tuesday is worth 1 star where the record says 2, and Wednesday now has nothing.
    const frozen = closedWeek(rec({ days: [1, 2, 0, 0, 0, 0, 0], stars: 3, bonus: 0 }));
    const marks = [mark(W0, 'c1'), mark('2026-11-10', 'c1'), mark('2026-11-10', 'c2')];
    const live = choreWeekRecord([chore('c1')], indexMarks(marks), 'kid', W0, 1, new Set(['kid']));
    const b = weekBreakdown(frozen, [], live, MON);
    expect(b.days.slice(0, 3).map((d) => [d.stars, d.chores])).toEqual([
      [1, { done: 1, due: 1 }], // agrees: 1 star from the done chores now, 1 frozen
      [2, null], // 1 star now, 2 frozen: never "1 of 1 chore" beside "2 stars"
      [0, { done: 0, due: 1 }], // agrees (0 and 0)
    ]);
    // A chore moved off a day that the record still has stars for: "Nothing due" never shows
    // beside stars.
    const gone = choreWeekRecord([], indexMarks([]), 'kid', W0, 1, new Set(['kid']));
    const empty = weekBreakdown(
      closedWeek(rec({ days: [3, 0, 0, 0, 0, 0, 0], stars: 3 })),
      [],
      gone,
      MON
    );
    expect(empty.days[0]).toEqual({ ymd: W0, stars: 3, chores: null });
    // The add-up property is untouched.
    expect(b.total).toBe(frozen.total);
    expect(empty.total).toBe(3);
  });
});

describe('weekBonusEntries: the one rule every bonus list reads', () => {
  const giftOn = (id: string, date: string, stars: number): ChoreStarGift => ({
    ...gift(date, stars),
    id,
  });
  it("lists the week's gifts oldest first when they add up to its bonus", () => {
    const gifts = [giftOn('b', '2026-11-12', -1), giftOn('a', '2026-11-10', 3)];
    expect(weekBonusEntries({ weekStart: W0, bonus: 2 }, gifts)?.map((g) => g.id)).toEqual([
      'a',
      'b',
    ]);
  });
  it('a closed week whose frozen bonus never took a late gift in: null, so nothing lists +2 beside a 0', () => {
    expect(
      weekBonusEntries({ weekStart: W0, bonus: 0 }, [giftOn('late', '2026-11-14', 2)])
    ).toBeNull();
  });
  it("no gift in the week and no bonus: an empty list; another week's gift is ignored", () => {
    expect(weekBonusEntries({ weekStart: W0, bonus: 0 }, [giftOn('x', MON, 2)])).toEqual([]);
  });
  it('the breakdown reads the same rule', () => {
    const gifts = [giftOn('late', '2026-11-14', 2)];
    const week = closedWeek({
      ...stored({
        id: choreWeekId('kid', W0),
        memberId: 'kid',
        weekStart: W0,
        done: 0,
        due: 7,
        stars: 0,
        bonus: 0,
        full: 7,
        bar: 7,
        days: [0, 0, 0, 0, 0, 0, 0],
        marks: 0,
      }),
    });
    expect(weekBreakdown(week, gifts, null, MON).entries).toBeNull();
    expect(weekBonusEntries(week, gifts)).toBeNull();
  });
});
