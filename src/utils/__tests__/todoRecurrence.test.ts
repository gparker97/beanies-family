import { describe, it, expect, vi } from 'vitest';
import type { RecurrenceRule, TodoItem, TodoRepeatLogEntry } from '@/types/models';

const { logEventMock } = vi.hoisted(() => ({ logEventMock: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: logEventMock }));

import {
  REPEAT_LOG_KEEP,
  advanceRepeat,
  isCardTodo,
  isRepeating,
  recentOccurrences,
  repeatStartDate,
  rollOverdue,
  seriesStart,
  skipLastOccurrence,
  startRepeat,
  todoCapabilities,
} from '../todoRecurrence';

// Calendar used throughout: 2026-10-07, -14, -21 and -28 are Wednesdays; 2026-10-09 is a Friday.
const WEEKLY_WED: RecurrenceRule = {
  unit: 'week',
  interval: 1,
  weekdays: [3],
  end: { kind: 'never' },
};

function todo(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 't-1',
    title: 'Trash out',
    completed: false,
    createdBy: 'm-1',
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    ...overrides,
  };
}

function repeating(overrides: Partial<TodoItem> = {}, rule = WEEKLY_WED, anchor = '2026-09-02') {
  return todo({ repeat: { rule, anchor }, repeatLog: [], dueDate: '2026-10-14', ...overrides });
}

const entry = (
  date: string,
  outcome: TodoRepeatLogEntry['outcome'] = 'done'
): TodoRepeatLogEntry => ({ date, outcome, by: 'm-1', at: `${date}T20:00:00.000Z` });

describe('isRepeating / isCardTodo', () => {
  it('reads the repeat through resolveTodoRule (a corrupt rule is not repeating)', () => {
    expect(isRepeating(todo())).toBe(false);
    expect(isRepeating(repeating())).toBe(true);
    expect(
      isRepeating(repeating({}, { ...WEEKLY_WED, interval: 0 } as RecurrenceRule, '2026-09-02'))
    ).toBe(false);
    expect(isRepeating(repeating({}, WEEKLY_WED, 'not-a-date'))).toBe(false);
  });

  it('a card to-do is one with a cardId', () => {
    expect(isCardTodo(todo())).toBe(false);
    expect(isCardTodo(todo({ cardId: 'c-1' }))).toBe(true);
  });
});

describe('todoCapabilities', () => {
  it('plain: everything but skip', () => {
    expect(todoCapabilities(todo())).toEqual({
      editTitle: true,
      editAssignee: true,
      editDueDate: true,
      editDueTime: true,
      editRepeat: true,
      someday: true,
      delete: true,
      skip: false,
    });
  });

  it('repeating: due date and someday off, skip on', () => {
    expect(todoCapabilities(repeating())).toEqual({
      editTitle: true,
      editAssignee: true,
      editDueDate: false,
      editDueTime: true,
      editRepeat: true,
      someday: false,
      delete: true,
      skip: true,
    });
  });

  it('card-made: the card owns title, assignee, time, repeat and delete', () => {
    expect(todoCapabilities(repeating({ cardId: 'c-1', cardPartKey: 'main' }))).toEqual({
      editTitle: false,
      editAssignee: false,
      editDueDate: false,
      editDueTime: false,
      editRepeat: false,
      someday: false,
      delete: false,
      skip: true,
    });
  });

  it('completed repeating: no skip', () => {
    expect(todoCapabilities(repeating({ completed: true })).skip).toBe(false);
  });
});

describe('repeatStartDate', () => {
  it('a future due date', () => {
    expect(repeatStartDate({ dueDate: '2026-10-20' }, '2026-10-09')).toBe('2026-10-20');
  });
  it('a past due date starts today', () => {
    expect(repeatStartDate({ dueDate: '2026-10-01' }, '2026-10-09')).toBe('2026-10-09');
  });
  it('no due date starts today', () => {
    expect(repeatStartDate({}, '2026-10-09')).toBe('2026-10-09');
  });
});

describe('startRepeat', () => {
  it('lands on the first occurrence and stores the start date as the anchor', () => {
    // Weekly on Wednesday, started on a Friday.
    expect(startRepeat(WEEKLY_WED, '2026-10-09', '2026-10-09')).toEqual({
      repeat: { rule: WEEKLY_WED, anchor: '2026-10-09' },
      dueDate: '2026-10-14',
      repeatLog: [],
    });
  });

  it('a future anchor: the first occurrence on or after it', () => {
    const started = startRepeat(WEEKLY_WED, '2026-10-20', '2026-10-09');
    expect(started?.repeat.anchor).toBe('2026-10-20');
    expect(started?.dueDate).toBe('2026-10-21');
  });

  it('a past start (a past due date on create): due on or after today, anchor kept', () => {
    const started = startRepeat(WEEKLY_WED, '2026-09-30', '2026-10-09');
    expect(started?.repeat.anchor).toBe('2026-09-30');
    expect(started?.dueDate).toBe('2026-10-14');
  });

  it('keeps an existing log, and seeds [] only when there is none', () => {
    const log = [entry('2026-10-07')];
    expect(startRepeat(WEEKLY_WED, '2026-10-09', '2026-10-09', log)?.repeatLog).toBe(log);
    expect(startRepeat(WEEKLY_WED, '2026-10-09', '2026-10-09')?.repeatLog).toEqual([]);
  });

  it('an unusable rule or start date starts nothing', () => {
    const bad = { ...WEEKLY_WED, unit: 'fortnight' } as unknown as RecurrenceRule;
    expect(startRepeat(bad, '2026-10-09', '2026-10-09')).toBeNull();
    expect(startRepeat(WEEKLY_WED, '2026-02-31', '2026-10-09')).toBeNull();
  });
});

describe('advanceRepeat', () => {
  const NOW = '2026-10-14T20:00:00.000Z';

  it('done: logs the current date and moves to the next occurrence', () => {
    expect(advanceRepeat(repeating(), 'done', 'm-1', NOW, '2026-10-14')).toEqual({
      patch: {
        dueDate: '2026-10-21',
        repeatLog: [{ date: '2026-10-14', outcome: 'done', by: 'm-1', at: NOW }],
      },
      trimmed: 0,
    });
  });

  it('skipped: the same roll with a skipped entry; no `by` when unknown', () => {
    expect(advanceRepeat(repeating(), 'skipped', undefined, NOW, '2026-10-14')).toEqual({
      patch: {
        dueDate: '2026-10-21',
        repeatLog: [{ date: '2026-10-14', outcome: 'skipped', at: NOW }],
      },
      trimmed: 0,
    });
  });

  it(`trims the log to the newest ${REPEAT_LOG_KEEP}`, () => {
    // Twelve earlier Wednesdays, oldest 2026-07-22.
    const dates = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(2026, 6, 22 + i * 7);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    const roll = advanceRepeat(
      repeating({ repeatLog: dates.map((d) => entry(d)) }, WEEKLY_WED, '2026-07-01'),
      'done',
      'm-1',
      NOW,
      '2026-10-14'
    );
    if (!roll || roll === 'series-ended') throw new Error('expected a roll');
    const { patch } = roll;
    expect(roll.trimmed).toBe(1);
    expect(patch.repeatLog).toHaveLength(REPEAT_LOG_KEEP);
    expect(patch.repeatLog?.[0].date).toBe(dates[1]);
    expect(patch.repeatLog?.at(-1)?.date).toBe('2026-10-14');
  });

  it('replaces an entry already on the current date instead of duplicating it', () => {
    const roll = advanceRepeat(
      repeating({ repeatLog: [entry('2026-10-14', 'skipped')] }),
      'done',
      'm-1',
      NOW,
      '2026-10-14'
    );
    if (!roll || roll === 'series-ended') throw new Error('expected a roll');
    expect(roll.patch.repeatLog).toEqual([
      { date: '2026-10-14', outcome: 'done', by: 'm-1', at: NOW },
    ]);
    // A same-date replacement is not a cap trim.
    expect(roll.trimmed).toBe(0);
  });

  it('a missing dueDate: the current occurrence is the first on or after today', () => {
    expect(
      advanceRepeat(repeating({ dueDate: undefined }), 'done', 'm-1', NOW, '2026-10-09')
    ).toMatchObject({ patch: { dueDate: '2026-10-21', repeatLog: [{ date: '2026-10-14' }] } });
  });

  it('the last occurrence of an ending rule ends the series', () => {
    const twice: RecurrenceRule = { ...WEEKLY_WED, end: { kind: 'afterCount', count: 2 } };
    const t = repeating({ dueDate: '2026-10-14' }, twice, '2026-10-07');
    expect(advanceRepeat(t, 'done', 'm-1', NOW, '2026-10-14')).toBe('series-ended');
  });

  it('a to-do that does not repeat: null', () => {
    expect(advanceRepeat(todo({ dueDate: '2026-10-14' }), 'done', 'm-1', NOW, '2026-10-14')).toBe(
      null
    );
  });
});

describe('duplicate log dates (uniqueLog)', () => {
  const NOW = '2026-10-14T20:00:00.000Z';
  const WEEKLY_DATES = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(2026, 6, 22 + i * 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  it('recentOccurrences keeps the FIRST entry for a duplicated date, once', () => {
    // Two devices handled 2026-10-07 offline: the merged list holds both entries.
    const t = repeating({
      repeatLog: [entry('2026-10-07', 'skipped'), entry('2026-10-07', 'done')],
    });
    const recent = recentOccurrences(t, 5).filter((o) => o.date === '2026-10-07');
    expect(recent).toHaveLength(1);
    expect(recent[0]?.outcome).toBe('skipped');
  });

  it('a write collapses duplicates (first wins) before it trims, and counts only the cap trim', () => {
    // Twelve distinct dates plus a duplicate of the newest: 13 entries, 12 dates.
    const log = [...WEEKLY_DATES.map((d) => entry(d)), entry(WEEKLY_DATES[11]!, 'skipped')];
    const roll = advanceRepeat(
      repeating({ repeatLog: log }, WEEKLY_WED, '2026-07-01'),
      'done',
      'm-1',
      NOW,
      '2026-10-14'
    );
    if (!roll || roll === 'series-ended') throw new Error('expected a roll');
    const dates = (roll.patch.repeatLog ?? []).map((e) => e.date);
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates).toHaveLength(REPEAT_LOG_KEEP);
    expect(dates[0]).toBe(WEEKLY_DATES[1]);
    expect(roll.patch.repeatLog?.find((e) => e.date === WEEKLY_DATES[11])?.outcome).toBe('done');
    // 12 distinct + the new entry = 13, so the cap trimmed ONE; the collapsed duplicate is not a trim.
    expect(roll.trimmed).toBe(1);
  });

  it('a short log with a duplicate collapses it and trims nothing', () => {
    const roll = advanceRepeat(
      repeating({ repeatLog: [entry('2026-10-07', 'done'), entry('2026-10-07', 'skipped')] }),
      'done',
      'm-1',
      NOW,
      '2026-10-14'
    );
    if (!roll || roll === 'series-ended') throw new Error('expected a roll');
    expect(roll.patch.repeatLog?.map((e) => [e.date, e.outcome])).toEqual([
      ['2026-10-07', 'done'],
      ['2026-10-14', 'done'],
    ]);
    expect(roll.trimmed).toBe(0);
  });
});

describe('skipLastOccurrence', () => {
  const NOW = '2026-10-14T20:00:00.000Z';
  const twice: RecurrenceRule = { ...WEEKLY_WED, end: { kind: 'afterCount', count: 2 } };

  it('completes with no completedBy and logs the current occurrence as skipped', () => {
    const t = repeating(
      { dueDate: '2026-10-14', repeatLog: [entry('2026-10-07')] },
      twice,
      '2026-10-07'
    );
    const patch = skipLastOccurrence(t, 'm-1', NOW, '2026-10-14');
    expect(patch).toEqual({
      completed: true,
      completedBy: undefined,
      completedAt: NOW,
      repeatLog: [
        entry('2026-10-07'),
        { date: '2026-10-14', outcome: 'skipped', by: 'm-1', at: NOW },
      ],
    });
    // The key is written (as undefined) so a stale "Done by" is cleared, not kept.
    expect(patch).toHaveProperty('completedBy');
  });

  it('with no current occurrence: completes with no completedBy and writes no entry', () => {
    // The rule ended on 2026-10-14; no due date and nothing on or after 2026-10-20.
    const t = repeating(
      { dueDate: undefined, repeatLog: [entry('2026-10-07')] },
      twice,
      '2026-10-07'
    );
    const patch = skipLastOccurrence(t, 'm-1', NOW, '2026-10-20');
    expect(patch).toEqual({ completed: true, completedBy: undefined, completedAt: NOW });
    expect(patch).toHaveProperty('completedBy');
    expect(patch).not.toHaveProperty('repeatLog');
  });
});

describe('rollOverdue', () => {
  it('advances past several ended days in one step', () => {
    expect(rollOverdue(repeating({ dueDate: '2026-10-07' }), '2026-10-30')).toEqual({
      dueDate: '2026-11-04',
    });
  });

  it('is a no-op on the due day and before it', () => {
    expect(rollOverdue(repeating(), '2026-10-14')).toBeNull();
    expect(rollOverdue(repeating(), '2026-10-09')).toBeNull();
  });

  it('re-dates a missing dueDate', () => {
    expect(rollOverdue(repeating({ dueDate: undefined }), '2026-10-09')).toEqual({
      dueDate: '2026-10-14',
    });
  });

  it('re-dates an off-rule dueDate (an old client moved it to a Thursday)', () => {
    expect(rollOverdue(repeating({ dueDate: '2026-10-15' }), '2026-10-09')).toEqual({
      dueDate: '2026-10-14',
    });
  });

  it('advances an already-logged dueDate past every logged occurrence', () => {
    const t = repeating({ repeatLog: [entry('2026-10-14'), entry('2026-10-21', 'skipped')] });
    expect(rollOverdue(t, '2026-10-09')).toEqual({ dueDate: '2026-10-28' });
  });

  it('null for an ended rule (it stays a normal overdue to-do), a completed or a plain to-do', () => {
    const until: RecurrenceRule = { ...WEEKLY_WED, end: { kind: 'onDate', date: '2026-10-10' } };
    expect(rollOverdue(repeating({ dueDate: '2026-10-07' }, until), '2026-10-20')).toBeNull();
    expect(rollOverdue(repeating({ dueDate: '2026-10-07', completed: true }), '2026-10-20')).toBe(
      null
    );
    expect(rollOverdue(todo({ dueDate: '2026-10-07' }), '2026-10-20')).toBeNull();
  });

  it('writes no log entry (a missed occurrence is derived, never stored)', () => {
    const patch = rollOverdue(repeating({ dueDate: '2026-10-07' }), '2026-10-30');
    expect(patch).not.toHaveProperty('repeatLog');
  });
});

describe('seriesStart', () => {
  it('the later of the anchor and the creation day', () => {
    expect(
      seriesStart(repeating({ createdAt: '2026-10-01T12:00:00.000Z' }, WEEKLY_WED, '2026-01-07'))
    ).toBe('2026-10-01');
    expect(seriesStart(repeating({}, WEEKLY_WED, '2026-09-16'))).toBe('2026-09-16');
    expect(seriesStart(todo())).toBeNull();
  });
});

describe('recentOccurrences', () => {
  const kinds = (t: TodoItem, n = REPEAT_LOG_KEEP) =>
    recentOccurrences(t, n).map((o) => [o.date, o.outcome]);

  it('weekly: entries merged with derived misses, newest first, first n', () => {
    const t = repeating({
      repeatLog: [entry('2026-09-16'), entry('2026-09-30', 'skipped')],
    });
    expect(kinds(t, 5)).toEqual([
      ['2026-10-07', 'missed'],
      ['2026-09-30', 'skipped'],
      ['2026-09-23', 'missed'],
      ['2026-09-16', 'done'],
      ['2026-09-09', 'missed'],
    ]);
  });

  it('one chip per date when a merge left two entries for it (first in list order wins)', () => {
    const t = repeating({
      dueDate: '2026-09-23',
      createdAt: '2026-09-09T12:00:00.000Z',
      repeatLog: [entry('2026-09-09'), entry('2026-09-16'), entry('2026-09-16', 'skipped')],
    });
    expect(kinds(t)).toEqual([
      ['2026-09-16', 'done'],
      ['2026-09-09', 'done'],
    ]);
  });

  it('every 2 weeks', () => {
    const biweekly: RecurrenceRule = { ...WEEKLY_WED, interval: 2 };
    expect(kinds(repeating({}, biweekly, '2026-09-02'))).toEqual([
      ['2026-09-30', 'missed'],
      ['2026-09-16', 'missed'],
      ['2026-09-02', 'missed'],
    ]);
  });

  it('monthly by date (the 31st clamps)', () => {
    const monthly: RecurrenceRule = {
      unit: 'month',
      interval: 1,
      monthlyAnchor: 'date',
      monthlyDay: 31,
      end: { kind: 'never' },
    };
    const t = repeating(
      { dueDate: '2026-05-31', createdAt: '2026-01-01T12:00:00.000Z' },
      monthly,
      '2026-01-31'
    );
    expect(kinds(t)).toEqual([
      ['2026-04-30', 'missed'],
      ['2026-03-31', 'missed'],
      ['2026-02-28', 'missed'],
      ['2026-01-31', 'missed'],
    ]);
  });

  it('monthly by weekday (first Sunday)', () => {
    const firstSunday: RecurrenceRule = {
      unit: 'month',
      interval: 1,
      monthlyAnchor: 'weekday',
      end: { kind: 'never' },
    };
    const t = repeating(
      { dueDate: '2027-01-03', createdAt: '2026-10-01T12:00:00.000Z' },
      firstSunday,
      '2026-10-04'
    );
    expect(kinds(t)).toEqual([
      ['2026-12-06', 'missed'],
      ['2026-11-01', 'missed'],
      ['2026-10-04', 'missed'],
    ]);
  });

  it('yearly from Feb 29', () => {
    const yearly: RecurrenceRule = { unit: 'year', interval: 1, end: { kind: 'never' } };
    const t = repeating(
      { dueDate: '2027-02-28', createdAt: '2024-02-01T12:00:00.000Z' },
      yearly,
      '2024-02-29'
    );
    expect(kinds(t)).toEqual([
      ['2026-02-28', 'missed'],
      ['2025-02-28', 'missed'],
      ['2024-02-29', 'missed'],
    ]);
  });

  it('never derives a miss before the series start (old anchor, recent createdAt)', () => {
    const t = repeating({ createdAt: '2026-10-09T12:00:00.000Z' }, WEEKLY_WED, '2026-01-07');
    expect(recentOccurrences(t, 5)).toEqual([]);
  });

  it('an overdue to-do turned repeating today shows no misses', () => {
    const started = startRepeat(
      WEEKLY_WED,
      repeatStartDate({ dueDate: '2026-09-02' }, '2026-10-09'),
      '2026-10-09'
    );
    const t = todo({ ...started!, createdAt: '2026-09-01T12:00:00.000Z' });
    expect(recentOccurrences(t, 5)).toEqual([]);
  });

  it(`clamps n to ${REPEAT_LOG_KEEP}`, () => {
    const t = repeating({ dueDate: '2026-12-30' }, WEEKLY_WED, '2026-01-07');
    expect(recentOccurrences(t, 50)).toHaveLength(REPEAT_LOG_KEEP);
    expect(recentOccurrences(t, 0)).toEqual([]);
  });

  it('a plain to-do has no occurrences', () => {
    expect(recentOccurrences(todo({ dueDate: '2026-10-14' }), 5)).toEqual([]);
  });
});
