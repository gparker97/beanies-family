import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolve_ } from 'node:path';
import {
  classifyAudience,
  classifyOwnerAudience,
  ownerItemSurfaces,
  isDutyDone,
} from '@/utils/audience';
import type { FamilyMember } from '@/types/models';

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
    ]) {
      expect(read(f)).toContain('ownerItemSurfaces(');
    }
  });
});
