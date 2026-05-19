import { describe, it, expect } from 'vitest';
import { classifyActivityChip, HERITAGE_ORANGE } from '@/composables/useActivityChipClass';
import type { FamilyActivity, FamilyMember } from '@/types/models';

const NEUTRAL_FALLBACK = '#6b7280';

const HUMANS: FamilyMember[] = [
  // @ts-expect-error — partial fixture sufficient for the pure classifier
  { id: 'm-greg', name: 'Greg', color: '#2C3E50', isPet: false },
  // @ts-expect-error — partial fixture
  { id: 'm-mira', name: 'Mira', color: '#7E57C2', isPet: false },
  // @ts-expect-error — partial fixture
  { id: 'm-aria', name: 'Aria', color: '#6AA84F', isPet: false },
];

function makeActivity(overrides: Partial<FamilyActivity> = {}): FamilyActivity {
  return {
    id: 'a-1',
    title: 'Activity',
    date: '2026-05-19',
    category: 'soccer',
    isAllDay: false,
    recurrence: { type: 'none' },
    feeSchedule: 'none',
    reminderMinutes: { default: 15 },
    isActive: true,
    createdBy: 'm-greg',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  } as FamilyActivity;
}

function memberById(id: string): FamilyMember | undefined {
  return HUMANS.find((m) => m.id === id);
}

function memberColor(id: string): string {
  return memberById(id)?.color ?? NEUTRAL_FALLBACK;
}

describe('classifyActivityChip', () => {
  it('classifies 0-assignee activities as "family" with all humans in the stack', () => {
    const result = classifyActivityChip(
      makeActivity({ assigneeIds: [] }),
      HUMANS,
      memberById,
      memberColor
    );
    expect(result.kind).toBe('family');
    expect(result.color).toBe(HERITAGE_ORANGE);
    expect(result.members).toEqual(HUMANS);
  });

  it('classifies single-assignee activities as "solo" with that member\'s color', () => {
    const result = classifyActivityChip(
      makeActivity({ assigneeIds: ['m-aria'] }),
      HUMANS,
      memberById,
      memberColor
    );
    expect(result.kind).toBe('solo');
    expect(result.color).toBe('#6AA84F');
    expect(result.members).toEqual([]);
  });

  it('classifies 2+ assignees as "shared" with selected members only (not all humans)', () => {
    const result = classifyActivityChip(
      makeActivity({ assigneeIds: ['m-greg', 'm-mira'] }),
      HUMANS,
      memberById,
      memberColor
    );
    expect(result.kind).toBe('shared');
    expect(result.color).toBe(HERITAGE_ORANGE);
    expect(result.members.map((m) => m.id)).toEqual(['m-greg', 'm-mira']);
  });

  it('falls back to solo + neutral color when every assignee is a deleted member', () => {
    const result = classifyActivityChip(
      makeActivity({ assigneeIds: ['m-gone-1', 'm-gone-2'] }),
      HUMANS,
      memberById,
      memberColor
    );
    expect(result.kind).toBe('solo');
    expect(result.color).toBe(NEUTRAL_FALLBACK);
    expect(result.members).toEqual([]);
  });

  it('drops deleted members from a partial-resolve list and keeps the rest as shared', () => {
    const result = classifyActivityChip(
      makeActivity({ assigneeIds: ['m-greg', 'm-deleted', 'm-aria'] }),
      HUMANS,
      memberById,
      memberColor
    );
    expect(result.kind).toBe('shared');
    expect(result.members.map((m) => m.id)).toEqual(['m-greg', 'm-aria']);
  });

  it('honours legacy assigneeId via normalizeAssignees', () => {
    // The deprecated single-assigneeId field is still typed in models.ts
    // (Activity.assigneeId is `?: UUID`), so no @ts-expect-error needed here.
    const result = classifyActivityChip(
      makeActivity({ assigneeId: 'm-mira' }),
      HUMANS,
      memberById,
      memberColor
    );
    expect(result.kind).toBe('solo');
    expect(result.color).toBe('#7E57C2');
  });
});
