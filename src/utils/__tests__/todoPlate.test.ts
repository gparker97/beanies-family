import { describe, it, expect } from 'vitest';
import type { RecurrenceRule, TodoItem } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { UI_STRINGS } from '@/services/translation/uiStrings';
import {
  SHOW_LEAD_DEFAULT,
  SHOW_LEAD_MAX,
  maxShowLead,
  TODO_PLATE_ORDER,
  fieldShowRule,
  groupOpenTodos,
  isShowLeadDays,
  plateClock,
  platedTodos,
  showFieldApplies,
  showPatchOnDueChange,
  showRuleField,
  showRuleLabel,
  showRulePatch,
  todoPlate,
  todoShowDate,
  todoShowRule,
  type PlateClock,
  type TodoShowRule,
} from '../todoPlate';
import { advanceRepeat } from '../todoRecurrence';

// Calendar: 2026-11-10 is a Tuesday; 2026-11-17 and -24 are the Tuesdays after it.
const TODAY = '2026-11-10';
const NOON: PlateClock = { ymd: TODAY, hhmm: '12:00' };
const WEEKLY_TUE: RecurrenceRule = {
  unit: 'week',
  interval: 1,
  weekdays: [2],
  end: { kind: 'never' },
};

function todo(over: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 't',
    title: 't',
    completed: false,
    createdBy: 'm',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...over,
  };
}
const repeating = (over: Partial<TodoItem> = {}) =>
  todo({ repeat: { rule: WEEKLY_TUE, anchor: '2026-11-03' }, repeatLog: [], ...over });

const t = (key: UIStringKey): string => UI_STRINGS[key];

describe('plateClock', () => {
  it('reads the device-local day and minute', () => {
    expect(plateClock(new Date(2026, 10, 10, 7, 5))).toEqual({ ymd: TODAY, hhmm: '07:05' });
  });
});

describe('constants', () => {
  it('the lead is 1-30, starting at 3', () => {
    expect(SHOW_LEAD_MAX).toBe(30);
    expect(SHOW_LEAD_DEFAULT).toBe(3);
  });
  it.each([
    [0, false],
    [1, true],
    [30, true],
    [31, false],
    [2.5, false],
    [-3, false],
    [Number.NaN, false],
    ['3', false],
    [undefined, false],
  ])('isShowLeadDays(%s) → %s', (days, ok) => {
    expect(isShowLeadDays(days)).toBe(ok);
  });
});

// ── todoShowRule: the effective rule, including merged fields ────────────────

describe('todoShowRule', () => {
  const DUE = '2026-11-24';
  it.each<[string, Partial<TodoItem>, TodoShowRule]>([
    // one-off
    ['one-off, nothing set → now', { dueDate: DUE }, { kind: 'now' }],
    [
      'one-off, showFrom → from',
      { dueDate: DUE, showFrom: '2026-11-20' },
      { kind: 'from', date: '2026-11-20' },
    ],
    ['one-off, showOn due → due', { dueDate: DUE, showOn: 'due' }, { kind: 'due' }],
    ['one-off, showOn now → now', { dueDate: DUE, showOn: 'now' }, { kind: 'now' }],
    [
      'one-off, merged showOn due + showFrom → due',
      { dueDate: DUE, showOn: 'due', showFrom: '2026-11-20' },
      { kind: 'due' },
    ],
    [
      'one-off, merged showOn now + showFrom → now',
      { dueDate: DUE, showOn: 'now', showFrom: '2026-11-20' },
      { kind: 'now' },
    ],
    [
      'one-off, malformed showFrom → now (fails open)',
      { dueDate: DUE, showFrom: '20 Nov' },
      { kind: 'now' },
    ],
    [
      'one-off, timestamp showFrom → now (fails open)',
      { dueDate: DUE, showFrom: '2026-11-20T00:00:00Z' },
      { kind: 'now' },
    ],
    [
      'one-off, showFrom after the due date → from (capped on read)',
      { dueDate: DUE, showFrom: '2026-12-01' },
      { kind: 'from', date: '2026-12-01' },
    ],
    ['one-off, lead → ignored', { dueDate: DUE, showLeadDays: 3 }, { kind: 'now' }],
    // undated: always now, whatever a merge left
    ['undated, showOn due → now', { showOn: 'due' }, { kind: 'now' }],
    ['undated, showFrom → now', { showFrom: '2026-11-20' }, { kind: 'now' }],
    [
      'malformed due date reads as undated → now',
      { dueDate: 'soon', showOn: 'due' },
      { kind: 'now' },
    ],
  ])('%s', (_, over, rule) => {
    expect(todoShowRule(todo(over))).toEqual(rule);
  });

  it.each<[string, Partial<TodoItem>, TodoShowRule]>([
    ['repeating, nothing set → due (the default)', {}, { kind: 'due' }],
    ['repeating, showOn now → now', { showOn: 'now' }, { kind: 'now' }],
    ['repeating, showOn due → due', { showOn: 'due' }, { kind: 'due' }],
    ['repeating, showFrom → ignored (due)', { showFrom: '2026-11-20' }, { kind: 'due' }],
    ['repeating, lead 1', { showLeadDays: 1 }, { kind: 'lead', days: 1 }],
    ['repeating weekly, lead 6', { showLeadDays: 6 }, { kind: 'lead', days: 6 }],
    ['repeating weekly, lead 30 → reads as 6', { showLeadDays: 30 }, { kind: 'lead', days: 6 }],
    ['repeating, lead 0 → due', { showLeadDays: 0 }, { kind: 'due' }],
    ['repeating, lead 31 → due', { showLeadDays: 31 }, { kind: 'due' }],
    ['repeating, lead 2.5 → due', { showLeadDays: 2.5 }, { kind: 'due' }],
    [
      'repeating, merged showOn now + lead → now (more visible wins)',
      { showOn: 'now', showLeadDays: 3 },
      { kind: 'now' },
    ],
    [
      'repeating, merged showOn due + lead → lead',
      { showOn: 'due', showLeadDays: 3 },
      { kind: 'lead', days: 3 },
    ],
    [
      'repeating, merged lead + showFrom → lead',
      { showLeadDays: 3, showFrom: '2026-11-20' },
      { kind: 'lead', days: 3 },
    ],
  ])('%s', (_, over, rule) => {
    expect(todoShowRule(repeating({ dueDate: DUE, ...over }))).toEqual(rule);
  });

  it('a corrupt repeat rule reads as a one-off', () => {
    const broken = repeating({
      dueDate: DUE,
      repeat: { rule: { ...WEEKLY_TUE, interval: 0 }, anchor: '2026-11-03' },
      showFrom: '2026-11-20',
    });
    expect(todoShowRule(broken)).toEqual({ kind: 'from', date: '2026-11-20' });
  });
});

// ── showRulePatch: the one writer ────────────────────────────────────────────

describe('maxShowLead (one day less than the shortest gap between occurrences)', () => {
  const never = { kind: 'never' } as const;
  const c = (over: Partial<RecurrenceRule>): RecurrenceRule => ({
    unit: 'week',
    interval: 1,
    end: never,
    ...over,
  });
  it.each([
    ['daily', c({ unit: 'day' }), 0],
    ['every 3 days', c({ unit: 'day', interval: 3 }), 2],
    ['weekly', c({}), 6],
    ['weekly on one day', c({ weekdays: [2] }), 6],
    ['weekly on Mon and Thu', c({ weekdays: [1, 4] }), 2],
    ['weekly on Sat and Sun (wraps the week)', c({ weekdays: [6, 0] }), 0],
    ['weekly on Mon, Wed, Fri', c({ weekdays: [1, 3, 5] }), 1],
    ['every 2 weeks', c({ interval: 2, weekdays: [2] }), 13],
    ['monthly', c({ unit: 'month' }), 27],
    ['every 2 months → the ceiling', c({ unit: 'month', interval: 2 }), 30],
    ['yearly → the ceiling', c({ unit: 'year' }), 30],
    ['a malformed interval reads as 1', c({ unit: 'day', interval: 0 }), 0],
  ])('%s → %i', (_name, cadence, max) => {
    expect(maxShowLead(cadence)).toBe(max);
  });

  it('no cadence is the plain ceiling', () => {
    expect(maxShowLead(undefined)).toBe(SHOW_LEAD_MAX);
    expect(maxShowLead(null)).toBe(SHOW_LEAD_MAX);
  });

  it('a daily repeat has no room for a lead: a stored one reads as "on each due date"', () => {
    const daily = repeating({
      dueDate: '2026-11-17',
      repeat: { rule: c({ unit: 'day' }), anchor: '2026-11-01' },
      showLeadDays: 3,
    });
    expect(todoShowRule(daily)).toEqual({ kind: 'due' });
  });
});

describe('showRulePatch', () => {
  const cleared = { showFrom: undefined, showOn: undefined, showLeadDays: undefined };
  it.each<[string, TodoShowRule, boolean, Partial<TodoItem>]>([
    ['one-off now', { kind: 'now' }, false, {}],
    ['one-off from', { kind: 'from', date: '2026-11-20' }, false, { showFrom: '2026-11-20' }],
    ['one-off due', { kind: 'due' }, false, { showOn: 'due' }],
    ['one-off lead → now', { kind: 'lead', days: 3 }, false, {}],
    ['one-off malformed from → now', { kind: 'from', date: 'x' }, false, {}],
    ['repeating due → default', { kind: 'due' }, true, {}],
    ['repeating from → default', { kind: 'from', date: '2026-11-20' }, true, {}],
    ['repeating now', { kind: 'now' }, true, { showOn: 'now' }],
    ['repeating lead', { kind: 'lead', days: 3 }, true, { showLeadDays: 3 }],
    ['repeating lead 31 → default', { kind: 'lead', days: 31 }, true, {}],
  ])('%s', (_, rule, rep, written) => {
    const patch = showRulePatch(rule, rep);
    // All three keys are always present, so a write never leaves a stale field behind.
    expect(Object.keys(patch).sort()).toEqual(['showFrom', 'showLeadDays', 'showOn']);
    expect(patch).toEqual({ ...cleared, ...written });
  });

  it('round-trips through todoShowRule for every rule a person can pick', () => {
    const DUE = '2026-11-24';
    const cases: [TodoShowRule, boolean][] = [
      [{ kind: 'now' }, false],
      [{ kind: 'from', date: '2026-11-20' }, false],
      [{ kind: 'due' }, false],
      [{ kind: 'now' }, true],
      [{ kind: 'due' }, true],
      [{ kind: 'lead', days: 6 }, true],
    ];
    for (const [rule, rep] of cases) {
      const base = rep ? repeating({ dueDate: DUE }) : todo({ dueDate: DUE });
      expect(todoShowRule({ ...base, ...showRulePatch(rule, rep) })).toEqual(rule);
    }
  });
});

// ── todoShowDate ─────────────────────────────────────────────────────────────

describe('todoShowDate', () => {
  it.each<[string, TodoItem, string | undefined]>([
    ['now → undefined', todo({ dueDate: '2026-11-24' }), undefined],
    ['due → the due date', todo({ dueDate: '2026-11-24', showOn: 'due' }), '2026-11-24'],
    ['from → its date', todo({ dueDate: '2026-11-24', showFrom: '2026-11-20' }), '2026-11-20'],
    [
      'from after the due date (due moved) → the due date',
      todo({ dueDate: '2026-11-18', showFrom: '2026-11-20' }),
      '2026-11-18',
    ],
    ['repeating default → the due date', repeating({ dueDate: '2026-11-24' }), '2026-11-24'],
    [
      'repeating lead 3 → three days before',
      repeating({ dueDate: '2026-11-24', showLeadDays: 3 }),
      '2026-11-21',
    ],
    [
      'repeating lead across a month',
      repeating({ dueDate: '2026-12-01', showLeadDays: 3 }),
      '2026-11-28',
    ],
    ['undated → undefined', todo({ showFrom: '2026-11-20' }), undefined],
  ])('%s', (_, item, date) => {
    expect(todoShowDate(item)).toBe(date);
  });
});

// ── todoPlate: the one date rule ─────────────────────────────────────────────

describe('todoPlate', () => {
  it.each<[string, Partial<TodoItem>, string]>([
    // one-off, default (now): before / on / after the due date
    ['due later, default → upcoming', { dueDate: '2026-11-24' }, 'upcoming'],
    ['due today, untimed → today', { dueDate: TODAY }, 'today'],
    ['due today, time later → today', { dueDate: TODAY, dueTime: '18:00' }, 'today'],
    ['due today, time passed → overdue', { dueDate: TODAY, dueTime: '09:00' }, 'overdue'],
    ['due today, time this minute → today', { dueDate: TODAY, dueTime: '12:00' }, 'today'],
    ['due yesterday → overdue', { dueDate: '2026-11-09' }, 'overdue'],
    [
      'due yesterday, timed later in the day → overdue',
      { dueDate: '2026-11-09', dueTime: '23:00' },
      'overdue',
    ],
    ['undated → undated', {}, 'undated'],
    ['full ISO due date (date part) → today', { dueDate: `${TODAY}T22:00:00.000Z` }, 'today'],
    ['malformed due date → undated', { dueDate: 'garbage' }, 'undated'],
    [
      'malformed due time → untimed (never overdue early)',
      { dueDate: TODAY, dueTime: '9:00' },
      'today',
    ],
    // one-off from
    ['from later → waiting', { dueDate: '2026-11-24', showFrom: '2026-11-20' }, 'waiting'],
    ['from today → upcoming', { dueDate: '2026-11-24', showFrom: TODAY }, 'upcoming'],
    ['from past → upcoming', { dueDate: '2026-11-24', showFrom: '2026-11-01' }, 'upcoming'],
    [
      'from after due, due today → today (never hidden on the due date)',
      { dueDate: TODAY, showFrom: '2026-11-20' },
      'today',
    ],
    [
      'from after due, overdue → overdue',
      { dueDate: '2026-11-08', showFrom: '2026-11-20' },
      'overdue',
    ],
    [
      'malformed from → upcoming (fails open)',
      { dueDate: '2026-11-24', showFrom: 'later' },
      'upcoming',
    ],
    // one-off due
    ['on the due date, before it → waiting', { dueDate: '2026-11-24', showOn: 'due' }, 'waiting'],
    ['on the due date, on it → today', { dueDate: TODAY, showOn: 'due' }, 'today'],
    [
      'on the due date, timed and passed → overdue',
      { dueDate: TODAY, dueTime: '08:00', showOn: 'due' },
      'overdue',
    ],
    ['on the due date, after it → overdue', { dueDate: '2026-11-01', showOn: 'due' }, 'overdue'],
    ['due rule on an undated to-do → undated', { showOn: 'due' }, 'undated'],
    // merged both fields
    [
      'merged due + from → due wins (waiting until the due date)',
      { dueDate: '2026-11-24', showOn: 'due', showFrom: TODAY },
      'waiting',
    ],
  ])('one-off: %s', (_, over, plate) => {
    expect(todoPlate(todo(over), NOON)).toBe(plate);
  });

  it.each<[string, Partial<TodoItem>, string]>([
    ['default, due next week → waiting', { dueDate: '2026-11-17' }, 'waiting'],
    ['default, due today → today', { dueDate: TODAY }, 'today'],
    ['default, due today, time passed → overdue', { dueDate: TODAY, dueTime: '07:00' }, 'overdue'],
    [
      'every day (showOn now), due next week → upcoming',
      { dueDate: '2026-11-17', showOn: 'now' },
      'upcoming',
    ],
    [
      'lead 7 on a weekly repeat reads as 6: due in 7 days → waiting',
      { dueDate: '2026-11-17', showLeadDays: 7 },
      'waiting',
    ],
    ['lead 6, due in 6 days → upcoming', { dueDate: '2026-11-16', showLeadDays: 6 }, 'upcoming'],
    ['lead 6, due in 7 days → waiting', { dueDate: '2026-11-17', showLeadDays: 6 }, 'waiting'],
    [
      'lead 31 (out of range) → the default (waiting)',
      { dueDate: '2026-11-17', showLeadDays: 31 },
      'waiting',
    ],
    ['lead 0 → the default (waiting)', { dueDate: '2026-11-17', showLeadDays: 0 }, 'waiting'],
    ['showFrom ignored → waiting', { dueDate: '2026-11-17', showFrom: TODAY }, 'waiting'],
  ])('repeating: %s', (_, over, plate) => {
    expect(todoPlate(repeating(over), NOON)).toBe(plate);
  });

  it('never reads completed or someday (callers filter), so a finished to-do keeps its plate', () => {
    expect(todoPlate(todo({ dueDate: TODAY, completed: true }), NOON)).toBe('today');
    expect(todoPlate(todo({ someday: true }), NOON)).toBe('undated');
  });

  it('a repeating lead window opens, peaks on the day, and closes again after a roll', () => {
    // "3 days before" each Tuesday: the window for the 17th opens on the 14th.
    let chore = repeating({ dueDate: '2026-11-17', showLeadDays: 3 });
    const on = (ymd: string, hhmm = '12:00') => todoPlate(chore, { ymd, hhmm });
    expect(on('2026-11-13')).toBe('waiting');
    expect(on('2026-11-14')).toBe('upcoming');
    expect(on('2026-11-16')).toBe('upcoming');
    expect(on('2026-11-17')).toBe('today');
    // Ticked on the day: the series rolls to the 24th and waits again until the 21st.
    const roll = advanceRepeat(chore, 'done', 'm', '2026-11-17T12:00:00.000Z', '2026-11-17');
    expect(roll).not.toBeNull();
    expect(roll).not.toBe('series-ended');
    chore = { ...chore, ...(roll as { patch: Partial<TodoItem> }).patch };
    expect(chore.dueDate).toBe('2026-11-24');
    expect(on('2026-11-17', '12:01')).toBe('waiting');
    expect(on('2026-11-20')).toBe('waiting');
    expect(on('2026-11-21')).toBe('upcoming');
  });
});

// ── platedTodos: one plate each, in order ────────────────────────────────────

describe('platedTodos', () => {
  it('orders overdue (oldest first), today (timed by time, then untimed), undated (source order), upcoming (soonest), waiting (soonest show date)', () => {
    const items = [
      todo({ id: 'wait-late', dueDate: '2026-12-20', showFrom: '2026-12-01' }),
      todo({ id: 'up-far', dueDate: '2026-12-01' }),
      todo({ id: 'undated-1' }),
      todo({ id: 'today-untimed', dueDate: TODAY }),
      todo({ id: 'today-18', dueDate: TODAY, dueTime: '18:00' }),
      todo({ id: 'today-13', dueDate: TODAY, dueTime: '13:00' }),
      todo({ id: 'over-new', dueDate: '2026-11-09' }),
      todo({ id: 'over-old', dueDate: '2026-11-01' }),
      todo({ id: 'over-today', dueDate: TODAY, dueTime: '08:00' }),
      todo({ id: 'undated-2' }),
      todo({ id: 'up-near', dueDate: '2026-11-12' }),
      todo({ id: 'wait-soon', dueDate: '2026-12-30', showFrom: '2026-11-20' }),
    ];
    const plated = platedTodos(items, NOON);
    expect(plated.map((p) => p.todo.id)).toEqual([
      'over-old',
      'over-new',
      'over-today',
      'today-13',
      'today-18',
      'today-untimed',
      'undated-1',
      'undated-2',
      'up-near',
      'up-far',
      'wait-soon',
      'wait-late',
    ]);
    // The plates appear in TODO_PLATE_ORDER.
    const ranks = plated.map((p) => TODO_PLATE_ORDER.indexOf(p.plate));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it('keeps input order on ties, and never mutates the input', () => {
    const a = todo({ id: 'a', dueDate: '2026-11-12' });
    const b = todo({ id: 'b', dueDate: '2026-11-12' });
    const input = [b, a];
    expect(platedTodos(input, NOON).map((p) => p.todo.id)).toEqual(['b', 'a']);
    expect(input.map((x) => x.id)).toEqual(['b', 'a']);
  });
});

// ── groupOpenTodos: the To-Dos page's Open groups ────────────────────────────

describe('groupOpenTodos', () => {
  it('groups by plate: Overdue, Due today, Coming up (undated then upcoming), Not showing yet', () => {
    const plated = platedTodos(
      [
        todo({ id: 'up', dueDate: '2026-11-12' }),
        todo({ id: 'wait', dueDate: '2026-11-30', showOn: 'due' }),
        todo({ id: 'undated' }),
        todo({ id: 'over', dueDate: '2026-11-01' }),
        todo({ id: 'today', dueDate: TODAY }),
      ],
      NOON
    );
    expect(groupOpenTodos(plated).map((g) => [g.id, g.labelKey, g.todos.map((x) => x.id)])).toEqual(
      [
        ['overdue', 'todo.section.overdue', ['over']],
        ['today', 'todo.section.dueToday', ['today']],
        ['upcoming', 'todo.section.comingUp', ['undated', 'up']],
        ['waiting', 'todo.section.notShowingYet', ['wait']],
      ]
    );
  });

  it('leaves out empty groups', () => {
    const plated = platedTodos([todo({ id: 'undated' })], NOON);
    expect(groupOpenTodos(plated).map((g) => g.id)).toEqual(['upcoming']);
    expect(groupOpenTodos([])).toEqual([]);
  });
});

// ── The form field's date ↔ the stored rule ──────────────────────────────────

describe('fieldShowRule / showRuleField', () => {
  const DUE = '2026-11-24';
  it.each<[string, string, TodoShowRule]>([
    ['today → now', TODAY, { kind: 'now' }],
    ['before today → now', '2026-11-01', { kind: 'now' }],
    ['between → from', '2026-11-20', { kind: 'from', date: '2026-11-20' }],
    ['the due date → due (a flag)', DUE, { kind: 'due' }],
    ['after the due date → due', '2026-11-30', { kind: 'due' }],
    ['malformed → now', 'next week', { kind: 'now' }],
  ])('fieldShowRule: %s', (_, date, rule) => {
    expect(fieldShowRule(date, DUE, TODAY)).toEqual(rule);
  });

  it('a due date of today: the field can only say now', () => {
    expect(fieldShowRule(TODAY, TODAY, TODAY)).toEqual({ kind: 'now' });
  });

  it.each<[string, TodoShowRule, string, string]>([
    ['now → today', { kind: 'now' }, DUE, TODAY],
    ['from → its date', { kind: 'from', date: '2026-11-20' }, DUE, '2026-11-20'],
    ['from that has passed → today', { kind: 'from', date: '2026-11-05' }, DUE, TODAY],
    ['from after the due date → the due date', { kind: 'from', date: '2026-11-30' }, DUE, DUE],
    ['due → the due date', { kind: 'due' }, DUE, DUE],
    ['due when overdue → today', { kind: 'due' }, '2026-11-01', TODAY],
    ['lead → the show date', { kind: 'lead', days: 3 }, DUE, '2026-11-21'],
    ['no due date → today', { kind: 'due' }, '', TODAY],
  ])('showRuleField: %s', (_, rule, due, date) => {
    expect(showRuleField(rule, due, TODAY)).toBe(date);
  });

  it('round-trips: the field date read back from a rule maps to the same rule', () => {
    for (const date of [TODAY, '2026-11-15', '2026-11-23', DUE]) {
      const rule = fieldShowRule(date, DUE, TODAY);
      expect(showRuleField(rule, DUE, TODAY)).toBe(date);
      expect(fieldShowRule(showRuleField(rule, DUE, TODAY), DUE, TODAY)).toEqual(rule);
    }
  });

  it('a due rule follows the due date when it moves (it is a flag, not a date)', () => {
    const rule = fieldShowRule(DUE, DUE, TODAY);
    expect(showRuleField(rule, '2026-12-04', TODAY)).toBe('2026-12-04');
  });
});

// ── showRuleLabel: the row tag ───────────────────────────────────────────────

describe('showRuleLabel', () => {
  const DUE = '2026-12-04';
  it.each<[string, TodoShowRule, string, string]>([
    ['from', { kind: 'from', date: '2026-11-24' }, DUE, 'Shows from Tue, 24 Nov'],
    ['due', { kind: 'due' }, DUE, 'Shows on the due date'],
    [
      'from on the due date reads as due',
      { kind: 'from', date: DUE },
      DUE,
      'Shows on the due date',
    ],
    ['lead 1', { kind: 'lead', days: 1 }, DUE, 'Shows 1 day before'],
    ['lead 3', { kind: 'lead', days: 3 }, DUE, 'Shows 3 days before'],
    ['now → nothing to say', { kind: 'now' }, DUE, ''],
    ['a show date already reached → nothing', { kind: 'from', date: TODAY }, DUE, ''],
    ['due today → nothing', { kind: 'due' }, TODAY, ''],
    ['no due date → nothing', { kind: 'due' }, '', ''],
  ])('%s', (_, rule, due, label) => {
    expect(showRuleLabel(rule, due, TODAY, t)).toBe(label);
  });
});

describe('showPatchOnDueChange (the rule follows the due date)', () => {
  const CLEARED = { showFrom: undefined, showOn: undefined, showLeadDays: undefined };

  it('clears the rule when an existing due date is cleared', () => {
    for (const next of [null, undefined, '']) {
      expect(showPatchOnDueChange({ dueDate: '2026-12-20', showOn: 'due' }, next)).toEqual(CLEARED);
    }
    expect(showPatchOnDueChange({ dueDate: '2026-12-20', showFrom: '2026-12-10' }, null)).toEqual(
      CLEARED
    );
  });

  it('leaves a to-do with no rule, or no due date to begin with, alone', () => {
    expect(showPatchOnDueChange({ dueDate: '2026-12-20' }, null)).toBeNull();
    // A repeat's undo patch writes `dueDate: undefined` on a to-do whose date is missing.
    expect(
      showPatchOnDueChange(
        { repeat: { rule: WEEKLY_TUE, anchor: '2026-11-03' }, showLeadDays: 3 },
        undefined
      )
    ).toBeNull();
  });

  it('turns a show-from at or past the moved due date into "on the due date"', () => {
    const existing = { dueDate: '2026-12-20', showFrom: '2026-12-10' };
    expect(showPatchOnDueChange(existing, '2026-12-05')).toEqual({ ...CLEARED, showOn: 'due' });
    expect(showPatchOnDueChange(existing, '2026-12-10')).toEqual({ ...CLEARED, showOn: 'due' });
    expect(showPatchOnDueChange(existing, '2026-12-30')).toBeNull();
  });

  it('never touches a repeating to-do or an explicit showOn when the date moves', () => {
    expect(
      showPatchOnDueChange(
        {
          dueDate: '2026-11-17',
          repeat: { rule: WEEKLY_TUE, anchor: '2026-11-03' },
          showLeadDays: 3,
        },
        '2026-11-24'
      )
    ).toBeNull();
    expect(showPatchOnDueChange({ dueDate: '2026-12-20', showOn: 'due' }, '2026-12-05')).toBeNull();
  });
});

describe('showFieldApplies', () => {
  it('offers the choice for a one-off only while its due date is ahead', () => {
    expect(showFieldApplies(false, '2026-11-11', '2026-11-10')).toBe(true);
    expect(showFieldApplies(false, '2026-11-10', '2026-11-10')).toBe(false);
    expect(showFieldApplies(false, '2026-11-01', '2026-11-10')).toBe(false);
    expect(showFieldApplies(false, '', '2026-11-10')).toBe(false);
  });

  it('always offers it for a repeating to-do with a due date', () => {
    expect(showFieldApplies(true, '2026-11-10', '2026-11-10')).toBe(true);
    expect(showFieldApplies(true, '', '2026-11-10')).toBe(false);
  });
});
