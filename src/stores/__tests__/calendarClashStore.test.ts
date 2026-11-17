import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import { installInlineBackend } from '@/services/automerge/worker/__tests__/inlineHarness';
import { createCalendarConnection } from '@/services/automerge/repositories/calendarRepository';
import { setCalendarClientForTesting } from '@/services/calendar/clientInstance';
import { CalendarApiError, type CalendarClient } from '@/services/calendar/CalendarClient';
import { makeCalendarClientStub } from '@/services/calendar/__tests__/fakeCalendarClient';
import type { ActivityOccurrence } from '@/utils/calendar/clashDetection';
import { deterministicEventId } from '@/utils/calendar/deterministicEventId';
import { useCalendarClashStore } from '../calendarClashStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { ViewedCalendar } from '@/types/models';
import type { ExternalEvent } from '@/types/externalEvents';

const { reportErrorMock } = vi.hoisted(() => ({ reportErrorMock: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: reportErrorMock }));

// The view store's public surface the clash store reads (P4 owns the real store).
// A reactive stand-in so the clash store's watcher on `events` fires.
interface ViewStoreStandIn {
  isActive: boolean;
  calendars: ViewedCalendar[];
  events: readonly ExternalEvent[];
}
const viewStoreRef = vi.hoisted(() => ({ current: null as ViewStoreStandIn | null }));
vi.mock('@/stores/calendarViewStore', async () => {
  const { reactive } = await import('vue');
  const state = reactive<ViewStoreStandIn>({ isActive: false, calendars: [], events: [] });
  viewStoreRef.current = state;
  return { useCalendarViewStore: () => state };
});
const viewStore = (): ViewStoreStandIn => viewStoreRef.current!;

const OWNED = 'https://www.googleapis.com/auth/calendar.events.owned';

function localMs(ymd: string, hhmm: string): number {
  const [y, mo, d] = ymd.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  return new Date(y!, mo! - 1, d!, h!, mi!, 0, 0).getTime();
}

function timedOcc(
  id: string,
  date: string,
  startTime: string,
  endTime: string
): ActivityOccurrence {
  return {
    activity: {
      id,
      date,
      startTime,
      endTime,
      recurrence: 'none',
      title: 'X',
      category: 'sports',
      feeSchedule: 'none',
      reminderMinutes: 0,
      isActive: true,
      createdBy: 'm0',
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    } as unknown as ActivityOccurrence['activity'],
    date,
  };
}

function makeClient(listEventTimes: CalendarClient['listEventTimes']): CalendarClient {
  return makeCalendarClientStub({
    listEventTimes,
    async listCalendars() {
      return [];
    },
  });
}

async function makeConnection() {
  return createCalendarConnection({
    provider: 'google',
    accountEmail: 'mum@example.com',
    destinationCalendarId: 'primary',
    refreshToken: 'r',
    grantedScopes: [OWNED],
    status: 'ok',
  });
}

const WINDOW = ['2026-06-10T00:00:00Z', '2026-06-11T00:00:00Z'] as const;

function viewedCalendar(id: string, over: Partial<ViewedCalendar> = {}): ViewedCalendar {
  return {
    id,
    viewAccountId: 'va-1',
    calendarId: `${id}@group.calendar.google.com`,
    name: "Grandma's",
    accessRole: 'reader',
    detailLevel: 'details',
    color: '#9CA3AF',
    inBriefing: false,
    inWidgets: false,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...over,
  };
}

/** A view-only event 14:30-16:00 on 2026-06-10 (overlaps a 14:00-15:00 activity). */
function viewEvent(viewedCalendarId: string, over: Partial<ExternalEvent> = {}): ExternalEvent {
  return {
    id: `ev-${viewedCalendarId}`,
    viewedCalendarId,
    calendarName: "Grandma's",
    color: '#9CA3AF',
    allDay: false,
    startMs: localMs('2026-06-10', '14:30'),
    endMs: localMs('2026-06-10', '16:00'),
    startYmd: '2026-06-10',
    endYmd: '2026-06-10',
    title: 'Dentist',
    busyOnly: false,
    transparent: false,
    ...over,
  };
}

/** Turn view-only calendars on with these calendars and events. */
function setViewed(calendars: ViewedCalendar[], events: ExternalEvent[]): void {
  const v = viewStore();
  v.isActive = calendars.length > 0;
  v.calendars = calendars;
  v.events = events;
}
/** One opaque external event overlapping a 14:00–15:00 activity on 2026-06-10. */
const overlappingEvents = () => [
  {
    id: 'work-1',
    startMs: localMs('2026-06-10', '14:30'),
    endMs: localMs('2026-06-10', '16:00'),
    transparent: false,
  },
];

describe('calendarClashStore (#34)', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await installInlineBackend();
    localStorage.setItem('beanies:flag:calendarClashNudge', 'true');
    localStorage.setItem('beanies:flag:googleCalendarSync', 'true');
    reportErrorMock.mockClear();
    setViewed([], []);
  });
  afterEach(() => {
    setCalendarClientForTesting(null);
    localStorage.clear();
  });

  it('no connected calendar → unavailable, no reads', async () => {
    const read = vi.fn(async () => []);
    setCalendarClientForTesting(makeClient(read));
    const store = useCalendarClashStore();
    expect(store.isAvailable).toBe(false);

    await store.ensureBusyForWindow(WINDOW[0], WINDOW[1], [
      timedOcc('a1', '2026-06-10', '14:00', '15:00'),
    ]);
    expect(read).not.toHaveBeenCalled();
    expect(store.clashFor('a1', '2026-06-10')).toBeUndefined();
  });

  it('available whenever a calendar is connected (events.owned is always granted)', async () => {
    await makeConnection();
    setCalendarClientForTesting(makeClient(vi.fn(async () => [])));
    expect(useCalendarClashStore().isAvailable).toBe(true);
  });

  it('toggle off → unavailable, no reads', async () => {
    await makeConnection();
    const read = vi.fn(async () => overlappingEvents());
    setCalendarClientForTesting(makeClient(read));
    await useSettingsStore().setCalendarClashNudgeEnabled(false);
    const store = useCalendarClashStore();
    expect(store.isAvailable).toBe(false);

    await store.ensureBusyForWindow(WINDOW[0], WINDOW[1], [
      timedOcc('a1', '2026-06-10', '14:00', '15:00'),
    ]);
    expect(read).not.toHaveBeenCalled();
  });

  it('happy path → clashFor resolves to the connection, decoration recomputed', async () => {
    const conn = await makeConnection();
    const read = vi.fn(async () => overlappingEvents());
    setCalendarClientForTesting(makeClient(read));
    const store = useCalendarClashStore();
    expect(store.clashFor('a1', '2026-06-10')).toBeUndefined();

    await store.ensureBusyForWindow(WINDOW[0], WINDOW[1], [
      timedOcc('a1', '2026-06-10', '14:00', '15:00'),
    ]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(store.clashFor('a1', '2026-06-10')).toEqual(
      expect.objectContaining({
        sourceId: conn.id,
        source: 'own',
        sourceName: 'mum@example.com',
        activityId: 'a1',
        occurrenceDate: '2026-06-10',
        fingerprint: expect.stringMatching(/^\d+-\d+$/),
      })
    );
  });

  it('self-exclusion → beanies OWN synced event at the same time yields NO clash', async () => {
    await makeConnection();
    // The external calendar contains ONLY beanies' own pushed event for a1.
    const read = vi.fn(async () => [
      {
        id: deterministicEventId('a1'),
        startMs: localMs('2026-06-10', '14:00'),
        endMs: localMs('2026-06-10', '15:00'),
        transparent: false,
      },
    ]);
    setCalendarClientForTesting(makeClient(read));
    const store = useCalendarClashStore();

    await store.ensureBusyForWindow(WINDOW[0], WINDOW[1], [
      timedOcc('a1', '2026-06-10', '14:00', '15:00'),
    ]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(store.clashFor('a1', '2026-06-10')).toBeUndefined();
  });

  it('a corrupt activity id does not throw out of ensureBusyForWindow (guarded + reported)', async () => {
    await makeConnection();
    setCalendarClientForTesting(makeClient(vi.fn(async () => overlappingEvents())));
    const store = useCalendarClashStore();

    await expect(
      store.ensureBusyForWindow(WINDOW[0], WINDOW[1], [
        timedOcc('', '2026-06-10', '14:00', '15:00'), // blank id → deterministicEventId throws
      ])
    ).resolves.toBeUndefined();
    // The blank-id occurrence is skipped from the self-exclusion set + reported once.
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    expect(reportErrorMock.mock.calls[0]![0]).toMatchObject({ surface: 'calendar-clash' });
  });

  it('TTL reuse → same window within TTL issues no new read', async () => {
    await makeConnection();
    const read = vi.fn(async () => overlappingEvents());
    setCalendarClientForTesting(makeClient(read));
    const store = useCalendarClashStore();
    const occ = [timedOcc('a1', '2026-06-10', '14:00', '15:00')];

    await store.ensureBusyForWindow(WINDOW[0], WINDOW[1], occ);
    await store.ensureBusyForWindow(WINDOW[0], WINDOW[1], occ);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('a concurrent same-window call while in flight does not duplicate the read', async () => {
    await makeConnection();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const read = vi.fn(async () => {
      await gate;
      return overlappingEvents();
    });
    setCalendarClientForTesting(makeClient(read));
    const store = useCalendarClashStore();
    const occ = [timedOcc('a1', '2026-06-10', '14:00', '15:00')];

    const p1 = store.ensureBusyForWindow(WINDOW[0], WINDOW[1], occ);
    const p2 = store.ensureBusyForWindow(WINDOW[0], WINDOW[1], occ); // in-flight → short-circuits
    release();
    await Promise.all([p1, p2]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('a throwing read degrades silently but reports once (no bare catch)', async () => {
    await makeConnection();
    const read = vi.fn(async () => {
      throw new CalendarApiError('transient', 'boom');
    });
    setCalendarClientForTesting(makeClient(read));
    const store = useCalendarClashStore();

    await expect(
      store.ensureBusyForWindow(WINDOW[0], WINDOW[1], [
        timedOcc('a1', '2026-06-10', '14:00', '15:00'),
      ])
    ).resolves.toBeUndefined();
    expect(store.clashFor('a1', '2026-06-10')).toBeUndefined();
    expect(reportErrorMock).toHaveBeenCalledTimes(1);
    expect(reportErrorMock.mock.calls[0]![0]).toMatchObject({ surface: 'calendar-clash' });
  });

  it('stop() clears the cache + decoration in one call', async () => {
    await makeConnection();
    setCalendarClientForTesting(makeClient(vi.fn(async () => overlappingEvents())));
    const store = useCalendarClashStore();
    await store.ensureBusyForWindow(WINDOW[0], WINDOW[1], [
      timedOcc('a1', '2026-06-10', '14:00', '15:00'),
    ]);
    expect(store.clashFor('a1', '2026-06-10')).toBeDefined();

    store.stop();
    expect(store.clashFor('a1', '2026-06-10')).toBeUndefined();
  });

  describe('view-only calendars as busy sources (plan 2026-11-17 A5)', () => {
    const occ = () => [timedOcc('a1', '2026-06-10', '14:00', '15:00')];

    it('available with only viewed calendars (no connection), unavailable with neither', async () => {
      setCalendarClientForTesting(makeClient(vi.fn(async () => [])));
      const store = useCalendarClashStore();
      expect(store.isAvailable).toBe(false);
      setViewed([viewedCalendar('vc-1')], []);
      expect(store.isAvailable).toBe(true);
      await useSettingsStore().setCalendarClashNudgeEnabled(false);
      expect(store.isAvailable).toBe(false);
    });

    it('a viewed calendar alone produces a clash named by the calendar, with no request', async () => {
      const read = vi.fn(async () => []);
      setCalendarClientForTesting(makeClient(read));
      setViewed([viewedCalendar('vc-1')], [viewEvent('vc-1')]);
      const store = useCalendarClashStore();

      await store.ensureBusyForWindow(WINDOW[0], WINDOW[1], occ());
      expect(read).not.toHaveBeenCalled();
      expect(store.clashFor('a1', '2026-06-10')).toEqual(
        expect.objectContaining({
          sourceId: 'vc-1',
          source: 'viewed',
          sourceName: "Grandma's",
          activityId: 'a1',
          occurrenceDate: '2026-06-10',
        })
      );
    });

    it('ignores a transparent ("free") viewed event', async () => {
      setCalendarClientForTesting(makeClient(vi.fn(async () => [])));
      setViewed([viewedCalendar('vc-1')], [viewEvent('vc-1', { transparent: true })]);
      const store = useCalendarClashStore();
      await store.ensureBusyForWindow(WINDOW[0], WINDOW[1], occ());
      expect(store.clashFor('a1', '2026-06-10')).toBeUndefined();
    });

    it('a busy-only viewed event (no title) still clashes', async () => {
      setCalendarClientForTesting(makeClient(vi.fn(async () => [])));
      setViewed(
        [viewedCalendar('vc-1', { detailLevel: 'busy' })],
        [viewEvent('vc-1', { title: undefined, location: undefined, busyOnly: true })]
      );
      const store = useCalendarClashStore();
      await store.ensureBusyForWindow(WINDOW[0], WINDOW[1], occ());
      expect(store.clashFor('a1', '2026-06-10')?.sourceId).toBe('vc-1');
    });

    it("skips a viewed calendar that is a connection's destination (no double count)", async () => {
      // The connection pushes to 'primary', i.e. mum@example.com's own calendar,
      // and that same calendar is also viewed. Its read returns nothing busy, so
      // the only overlap is the viewed copy, which must not count.
      await makeConnection();
      setCalendarClientForTesting(makeClient(vi.fn(async () => [])));
      setViewed([viewedCalendar('vc-1', { calendarId: 'Mum@Example.com' })], [viewEvent('vc-1')]);
      const store = useCalendarClashStore();
      await store.ensureBusyForWindow(WINDOW[0], WINDOW[1], occ());
      expect(store.clashFor('a1', '2026-06-10')).toBeUndefined();
    });

    it('skips a viewed calendar equal to an explicit destination calendar id', async () => {
      await createCalendarConnection({
        provider: 'google',
        accountEmail: 'mum@example.com',
        destinationCalendarId: 'family123@group.calendar.google.com',
        refreshToken: 'r',
        grantedScopes: [OWNED],
        status: 'ok',
      });
      setCalendarClientForTesting(makeClient(vi.fn(async () => [])));
      setViewed(
        [viewedCalendar('vc-1', { calendarId: 'family123@group.calendar.google.com' })],
        [viewEvent('vc-1')]
      );
      const store = useCalendarClashStore();
      await store.ensureBusyForWindow(WINDOW[0], WINDOW[1], occ());
      expect(store.clashFor('a1', '2026-06-10')).toBeUndefined();
    });

    it('source order: connections first, then viewed calendars in their createdAt order', async () => {
      const conn = await makeConnection();
      setCalendarClientForTesting(makeClient(vi.fn(async () => overlappingEvents())));
      const older = viewedCalendar('vc-old', { name: 'Older' });
      const newer = viewedCalendar('vc-new', {
        name: 'Newer',
        createdAt: '2026-11-02T00:00:00.000Z',
      });
      // The view store's `calendars` is already in createdAt order.
      setViewed([older, newer], [viewEvent('vc-new'), viewEvent('vc-old')]);
      const store = useCalendarClashStore();

      await store.ensureBusyForWindow(WINDOW[0], WINDOW[1], occ());
      expect(store.clashFor('a1', '2026-06-10')?.sourceId).toBe(conn.id);

      // With the connection's busy block gone, the older viewed calendar wins.
      store.stop();
      setCalendarClientForTesting(makeClient(vi.fn(async () => [])));
      await store.ensureBusyForWindow(WINDOW[0], WINDOW[1], occ());
      expect(store.clashFor('a1', '2026-06-10')).toMatchObject({
        sourceId: 'vc-old',
        sourceName: 'Older',
      });
    });

    it('recomputes when view events arrive while a window fetch is in flight', async () => {
      await makeConnection();
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const read = vi.fn(async () => {
        await gate;
        return [];
      });
      setCalendarClientForTesting(makeClient(read));
      setViewed([viewedCalendar('vc-1')], []);
      const store = useCalendarClashStore();

      const pending = store.ensureBusyForWindow(WINDOW[0], WINDOW[1], occ());
      expect(store.clashFor('a1', '2026-06-10')).toBeUndefined();

      // Events land for the viewed calendar; the connection read is still running.
      viewStore().events = [viewEvent('vc-1')];
      await nextTick();
      expect(store.clashFor('a1', '2026-06-10')?.sourceId).toBe('vc-1');
      expect(read).toHaveBeenCalledTimes(1);

      release();
      await pending;
      expect(store.clashFor('a1', '2026-06-10')?.sourceId).toBe('vc-1');
    });

    it('clears a viewed clash when its events go away', async () => {
      setCalendarClientForTesting(makeClient(vi.fn(async () => [])));
      setViewed([viewedCalendar('vc-1')], [viewEvent('vc-1')]);
      const store = useCalendarClashStore();
      await store.ensureBusyForWindow(WINDOW[0], WINDOW[1], occ());
      expect(store.clashFor('a1', '2026-06-10')).toBeDefined();

      viewStore().events = [];
      await nextTick();
      expect(store.clashFor('a1', '2026-06-10')).toBeUndefined();
    });
  });
});
