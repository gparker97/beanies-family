/**
 * Stars and rewards (#148), step 2: the rest of the pure rules (plan Testing Plan item 1): the
 * bar, the look-back, gifts, the arc, the strip and the award rules exactly as Approach 2 writes
 * them. `planWeekClose` and the week shapes are in `choreStars.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import type { ChoreAward } from '@/types/models';
import {
  MAX_PATH_STEPS,
  arcFor,
  awardIsFor,
  awardKids,
  awardPriceStars,
  cleanAwardKids,
  awardProgress,
  awardProgressLabel,
  fairPrice,
  giftRefusal,
  isValidBar,
  isValidPrice,
  lookbackWeeks,
  nearestSavedAward,
  parsePrice,
  pathSteps,
  weeklyAchieved,
  weeksEstimate,
  type WeekStars,
} from '../choreStars';
import { shiftChoreDay } from '../chores';

const MON = '2026-11-16';
const W0 = '2026-11-09';
const W1 = '2026-11-02';
const W2 = '2026-10-26';

/** A week in stars with every field set; `days` default to the stars on the first day. */
function week(weekStart: string, over: Partial<WeekStars> = {}): WeekStars {
  const stars = over.stars ?? 0;
  const bonus = over.bonus ?? 0;
  return {
    weekStart,
    stars,
    bonus,
    total: Math.max(0, stars + bonus),
    full: 10,
    bar: 10,
    days: [stars, 0, 0, 0, 0, 0, 0],
    done: 0,
    due: 0,
    openToday: 0,
    ahead: 0,
    ...over,
  };
}
/** A week whose stars come one a day from Monday. */
function daily(weekStart: string, n: number, over: Partial<WeekStars> = {}): WeekStars {
  const days = Array.from({ length: 7 }, (_, i) => (i < n ? 1 : 0));
  return week(weekStart, { stars: n, days, full: 7, bar: 7, ...over });
}

function award(over: Partial<ChoreAward> = {}): ChoreAward {
  return {
    id: 'a',
    title: 'Disneyland',
    emoji: '🏰',
    kind: 'saved',
    unit: 'stars',
    price: 10,
    weekStart: W2,
    createdBy: 'mom',
    createdAt: 'x',
    updatedAt: 'x',
    ...over,
  };
}

describe('the bar', () => {
  it('weeklyAchieved needs a bar and a total at or above it', () => {
    expect(weeklyAchieved({ bar: 0, total: 5 })).toBe(false);
    expect(weeklyAchieved({ bar: 7, total: 6 })).toBe(false);
    expect(weeklyAchieved({ bar: 7, total: 7 })).toBe(true);
  });

  it('isValidBar: 50 to 100 in steps of 5', () => {
    for (const v of [50, 55, 80, 100]) expect(isValidBar(v)).toBe(true);
    for (const v of [45, 47, 105, 0, Number.NaN, '80']) expect(isValidBar(v)).toBe(false);
  });
});

describe('lookbackWeeks', () => {
  it('this week and four back on the current week start; never a fifth', () => {
    expect(lookbackWeeks(MON, 1, [])).toEqual([MON, W0, W1, W2, '2026-10-19']);
    expect(lookbackWeeks('2026-11-21', 0, [])).toEqual([
      '2026-11-15',
      '2026-11-08',
      '2026-11-01',
      '2026-10-25',
      '2026-10-18',
    ]);
    expect(lookbackWeeks(MON, 1, [], 2)).toHaveLength(3);
  });

  it('a record for a week not yet ended is ignored', () => {
    // A fast clock froze this Sunday-start week early; on this clock it has not ended.
    expect(lookbackWeeks(MON, 1, ['2026-11-15'])).toEqual([MON, W0, W1, W2, '2026-10-19']);
  });

  it('a frozen week from before a week-start change keeps its own days', () => {
    expect(lookbackWeeks(MON, 1, ['2026-11-08', '2026-11-01'])).toEqual([
      MON,
      W0,
      '2026-11-08',
      '2026-11-01',
      W2,
    ]);
  });

  it('a bad clock offers nothing', () => {
    expect(lookbackWeeks('soon', 1, [])).toEqual([]);
  });
});

describe('giftRefusal', () => {
  const on = { on: true };
  it.each([
    ['a bonus with no note', { kind: 'bonus', count: 2 }, on, 5, null],
    ['a take-back with a reason', { kind: 'take', count: 2, note: 'x' }, on, 5, null],
    ['the whole week back', { kind: 'take', count: 5, note: 'x' }, on, 5, null],
    ['off', { kind: 'bonus', count: 1 }, { on: false }, 5, 'off'],
    ['a take-back with no reason', { kind: 'take', count: 1, note: '   ' }, on, 5, 'note-required'],
    ['more than the week', { kind: 'take', count: 6, note: 'x' }, on, 5, 'over-week'],
    ['no week at all', { kind: 'take', count: 1, note: 'x' }, on, null, 'over-week'],
    ['zero', { kind: 'bonus', count: 0 }, on, 5, 'invalid'],
    ['a fraction', { kind: 'bonus', count: 1.5 }, on, 5, 'invalid'],
    ['too many', { kind: 'bonus', count: 21 }, on, 5, 'invalid'],
    ['a note over 80', { kind: 'bonus', count: 1, note: 'x'.repeat(81) }, on, 5, 'invalid'],
    ['an unknown kind', { kind: 'steal', count: 1 }, on, 5, 'invalid'],
  ] as const)('%s', (_n, input, rewards, total, want) => {
    expect(giftRefusal(input as never, total === null ? null : { total }, rewards)).toBe(want);
  });
});

describe('arcFor', () => {
  const weekly = { weeklyOn: true, emoji: '🍦' };
  it('with a weekly reward: toward the bar, the badge once achieved', () => {
    expect(arcFor(week(MON, { stars: 4 }), weekly)).toEqual({
      percent: 40,
      count: 4,
      kind: 'week',
    });
    expect(arcFor(week(MON, { stars: 12 }), weekly)).toEqual({
      percent: 100,
      count: 12,
      kind: 'week',
      badgeEmoji: '🍦',
    });
    expect(arcFor(week(MON, { stars: 10 }), { weeklyOn: true })).toMatchObject({
      badgeEmoji: '⭐',
    });
  });

  it('with none: toward the nearest saved-up award, its real stars as the count', () => {
    expect(
      arcFor(week(MON, { stars: 4 }), { weeklyOn: false }, { fraction: 0.64, stars: 64 })
    ).toEqual({ percent: 64, count: 64, kind: 'saved' });
  });

  it('with neither, or a weekly reward with nothing due and no saved award: null', () => {
    expect(arcFor(week(MON), { weeklyOn: false })).toBeNull();
    expect(arcFor(week(MON, { bar: 0, full: 0 }), weekly)).toBeNull();
    expect(arcFor(null, weekly)).toBeNull();
  });
});

describe('pathSteps', () => {
  it('under 20: one star a step, the notch at the bar, the next steps from today', () => {
    const p = pathSteps(week(MON, { stars: 4, full: 10, bar: 8, openToday: 2, ahead: 4 }));
    expect(p).toMatchObject({
      stepSize: 1,
      steps: 10,
      earned: 4,
      next: 2,
      thinFrom: 10,
      barAt: 7,
      awardAt: null,
      toBar: 4,
      reached: false,
    });
  });

  it('exactly 20 is still one a step; 40 is two a step (the caption), at most 20 steps', () => {
    expect(pathSteps(week(MON, { full: 20, bar: 20 }))).toMatchObject({ stepSize: 1, steps: 20 });
    const p = pathSteps(week(MON, { stars: 5, full: 40, bar: 32 }));
    expect(p).toMatchObject({ stepSize: 2, steps: MAX_PATH_STEPS, barAt: 15 });
    // A step lights only when full: 5 stars at 2 a step is two lit steps.
    expect(p.earned).toBe(2);
    expect(pathSteps(week(MON, { full: 333, bar: 300 })).steps).toBeLessThanOrEqual(20);
  });

  it('bonus stars past a full week are thin steps; a This Week award past it sets the length', () => {
    const bonus = pathSteps(week(MON, { stars: 10, bonus: 3, full: 10, bar: 10 }));
    expect(bonus).toMatchObject({ steps: 13, earned: 13, thinFrom: 10, reached: true, toBar: 0 });
    const movie = pathSteps(week(MON, { stars: 2, full: 10, bar: 8 }), {
      unit: 'stars',
      price: 14,
    });
    expect(movie).toMatchObject({ steps: 14, thinFrom: 10, awardAt: 13 });
    const weeks = pathSteps(week(MON, { full: 10 }), { unit: 'weeks', price: 1.5 });
    expect(weeks.awardAt).toBe(14);
  });

  it('keeps the stars still needed when the rest of the week cannot get there', () => {
    // The chores left add up to 7 of the 8 still needed; a bonus star can close the gap.
    expect(pathSteps(week(MON, { stars: 2, bar: 10, openToday: 1, ahead: 6 }))).toMatchObject({
      toBar: 8,
      reached: false,
      barAt: 9,
    });
    expect(pathSteps(week(MON, { stars: 0, bar: 0, full: 0 }))).toMatchObject({
      steps: 0,
      toBar: 0,
      barAt: null,
    });
  });
});

describe('awards: the rules as written', () => {
  it('a stars award counts the sum of total; a week with no record adds nothing', () => {
    const p = awardProgress(award({ price: 20 }), [
      week(W2, { stars: 6 }),
      week(MON, { stars: 3 }), // W1 and W0 have no record
    ]);
    expect(p).toMatchObject({ have: 9, need: 20, cycles: 0, stars: 9 });
    expect(p.fraction).toBeCloseTo(0.45);
    expect(p.achievedOn).toBeUndefined();
  });

  it('a full-weeks award adds total / full; nothing due adds nothing; bonus can pass 1', () => {
    const p = awardProgress(award({ unit: 'weeks', price: 3 }), [
      week(W2, { stars: 5, full: 10 }), // 0.5
      week(W1, { stars: 0, full: 0, bar: 0 }), // nothing due: 0
      week(W0, { stars: 10, bonus: 4, full: 10 }), // 1.4
    ]);
    expect(p.have).toBeCloseTo(1.9);
    expect(p.stars).toBe(19);
    expect(p.fraction).toBeCloseTo(1.9 / 3);
  });

  it('a full-weeks award keeps each week’s own full: a later chore change changes nothing', () => {
    const before = awardProgress(award({ unit: 'weeks', price: 4 }), [
      week(W2, { stars: 10, full: 10 }),
    ]);
    const after = awardProgress(award({ unit: 'weeks', price: 4 }), [
      week(W2, { stars: 10, full: 10 }),
      week(MON, { stars: 2, full: 20 }),
    ]);
    expect(before.have).toBe(1);
    expect(after.have).toBeCloseTo(1.1);
  });

  it('Saved Up counts from the award’s week on; This Week counts only the newest week', () => {
    const weeks = [week(W2, { stars: 4 }), week(W1, { stars: 4 }), week(MON, { stars: 2 })];
    expect(awardProgress(award({ weekStart: W1, price: 50 }), weeks).have).toBe(6);
    expect(awardProgress(award({ kind: 'week', price: 50 }), weeks).have).toBe(2);
    expect(awardProgress(award({ kind: 'week', price: 50, weekStart: MON }), [])).toMatchObject({
      have: 0,
      fraction: 0,
    });
  });

  it('One Time: the first week reaching the price is achieved; later weeks are not looked at', () => {
    const p = awardProgress(award({ price: 6 }), [
      daily(W2, 4),
      daily(W1, 5), // reaches 6 on its second day (4 + 1 + 1)
      daily(W0, 7),
    ]);
    expect(p).toMatchObject({ have: 9, need: 6, fraction: 1, cycles: 1, stars: 9 });
    expect(p.achievedOn).toBe(shiftChoreDay(W1, 1));
  });

  it('Repeats: the count starts again the week after each achieved week', () => {
    const a = award({ price: 6, repeats: true });
    const achievedThisWeek = awardProgress(a, [daily(W2, 4), daily(W1, 5)]);
    expect(achievedThisWeek).toMatchObject({ cycles: 1, fraction: 1 });
    expect(achievedThisWeek.achievedOn).toBe(shiftChoreDay(W1, 1));
    const nextWeek = awardProgress(a, [daily(W2, 4), daily(W1, 5), daily(W0, 2)]);
    expect(nextWeek).toMatchObject({ cycles: 1, have: 2, stars: 2 });
    expect(nextWeek.achievedOn).toBeUndefined();
    const twice = awardProgress(a, [daily(W2, 6), daily(W1, 2), daily(W0, 4)]);
    expect(twice).toMatchObject({ cycles: 2, have: 6 });
    expect(twice.achievedOn).toBe(shiftChoreDay(W0, 3));
  });

  it('Repeats on a This Week award is ignored (it starts again every week anyway)', () => {
    const p = awardProgress(award({ kind: 'week', price: 3, repeats: true }), [daily(MON, 4)]);
    expect(p).toMatchObject({ cycles: 1, achievedOn: shiftChoreDay(MON, 2) });
  });

  it('the achieved day counts the week’s bonus from its first day (exact for chores)', () => {
    const p = awardProgress(award({ price: 5 }), [daily(MON, 3, { bonus: 2, total: 5 })]);
    expect(p.achievedOn).toBe(shiftChoreDay(MON, 2)); // 1 + 2 bonus on Monday, then 1, 1
    const fromBonus = awardProgress(award({ price: 3 }), [daily(MON, 1, { bonus: 2, total: 3 })]);
    expect(fromBonus.achievedOn).toBe(MON);
  });

  it('"as of" an earlier week is the same call with the later weeks left out', () => {
    const all = [daily(W2, 4), daily(W1, 4), daily(MON, 4)];
    expect(awardProgress(award({ price: 20 }), all.slice(0, 2)).have).toBe(8);
  });

  it('a week below zero (a take-back) adds nothing, never less', () => {
    const p = awardProgress(award({ price: 20 }), [
      week(W2, { stars: 4 }),
      week(W1, { stars: 1, bonus: -3 }),
    ]);
    expect(p.have).toBe(4);
  });

  it('awardPriceStars: a stars price as is; full weeks times the child’s full week, rounded up', () => {
    expect(awardPriceStars({ unit: 'stars', price: 30 }, 12)).toBe(30);
    expect(awardPriceStars({ unit: 'weeks', price: 4 }, 40)).toBe(160);
    expect(awardPriceStars({ unit: 'weeks', price: 1.5 }, 7)).toBe(11);
    expect(awardPriceStars({ unit: 'weeks', price: 2 }, 0)).toBe(0);
  });

  it('awardProgressLabel: always in stars; a full-weeks award at the current full week', () => {
    const t = (k: string) =>
      k.endsWith('.one') ? '{have} of {need} star' : '{have} of {need} stars';
    const weeks = award({ unit: 'weeks', price: 4 });
    expect(awardProgressLabel(weeks, { have: 1.6, need: 4 }, 40, t as never)).toBe(
      '64 of 160 stars'
    );
    expect(awardProgressLabel(award(), { have: 7, need: 10 }, 99, t as never)).toBe(
      '7 of 10 stars'
    );
    expect(awardProgressLabel(award({ price: 1 }), { have: 3, need: 1 }, 5, t as never)).toBe(
      '1 of 1 star'
    );
  });

  it('nearestSavedAward: the highest fraction not achieved; This Week awards never count', () => {
    const a = award({ id: 'a' });
    const b = award({ id: 'b' });
    const w = award({ id: 'w', kind: 'week' });
    const progress = new Map([
      ['a', { fraction: 0.5 }],
      ['b', { fraction: 0.9, achievedOn: MON }],
      ['w', { fraction: 0.99 }],
    ]);
    expect(nearestSavedAward([a, b, w], progress)?.id).toBe('a');
    expect(nearestSavedAward([b, w], progress)).toBeNull();
  });
});

describe('pricing', () => {
  it('fairPrice: an uneven stars price names the slowest and suggests full weeks', () => {
    const f = fairPrice({ unit: 'stars', price: 120 }, { max: 40, joey: 30, neil: 20 });
    expect(f).toEqual({
      uneven: true,
      slowest: 'neil',
      fastest: 'max',
      ratio: 2,
      suggestedWeeks: 4,
    });
    expect(fairPrice({ unit: 'stars', price: 30 }, { a: 10, b: 12 }).uneven).toBe(false);
    expect(fairPrice({ unit: 'weeks', price: 3 }, { a: 10, b: 40 })).toEqual({
      uneven: false,
      ratio: 1,
      suggestedWeeks: 3,
    });
    expect(fairPrice({ unit: 'stars', price: 30 }, { a: 0 })).toMatchObject({ uneven: false });
  });

  it('weeksEstimate: full weeks at the bar, rounded up', () => {
    expect(weeksEstimate(4, 100)).toBe(4);
    expect(weeksEstimate(4, 80)).toBe(5);
    expect(weeksEstimate(1.5, 50)).toBe(3);
    expect(weeksEstimate(0, 80)).toBe(0);
  });

  it.each([
    ['1.5', 'weeks', 1.5],
    ['4', 'weeks', 4],
    ['1.25', 'weeks', 'invalid'],
    ['0', 'weeks', 'invalid'],
    ['53', 'weeks', 'too-big'],
    ['30', 'stars', 30],
    ['2.5', 'stars', 'invalid'],
    ['abc', 'stars', 'invalid'],
    ['1000', 'stars', 'too-big'],
    ['  ', 'stars', 'empty'],
  ] as const)('parsePrice(%s, %s) = %s', (text, unit, want) => {
    expect(parsePrice(text, unit)).toBe(want);
  });

  it('isValidPrice agrees with parsePrice', () => {
    expect(isValidPrice(1.5, 'weeks')).toBe(true);
    expect(isValidPrice(1.25, 'weeks')).toBe(false);
    expect(isValidPrice(30, 'stars')).toBe(true);
    expect(isValidPrice(2.5, 'stars')).toBe(false);
    expect(isValidPrice(0, 'stars')).toBe(false);
    expect(isValidPrice('3', 'stars')).toBe(false);
  });
});

describe('who a special reward is for', () => {
  const EARNERS = ['max', 'pip', 'juno'];

  it.each([
    ['absent: every kid', undefined, ['max', 'pip', 'juno']],
    ['empty: every kid', [], ['max', 'pip', 'juno']],
    ['one kid', ['pip'], ['pip']],
    ['two of three', ['juno', 'max'], ['max', 'juno']],
    ['a member who left is ignored', ['pip', 'gone'], ['pip']],
    ['only members who left: nobody now', ['gone'], []],
    ['malformed reads as every kid', 'pip' as never, ['max', 'pip', 'juno']],
  ])('awardIsFor: %s', (_n, memberIds, want) => {
    const award = { memberIds } as Pick<ChoreAward, 'memberIds'>;
    expect(EARNERS.filter((id) => awardIsFor(award, id))).toEqual(want);
  });

  it('awardKids: null for every kid, else the earners it is for in family order', () => {
    expect(awardKids({}, EARNERS)).toBeNull();
    expect(awardKids({ memberIds: [] }, EARNERS)).toBeNull();
    expect(awardKids({ memberIds: ['juno', 'max'] }, EARNERS)).toEqual(['max', 'juno']);
    expect(awardKids({ memberIds: ['gone'] }, EARNERS)).toEqual([]);
  });

  it.each([
    ['nothing sent: every kid', undefined, undefined],
    ['every kid chosen: stored as every kid', ['juno', 'pip', 'max'], undefined],
    ['some kids: in family order, deduped', ['juno', 'max', 'juno'], ['max', 'juno']],
    ['a non-kid is dropped', ['pip', 'mom'], ['pip']],
    ['only non-kids: refused', ['mom'], null],
    ['empty list: refused', [], null],
    ['not a list: refused', 'pip', null],
  ])('cleanAwardKids: %s', (_n, sent, want) => {
    expect(cleanAwardKids(sent, EARNERS)).toEqual(want);
  });
});
