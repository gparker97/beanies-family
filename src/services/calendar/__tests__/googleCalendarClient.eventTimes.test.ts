import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGoogleCalendarClient, eventItemToMs } from '../googleCalendarClient';
import { type TokenProvider } from '../CalendarClient';

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

/** Local-midnight ms for an all-day date assertion (matches parseLocalDate). */
function localMidnightMs(ymd: string): number {
  const [y, mo, d] = ymd.split('-').map(Number);
  return new Date(y!, mo! - 1, d!).getTime();
}

describe('googleCalendarClient.listEventTimes (#34)', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('GETs events with the times-only field mask and the right query params', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { items: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const { provider } = makeTokenProvider();
    const client = createGoogleCalendarClient(provider);
    await client.listEventTimes(
      'conn-1',
      'primary',
      '2026-06-10T00:00:00Z',
      '2026-06-11T00:00:00Z'
    );

    const [url, init] = fetchMock.mock.calls[0];
    const u = String(url);
    expect(u).toContain('/calendars/primary/events');
    expect(init.method).toBe('GET');
    expect(u).toContain('singleEvents=true');
    expect(u).toContain('showDeleted=false');
    // Field mask is the privacy guarantee — times + structural fields only, plus
    // nextPageToken (without it, paging would silently stop after page 1).
    expect(decodeURIComponent(u)).toContain(
      'fields=nextPageToken,items(id,recurringEventId,start,end,status,transparency)'
    );
  });

  it('maps timed, all-day, cancelled, tentative and transparency correctly', async () => {
    const items = [
      {
        id: 'timed',
        start: { dateTime: '2026-06-10T14:00:00Z' },
        end: { dateTime: '2026-06-10T15:00:00Z' },
      },
      { id: 'allday', start: { date: '2026-06-10' }, end: { date: '2026-06-11' } },
      {
        id: 'gone',
        status: 'cancelled',
        start: { dateTime: '2026-06-10T09:00:00Z' },
        end: { dateTime: '2026-06-10T10:00:00Z' },
      },
      {
        id: 'maybe',
        status: 'tentative',
        start: { dateTime: '2026-06-10T11:00:00Z' },
        end: { dateTime: '2026-06-10T12:00:00Z' },
      },
      {
        id: 'free',
        transparency: 'transparent',
        start: { dateTime: '2026-06-10T13:00:00Z' },
        end: { dateTime: '2026-06-10T13:30:00Z' },
      },
    ];
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { items }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createGoogleCalendarClient(makeTokenProvider().provider);
    const out = await client.listEventTimes('c', 'primary', 't0', 't1');

    const ids = out.map((e) => e.id);
    expect(ids).toEqual(['timed', 'allday', 'maybe', 'free']); // cancelled dropped
    const timed = out.find((e) => e.id === 'timed')!;
    expect(timed.startMs).toBe(new Date('2026-06-10T14:00:00Z').getTime());
    expect(timed.transparent).toBe(false);
    const allday = out.find((e) => e.id === 'allday')!;
    expect(allday.startMs).toBe(localMidnightMs('2026-06-10'));
    expect(allday.endMs).toBe(localMidnightMs('2026-06-11'));
    expect(out.find((e) => e.id === 'maybe')!.transparent).toBe(false); // tentative IS busy
    expect(out.find((e) => e.id === 'free')!.transparent).toBe(true);
  });

  it('skips a structurally-malformed item with a console.warn (never a silent drop)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const items = [
      { id: 'bad' }, // no start/end → malformed
      {
        id: 'ok',
        start: { dateTime: '2026-06-10T14:00:00Z' },
        end: { dateTime: '2026-06-10T15:00:00Z' },
      },
    ];
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { items }));
    vi.stubGlobal('fetch', fetchMock);

    const client = createGoogleCalendarClient(makeTokenProvider().provider);
    const out = await client.listEventTimes('c', 'primary', 't0', 't1');
    expect(out.map((e) => e.id)).toEqual(['ok']);
    expect(warn).toHaveBeenCalledWith(
      '[calendarClash] events.list item has no usable start/end; skipping',
      expect.objectContaining({ eventId: 'bad' })
    );
  });

  it('follows nextPageToken across pages', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          nextPageToken: 'p2',
          items: [
            {
              id: 'e1',
              start: { dateTime: '2026-06-10T14:00:00Z' },
              end: { dateTime: '2026-06-10T15:00:00Z' },
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          items: [
            {
              id: 'e2',
              start: { dateTime: '2026-06-10T16:00:00Z' },
              end: { dateTime: '2026-06-10T17:00:00Z' },
            },
          ],
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = createGoogleCalendarClient(makeTokenProvider().provider);
    const out = await client.listEventTimes('c', 'primary', 't0', 't1');
    expect(out.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('pageToken=p2');
  });

  it('re-mints once on a transient 401 then succeeds (shared authedFetch path)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401))
      .mockResolvedValueOnce(jsonResponse(200, { items: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const { provider, getMints } = makeTokenProvider();
    const client = createGoogleCalendarClient(provider);
    await expect(client.listEventTimes('c', 'primary', 't0', 't1')).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getMints()).toBe(2);
  });
});

describe('eventItemToMs (#34)', () => {
  it('maps a timed event from dateTime', () => {
    expect(
      eventItemToMs({
        id: 'x',
        start: { dateTime: '2026-06-10T14:00:00Z' },
        end: { dateTime: '2026-06-10T15:00:00Z' },
      })
    ).toEqual({
      startMs: new Date('2026-06-10T14:00:00Z').getTime(),
      endMs: new Date('2026-06-10T15:00:00Z').getTime(),
    });
  });

  it('maps an all-day event to a local-midnight span', () => {
    expect(
      eventItemToMs({ id: 'x', start: { date: '2026-06-10' }, end: { date: '2026-06-11' } })
    ).toEqual({
      startMs: localMidnightMs('2026-06-10'),
      endMs: localMidnightMs('2026-06-11'),
    });
  });

  it('returns null for a structurally-malformed item (neither shape)', () => {
    expect(eventItemToMs({ id: 'x' })).toBeNull();
  });
});
