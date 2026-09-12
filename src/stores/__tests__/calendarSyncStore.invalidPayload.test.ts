/**
 * A payload Google refuses with a 400 is refused FOREVER — so beanies stops
 * sending it, and stops paging about it.
 *
 * `CalendarErrorKind` has said so since it was written: `'invalid' // 400 → Google
 * rejected the request body/params — deterministic, never retryable`. The reconcile
 * loop never honoured it, so one family's single bad event was re-sent every five
 * minutes from every device for days, re-paging Slack once per app session and
 * leaving their connection stamped `error` the whole time.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { installInlineBackend } from '@/services/automerge/worker/__tests__/inlineHarness';
import { toISODateString } from '@/utils/date';
import {
  createActivity,
  updateActivity,
} from '@/services/automerge/repositories/activityRepository';
import {
  createCalendarConnection,
  getCalendarConnectionById,
} from '@/services/automerge/repositories/calendarRepository';
import { useCalendarSyncStore, setCalendarClientForTesting } from '../calendarSyncStore';
import { CalendarApiError } from '@/services/calendar/CalendarClient';
import { makeCalendarClientStub } from '@/services/calendar/__tests__/fakeCalendarClient';
import type { CreateFamilyActivityInput } from '@/types/models';

vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/services/calendar/calendarAuth', () => ({
  connectGoogleCalendar: vi.fn(),
  isCalendarConnectSupported: vi.fn(() => true),
}));

function todayYmd(): string {
  return toISODateString(new Date()).slice(0, 10);
}

function activityInput(over: Partial<CreateFamilyActivityInput> = {}) {
  return {
    title: 'Soccer practice',
    date: todayYmd(),
    recurrence: 'none',
    category: 'sports',
    feeSchedule: 'none',
    reminderMinutes: 0,
    isActive: true,
    createdBy: 'm0',
    ...over,
  } as unknown as CreateFamilyActivityInput;
}

/** A client whose insert always fails the way Google fails a malformed body. */
function rejectingClient(kind: 'invalid' | 'rate_limited') {
  const attempts: string[] = [];
  const client = makeCalendarClientStub({
    async insertEvent(_c, _cal, eventId) {
      attempts.push(eventId);
      throw kind === 'invalid'
        ? new CalendarApiError('invalid', 'Google Calendar HTTP 400 (Invalid start time.)', 400)
        : new CalendarApiError('rate_limited', 'Google Calendar HTTP 429', 429);
    },
    async eventExists() {
      return false;
    },
  });
  return { client, attempts };
}

async function connect() {
  return createCalendarConnection({
    provider: 'google',
    accountEmail: 'mum@example.com',
    destinationCalendarId: 'primary',
    refreshToken: 'refresh-xyz',
    grantedScopes: ['https://www.googleapis.com/auth/calendar.events.owned'],
    status: 'ok',
  });
}

beforeEach(async () => {
  setActivePinia(createPinia());
  await installInlineBackend();
  localStorage.setItem('beanies:flag:googleCalendarSync', 'true');
  vi.clearAllMocks();
});

describe('a deterministic 400 is not retried', () => {
  it('🔴 sends the doomed body ONCE, however many times we reconcile', async () => {
    const { client, attempts } = rejectingClient('invalid');
    setCalendarClientForTesting(client);
    await connect();
    await createActivity(activityInput());
    const store = useCalendarSyncStore();

    await store.syncNow();
    await store.syncNow();
    await store.syncNow();

    expect(attempts).toHaveLength(1);
  });

  it('🔴 a TRANSIENT failure is still retried every time', async () => {
    // Anti-vacuity, and the requirement that matters most: the memo must not
    // swallow a 429 or a 5xx, which succeed on the next attempt by definition.
    const { client, attempts } = rejectingClient('rate_limited');
    setCalendarClientForTesting(client);
    await connect();
    await createActivity(activityInput());
    const store = useCalendarSyncStore();

    await store.syncNow();
    await store.syncNow();

    expect(attempts.length).toBeGreaterThan(1);
  });

  it('🔴 RETRIES the moment the user edits the activity', async () => {
    // The whole reason the memo is keyed on the push HASH rather than the activity
    // id. Keyed on the id, a family that fixed their event would never see it sync
    // again — a self-healing situation turned permanent, which is strictly worse
    // than the bug this fixes.
    const { client, attempts } = rejectingClient('invalid');
    setCalendarClientForTesting(client);
    await connect();
    const a = await createActivity(activityInput());
    const store = useCalendarSyncStore();

    await store.syncNow();
    expect(attempts).toHaveLength(1);

    await store.syncNow();
    expect(attempts).toHaveLength(1); // still memoised — nothing changed

    await updateActivity(a.id, { title: 'Soccer practice (fixed)' });
    await store.syncNow();
    expect(attempts).toHaveLength(2); // the body changed, so it is worth trying again
  });

  it('leaves the connection healthy — one unsendable event is not a broken connection', async () => {
    // The family's Settings card said "error" for days because of this.
    const { client } = rejectingClient('invalid');
    setCalendarClientForTesting(client);
    const conn = await connect();
    await createActivity(activityInput());

    await useCalendarSyncStore().syncNow();

    const after = await getCalendarConnectionById(conn.id);
    expect(after?.status).toBe('ok');
    expect(after?.lastError).toBeUndefined();
  });

  it('🔴 a transient failure DOES still mark the connection', async () => {
    // Anti-vacuity for the assertion above.
    const { client } = rejectingClient('rate_limited');
    setCalendarClientForTesting(client);
    const conn = await connect();
    await createActivity(activityInput());

    await useCalendarSyncStore().syncNow();

    expect((await getCalendarConnectionById(conn.id))?.status).toBe('error');
  });
});

describe('what reaches Slack', () => {
  it('reports the rejection ONCE, at warning — not once per session forever', async () => {
    const { reportError } = await import('@/utils/errorReporter');
    const mockReport = vi.mocked(reportError);
    const { client } = rejectingClient('invalid');
    setCalendarClientForTesting(client);
    await connect();
    await createActivity(activityInput());
    const store = useCalendarSyncStore();

    await store.syncNow();
    await store.syncNow();
    await store.syncNow();

    const rejections = mockReport.mock.calls.filter(
      (c) => (c[0] as { context?: { action?: string } }).context?.action === 'push-rejected'
    );
    expect(rejections).toHaveLength(1);
    expect((rejections[0]![0] as { severity?: string }).severity).toBe('warning');
  });

  it('never pages critical for it, however long it stays broken', async () => {
    // The old behaviour: three consecutive failures crossed the sustained
    // threshold and fired `critical`. A 400 can never clear, so that paged a
    // family's single bad event to Slack in perpetuity.
    const { reportError } = await import('@/utils/errorReporter');
    const mockReport = vi.mocked(reportError);
    const { client } = rejectingClient('invalid');
    setCalendarClientForTesting(client);
    await connect();
    await createActivity(activityInput());
    const store = useCalendarSyncStore();

    for (let i = 0; i < 5; i++) await store.syncNow();

    const severities = mockReport.mock.calls.map((c) => (c[0] as { severity?: string }).severity);
    expect(severities).not.toContain('critical');
  });
});

describe('🔴 when EVERYTHING is refused, the problem is not the records', () => {
  /**
   * The regression the quarantine could have introduced, and the reason for the
   * systemic guard.
   *
   * `timeZone` and `appOrigin` ride in every body, so ONE bad context value makes
   * every push invalid. Quarantining each in turn would leave `errors` empty, write
   * `status: 'ok'` with a fresh `lastSyncedAt`, and silently stop the family's whole
   * calendar while Settings read "synced just now" — strictly worse than the bug
   * being fixed, because the old code at least said `error` and paged.
   */
  it('marks the connection broken rather than reporting it healthy', async () => {
    const { client } = rejectingClient('invalid');
    setCalendarClientForTesting(client);
    const conn = await connect();
    await createActivity(activityInput({ title: 'One' }));
    await createActivity(activityInput({ title: 'Two' }));
    await createActivity(activityInput({ title: 'Three' }));

    await useCalendarSyncStore().syncNow();

    const after = await getCalendarConnectionById(conn.id);
    expect(after?.status).toBe('error');
    expect(after?.lastError).toBe('invalid');
  });

  it('but a SINGLE bad event still leaves the connection healthy', async () => {
    // The floor is two, precisely so one malformed record never trips it.
    const { client } = rejectingClient('invalid');
    setCalendarClientForTesting(client);
    const conn = await connect();
    await createActivity(activityInput());

    await useCalendarSyncStore().syncNow();

    expect((await getCalendarConnectionById(conn.id))?.status).toBe('ok');
  });
});
