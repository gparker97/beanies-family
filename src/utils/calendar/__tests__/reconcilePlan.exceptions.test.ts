import { describe, it, expect } from 'vitest';
import type { CalendarEventLink, FamilyActivity } from '@/types/models';
import { planReconcile } from '../reconcilePlan';
import { computeExceptionHash } from '../activityToGoogleEvent';

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

function exceptionLink(
  childId: string,
  masterId: string,
  occ: string,
  overrides: Partial<CalendarEventLink> = {}
): CalendarEventLink {
  return {
    id: `c1:${childId}`,
    connectionId: 'c1',
    activityId: childId,
    googleEventId: `bmaster_${occ.replace(/-/g, '')}`,
    lastPushedHash: 'old-hash',
    lastPushedAt: '2026-06-01T00:00:00.000Z',
    exceptionOf: masterId,
    exceptionOriginalYmd: occ,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

const master = makeActivity({
  id: 'master',
  recurrence: 'weekly',
  date: '2026-06-03',
  daysOfWeek: [3],
});

describe('planReconcile — per-occurrence exceptions', () => {
  it('an ACTIVE edit-one child of a synced master → one modify exceptionUpsert, no top-level upsert', () => {
    const child = makeActivity({ id: 'child', parentActivityId: 'master', date: '2026-06-17' });
    const plan = planReconcile([master, child], [], TODAY);

    expect(plan.upserts.map((u) => u.activity.id)).toEqual(['master']); // child NOT a top-level upsert
    expect(plan.exceptionUpserts).toHaveLength(1);
    const e = plan.exceptionUpserts[0]!;
    expect(e.mode).toBe('modify');
    expect(e.master.id).toBe('master');
    expect(e.occurrenceYmd).toBe('2026-06-17');
    expect(e.existingHash).toBeUndefined(); // no link yet
  });

  it('a delete-one child (isActive:false) → cancel mode', () => {
    const child = makeActivity({
      id: 'child',
      parentActivityId: 'master',
      date: '2026-06-17',
      isActive: false,
    });
    const plan = planReconcile([master, child], [], TODAY);
    expect(plan.exceptionUpserts[0]!.mode).toBe('cancel');
    expect(plan.deletes).toHaveLength(0);
  });

  it('a reschedule child → occurrence keyed by originalOccurrenceDate, not the moved date', () => {
    const child = makeActivity({
      id: 'child',
      parentActivityId: 'master',
      date: '2026-06-20', // moved to Saturday
      originalOccurrenceDate: '2026-06-17', // original Wednesday
    });
    const plan = planReconcile([master, child], [], TODAY);
    expect(plan.exceptionUpserts[0]!.occurrenceYmd).toBe('2026-06-17');
  });

  it('carries the existing link hash + instance id for idempotency', () => {
    const child = makeActivity({ id: 'child', parentActivityId: 'master', date: '2026-06-17' });
    const hash = computeExceptionHash(child, '2026-06-17', 'modify');
    const link = exceptionLink('child', 'master', '2026-06-17', {
      lastPushedHash: hash,
      googleEventId: 'stored-instance-id',
    });
    const plan = planReconcile([master, child], [link], TODAY);
    const e = plan.exceptionUpserts[0]!;
    expect(e.hash).toBe(hash); // unchanged → engine no-ops
    expect(e.existingHash).toBe(hash);
    expect(e.existingInstanceId).toBe('stored-instance-id');
  });

  it('an exception link whose child is GONE → an exceptionRestore (master still pushable)', () => {
    const link = exceptionLink('gone-child', 'master', '2026-06-17');
    const plan = planReconcile([master], [link], TODAY); // child not in activities
    expect(plan.exceptionUpserts).toHaveLength(0);
    expect(plan.exceptionRestores).toHaveLength(1);
    expect(plan.exceptionRestores[0]!.master?.id).toBe('master');
  });

  it('an exception link whose master is UNPUSHABLE → restore with master=null (drop-link)', () => {
    const link = exceptionLink('child', 'gone-master', '2026-06-17');
    const child = makeActivity({
      id: 'child',
      parentActivityId: 'gone-master',
      date: '2026-06-17',
    });
    const plan = planReconcile([child], [link], TODAY); // master not present → unpushable
    expect(plan.exceptionRestores).toHaveLength(1);
    expect(plan.exceptionRestores[0]!.master).toBeNull();
  });

  it('a child whose master is not pushable → NO exceptionUpsert (no instance to except)', () => {
    const child = makeActivity({
      id: 'child',
      parentActivityId: 'absent-master',
      date: '2026-06-17',
    });
    const plan = planReconcile([child], [], TODAY);
    expect(plan.exceptionUpserts).toHaveLength(0);
    expect(plan.upserts).toHaveLength(0); // and never a top-level event
  });

  it('PARTITION: an exception link is NEVER placed in master `deletes`', () => {
    // Master link for an out-of-window master WOULD be deleted; the exception link
    // (child id not in pushableIds) must not be swept into `deletes`.
    const exLink = exceptionLink('child', 'master', '2026-06-17');
    const child = makeActivity({ id: 'child', parentActivityId: 'master', date: '2026-06-17' });
    const plan = planReconcile([master, child], [exLink], TODAY);
    expect(plan.deletes).toHaveLength(0);
    // the exception link is governed by exceptionUpserts/-Restores, not deletes
    expect(plan.exceptionUpserts).toHaveLength(1);
  });
});
