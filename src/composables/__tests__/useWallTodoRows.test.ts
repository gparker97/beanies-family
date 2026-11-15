/**
 * useWallTodoRows: how a to-do row reads on a mixed-owner list (the to-do sheet and the Lists
 * board's to-dos card). The chip says how late, or by when; the faces say whose, with nobody
 * for unclaimed work so the row shows "?".
 */
import { describe, expect, it, vi } from 'vitest';
import { useWallTodoRows } from '@/composables/useWallTodoRows';
import { UNASSIGNED } from '@/utils/wallJobs';
import type { FamilyMember } from '@/types/models';
import type { WallJob } from '@/types/wall';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => `${key}|{n}|{time}` }),
}));

const members: FamilyMember[] = [
  { id: 'm1', name: 'Leo' } as FamilyMember,
  { id: 'm2', name: 'Milo' } as FamilyMember,
];
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ members }),
}));

function todo(over: Partial<WallJob> = {}): WallJob {
  return {
    key: 'todo:t1:m1',
    title: 'bins out',
    done: false,
    ownerId: 'm1',
    source: 'todo',
    todoId: 't1',
    bucket: 'today',
    ...over,
  };
}

describe('todoNote', () => {
  const { todoNote } = useWallTodoRows();

  it('says how late an overdue to-do is: yesterday for one day, a count for more', () => {
    expect(todoNote(todo({ bucket: 'overdue', daysLate: 1 }))).toEqual({
      text: 'date.yesterday|{n}|{time}',
      tone: 'late',
    });
    expect(todoNote(todo({ bucket: 'overdue', daysLate: 3 }))).toEqual({
      text: 'wall.todo.daysLate|3|{time}',
      tone: 'late',
    });
  });

  it('keeps the time, in the late tone, for one late today', () => {
    expect(todoNote(todo({ bucket: 'overdue', dueTime: '09:00' }))).toEqual({
      text: 'wall.todo.byTime|{n}|09:00',
      tone: 'late',
    });
  });

  it('gives a today to-do its time, and an untimed one no chip', () => {
    expect(todoNote(todo({ dueTime: '17:00' }))).toEqual({
      text: 'wall.todo.byTime|{n}|17:00',
      tone: 'time',
    });
    expect(todoNote(todo())).toBeNull();
  });
});

describe('todoOwners', () => {
  const { todoOwners } = useWallTodoRows();

  it('names every owner of a combined row, skipping anyone the family no longer has', () => {
    const owners = todoOwners(todo({ ownerIds: ['m1', 'gone', 'm2'] }));
    expect(owners.map((m) => m.name)).toEqual(['Leo', 'Milo']);
  });

  it('gives unclaimed work nobody, so the row shows the "?" face', () => {
    expect(todoOwners(todo({ ownerId: UNASSIGNED }))).toEqual([]);
  });
});
