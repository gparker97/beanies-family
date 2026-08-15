/**
 * Coverage for the recurring-scope save/delete seam.
 *
 * This composable had NO tests when it shipped the occurrence-edit data-loss
 * bug: it passed the form's whole payload — including a `date` seeded from the
 * series template — straight into `materializeOverride`, moving occurrences the
 * user never touched. The six scope × date-touched cases below are the matrix
 * that would have caught it.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useActivityScopeEdit } from '@/composables/useActivityScopeEdit';
import { useActivityStore } from '@/stores/activityStore';
import type { FamilyActivity } from '@/types/models';

const chooseScope = vi.fn();
vi.mock('@/composables/useRecurringEditScope', () => ({
  chooseScope: (...args: unknown[]) => chooseScope(...args),
}));

const confirm = vi.fn();
vi.mock('@/composables/useConfirm', () => ({
  confirm: (...args: unknown[]) => confirm(...args),
}));

const reportSessionActionFailed = vi.fn();
vi.mock('@/utils/actionFailure', () => ({
  reportSessionActionFailed: () => reportSessionActionFailed(),
  reportRecurringItemActionFailed: vi.fn(),
}));

vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));

const TEMPLATE_ID = 'tpl-1';
const OCCURRENCE = '2026-04-01'; // 4 weeks after the series start
const SERIES_START = '2026-03-04';

function makeTemplate(overrides?: Partial<FamilyActivity>): FamilyActivity {
  return {
    id: TEMPLATE_ID,
    title: 'Piano Lesson',
    date: SERIES_START,
    recurrence: 'weekly',
    daysOfWeek: [3],
    category: 'piano',
    isActive: true,
    ...overrides,
  } as unknown as FamilyActivity;
}

describe('useActivityScopeEdit', () => {
  let store: ReturnType<typeof useActivityStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    store = useActivityStore();
    store.activities = [makeTemplate()];
    // Default: every store action succeeds.
    vi.spyOn(store, 'updateActivity').mockResolvedValue(makeTemplate());
    vi.spyOn(store, 'materializeOverride').mockResolvedValue(makeTemplate({ id: 'child-1' }));
    vi.spyOn(store, 'splitActivity').mockResolvedValue(makeTemplate({ id: 'tpl-2' }));
    vi.spyOn(store, 'deleteChildrenFrom').mockResolvedValue(0);
    vi.spyOn(store, 'deleteActivity').mockResolvedValue(true);
  });

  describe('handleScopedSave — the six-case matrix', () => {
    it('cancelling the scope modal saves nothing and keeps the modal open', async () => {
      chooseScope.mockResolvedValue(null);
      const { handleScopedSave } = useActivityScopeEdit();

      expect(await handleScopedSave(TEMPLATE_ID, OCCURRENCE, { title: 'X' })).toBe(false);
      expect(store.materializeOverride).not.toHaveBeenCalled();
      expect(store.updateActivity).not.toHaveBeenCalled();
    });

    describe("scope 'this-only'", () => {
      beforeEach(() => chooseScope.mockResolvedValue('this-only'));

      it('REGRESSION: an untouched date is absent, so the occurrence stays put', async () => {
        const { handleScopedSave } = useActivityScopeEdit();
        // A minimal diff — the user changed only the pickup person.
        await handleScopedSave(TEMPLATE_ID, OCCURRENCE, { pickupMemberId: 'parent-1' });

        expect(store.materializeOverride).toHaveBeenCalledWith(TEMPLATE_ID, OCCURRENCE, {
          pickupMemberId: 'parent-1',
        });
        // The bug: `date: SERIES_START` riding along and moving the occurrence.
        const [, , overrides] = vi.mocked(store.materializeOverride).mock.calls[0];
        expect(overrides).not.toHaveProperty('date');
      });

      it('a deliberately edited date is passed through as a reschedule', async () => {
        const { handleScopedSave } = useActivityScopeEdit();
        await handleScopedSave(TEMPLATE_ID, OCCURRENCE, { date: '2026-04-08' });

        expect(store.materializeOverride).toHaveBeenCalledWith(TEMPLATE_ID, OCCURRENCE, {
          date: '2026-04-08',
        });
      });

      it('reports a failure when the store returns null instead of failing silently', async () => {
        vi.mocked(store.materializeOverride).mockResolvedValue(null);
        const { handleScopedSave } = useActivityScopeEdit();

        expect(await handleScopedSave(TEMPLATE_ID, OCCURRENCE, { title: 'X' })).toBe(false);
        expect(reportSessionActionFailed).toHaveBeenCalled();
      });
    });

    describe("scope 'all'", () => {
      beforeEach(() => chooseScope.mockResolvedValue('all'));

      it('does not touch the series start date when the date was untouched', async () => {
        const { handleScopedSave } = useActivityScopeEdit();
        await handleScopedSave(TEMPLATE_ID, OCCURRENCE, { title: 'New name' });

        expect(store.updateActivity).toHaveBeenCalledWith(TEMPLATE_ID, { title: 'New name' });
      });

      it('translates a moved occurrence into a DELTA on the series start', async () => {
        const { handleScopedSave } = useActivityScopeEdit();
        // User moved this occurrence one day later (Wed → Thu).
        await handleScopedSave(TEMPLATE_ID, OCCURRENCE, { date: '2026-04-02' });

        // The series start must shift by the same +1 day, NOT jump to the
        // occurrence date — which would drag the whole series to April.
        expect(store.updateActivity).toHaveBeenCalledWith(TEMPLATE_ID, { date: '2026-03-05' });
      });

      it('preserves the weekday when applying the delta (load-bearing for daysOfWeek)', async () => {
        const { handleScopedSave } = useActivityScopeEdit();
        await handleScopedSave(TEMPLATE_ID, OCCURRENCE, { date: '2026-04-02' });

        const [, patch] = vi.mocked(store.updateActivity).mock.calls[0];
        const movedTemplateDay = new Date((patch as { date: string }).date + 'T00:00:00').getDay();
        const movedOccurrenceDay = new Date('2026-04-02T00:00:00').getDay();
        expect(movedTemplateDay).toBe(movedOccurrenceDay);
      });

      it('refuses a date move on a MULTI-weekday series rather than corrupting it', async () => {
        store.activities = [makeTemplate({ daysOfWeek: [1, 3] })];
        const { handleScopedSave } = useActivityScopeEdit();

        expect(await handleScopedSave(TEMPLATE_ID, OCCURRENCE, { date: '2026-04-02' })).toBe(false);
        expect(store.updateActivity).not.toHaveBeenCalled();
      });

      it('reaps orphaned children when an "ends on" edit truncates the series', async () => {
        const { handleScopedSave } = useActivityScopeEdit();
        await handleScopedSave(TEMPLATE_ID, OCCURRENCE, { recurrenceEndDate: '2026-05-31' });

        // Truncating via an EDIT strands children past the cut exactly as the
        // delete path does (Invariant 7) — that path was previously unwired.
        expect(store.deleteChildrenFrom).toHaveBeenCalledWith(TEMPLATE_ID, '2026-06-01');
      });
    });

    describe("scope 'this-and-future'", () => {
      beforeEach(() => chooseScope.mockResolvedValue('this-and-future'));

      it('splits at the occurrence and never lets an UNTOUCHED date through', async () => {
        const { handleScopedSave } = useActivityScopeEdit();
        // An untouched date is absent from the diff entirely.
        await handleScopedSave(TEMPLATE_ID, OCCURRENCE, { title: 'New name' });

        expect(store.splitActivity).toHaveBeenCalledWith(TEMPLATE_ID, OCCURRENCE);
        // `splitActivity` owns the new template's start (Invariant 3).
        const [, patch] = vi.mocked(store.updateActivity).mock.calls[0];
        expect(patch).not.toHaveProperty('date');
        expect(patch).toHaveProperty('title', 'New name');
      });

      it('APPLIES a deliberate move, shifted onto the split anchor', async () => {
        // Dropping `date` outright discarded the move silently — and for a
        // same-weekday move the remaining patch was empty, so the reschedule
        // vanished without a trace.
        vi.mocked(store.splitActivity).mockResolvedValue(
          makeTemplate({ id: 'tpl-2', date: OCCURRENCE })
        );
        const { handleScopedSave } = useActivityScopeEdit();
        // User moved the occurrence one day later.
        await handleScopedSave(TEMPLATE_ID, OCCURRENCE, { date: '2026-04-02' });

        const [id, patch] = vi.mocked(store.updateActivity).mock.calls[0];
        expect(id).toBe('tpl-2');
        expect(patch).toHaveProperty('date', '2026-04-02');
      });

      it('refuses a date move on a MULTI-weekday series rather than corrupting it', async () => {
        // Mon+Wed: "move this Wednesday to Thursday, for all" is ambiguous, and
        // the form's watcher leaves the chips alone. Shifting the start anyway
        // discarded the move AND dropped the first occurrence off the calendar.
        store.activities = [makeTemplate({ daysOfWeek: [1, 3] })];
        const { handleScopedSave } = useActivityScopeEdit();

        expect(await handleScopedSave(TEMPLATE_ID, OCCURRENCE, { date: '2026-04-02' })).toBe(false);
        expect(store.splitActivity).not.toHaveBeenCalled();
        expect(store.updateActivity).not.toHaveBeenCalled();
      });

      it('APPLIES a deliberate end-date edit (it used to be silently discarded)', async () => {
        const { handleScopedSave } = useActivityScopeEdit();
        await handleScopedSave(TEMPLATE_ID, OCCURRENCE, { recurrenceEndDate: '2026-06-30' });

        const [, patch] = vi.mocked(store.updateActivity).mock.calls[0];
        expect(patch).toHaveProperty('recurrenceEndDate', '2026-06-30');
      });

      it('reports a failure when the split fails', async () => {
        vi.mocked(store.splitActivity).mockResolvedValue(null);
        const { handleScopedSave } = useActivityScopeEdit();

        expect(await handleScopedSave(TEMPLATE_ID, OCCURRENCE, { title: 'X' })).toBe(false);
        expect(reportSessionActionFailed).toHaveBeenCalled();
        expect(store.updateActivity).not.toHaveBeenCalled();
      });
    });
  });

  describe('handleScopedDelete', () => {
    it("'this-only' cancels the occurrence rather than deleting the series", async () => {
      chooseScope.mockResolvedValue('this-only');
      const scope = useActivityScopeEdit();
      scope.openViewModal(TEMPLATE_ID, OCCURRENCE);

      expect(await scope.handleScopedDelete(makeTemplate())).toBe(true);
      expect(store.materializeOverride).toHaveBeenCalledWith(TEMPLATE_ID, OCCURRENCE, {
        isActive: false,
      });
      expect(store.deleteActivity).not.toHaveBeenCalled();
    });

    it("'this-and-future' end-dates the series AND reaps its orphaned children", async () => {
      chooseScope.mockResolvedValue('this-and-future');
      const scope = useActivityScopeEdit();
      scope.openViewModal(TEMPLATE_ID, OCCURRENCE);

      expect(await scope.handleScopedDelete(makeTemplate())).toBe(true);
      expect(store.updateActivity).toHaveBeenCalledWith(TEMPLATE_ID, {
        recurrenceEndDate: '2026-03-31',
      });
      // End-dating a master does nothing to `recurrence:'none'` children —
      // without this they survive the cut as unsyncable ghosts (Invariant 7).
      expect(store.deleteChildrenFrom).toHaveBeenCalledWith(TEMPLATE_ID, OCCURRENCE);
    });

    it("'this-and-future' does NOT reap children when the end-date write fails", async () => {
      chooseScope.mockResolvedValue('this-and-future');
      vi.mocked(store.updateActivity).mockResolvedValue(null);
      const scope = useActivityScopeEdit();
      scope.openViewModal(TEMPLATE_ID, OCCURRENCE);

      expect(await scope.handleScopedDelete(makeTemplate())).toBe(false);
      expect(store.deleteChildrenFrom).not.toHaveBeenCalled();
      expect(reportSessionActionFailed).toHaveBeenCalled();
    });

    it("'all' confirms before deleting the whole series", async () => {
      chooseScope.mockResolvedValue('all');
      confirm.mockResolvedValue(true);
      const scope = useActivityScopeEdit();
      scope.openViewModal(TEMPLATE_ID, OCCURRENCE);

      expect(await scope.handleScopedDelete(makeTemplate())).toBe(true);
      expect(confirm).toHaveBeenCalled();
      expect(store.deleteActivity).toHaveBeenCalledWith(TEMPLATE_ID);
    });

    it('deletes nothing when the confirm is declined', async () => {
      chooseScope.mockResolvedValue('all');
      confirm.mockResolvedValue(false);
      const scope = useActivityScopeEdit();
      scope.openViewModal(TEMPLATE_ID, OCCURRENCE);

      expect(await scope.handleScopedDelete(makeTemplate())).toBe(false);
      expect(store.deleteActivity).not.toHaveBeenCalled();
    });

    it('a non-recurring activity skips the scope modal entirely', async () => {
      confirm.mockResolvedValue(true);
      const scope = useActivityScopeEdit();
      const oneOff = makeTemplate({ recurrence: 'none' });

      expect(await scope.handleScopedDelete(oneOff)).toBe(true);
      expect(chooseScope).not.toHaveBeenCalled();
      expect(store.deleteActivity).toHaveBeenCalledWith(TEMPLATE_ID);
    });
  });
});
