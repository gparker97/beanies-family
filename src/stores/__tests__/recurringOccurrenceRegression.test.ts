/**
 * Regression suite for the recurring-occurrence edit data-loss bug
 * (2026-08-15). Every test here fails on the pre-fix code for a BEHAVIOURAL
 * reason — no new imports, no renamed APIs — so it is a genuine guard rather
 * than a compile-time tripwire.
 *
 * Plan: docs/plans/2026-08-15-recurring-occurrence-edit-data-loss.md
 * Invariants referenced below are the numbered rules in that plan.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useActivityStore } from '@/stores/activityStore';
import type { FamilyActivity } from '@/types/models';

vi.mock('@/services/automerge/repositories/activityRepository', () => ({
  getAllActivities: vi.fn(),
  getActivityById: vi.fn(),
  getActivitiesByDate: vi.fn(),
  getActivitiesByAssignee: vi.fn(),
  getActivitiesByCategory: vi.fn(),
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  deleteActivity: vi.fn(),
}));
import * as activityRepo from '@/services/automerge/repositories/activityRepository';

const syncEntityLinkedRecurringItem = vi.fn();
vi.mock('@/utils/linkedRecurringItem', () => ({
  syncEntityLinkedRecurringItem: (...args: unknown[]) => syncEntityLinkedRecurringItem(...args),
}));

vi.mock('@/composables/useToday', () => ({
  useToday: () => ({
    today: { value: '2026-03-01' },
    startOfToday: { value: new Date(2026, 2, 1) },
    isVisible: { value: true },
    lastVisibleAt: { value: 0 },
    lastHiddenAt: { value: 0 },
  }),
}));

vi.mock('@/stores/listStore', () => ({
  useListStore: () => ({ clearLinksFor: vi.fn() }),
}));

// Mocked so assertions don't run the real enrich/queue path (which reaches
// storage and the network shim) — these tests are about store behaviour, and an
// unmocked firehose makes them slower and coupled to telemetry internals.
vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/utils/actionFailure', () => ({
  reportSessionActionFailed: vi.fn(),
  reportRecurringItemActionFailed: vi.fn(),
}));

const SERIES_START = '2026-03-04'; // a Wednesday
const CLICKED = '2026-04-01'; // 4 weeks later, same weekday

function makeTemplate(overrides?: Partial<FamilyActivity>): FamilyActivity {
  return {
    id: 'tpl-1',
    title: 'Piano Lesson',
    date: SERIES_START,
    startTime: '15:00',
    endTime: '16:00',
    recurrence: 'weekly',
    daysOfWeek: [3],
    category: 'piano',
    assigneeId: 'child-1',
    isActive: true,
    createdBy: 'parent-1',
    createdAt: '2026-02-28T00:00:00.000Z',
    updatedAt: '2026-02-28T00:00:00.000Z',
    ...overrides,
  } as unknown as FamilyActivity;
}

describe('recurring occurrence edit — regression suite', () => {
  let store: ReturnType<typeof useActivityStore>;
  let created: number;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    created = 0;
    store = useActivityStore();

    vi.mocked(activityRepo.createActivity).mockImplementation(
      async (input: unknown) =>
        ({ ...(input as object), id: `child-${++created}` }) as FamilyActivity
    );
    // Realistic repo semantics: merge the patch onto the CURRENT record.
    vi.mocked(activityRepo.updateActivity).mockImplementation(
      async (id: string, patch: unknown) => {
        const current = store.activities.find((a) => a.id === id);
        if (!current) return null as unknown as FamilyActivity;
        return { ...current, ...(patch as object) } as FamilyActivity;
      }
    );
    vi.mocked(activityRepo.deleteActivity).mockResolvedValue(true);
    syncEntityLinkedRecurringItem.mockResolvedValue('item-99');
  });

  describe('Invariant 1 — an override child is a leaf', () => {
    it('never inherits recurrenceEndDate, even when the caller passes one', async () => {
      store.activities = [makeTemplate({ recurrenceEndDate: '2026-03-31' })];

      const child = await store.materializeOverride('tpl-1', '2026-03-11', {
        recurrenceEndDate: '2026-03-31', // what the whole-form payload used to leak
        pickupMemberId: 'parent-1',
      });

      expect(child?.recurrenceEndDate).toBeUndefined();
      expect(child?.pickupMemberId).toBe('parent-1');
    });

    it('PROVEN DATA LOSS: a moved occurrence stays visible past the series end date', async () => {
      // The series ends 2026-03-31. Moving the 03-11 occurrence to 04-07 used to
      // stamp the child with the series end date, and `expandRecurring` pruned it
      // before the recurrence switch — so it vanished from BOTH dates.
      const template = makeTemplate({ recurrenceEndDate: '2026-03-31' });
      store.activities = [template];

      const child = await store.materializeOverride('tpl-1', '2026-03-11', {
        date: '2026-04-07',
        recurrenceEndDate: '2026-03-31',
      });
      store.activities = [template, child!];

      expect(store.activitiesForDate('2026-04-07')).toHaveLength(1);
      // ...and the original slot is correctly suppressed (it moved, not duplicated).
      expect(store.activitiesForDate('2026-03-11')).toHaveLength(0);
    });

    it('never inherits daysOfWeek from the series rule', async () => {
      store.activities = [makeTemplate()];
      // Paired with a legitimate occurrence-level change: a patch of ONLY
      // series-level fields is refused outright (see 'refuses an override whose
      // every field was series-level').
      const child = await store.materializeOverride('tpl-1', CLICKED, {
        daysOfWeek: [1, 3, 5],
        location: 'Hall B',
      });
      expect(child?.daysOfWeek).toBeUndefined();
      expect(child?.recurrence).toBe('none');
      expect(child?.location).toBe('Hall B');
    });

    it('never inherits the parent completion history', async () => {
      store.activities = [
        makeTemplate({
          dropoffCompletions: [
            { date: SERIES_START, completedBy: 'p1', completedAt: '2026-03-04T08:00:00.000Z' },
          ],
          pickupCompletions: [
            { date: SERIES_START, completedBy: 'p2', completedAt: '2026-03-04T17:00:00.000Z' },
          ],
        }),
      ];
      const child = await store.materializeOverride('tpl-1', CLICKED, {});
      expect(child?.dropoffCompletions).toBeUndefined();
      expect(child?.pickupCompletions).toBeUndefined();
    });
  });

  describe('Invariant 2 — an override child is never a payment owner', () => {
    it('PROVEN CORRUPTION: editing one session does not touch the series fee item', async () => {
      store.activities = [
        makeTemplate({
          linkedRecurringItemId: 'item-99',
          payFromAccountId: 'acct-1',
          feeAmount: 200,
          feeSchedule: 'monthly',
        }),
      ];

      await store.materializeOverride('tpl-1', CLICKED, { pickupMemberId: 'parent-1' });

      // The child used to clone `linkedRecurringItemId`, and because it is
      // `recurrence:'none'` the sync rewrote the family's MONTHLY fee item into
      // a one-time payment re-dated to this occurrence.
      expect(syncEntityLinkedRecurringItem).not.toHaveBeenCalled();
    });

    it('does not inherit linkedRecurringItemId at all', async () => {
      store.activities = [makeTemplate({ linkedRecurringItemId: 'item-99' })];
      const child = await store.materializeOverride('tpl-1', CLICKED, {});
      expect(child?.linkedRecurringItemId).toBeUndefined();
    });

    it('self-heals a legacy leaked link on contact', async () => {
      // A `.beanpod` written before the fix can hold a child carrying the id.
      // It is not inert — TransactionsPage resolves a fee item's owner by
      // scanning this field, and a child can win that scan.
      const legacyChild = makeTemplate({
        id: 'child-legacy',
        recurrence: 'none',
        parentActivityId: 'tpl-1',
        linkedRecurringItemId: 'item-99',
      });
      store.activities = [makeTemplate(), legacyChild];

      await store.updateActivity('child-legacy', { title: 'Touched' });

      expect(activityRepo.updateActivity).toHaveBeenCalledWith('child-legacy', {
        linkedRecurringItemId: undefined,
      });
      expect(syncEntityLinkedRecurringItem).not.toHaveBeenCalled();
    });
  });

  describe('Invariant 4 — an occurrence key never moves', () => {
    it('is idempotent: a second materialize updates rather than duplicating', async () => {
      const template = makeTemplate();
      store.activities = [template];

      const first = await store.materializeOverride('tpl-1', CLICKED, { location: 'Hall A' });
      store.activities = [template, first!];
      const second = await store.materializeOverride('tpl-1', CLICKED, {
        pickupMemberId: 'parent-1',
      });

      expect(store.activities.filter((a) => a.parentActivityId)).toHaveLength(1);
      expect(second?.location).toBe('Hall A'); // the first edit survived
      expect(second?.pickupMemberId).toBe('parent-1');
    });

    it('does not snap an already-rescheduled child back to its original slot', async () => {
      const template = makeTemplate();
      store.activities = [template];

      const moved = await store.materializeOverride('tpl-1', CLICKED, { date: '2026-04-08' });
      store.activities = [template, moved!];
      expect(moved?.originalOccurrenceDate).toBe(CLICKED);

      // An unrelated later edit must not reset the date to `occurrenceDate`.
      const edited = await store.materializeOverride('tpl-1', CLICKED, {
        pickupMemberId: 'parent-1',
      });

      expect(edited?.date).toBe('2026-04-08');
      expect(edited?.originalOccurrenceDate).toBe(CLICKED);
    });
  });

  describe('Invariant 7 — a child belongs to the template that owns its occurrence', () => {
    it('deleting a series cascades to its override children', async () => {
      const template = makeTemplate();
      const child = makeTemplate({
        id: 'child-a',
        recurrence: 'none',
        parentActivityId: 'tpl-1',
        date: CLICKED,
      });
      store.activities = [template, child];

      expect(await store.deleteActivity('tpl-1')).toBe(true);
      // The child used to survive as an in-app ghost that could never sync.
      expect(store.activities).toHaveLength(0);
    });

    it('does not delete children when the master delete fails (order matters)', async () => {
      vi.mocked(activityRepo.deleteActivity).mockResolvedValue(false);
      const child = makeTemplate({
        id: 'child-a',
        recurrence: 'none',
        parentActivityId: 'tpl-1',
        date: CLICKED,
      });
      store.activities = [makeTemplate(), child];

      expect(await store.deleteActivity('tpl-1')).toBe(false);
      expect(store.activities).toHaveLength(2); // nothing lost
    });

    it('splitting a series re-parents the children on/after the split date', async () => {
      const template = makeTemplate();
      const before = makeTemplate({
        id: 'child-before',
        recurrence: 'none',
        parentActivityId: 'tpl-1',
        date: '2026-03-11',
      });
      const after = makeTemplate({
        id: 'child-after',
        recurrence: 'none',
        parentActivityId: 'tpl-1',
        date: CLICKED,
      });
      store.activities = [template, before, after];

      const newTemplate = await store.splitActivity('tpl-1', CLICKED);

      // The post-split child must follow the new template, or it suppresses an
      // occurrence the old template no longer emits while the new one emits an
      // unsuppressed copy — the split-date session duplicates.
      expect(store.activities.find((a) => a.id === 'child-after')?.parentActivityId).toBe(
        newTemplate!.id
      );
      // The pre-split child stays with the (now end-dated) original.
      expect(store.activities.find((a) => a.id === 'child-before')?.parentActivityId).toBe('tpl-1');
    });

    it('truncating a series reaps only the children on/after the cut', async () => {
      const template = makeTemplate();
      const before = makeTemplate({
        id: 'child-before',
        recurrence: 'none',
        parentActivityId: 'tpl-1',
        date: '2026-03-11',
      });
      const after = makeTemplate({
        id: 'child-after',
        recurrence: 'none',
        parentActivityId: 'tpl-1',
        date: CLICKED,
      });
      store.activities = [template, before, after];

      expect(await store.deleteChildrenFrom('tpl-1', CLICKED)).toBe(1);
      expect(store.activities.map((a) => a.id)).toEqual(['tpl-1', 'child-before']);
    });

    it('a split does not clone the vacation link onto the new template', async () => {
      store.activities = [makeTemplate({ vacationId: 'vac-1' })];

      const newTemplate = await store.splitActivity('tpl-1', CLICKED);

      // Inheriting vacationId would mint an activity deleteActivity refuses to delete.
      expect(newTemplate?.vacationId).toBeUndefined();
      // NOTE: the fee link is deliberately TRANSFERRED, not stripped — see
      // 'a split TRANSFERS the fee item' below.
    });
  });

  // Regressions introduced by the first pass of this fix and caught in review.
  describe('second-pass regressions', () => {
    it('a split TRANSFERS the fee item — it must never mint a second one', async () => {
      store.activities = [
        makeTemplate({
          linkedRecurringItemId: 'item-99',
          payFromAccountId: 'acct-1',
          feeAmount: 200,
          feeSchedule: 'monthly',
        }),
      ];

      const newTemplate = await store.splitActivity('tpl-1', CLICKED);

      // Stripping the id while keeping the fee fields made the new template look
      // fee-enabled with no item, so the sync CREATED a second one while the
      // original's kept running — the family billed twice, forever.
      const createCalls = syncEntityLinkedRecurringItem.mock.calls.filter(
        ([arg]) => (arg as { existingItemId?: string }).existingItemId === undefined
      );
      expect(createCalls).toHaveLength(0);
      expect(newTemplate?.linkedRecurringItemId).toBe('item-99');
      // ...and the end-dated original must release it, so one item has one owner.
      expect(store.activities.find((a) => a.id === 'tpl-1')?.linkedRecurringItemId).toBeUndefined();
    });

    it('an override keeps the completion already ticked for its own occurrence', async () => {
      store.activities = [
        makeTemplate({
          pickupCompletions: [
            { date: CLICKED, completedBy: 'p2', completedAt: '2026-04-01T17:00:00.000Z' },
            { date: SERIES_START, completedBy: 'p1', completedAt: '2026-03-04T17:00:00.000Z' },
          ],
        }),
      ];

      const child = await store.materializeOverride('tpl-1', CLICKED, { location: 'Hall B' });

      // Dropping the arrays wholesale un-ticked a duty the family had done: the
      // child suppresses the master for that date, so every reader saw nothing.
      expect(child?.pickupCompletions).toHaveLength(1);
      expect(child?.pickupCompletions?.[0]?.date).toBe(CLICKED);
    });

    it('a rescheduled override carries its completion to the new date', async () => {
      store.activities = [
        makeTemplate({
          pickupCompletions: [
            { date: CLICKED, completedBy: 'p2', completedAt: '2026-04-01T17:00:00.000Z' },
          ],
        }),
      ];

      const child = await store.materializeOverride('tpl-1', CLICKED, { date: '2026-04-08' });

      expect(child?.pickupCompletions?.[0]?.date).toBe('2026-04-08');
    });

    it('refuses an override whose every field was series-level', async () => {
      store.activities = [makeTemplate()];

      // Sanitizing empties the patch. Creating a child anyway discarded the edit
      // AND detached the occurrence behind a junk duplicate.
      const child = await store.materializeOverride('tpl-1', CLICKED, { daysOfWeek: [2] });

      expect(child).toBeNull();
      expect(store.activities.filter((a) => a.parentActivityId)).toHaveLength(0);
    });

    it('truncating a series spares a session moved BEFORE the cut', async () => {
      // Selecting by occurrence key hard-deleted a session the user can see
      // sitting a week before the day they chose to keep.
      const template = makeTemplate();
      const movedEarlier = makeTemplate({
        id: 'child-early',
        recurrence: 'none',
        parentActivityId: 'tpl-1',
        date: '2026-05-04', // renders BEFORE the cut
        originalOccurrenceDate: '2026-05-20', // key is AFTER it
      });
      store.activities = [template, movedEarlier];

      expect(await store.deleteChildrenFrom('tpl-1', '2026-05-11')).toBe(0);
      expect(store.activities.map((a) => a.id)).toContain('child-early');
    });

    it('truncating a series reaps a session moved AFTER the cut', async () => {
      const template = makeTemplate();
      const movedLater = makeTemplate({
        id: 'child-late',
        recurrence: 'none',
        parentActivityId: 'tpl-1',
        date: '2026-09-20', // renders AFTER the cut
        originalOccurrenceDate: '2026-08-10', // key is BEFORE it
      });
      store.activities = [template, movedLater];

      expect(await store.deleteChildrenFrom('tpl-1', '2026-08-24')).toBe(1);
      expect(store.activities.map((a) => a.id)).not.toContain('child-late');
    });

    it('rolls the split back if the original cannot be end-dated', async () => {
      store.activities = [makeTemplate()];
      // End-date write fails; the create already succeeded.
      vi.mocked(activityRepo.updateActivity).mockResolvedValue(null as unknown as FamilyActivity);

      const result = await store.splitActivity('tpl-1', CLICKED);

      // Leaving the replacement behind would make BOTH templates expand from the
      // split date — every session rendered twice, forever.
      expect(result).toBeNull();
      expect(store.activities.filter((a) => a.recurrence === 'weekly')).toHaveLength(1);
    });
  });

  describe('legacy data tolerance', () => {
    it('un-hides a child that already carries a leaked recurrenceEndDate', async () => {
      // No migration: `expandRecurring` now ignores the series end date on a
      // `recurrence:'none'` record, so corrupted `.beanpod` data reappears.
      const template = makeTemplate({ recurrenceEndDate: '2026-03-31' });
      const corrupted = makeTemplate({
        id: 'child-corrupt',
        recurrence: 'none',
        parentActivityId: 'tpl-1',
        date: '2026-04-07',
        originalOccurrenceDate: '2026-03-11',
        recurrenceEndDate: '2026-03-31', // the leak
      });
      store.activities = [template, corrupted];

      expect(store.activitiesForDate('2026-04-07')).toHaveLength(1);
    });
  });
});
