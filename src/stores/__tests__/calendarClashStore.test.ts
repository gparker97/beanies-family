import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { initDoc } from '@/services/automerge/docService';
import { createCalendarConnection } from '@/services/automerge/repositories/calendarRepository';
import { setCalendarClientForTesting } from '@/services/calendar/clientInstance';
import { CalendarApiError, type CalendarClient } from '@/services/calendar/CalendarClient';
import type { ActivityOccurrence } from '@/utils/calendar/clashDetection';
import { useCalendarClashStore } from '../calendarClashStore';
import { useSettingsStore } from '@/stores/settingsStore';

const { reportErrorMock } = vi.hoisted(() => ({ reportErrorMock: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: reportErrorMock }));

const OWNED = 'https://www.googleapis.com/auth/calendar.events.owned';
const FREEBUSY = 'https://www.googleapis.com/auth/calendar.freebusy';

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

function makeClient(queryFreeBusy: CalendarClient['queryFreeBusy']): CalendarClient {
  return {
    async insertEvent() {},
    async patchEvent() {},
    async deleteEvent() {},
    async eventExists() {
      return true;
    },
    async listCalendars() {
      return [];
    },
    queryFreeBusy,
  };
}

async function makeFreebusyConnection() {
  return createCalendarConnection({
    provider: 'google',
    accountEmail: 'mum@example.com',
    destinationCalendarId: 'primary',
    refreshToken: 'r',
    grantedScopes: [OWNED, FREEBUSY],
    status: 'ok',
  });
}

const WINDOW = ['2026-06-10T00:00:00Z', '2026-06-11T00:00:00Z'] as const;
const overlappingBusy = () => ({
  primary: [
    {
      start: new Date(localMs('2026-06-10', '14:30')).toISOString(),
      end: new Date(localMs('2026-06-10', '16:00')).toISOString(),
    },
  ],
});

describe('calendarClashStore (#34)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    initDoc();
    localStorage.setItem('beanies:flag:calendarClashNudge', 'true');
    localStorage.setItem('beanies:flag:googleCalendarSync', 'true');
    reportErrorMock.mockClear();
  });
  afterEach(() => {
    setCalendarClientForTesting(null);
    localStorage.clear();
  });

  it('partial grant (no freebusy scope) → unavailable, no queries', async () => {
    await createCalendarConnection({
      provider: 'google',
      accountEmail: 'dad@example.com',
      destinationCalendarId: 'primary',
      refreshToken: 'r',
      grantedScopes: [OWNED], // freebusy declined
      status: 'ok',
    });
    const query = vi.fn(async () => ({}));
    setCalendarClientForTesting(makeClient(query));
    const store = useCalendarClashStore();
    expect(store.isAvailable).toBe(false);

    await store.ensureBusyForWindow(WINDOW[0], WINDOW[1], [
      timedOcc('a1', '2026-06-10', '14:00', '15:00'),
    ]);
    expect(query).not.toHaveBeenCalled();
    expect(store.clashFor('a1', '2026-06-10')).toBeUndefined();
  });

  it('toggle off → unavailable, no queries', async () => {
    await makeFreebusyConnection();
    const query = vi.fn(async () => overlappingBusy());
    setCalendarClientForTesting(makeClient(query));
    await useSettingsStore().setCalendarClashNudgeEnabled(false);
    const store = useCalendarClashStore();
    expect(store.isAvailable).toBe(false);

    await store.ensureBusyForWindow(WINDOW[0], WINDOW[1], [
      timedOcc('a1', '2026-06-10', '14:00', '15:00'),
    ]);
    expect(query).not.toHaveBeenCalled();
  });

  it('happy path → clashFor resolves to the connection, decoration recomputed', async () => {
    const conn = await makeFreebusyConnection();
    const query = vi.fn(async () => overlappingBusy());
    setCalendarClientForTesting(makeClient(query));
    const store = useCalendarClashStore();
    expect(store.clashFor('a1', '2026-06-10')).toBeUndefined();

    await store.ensureBusyForWindow(WINDOW[0], WINDOW[1], [
      timedOcc('a1', '2026-06-10', '14:00', '15:00'),
    ]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(store.clashFor('a1', '2026-06-10')).toEqual({
      connectionId: conn.id,
      calendarLabel: 'mum@example.com',
    });
  });

  it('TTL reuse → same window within TTL issues no new query', async () => {
    await makeFreebusyConnection();
    const query = vi.fn(async () => overlappingBusy());
    setCalendarClientForTesting(makeClient(query));
    const store = useCalendarClashStore();
    const occ = [timedOcc('a1', '2026-06-10', '14:00', '15:00')];

    await store.ensureBusyForWindow(WINDOW[0], WINDOW[1], occ);
    await store.ensureBusyForWindow(WINDOW[0], WINDOW[1], occ);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('a concurrent same-window call while in flight does not duplicate the fetch', async () => {
    await makeFreebusyConnection();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const query = vi.fn(async () => {
      await gate;
      return overlappingBusy();
    });
    setCalendarClientForTesting(makeClient(query));
    const store = useCalendarClashStore();
    const occ = [timedOcc('a1', '2026-06-10', '14:00', '15:00')];

    const p1 = store.ensureBusyForWindow(WINDOW[0], WINDOW[1], occ);
    const p2 = store.ensureBusyForWindow(WINDOW[0], WINDOW[1], occ); // in-flight → short-circuits
    release();
    await Promise.all([p1, p2]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('a throwing free/busy query degrades silently but reports once (no bare catch)', async () => {
    await makeFreebusyConnection();
    const query = vi.fn(async () => {
      throw new CalendarApiError('transient', 'boom');
    });
    setCalendarClientForTesting(makeClient(query));
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
    await makeFreebusyConnection();
    setCalendarClientForTesting(makeClient(vi.fn(async () => overlappingBusy())));
    const store = useCalendarClashStore();
    await store.ensureBusyForWindow(WINDOW[0], WINDOW[1], [
      timedOcc('a1', '2026-06-10', '14:00', '15:00'),
    ]);
    expect(store.clashFor('a1', '2026-06-10')).toBeDefined();

    store.stop();
    expect(store.clashFor('a1', '2026-06-10')).toBeUndefined();
  });
});
