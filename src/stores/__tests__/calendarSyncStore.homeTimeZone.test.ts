/**
 * The family HOME time zone in the reconcile engine (2026-10-06).
 *
 * The incident this guards: a relative's Los Angeles laptop opened the family's pod
 * and re-stamped 47 Singapore events in `America/Los_Angeles` (right wall clock,
 * wrong instant: a 10:45 Saturday lesson became 01:45 Sunday for everyone else). The
 * hash excluded the zone, so no Singapore device ever repaired it, and the shifted
 * instances made "no Google instance matches" fire ~3,500 times a day.
 *
 * Every test here runs as a Los Angeles device (`deviceTimeZone` is pinned), so a
 * push that leaked the device zone would fail loudly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { installInlineBackend } from '@/services/automerge/worker/__tests__/inlineHarness';
import { addDaysYmd, localToday } from '@/utils/date';
import {
  createActivity,
  getAllActivities,
  updateActivity,
} from '@/services/automerge/repositories/activityRepository';
import {
  createCalendarConnection,
  getCalendarEventLink,
  updateCalendarEventLink,
} from '@/services/automerge/repositories/calendarRepository';
import { saveSettings } from '@/services/automerge/repositories/settingsRepository';
import { useCalendarSyncStore, setCalendarClientForTesting } from '../calendarSyncStore';
import { makeCalendarClientStub } from '@/services/calendar/__tests__/fakeCalendarClient';
import { CalendarApiError, type CalendarInstance } from '@/services/calendar/CalendarClient';
import { computePushHash, type GoogleEventResource } from '@/utils/calendar/activityToGoogleEvent';
import type { CreateFamilyActivityInput, FamilyActivity } from '@/types/models';

const { logEventMock } = vi.hoisted(() => ({ logEventMock: vi.fn() }));

vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/services/telemetry', () => ({ logEvent: logEventMock }));
// A Los Angeles device. Partial: every other helper (the resolver included) is real.
vi.mock('@/utils/timeZone', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/timeZone')>()),
  deviceTimeZone: () => 'America/Los_Angeles',
  knownDeviceTimeZone: () => 'America/Los_Angeles',
}));

const LA = 'America/Los_Angeles';
const SG = 'Asia/Singapore';
const OWNED = 'https://www.googleapis.com/auth/calendar.events.owned';
const OCC = addDaysYmd(localToday(), 5);
const NO_NAMES = { memberName: () => undefined };

type Sent = { eventId: string; resource: GoogleEventResource };

function makeClient(instancesFor: (masterId: string) => CalendarInstance[] = () => []) {
  const calls = {
    insert: [] as Sent[],
    patch: [] as Sent[],
    patchFields: [] as Array<{ eventId: string; patch: unknown }>,
    listInstancesTz: [] as string[],
  };
  const client = makeCalendarClientStub({
    async insertEvent(_c, _cal, eventId, resource) {
      calls.insert.push({ eventId, resource });
    },
    async patchEvent(_c, _cal, eventId, resource) {
      calls.patch.push({ eventId, resource });
    },
    async patchEventFields(_c, _cal, eventId, patch) {
      calls.patchFields.push({ eventId, patch });
    },
    async listInstances(_c, _cal, masterEventId, _min, _max, timeZone) {
      calls.listInstancesTz.push(timeZone);
      return instancesFor(masterEventId);
    },
  });
  return { client, calls };
}

function lesson(overrides: Partial<CreateFamilyActivityInput> = {}): CreateFamilyActivityInput {
  return {
    title: 'Piano',
    date: localToday(),
    startTime: '10:45',
    endTime: '11:30',
    recurrence: 'none',
    category: 'music',
    feeSchedule: 'none',
    reminderMinutes: 0,
    isActive: true,
    createdBy: 'm0',
    ...overrides,
  } as unknown as CreateFamilyActivityInput;
}

async function seedConnection() {
  return createCalendarConnection({
    provider: 'google',
    accountEmail: 'mum@example.com',
    destinationCalendarId: 'primary',
    refreshToken: 'r',
    grantedScopes: [OWNED],
    status: 'ok',
  });
}

const logged = (action: string) =>
  logEventMock.mock.calls.filter(([e]) => e.context?.action === action).map(([e]) => e);

describe('calendarSyncStore — family home time zone', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await installInlineBackend();
    localStorage.setItem('beanies:flag:googleCalendarSync', 'true');
    logEventMock.mockClear();
  });
  afterEach(() => {
    // `stop()` clears the session memos, so each test starts from a fresh session.
    useCalendarSyncStore().stop();
    setCalendarClientForTesting(null);
    localStorage.clear();
  });

  it('with home Asia/Singapore, an LA device stamps Asia/Singapore', async () => {
    const { client, calls } = makeClient();
    setCalendarClientForTesting(client);
    await saveSettings({ homeTimeZone: SG });
    await seedConnection();
    await createActivity(lesson());

    await useCalendarSyncStore().syncNow();

    expect(calls.insert).toHaveLength(1);
    expect(calls.insert[0]!.resource.start).toEqual({
      dateTime: `${localToday()}T10:45:00`,
      timeZone: SG,
    });
  });

  it('with no home zone and no country, falls back to the device zone and hashes as before', async () => {
    const { client, calls } = makeClient();
    setCalendarClientForTesting(client);
    const connection = await seedConnection();
    const activity = await createActivity(lesson());

    await useCalendarSyncStore().syncNow();

    expect(calls.insert[0]!.resource.start).toMatchObject({ timeZone: LA });
    const link = await getCalendarEventLink(connection.id, activity.id);
    // The pre-home-zone hash: a device zone is NEVER hashed (it would ping-pong).
    expect(link?.lastPushedHash).toBe(computePushHash(activity, { ...NO_NAMES, hashZone: '' }));
  });

  it('persisting the home zone re-pushes a beanies-created event ONCE, in the home zone', async () => {
    const { client, calls } = makeClient();
    setCalendarClientForTesting(client);
    await seedConnection();
    await createActivity(lesson());
    const store = useCalendarSyncStore();

    await store.syncNow(); // stamped LA (fallback) — the incident's state
    expect(calls.patch).toHaveLength(0);

    await saveSettings({ homeTimeZone: SG });
    await store.syncNow(); // the repair
    expect(calls.patch).toHaveLength(1);
    expect(calls.patch[0]!.resource.start).toMatchObject({ timeZone: SG });

    await store.syncNow(); // converged: no oscillation
    expect(calls.patch).toHaveLength(1);
  });

  it('an ADOPTED link is NOT re-pushed when the home zone is persisted', async () => {
    const { client, calls } = makeClient();
    setCalendarClientForTesting(client);
    const connection = await seedConnection();
    const activity = await createActivity(lesson());
    const store = useCalendarSyncStore();
    await store.syncNow();
    const link = await getCalendarEventLink(connection.id, activity.id);
    await updateCalendarEventLink(link!.id, { origin: 'adopted' });

    await saveSettings({ homeTimeZone: SG });
    await store.syncNow();

    // A re-push would replace the family's own description and clear their reminders.
    expect(calls.patch).toHaveLength(0);
  });

  it('a stored zone this engine does not know is STILL stamped and hashed as stored', async () => {
    const { client, calls } = makeClient();
    setCalendarClientForTesting(client);
    const connection = await seedConnection();
    const activity = await createActivity(lesson());
    // Bypasses `setHomeTimeZone`'s validation: another engine wrote an id this one lacks.
    await saveSettings({ homeTimeZone: 'Mars/Olympus_Mons' });
    const store = useCalendarSyncStore();

    await store.syncNow();
    await store.syncNow();

    expect(calls.insert[0]!.resource.start).toMatchObject({ timeZone: 'Mars/Olympus_Mons' });
    const link = await getCalendarEventLink(connection.id, activity.id);
    expect(link?.lastPushedHash).toBe(
      computePushHash(activity, { ...NO_NAMES, hashZone: 'Mars/Olympus_Mons' })
    );
    expect(calls.patch).toHaveLength(0); // stable: no ping-pong on this engine either
    // Warned once per session, and the raw id never reaches telemetry.
    expect(logged('invalid-stored')).toHaveLength(1);
    // `resolve` reports `unknown`, not a false `device-same` from the formatter throwing.
    expect(logEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { action: 'resolve', kind: 'family', detail: 'unknown' },
      })
    );
    expect(JSON.stringify(logEventMock.mock.calls)).not.toContain('Mars/Olympus_Mons');
  });

  it('logs `resolve` once per session per (source, device-differs) pair, without the zone id', async () => {
    const { client } = makeClient();
    setCalendarClientForTesting(client);
    await saveSettings({ homeTimeZone: SG });
    await seedConnection();
    const store = useCalendarSyncStore();

    await store.syncNow();
    await store.syncNow();
    expect(logged('resolve')).toEqual([
      expect.objectContaining({
        surface: 'home-time-zone',
        level: 'info',
        context: { action: 'resolve', kind: 'family', detail: 'device-differs' },
      }),
    ]);
    expect(JSON.stringify(logged('resolve'))).not.toContain(SG);

    // A new session logs again.
    store.stop();
    setCalendarClientForTesting(client);
    await store.syncNow();
    expect(logged('resolve')).toHaveLength(2);
  });
});

describe('calendarSyncStore — home zone and recurring-instance exceptions', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await installInlineBackend();
    localStorage.setItem('beanies:flag:googleCalendarSync', 'true');
    logEventMock.mockClear();
  });
  afterEach(() => {
    useCalendarSyncStore().stop();
    setCalendarClientForTesting(null);
    localStorage.clear();
  });

  async function seedSeries() {
    const master = await createActivity(
      lesson({ recurrence: 'daily', date: addDaysYmd(localToday(), -1) })
    );
    const child = await createActivity(
      lesson({ title: 'Piano (moved room)', parentActivityId: master!.id, date: OCC })
    );
    return { master: master as FamilyActivity, child: child as FamilyActivity };
  }

  it('listInstances is asked to render in the resolved home zone', async () => {
    const { client, calls } = makeClient((m) => [
      { id: `${m}__inst`, originalStartTime: { date: OCC } },
    ]);
    setCalendarClientForTesting(client);
    await saveSettings({ homeTimeZone: SG });
    await seedConnection();
    await seedSeries();

    await useCalendarSyncStore().syncNow();

    expect(calls.listInstancesTz).toEqual([SG]);
    expect(calls.patchFields).toHaveLength(1);
  });

  it('"no Google instance matches" logs ONCE per exception hash, while the retry still runs', async () => {
    // An instance on a different day never matches the occurrence.
    const { client, calls } = makeClient((m) => [
      { id: `${m}__other`, originalStartTime: { date: addDaysYmd(OCC, 1) } },
    ]);
    setCalendarClientForTesting(client);
    await seedConnection();
    const { child } = await seedSeries();
    const store = useCalendarSyncStore();
    const deferrals = () =>
      logged('exception-deferred').filter((e) => e.context.recur_outcome === 'no-instance');

    await store.syncNow();
    await store.syncNow();
    expect(calls.listInstancesTz).toHaveLength(2); // retried every pass
    expect(deferrals()).toHaveLength(1); // logged once

    await updateActivity(child.id, { title: 'Piano (moved again)' }); // new hash
    await store.syncNow();
    expect(deferrals()).toHaveLength(2);
  });

  it('a zone change that kills the stored instance id recovers via drop-and-defer', async () => {
    let instanceId = 'inst-la';
    const { client, calls } = makeClient(() => [
      { id: instanceId, originalStartTime: { date: OCC } },
    ]);
    // Re-pushing the master in a new zone moves its UTC instant, and Google mints new
    // instance ids: the stored one now 404s.
    const original = client.patchEventFields.bind(client);
    client.patchEventFields = async (c, cal, eventId, patch) => {
      if (eventId === 'inst-la' && instanceId !== 'inst-la') {
        throw new CalendarApiError('not_found', 'Google Calendar HTTP 404', 404);
      }
      return original(c, cal, eventId, patch);
    };
    setCalendarClientForTesting(client);
    const connection = await seedConnection();
    const { child } = await seedSeries();
    const store = useCalendarSyncStore();

    await store.syncNow(); // LA fallback: exception patched on inst-la, id stored
    expect((await getCalendarEventLink(connection.id, child.id))?.googleEventId).toBe('inst-la');

    await saveSettings({ homeTimeZone: SG });
    instanceId = 'inst-sg';
    await store.syncNow(); // master repaired; the exception's stored id is dead → dropped
    expect(
      calls.patch.some((p) => 'timeZone' in p.resource.start && p.resource.start.timeZone === SG)
    ).toBe(true);
    expect(await getCalendarEventLink(connection.id, child.id)).toBeUndefined();
    expect(logged('exception-instance-not-found')).toHaveLength(1);

    await store.syncNow(); // re-discovered in the home zone and re-patched
    expect(calls.listInstancesTz).toEqual([LA, SG]);
    expect((await getCalendarEventLink(connection.id, child.id))?.googleEventId).toBe('inst-sg');
    expect(calls.patchFields.at(-1)!.eventId).toBe('inst-sg');
    // Nothing else in the pod was left behind.
    expect((await getAllActivities()).length).toBe(2);
  });
});
