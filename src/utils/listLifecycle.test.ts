import { describe, it, expect } from 'vitest';
import {
  isRecurring,
  isFiled,
  isListDue,
  isDueSoon,
  nextListResetOnOrAfter,
  computeRecurringReset,
  listPlate,
  listProgress,
  listRemaining,
  listShowLabel,
  listSubject,
  type ListSubject,
} from './listLifecycle';
import type { FamilyList } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { UI_STRINGS } from '@/services/translation/uiStrings';
import { addDaysYmd, formatNookDate } from './date';
import { fillTemplate } from './fillTemplate';
import { invalidShowRule, showRuleOf } from './todoPlate';

function list(overrides: Partial<FamilyList> = {}): FamilyList {
  return {
    id: 'l-1',
    title: 'Groceries',
    emoji: '🛒',
    category: 'out',
    ownerId: 'm-1',
    items: [],
    lifecycle: 'oneoff',
    completed: false,
    createdBy: 'm-1',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('listLifecycle predicates', () => {
  it('isRecurring distinguishes recurring from one-off', () => {
    expect(isRecurring(list({ lifecycle: 'recurring' }))).toBe(true);
    expect(isRecurring(list({ lifecycle: 'oneoff' }))).toBe(false);
  });

  it('isFiled is true only for a completed one-off (recurring is never filed)', () => {
    expect(isFiled(list({ lifecycle: 'oneoff', completed: true }))).toBe(true);
    expect(isFiled(list({ lifecycle: 'oneoff', completed: false }))).toBe(false);
    // A recurring list with completed:true (shouldn't happen) is still never filed.
    expect(isFiled(list({ lifecycle: 'recurring', completed: true }))).toBe(false);
  });

  it('listProgress counts done/total/pct and never returns NaN for an empty list', () => {
    expect(listProgress(list({ items: [] }))).toEqual({ total: 0, done: 0, open: 0, pct: 0 });
    expect(
      listProgress(
        list({
          items: [
            { id: 'a', title: 'a', completed: true },
            { id: 'b', title: 'b', completed: false },
            { id: 'c', title: 'c', completed: true },
            { id: 'd', title: 'd', completed: false },
          ],
        })
      )
    ).toEqual({ total: 4, done: 2, open: 2, pct: 50 });
  });

  describe('isListDue', () => {
    const today = '2026-06-17';
    it('classifies one-off due-states relative to today', () => {
      expect(isListDue(list({ dueDate: '2026-06-10' }), today)).toBe('overdue');
      expect(isListDue(list({ dueDate: '2026-06-17' }), today)).toBe('today');
      expect(isListDue(list({ dueDate: '2026-06-25' }), today)).toBeNull(); // future
      expect(isListDue(list({ dueDate: undefined }), today)).toBe('noDue');
    });
    const open = [{ id: 'i1', title: 'a', completed: false }];
    it('is due today on the day a repeating list reset, otherwise null (never overdue or noDue)', () => {
      const rec = (lastResetDate?: string) =>
        list({ lifecycle: 'recurring', frequency: 'daily', lastResetDate, items: open });
      expect(isListDue(rec(today), today)).toBe('today');
      expect(isListDue(rec('2026-06-16'), today)).toBeNull();
      expect(isListDue(rec(undefined), today)).toBeNull();
      expect(isDueSoon(rec(today), today)).toBe(true);
      expect(isDueSoon(rec('2026-06-16'), today)).toBe(false);
    });
    it('a finished round is off the plate: reset today but every item ticked (or no items) is null', () => {
      const rec = (items: FamilyList['items']) =>
        list({ lifecycle: 'recurring', frequency: 'daily', lastResetDate: today, items });
      expect(isListDue(rec([{ id: 'i1', title: 'a', completed: true }]), today)).toBeNull();
      expect(isListDue(rec([]), today)).toBeNull();
      expect(isDueSoon(rec([]), today)).toBe(false);
    });
    it('slices a full ISO lastResetDate to its date part', () => {
      const l = list({
        lifecycle: 'recurring',
        frequency: 'daily',
        lastResetDate: '2026-06-17T08:30:00.000Z',
        items: open,
      });
      expect(isListDue(l, today)).toBe('today');
    });
  });

  describe('listProgress.open', () => {
    it('is total minus done, and 0 for an empty list', () => {
      const items = [
        { id: 'a', title: 'a', completed: true },
        { id: 'b', title: 'b', completed: false },
        { id: 'c', title: 'c', completed: false },
      ];
      expect(listProgress(list({ items })).open).toBe(2);
      expect(listProgress(list({ items: [] })).open).toBe(0);
    });
  });

  describe('nextListResetOnOrAfter', () => {
    // 2026-06-01 is a Monday; every-2-days resets fall on the 1st, 3rd, 5th ...
    const rec = (over: Partial<FamilyList> = {}) =>
      list({
        lifecycle: 'recurring',
        createdAt: '2026-06-01',
        lastResetDate: '2026-06-01',
        ...over,
      });
    const every2 = { unit: 'day', interval: 2 } as const;

    it('every-2-days: the asked day when it is a scheduled day, else the next one', () => {
      expect(nextListResetOnOrAfter(rec({ cadence: every2 }), '2026-06-05')).toBe('2026-06-05');
      expect(nextListResetOnOrAfter(rec({ cadence: every2 }), '2026-06-06')).toBe('2026-06-07');
    });
    it('never answers the current cycle start again: asked on (or before) the reset day, the NEXT reset', () => {
      const daily = rec({ cadence: { unit: 'day', interval: 1 }, lastResetDate: '2026-06-05' });
      expect(nextListResetOnOrAfter(daily, '2026-06-05')).toBe('2026-06-06');
      expect(nextListResetOnOrAfter(daily, '2026-06-03')).toBe('2026-06-06');
    });
    it('legacy weekly resets on Mondays', () => {
      const weekly = rec({ frequency: 'weekly' });
      expect(nextListResetOnOrAfter(weekly, '2026-06-16')).toBe('2026-06-22'); // Tuesday
      expect(nextListResetOnOrAfter(weekly, '2026-06-15')).toBe('2026-06-15'); // Monday
    });
    it('legacy monthly resets on the 1st', () => {
      const monthly = rec({ frequency: 'monthly' });
      expect(nextListResetOnOrAfter(monthly, '2026-06-17')).toBe('2026-07-01');
      expect(nextListResetOnOrAfter(monthly, '2026-07-01')).toBe('2026-07-01');
    });
    it('is null for a one-off, no cadence, no baseline, or an unparseable anchor', () => {
      expect(
        nextListResetOnOrAfter(list({ lastResetDate: '2026-06-01' }), '2026-06-05')
      ).toBeNull();
      expect(nextListResetOnOrAfter(rec(), '2026-06-05')).toBeNull();
      expect(
        nextListResetOnOrAfter(rec({ cadence: every2, lastResetDate: undefined }), '2026-06-05')
      ).toBeNull();
      expect(
        nextListResetOnOrAfter(rec({ cadence: every2, createdAt: '' }), '2026-06-05')
      ).toBeNull();
    });
  });

  describe('computeRecurringReset', () => {
    it('never resets without a lastResetDate baseline', () => {
      const r = computeRecurringReset(
        list({ lifecycle: 'recurring', frequency: 'daily', lastResetDate: undefined }),
        '2026-06-17'
      );
      expect(r.shouldReset).toBe(false);
    });

    it('daily resets on any later calendar day and is idempotent same-day', () => {
      const l = list({ lifecycle: 'recurring', frequency: 'daily', lastResetDate: '2026-06-16' });
      expect(computeRecurringReset(l, '2026-06-17')).toEqual({
        shouldReset: true,
        nextResetDate: '2026-06-17',
      });
      // Same-day re-run → no-op (lastResetDate is now current).
      expect(computeRecurringReset({ ...l, lastResetDate: '2026-06-17' }, '2026-06-17')).toEqual({
        shouldReset: false,
        nextResetDate: '2026-06-17',
      });
    });

    it('weekly resets only when the ISO week (Mon start) rolls over', () => {
      // 2026-06-15 is a Monday; 2026-06-17 (Wed) is the same week → no reset.
      const sameWeek = list({
        lifecycle: 'recurring',
        frequency: 'weekly',
        lastResetDate: '2026-06-15',
      });
      expect(computeRecurringReset(sameWeek, '2026-06-17').shouldReset).toBe(false);
      // 2026-06-22 (next Monday) is a new week → reset.
      expect(computeRecurringReset(sameWeek, '2026-06-22').shouldReset).toBe(true);
    });

    it('monthly resets only when the calendar month changes', () => {
      const l = list({ lifecycle: 'recurring', frequency: 'monthly', lastResetDate: '2026-06-30' });
      expect(computeRecurringReset(l, '2026-06-30').shouldReset).toBe(false);
      expect(computeRecurringReset(l, '2026-07-01').shouldReset).toBe(true);
    });

    it('never resets a one-off list', () => {
      expect(
        computeRecurringReset(
          list({ lifecycle: 'oneoff', lastResetDate: '2026-06-01' }),
          '2026-07-01'
        ).shouldReset
      ).toBe(false);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// THE SHOW RULE FOR LISTS (plan 2026-11-13-lists-work-like-todos)
// ═════════════════════════════════════════════════════════════════════════════

describe('lists on the shared date rule', () => {
  // 2026-06-15 and -22 are Mondays (the legacy weekly reset day); 2026-06-17 is a Wednesday.
  const items = [
    { id: 'a', title: 'a', completed: true },
    { id: 'b', title: 'b', completed: false },
    { id: 'c', title: 'c', completed: false },
  ];
  const weekly = (over: Partial<FamilyList> = {}) =>
    list({
      lifecycle: 'recurring',
      frequency: 'weekly',
      lastResetDate: '2026-06-15',
      items,
      ...over,
    });
  const at = (ymd: string) => ({ ymd, hhmm: '12:00' });
  const t = (key: UIStringKey): string => UI_STRINGS[key];
  const subjectOf = (l: FamilyList, ymd: string): ListSubject => {
    const s = listSubject(l, ymd);
    if (!s) throw new Error(`no subject for ${l.id} on ${ymd}`);
    return s;
  };

  describe('listSubject', () => {
    it('a one-off is its due date, always the live round', () => {
      expect(listSubject(list({ dueDate: '2026-06-25T00:00:00.000Z' }), '2026-06-17')).toEqual({
        kind: 'list',
        dueDate: '2026-06-25',
        repeating: false,
        cadence: null,
        showFrom: undefined,
        showOn: undefined,
        showLeadDays: undefined,
        liveRound: true,
      });
      expect(listSubject(list(), '2026-06-17')).toMatchObject({ dueDate: undefined });
    });
    it('a repeating list on its reset day is due today, the live round', () => {
      expect(listSubject(weekly(), '2026-06-15')).toMatchObject({
        dueDate: '2026-06-15',
        repeating: true,
        liveRound: true,
        cadence: { unit: 'week', interval: 1, weekdays: [1] },
      });
    });
    it('between resets it is due on the next reset day, a later round', () => {
      expect(listSubject(weekly(), '2026-06-17')).toMatchObject({
        dueDate: '2026-06-22',
        liveRound: false,
      });
    });
    // A device in a time zone ahead reset the list just after ITS midnight and stamped its own
    // date, which is still tomorrow here. The reset has run: this is the round in progress.
    it('a cycle start stamped ahead of this device is the live round, due today', () => {
      const ahead = weekly({ frequency: 'daily', lastResetDate: '2026-06-18' });
      expect(listSubject(ahead, '2026-06-17')).toMatchObject({
        dueDate: '2026-06-17',
        liveRound: true,
      });
      expect(listPlate(ahead, at('2026-06-17'))).toBe('today');
      expect(isListDue(ahead, '2026-06-17')).toBe('today');
      expect(listRemaining(ahead, subjectOf(ahead, '2026-06-17'))).toBe(2);
      expect(listShowLabel(ahead, '2026-06-17', t)).toBeNull();
    });
    // No time zone is two days ahead: a start that far out is a bad stamp, not the live round.
    it('a cycle start more than a day ahead is not the live round: it waits for its next reset', () => {
      const far = weekly({ frequency: 'daily', lastResetDate: '2026-06-19' });
      expect(listSubject(far, '2026-06-17')).toMatchObject({
        dueDate: '2026-06-20',
        liveRound: false,
      });
      expect(listPlate(far, at('2026-06-17'))).toBe('waiting');
    });
    it('a repeating list with no resolvable reset day has no subject (it reads as waiting)', () => {
      const noRule = weekly({ frequency: undefined, lastResetDate: '2026-06-10' });
      const noBaseline = weekly({ lastResetDate: undefined });
      expect(listSubject(noRule, '2026-06-17')).toBeNull();
      expect(listSubject(noBaseline, '2026-06-17')).toBeNull();
      expect(listPlate(noRule, at('2026-06-17'))).toBe('waiting');
    });
    it('the lead clamp reads the resolved cadence: frequency weekly with no cadence clamps to 6', () => {
      const l = weekly({ showLeadDays: 20 });
      const s = subjectOf(l, '2026-06-17');
      expect(showRuleOf(s)).toEqual({ kind: 'lead', days: 6 });
      expect(invalidShowRule({ kind: 'lead', days: 7 }, true, s.cadence)).toBe('invalid-lead');
      expect(invalidShowRule({ kind: 'lead', days: 6 }, true, s.cadence)).toBeNull();
    });
  });

  describe('listPlate', () => {
    it('a one-off with a due date waits for it by default, and shows from then on', () => {
      const l = list({ dueDate: '2026-06-25' });
      expect(listPlate(l, at('2026-06-17'))).toBe('waiting');
      expect(listPlate(l, at('2026-06-25'))).toBe('today');
      expect(listPlate(l, at('2026-06-26'))).toBe('overdue');
      expect(listPlate(list({ dueDate: '2026-06-25', showOn: 'now' }), at('2026-06-17'))).toBe(
        'upcoming'
      );
      expect(
        listPlate(list({ dueDate: '2026-06-25', showFrom: '2026-06-20' }), at('2026-06-20'))
      ).toBe('upcoming');
      expect(listPlate(list(), at('2026-06-17'))).toBe('undated');
    });
    it('a repeating list is never overdue, whatever the cadence, baseline or day', () => {
      const lists = [
        weekly(),
        weekly({ lastResetDate: '2026-06-01' }), // a reset day missed while the app was closed
        weekly({ frequency: 'daily' }),
        weekly({ frequency: 'monthly', lastResetDate: '2026-06-01' }),
        weekly({ showOn: 'now' }),
        weekly({ showLeadDays: 3 }),
      ];
      for (const l of lists) {
        for (let d = '2026-06-15'; d <= '2026-07-20'; d = addDaysYmd(d, 1)) {
          expect(listPlate(l, at(d)), `${l.frequency} ${d}`).not.toBe('overdue');
        }
      }
    });
    it('a weekly list shows on its reset day by default; Every Day and Days Before widen it', () => {
      expect(listPlate(weekly(), at('2026-06-15'))).toBe('today');
      expect(listPlate(weekly(), at('2026-06-17'))).toBe('waiting');
      expect(listPlate(weekly({ showOn: 'now' }), at('2026-06-17'))).toBe('upcoming');
      expect(listPlate(weekly({ showLeadDays: 3 }), at('2026-06-18'))).toBe('waiting');
      expect(listPlate(weekly({ showLeadDays: 3 }), at('2026-06-19'))).toBe('upcoming');
    });
  });

  describe('listRemaining (the one count the briefing and the widget share)', () => {
    it.each<[string, FamilyList, string, number]>([
      ['one-off list: open items', list({ items, dueDate: '2026-06-17' }), '2026-06-17', 2],
      ['repeating, on its real reset day: open items', weekly(), '2026-06-15', 2],
      [
        'repeating, Every Day, between resets: the round in progress',
        weekly({ showOn: 'now' }),
        '2026-06-17',
        2,
      ],
      [
        'repeating, shown early by Days Before: all items',
        weekly({ showLeadDays: 3 }),
        '2026-06-19',
        3,
      ],
      [
        'repeating, a projected day that is a future reset day: all items',
        weekly(),
        '2026-06-22',
        3,
      ],
      [
        'repeating, Every Day, on the next reset day: all items',
        weekly({ showOn: 'now' }),
        '2026-06-22',
        3,
      ],
      [
        'repeating, Every Day, a projected day after the next reset: all items',
        weekly({ showOn: 'now' }),
        '2026-06-23',
        3,
      ],
    ])('%s', (_, l, ymd, count) => {
      expect(listRemaining(l, subjectOf(l, ymd))).toBe(count);
    });
  });

  describe('listShowLabel (only while the list is waiting to show)', () => {
    const today = '2026-06-17';
    it('a one-off due later carries "on the due date", or its show-from date', () => {
      expect(listShowLabel(list({ dueDate: '2026-06-25' }), today, t)).toBe(t('todo.show.tag.due'));
      expect(listShowLabel(list({ dueDate: '2026-06-25', showFrom: '2026-06-20' }), today, t)).toBe(
        fillTemplate(t('todo.show.tag.from'), { date: formatNookDate('2026-06-20') })
      );
    });
    it('null once it shows: due today, right away, a show-from reached, or undated', () => {
      expect(listShowLabel(list({ dueDate: today }), today, t)).toBeNull();
      expect(listShowLabel(list({ dueDate: '2026-06-25', showOn: 'now' }), today, t)).toBeNull();
      expect(listShowLabel(list({ dueDate: '2026-06-25', showFrom: today }), today, t)).toBeNull();
      expect(listShowLabel(list(), today, t)).toBeNull();
    });
    // A repeating list has no due date in its UI, so its tag names the real day it next shows.
    it('a repeating list names the day it next shows: its next reset, less any lead', () => {
      const from = (ymd: string) =>
        fillTemplate(t('todo.show.tag.from'), { date: formatNookDate(ymd) });
      expect(listShowLabel(weekly(), today, t)).toBe(from('2026-06-22'));
      expect(listShowLabel(weekly(), '2026-06-15', t)).toBeNull();
      expect(listShowLabel(weekly({ showLeadDays: 3 }), today, t)).toBe(from('2026-06-19'));
      expect(listShowLabel(weekly({ showOn: 'now' }), today, t)).toBeNull();
      expect(listShowLabel(weekly({ lastResetDate: undefined }), today, t)).toBeNull();
    });
  });

  describe('isListDue is the plate, mapped', () => {
    it('a future one-off is null whatever its rule; a waiting or early repeating list is null', () => {
      const today = '2026-06-17';
      expect(isListDue(list({ dueDate: '2026-06-25', showOn: 'now' }), today)).toBeNull();
      expect(isListDue(list({ dueDate: '2026-06-25', showFrom: '2026-06-10' }), today)).toBeNull();
      expect(isListDue(weekly({ showOn: 'now' }), today)).toBeNull();
      expect(isListDue(weekly({ showLeadDays: 6 }), today)).toBeNull();
      expect(isListDue(weekly(), '2026-06-15')).toBe('today');
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// LEGACY RESET PARITY (#70) — the engine must reproduce the old rule exactly
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The pre-#70 reset rule, kept here verbatim as the PARITY ORACLE. It used to
 * live in `listLifecycle.ts`; the engine replaced it, and this is what proves
 * the replacement is faithful. Do not "simplify" these — they are a fixture.
 */
function legacyMondayOf(ymd: string): string {
  const d = new Date(`${ymd.slice(0, 10)}T00:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
function legacyShouldReset(freq: 'daily' | 'weekly' | 'monthly', last: string, today: string) {
  if (freq === 'daily') return today > last;
  if (freq === 'weekly') return legacyMondayOf(today) > legacyMondayOf(last);
  return today.slice(0, 7) > last.slice(0, 7);
}

function recurringList(over: Partial<FamilyList>): FamilyList {
  return {
    id: 'l1',
    title: 'Chores',
    emoji: '🧹',
    category: 'chores',
    ownerId: 'm1',
    items: [],
    lifecycle: 'recurring',
    completed: false,
    createdBy: 'm1',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...over,
  } as FamilyList;
}

describe('list reset parity — engine reproduces the legacy boundaries', () => {
  const freqs = ['daily', 'weekly', 'monthly'] as const;
  // A month of consecutive days crossing a month boundary, week boundaries and
  // a weekend — every reset boundary the legacy rule could produce.
  const days: string[] = [];
  for (let d = new Date('2026-08-20T00:00:00'); d <= new Date('2026-09-10T00:00:00');) {
    days.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86400000);
  }

  it.each(freqs)('%s: every (lastReset, today) pair matches the legacy rule', (frequency) => {
    for (const last of days) {
      for (const today of days) {
        if (today < last) continue;
        const list = recurringList({ frequency, lastResetDate: last, createdAt: '2026-08-01' });
        expect({
          frequency,
          last,
          today,
          reset: computeRecurringReset(list, today).shouldReset,
        }).toEqual({ frequency, last, today, reset: legacyShouldReset(frequency, last, today) });
      }
    }
  });

  it('weekly is anchored to MONDAY, not the list creation weekday', () => {
    // The discriminating fixture: created on a THURSDAY, last reset FRIDAY,
    // checked the following MONDAY. This fails if someone maps weekly to
    // `weekdays: [createdAt.getDay()]` instead of Monday.
    const list = recurringList({
      frequency: 'weekly',
      createdAt: '2026-08-20', // Thursday
      lastResetDate: '2026-08-21', // Friday
    });
    expect(computeRecurringReset(list, '2026-08-24').shouldReset).toBe(true); // Monday
    expect(computeRecurringReset(list, '2026-08-23').shouldReset).toBe(false); // Sunday
  });

  it('a list with no lastResetDate never resets', () => {
    const list = recurringList({ frequency: 'daily', lastResetDate: undefined });
    expect(computeRecurringReset(list, '2026-09-01').shouldReset).toBe(false);
  });

  it('a list with neither cadence nor frequency never resets', () => {
    const list = recurringList({ frequency: undefined, lastResetDate: '2026-08-01' });
    expect(computeRecurringReset(list, '2026-09-01').shouldReset).toBe(false);
  });

  it('an every-2-weeks cadence does NOT drift when a reset day is missed', () => {
    // Anchor and cursor are separate parameters precisely for this: anchoring on
    // `lastResetDate` would push the next reset two weeks past the missed day.
    const list = recurringList({
      cadence: { unit: 'week', interval: 2, weekdays: [1] },
      createdAt: '2026-08-03', // Monday
      lastResetDate: '2026-08-17', // Monday, on-cycle
    });
    // Next on-cycle Monday is 31 Aug. The family doesn't open the app until 2 Sep.
    expect(computeRecurringReset(list, '2026-08-24').shouldReset).toBe(false); // off-cycle week
    expect(computeRecurringReset(list, '2026-08-31').shouldReset).toBe(true);
    expect(computeRecurringReset(list, '2026-09-02').shouldReset).toBe(true); // still due, not skipped
  });
});
