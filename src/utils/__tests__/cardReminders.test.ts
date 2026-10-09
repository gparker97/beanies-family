import { describe, expect, it } from 'vitest';
import type { ResponsibilityCardDef } from '@/constants/responsibilityCards';
import { resolveDeck, type ResolvedCard } from '@/utils/responsibilityDeck';
import {
  CARD_MANAGED_FIELDS,
  buildCardReminder,
  cardRemindersKey,
  cardRemindersKind,
  cardTodoId,
  computeDesiredCardTodos,
  reconcileCardTodos,
  reminderStartDate,
  type DesiredCardTodo,
} from '@/utils/cardReminders';
import { occurrencesInRange } from '@/services/recurrence/recurrenceEngine';
import { cadenceToRule } from '@/services/recurrence/cadence';
import { parseLocalDate } from '@/utils/date';
import type {
  CardReminder,
  FamilyMember,
  RecurrenceRule,
  ResponsibilityCardState,
  TodoItem,
} from '@/types/models';

// ── fixtures ────────────────────────────────────────────────────────────────────

const TODAY = '2026-10-09'; // a Friday
const T0 = '2026-09-01T10:00:00.000Z';

function member(id: string, over: Partial<FamilyMember> = {}): FamilyMember {
  return { id, name: id, ageGroup: 'adult', role: 'member', ...over } as FamilyMember;
}
const FAMILY = [
  member('greg', { role: 'owner' }),
  member('sofia'),
  member('leo', { ageGroup: 'child' }),
  member('mia', { ageGroup: 'child' }),
];

const DEFS: ResponsibilityCardDef[] = ['trash', 'lunchboxes', 'laundry', 'dishes'].map((id) => ({
  id,
  category: 'home',
  emoji: '🗑️',
  nameKey: 'cards.laundry.name',
  doneKey: 'cards.laundry.done',
}));

/** Weekly on Wednesday at 8pm; first occurrence on or after TODAY is 2026-10-14. */
const TRASH: CardReminder = {
  say: 'Put the trash out',
  cadence: { unit: 'week', interval: 1, weekdays: [3] },
  time: '20:00',
  anchor: '2026-09-30',
};
const NEXT_WED = '2026-10-14';

function state(id: string, over: Partial<ResponsibilityCardState> = {}): ResponsibilityCardState {
  return {
    id,
    status: 'kept',
    splitMode: 'single',
    parts: [{ key: 'main' }],
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

function deck(states: ResponsibilityCardState[]): ResolvedCard[] {
  return resolveDeck(DEFS, states, [], FAMILY).cards;
}

const trashHeldBy = (holderId: string, reminder: CardReminder = TRASH) =>
  state('trash', { parts: [{ key: 'main', holderId }], reminders: { main: reminder } });

function desired(states: ResponsibilityCardState[]): DesiredCardTodo[] {
  return computeDesiredCardTodos(deck(states), TODAY, 'sofia');
}

/** A stored to-do as the store would hold it after creating `d`. */
function stored(d: DesiredCardTodo, over: Partial<TodoItem> = {}): TodoItem {
  return { ...d, createdAt: T0, updatedAt: T0, ...over };
}

// ── computeDesiredCardTodos ─────────────────────────────────────────────────────

describe('computeDesiredCardTodos', () => {
  it('a single card makes one to-do with a deterministic id, the reminder fields and the card link', () => {
    const [todo, ...rest] = desired([trashHeldBy('greg')]);
    expect(rest).toEqual([]);
    expect(todo).toEqual({
      id: 'card-trash-main',
      title: 'Put the trash out',
      assigneeIds: ['greg'],
      assigneeId: 'greg',
      dueDate: NEXT_WED,
      dueTime: '20:00',
      repeat: { rule: { ...TRASH.cadence, end: { kind: 'never' } }, anchor: '2026-09-30' },
      repeatLog: [],
      completed: false,
      createdBy: 'sofia',
      cardId: 'trash',
      cardPartKey: 'main',
    });
    expect(cardTodoId('trash', 'main')).toBe(todo!.id);
  });

  it('an all-day reminder carries no due time', () => {
    const { time: _time, ...allDay } = TRASH;
    expect(desired([trashHeldBy('greg', allDay)])[0]).not.toHaveProperty('dueTime');
  });

  it('a child split makes one to-do per held part with a reminder, assigned to that part holder', () => {
    const todos = desired([
      state('lunchboxes', {
        splitMode: 'child',
        parts: [
          { key: 'leo', holderId: 'greg' },
          { key: 'mia', holderId: 'mia' },
        ],
        reminders: { leo: TRASH, mia: { ...TRASH, say: 'Pack your lunch' } },
      }),
    ]);
    expect(todos.map((t) => [t.id, t.assigneeIds, t.title, t.cardPartKey])).toEqual([
      ['card-lunchboxes-leo', ['greg'], 'Put the trash out', 'leo'],
      ['card-lunchboxes-mia', ['mia'], 'Pack your lunch', 'mia'],
    ]);
    expect(cardRemindersKind(todos)).toBe('split');
  });

  it('a label split keys its to-dos by the label part key', () => {
    const todos = desired([
      state('laundry', {
        splitMode: 'label',
        parts: [
          { key: 'label-a', label: 'upstairs', holderId: 'sofia' },
          { key: 'label-b', label: 'downstairs', holderId: 'greg' },
        ],
        reminders: { 'label-b': TRASH },
      }),
    ]);
    expect(todos.map((t) => t.id)).toEqual(['card-laundry-label-b']);
    expect(todos[0]!.assigneeIds).toEqual(['greg']);
  });

  it('nobody holding the part, a skipped card, or no reminder produces nothing', () => {
    expect(
      desired([
        state('trash', { parts: [{ key: 'main' }], reminders: { main: TRASH } }),
        state('lunchboxes', {
          status: 'skipped',
          parts: [{ key: 'main', holderId: 'greg' }],
          reminders: { main: TRASH },
        }),
        state('laundry', { parts: [{ key: 'main', holderId: 'greg' }] }),
      ])
    ).toEqual([]);
    expect(cardRemindersKind([])).toBe('single');
  });

  it('a holder who left the family produces nothing', () => {
    expect(desired([trashHeldBy('gone')])).toEqual([]);
  });
});

// ── reconcileCardTodos ──────────────────────────────────────────────────────────

describe('reconcileCardTodos', () => {
  const want = desired([trashHeldBy('greg')]);
  const [d] = want;

  it('creates a missing card to-do', () => {
    expect(reconcileCardTodos(want, [], TODAY)).toEqual({
      toCreate: want,
      toPatch: [],
      toRemove: [],
    });
  });

  it('identical inputs give an empty diff', () => {
    expect(reconcileCardTodos(want, [stored(d!)], TODAY)).toEqual({
      toCreate: [],
      toPatch: [],
      toRemove: [],
    });
  });

  it('a re-deal patches only the assignee', () => {
    const redealt = desired([trashHeldBy('sofia')]);
    expect(reconcileCardTodos(redealt, [stored(d!)], TODAY).toPatch).toEqual([
      { id: 'card-trash-main', patch: { assigneeIds: ['sofia'], assigneeId: 'sofia' } },
    ]);
  });

  it('a retitled card to-do is corrected; description, repeatLog and dueDate are never touched', () => {
    const existing = stored(d!, {
      title: 'Renamed elsewhere',
      description: 'my notes',
      repeatLog: [{ date: '2026-10-07', outcome: 'done', at: T0 }],
      dueDate: '2026-10-21',
    });
    expect(reconcileCardTodos(want, [existing], TODAY).toPatch).toEqual([
      { id: 'card-trash-main', patch: { title: 'Put the trash out' } },
    ]);
  });

  it('a time change patches dueTime, and an all-day reminder clears it', () => {
    const later = desired([trashHeldBy('greg', { ...TRASH, time: '21:30' })]);
    expect(reconcileCardTodos(later, [stored(d!)], TODAY).toPatch[0]!.patch).toEqual({
      dueTime: '21:30',
    });
    const { time: _time, ...allDay } = TRASH;
    const patch = reconcileCardTodos(desired([trashHeldBy('greg', allDay)]), [stored(d!)], TODAY)
      .toPatch[0]!.patch;
    expect(patch).toHaveProperty('dueTime', undefined);
    expect(Object.keys(patch)).toEqual(['dueTime']);
  });

  it('a cadence change updates repeat and recomputes dueDate', () => {
    const fridays: CardReminder = {
      ...TRASH,
      cadence: { unit: 'week', interval: 1, weekdays: [5] },
      anchor: TODAY,
    };
    const patch = reconcileCardTodos(desired([trashHeldBy('greg', fridays)]), [stored(d!)], TODAY)
      .toPatch[0]!.patch;
    expect(patch).toEqual({
      repeat: { rule: { ...fridays.cadence, end: { kind: 'never' } }, anchor: TODAY },
      dueDate: TODAY,
    });
  });

  it('a completed card to-do is reopened on its next occurrence', () => {
    const done = stored(d!, { completed: true, completedBy: 'greg', completedAt: T0 });
    expect(reconcileCardTodos(want, [done], TODAY).toPatch[0]!.patch).toEqual({
      completed: false,
      completedBy: undefined,
      completedAt: undefined,
      dueDate: NEXT_WED,
    });
  });

  it('a reopen never lands on an occurrence the log already handled', () => {
    const done = stored(d!, {
      completed: true,
      repeatLog: [{ date: NEXT_WED, outcome: 'done', at: T0 }],
    });
    expect(reconcileCardTodos(want, [done], TODAY).toPatch[0]!.patch.dueDate).toBe('2026-10-21');
  });

  it('a card to-do an old client parked as someday comes back dated', () => {
    const parked = stored(d!, { someday: true, dueDate: undefined });
    expect(reconcileCardTodos(want, [parked], TODAY).toPatch[0]!.patch).toEqual({
      someday: undefined,
      dueDate: NEXT_WED,
    });
  });

  it('removes a card to-do no card wants any more, and ignores plain to-dos', () => {
    const plain: TodoItem = {
      id: 'plain',
      title: 'Buy milk',
      completed: false,
      createdBy: 'greg',
      createdAt: T0,
      updatedAt: T0,
    };
    expect(reconcileCardTodos([], [stored(d!), plain], TODAY)).toEqual({
      toCreate: [],
      toPatch: [],
      toRemove: ['card-trash-main'],
    });
  });

  it('every managed-field patch stays inside the managed fields plus dueDate', () => {
    const allowed = new Set([
      'title',
      'assigneeIds',
      'assigneeId',
      'dueTime',
      'repeat',
      'dueDate',
      'completed',
      'completedBy',
      'completedAt',
      'someday',
    ]);
    for (const f of CARD_MANAGED_FIELDS) {
      for (const key of Object.keys(f.patch(d!))) expect(allowed.has(key)).toBe(true);
    }
  });
});

// ── cardRemindersKey ────────────────────────────────────────────────────────────

describe('cardRemindersKey', () => {
  const want = desired([trashHeldBy('greg')]);
  const existing = [stored(want[0]!)];
  const key = cardRemindersKey(want, existing);

  it('is stable for identical inputs, whatever their order', () => {
    const two = desired([
      trashHeldBy('greg'),
      state('laundry', { parts: [{ key: 'main', holderId: 'sofia' }], reminders: { main: TRASH } }),
    ]);
    expect(cardRemindersKey(want, existing)).toBe(key);
    expect(cardRemindersKey(two, [])).toBe(cardRemindersKey([...two].reverse(), []));
  });

  it('a changed dueDate (the store roll) or a new day leaves it unchanged', () => {
    expect(cardRemindersKey(want, [stored(want[0]!, { dueDate: '2026-10-21' })])).toBe(key);
    const tomorrow = computeDesiredCardTodos(deck([trashHeldBy('greg')]), '2026-10-15', 'sofia');
    expect(cardRemindersKey(tomorrow, existing)).toBe(key);
  });

  it('changes when a managed field drifts on either side, or a to-do appears or goes', () => {
    expect(cardRemindersKey(want, [stored(want[0]!, { title: 'x' })])).not.toBe(key);
    expect(cardRemindersKey(want, [stored(want[0]!, { completed: true })])).not.toBe(key);
    expect(cardRemindersKey(want, [])).not.toBe(key);
    expect(cardRemindersKey(desired([trashHeldBy('sofia')]), existing)).not.toBe(key);
  });

  it('ignores plain to-dos', () => {
    const plain = stored(want[0]!, { id: 'plain', cardId: undefined, title: 'Buy milk' });
    expect(cardRemindersKey(want, [...existing, plain])).toBe(key);
  });
});

// ── editor helpers ──────────────────────────────────────────────────────────────

describe('reminderStartDate', () => {
  it('is today for a new reminder', () => {
    expect(reminderStartDate(null, TODAY)).toBe(TODAY);
  });

  it('is the next occurrence on or after today for an existing one', () => {
    expect(reminderStartDate(TRASH, TODAY)).toBe(NEXT_WED);
    expect(reminderStartDate(TRASH, NEXT_WED)).toBe(NEXT_WED);
  });
});

describe('buildCardReminder', () => {
  const weekly = (weekdays: number[]): RecurrenceRule => ({
    unit: 'week',
    interval: 1,
    weekdays,
    end: { kind: 'never' },
  });

  it('keeps the anchor while the cadence is unchanged', () => {
    const r = buildCardReminder(
      TRASH,
      { say: 'Bins!', rule: weekly([3]), time: '19:00' },
      'Trash',
      NEXT_WED
    );
    expect(r).toEqual({ ...TRASH, say: 'Bins!', time: '19:00' });
  });

  it('a cadence change stores the given start date as the anchor (not today)', () => {
    const r = buildCardReminder(TRASH, { say: 'Bins', rule: weekly([4]) }, 'Trash', NEXT_WED);
    expect(r.anchor).toBe(NEXT_WED);
    expect(r.cadence).toEqual({ unit: 'week', interval: 1, weekdays: [4] });
    expect(r).not.toHaveProperty('time');
  });

  it('a new reminder anchors on the start date; a blank say falls back to the card name', () => {
    expect(
      buildCardReminder(null, { say: '   ', rule: weekly([3]), time: null }, 'Trash Night', TODAY)
    ).toEqual({
      say: 'Trash Night',
      cadence: { unit: 'week', interval: 1, weekdays: [3] },
      anchor: TODAY,
    });
  });

  it('a monthly-by-weekday rule rebuilt from reminderStartDate keeps its weekday ordinal', () => {
    // 2026-10-04 is the first Sunday of October.
    const prev: CardReminder = {
      say: 'Swap the sheets',
      cadence: { unit: 'month', interval: 1, monthlyAnchor: 'weekday' },
      anchor: '2026-10-04',
    };
    const start = reminderStartDate(prev, TODAY);
    expect(start).toBe('2026-11-01');
    const everyOther = buildCardReminder(
      prev,
      {
        say: prev.say,
        rule: { unit: 'month', interval: 2, monthlyAnchor: 'weekday', end: { kind: 'never' } },
      },
      'Sheets',
      start
    );
    expect(everyOther.anchor).toBe(start);
    const dates = occurrencesInRange(
      cadenceToRule(everyOther.cadence),
      everyOther.anchor,
      start,
      '2027-12-31'
    );
    expect(dates.length).toBeGreaterThan(3);
    for (const ymd of dates) {
      const day = parseLocalDate(ymd);
      expect(day.getDay()).toBe(0);
      expect(day.getDate()).toBeLessThanOrEqual(7);
    }
  });
});
