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

// ─────────────────────────────────────────────────────────────────────────────
// #94 one-time import: the engine must honour the LINK as the authority on where
// an event lives in Google, and must never delete an event beanies did not create.
// ─────────────────────────────────────────────────────────────────────────────

/** A link pointing at an event the family already had, not one beanies minted. */
function importedLink(
  activity: FamilyActivity,
  origin: 'adopted' | 'external',
  googleEventId = 'Google_Original_ID_123'
): CalendarEventLink {
  return { ...linkFor(activity), googleEventId, origin };
}

describe('adoption: the link decides where the event lives', () => {
  it('targets the link’s foreign Google id, not a derived one', () => {
    const a = makeActivity({ title: 'Swim' });
    const plan = planReconcile([a], [importedLink(a, 'adopted')], TODAY);

    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0].eventId).toBe('Google_Original_ID_123');
    // The whole point: deriving here would insert a duplicate beside the real event.
    expect(plan.upserts[0].eventId).not.toBe(deterministicEventId(a.id));
  });

  it('carries origin onto the upsert so the engine can self-heal a vanished event', () => {
    const a = makeActivity();
    const plan = planReconcile([a], [importedLink(a, 'adopted')], TODAY);
    expect(plan.upserts[0].origin).toBe('adopted');
  });

  it('still derives the id for an activity beanies has never pushed', () => {
    const a = makeActivity();
    const plan = planReconcile([a], [], TODAY);
    expect(plan.upserts[0].eventId).toBe(deterministicEventId(a.id));
    expect(plan.upserts[0].origin).toBeUndefined();
  });
});

describe('MIGRATION SAFETY: masterEventId is a no-op for every link ever written', () => {
  // Do NOT weaken this into `expect(deterministicEventId(id)).toBe(deterministicEventId(id))`.
  // The point is that a link built the way the STORE builds it (recordLink is called
  // only with the plan's own u.eventId, and is the sole writer of googleEventId for
  // master links) produces exactly the id the old inline derivation produced.
  it('a pre-import link yields the identical eventId the old code produced', () => {
    const a = makeActivity();
    const storeShapedLink = linkFor(a); // googleEventId = deterministicEventId(a.id)

    const plan = planReconcile([a], [storeShapedLink], TODAY);

    expect(plan.upserts[0].eventId).toBe(deterministicEventId(a.id));
    expect(plan.upserts[0].eventId).toBe(storeShapedLink.googleEventId);
  });
});

describe('DATA LOSS GUARD: an imported link is never a remote delete', () => {
  it('an external link whose activity is suppressed is NOT in deletes', () => {
    // This is the one that would delete a school's event from a parent's calendar.
    const a = makeActivity();
    const plan = planReconcile([a], [importedLink(a, 'external')], TODAY);

    expect(plan.deletes).toHaveLength(0);
    expect(plan.upserts).toHaveLength(0); // suppressed: beanies never writes it
  });

  it('keeps the link while the activity merely goes inactive', () => {
    // Dropping it here would let a later re-entry into the window mint a fresh
    // deterministic id beside the user's original event.
    const a = makeActivity({ isActive: false });
    const plan = planReconcile([a], [importedLink(a, 'external')], TODAY);

    expect(plan.deletes).toHaveLength(0);
    expect(plan.unlinks).toHaveLength(0);
  });

  it('unlinks (never deletes) once the activity itself is gone', () => {
    const a = makeActivity();
    const plan = planReconcile([], [importedLink(a, 'external')], TODAY);

    expect(plan.deletes).toHaveLength(0);
    expect(plan.unlinks).toHaveLength(1);
    expect(plan.unlinks[0].googleEventId).toBe('Google_Original_ID_123');
  });

  it('an ADOPTED link is also never remotely deleted when its activity goes', () => {
    const a = makeActivity();
    const plan = planReconcile([], [importedLink(a, 'adopted')], TODAY);
    expect(plan.deletes).toHaveLength(0);
    expect(plan.unlinks).toHaveLength(1);
  });

  it('a beanies-created link still deletes normally', () => {
    // The existing behaviour must be completely untouched.
    const a = makeActivity();
    const plan = planReconcile([], [linkFor(a)], TODAY);
    expect(plan.deletes).toHaveLength(1);
    expect(plan.unlinks).toHaveLength(0);
  });
});

describe('an external master never has its Google instances touched', () => {
  it('produces no exceptionUpserts for an override child of an invited series', () => {
    const master = makeActivity({ id: 'm1', recurrence: 'weekly' });
    const child = makeActivity({
      id: 'c1',
      parentActivityId: 'm1',
      originalOccurrenceDate: TODAY,
      date: TODAY,
    });

    const plan = planReconcile([master, child], [importedLink(master, 'external')], TODAY);

    // Patching or cancelling an instance here would be writing to someone else's
    // recurring event.
    expect(plan.exceptionUpserts).toHaveLength(0);
  });

  it('an ADOPTED master DOES get exceptions, discovered against its real id', () => {
    const master = makeActivity({ id: 'm1', recurrence: 'weekly' });
    const child = makeActivity({
      id: 'c1',
      parentActivityId: 'm1',
      originalOccurrenceDate: TODAY,
      date: TODAY,
    });

    const plan = planReconcile([master, child], [importedLink(master, 'adopted')], TODAY);

    expect(plan.exceptionUpserts).toHaveLength(1);
    expect(plan.exceptionUpserts[0].masterEventId).toBe('Google_Original_ID_123');
  });
});
