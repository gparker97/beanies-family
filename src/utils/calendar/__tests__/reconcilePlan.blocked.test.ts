/**
 * An activity Google would deterministically refuse is left OUT of the push plan —
 * and, far more importantly, is not mistaken for an activity that should be
 * REMOVED from Google.
 *
 * ⚠️ These are the two ways this change could destroy a family's data, and they
 * both come from the same mistake: expressing "don't push this" by taking the
 * activity out of a set that also means "this still belongs in Google".
 *
 *   1. `pushableIds` / `suppressed` — the delete loop keeps a link only via
 *      `pushableIds.has(id) && !suppressed.has(id)`, so a blocked activity placed
 *      in either falls through to `deletes` and its Google event is DELETED.
 *   2. `mastersById` — read a second time by `exceptionRestores`, which qualifies
 *      any link whose master is absent and hands it a null master; the engine
 *      answers that by DELETING the exception link, orphaning the family's
 *      overridden instance.
 *
 * Both are pinned below, and both have a mutation check in the plan. The correct
 * outcome is always the same: the event stops being UPDATED, and nothing is lost.
 */
import { describe, it, expect } from 'vitest';
import type { CalendarEventLink, FamilyActivity } from '@/types/models';
import { planReconcile } from '../reconcilePlan';
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

/** `"9am"` — the shape an LLM actually wrote into one family's pod. */
const BAD_TIME = { startTime: '9am' };

describe('a blocked activity is left out of the push', () => {
  it('does not appear in upserts', () => {
    const plan = planReconcile([makeActivity(BAD_TIME)], [], TODAY);
    expect(plan.upserts).toHaveLength(0);
  });

  it('but the same activity with a valid time DOES', () => {
    const plan = planReconcile([makeActivity({ startTime: '09:00' })], [], TODAY);
    expect(plan.upserts).toHaveLength(1);
  });

  it('does not block its siblings', () => {
    const good = makeActivity({ id: 'act-good', startTime: '09:00' });
    const bad = makeActivity({ id: 'act-bad', ...BAD_TIME });
    const plan = planReconcile([good, bad], [], TODAY);
    expect(plan.upserts.map((u) => u.activity.id)).toEqual(['act-good']);
  });
});

describe('🔴 a blocked activity is NEVER removed from Google', () => {
  it('produces no delete and no unlink when it already has a link', () => {
    // The failure this guards: an activity that synced fine, then had its time
    // corrupted, having its Google event deleted because it fell out of the set
    // the delete loop reads.
    const a = makeActivity(BAD_TIME);
    const plan = planReconcile([a], [linkFor(a)], TODAY);

    expect(plan.deletes).toHaveLength(0);
    expect(plan.unlinks).toHaveLength(0);
    expect(plan.upserts).toHaveLength(0); // stale, but present and untouched
  });

  it('still deletes a genuinely orphaned link, so the guard is not too wide', () => {
    // Anti-vacuity: prove `deletes` can still fire in this suite's setup.
    const a = makeActivity(BAD_TIME);
    const plan = planReconcile([], [linkFor(a)], TODAY);
    expect(plan.deletes).toHaveLength(1);
  });
});

describe('exception children', () => {
  function master(over: Partial<FamilyActivity> = {}) {
    return makeActivity({ id: 'master-1', recurrence: 'weekly', startTime: '09:00', ...over });
  }
  function child(over: Partial<FamilyActivity> = {}) {
    return makeActivity({
      id: 'child-1',
      parentActivityId: 'master-1',
      originalOccurrenceDate: TODAY,
      startTime: '09:00',
      ...over,
    });
  }
  function exceptionLink(childId: string, masterId: string): CalendarEventLink {
    return {
      id: `c1:${childId}`,
      connectionId: 'c1',
      activityId: childId,
      googleEventId: 'instance-1',
      lastPushedHash: 'stale',
      lastPushedAt: '2026-06-01T00:00:00.000Z',
      exceptionOf: masterId,
      exceptionOriginalYmd: TODAY,
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    };
  }

  it('a blocked CHILD is skipped', () => {
    const m = master();
    const c = child(BAD_TIME);
    const plan = planReconcile([m, c], [linkFor(m)], TODAY);
    expect(plan.exceptionUpserts).toHaveLength(0);
  });

  it('a blocked MASTER skips its children too', () => {
    const m = master(BAD_TIME);
    const c = child();
    const plan = planReconcile([m, c], [linkFor(m)], TODAY);
    expect(plan.exceptionUpserts).toHaveLength(0);
  });

  it('🔴 a blocked MASTER does NOT restore (i.e. delete) its child exception link', () => {
    // The second data-loss path. Expressing the skip by removing the master from
    // `mastersById` makes this link qualify for restore with a null master, which
    // the engine answers by deleting the link and orphaning the Google instance.
    const m = master(BAD_TIME);
    const c = child();
    const plan = planReconcile([m, c], [linkFor(m), exceptionLink(c.id, m.id)], TODAY);

    expect(plan.exceptionRestores).toHaveLength(0);
    expect(plan.deletes).toHaveLength(0);
    expect(plan.unlinks).toHaveLength(0);
  });

  it('still restores when the child is genuinely gone, so the guard is not too wide', () => {
    // Anti-vacuity for the assertion above.
    const m = master();
    const plan = planReconcile([m], [linkFor(m), exceptionLink('child-gone', m.id)], TODAY);
    expect(plan.exceptionRestores).toHaveLength(1);
  });
});
