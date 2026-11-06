import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolve_ } from 'node:path';
import {
  classifyAudience,
  classifyListAudience,
  classifyOwnerAudience,
  classifyTodoAudience,
  gateTodoAudience,
  isChildOnly,
  ownerItemSurfaces,
  isDutyDone,
  type BriefingAudience,
} from '@/utils/audience';
import type { FamilyList, FamilyMember, TodoItem } from '@/types/models';

function member(
  id: string,
  ageGroup: 'adult' | 'child',
  extra: Partial<FamilyMember> = {}
): FamilyMember {
  return {
    id,
    name: id,
    ageGroup,
    role: 'member',
    color: '#000',
    requiresPassword: false,
    createdAt: '',
    updatedAt: '',
    ...extra,
  } as FamilyMember;
}

const adult = member('a', 'adult');
const adult2 = member('a2', 'adult');
const kid = member('k', 'child');
const pet = member('p', 'adult', { isPet: true });
const all = [adult, adult2, kid, pet];
const resolve = (id: string) => all.find((m) => m.id === id);

describe('classifyAudience', () => {
  it('directly assigned → assignee', () => {
    expect(classifyAudience(['a'], adult, resolve).kind).toBe('assignee');
  });
  it('owned by another adult → hidden for a non-assignee', () => {
    expect(classifyAudience(['a2'], adult, resolve).kind).toBe('hidden');
  });
  it('child-assigned (no adult) → forChild for an adult viewer', () => {
    const res = classifyAudience(['k'], adult, resolve);
    expect(res.kind).toBe('forChild');
    expect(res.kind === 'forChild' && res.childNames).toEqual(['k']);
  });
  it('child-assigned → hidden for a different child', () => {
    const kid2 = member('k2', 'child');
    expect(
      classifyAudience(['k'], kid2, (id) => [...all, kid2].find((m) => m.id === id)).kind
    ).toBe('hidden');
  });
  it('unassigned / all-stale ids → unassigned for a non-pet', () => {
    expect(classifyAudience([], adult, resolve).kind).toBe('unassigned');
    expect(classifyAudience(['ghost'], adult, resolve).kind).toBe('unassigned');
  });
  it('pet viewer never gets an unassigned item', () => {
    expect(classifyAudience([], pet, resolve).kind).toBe('hidden');
  });
});

describe('isDutyDone', () => {
  it('true when a completion exists for the date', () => {
    expect(
      isDutyDone([{ date: '2026-05-27', completedBy: 'a', completedAt: '' }], '2026-05-27')
    ).toBe(true);
  });
  it('false when none / undefined', () => {
    expect(
      isDutyDone([{ date: '2026-05-26', completedBy: 'a', completedAt: '' }], '2026-05-27')
    ).toBe(false);
    expect(isDutyDone(undefined, '2026-05-27')).toBe(false);
  });
});

describe('classifyOwnerAudience (single-owner, for Beanie Lists)', () => {
  it('you own it → assignee', () => {
    expect(classifyOwnerAudience('a', adult, resolve).kind).toBe('assignee');
  });
  it('an adult owns it → hidden for another adult', () => {
    expect(classifyOwnerAudience('a2', adult, resolve).kind).toBe('hidden');
  });
  it('a child owns it → forChild for an adult viewer (framed by the child)', () => {
    const res = classifyOwnerAudience('k', adult, resolve);
    expect(res.kind).toBe('forChild');
    expect(res.kind === 'forChild' && res.childNames).toEqual(['k']);
  });
  it('a child owns it → hidden for a different child', () => {
    const kid2 = member('k2', 'child');
    expect(
      classifyOwnerAudience('k', kid2, (id) => [...all, kid2].find((m) => m.id === id)).kind
    ).toBe('hidden');
  });
  it('unowned → unassigned for a non-pet; hidden for a pet', () => {
    expect(classifyOwnerAudience(undefined, adult, resolve).kind).toBe('unassigned');
    expect(classifyOwnerAudience(null, pet, resolve).kind).toBe('hidden');
  });
});

describe('ownerItemSurfaces — one rule for all three list surfaces', () => {
  // The daily briefing, the notifications drawer and the OS scheduler each answer
  // "should this list reach this person?". A review caught them giving three
  // different answers, so the rule was extracted here. These assertions exist so
  // it stays extracted.
  const adult = { id: 'a', name: 'Adult', role: 'owner' } as FamilyMember;
  const kid = { id: 'k', name: 'Joey' } as FamilyMember;
  const resolve = (id: string) => (id === 'a' ? adult : id === 'k' ? kid : undefined);

  it('surfaces a list you own', () => {
    expect(ownerItemSurfaces(classifyOwnerAudience('a', adult, resolve))).toBe(true);
  });

  it("surfaces a child's list to an adult", () => {
    expect(ownerItemSurfaces(classifyOwnerAudience('k', adult, resolve))).toBe(true);
  });

  it('🔴 does NOT surface a list owned by nobody', () => {
    // The whole reason the predicate exists. `classifyOwnerAudience` maps an empty
    // or unresolvable ownerId to 'unassigned', NOT 'hidden' — so a `!== 'hidden'`
    // test puts a list owned by nobody on every device in the house, and
    // `deleteMember` does not cascade to lists, so that state is permanent.
    expect(ownerItemSurfaces(classifyOwnerAudience('', adult, resolve))).toBe(false);
    expect(ownerItemSurfaces(classifyOwnerAudience('ghost', adult, resolve))).toBe(false);
    expect(ownerItemSurfaces(classifyOwnerAudience(undefined, adult, resolve))).toBe(false);
  });

  it("does NOT surface another adult's list", () => {
    const other = { id: 'o', name: 'Other', role: 'owner' } as FamilyMember;
    const r = (id: string) => (id === 'o' ? other : id === 'a' ? adult : undefined);
    expect(ownerItemSurfaces(classifyOwnerAudience('o', adult, r))).toBe(false);
  });

  it('🔴 is the predicate ALL THREE list surfaces actually call', () => {
    // Source-level on purpose: the drift this prevents is three files each making
    // a defensible-looking local choice, which no single unit test can see.
    const read = (rel: string) => readFileSync(resolve_(process.cwd(), 'src', rel), 'utf-8');
    for (const f of [
      'composables/useCriticalItems.ts', // the daily briefing
      'utils/notifications.ts', // the notifications drawer
      'composables/useScheduledReminders.ts', // the OS scheduler
      'utils/widgetSnapshot.ts', // the home-screen widget
    ]) {
      expect(read(f)).toContain('ownerItemSurfaces(');
    }
  });

  it('🔴 every to-do and list consumer applies the routine gate through the one entry point', () => {
    // Same reasoning: a consumer that went back to the bare classifier would put a child's
    // on-track routine back on every parent's plate, and no unit test of this file would see it.
    const read = (rel: string) => readFileSync(resolve_(process.cwd(), 'src', rel), 'utf-8');
    const consumers = [
      'composables/useCriticalItems.ts',
      'utils/notifications.ts',
      'composables/useScheduledReminders.ts',
      'utils/widgetSnapshot.ts',
    ];
    for (const f of consumers) {
      const src = read(f);
      expect(
        src.includes('classifyTodoAudience(') || src.includes('gateTodoAudience('),
        `${f} gates its to-dos`
      ).toBe(true);
    }
    for (const f of consumers) {
      expect(read(f), `${f} classifies lists through classifyListAudience`).toContain(
        'classifyListAudience('
      );
    }
  });
});

// ── The routine rule (greg, 2026-11-06) ──────────────────────────────────────

const DAILY = { unit: 'day', interval: 1, end: { kind: 'never' } } as const;
const repeat = { rule: DAILY, anchor: '2026-11-01' } as TodoItem['repeat'];

describe('gateTodoAudience — the routine matrix', () => {
  const forChild: BriefingAudience = { kind: 'forChild', childNames: ['k'] };

  it.each([
    // routine, missed, notifyParents → hidden?
    [false, false, false, false],
    [false, true, false, false],
    [false, false, true, false],
    [true, false, false, true],
    [true, true, false, false],
    [true, false, true, false],
    [true, true, true, false],
  ])(
    'forChild × routine=%s × missed=%s × notifyParents=%s → hidden=%s',
    (routine, missed, notifyParents, hidden) => {
      const todo = { repeat: routine ? repeat : undefined, notifyParents };
      const res = gateTodoAudience(forChild, todo, missed);
      if (hidden) expect(res).toEqual({ kind: 'hidden' });
      else expect(res).toBe(forChild); // the SAME object, so callers keep reading it
    }
  );

  it.each<BriefingAudience>([{ kind: 'assignee' }, { kind: 'unassigned' }, { kind: 'hidden' }])(
    'leaves a non-forChild audience ($kind) untouched',
    (audience) => {
      expect(gateTodoAudience(audience, { repeat }, false)).toBe(audience);
    }
  );

  it('reads the flag strictly: only the literal true opts in', () => {
    const malformed = { repeat, notifyParents: 'yes' as unknown as boolean };
    expect(gateTodoAudience({ kind: 'forChild', childNames: ['k'] }, malformed, false).kind).toBe(
      'hidden'
    );
  });

  it('a malformed repeat is not a routine', () => {
    const broken = {
      repeat: { rule: { unit: 'day' }, anchor: 'x' } as unknown as TodoItem['repeat'],
    };
    expect(gateTodoAudience({ kind: 'forChild', childNames: ['k'] }, broken, false).kind).toBe(
      'forChild'
    );
  });
});

describe('classifyTodoAudience', () => {
  const kid2 = member('k2', 'child');
  const r = (id: string) => [...all, kid2].find((m) => m.id === id);
  const routine = (extra: Partial<TodoItem> = {}) => ({ assigneeIds: ['k'], repeat, ...extra });

  it("a child's repeating to-do is hidden for an adult while on track", () => {
    expect(classifyTodoAudience(routine(), adult, r, false).kind).toBe('hidden');
  });
  it('…and visible (forChild) once missed', () => {
    const res = classifyTodoAudience(routine(), adult, r, true);
    expect(res).toEqual({ kind: 'forChild', childNames: ['k'] });
  });
  it('…and visible with notifyParents', () => {
    expect(classifyTodoAudience(routine({ notifyParents: true }), adult, r, false).kind).toBe(
      'forChild'
    );
  });
  it("the child's own view is unchanged", () => {
    expect(classifyTodoAudience(routine(), kid, r, false).kind).toBe('assignee');
  });
  it('a sibling stays hidden', () => {
    expect(classifyTodoAudience(routine({ notifyParents: true }), kid2, r, true).kind).toBe(
      'hidden'
    );
  });
  it("a child's one-off to-do is unchanged (forChild)", () => {
    expect(classifyTodoAudience({ assigneeIds: ['k'] }, adult, r, false).kind).toBe('forChild');
  });
  it('reads the legacy single assigneeId', () => {
    expect(classifyTodoAudience({ assigneeId: 'k', repeat }, adult, r, false).kind).toBe('hidden');
    expect(classifyTodoAudience({ assigneeId: 'k', repeat }, kid, r, false).kind).toBe('assignee');
  });
  it('an unassigned repeating to-do is unchanged', () => {
    expect(classifyTodoAudience({ repeat }, adult, r, false).kind).toBe('unassigned');
  });
});

describe('classifyListAudience', () => {
  const list = (
    extra: Partial<FamilyList> = {}
  ): Pick<FamilyList, 'ownerId' | 'lifecycle' | 'notifyParents'> => ({
    ownerId: 'k',
    lifecycle: 'recurring',
    ...extra,
  });

  it("a child's recurring list is hidden for an adult", () => {
    expect(classifyListAudience(list(), adult, resolve, false).kind).toBe('hidden');
  });
  it('…visible with notifyParents, or when missed', () => {
    expect(classifyListAudience(list({ notifyParents: true }), adult, resolve, false).kind).toBe(
      'forChild'
    );
    expect(classifyListAudience(list(), adult, resolve, true).kind).toBe('forChild');
  });
  it("a child's one-off list is unchanged", () => {
    expect(classifyListAudience(list({ lifecycle: 'oneoff' }), adult, resolve, false).kind).toBe(
      'forChild'
    );
  });
  it("the child's own recurring list is still theirs", () => {
    expect(classifyListAudience(list(), kid, resolve, false).kind).toBe('assignee');
  });
  it('an unowned list stays unassigned (and so does not surface)', () => {
    const res = classifyListAudience(list({ ownerId: '' }), adult, resolve, false);
    expect(res.kind).toBe('unassigned');
    expect(ownerItemSurfaces(res)).toBe(false);
  });
});

describe('isChildOnly', () => {
  it('empty / stale ids → false', () => {
    expect(isChildOnly([], resolve)).toBe(false);
    expect(isChildOnly(['ghost'], resolve)).toBe(false);
  });
  it('pet-only → false', () => {
    expect(isChildOnly(['p'], resolve)).toBe(false);
  });
  it('an adult among the ids → false', () => {
    expect(isChildOnly(['a', 'k'], resolve)).toBe(false);
  });
  it('child-only (stale ids and pets alongside do not matter) → true', () => {
    expect(isChildOnly(['k'], resolve)).toBe(true);
    expect(isChildOnly(['k', 'ghost', 'p'], resolve)).toBe(true);
  });

  it('🔴 agrees with classifyAudience forChild for an adult viewer not among the ids', () => {
    // The two share helpers; this locks that they keep answering the same question.
    const viewer = member('v', 'adult');
    const kid2 = member('k2', 'child');
    const pool = [adult, kid, kid2, pet, viewer];
    const r = (id: string) => pool.find((m) => m.id === id);
    const atoms = ['a', 'k', 'k2', 'p', 'ghost'];
    const subsets: string[][] = [];
    for (let mask = 0; mask < 1 << atoms.length; mask++) {
      subsets.push(atoms.filter((_, i) => mask & (1 << i)));
    }
    for (const ids of subsets) {
      expect(isChildOnly(ids, r), ids.join(',')).toBe(
        classifyAudience(ids, viewer, r).kind === 'forChild'
      );
    }
  });
});
