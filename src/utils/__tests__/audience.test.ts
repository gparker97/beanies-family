import { describe, it, expect } from 'vitest';
import { classifyAudience, classifyOwnerAudience, isDutyDone } from '@/utils/audience';
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
