/**
 * The choreboard's pure rules (#146, plan Testing Plan item 1 and every §8 mid-day rule).
 */
import { describe, it, expect } from 'vitest';
import type { Chore, ChoreMark } from '@/types/models';
import {
  CHORE_BLOCKS,
  CHORE_MARK_KEEP_DAYS,
  DEFAULT_CHORE_BLOCK_STARTS,
  MAX_MARK_SWEEP_DELETES,
  beanChoreDay,
  blockEnded,
  blockStarts,
  choreBlockOf,
  choreDayOfWeek,
  choreDaysKind,
  choreDupKey,
  choreMarkId,
  choreOccursOn,
  choresFor,
  completesBlock,
  currentBlock,
  expiredMarkIds,
  indexMarks,
  isValidBlockStarts,
  orphanChores,
  sameChoreMoment,
  shiftChoreDay,
  weekCounts,
} from '../chores';

const D = DEFAULT_CHORE_BLOCK_STARTS;

function chore(id: string, over: Partial<Chore> = {}): Chore {
  return {
    id,
    title: id,
    emoji: '🧹',
    assigneeIds: ['kid'],
    block: 'morning',
    sortOrder: 0,
    createdBy: 'mom',
    createdAt: '2026-11-01T08:00:00.000Z',
    updatedAt: '2026-11-01T08:00:00.000Z',
    ...over,
  };
}

function mark(
  kind: ChoreMark['kind'],
  memberId: string,
  date: string,
  ref: string,
  over: Partial<ChoreMark> = {}
): ChoreMark {
  return {
    id: choreMarkId(kind, memberId, date, ref),
    kind,
    memberId,
    date,
    ref,
    by: memberId,
    createdAt: `${date}T08:00:00.000Z`,
    updatedAt: `${date}T08:00:00.000Z`,
    ...over,
  };
}

// 2026-11-13 is a Friday; 2026-11-14 a Saturday; 2026-11-15 a Sunday.
const FRI = '2026-11-13';
const SAT = '2026-11-14';
const SUN = '2026-11-15';

describe('blockStarts', () => {
  it('uses the defaults when nothing is stored', () => {
    expect(blockStarts(undefined)).toEqual(D);
    expect(blockStarts(null)).toEqual(D);
    expect(blockStarts({})).toEqual(D);
  });

  it('uses a valid stored value', () => {
    const s = { morning: '07:00', afternoon: '13:30', evening: '18:00' };
    expect(blockStarts({ choreBlockStarts: s })).toEqual(s);
  });

  it.each([
    ['unordered', { morning: '12:00', afternoon: '07:00', evening: '18:00' }],
    ['equal', { morning: '07:00', afternoon: '07:00', evening: '18:00' }],
    ['malformed hour', { morning: '7:00', afternoon: '12:00', evening: '18:00' }],
    ['out of range', { morning: '06:00', afternoon: '12:00', evening: '24:00' }],
    ['missing key', { morning: '06:00', afternoon: '12:00' }],
    ['not strings', { morning: 6, afternoon: 12, evening: 17 }],
  ])('falls back to the defaults AS A WHOLE when %s', (_label, stored) => {
    expect(blockStarts({ choreBlockStarts: stored as never })).toEqual(D);
    expect(isValidBlockStarts(stored)).toBe(false);
  });

  it('returns a copy, never the frozen defaults', () => {
    const s = blockStarts(null);
    expect(Object.isFrozen(s)).toBe(false);
  });
});

describe('currentBlock and blockEnded', () => {
  it.each([
    ['00:00', 'morning'],
    ['05:59', 'morning'], // before Morning's start: still Morning
    ['06:00', 'morning'],
    ['11:59', 'morning'],
    ['12:00', 'afternoon'],
    ['16:59', 'afternoon'],
    ['17:00', 'evening'],
    ['23:59', 'evening'], // Evening runs to midnight
  ])('at %s the block is %s (default hours)', (hhmm, block) => {
    expect(currentBlock(hhmm, D)).toBe(block);
  });

  it('follows custom hours', () => {
    const s = { morning: '07:00', afternoon: '14:00', evening: '19:30' };
    expect(currentBlock('13:59', s)).toBe('morning');
    expect(currentBlock('14:00', s)).toBe('afternoon');
    expect(currentBlock('19:29', s)).toBe('afternoon');
    expect(currentBlock('19:30', s)).toBe('evening');
  });

  it.each([
    ['morning', '11:59', false],
    ['morning', '12:00', true],
    ['afternoon', '16:59', false],
    ['afternoon', '17:00', true],
    ['evening', '23:59', false],
    ['anytime', '23:59', false],
  ] as const)('%s ended at %s: %s', (block, hhmm, ended) => {
    expect(blockEnded(block, hhmm, D)).toBe(ended);
  });

  it('never answers anytime', () => {
    for (const h of ['00:00', '06:00', '12:00', '17:00', '23:59']) {
      expect(currentBlock(h, D)).not.toBe('anytime');
    }
  });
});

describe('sameChoreMoment', () => {
  it.each([
    ['2026-11-13', '09:00', '2026-11-13', '11:59', true],
    ['2026-11-13', '04:00', '2026-11-13', '09:00', true], // before Morning's start is Morning
    ['2026-11-13', '11:59', '2026-11-13', '12:00', false],
    ['2026-11-13', '16:59', '2026-11-13', '17:00', false],
    ['2026-11-13', '17:00', '2026-11-13', '23:59', true],
    ['2026-11-13', '23:59', '2026-11-14', '23:59', false],
  ])('%s %s vs %s %s → %s', (ya, ha, yb, hb, same) => {
    expect(sameChoreMoment({ ymd: ya, hhmm: ha }, { ymd: yb, hhmm: hb }, D)).toBe(same);
  });

  it('two clocks it calls the same give an identical bean day (the store memoizes on it)', () => {
    const chores = (['morning', 'afternoon', 'evening', 'anytime'] as const).map((block, i) =>
      makeChoreForMoment(`c${i}`, block)
    );
    const index = indexMarks([]);
    for (const [a, b] of [
      ['06:00', '11:59'],
      ['00:30', '06:15'],
      ['12:00', '16:59'],
      ['17:00', '23:59'],
    ] as const) {
      const ca = { ymd: '2026-11-13', hhmm: a };
      const cb = { ymd: '2026-11-13', hhmm: b };
      expect(sameChoreMoment(ca, cb, D)).toBe(true);
      expect(beanChoreDay(chores, index, 'kid', ca, D)).toEqual(
        beanChoreDay(chores, index, 'kid', cb, D)
      );
    }
  });
});

function makeChoreForMoment(id: string, block: Chore['block']): Chore {
  return {
    id,
    title: id,
    emoji: '🧹',
    assigneeIds: ['kid'],
    block,
    sortOrder: 0,
    createdBy: 'mom',
    createdAt: '2026-11-13T00:00:00.000Z',
    updatedAt: '2026-11-13T00:00:00.000Z',
  };
}

describe('weekday and day arithmetic (string-based)', () => {
  it.each([
    [FRI, 5],
    [SAT, 6],
    [SUN, 0],
    ['2024-02-29', 4],
    ['2026-03-08', 0], // a US DST change day
  ])('%s is weekday %i', (ymd, dow) => {
    expect(choreDayOfWeek(ymd)).toBe(dow);
  });

  it('answers -1 for a malformed date', () => {
    expect(choreDayOfWeek('2026-11-1')).toBe(-1);
    expect(choreDayOfWeek('')).toBe(-1);
  });

  it('shifts across month, year and DST boundaries', () => {
    expect(shiftChoreDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftChoreDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftChoreDay('2026-03-07', 2)).toBe('2026-03-09');
    expect(shiftChoreDay(FRI, -35)).toBe('2026-10-09');
  });
});

describe('choreOccursOn', () => {
  it('every day when days is absent or empty', () => {
    expect(choreOccursOn({}, SAT)).toBe(true);
    expect(choreOccursOn({ days: [] }, SUN)).toBe(true);
  });

  it('weekdays only: absent on Saturday and Sunday', () => {
    const weekdays = { days: [1, 2, 3, 4, 5] };
    expect(choreOccursOn(weekdays, FRI)).toBe(true);
    expect(choreOccursOn(weekdays, SAT)).toBe(false);
    expect(choreOccursOn(weekdays, SUN)).toBe(false);
  });

  it('picked days', () => {
    expect(choreOccursOn({ days: [0, 6] }, SUN)).toBe(true);
    expect(choreOccursOn({ days: [0, 6] }, FRI)).toBe(false);
  });
});

describe('choresFor', () => {
  const living = new Set(['kid', 'sib', 'mom']);

  it('groups a bean’s chores due that day by block, in chore order', () => {
    const chores = [
      chore('c2', { sortOrder: 2 }),
      chore('c1', { sortOrder: 1 }),
      chore('e1', { block: 'evening' }),
      chore('w1', { days: [1, 2, 3, 4, 5] }),
      chore('other', { assigneeIds: ['sib'] }),
    ];
    const sat = choresFor(chores, 'kid', SAT, living);
    expect(sat.get('morning')?.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(sat.get('evening')?.map((c) => c.id)).toEqual(['e1']);
    expect(
      choresFor(chores, 'kid', FRI, living)
        .get('morning')
        ?.map((c) => c.id)
    ).toEqual(['w1', 'c1', 'c2']);
  });

  it('a removed member has no chores; an unknown block reads as anytime', () => {
    const chores = [chore('c1'), chore('odd', { block: 'night' as never })];
    expect(choresFor(chores, 'gone', FRI, living).size).toBe(0);
    expect(
      choresFor(chores, 'kid', FRI, living)
        .get('anytime')
        ?.map((c) => c.id)
    ).toEqual(['odd']);
    expect(choreBlockOf({ block: 'night' as never })).toBe('anytime');
  });

  it('orphans are chores with no living assignee', () => {
    const chores = [chore('ok'), chore('orphan', { assigneeIds: ['gone'] })];
    expect(orphanChores(chores, living).map((c) => c.id)).toEqual(['orphan']);
  });
});

describe('choreMarkId and indexMarks', () => {
  it('builds the deterministic id', () => {
    expect(choreMarkId('done', 'kid', FRI, 'c1')).toBe('done:kid:2026-11-13:c1');
    expect(choreMarkId('celebrated', 'kid', FRI, 'morning')).toBe(
      'celebrated:kid:2026-11-13:morning'
    );
  });

  it('indexes by member and date, and ignores an unknown kind', () => {
    const index = indexMarks([
      mark('done', 'kid', FRI, 'c1'),
      mark('done', 'kid', FRI, 'c2'),
      mark('celebrated', 'kid', FRI, 'morning'),
      mark('done', 'kid', SAT, 'c1'),
      mark('done', 'sib', FRI, 'c1'),
      { ...mark('done', 'kid', FRI, 'c3'), kind: 'starred' as never },
    ]);
    const fri = index.get('kid')?.get(FRI);
    expect([...(fri?.done ?? [])].sort()).toEqual(['c1', 'c2']);
    expect([...(fri?.celebrated ?? [])]).toEqual(['morning']);
    expect(index.get('kid')?.get(SAT)?.done.size).toBe(1);
    expect(index.get('sib')?.get(FRI)?.done.has('c1')).toBe(true);
  });
});

describe('beanChoreDay', () => {
  const living = new Set(['kid', 'sib']);
  const at = (hhmm: string, ymd = FRI) => ({ ymd, hhmm });
  const block = (day: ReturnType<typeof beanChoreDay>, b: string) =>
    day.blocks.find((x) => x.block === b)!;

  it('lists all four blocks in order, with counts, isNow and ended', () => {
    const chores = [chore('m1'), chore('m2'), chore('e1', { block: 'evening' })];
    const index = indexMarks([mark('done', 'kid', FRI, 'm1')]);
    const day = beanChoreDay(chores, index, 'kid', at('13:00'), D, living);
    expect(day.blocks.map((b) => b.block)).toEqual([...CHORE_BLOCKS]);
    const m = block(day, 'morning');
    expect([m.done, m.total, m.allDone, m.isNow, m.ended]).toEqual([1, 2, false, false, true]);
    expect(m.chores.map((i) => [i.chore.id, i.done])).toEqual([
      ['m1', true],
      ['m2', false],
    ]);
    expect(block(day, 'afternoon').isNow).toBe(true);
    expect(block(day, 'evening')).toMatchObject({ done: 0, total: 1, isNow: false, ended: false });
    expect(block(day, 'anytime')).toMatchObject({ total: 0, allDone: false, isNow: false });
    expect(day.left).toBe(2);
  });

  it('before Morning starts, Morning is now', () => {
    const day = beanChoreDay([chore('m1')], indexMarks([]), 'kid', at('05:00'), D, living);
    expect(block(day, 'morning').isNow).toBe(true);
    expect(block(day, 'morning').ended).toBe(false);
  });

  it('allDone is false for a block with no chores', () => {
    const day = beanChoreDay([], indexMarks([]), 'kid', at('09:00'), D, living);
    expect(day.blocks.every((b) => !b.allDone)).toBe(true);
    expect(day.left).toBe(0);
  });

  it('done counts CURRENT chores with a mark, never marks (deleted, moved, re-assigned, re-dayed)', () => {
    const marks = [
      mark('done', 'kid', FRI, 'm1'),
      mark('done', 'kid', FRI, 'deleted'), // chore since deleted
      mark('done', 'kid', FRI, 'moved'), // chore since moved to evening
      mark('done', 'kid', FRI, 'reassigned'), // chore since given to a sibling
      mark('done', 'kid', FRI, 'weekend'), // chore since moved to weekends
    ];
    const chores = [
      chore('m1'),
      chore('m2'),
      chore('moved', { block: 'evening' }),
      chore('reassigned', { assigneeIds: ['sib'] }),
      chore('weekend', { days: [0, 6] }),
    ];
    const day = beanChoreDay(chores, indexMarks(marks), 'kid', at('09:00'), D, living);
    const m = block(day, 'morning');
    expect([m.done, m.total, m.allDone]).toEqual([1, 2, false]);
    // The moved chore keeps its tick in its new block and cannot push done above total.
    expect(block(day, 'evening')).toMatchObject({ done: 1, total: 1, allDone: true });
    for (const b of day.blocks) expect(b.done).toBeLessThanOrEqual(b.total);
  });

  it('a block completed by a delete is allDone but not celebrated (the store writes nothing)', () => {
    const marks = [mark('done', 'kid', FRI, 'm1')];
    // m2 (undone) was deleted: m1 alone is now the whole block.
    const day = beanChoreDay([chore('m1')], indexMarks(marks), 'kid', at('09:00'), D, living);
    expect(block(day, 'morning')).toMatchObject({ allDone: true, celebrated: false });
  });

  it('a chore added to a celebrated block re-opens it; finishing again stays celebrated', () => {
    const marks = [mark('done', 'kid', FRI, 'm1'), mark('celebrated', 'kid', FRI, 'morning')];
    const day = beanChoreDay(
      [chore('m1'), chore('new', { sortOrder: 1 })],
      indexMarks(marks),
      'kid',
      at('09:00'),
      D,
      living
    );
    expect(block(day, 'morning')).toMatchObject({ allDone: false, celebrated: true });
    expect(completesBlock(day, 'new')).toBe('morning');
  });

  it('changing the hours changes only isNow and ended', () => {
    const chores = [chore('m1'), chore('a1', { block: 'afternoon' })];
    const index = indexMarks([mark('done', 'kid', FRI, 'm1')]);
    const a = beanChoreDay(chores, index, 'kid', at('12:30'), D, living);
    const late = { morning: '08:00', afternoon: '13:00', evening: '18:00' };
    const b = beanChoreDay(chores, index, 'kid', at('12:30'), late, living);
    const strip = (d: typeof a) => d.blocks.map(({ isNow: _n, ended: _e, ...rest }) => rest);
    expect(strip(a)).toEqual(strip(b));
    expect(block(a, 'morning')).toMatchObject({ isNow: false, ended: true });
    expect(block(b, 'morning')).toMatchObject({ isNow: true, ended: false });
  });

  it('a shared chore is ticked per bean', () => {
    const shared = chore('s1', { assigneeIds: ['kid', 'sib'] });
    const index = indexMarks([mark('done', 'kid', FRI, 's1')]);
    expect(
      block(beanChoreDay([shared], index, 'kid', at('09:00'), D, living), 'morning').done
    ).toBe(1);
    expect(
      block(beanChoreDay([shared], index, 'sib', at('09:00'), D, living), 'morning').done
    ).toBe(0);
  });

  it('reads only the clock day: yesterday’s ticks do not count', () => {
    const index = indexMarks([mark('done', 'kid', '2026-11-12', 'm1')]);
    expect(
      block(beanChoreDay([chore('m1')], index, 'kid', at('09:00'), D, living), 'morning').done
    ).toBe(0);
  });
});

describe('completesBlock', () => {
  const living = new Set(['kid']);
  const clock = { ymd: FRI, hhmm: '09:00' };

  it('true only for the last undone chore of its block', () => {
    const chores = [chore('m1'), chore('m2', { sortOrder: 1 })];
    const none = beanChoreDay(chores, indexMarks([]), 'kid', clock, D, living);
    expect(completesBlock(none, 'm1')).toBeNull();
    const one = beanChoreDay(
      chores,
      indexMarks([mark('done', 'kid', FRI, 'm1')]),
      'kid',
      clock,
      D,
      living
    );
    expect(completesBlock(one, 'm2')).toBe('morning');
    expect(completesBlock(one, 'm1')).toBeNull(); // already done (an untick)
  });

  it('null for a chore not in the bean’s day', () => {
    const day = beanChoreDay([chore('m1')], indexMarks([]), 'kid', clock, D, living);
    expect(completesBlock(day, 'nope')).toBeNull();
  });

  it('a single-chore block completes on its one tick', () => {
    const day = beanChoreDay(
      [chore('a1', { block: 'anytime' })],
      indexMarks([]),
      'kid',
      clock,
      D,
      living
    );
    expect(completesBlock(day, 'a1')).toBe('anytime');
  });
});

describe('weekCounts', () => {
  const index = indexMarks([
    mark('done', 'kid', '2026-11-09', 'c1'), // Monday
    mark('done', 'kid', '2026-11-09', 'c2'),
    mark('done', 'kid', FRI, 'deleted-chore'), // still counts
    mark('celebrated', 'kid', FRI, 'morning'), // not a chore
    mark('done', 'kid', '2026-11-08', 'c1'), // the Sunday before (previous Monday week)
    mark('done', 'sib', FRI, 'c1'),
  ]);

  it('seven counts from a Monday start, and a total', () => {
    const w = weekCounts(index, 'kid', FRI, 1);
    expect(w.days.map((d) => d.ymd)).toEqual([
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
    ]);
    expect(w.days.map((d) => d.count)).toEqual([2, 0, 0, 0, 1, 0, 0]);
    expect(w.total).toBe(3);
  });

  it('a Sunday start includes that Sunday', () => {
    const w = weekCounts(index, 'kid', FRI, 0);
    expect(w.days[0]).toEqual({ ymd: '2026-11-08', count: 1 });
    expect(w.total).toBe(4);
  });

  it('empty for a malformed date', () => {
    expect(weekCounts(index, 'kid', 'garbage')).toEqual({ days: [], total: 0 });
  });
});

describe('expiredMarkIds', () => {
  const today = FRI;
  const old = shiftChoreDay(today, -(CHORE_MARK_KEEP_DAYS + 1));
  const edge = shiftChoreDay(today, -CHORE_MARK_KEEP_DAYS);

  it('removes marks older than the keep window, oldest first', () => {
    const marks = [
      mark('done', 'kid', old, 'c2'),
      mark('done', 'kid', shiftChoreDay(old, -3), 'c1'),
      mark('done', 'kid', edge, 'c1'), // exactly the cutoff: kept
      mark('done', 'kid', today, 'c1'),
    ];
    expect(expiredMarkIds(marks, today)).toEqual([
      choreMarkId('done', 'kid', shiftChoreDay(old, -3), 'c1'),
      choreMarkId('done', 'kid', old, 'c2'),
    ]);
  });

  it('KEEPS on doubt: a malformed date, a malformed createdAt, a future date', () => {
    const marks = [
      mark('done', 'kid', 'not-a-date', 'c1', { createdAt: `${old}T00:00:00.000Z` }),
      mark('done', 'kid', old, 'c2', { createdAt: '' }),
      mark('done', 'kid', old, 'c3', { createdAt: `${today}T08:00:00.000Z` }),
      mark('done', 'kid', '2027-01-01', 'c4'),
    ];
    expect(expiredMarkIds(marks, today)).toEqual([]);
  });

  it('caps a run', () => {
    const marks = Array.from({ length: 12 }, (_, i) => mark('done', 'kid', old, `c${i}`));
    expect(expiredMarkIds(marks, today, CHORE_MARK_KEEP_DAYS, 5)).toHaveLength(5);
    expect(MAX_MARK_SWEEP_DELETES).toBeGreaterThan(0);
  });

  it('a malformed today deletes nothing', () => {
    expect(expiredMarkIds([mark('done', 'kid', old, 'c1')], 'today')).toEqual([]);
  });
});

describe('choreDaysKind (the form shortcuts and the sheet tag)', () => {
  it.each([
    [undefined, 'every'],
    [[], 'every'],
    [[0, 1, 2, 3, 4, 5, 6], 'every'],
    [[5, 4, 3, 2, 1], 'school'],
    [[6, 0], 'weekends'],
    [[1, 3], 'some'],
    [[1, 1, 2, 3, 4, 5], 'school'], // a duplicate weekday is still the same set
  ] as const)('%j -> %s', (days, kind) => {
    expect(choreDaysKind(days as readonly number[] | undefined)).toBe(kind);
  });
});

describe('choreDupKey (the one duplicate rule)', () => {
  it('same title any case and spacing, same block', () => {
    expect(choreDupKey(' Make Bed ', 'morning')).toBe(choreDupKey('make bed', 'morning'));
    expect(choreDupKey('Make bed', 'morning')).not.toBe(choreDupKey('Make bed', 'evening'));
    expect(choreDupKey('Make bed', 'morning')).not.toBe(choreDupKey('Make beds', 'morning'));
  });
});

describe('a mark for a chore that no longer exists', () => {
  it('is ignored by the day and does not break the week', () => {
    const marks = [mark('done', 'kid', '2026-11-13', 'deleted-chore')];
    const index = indexMarks(marks);
    const day = beanChoreDay(
      [chore('c1', { assigneeIds: ['kid'] })],
      index,
      'kid',
      { ymd: '2026-11-13', hhmm: '07:42' },
      D,
      new Set(['kid'])
    );
    expect(day.blocks.flatMap((b) => b.chores.map((i) => i.chore.id))).toEqual(['c1']);
    expect(day.left).toBe(1);
    expect(() => weekCounts(index, 'kid', '2026-11-13', 1)).not.toThrow();
  });
});
