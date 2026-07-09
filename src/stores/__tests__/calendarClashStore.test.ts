import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { installInlineBackend } from '@/services/automerge/worker/__tests__/inlineHarness';
import { createCalendarConnection } from '@/services/automerge/repositories/calendarRepository';
import { setCalendarClientForTesting } from '@/services/calendar/clientInstance';
import { CalendarApiError, type CalendarClient } from '@/services/calendar/CalendarClient';
import type { ActivityOccurrence } from '@/utils/calendar/clashDetection';
import { deterministicEventId } from '@/utils/calendar/deterministicEventId';
import { useCalendarClashStore } from '../calendarClashStore';
import { useSettingsStore } from '@/stores/settingsStore';

const { reportErrorMock } = vi.hoisted(() => ({ reportErrorMock: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: reportErrorMock }));

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
  return {
    invalidateConnection() {},
    async insertEvent() {},
    async patchEvent() {},
    async deleteEvent() {},
    async eventExists() {
      return true;
    },
    async listCalendars() {
      return [];
    },
    listEventTimes,
  };
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
        connectionId: conn.id,
        calendarLabel: 'mum@example.com',
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
});
