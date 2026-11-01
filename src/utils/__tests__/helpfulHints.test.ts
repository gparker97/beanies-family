import { describe, it, expect } from 'vitest';
import type { FamilyActivity, FamilyMember, TodoItem } from '@/types/models';
import type { NotificationOccurrence } from '@/utils/notifications';
import {
  buildHintKey,
  computeDesiredHints,
  dedupeHintsByKey,
  isHint,
  hintEmoji,
  reconcileHints,
  HINT_LEAD_DAYS,
  UNKNOWN_HINT_EMOJI,
  type DesiredHint,
  type HelpfulHintsInput,
  pastDismissedHintKeys,
  isFreshHint,
} from '@/utils/helpfulHints';
import { UI_STRINGS } from '@/services/translation/uiStrings';
import { fillTemplate } from '@/utils/fillTemplate';

const TODAY = '2026-07-24';

// Fake i18n: encode the key + interpolated name so assertions can check both the
// right key was used and no hardcoded English leaked out of the engine.
const translate = (key: string, params?: Record<string, string>) =>
  params ? `${key}|${params.name}|${params.date}` : key;
const formatDate = (ymd: string) => ymd;

function member(over: Partial<FamilyMember>): FamilyMember {
  return {
    id: 'm',
    name: 'Member',
    ageGroup: 'adult',
    role: 'member',
    ...over,
  } as unknown as FamilyMember;
}

function activity(over: Partial<FamilyActivity>): FamilyActivity {
  return { id: 'a', title: 'Event', category: 'birthday', ...over } as unknown as FamilyActivity;
}

function occ(date: string, a: FamilyActivity): Record<string, NotificationOccurrence[]> {
  return { [date]: [{ activity: a, date }] };
}

function baseInput(over: Partial<HelpfulHintsInput> = {}): HelpfulHintsInput {
  return {
    today: TODAY,
    members: [],
    occurrences: {},
    vacations: [],
    leadDays: { ...HINT_LEAD_DAYS },
    translate,
    formatDate,
    ...over,
  };
}

describe('computeDesiredHints — birthday (−14d, adults excl. self + pets)', () => {
  const dad = member({ id: 'dad', name: 'Dad', ageGroup: 'adult' });
  const mum = member({ id: 'mum', name: 'Mum', ageGroup: 'adult' });
  const pet = member({ id: 'pet', name: 'Rex', isPet: true });

  it('fires inside the 14-day window, assigned to adults excluding the birthday person', () => {
    const kid = member({
      id: 'kid',
      name: 'Kid',
      ageGroup: 'child',
      dateOfBirth: { month: 8, day: 7 },
    }); // 14 days out
    const { hints } = computeDesiredHints(baseInput({ members: [dad, mum, pet, kid] }));
    expect(hints).toHaveLength(1);
    expect(hints[0]!.hintType).toBe('birthday-present');
    expect(hints[0]!.assigneeIds.sort()).toEqual(['dad', 'mum']);
    expect(hints[0]!.eventDate).toBe('2026-08-07');
    expect(hints[0]!.title).toContain('Kid');
  });

  it('excludes the birthday person even when they are an adult', () => {
    const adultBday = member({
      id: 'dad',
      name: 'Dad',
      ageGroup: 'adult',
      dateOfBirth: { month: 8, day: 1 },
    });
    const { hints } = computeDesiredHints(baseInput({ members: [adultBday, mum] }));
    expect(hints[0]!.assigneeIds).toEqual(['mum']); // dad excluded from his own hint
  });

  it('does not fire outside the window (15 days out)', () => {
    const kid = member({ id: 'kid', dateOfBirth: { month: 8, day: 8 } }); // 15 days
    expect(computeDesiredHints(baseInput({ members: [kid, dad] })).hints).toHaveLength(0);
  });

  it('honours a family-configured lead override (30 days fires at 15 days out)', () => {
    const kid = member({ id: 'kid', dateOfBirth: { month: 8, day: 8 } }); // 15 days out
    const leadDays = { ...HINT_LEAD_DAYS, 'birthday-present': 30 };
    expect(computeDesiredHints(baseInput({ members: [kid, dad], leadDays })).hints).toHaveLength(1);
  });

  it('skips members with no dateOfBirth and yields nothing when no eligible adults', () => {
    const lonelyKid = member({ id: 'k', ageGroup: 'child', dateOfBirth: { month: 8, day: 7 } });
    expect(computeDesiredHints(baseInput({ members: [lonelyKid] })).hints).toHaveLength(0);
  });
});

describe('computeDesiredHints — activities (Party group partition)', () => {
  const guest = member({ id: 'g', name: 'Guest' });

  it('⭐ gives a multi-day party one hint, not one per day', () => {
    const a = activity({ id: 'p-multi', category: 'birthday', assigneeIds: ['g'] });
    const { hints } = computeDesiredHints(
      baseInput({
        members: [guest],
        occurrences: {
          '2026-07-26': [{ activity: a, date: '2026-07-26', repeatStart: '2026-07-26' }],
          '2026-07-27': [{ activity: a, date: '2026-07-27', repeatStart: '2026-07-26' }],
        },
      })
    );
    expect(hints).toHaveLength(1);
  });

  it("maps 'birthday' → birthday-party-gift at −2d", () => {
    const a = activity({ id: 'p1', category: 'birthday', assigneeIds: ['g'] });
    const { hints } = computeDesiredHints(
      baseInput({ members: [guest], occurrences: occ('2026-07-26', a) })
    );
    expect(hints.map((h) => h.hintType)).toEqual(['birthday-party-gift']);
  });

  it("maps 'anniversary' → anniversary-plan at −14d (not −2d)", () => {
    const a = activity({ id: 'p2', category: 'anniversary', assigneeIds: ['g'] });
    // 10 days out: inside 14 (anniversary) — fires.
    const { hints } = computeDesiredHints(
      baseInput({ members: [guest], occurrences: occ('2026-08-03', a) })
    );
    expect(hints.map((h) => h.hintType)).toEqual(['anniversary-plan']);
  });

  it('maps other Party-group (wedding) → celebration-gift', () => {
    const a = activity({ id: 'p3', category: 'wedding', assigneeIds: ['g'] });
    const { hints } = computeDesiredHints(
      baseInput({ members: [guest], occurrences: occ('2026-07-25', a) })
    );
    expect(hints.map((h) => h.hintType)).toEqual(['celebration-gift']);
  });

  it('ignores non-Party categories and occurrences with no attendees', () => {
    const nonParty = activity({ id: 'x', category: 'soccer', assigneeIds: ['g'] });
    const noAttendees = activity({ id: 'y', category: 'wedding', assigneeIds: [] });
    const { hints } = computeDesiredHints(
      baseInput({
        members: [guest],
        occurrences: {
          '2026-07-25': [
            { activity: nonParty, date: '2026-07-25' },
            { activity: noAttendees, date: '2026-07-25' },
          ],
        },
      })
    );
    expect(hints).toHaveLength(0);
  });
});

describe('computeDesiredHints — trips', () => {
  it('fires trip-documents at −7d but not trip-packing', () => {
    const { hints } = computeDesiredHints(
      baseInput({
        vacations: [{ id: 't', name: 'Japan', startDate: '2026-07-31', assigneeIds: ['a'] }],
      })
    );
    expect(hints.map((h) => h.hintType)).toEqual(['trip-documents']);
    expect(hints[0]!.assigneeIds).toEqual(['a']);
  });

  it('fires both packing + documents at −2d', () => {
    const { hints } = computeDesiredHints(
      baseInput({
        vacations: [{ id: 't', name: 'Japan', startDate: '2026-07-26', assigneeIds: ['a'] }],
      })
    );
    expect(hints.map((h) => h.hintType).sort()).toEqual(['trip-documents', 'trip-packing']);
  });

  it('skips trips with no startDate or no travellers', () => {
    const { hints } = computeDesiredHints(
      baseInput({
        vacations: [
          { id: 't1', name: 'A', assigneeIds: ['a'] },
          { id: 't2', name: 'B', startDate: '2026-07-26', assigneeIds: [] },
        ],
      })
    );
    expect(hints).toHaveLength(0);
  });
});

describe('hintKey + malformed-record isolation', () => {
  it('hintEmoji degrades to a generic icon for a hint type this build does not know', () => {
    expect(hintEmoji('birthday-party-gift')).toBe('🎉');
    expect(hintEmoji(undefined)).toBe('');
    // A pod synced from a newer client can carry a type outside HINT_TYPE_META;
    // a bare index would throw inside a render computed and blank the surface.
    expect(hintEmoji('from-the-future' as never)).toBe(UNKNOWN_HINT_EMOJI);
  });

  it('buildHintKey is stable and locale-independent', () => {
    expect(buildHintKey('trip-packing', 't', '2026-08-01')).toBe('trip-packing:t:2026-08-01');
  });

  it('counts a malformed record as skipped without suppressing the healthy ones', () => {
    const good = member({ id: 'dad', name: 'Dad', ageGroup: 'adult' });
    // dateOfBirth accessor throws when destructured.
    const bad = {
      id: 'bad',
      name: 'Bad',
      ageGroup: 'child',
      isPet: false,
    } as unknown as FamilyMember;
    Object.defineProperty(bad, 'dateOfBirth', {
      get() {
        throw new Error('corrupt');
      },
    });
    const kid = member({ id: 'kid', ageGroup: 'child', dateOfBirth: { month: 8, day: 7 } });
    const { hints, skipped } = computeDesiredHints(baseInput({ members: [good, bad, kid] }));
    expect(skipped).toBe(1);
    expect(hints).toHaveLength(1); // kid's hint still produced
  });
});

describe('reconcileHints', () => {
  const today = TODAY;
  const desired: DesiredHint[] = [
    {
      hintType: 'trip-packing',
      hintKey: 'k1',
      title: 't',
      assigneeIds: ['a'],
      eventDate: '2026-07-26',
    },
  ];

  function hintTodo(over: Partial<TodoItem>): TodoItem {
    return {
      id: over.id ?? 'id',
      title: 't',
      completed: false,
      createdBy: 'a',
      createdAt: '2026-07-20',
      updatedAt: '2026-07-20',
      hintType: 'trip-packing',
      ...over,
    } as TodoItem;
  }

  it('creates missing hints', () => {
    const { toCreate } = reconcileHints([...desired], [], today);
    expect(toCreate).toHaveLength(1);
  });

  it('does not recreate an existing hint (same key)', () => {
    const { toCreate } = reconcileHints(
      [...desired],
      [hintTodo({ hintKey: 'k1', hintEventDate: '2026-07-26' })],
      today
    );
    expect(toCreate).toHaveLength(0);
  });

  it('removes an expired, un-acknowledged hint', () => {
    const expired = hintTodo({ hintKey: 'kx', hintEventDate: '2026-07-20' }); // event passed
    const { toRemove } = reconcileHints([...desired], [expired], today);
    expect(toRemove).toHaveLength(1);
  });

  it('removes a stale hint (no longer desired)', () => {
    const stale = hintTodo({ hintKey: 'gone', hintEventDate: '2026-09-01' });
    const { toRemove } = reconcileHints([...desired], [stale], today);
    expect(toRemove.map((t) => t.hintKey)).toEqual(['gone']);
  });

  it('never recreates a dismissed hint (it was deleted, so only the record blocks it)', () => {
    const { toCreate } = reconcileHints([...desired], [], today, new Set(['k1']));
    expect(toCreate).toHaveLength(0);
  });

  it('removes an open copy of a dismissed hint, but never a kept or completed one', () => {
    const copy = hintTodo({ id: 'c', hintKey: 'k1', hintEventDate: '2026-07-26' });
    const kept = hintTodo({
      id: 'k',
      hintKey: 'k1',
      hintEventDate: '2026-07-26',
      hintAcknowledged: true,
    });
    const { toRemove } = reconcileHints([...desired], [copy, kept], today, new Set(['k1']));
    expect(toRemove.map((t) => t.id)).toEqual(['c']);
  });

  it('never removes acknowledged or completed hints', () => {
    const kept = hintTodo({
      hintKey: 'k-ack',
      hintEventDate: '2026-07-01',
      hintAcknowledged: true,
    });
    const done = hintTodo({ hintKey: 'k-done', hintEventDate: '2026-07-01', completed: true });
    const { toRemove } = reconcileHints([...desired], [kept, done], today);
    expect(toRemove).toHaveLength(0);
  });

  it('does not regenerate a completed hint whose key is still desired (complete = keep)', () => {
    const done = hintTodo({
      id: 'done',
      hintKey: 'k1', // same key as the desired hint
      hintEventDate: '2026-07-26',
      completed: true,
    });
    const { toCreate, toRemove } = reconcileHints([...desired], [done], today);
    expect(toCreate).toHaveLength(0); // completed copy blocks regeneration
    expect(toRemove).toHaveLength(0); // and is never auto-removed
  });

  it('collapses a cross-device duplicate to the earliest, removing the later copy', () => {
    const early = hintTodo({
      id: 'early',
      hintKey: 'k1',
      hintEventDate: '2026-07-26',
      createdAt: '2026-07-20',
    });
    const late = hintTodo({
      id: 'late',
      hintKey: 'k1',
      hintEventDate: '2026-07-26',
      createdAt: '2026-07-21',
    });
    const { toRemove } = reconcileHints([...desired], [early, late], today);
    expect(toRemove.map((t) => t.id)).toEqual(['late']); // only the duplicate loser
  });
});

describe('dedupeHintsByKey + isHint', () => {
  it('keeps the earliest-created todo per hintKey', () => {
    const late = { id: 'late', hintKey: 'k', createdAt: '2026-07-22' } as unknown as TodoItem;
    const early = { id: 'early', hintKey: 'k', createdAt: '2026-07-20' } as unknown as TodoItem;
    const out = dedupeHintsByKey([late, early]);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('early');
  });

  it('isHint narrows on the hintType marker', () => {
    expect(isHint({ hintType: 'trip-packing' } as TodoItem)).toBe(true);
    expect(isHint({ title: 'manual' } as TodoItem)).toBe(false);
  });
});

describe('computeDesiredHints — Who Owns What card holders (#109)', () => {
  const dad = member({ id: 'dad', name: 'Dad', ageGroup: 'adult' });
  const mum = member({ id: 'mum', name: 'Mum', ageGroup: 'adult' });
  const kid = member({
    id: 'kid',
    name: 'Kid',
    ageGroup: 'child',
    dateOfBirth: { month: 8, day: 7 },
  }); // birthday 14 days out

  it('assigns the hint to the card holder when they are in the audience', () => {
    const result = computeDesiredHints(
      baseInput({ members: [dad, mum, kid], cardHolders: { 'birthday-present': 'mum' } })
    );
    expect(result.hints[0]!.assigneeIds).toEqual(['mum']);
    expect(result.cardHolder).toEqual({ used: 1, ineligible: 0 });
  });

  it('never assigns the birthday person their own present, even when they hold the card', () => {
    const bdayMum = member({
      id: 'mum',
      name: 'Mum',
      ageGroup: 'adult',
      dateOfBirth: { month: 8, day: 1 },
    });
    const result = computeDesiredHints(
      baseInput({ members: [dad, bdayMum], cardHolders: { 'birthday-present': 'mum' } })
    );
    expect(result.hints[0]!.assigneeIds).toEqual(['dad']); // default audience kept
    expect(result.cardHolder).toEqual({ used: 0, ineligible: 1 });
  });

  it('keeps the default audience for unmapped types and trips with an outside holder', () => {
    const trip = {
      id: 'trip',
      name: 'Beach',
      startDate: '2026-07-26',
      assigneeIds: ['dad', 'kid'],
    };
    const result = computeDesiredHints(
      baseInput({
        members: [dad, mum, kid],
        vacations: [trip],
        cardHolders: { 'trip-packing': 'dad', 'trip-documents': 'mum' },
      })
    );
    const byType = Object.fromEntries(result.hints.map((h) => [h.hintType, h.assigneeIds]));
    expect(byType['trip-packing']).toEqual(['dad']);
    expect(byType['trip-documents']).toEqual(['dad', 'kid']); // mum isn't travelling
    expect(result.cardHolder).toEqual({ used: 1, ineligible: 1 });
  });

  it('never reassigns an existing hint: keyed reconcile does not recreate it', () => {
    const { hints } = computeDesiredHints(
      baseInput({ members: [dad, mum, kid], cardHolders: { 'birthday-present': 'mum' } })
    );
    const existing = {
      id: 'h1',
      title: 't',
      completed: false,
      createdBy: 'dad',
      createdAt: '2026-07-20',
      updatedAt: '2026-07-20',
      hintType: 'birthday-present',
      hintKey: hints[0]!.hintKey,
      hintEventDate: hints[0]!.eventDate,
      assigneeIds: ['dad', 'mum'],
    } as TodoItem;
    const { toCreate, toRemove } = reconcileHints(hints, [existing], TODAY);
    expect(toCreate).toHaveLength(0);
    expect(toRemove).toHaveLength(0);
  });
});

describe('pastDismissedHintKeys', () => {
  it('returns the entries whose event date has passed; the key itself is never parsed', () => {
    const past = pastDismissedHintKeys(
      {
        'opaque-a': '2026-07-19', // past
        'opaque-b': '2026-07-24', // today: still relevant
        'opaque-c': '2026-08-01', // future
        'opaque-d': 'not-a-date', // kept, never dropped on a guess
      },
      '2026-07-24'
    );
    expect(past).toEqual(['opaque-a']);
  });

  it('is empty when nothing has passed, so nothing is written', () => {
    expect(pastDismissedHintKeys({ k: '2026-08-01' }, '2026-07-24')).toEqual([]);
    expect(pastDismissedHintKeys({}, '2026-07-24')).toEqual([]);
  });
});

describe('isFreshHint', () => {
  const base = {
    id: 'h',
    title: 't',
    completed: false,
    createdBy: 'a',
    createdAt: '',
    updatedAt: '',
  };
  it('is an open hint nobody has kept', () => {
    expect(isFreshHint({ ...base, hintType: 'trip-packing' } as TodoItem)).toBe(true);
    expect(
      isFreshHint({ ...base, hintType: 'trip-packing', hintAcknowledged: true } as TodoItem)
    ).toBe(false);
    expect(isFreshHint({ ...base, hintType: 'trip-packing', completed: true } as TodoItem)).toBe(
      false
    );
    expect(isFreshHint(base as TodoItem)).toBe(false);
  });
});

describe('computeDesiredHints — Occasions (#137)', () => {
  // A real translator, so the asserted titles read as a family would see them.
  const realTranslate = (key: string, params?: Record<string, string>) => {
    const text = (UI_STRINGS as Record<string, string>)[key] ?? key;
    return params ? fillTemplate(text, params) : text;
  };
  const dad = member({ id: 'dad', name: 'Dad', ageGroup: 'adult' });
  const mum = member({ id: 'mum', name: 'Mum', ageGroup: 'adult' });
  const kid = member({ id: 'kid', name: 'Kid', ageGroup: 'child' });
  const pet = member({ id: 'pet', name: 'Rex', isPet: true });
  const members = [dad, mum, kid, pet];
  const SEVEN_OUT = '2026-07-31';
  const MONTH_OUT = '2026-08-20'; // 27 days

  function occasionHints(
    a: FamilyActivity,
    date = SEVEN_OUT,
    over: Partial<HelpfulHintsInput> = {}
  ) {
    return computeDesiredHints(
      baseInput({ members, occurrences: occ(date, a), translate: realTranslate, ...over })
    );
  }

  it.each(['occasion_birthday', 'remembrance', 'other_occasion'] as const)(
    '%s → occasion-heads-up at −7d for the rememberers',
    (category) => {
      const a = activity({ id: 'o', title: 'Uncle Bob', category, assigneeIds: ['mum'] });
      const { hints } = occasionHints(a);
      expect(hints.map((h) => h.hintType)).toEqual(['occasion-heads-up']);
      expect(hints[0]!.assigneeIds).toEqual(['mum']);
      // 8 days out: outside the 7-day default.
      expect(occasionHints(a, '2026-08-01').hints).toHaveLength(0);
    }
  );

  it('uses the gentle title for a remembrance and the card/gift/call title otherwise', () => {
    const r = activity({ id: 'r', title: "Grandpa's day", category: 'remembrance' });
    const b = activity({ id: 'b', title: "Uncle Bob's birthday", category: 'occasion_birthday' });
    expect(occasionHints(r).hints[0]!.title).toBe(
      "Grandpa's day is on 2026-07-31. A good day to reach out."
    );
    expect(occasionHints(b).hints[0]!.title).toBe(
      "Uncle Bob's birthday is on 2026-07-31. Card, gift or a call?"
    );
  });

  it('names the milestone in the hint title when a year is set', () => {
    const b = activity({
      id: 'b',
      title: "Uncle Bob's birthday",
      category: 'occasion_birthday',
      occasionYear: 1966,
      assigneeIds: ['dad'],
    });
    expect(occasionHints(b).hints.map((h) => h.title)).toEqual([
      "Uncle Bob's birthday (turns 60) is on 2026-07-31. Card, gift or a call?",
      "Uncle Bob's birthday (turns 60) is on 2026-07-31. A big one: plan something?",
    ]);
  });

  it('adds the big-occasion hint (−30d) only for a round count with a year', () => {
    const base = { id: 'b', category: 'occasion_birthday' as const, assigneeIds: ['dad'] };
    const round = activity({ ...base, occasionYear: 1986 }); // turns 40
    const notRound = activity({ ...base, occasionYear: 1985 }); // turns 41
    const noYear = activity(base);
    expect(occasionHints(round, MONTH_OUT).hints.map((h) => h.hintType)).toEqual([
      'occasion-milestone',
    ]);
    expect(occasionHints(notRound, MONTH_OUT).hints).toHaveLength(0);
    expect(occasionHints(noYear, MONTH_OUT).hints).toHaveLength(0);
  });

  it('never gives a remembrance or other occasion the big-occasion hint', () => {
    for (const category of ['remembrance', 'other_occasion'] as const) {
      const a = activity({ id: 'x', category, occasionYear: 1976, assigneeIds: ['dad'] });
      expect(occasionHints(a).hints.map((h) => h.hintType)).toEqual(['occasion-heads-up']);
    }
  });

  it('anniversary: anniversary-plan only, plus big-occasion when round', () => {
    const a = activity({ id: 'an', category: 'anniversary', assigneeIds: ['dad'] });
    expect(occasionHints(a).hints.map((h) => h.hintType)).toEqual(['anniversary-plan']);
    const ruby = activity({ ...a, occasionYear: 1986 }); // 40th
    expect(occasionHints(ruby).hints.map((h) => h.hintType)).toEqual([
      'anniversary-plan',
      'occasion-milestone',
    ]);
    const plain = activity({ ...a, occasionYear: 1990 }); // 36th
    expect(occasionHints(plain).hints.map((h) => h.hintType)).toEqual(['anniversary-plan']);
  });

  it('never fires the Party gift hints for an occasion', () => {
    for (const category of ['occasion_birthday', 'anniversary', 'other_occasion'] as const) {
      const a = activity({ id: 'x', category, assigneeIds: ['dad'] });
      const types = occasionHints(a, '2026-07-26').hints.map((h) => h.hintType);
      expect(types).not.toContain('birthday-party-gift');
      expect(types).not.toContain('celebration-gift');
    }
  });

  it.each([
    ['nobody', []],
    ['only removed members', ['gone']],
    ['only a pet', ['pet']],
  ])('falls back to all adults when %s is remembering, and counts it', (_label, ids) => {
    const a = activity({ id: 'o', category: 'occasion_birthday', assigneeIds: ids });
    const result = occasionHints(a);
    expect(result.hints[0]!.assigneeIds.sort()).toEqual(['dad', 'mum']);
    expect(result.audienceFallback).toBe(1);
  });

  it('does not count a fallback for an occasion still outside its hint window', () => {
    const a = activity({ id: 'o', category: 'occasion_birthday', assigneeIds: [] });
    const result = occasionHints(a, '2026-08-20');
    expect(result.hints).toEqual([]);
    expect(result.audienceFallback).toBe(0);
  });

  it('does not count a fallback when someone is remembering', () => {
    const a = activity({ id: 'o', category: 'occasion_birthday', assigneeIds: ['kid'] });
    const result = occasionHints(a);
    expect(result.hints[0]!.assigneeIds).toEqual(['kid']);
    expect(result.audienceFallback).toBe(0);
  });

  it("skips an occasion birthday that duplicates a member's own birthday", () => {
    const mia = member({
      id: 'mia',
      name: 'Mia',
      ageGroup: 'child',
      dateOfBirth: { month: 7, day: 31 },
    });
    const dup = activity({
      id: 'dup',
      title: "Mia's birthday",
      category: 'occasion_birthday',
      date: '2025-07-31',
      assigneeIds: ['dad'],
    });
    const result = computeDesiredHints(
      baseInput({ members: [dad, mum, mia], occurrences: occ(SEVEN_OUT, dup) })
    );
    expect(result.hints.filter((h) => h.hintType.startsWith('occasion'))).toEqual([]);
    expect(result.reasons['duplicate-member-birthday']).toBe(1);
  });

  it('keeps an occasion birthday on the same day whose title names someone else', () => {
    const mia = member({
      id: 'mia',
      name: 'Mia',
      ageGroup: 'child',
      dateOfBirth: { month: 7, day: 31 },
    });
    const other = activity({
      id: 'o',
      title: "Amelia's birthday", // "Mia" inside a word is not Mia
      category: 'occasion_birthday',
      date: '2025-07-31',
      assigneeIds: ['dad'],
    });
    const result = computeDesiredHints(
      baseInput({ members: [dad, mia], occurrences: occ(SEVEN_OUT, other) })
    );
    // Mia's own birthday-present hint fires too; the occasion is not swallowed by it.
    expect(result.hints.map((h) => h.hintType).sort()).toEqual([
      'birthday-present',
      'occasion-heads-up',
    ]);
  });

  it('narrows to the gifts card holder only from within the rememberers', () => {
    const a = activity({ id: 'o', category: 'occasion_birthday', assigneeIds: ['dad', 'mum'] });
    const inside = occasionHints(a, SEVEN_OUT, { cardHolders: { 'occasion-heads-up': 'mum' } });
    expect(inside.hints[0]!.assigneeIds).toEqual(['mum']);
    expect(inside.cardHolder).toEqual({ used: 1, ineligible: 0 });

    const solo = activity({ ...a, assigneeIds: ['dad'] });
    const outside = occasionHints(solo, SEVEN_OUT, { cardHolders: { 'occasion-heads-up': 'mum' } });
    expect(outside.hints[0]!.assigneeIds).toEqual(['dad']);
    expect(outside.cardHolder).toEqual({ used: 0, ineligible: 1 });
  });

  it('counts a malformed occasion as skipped without stopping the run', () => {
    const bad = activity({ id: 'bad', category: 'occasion_birthday' });
    Object.defineProperty(bad, 'assigneeIds', {
      get() {
        throw new Error('corrupt');
      },
    });
    const good = activity({ id: 'good', category: 'occasion_birthday', assigneeIds: ['dad'] });
    const result = computeDesiredHints(
      baseInput({
        members,
        occurrences: {
          [SEVEN_OUT]: [
            { activity: bad, date: SEVEN_OUT },
            { activity: good, date: SEVEN_OUT },
          ],
        },
      })
    );
    expect(result.skipped).toBe(1);
    expect(result.hints.map((h) => h.hintKey)).toEqual([
      buildHintKey('occasion-heads-up', 'good', SEVEN_OUT),
    ]);
  });
});

describe('reconcileHints — a hint type this build does not know', () => {
  it('is never pruned as stale (a newer client owns it), but still expires', () => {
    const future = {
      id: 'f',
      title: 't',
      completed: false,
      createdBy: 'a',
      createdAt: '2026-07-20',
      updatedAt: '2026-07-20',
      hintType: 'from-the-future',
      hintKey: 'from-the-future:x:2026-07-30',
      hintEventDate: '2026-07-30',
    } as unknown as TodoItem;
    expect(reconcileHints([], [future], TODAY).toRemove).toEqual([]);
    const expired = { ...future, id: 'e', hintEventDate: '2026-07-01' } as TodoItem;
    expect(reconcileHints([], [expired], TODAY).toRemove).toEqual([expired]);
  });

  it('still prunes one with no event date, which expiry could never remove', () => {
    const undated = {
      id: 'u',
      title: 't',
      completed: false,
      createdBy: 'a',
      createdAt: '2026-07-20',
      updatedAt: '2026-07-20',
      hintType: 'from-the-future',
      hintKey: 'from-the-future:x',
    } as unknown as TodoItem;
    expect(reconcileHints([], [undated], TODAY).toRemove).toEqual([undated]);
  });
});
