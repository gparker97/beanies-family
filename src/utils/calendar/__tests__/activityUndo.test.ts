import { describe, it, expect } from 'vitest';
import type { FamilyActivity } from '@/types/models';
import {
  MOVE_KEYS,
  captureBefore,
  undoRecipeFor,
  type ScopedSaveOutcome,
} from '@/utils/calendar/activityUndo';

function makeActivity(overrides: Partial<FamilyActivity> = {}): FamilyActivity {
  return {
    id: 'tpl',
    title: 'Piano',
    date: '2026-09-02',
    startTime: '16:00',
    endTime: '17:00',
    recurrence: 'weekly',
    rule: { unit: 'week', interval: 1, weekdays: [3], end: { kind: 'never' } },
    assigneeIds: ['m1'],
    assigneeId: 'm1',
    category: 'lesson',
    feeSchedule: 'none',
    reminderMinutes: 0,
    isActive: true,
    createdBy: 'm0',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  } as FamilyActivity;
}

const saved = (
  scope: Extract<ScopedSaveOutcome, { kind: 'saved' }>['scope'],
  reapedCount = 0,
  writtenId = 'w1'
): Extract<ScopedSaveOutcome, { kind: 'saved' }> => ({
  kind: 'saved',
  scope,
  writtenId,
  reapedCount,
});

describe('captureBefore', () => {
  it('captures every move key, with explicit undefined for absent ones', () => {
    const before = captureBefore(makeActivity(), MOVE_KEYS);
    expect(Object.keys(before).sort()).toEqual([...MOVE_KEYS].sort());
    expect(before).toMatchObject({ date: '2026-09-02', startTime: '16:00', endTime: '17:00' });
    expect('endDate' in before).toBe(true);
    expect(before.endDate).toBeUndefined();
    expect('originalOccurrenceDate' in before).toBe(true);
    expect('daysOfWeek' in before).toBe(true);
  });

  it('detaches arrays and the rule from the live record', () => {
    const live = makeActivity();
    const before = captureBefore(live, MOVE_KEYS);
    live.assigneeIds!.push('m2');
    live.rule!.weekdays = [4];
    expect(before.assigneeIds).toEqual(['m1']);
    expect(before.rule).toEqual({
      unit: 'week',
      interval: 1,
      weekdays: [3],
      end: { kind: 'never' },
    });
  });

  it('captures only the keys asked for', () => {
    expect(captureBefore(makeActivity(), ['date', 'endDate'])).toEqual({
      date: '2026-09-02',
      endDate: undefined,
    });
  });

  it('lists the keys a drop can change', () => {
    expect(MOVE_KEYS).toEqual([
      'date',
      'endDate',
      'startTime',
      'endTime',
      'assigneeIds',
      'assigneeId',
      'recurrence',
      'rule',
      'daysOfWeek',
      'originalOccurrenceDate',
    ]);
  });
});

describe('undoRecipeFor', () => {
  const beforeTemplate = captureBefore(makeActivity(), MOVE_KEYS);
  const beforeChild = captureBefore(
    makeActivity({ id: 'child', parentActivityId: 'tpl', recurrence: 'none', rule: undefined }),
    MOVE_KEYS
  );

  it('this-only on a new override child → remove it', () => {
    expect(undoRecipeFor(saved('this-only', 0, 'child-new'), beforeTemplate, null)).toEqual({
      kind: 'remove-override',
      childId: 'child-new',
    });
  });

  it('this-only on a reused child (the concurrent-child race) → restore it', () => {
    expect(undoRecipeFor(saved('this-only', 0, 'child'), beforeTemplate, beforeChild)).toEqual({
      kind: 'restore',
      id: 'child',
      before: beforeChild,
    });
  });

  it('all with nothing reaped → restore the template', () => {
    expect(undoRecipeFor(saved('all', 0, 'tpl'), beforeTemplate, null)).toEqual({
      kind: 'restore',
      id: 'tpl',
      before: beforeTemplate,
    });
  });

  it('all whose reap deleted a child → no Undo', () => {
    expect(undoRecipeFor(saved('all', 2, 'tpl'), beforeTemplate, null)).toBeNull();
  });

  it('this-and-future → no Undo', () => {
    expect(
      undoRecipeFor(saved('this-and-future', 0, 'split'), beforeTemplate, beforeChild)
    ).toBeNull();
  });
});
