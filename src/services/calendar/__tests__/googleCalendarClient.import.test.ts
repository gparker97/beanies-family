/**
 * The import read (#94). Two things here are load-bearing and must not drift:
 *
 *  1. `singleEvents=false`. A recurring series has to arrive as ONE master with its
 *     RRULE, or the import creates N copies of a weekly swim lesson.
 *  2. `attendees` is NOT in the field mask. Not requesting the guest list is the
 *     entire mechanism by which other people's email addresses stay out of the
 *     family's encrypted file. A reviewer widening this mask "for completeness"
 *     would silently break a privacy promise, so the test states it as a promise.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGoogleCalendarClient } from '../googleCalendarClient';
import { type TokenProvider } from '../CalendarClient';

const provider: TokenProvider = {
  async getAccessToken() {
    return 'token-1';
  },
  invalidate() {},
};

function jsonResponse(status: number, body: unknown = {}): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as Response;
}

describe('googleCalendarClient.listEventsForImport', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  async function callOnce(body: unknown = { items: [] }) {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, body));
    vi.stubGlobal('fetch', fetchMock);
    const client = createGoogleCalendarClient(provider);
    const out = await client.listEventsForImport(
      'conn-1',
      'primary',
      '2026-09-11T00:00:00Z',
      '2027-09-11T00:00:00Z'
    );
    return { out, url: new URL(String(fetchMock.mock.calls[0][0]), 'https://x') };
  }

  it('does NOT expand recurring events, so a series arrives as one master', async () => {
    const { url } = await callOnce();
    expect(url.searchParams.get('singleEvents')).toBe('false');
  });

  it('NEVER requests attendees', async () => {
    const { url } = await callOnce();
    const fields = url.searchParams.get('fields') ?? '';
    expect(fields).not.toMatch(/attendee/i);
  });

  it('requests exactly the content an activity needs, and nothing more', async () => {
    const { url } = await callOnce();
    const fields = url.searchParams.get('fields') ?? '';
    for (const wanted of [
      'nextPageToken',
      'summary',
      'description',
      'location',
      'start',
      'end',
      'recurrence',
      'recurringEventId',
    ]) {
      expect(fields, `expected ${wanted} in the mask`).toContain(wanted);
    }
    // Booleans about the signed-in user, not identities.
    expect(fields).toContain('organizer(self)');
    expect(fields).toContain('creator(self)');
  });

  it('passes the window through and excludes deleted events', async () => {
    const { url } = await callOnce();
    expect(url.searchParams.get('timeMin')).toBe('2026-09-11T00:00:00Z');
    expect(url.searchParams.get('timeMax')).toBe('2027-09-11T00:00:00Z');
    expect(url.searchParams.get('showDeleted')).toBe('false');
  });

  it('flattens organizer.self into isOrganizer', async () => {
    const { out } = await callOnce({
      items: [
        { id: 'a', start: { date: '2026-09-15' }, organizer: { self: true } },
        { id: 'b', start: { date: '2026-09-15' }, organizer: { self: false } },
        { id: 'c', start: { date: '2026-09-15' }, creator: { self: true } },
      ],
    });
    expect(out.map((e) => [e.id, e.isOrganizer])).toEqual([
      ['a', true],
      ['b', false],
      ['c', true],
    ]);
  });

  it('skips a cancelled item and one with no start, without throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { out } = await callOnce({
      items: [
        { id: 'ok', start: { date: '2026-09-15' } },
        { id: 'gone', status: 'cancelled', start: { date: '2026-09-15' } },
        { id: 'broken' },
      ],
    });
    expect(out.map((e) => e.id)).toEqual(['ok']);
    // Never a silent drop.
    expect(warn).toHaveBeenCalled();
  });

  it('pages through nextPageToken', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          nextPageToken: 'p2',
          items: [{ id: 'a', start: { date: '2026-09-15' } }],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { items: [{ id: 'b', start: { date: '2026-09-16' } }] })
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = createGoogleCalendarClient(provider);
    const out = await client.listEventsForImport('c', 'primary', 'a', 'b');

    expect(out.map((e) => e.id)).toEqual(['a', 'b']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain('pageToken=p2');
  });
});

describe('listCalendars carries accessRole for the import chooser', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('passes through the role so read-only feeds can be greyed out', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(200, {
        items: [
          { id: 'primary', summary: 'Me', primary: true, accessRole: 'owner' },
          { id: 'hols', summary: 'Holidays', accessRole: 'reader' },
        ],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await createGoogleCalendarClient(provider).listCalendars('c');
    expect(out.map((c) => c.accessRole)).toEqual(['owner', 'reader']);
  });
});
