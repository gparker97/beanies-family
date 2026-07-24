import { describe, it, expect } from 'vitest';
import type { FamilyActivity, FamilyMember, TodoItem } from '@/types/models';
import type { NotificationOccurrence } from '@/utils/notifications';
import {
  buildHintKey,
  computeDesiredHints,
  dedupeHintsByKey,
  isHint,
  reconcileHints,
  HINT_LEAD_DAYS,
  type DesiredHint,
  type HelpfulHintsInput,
} from '@/utils/helpfulHints';

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
