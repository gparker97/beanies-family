/**
 * The calendar drag orchestrator (#142): store writes, the confirmation toast, Undo, and the
 * `drop` / `undo` events. The scoped save is mocked (its own tests cover the scope branches);
 * the activity store is real with its writes spied, as in `useActivityScopeEdit.test.ts`.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { CalendarEventLink, FamilyActivity } from '@/types/models';
import type { DragSource } from '@/utils/calendar/dragMath';

const handleScopedSave = vi.fn();
vi.mock('@/composables/useActivityScopeEdit', () => ({
  useActivityScopeEdit: () => ({ handleScopedSave }),
}));

const showToast = vi.fn();
vi.mock('@/composables/useToast', () => ({
  showToast: (...args: unknown[]) => showToast(...args),
  UNDO_TOAST_MS: 6000,
}));

const reportSessionActionFailed = vi.fn();
vi.mock('@/utils/actionFailure', () => ({
  reportSessionActionFailed: () => reportSessionActionFailed(),
}));

const reportError = vi.fn();
vi.mock('@/utils/errorReporter', () => ({
  reportError: (...args: unknown[]) => reportError(...args),
}));

const logEvent = vi.fn();
vi.mock('@/services/telemetry', () => ({ logEvent: (...args: unknown[]) => logEvent(...args) }));

const sync = vi.hoisted(() => ({ connections: [] as { id: string }[] }));
vi.mock('@/stores/calendarSyncStore', () => ({ useCalendarSyncStore: () => sync }));

const getLinks = vi.fn();
vi.mock('@/services/automerge/repositories/calendarRepository', () => ({
  getAllCalendarEventLinks: (...args: unknown[]) => getLinks(...args),
}));

import {
  commitCalendarMove,
  dropWhenLabel,
  resolveDragSource,
  undoCalendarMove,
  type CalendarMoveRequest,
} from '@/composables/useCalendarMove';
import { useActivityStore } from '@/stores/activityStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslationStore } from '@/stores/translationStore';

// 2026-11-13 is a Friday.
const oneOff = (over: Partial<FamilyActivity> = {}): FamilyActivity =>
  ({
    id: 'piano',
    title: 'Piano',
    date: '2026-11-11',
    startTime: '16:00',
    endTime: '17:00',
    recurrence: 'none',
    category: 'other',
    isActive: true,
    ...over,
  }) as FamilyActivity;

const series = (over: Partial<FamilyActivity> = {}): FamilyActivity =>
  oneOff({ id: 'series', date: '2026-10-07', recurrence: 'weekly', daysOfWeek: [3], ...over });

function request(
  activity: FamilyActivity,
  over: Partial<CalendarMoveRequest> = {},
  source: Partial<DragSource> = {}
): CalendarMoveRequest {
  return {
    source: {
      activity,
      seriesDate: '2026-11-11',
      grabDate: '2026-11-11',
      ...source,
    },
    patch: { date: '2026-11-13' },
    effect: 'moved',
    view: 'month',
    gesture: 'move',
    input: 'mouse',
    ...over,
  };
}

const link = (activityId: string, origin?: CalendarEventLink['origin']): CalendarEventLink =>
  ({
    id: `c1:${activityId}`,
    connectionId: 'c1',
    activityId,
    googleEventId: 'g',
    lastPushedHash: 'h',
    lastPushedAt: '2026-11-01',
    origin,
  }) as CalendarEventLink;

/** The `options` (4th) argument of the n-th showToast call. */
const toastOptions = (n = 0) => showToast.mock.calls.at(n)?.[3];

describe('useCalendarMove', () => {
  let store: ReturnType<typeof useActivityStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    sync.connections = [];
    getLinks.mockResolvedValue([]);
    // Plain English copy (beanie mode is the store's default).
    useTranslationStore().setBeanieMode(false);
    store = useActivityStore();
    store.activities = [oneOff(), series()];
    vi.spyOn(store, 'updateActivity').mockImplementation(
      async (id) => store.activities.find((a) => a.id === id) ?? null
    );
    vi.spyOn(store, 'resetOccurrenceToSeries').mockResolvedValue(true);
  });

  describe('a one-off', () => {
    it('a toast failure after the write reports itself and leaves the outcome saved', async () => {
      showToast.mockImplementationOnce(() => {
        throw new Error('formatter');
      });
      const outcome = await commitCalendarMove(request(oneOff()));
      expect(outcome.kind).toBe('saved');
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: 'calendar-drag',
          context: expect.objectContaining({ action: 'toast', stage: 'failed' }),
        })
      );
      // The person still gets a confirmation, and it still carries the Undo.
      expect(showToast).toHaveBeenCalledTimes(2);
      expect(showToast.mock.calls[1]!.slice(0, 3)).toEqual(['success', 'Moved Piano', undefined]);
      expect(toastOptions(1)).toMatchObject({ actionLabel: 'Undo' });
      await toastOptions(1).actionFn();
      expect(store.updateActivity).toHaveBeenLastCalledWith(
        'piano',
        expect.objectContaining({ date: '2026-11-11' }),
        { source: 'drag-undo' }
      );
    });

    it('the fallback toast carries no Undo when the drop cannot be undone', async () => {
      handleScopedSave.mockResolvedValue({ kind: 'saved', scope: 'this-and-future' });
      showToast.mockImplementationOnce(() => {
        throw new Error('formatter');
      });
      const outcome = await commitCalendarMove(request(series()));
      expect(outcome.kind).toBe('saved');
      expect(showToast).toHaveBeenCalledTimes(2);
      expect(toastOptions(1)).toBeUndefined();
    });

    it("writes the patch with source 'drag' and offers an Undo that restores the record", async () => {
      const outcome = await commitCalendarMove(request(oneOff()));

      expect(store.updateActivity).toHaveBeenCalledWith(
        'piano',
        { date: '2026-11-13' },
        { source: 'drag' }
      );
      expect(outcome).toMatchObject({ kind: 'saved', scope: 'single', effect: 'moved' });
      const undo = outcome.kind === 'saved' ? outcome.undo : null;
      expect(undo).toMatchObject({ kind: 'restore', id: 'piano' });
      expect(undo?.kind === 'restore' && undo.before).toMatchObject({
        date: '2026-11-11',
        startTime: '16:00',
        endTime: '17:00',
      });
      // Absent keys are explicit, so a restore clears what the drop added.
      expect(undo?.kind === 'restore' && 'endDate' in undo.before).toBe(true);

      expect(showToast).toHaveBeenCalledTimes(1);
      const [type, title, message, opts] = showToast.mock.calls[0]!;
      expect(type).toBe('success');
      expect(title).toBe('Moved Piano to Fri 13');
      expect(message).toBeUndefined();
      expect(opts).toMatchObject({ actionLabel: 'Undo', durationMs: 6000 });

      await opts.actionFn();
      expect(store.updateActivity).toHaveBeenLastCalledWith(
        'piano',
        expect.objectContaining({ date: '2026-11-11' }),
        { source: 'drag-undo' }
      );
      expect(logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: 'calendar-drag',
          message: 'undo',
          context: expect.objectContaining({ action: 'undo', stage: 'restored' }),
        })
      );
    });

    it('logs the drop with the view, item kind, input, gesture and scope', async () => {
      await commitCalendarMove(request(oneOff(), { view: 'week', input: 'touch' }));
      expect(logEvent).toHaveBeenCalledWith({
        surface: 'calendar-drag',
        level: 'info',
        message: 'drop',
        context: {
          action: 'drop',
          stage: 'saved',
          format: 'week',
          kind: 'timed',
          detail: 'touch',
          recur_outcome: 'move',
          recur_scope: 'single',
          activity_id: 'piano',
        },
      });
    });

    it('an override child pins its occurrence key on its first move', async () => {
      const child = oneOff({ id: 'child', parentActivityId: 'series', date: '2026-11-11' });
      store.activities = [...store.activities, child];
      await commitCalendarMove(request(child));

      expect(store.updateActivity).toHaveBeenCalledWith(
        'child',
        { date: '2026-11-13', originalOccurrenceDate: '2026-11-11' },
        { source: 'drag' }
      );
    });

    it('an already-pinned child keeps its key', async () => {
      const child = oneOff({
        id: 'child',
        parentActivityId: 'series',
        date: '2026-11-12',
        originalOccurrenceDate: '2026-11-11',
      });
      store.activities = [...store.activities, child];
      await commitCalendarMove(request(child));

      expect(vi.mocked(store.updateActivity).mock.calls[0]![1]).toEqual({ date: '2026-11-13' });
    });

    it('a failed write is reported once and shows no success toast', async () => {
      vi.mocked(store.updateActivity).mockResolvedValue(null);
      const outcome = await commitCalendarMove(request(oneOff()));

      expect(outcome).toEqual({ kind: 'failed' });
      expect(reportSessionActionFailed).toHaveBeenCalledTimes(1);
      expect(showToast).not.toHaveBeenCalled();
      expect(logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'drop',
          context: expect.objectContaining({ stage: 'failed' }),
        })
      );
    });
  });

  describe('toast copy', () => {
    it('a timeline drop names the day and the time', async () => {
      await commitCalendarMove(
        request(oneOff(), { view: 'week', patch: { date: '2026-11-13', startTime: '09:30' } })
      );
      expect(showToast.mock.calls[0]![1]).toBe('Moved Piano to Fri 13, 9:30am');
    });

    it('a resize names the new end', async () => {
      await commitCalendarMove(
        request(oneOff(), {
          view: 'day',
          effect: 'resized',
          gesture: 'resize-end',
          patch: { endTime: '18:00' },
        })
      );
      expect(showToast.mock.calls[0]![1]).toBe('Piano now ends at 6pm');
    });

    it('a reassignment names the member', async () => {
      useFamilyStore().members = [{ id: 'sofia', name: 'Sofia' }] as never;
      await commitCalendarMove(
        request(oneOff(), {
          view: 'day',
          effect: 'reassigned',
          patch: { assigneeIds: ['sofia'], assigneeId: 'sofia' },
        })
      );
      expect(showToast.mock.calls[0]![1]).toBe('Moved Piano to Sofia, Wed 11, 4pm');
    });

    it('dropWhenLabel reads a target the way the toast does', () => {
      expect(dropWhenLabel({ kind: 'day', date: '2026-11-13' })).toBe('Fri 13');
      expect(dropWhenLabel({ kind: 'time', date: '2026-11-13', minutes: 16 * 60 + 15 })).toBe(
        'Fri 13, 4:15pm'
      );
    });
  });

  describe('a repeat', () => {
    const saved = (scope: string, writtenId: string, reapedCount = 0) => ({
      kind: 'saved',
      scope,
      writtenId,
      reapedCount,
    });

    it("goes through the scoped save keyed on the occurrence start, with source 'drag'", async () => {
      handleScopedSave.mockResolvedValue(saved('this-only', 'new-child'));
      const outcome = await commitCalendarMove(request(series(), {}, { seriesDate: '2026-11-11' }));

      expect(handleScopedSave).toHaveBeenCalledWith(
        'series',
        '2026-11-11',
        { date: '2026-11-13' },
        { source: 'drag' }
      );
      expect(store.updateActivity).not.toHaveBeenCalled();
      // 'This only' created a child: Undo removes it.
      expect(outcome).toMatchObject({
        kind: 'saved',
        scope: 'this-only',
        undo: { kind: 'remove-override', childId: 'new-child' },
      });
      await toastOptions().actionFn();
      expect(store.resetOccurrenceToSeries).toHaveBeenCalledWith('new-child');
    });

    it("'this only' that reused a child restores that child instead of deleting it", async () => {
      const reused = oneOff({
        id: 'raced-child',
        parentActivityId: 'series',
        date: '2026-11-11',
        startTime: '15:00',
      });
      store.activities = [...store.activities, reused];
      handleScopedSave.mockResolvedValue(saved('this-only', 'raced-child'));
      const outcome = await commitCalendarMove(request(series()));

      expect(outcome).toMatchObject({
        undo: { kind: 'restore', id: 'raced-child', before: { startTime: '15:00' } },
      });
    });

    it("'all' restores the template", async () => {
      handleScopedSave.mockResolvedValue(saved('all', 'series'));
      const outcome = await commitCalendarMove(request(series()));

      expect(outcome).toMatchObject({
        undo: { kind: 'restore', id: 'series', before: { date: '2026-10-07', daysOfWeek: [3] } },
      });
      expect(toastOptions()).toMatchObject({ actionLabel: 'Undo' });
    });

    it("'this and future' confirms without Undo", async () => {
      handleScopedSave.mockResolvedValue(saved('this-and-future', 'split'));
      const outcome = await commitCalendarMove(request(series()));

      expect(outcome).toMatchObject({ kind: 'saved', undo: null });
      expect(showToast).toHaveBeenCalledTimes(1);
      expect(showToast.mock.calls[0]![1]).toBe('Moved Piano and later sessions to Fri 13');
      expect(toastOptions()).toBeUndefined();
    });

    it("an 'all' move whose reap deleted a child confirms without Undo", async () => {
      handleScopedSave.mockResolvedValue(saved('all', 'series', 2));
      const outcome = await commitCalendarMove(request(series()));

      expect(outcome).toMatchObject({ kind: 'saved', undo: null });
      expect(toastOptions()).toBeUndefined();
    });

    it('a dismissed prompt writes nothing and shows no toast', async () => {
      handleScopedSave.mockResolvedValue({ kind: 'cancelled' });
      expect(await commitCalendarMove(request(series()))).toEqual({ kind: 'cancelled' });
      expect(showToast).not.toHaveBeenCalled();
      expect(logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'drop',
          context: expect.objectContaining({ stage: 'cancelled' }),
        })
      );
    });

    it('a refused or failed save adds no toast of its own (the scoped save toasted)', async () => {
      handleScopedSave.mockResolvedValueOnce({ kind: 'refused', reason: 'multi-weekday' });
      expect(await commitCalendarMove(request(series()))).toEqual({
        kind: 'refused',
        reason: 'multi-weekday',
      });
      handleScopedSave.mockResolvedValueOnce({ kind: 'failed' });
      expect(await commitCalendarMove(request(series()))).toEqual({ kind: 'failed' });

      expect(showToast).not.toHaveBeenCalled();
      expect(reportSessionActionFailed).not.toHaveBeenCalled();
    });
  });

  describe('Google links', () => {
    beforeEach(() => {
      sync.connections = [{ id: 'c1' }];
    });

    it("an external-linked activity's toast says Google's copy was not changed", async () => {
      getLinks.mockResolvedValue([link('piano', 'external')]);
      await commitCalendarMove(request(oneOff()));

      // One scan of the link table, not one per connection.
      expect(getLinks).toHaveBeenCalledTimes(1);
      expect(showToast.mock.calls[0]![2]).toBe(
        "Google's copy wasn't changed: your family doesn't own that event"
      );
      // The Undo stays.
      expect(toastOptions()).toMatchObject({ actionLabel: 'Undo' });
    });

    it("an override child of an external series carries the note (the master's link decides)", async () => {
      const child = oneOff({ id: 'child', parentActivityId: 'series' });
      store.activities = [...store.activities, child];
      getLinks.mockResolvedValue([link('series', 'external')]);
      await commitCalendarMove(request(child));

      expect(showToast.mock.calls[0]![2]).toContain("Google's copy");
    });

    it('an adopted or beanies-made link adds no note', async () => {
      getLinks.mockResolvedValue([link('piano', 'adopted'), link('piano')]);
      await commitCalendarMove(request(oneOff()));
      expect(showToast.mock.calls[0]![2]).toBeUndefined();
    });

    it('reads the link table once however many connections there are', async () => {
      sync.connections = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }];
      getLinks.mockResolvedValue([link('piano', 'external')]);
      await commitCalendarMove(request(oneOff()));

      expect(getLinks).toHaveBeenCalledTimes(1);
      expect(showToast.mock.calls[0]![2]).toContain("Google's copy");
    });

    it("ignores a link left behind by a connection that is no longer this family's", async () => {
      getLinks.mockResolvedValue([{ ...link('piano', 'external'), connectionId: 'gone' }]);
      await commitCalendarMove(request(oneOff()));
      expect(showToast.mock.calls[0]![2]).toBeUndefined();
    });

    it("ignores a per-occurrence exception link (the master's link decides)", async () => {
      getLinks.mockResolvedValue([{ ...link('piano', 'external'), exceptionOf: 'x' }]);
      await commitCalendarMove(request(oneOff()));
      expect(showToast.mock.calls[0]![2]).toBeUndefined();
    });

    it('a lookup failure is logged and treated as no link', async () => {
      getLinks.mockRejectedValue(new Error('idb closed'));
      await commitCalendarMove(request(oneOff()));

      expect(showToast).toHaveBeenCalledTimes(1);
      expect(showToast.mock.calls[0]![2]).toBeUndefined();
      expect(logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'warn',
          context: expect.objectContaining({ action: 'google-link-lookup', stage: 'failed' }),
        })
      );
    });
  });

  describe('undoCalendarMove', () => {
    it('a restore whose record vanished shows the error toast and explains in the console', async () => {
      vi.mocked(store.updateActivity).mockResolvedValue(null);
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      await undoCalendarMove({ kind: 'restore', id: 'gone', before: { date: '2026-11-11' } });

      expect(showToast).toHaveBeenCalledWith('error', expect.any(String), expect.any(String), {
        surface: 'calendar-drag',
        context: { action: 'undo', stage: 'failed', activity_id: 'gone' },
      });
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('[calendar-drag]'));
      consoleError.mockRestore();
    });

    it('a failed remove-override only logs (the store already toasted)', async () => {
      vi.mocked(store.resetOccurrenceToSeries).mockResolvedValue(false);
      await undoCalendarMove({ kind: 'remove-override', childId: 'child' });

      expect(showToast).not.toHaveBeenCalled();
      expect(logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'undo',
          context: expect.objectContaining({ stage: 'failed', activity_id: 'child' }),
        })
      );
    });
  });

  describe('resolveDragSource', () => {
    const ref = (activityId: string, occurrenceDate = '2026-11-11') => ({
      activityId,
      occurrenceDate,
      gesture: 'move' as const,
    });

    it('a one-off keys on its own date and takes the grab point from the target', () => {
      const src = resolveDragSource(ref('piano', '2026-11-30'), {
        kind: 'time',
        date: '2026-11-11',
        minutes: 990,
      });
      expect(src).toMatchObject({
        seriesDate: '2026-11-11',
        grabDate: '2026-11-11',
        grabMinutes: 990,
      });
      expect(src?.activity.id).toBe('piano');
    });

    it('a repeat keys on the start of the occurrence under the finger', () => {
      const spy = vi.spyOn(store, 'repeatStartFor').mockReturnValue('2026-11-09');
      const src = resolveDragSource(
        { ...ref('series'), columnMemberId: 'sofia' },
        { kind: 'day', date: '2026-11-11' }
      );
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: 'series' }), '2026-11-11');
      expect(src).toMatchObject({ seriesDate: '2026-11-09', columnMemberId: 'sofia' });
      expect(src).not.toHaveProperty('grabMinutes');
    });

    it("falls back to the source's occurrence date with no target under the pointer", () => {
      expect(resolveDragSource(ref('piano', '2026-11-11'), null)?.grabDate).toBe('2026-11-11');
    });

    it('a record the store does not have is reported, never dragged', () => {
      expect(resolveDragSource(ref('ghost'), null)).toBeNull();
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: 'calendar-drag',
          severity: 'error',
          context: { action: 'resolve', detail: 'missing-activity' },
        })
      );
    });

    it('a vacation-linked activity never lifts', () => {
      store.activities = [oneOff({ vacationId: 'trip' })];
      expect(resolveDragSource(ref('piano'), null)).toBeNull();
      expect(reportError).not.toHaveBeenCalled();
    });
  });
});
