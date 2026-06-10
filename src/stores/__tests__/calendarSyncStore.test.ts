import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { initDoc } from '@/services/automerge/docService';
import { toISODateString } from '@/utils/date';
import {
  createActivity,
  updateActivity,
} from '@/services/automerge/repositories/activityRepository';
import {
  createCalendarConnection,
  getCalendarConnectionById,
  getCalendarEventLink,
} from '@/services/automerge/repositories/calendarRepository';
import { deterministicEventId } from '@/utils/calendar/deterministicEventId';
import { useCalendarSyncStore, setCalendarClientForTesting } from '../calendarSyncStore';
import { CalendarApiError, type CalendarClient } from '@/services/calendar/CalendarClient';
import { getCalendarEventLinksForConnection } from '@/services/automerge/repositories/calendarRepository';
import type { CreateFamilyActivityInput } from '@/types/models';

function makeFakeClient() {
  const calls = { insert: [] as string[], patch: [] as string[], delete: [] as string[] };
  const existing = new Set<string>();
  const client: CalendarClient = {
    async insertEvent(_c, _cal, eventId) {
      calls.insert.push(eventId);
      existing.add(eventId);
    },
    async patchEvent(_c, _cal, eventId) {
      calls.patch.push(eventId);
    },
    async deleteEvent(_c, _cal, eventId) {
      calls.delete.push(eventId);
      existing.delete(eventId);
    },
    async eventExists(_c, _cal, eventId) {
      return existing.has(eventId);
    },
    async listCalendars() {
      return [{ id: 'primary', summary: 'Primary', primary: true }];
    },
    async queryFreeBusy() {
      return {};
    },
  };
  return { client, calls };
}

function todayYmd(): string {
  return toISODateString(new Date()).slice(0, 10);
}

function activityInput(): CreateFamilyActivityInput {
  return {
    title: 'Soccer practice',
    date: todayYmd(),
    recurrence: 'none',
    category: 'sports',
    feeSchedule: 'none',
    reminderMinutes: 0,
    isActive: true,
    createdBy: 'm0',
  } as unknown as CreateFamilyActivityInput;
}

describe('calendarSyncStore reconcile engine (fake client)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    initDoc();
    // Force the flag on regardless of env.
    localStorage.setItem('beanies:flag:googleCalendarSync', 'true');
  });

  afterEach(() => {
    setCalendarClientForTesting(null);
    localStorage.clear();
  });

  it('creates, updates, deletes events and links across the activity lifecycle', async () => {
    const { client, calls } = makeFakeClient();
    setCalendarClientForTesting(client);

    const connection = await createCalendarConnection({
      provider: 'google',
      accountEmail: 'mum@example.com',
      destinationCalendarId: 'primary',
      refreshToken: 'refresh-xyz',
      grantedScopes: ['https://www.googleapis.com/auth/calendar.events.owned'],
      status: 'ok',
    });

    const activity = await createActivity(activityInput());
    const eventId = deterministicEventId(activity.id);
    const store = useCalendarSyncStore();

    // 1. First sync → INSERT + link created.
    await store.syncNow();
    expect(calls.insert).toContain(eventId);
    expect(await getCalendarEventLink(connection.id, activity.id)).toBeDefined();

    // 2. Edit the activity → PATCH (hash changed).
    await updateActivity(activity.id, { title: 'Soccer — new field' });
    await store.syncNow();
    expect(calls.patch).toContain(eventId);

    // 3. Deactivate → DELETE + link removed (GC).
    await updateActivity(activity.id, { isActive: false });
    await store.syncNow();
    expect(calls.delete).toContain(eventId);
    expect(await getCalendarEventLink(connection.id, activity.id)).toBeUndefined();

    // Connection settled to ok (no errors).
    expect((await getCalendarConnectionById(connection.id))?.status).toBe('ok');
  });

  it('disconnect removes events and drops the connection', async () => {
    const { client, calls } = makeFakeClient();
    setCalendarClientForTesting(client);

    const connection = await createCalendarConnection({
      provider: 'google',
      accountEmail: 'dad@example.com',
      destinationCalendarId: 'primary',
      refreshToken: 'refresh-abc',
      grantedScopes: ['https://www.googleapis.com/auth/calendar.events.owned'],
      status: 'ok',
    });
    const activity = await createActivity(activityInput());
    const eventId = deterministicEventId(activity.id);
    const store = useCalendarSyncStore();

    await store.syncNow();
    expect(calls.insert).toContain(eventId);

    await store.disconnect(connection.id);
    expect(calls.delete).toContain(eventId);
    expect(await getCalendarConnectionById(connection.id)).toBeUndefined();
  });

  it('aborts a destination switch when the old-calendar cleanup fails, keeping all links (F6)', async () => {
    // Client inserts fine but every delete throws — the old-calendar cleanup can
    // never complete, so the switch must abort with the destination + links intact.
    const existing = new Set<string>();
    const client: CalendarClient = {
      async insertEvent(_c, _cal, eventId) {
        existing.add(eventId);
      },
      async patchEvent() {},
      async deleteEvent() {
        throw new CalendarApiError('transient', 'boom');
      },
      async eventExists(_c, _cal, eventId) {
        return existing.has(eventId);
      },
      async listCalendars() {
        return [{ id: 'cal-old', summary: 'Old', primary: true }];
      },
      async queryFreeBusy() {
        return {};
      },
    };
    setCalendarClientForTesting(client);

    const connection = await createCalendarConnection({
      provider: 'google',
      accountEmail: 'mum@example.com',
      destinationCalendarId: 'cal-old',
      refreshToken: 'r',
      grantedScopes: ['https://www.googleapis.com/auth/calendar.events.owned'],
      status: 'ok',
    });
    const activity = await createActivity(activityInput());
    const store = useCalendarSyncStore();

    // Seed a link on the old calendar.
    await store.syncNow();
    expect(await getCalendarEventLink(connection.id, activity.id)).toBeDefined();

    // Switch to a new calendar — the old-calendar delete throws → abort.
    const result = await store.setDestinationCalendar(connection.id, 'cal-new');
    expect(result).toEqual({ ok: false });

    // Destination unchanged and the link is still present (reconcile self-heals).
    expect((await getCalendarConnectionById(connection.id))?.destinationCalendarId).toBe('cal-old');
    expect(await getCalendarEventLink(connection.id, activity.id)).toBeDefined();
    expect((await getCalendarEventLinksForConnection(connection.id)).length).toBe(1);
  });

  it('normalizes a "primary" destination to the concrete calendar id for the picker', async () => {
    const client: CalendarClient = {
      async insertEvent() {},
      async patchEvent() {},
      async deleteEvent() {},
      async eventExists() {
        return true;
      },
      async listCalendars() {
        return [
          { id: 'owner@example.com', summary: 'owner@example.com', primary: true },
          { id: 'work', summary: 'Work', primary: false },
        ];
      },
      async queryFreeBusy() {
        return {};
      },
    };
    setCalendarClientForTesting(client);

    const connection = await createCalendarConnection({
      provider: 'google',
      accountEmail: 'owner@example.com',
      destinationCalendarId: 'primary',
      refreshToken: 'r',
      grantedScopes: ['https://www.googleapis.com/auth/calendar.calendarlist.readonly'],
      status: 'ok',
    });
    const store = useCalendarSyncStore();

    const cals = await store.listCalendarsFor(connection.id);
    expect(cals.map((c) => c.id)).toContain('owner@example.com');
    // 'primary' is normalized to the real primary id so the picker shows it selected.
    expect((await getCalendarConnectionById(connection.id))?.destinationCalendarId).toBe(
      'owner@example.com'
    );
  });
});
