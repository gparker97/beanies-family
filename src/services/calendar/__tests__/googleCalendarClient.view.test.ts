/**
 * The view-only read (plan 2026-11-17, A3) and the shared `pageAll()` paging loop.
 *
 * Load-bearing promises for `listEventsForView`:
 *  1. The field mask carries no `description` and no `attendees`: an owner's notes
 *     and other people's addresses are never read.
 *  2. Only `default`, `outOfOffice` and `fromGmail` event types (no focus time, no working location).
 *  3. A read stopped by the page cap says so (`truncated`), instead of passing a
 *     partial calendar off as complete.
 *  4. The page-cap warning never names the calendar (a shared calendar's id is its
 *     owner's email address).
 *
 * The paging block pins that moving the three older reads onto `pageAll()` changed
 * none of their results.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGoogleCalendarClient } from '../googleCalendarClient';
import { CalendarApiError, type TokenProvider } from '../CalendarClient';

/**
 * The read guard reads the family's viewed calendars. Both credential ids the cases
 * below use have the shared calendar added; the guard cases change this list.
 */
const viewed = vi.hoisted(() => ({
  list: [] as Array<{ viewAccountId: string; calendarId: string }>,
}));
vi.mock('@/services/automerge/repositories/calendarViewRepository', () => ({
  getAllViewedCalendars: vi.fn(async () => viewed.list),
  getCalendarViewAccountById: vi.fn(async () => undefined),
  updateCalendarViewAccount: vi.fn(async () => {}),
}));

/** Mirrors the client's private cap (20 pages x 250). */
const MAX_EVENT_PAGES = 20;
const SHARED_CALENDAR_ID = 'grandma@example.com';

function makeTokenProvider() {
  let mints = 0;
  const provider: TokenProvider = {
    async getAccessToken() {
      mints++;
      return `token-${mints}`;
    },
    invalidate() {},
  };
  return { provider, getMints: () => mints };
}

function jsonResponse(status: number, body: unknown = {}): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as Response;
}

const timed = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  start: { dateTime: '2026-11-18T09:00:00Z' },
  end: { dateTime: '2026-11-18T10:00:00Z' },
  ...extra,
});

/** A fetch that always has another page: every response carries a nextPageToken. */
function endlessPages(item: (n: number) => unknown) {
  let n = 0;
  return vi.fn(async () => {
    n += 1;
    return jsonResponse(200, { nextPageToken: `p${n + 1}`, items: [item(n)] });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('googleCalendarClient.listEventsForView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    viewed.list = [
      { viewAccountId: 'view-1', calendarId: SHARED_CALENDAR_ID },
      { viewAccountId: 'v', calendarId: SHARED_CALENDAR_ID },
    ];
  });

  describe('read guard (A3: only a calendar the family added, through its own account)', () => {
    async function refused(credentialId: string, calendarId: string) {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const client = createGoogleCalendarClient(makeTokenProvider().provider);
      const err = await client
        .listEventsForView(credentialId, calendarId, 't0', 't1')
        .catch((e: unknown) => e);
      return { err, fetchMock };
    }

    it('refuses a calendar that is not in viewedCalendars, with kind invalid and no request', async () => {
      const { err, fetchMock } = await refused('view-1', 'someone-else@example.com');
      expect(err).toBeInstanceOf(CalendarApiError);
      expect((err as CalendarApiError).kind).toBe('invalid');
      expect(fetchMock).not.toHaveBeenCalled();
      // The refusal never names the calendar (its id can be an email address).
      expect((err as Error).message).not.toContain('@');
    });

    it('refuses an added calendar read through a DIFFERENT credential', async () => {
      viewed.list = [{ viewAccountId: 'view-1', calendarId: SHARED_CALENDAR_ID }];
      const { err, fetchMock } = await refused('view-2', SHARED_CALENDAR_ID);
      expect((err as CalendarApiError).kind).toBe('invalid');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  async function callOnce(body: unknown = { items: [] }) {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, body));
    vi.stubGlobal('fetch', fetchMock);
    const client = createGoogleCalendarClient(makeTokenProvider().provider);
    const result = await client.listEventsForView(
      'view-1',
      SHARED_CALENDAR_ID,
      '2026-11-17T00:00:00Z',
      '2026-12-01T00:00:00Z'
    );
    return { result, url: new URL(String(fetchMock.mock.calls[0][0])) };
  }

  it('requests exactly the view mask: no description, no attendees', async () => {
    const { url } = await callOnce();
    const fields = url.searchParams.get('fields')!;
    expect(fields).toBe(
      'nextPageToken,items(id,recurringEventId,status,eventType,summary,location,start,end,transparency,visibility,htmlLink)'
    );
    expect(fields).not.toContain('description');
    expect(fields).not.toContain('attendees');
  });

  it('expands recurring events, hides deleted ones, and passes the window through', async () => {
    const { url } = await callOnce();
    expect(url.pathname).toBe(
      `/calendar/v3/calendars/${encodeURIComponent(SHARED_CALENDAR_ID)}/events`
    );
    expect(url.searchParams.get('singleEvents')).toBe('true');
    expect(url.searchParams.get('showDeleted')).toBe('false');
    expect(url.searchParams.get('timeMin')).toBe('2026-11-17T00:00:00Z');
    expect(url.searchParams.get('timeMax')).toBe('2026-12-01T00:00:00Z');
  });

  it('asks for default and out-of-office events only', async () => {
    const { url } = await callOnce();
    expect(url.searchParams.getAll('eventTypes')).toEqual(['default', 'outOfOffice', 'fromGmail']);
  });

  it('returns the masked fields and drops anything else Google sends', async () => {
    const { result } = await callOnce({
      items: [
        timed('e1', {
          recurringEventId: 'm1',
          status: 'confirmed',
          eventType: 'outOfOffice',
          summary: 'Babysitting',
          location: 'Home',
          transparency: 'opaque',
          visibility: 'private',
          htmlLink: 'https://calendar.google.com/event?eid=x',
          description: 'should never ride along',
          attendees: [{ email: 'someone@example.com' }],
        }),
      ],
    });
    expect(result.truncated).toBe(false);
    expect(result.events).toHaveLength(1);
    const event = result.events[0]!;
    expect(event).toMatchObject({
      id: 'e1',
      recurringEventId: 'm1',
      eventType: 'outOfOffice',
      summary: 'Babysitting',
      visibility: 'private',
    });
    expect(event).not.toHaveProperty('description');
    expect(event).not.toHaveProperty('attendees');
  });

  it('follows nextPageToken across pages', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { nextPageToken: 'p2', items: [timed('e1')] }))
      .mockResolvedValueOnce(jsonResponse(200, { items: [timed('e2')] }));
    vi.stubGlobal('fetch', fetchMock);
    const client = createGoogleCalendarClient(makeTokenProvider().provider);

    const result = await client.listEventsForView('v', SHARED_CALENDAR_ID, 't0', 't1');

    expect(result.events.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(result.truncated).toBe(false);
    const second = new URL(String(fetchMock.mock.calls[1][0]));
    expect(second.searchParams.get('pageToken')).toBe('p2');
    // The repeated param survives paging, not duplicated.
    expect(second.searchParams.getAll('eventTypes')).toEqual([
      'default',
      'outOfOffice',
      'fromGmail',
    ]);
  });

  it('reports truncated at the page cap, and the warning never names the calendar', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = endlessPages((n) => timed(`e${n}`));
    vi.stubGlobal('fetch', fetchMock);
    const client = createGoogleCalendarClient(makeTokenProvider().provider);

    const result = await client.listEventsForView('v', SHARED_CALENDAR_ID, 't0', 't1');

    expect(result.truncated).toBe(true);
    expect(result.events).toHaveLength(MAX_EVENT_PAGES);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_EVENT_PAGES);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('grandma');
    expect(warn.mock.calls[0]![1]).toEqual({ pages: MAX_EVENT_PAGES, count: MAX_EVENT_PAGES });
  });

  it('a read that ends exactly on the cap is complete, not truncated', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let n = 0;
    const fetchMock = vi.fn(async () => {
      n += 1;
      return jsonResponse(200, {
        nextPageToken: n < MAX_EVENT_PAGES ? `p${n + 1}` : undefined,
        items: [timed(`e${n}`)],
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = createGoogleCalendarClient(makeTokenProvider().provider);

    const result = await client.listEventsForView('v', SHARED_CALENDAR_ID, 't0', 't1');

    expect(result.truncated).toBe(false);
    expect(result.events).toHaveLength(MAX_EVENT_PAGES);
    expect(warn).not.toHaveBeenCalled();
  });

  describe('error mapping (shared authedFetch)', () => {
    it("a sharing-revoked 403 is 'forbidden' and not retried", async () => {
      const fetchMock = vi.fn(async () =>
        jsonResponse(403, {
          error: { message: 'Forbidden', errors: [{ reason: 'forbidden' }] },
        })
      );
      vi.stubGlobal('fetch', fetchMock);
      const client = createGoogleCalendarClient(makeTokenProvider().provider);

      const err = await client
        .listEventsForView('v', SHARED_CALENDAR_ID, 't0', 't1')
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(CalendarApiError);
      expect((err as CalendarApiError).kind).toBe('forbidden');
      expect((err as CalendarApiError).status).toBe(403);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("a 404 is 'not_found'", async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => jsonResponse(404))
      );
      const client = createGoogleCalendarClient(makeTokenProvider().provider);
      const err = await client
        .listEventsForView('v', SHARED_CALENDAR_ID, 't0', 't1')
        .catch((e: unknown) => e);
      expect((err as CalendarApiError).kind).toBe('not_found');
    });

    it('re-mints once on a 401, then succeeds', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(401))
        .mockResolvedValueOnce(jsonResponse(200, { items: [timed('e1')] }));
      vi.stubGlobal('fetch', fetchMock);
      const { provider, getMints } = makeTokenProvider();
      const client = createGoogleCalendarClient(provider);

      const result = await client.listEventsForView('v', SHARED_CALENDAR_ID, 't0', 't1');

      expect(result.events.map((e) => e.id)).toEqual(['e1']);
      expect(getMints()).toBe(2);
    });

    it("a persistent 401 throws 'auth'", async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => jsonResponse(401))
      );
      const client = createGoogleCalendarClient(makeTokenProvider().provider);
      const err = await client
        .listEventsForView('v', SHARED_CALENDAR_ID, 't0', 't1')
        .catch((e: unknown) => e);
      expect((err as CalendarApiError).kind).toBe('auth');
    });
  });
});

describe('pageAll() under the existing reads (no regression)', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('listEventTimes still stops at the cap and returns what it read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = endlessPages((n) => timed(`e${n}`));
    vi.stubGlobal('fetch', fetchMock);
    const client = createGoogleCalendarClient(makeTokenProvider().provider);

    const out = await client.listEventTimes('c', SHARED_CALENDAR_ID, 't0', 't1');

    expect(out).toHaveLength(MAX_EVENT_PAGES);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_EVENT_PAGES);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('grandma');
  });

  it('listEventsForImport still stops at the cap and returns what it read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = endlessPages((n) => timed(`e${n}`));
    vi.stubGlobal('fetch', fetchMock);
    const client = createGoogleCalendarClient(makeTokenProvider().provider);

    const out = await client.listEventsForImport('c', 'primary', 't0', 't1');

    expect(out).toHaveLength(MAX_EVENT_PAGES);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_EVENT_PAGES);
  });

  it('listInstances follows pages, keeps every item, and stops at the cap', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const twoPages = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, { nextPageToken: 'p2', items: [{ id: 'i1', status: 'confirmed' }] })
      )
      .mockResolvedValueOnce(jsonResponse(200, { items: [{ id: 'i2', status: 'cancelled' }] }));
    vi.stubGlobal('fetch', twoPages);
    const client = createGoogleCalendarClient(makeTokenProvider().provider);

    const out = await client.listInstances('c', 'primary', 'master', 't0', 't1', 'UTC');
    expect(out.map((i) => i.id)).toEqual(['i1', 'i2']);
    const second = new URL(String(twoPages.mock.calls[1][0]));
    expect(second.pathname).toBe('/calendar/v3/calendars/primary/events/master/instances');
    expect(second.searchParams.get('pageToken')).toBe('p2');
    expect(second.searchParams.get('timeZone')).toBe('UTC');

    const endless = endlessPages((n) => ({ id: `i${n}` }));
    vi.stubGlobal('fetch', endless);
    const capped = await client.listInstances('c', 'primary', 'master', 't0', 't1', 'UTC');
    expect(capped).toHaveLength(MAX_EVENT_PAGES);
    expect(endless).toHaveBeenCalledTimes(MAX_EVENT_PAGES);
  });
});
