/**
 * The import store's contract, and the two things about it that would be
 * destructive if they regressed:
 *
 *  1. The commit writes NOTHING to Google. Zero client calls.
 *  2. `lastPushedHash` is computed WITH the member-name resolver, or the next
 *     reconcile disagrees and pushes every imported event straight back, which for
 *     an adopted event rewrites the user's real event body.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { ALLOWED_CONTEXT_KEYS } from '@/utils/diagnosticContext';

const {
  listEventsForImportMock,
  listCalendarsForMock,
  createImportedActivitiesMock,
  getAllLinksMock,
  loadActivitiesMock,
  logEventMock,
  reportErrorMock,
} = vi.hoisted(() => ({
  listEventsForImportMock: vi.fn(),
  listCalendarsForMock: vi.fn(),
  createImportedActivitiesMock: vi.fn(),
  getAllLinksMock: vi.fn(),
  loadActivitiesMock: vi.fn(),
  logEventMock: vi.fn(),
  reportErrorMock: vi.fn(),
}));

/** Every client method, so an unexpected WRITE is a loud failure not a stub hit. */
const clientCalls: string[] = [];
const client = new Proxy({} as Record<string, unknown>, {
  get(_t, prop: string) {
    if (prop === 'listEventsForImport') {
      return (...args: unknown[]) => {
        clientCalls.push('listEventsForImport');
        return listEventsForImportMock(...args);
      };
    }
    return () => {
      clientCalls.push(prop);
      return Promise.resolve();
    };
  },
});

vi.mock('@/services/calendar/clientInstance', () => ({ getCalendarClient: () => client }));
vi.mock('@/services/automerge/repositories/calendarRepository', async (importOriginal) => {
  // The REAL `ImportNotVisibleError`, because `commit()` narrows its catch on it
  // and a stand-in class would make that branch untestable (and untested).
  const actual =
    await importOriginal<typeof import('@/services/automerge/repositories/calendarRepository')>();
  return {
    ImportNotVisibleError: actual.ImportNotVisibleError,
    createImportedActivities: createImportedActivitiesMock,
    getAllCalendarEventLinks: getAllLinksMock,
  };
});
vi.mock('@/stores/activityStore', () => ({
  useActivityStore: () => ({ loadActivities: loadActivitiesMock }),
}));
vi.mock('@/stores/calendarSyncStore', () => ({
  useCalendarSyncStore: () => ({
    connections: [{ id: 'c1', destinationCalendarId: 'dest' }],
    listCalendarsFor: listCalendarsForMock,
  }),
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ currentUser: { memberId: 'me' } }),
}));
vi.mock('@/stores/familyStore', () => ({ useFamilyStore: () => ({ members: [{ id: 'me' }] }) }));
vi.mock('@/services/telemetry', () => ({ logEvent: logEventMock }));
vi.mock('@/utils/errorReporter', () => ({ reportError: reportErrorMock }));
vi.mock('@/utils/calendar/memberNames', () => ({
  makeMemberNameResolver: () => (id: string) => (id === 'me' ? 'Greg' : undefined),
}));

import { useCalendarImportStore, IMPORT_MAX_CANDIDATES } from '../calendarImportStore';
import { ImportNotVisibleError } from '@/services/automerge/repositories/calendarRepository';
import { computePushHash } from '@/utils/calendar/activityToGoogleEvent';

const timedEvent = (over: Record<string, unknown> = {}) => ({
  id: 'g-1',
  summary: 'Joey swimming',
  start: { dateTime: '2026-09-15T16:00:00+08:00' },
  end: { dateTime: '2026-09-15T16:45:00+08:00' },
  isOrganizer: true,
  ...over,
});

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  clientCalls.length = 0;
  getAllLinksMock.mockResolvedValue([]);
  listCalendarsForMock.mockResolvedValue([
    { id: 'dest', summary: 'Greg', primary: true, accessRole: 'owner' },
    { id: 'hols', summary: 'Holidays', primary: false, accessRole: 'reader' },
  ]);
  listEventsForImportMock.mockResolvedValue([timedEvent()]);
  createImportedActivitiesMock.mockImplementation(async (entries: unknown[]) =>
    entries.map((_e, i) => ({ id: `a${i}` }))
  );
});

describe('choosing calendars', () => {
  it('ticks every readable calendar and leaves read-only ones out', async () => {
    const store = useCalendarImportStore();
    await store.open('c1');

    expect(store.chosenCalendarIds.has('dest')).toBe(true);
    // A holiday feed the granted scope cannot read would otherwise fill the row cap
    // with junk and push the family's real events out of the list.
    expect(store.chosenCalendarIds.has('hols')).toBe(false);
  });

  it('treats an absent accessRole as owner, failing OPEN', async () => {
    listCalendarsForMock.mockResolvedValue([{ id: 'dest', summary: 'X', primary: true }]);
    const store = useCalendarImportStore();
    await store.open('c1');
    expect(store.chosenCalendarIds.has('dest')).toBe(true);
  });

  it('includes a calendar the user can WRITE to but does not own', async () => {
    // The shared family calendar is exactly the one a parent most wants brought
    // across. Restricting this to `owner` greyed it out as "read only", which was
    // both false and the opposite of what the label meant.
    listCalendarsForMock.mockResolvedValue([
      { id: 'dest', summary: 'Greg', primary: true, accessRole: 'owner' },
      { id: 'shared', summary: 'Family', primary: false, accessRole: 'writer' },
    ]);
    const store = useCalendarImportStore();
    await store.open('c1');
    expect(store.chosenCalendarIds.has('shared')).toBe(true);
  });
});

describe('scanning', () => {
  it('only reads the chosen calendars', async () => {
    const store = useCalendarImportStore();
    await store.open('c1');
    await store.scan();
    expect(listEventsForImportMock).toHaveBeenCalledTimes(1);
    expect(listEventsForImportMock.mock.calls[0][1]).toBe('dest');
  });

  it('ticks every actionable row when the review opens', async () => {
    const store = useCalendarImportStore();
    await store.open('c1');
    await store.scan();
    expect(store.phase).toBe('reviewing');
    expect(store.selectedCount).toBe(1);
  });

  it('a calendar it cannot read is a SKIP with a reason, not a failed run', async () => {
    listCalendarsForMock.mockResolvedValue([
      { id: 'dest', summary: 'A', primary: true, accessRole: 'owner' },
      { id: 'other', summary: 'B', primary: false, accessRole: 'owner' },
    ]);
    listEventsForImportMock
      .mockResolvedValueOnce([timedEvent()])
      .mockRejectedValueOnce(new Error('403'));

    const store = useCalendarImportStore();
    await store.open('c1');
    await store.scan();

    expect(store.phase).toBe('reviewing');
    expect(store.candidates).toHaveLength(1); // the readable one still arrived
    expect(store.skippedCalendars).toHaveLength(1);
  });

  it('never writes anything to Google while scanning', async () => {
    const store = useCalendarImportStore();
    await store.open('c1');
    await store.scan();
    expect(clientCalls).toEqual(['listEventsForImport']);
  });

  it('a throw outside the per-calendar loop returns the user to the chooser, not a latched spinner', async () => {
    getAllLinksMock.mockRejectedValueOnce(new Error('doc worker gone'));
    const store = useCalendarImportStore();
    await store.open('c1');

    expect(await store.scan()).toBe(false);
    expect(store.phase).toBe('choosing');
    expect(reportErrorMock).toHaveBeenCalled();
  });

  it('the cap counts only rows the user can ACT on', async () => {
    // A family that already imported everything used to get 200 disabled rows and
    // the message "nothing to bring across" from a calendar full of new things.
    const already = Array.from({ length: IMPORT_MAX_CANDIDATES }, (_, i) =>
      timedEvent({ id: `old-${i}`, start: { dateTime: '2026-09-15T16:00:00+08:00' } })
    );
    const fresh = timedEvent({ id: 'brand-new' });
    listEventsForImportMock.mockResolvedValue([...already, fresh]);
    getAllLinksMock.mockResolvedValue(already.map((e) => ({ googleEventId: e.id })));

    const store = useCalendarImportStore();
    await store.open('c1');
    await store.scan();

    expect(store.candidates.some((c) => c.googleEventId === 'brand-new')).toBe(true);
    expect(store.selectedCount).toBe(1);
    expect(store.truncated).toBe(false);
  });
});

describe('selection', () => {
  it('toggles one row and toggles all', async () => {
    const store = useCalendarImportStore();
    await store.open('c1');
    await store.scan();

    store.toggleCandidate('g-1');
    expect(store.selectedCount).toBe(0);
    store.toggleAll();
    expect(store.selectedCount).toBe(1);
    store.toggleAll();
    expect(store.selectedCount).toBe(0);
  });
});

describe('the commit', () => {
  it('writes ONE batch and issues ZERO calendar-client calls', async () => {
    const store = useCalendarImportStore();
    await store.open('c1');
    await store.scan();
    clientCalls.length = 0;

    const n = await store.commit();

    expect(n).toEqual({ kind: 'ok', count: 1 });
    expect(createImportedActivitiesMock).toHaveBeenCalledTimes(1);
    // Adoption is achieved by recording a link, never by writing to Google.
    expect(clientCalls).toEqual([]);
  });

  it('records the REAL Google id and the right origin on the link', async () => {
    const store = useCalendarImportStore();
    await store.open('c1');
    await store.scan();
    await store.commit();

    const entries = createImportedActivitiesMock.mock.calls[0][0];
    expect(entries[0].link.googleEventId).toBe('g-1');
    expect(entries[0].link.origin).toBe('adopted');
  });

  it('hashes WITH the member resolver, so the next reconcile does not re-push', async () => {
    const store = useCalendarImportStore();
    await store.open('c1');
    await store.scan();
    await store.commit();

    const entries = createImportedActivitiesMock.mock.calls[0][0];
    const draft = entries[0].activity;
    const resolver = (id: string) => (id === 'me' ? 'Greg' : undefined);

    expect(entries[0].link.lastPushedHash).toBe(computePushHash(draft, resolver));
    // And it must NOT equal the resolver-less hash, or this test proves nothing.
    expect(entries[0].link.lastPushedHash).not.toBe(computePushHash(draft));
  });

  it('re-mirrors the activity array ONCE, not once per row', async () => {
    const store = useCalendarImportStore();
    await store.open('c1');
    await store.scan();
    await store.commit();
    expect(loadActivitiesMock).toHaveBeenCalledTimes(1);
  });

  it('a failed batch reports and leaves the user on the review, nothing half-created', async () => {
    createImportedActivitiesMock.mockRejectedValueOnce(new Error('worker died'));
    const store = useCalendarImportStore();
    await store.open('c1');
    await store.scan();

    const n = await store.commit();

    expect(n).toEqual({ kind: 'failed' });
    expect(store.phase).toBe('reviewing');
    expect(reportErrorMock).toHaveBeenCalled();
    expect(loadActivitiesMock).not.toHaveBeenCalled();
  });

  it('a COMMITTED-BUT-UNVERIFIED batch is never reported as "nothing happened"', async () => {
    // 🔴 `ImportNotVisibleError` is thrown AFTER the write lands. Calling this a
    // failure invites a retry that makes a second full set of activities.
    createImportedActivitiesMock.mockRejectedValueOnce(new ImportNotVisibleError(2, 3));
    const store = useCalendarImportStore();
    await store.open('c1');
    await store.scan();

    expect(await store.commit()).toEqual({ kind: 'unverified' });
    // Closed, not parked on a review list the user would naturally re-commit.
    expect(store.phase).toBe('idle');
    expect(reportErrorMock).toHaveBeenCalledWith(expect.objectContaining({ severity: 'critical' }));
  });

  it('does nothing when nothing is ticked', async () => {
    const store = useCalendarImportStore();
    await store.open('c1');
    await store.scan();
    store.toggleAll(); // deselect everything
    expect(await store.commit()).toEqual({ kind: 'ok', count: 0 });
    expect(createImportedActivitiesMock).not.toHaveBeenCalled();
  });
});

describe('re-running', () => {
  it('an already-imported row is not selectable and is not committed', async () => {
    getAllLinksMock.mockResolvedValue([{ googleEventId: 'g-1' }]);
    const store = useCalendarImportStore();
    await store.open('c1');
    await store.scan();

    expect(store.candidates[0].alreadyImported).toBe(true);
    expect(store.selectedCount).toBe(0);
    expect(await store.commit()).toEqual({ kind: 'ok', count: 0 });
  });
});

describe('telemetry', () => {
  it('emits the scan and commit counters on the SUCCESS path too', async () => {
    const store = useCalendarImportStore();
    await store.open('c1');
    await store.scan();
    await store.commit();

    const messages = logEventMock.mock.calls.map((c) => c[0].message);
    // Rates are only measurable if success is instrumented, not just failure.
    expect(messages).toContain('import_scan');
    expect(messages).toContain('import_scan_ok');
    expect(messages).toContain('import_commit');
  });

  it('uses only allowlisted context keys', async () => {
    const store = useCalendarImportStore();
    await store.open('c1');
    await store.scan();
    await store.commit();

    // The REAL allowlist, not a copy of it. A private copy passes forever after
    // the shipped allowlist changes, which is the failure this test exists to catch.
    for (const [payload] of logEventMock.mock.calls) {
      for (const key of Object.keys(payload.context ?? {})) {
        expect(
          ALLOWED_CONTEXT_KEYS.has(key),
          `context key "${key}" is not in ALLOWED_CONTEXT_KEYS`
        ).toBe(true);
      }
    }
  });
});
