import { describe, it, expect } from 'vitest';
import type { CalendarEventLink, FamilyActivity } from '@/types/models';
import { activityInWindow, isPushable, planReconcile } from '../reconcilePlan';
import { deterministicEventId } from '../deterministicEventId';
import { computePushHash } from '../activityToGoogleEvent';

const TODAY = '2026-06-10';

function makeActivity(overrides: Partial<FamilyActivity> = {}): FamilyActivity {
  return {
    id: 'act-1',
    title: 'Soccer',
    date: TODAY,
    recurrence: 'none',
    category: 'sports',
    feeSchedule: 'none',
    reminderMinutes: 0,
    isActive: true,
    createdBy: 'm0',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  } as FamilyActivity;
}

function linkFor(activity: FamilyActivity, connectionId = 'c1'): CalendarEventLink {
  return {
    id: `${connectionId}:${activity.id}`,
    connectionId,
    activityId: activity.id,
    googleEventId: deterministicEventId(activity.id),
    lastPushedHash: computePushHash(activity),
    lastPushedAt: '2026-06-01T00:00:00.000Z',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}

describe('activityInWindow', () => {
  it('includes today, excludes far past/future', () => {
    expect(activityInWindow(makeActivity({ date: TODAY }), TODAY)).toBe(true);
    expect(activityInWindow(makeActivity({ date: '2027-12-31' }), TODAY)).toBe(false); // >365d
    expect(activityInWindow(makeActivity({ date: '2026-04-01' }), TODAY)).toBe(false); // >30d past
  });

  it('includes an ongoing recurring activity with no end date', () => {
    expect(
      activityInWindow(makeActivity({ date: '2026-01-01', recurrence: 'weekly' }), TODAY)
    ).toBe(true);
  });

  it('excludes a recurring activity whose end date is in the past', () => {
    expect(
      activityInWindow(
        makeActivity({ date: '2026-01-01', recurrence: 'weekly', recurrenceEndDate: '2026-03-01' }),
        TODAY
      )
    ).toBe(false);
  });
});

describe('isPushable', () => {
  it('rejects inactive and override-child activities', () => {
    expect(isPushable(makeActivity(), TODAY)).toBe(true);
    expect(isPushable(makeActivity({ isActive: false }), TODAY)).toBe(false);
    expect(isPushable(makeActivity({ parentActivityId: 'parent' }), TODAY)).toBe(false);
  });
});

describe('planReconcile', () => {
  it('upserts a new activity with no existing hash', () => {
    const a = makeActivity();
    const plan = planReconcile([a], [], TODAY);
    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0].existingHash).toBeUndefined();
    expect(plan.upserts[0].eventId).toBe(deterministicEventId(a.id));
    expect(plan.deletes).toHaveLength(0);
  });

  it('marks an unchanged activity (existingHash === hash) and a changed one', () => {
    const a = makeActivity();
    const unchanged = planReconcile([a], [linkFor(a)], TODAY);
    expect(unchanged.upserts[0].existingHash).toBe(unchanged.upserts[0].hash);

    const edited = makeActivity({ title: 'New title' });
    const changed = planReconcile([edited], [linkFor(makeActivity())], TODAY);
    expect(changed.upserts[0].existingHash).not.toBe(changed.upserts[0].hash);
  });

  it('deletes a link whose activity is inactive / out-of-window / gone', () => {
    const a = makeActivity();
    // activity now inactive → not pushable → its link is a delete
    const inactivePlan = planReconcile([makeActivity({ isActive: false })], [linkFor(a)], TODAY);
    expect(inactivePlan.deletes).toHaveLength(1);
    expect(inactivePlan.upserts).toHaveLength(0);

    // activity removed entirely → orphan link → delete
    const orphanPlan = planReconcile([], [linkFor(a)], TODAY);
    expect(orphanPlan.deletes).toHaveLength(1);
  });
});
