/**
 * The pure half of view-only calendars (plan 2026-11-17, A4). Every rule here is a
 * privacy or correctness promise:
 *  - a busy-only event never carries a title or location (busy setting,
 *    freeBusyReader, private/confidential, or simply no summary: the live spike's
 *    free/busy shape);
 *  - beanies' own events (pushed, adopted, imported) never show twice;
 *  - a missing `transparency` is busy;
 *  - a throttle (403 classified `rate_limited`) never reads as "sharing stopped".
 *
 * Times are built from LOCAL dates so the suite passes in any time zone.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeViewEvents,
  indexByDate,
  widenByPeriod,
  classifyReadFailure,
  pickDefaultColor,
  dedupeViewedCalendars,
  standingRange,
  rangeToIsoWindow,
  rangeToMsSpan,
  restripForCalendar,
  mergeWindowEvents,
  isBeaniesOrigin,
  worseState,
  VIEW_CALENDAR_PALETTE,
  type NormalizeCalendar,
} from '../externalEvents';
import { CalendarApiError, type CalendarViewEvent } from '@/services/calendar/CalendarClient';
import { ASSIGNABLE_MEMBER_COLORS, NEUTRAL_MEMBER_COLOR } from '@/constants/memberColors';
import type { ExternalEvent } from '@/types/externalEvents';

const CAL: NormalizeCalendar = {
  id: 'vc-1',
  name: 'Grandma babysitting',
  color: '#6b7280',
  detailLevel: 'details',
  accessRole: 'reader',
};

/** A local wall-clock instant as Google's offset-bearing `dateTime`. */
function at(y: number, m: number, d: number, h = 0, min = 0): string {
  return new Date(y, m - 1, d, h, min).toISOString();
}

function timed(overrides: Partial<CalendarViewEvent> = {}): CalendarViewEvent {
  return {
    id: 'e1',
    summary: 'School pickup',
    location: 'Front gate',
    start: { dateTime: at(2026, 11, 20, 15) },
    end: { dateTime: at(2026, 11, 20, 16) },
    htmlLink: 'https://calendar.google.com/event?eid=e1',
    ...overrides,
  };
}

const NO_IDS = new Set<string>();

describe('normalizeViewEvents', () => {
  it('keeps a details event with its title, location, link and local times', () => {
    const { events } = normalizeViewEvents([timed()], CAL, NO_IDS);
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect(e).toMatchObject({
      id: 'e1',
      viewedCalendarId: 'vc-1',
      calendarName: 'Grandma babysitting',
      color: '#6b7280',
      allDay: false,
      startYmd: '2026-11-20',
      endYmd: '2026-11-20',
      title: 'School pickup',
      location: 'Front gate',
      htmlLink: 'https://calendar.google.com/event?eid=e1',
      busyOnly: false,
      transparent: false,
    });
    expect(e.startMs).toBe(new Date(2026, 10, 20, 15).getTime());
    expect(e.endMs).toBe(new Date(2026, 10, 20, 16).getTime());
  });

  it('drops cancelled events', () => {
    const { events } = normalizeViewEvents([timed({ status: 'cancelled' })], CAL, NO_IDS);
    expect(events).toEqual([]);
  });

  it('drops beanies-origin events by id AND by recurringEventId, and counts them', () => {
    const ids = new Set(['bpushed', 'bseries']);
    const result = normalizeViewEvents(
      [
        timed({ id: 'bpushed' }),
        timed({ id: 'bseries_20261120T150000Z', recurringEventId: 'bseries' }),
        timed({ id: 'theirs' }),
      ],
      CAL,
      ids
    );
    expect(result.events.map((e) => e.id)).toEqual(['theirs']);
    expect(result.droppedAsBeanies).toBe(2);
  });

  it.each([
    ['the calendar is set to busy only', { ...CAL, detailLevel: 'busy' as const }, {}],
    ['the account is a freeBusyReader', { ...CAL, accessRole: 'freeBusyReader' as const }, {}],
    ['the event is private', CAL, { visibility: 'private' }],
    ['the event is confidential', CAL, { visibility: 'confidential' }],
    ['the event has no summary', CAL, { summary: undefined }],
  ])('strips title and location when %s', (_why, calendar, overrides) => {
    const { events } = normalizeViewEvents([timed(overrides)], calendar, NO_IDS);
    expect(events[0]!.busyOnly).toBe(true);
    expect(events[0]).not.toHaveProperty('title');
    expect(events[0]).not.toHaveProperty('location');
  });

  describe('meeting links (#150 P4)', () => {
    const MEET = 'https://meet.google.com/abc-defg-hij';
    const ON = { includeMeetingUrl: true };

    it('keeps the client-screened meetingUrl on a details event when asked to', () => {
      const { events } = normalizeViewEvents([timed({ meetingUrl: MEET })], CAL, NO_IDS, ON);
      expect(events[0]!.meetingUrl).toBe(MEET);
      // Only the derived string: the client's rejection marker never reaches the event.
      const marked = normalizeViewEvents([timed({ meetingUrlRejected: true })], CAL, NO_IDS, ON)
        .events[0]!;
      expect(marked).not.toHaveProperty('meetingUrlRejected');
      expect(marked).not.toHaveProperty('meetingUrl');
    });

    it('sets no meetingUrl with includeMeetingUrl false, or with no option at all', () => {
      const off = normalizeViewEvents([timed({ meetingUrl: MEET })], CAL, NO_IDS, {
        includeMeetingUrl: false,
      });
      expect(off.events[0]).not.toHaveProperty('meetingUrl');
      const absent = normalizeViewEvents([timed({ meetingUrl: MEET })], CAL, NO_IDS);
      expect(absent.events[0]).not.toHaveProperty('meetingUrl');
    });

    it.each([
      ['the calendar is set to busy only', { ...CAL, detailLevel: 'busy' as const }, {}],
      ['the account is a freeBusyReader', { ...CAL, accessRole: 'freeBusyReader' as const }, {}],
      ['the event is private', CAL, { visibility: 'private' }],
      ['the event has no summary', CAL, { summary: undefined }],
    ])('a busy-only event never carries one (%s)', (_why, calendar, overrides) => {
      const { events } = normalizeViewEvents(
        [timed({ meetingUrl: MEET, ...overrides })],
        calendar,
        NO_IDS,
        ON
      );
      expect(events[0]!.busyOnly).toBe(true);
      expect(events[0]).not.toHaveProperty('meetingUrl');
    });

    it('restripForCalendar strips a busy-only event that still carries a meeting URL', () => {
      // A shape no normalize produces today, which is the point: the early return must
      // not let a stray meeting URL through on an event already marked busy-only.
      const stray: ExternalEvent = {
        ...normalizeViewEvents([timed({ summary: undefined })], CAL, NO_IDS).events[0]!,
        meetingUrl: MEET,
      };
      expect(stray.busyOnly).toBe(true);
      const out = restripForCalendar(stray, { detailLevel: 'busy', accessRole: 'reader' });
      expect(out).not.toBe(stray);
      expect(out).not.toHaveProperty('meetingUrl');
    });

    it('restripForCalendar drops the meeting URL with the title when the calendar turns busy only', () => {
      const [event] = normalizeViewEvents([timed({ meetingUrl: MEET })], CAL, NO_IDS, ON).events;
      const out = restripForCalendar(event!, { detailLevel: 'busy', accessRole: 'reader' });
      expect(out.busyOnly).toBe(true);
      expect(out).not.toHaveProperty('title');
      expect(out).not.toHaveProperty('meetingUrl');
    });
  });

  it('an event Google made from an email keeps its details on a calendar the account OWNS', () => {
    // Google's default for these, not the owner's choice (greg, 2026-11-17).
    for (const visibility of ['private', 'confidential']) {
      const { events } = normalizeViewEvents(
        [timed({ visibility, eventType: 'fromGmail' })],
        { ...CAL, accessRole: 'owner' },
        NO_IDS
      );
      expect(events[0]!.busyOnly).toBe(false);
      expect(events[0]!.title).toBe('School pickup');
      expect(events[0]!.detailsNeedOwner).toBe(true);
    }
  });

  // Review round 3, T1: Google returns a private event's details to any account that
  // may change the calendar, so a partner's calendar shared with "make changes"
  // access would show their email-made dinners to the whole family.
  it.each(['writer', 'reader'] as const)(
    'T1: an email-made private event is stripped on a %s calendar even when Google sent its title',
    (accessRole) => {
      const { events } = normalizeViewEvents(
        [timed({ visibility: 'private', eventType: 'fromGmail' })],
        { ...CAL, accessRole },
        NO_IDS
      );
      expect(events[0]!.busyOnly).toBe(true);
      expect(events[0]).not.toHaveProperty('title');
      expect(events[0]).not.toHaveProperty('location');
    }
  );

  it('T1: restripForCalendar drops owner-only details once the calendar is not owned', () => {
    const { events } = normalizeViewEvents(
      [timed({ visibility: 'private', eventType: 'fromGmail' }), timed({ id: 'plain' })],
      { ...CAL, accessRole: 'owner' },
      NO_IDS
    );
    const [emailMade, plain] = events as [ExternalEvent, ExternalEvent];
    expect(restripForCalendar(emailMade, { detailLevel: 'details', accessRole: 'owner' })).toBe(
      emailMade
    );
    const writer = restripForCalendar(emailMade, { detailLevel: 'details', accessRole: 'writer' });
    expect(writer).toMatchObject({ busyOnly: true });
    expect(writer).not.toHaveProperty('title');
    expect(writer).not.toHaveProperty('location');
    // An ordinary event on the same calendar is untouched (same object).
    expect(restripForCalendar(plain, { detailLevel: 'details', accessRole: 'writer' })).toBe(plain);
  });

  it.each([
    ['the calendar is set to busy only', { ...CAL, detailLevel: 'busy' as const }, {}],
    ['the account is a freeBusyReader', { ...CAL, accessRole: 'freeBusyReader' as const }, {}],
    ['Google returned no title (a calendar someone else owns)', CAL, { summary: undefined }],
  ])('an email-made private event is still stripped when %s', (_why, calendar, overrides) => {
    const { events } = normalizeViewEvents(
      [timed({ visibility: 'private', eventType: 'fromGmail', ...overrides })],
      calendar,
      NO_IDS
    );
    expect(events[0]!.busyOnly).toBe(true);
    expect(events[0]).not.toHaveProperty('title');
    expect(events[0]).not.toHaveProperty('location');
  });

  it('an event the owner marked private by hand stays busy only, whatever its type', () => {
    for (const eventType of ['default', 'outOfOffice', undefined]) {
      const { events } = normalizeViewEvents(
        [timed({ visibility: 'private', eventType })],
        CAL,
        NO_IDS
      );
      expect(events[0]!.busyOnly).toBe(true);
      expect(events[0]).not.toHaveProperty('title');
    }
  });

  it('a public or default visibility on a details calendar keeps the details', () => {
    for (const visibility of ['public', 'default', undefined]) {
      const { events } = normalizeViewEvents([timed({ visibility })], CAL, NO_IDS);
      expect(events[0]!.busyOnly).toBe(false);
      expect(events[0]!.title).toBe('School pickup');
    }
  });

  it("handles the live spike's free/busy shape: start, end, visibility, htmlLink and nothing else", () => {
    const spikeShape: CalendarViewEvent = {
      id: 'fb1',
      start: { dateTime: at(2026, 11, 21, 9) },
      end: { dateTime: at(2026, 11, 21, 12) },
      visibility: 'default',
      htmlLink: 'https://calendar.google.com/event?eid=fb1',
    };
    const { events } = normalizeViewEvents(
      [spikeShape],
      { ...CAL, accessRole: 'freeBusyReader', detailLevel: 'busy' },
      NO_IDS
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ busyOnly: true, transparent: false, allDay: false });
    expect(events[0]!.htmlLink).toBe('https://calendar.google.com/event?eid=fb1');
    expect(events[0]).not.toHaveProperty('title');
  });

  it('transparent only for transparency "transparent"; missing or "opaque" is busy', () => {
    const { events } = normalizeViewEvents(
      [
        timed({ id: 'a', transparency: 'transparent' }),
        timed({ id: 'b', transparency: 'opaque' }),
        timed({ id: 'c', transparency: undefined }),
      ],
      CAL,
      NO_IDS
    );
    expect(events.map((e) => e.transparent)).toEqual([true, false, false]);
  });

  it('an all-day event uses its calendar dates with the exclusive end resolved', () => {
    const { events } = normalizeViewEvents(
      [timed({ start: { date: '2026-11-20' }, end: { date: '2026-11-21' } })],
      CAL,
      NO_IDS
    );
    expect(events[0]).toMatchObject({ allDay: true, startYmd: '2026-11-20', endYmd: '2026-11-20' });
    expect(events[0]!.startMs).toBe(new Date(2026, 10, 20).getTime());
  });

  it('a multi-day all-day event keeps its real first and last day (across a month end)', () => {
    const { events } = normalizeViewEvents(
      [timed({ start: { date: '2026-11-29' }, end: { date: '2026-12-03' } })],
      CAL,
      NO_IDS
    );
    expect(events[0]).toMatchObject({ startYmd: '2026-11-29', endYmd: '2026-12-02' });
  });

  it('a timed event ending exactly at midnight does not cover the next day', () => {
    const { events } = normalizeViewEvents(
      [
        timed({
          start: { dateTime: at(2026, 11, 20, 22) },
          end: { dateTime: at(2026, 11, 21, 0) },
        }),
      ],
      CAL,
      NO_IDS
    );
    expect(events[0]).toMatchObject({ startYmd: '2026-11-20', endYmd: '2026-11-20' });
  });

  it('an overnight timed event covers both days', () => {
    const { events } = normalizeViewEvents(
      [
        timed({
          start: { dateTime: at(2026, 11, 20, 22) },
          end: { dateTime: at(2026, 11, 21, 2) },
        }),
      ],
      CAL,
      NO_IDS
    );
    expect(events[0]).toMatchObject({ startYmd: '2026-11-20', endYmd: '2026-11-21' });
  });

  it('skips and counts an item with no usable start/end', () => {
    const result = normalizeViewEvents(
      [timed({ start: undefined, end: undefined }), timed({ id: 'ok' })],
      CAL,
      NO_IDS
    );
    expect(result.events.map((e) => e.id)).toEqual(['ok']);
    expect(result.malformed).toBe(1);
  });
});

function ev(overrides: Partial<ExternalEvent>): ExternalEvent {
  return {
    id: 'x',
    viewedCalendarId: 'vc-1',
    calendarName: 'Cal',
    color: '#6b7280',
    allDay: false,
    startMs: 0,
    endMs: 1,
    startYmd: '2026-11-20',
    endYmd: '2026-11-20',
    busyOnly: false,
    transparent: false,
    ...overrides,
  };
}

describe('indexByDate', () => {
  it('puts a multi-day event on every day it covers', () => {
    const map = indexByDate([
      ev({ id: 'trip', allDay: true, startYmd: '2026-11-29', endYmd: '2026-12-02' }),
    ]);
    expect([...map.keys()]).toEqual(['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']);
  });

  it('sorts each day all-day first, then by start', () => {
    const map = indexByDate([
      ev({ id: 'late', startMs: 300 }),
      ev({ id: 'early', startMs: 100 }),
      ev({ id: 'allday', allDay: true, startMs: 500 }),
    ]);
    expect(map.get('2026-11-20')!.map((e) => e.id)).toEqual(['allday', 'early', 'late']);
  });

  it('a corrupt range cannot spin the loop', () => {
    const map = indexByDate([ev({ startYmd: '2026-01-01', endYmd: '2099-01-01' })]);
    expect(map.size).toBeLessThanOrEqual(366);
  });
});

describe('widenByPeriod', () => {
  it('day: one day each side', () => {
    expect(widenByPeriod({ startYmd: '2026-11-20', endYmd: '2026-11-20' }, 'day', 0)).toEqual({
      startYmd: '2026-11-19',
      endYmd: '2026-11-21',
    });
  });

  it('week: the whole week before and after (Monday start)', () => {
    // 2026-11-16 is a Monday.
    expect(widenByPeriod({ startYmd: '2026-11-16', endYmd: '2026-11-22' }, 'week', 1)).toEqual({
      startYmd: '2026-11-09',
      endYmd: '2026-11-29',
    });
  });

  it('week: Sunday start', () => {
    // 2026-11-15 is a Sunday.
    expect(widenByPeriod({ startYmd: '2026-11-15', endYmd: '2026-11-21' }, 'week', 0)).toEqual({
      startYmd: '2026-11-08',
      endYmd: '2026-11-28',
    });
  });

  it('month: the grids of the month before and the month after, from a six-row grid', () => {
    // November 2026, Sunday start: the grid runs 2026-11-01 .. 2026-12-12.
    const widened = widenByPeriod({ startYmd: '2026-11-01', endYmd: '2026-12-12' }, 'month', 0);
    // October's grid starts 2026-09-27; December's grid ends 2027-01-09.
    expect(widened).toEqual({ startYmd: '2026-09-27', endYmd: '2027-01-09' });
  });

  it('month: a plain 1st-to-last range picks the same month', () => {
    const a = widenByPeriod({ startYmd: '2026-11-01', endYmd: '2026-11-30' }, 'month', 0);
    const b = widenByPeriod({ startYmd: '2026-11-01', endYmd: '2026-12-12' }, 'month', 0);
    expect(a).toEqual(b);
  });

  it('is never narrower than the input', () => {
    const range = { startYmd: '2026-11-01', endYmd: '2027-03-01' };
    const widened = widenByPeriod(range, 'month', 0);
    expect(widened.startYmd <= range.startYmd).toBe(true);
    expect(widened.endYmd >= range.endYmd).toBe(true);
  });
});

describe('windows', () => {
  it('standing is yesterday to 35 days ahead', () => {
    expect(standingRange('2026-11-17')).toEqual({ startYmd: '2026-11-16', endYmd: '2026-12-22' });
  });

  it('an inclusive range becomes [local midnight of start, local midnight after end)', () => {
    const { timeMinIso, timeMaxIso } = rangeToIsoWindow({
      startYmd: '2026-11-20',
      endYmd: '2026-11-21',
    });
    expect(timeMinIso).toBe(new Date(2026, 10, 20).toISOString());
    expect(timeMaxIso).toBe(new Date(2026, 10, 22).toISOString());
  });
});

describe('classifyReadFailure', () => {
  it.each([
    ['forbidden', 'refused'],
    ['not_found', 'refused'],
    ['rate_limited', 'other'],
    ['transient', 'other'],
    ['auth', 'other'],
    ['invalid', 'other'],
    ['unknown', 'other'],
  ] as const)('%s -> %s', (kind, cls) => {
    expect(classifyReadFailure(new CalendarApiError(kind, 'x', 403))).toBe(cls);
  });

  it('a throttling 403 (classified rate_limited) is never a refusal', () => {
    expect(classifyReadFailure(new CalendarApiError('rate_limited', 'HTTP 403', 403))).toBe(
      'other'
    );
  });

  it('a plain Error is other', () => {
    expect(classifyReadFailure(new Error('network'))).toBe('other');
  });
});

describe('worseState', () => {
  it('orders needs_reconnect > unavailable > stale > truncated > ok, null is unknown', () => {
    expect(worseState(null, null)).toBeNull();
    expect(worseState(null, 'ok')).toBe('ok');
    expect(worseState('ok', 'truncated')).toBe('truncated');
    expect(worseState('stale', 'truncated')).toBe('stale');
    expect(worseState('unavailable', 'stale')).toBe('unavailable');
    expect(worseState('unavailable', 'needs_reconnect')).toBe('needs_reconnect');
  });
});

describe('pickDefaultColor', () => {
  it('the first calendar gets neutral gray', () => {
    expect(pickDefaultColor([])).toBe(NEUTRAL_MEMBER_COLOR);
  });

  it('the next gets the first unused member hue (case-insensitive)', () => {
    expect(pickDefaultColor([NEUTRAL_MEMBER_COLOR.toUpperCase()])).toBe(
      ASSIGNABLE_MEMBER_COLORS[0]
    );
  });

  it('falls back to neutral gray when every color is used', () => {
    expect(pickDefaultColor(VIEW_CALENDAR_PALETTE)).toBe(NEUTRAL_MEMBER_COLOR);
  });

  it('the palette is neutral gray plus the assignable member colors', () => {
    expect(VIEW_CALENDAR_PALETTE).toEqual([NEUTRAL_MEMBER_COLOR, ...ASSIGNABLE_MEMBER_COLORS]);
  });
});

describe('dedupeViewedCalendars', () => {
  it('keeps one record per Google calendar, the earliest createdAt winning', () => {
    const list = [
      { id: 'b', calendarId: 'shared@x', createdAt: '2026-11-17T10:00:00.000Z' },
      { id: 'a', calendarId: 'shared@x', createdAt: '2026-11-17T09:00:00.000Z' },
      { id: 'c', calendarId: 'other@x', createdAt: '2026-11-17T11:00:00.000Z' },
    ];
    expect(dedupeViewedCalendars(list).map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('breaks a createdAt tie by id, so every device keeps the same record', () => {
    const list = [
      { id: 'z', calendarId: 'shared@x', createdAt: '2026-11-17T09:00:00.000Z' },
      { id: 'm', calendarId: 'shared@x', createdAt: '2026-11-17T09:00:00.000Z' },
    ];
    expect(dedupeViewedCalendars(list).map((c) => c.id)).toEqual(['m']);
  });
});

describe('T3: isBeaniesOrigin (the selector re-runs it)', () => {
  it('matches an event by its own id or its series id', () => {
    const ids = new Set(['bpushed', 'bseries']);
    expect(isBeaniesOrigin({ id: 'bpushed' }, ids)).toBe(true);
    expect(isBeaniesOrigin({ id: 'x_1', seriesId: 'bseries' }, ids)).toBe(true);
    expect(isBeaniesOrigin({ id: 'theirs', seriesId: 'other' }, ids)).toBe(false);
  });

  it('normalization keeps the series id so the test can run after the read', () => {
    const { events } = normalizeViewEvents(
      [timed({ id: 'inst', recurringEventId: 'series-1' })],
      CAL,
      NO_IDS
    );
    expect(events[0]!.seriesId).toBe('series-1');
  });
});

/**
 * Review round 3, T8: the two windows used to merge standing-first, so a stale
 * standing copy beat a fresher screen copy, and an event the fresher read no longer
 * returned was resurrected from the staler window.
 */
describe('T8: mergeWindowEvents', () => {
  const DAY = { startYmd: '2026-11-20', endYmd: '2026-11-20' };
  const WEEK = { startYmd: '2026-11-16', endYmd: '2026-11-22' };
  function ev(id: string, h: number, day = 20): ExternalEvent {
    return {
      id,
      viewedCalendarId: 'vc-1',
      calendarName: 'Grandma',
      color: '#6b7280',
      allDay: false,
      startMs: new Date(2026, 10, day, h).getTime(),
      endMs: new Date(2026, 10, day, h + 1).getTime(),
      startYmd: `2026-11-${day}`,
      endYmd: `2026-11-${day}`,
      title: id,
      busyOnly: false,
      transparent: false,
    };
  }
  function win(events: ExternalEvent[], eventsAt: number, range = WEEK, complete = true) {
    return { events, eventsAt, complete, span: rangeToMsSpan(range) };
  }

  it('the fresher copy of a moved event wins, whichever window it is in', () => {
    const standing = win([ev('a', 9)], 100);
    const screen = win([ev('a', 14)], 200, DAY);
    const merged = mergeWindowEvents([standing, screen]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.startMs).toBe(new Date(2026, 10, 20, 14).getTime());
    // And the other way round.
    const older = mergeWindowEvents([win([ev('a', 9)], 300), win([ev('a', 14)], 200, DAY)]);
    expect(older[0]!.startMs).toBe(new Date(2026, 10, 20, 9).getTime());
  });

  it('a deleted event is not resurrected from the staler window inside the fresher span', () => {
    const standing = win([ev('gone', 10), ev('kept', 11, 21)], 100);
    const screen = win([], 200, DAY); // fresher, complete, covers the 20th only
    expect(mergeWindowEvents([standing, screen]).map((e) => e.id)).toEqual(['kept']);
  });

  it('a truncated fresher read wins by id but never hides what it did not return', () => {
    const standing = win([ev('a', 10), ev('b', 12)], 100);
    const screen = win([ev('a', 15)], 200, DAY, false);
    const merged = mergeWindowEvents([standing, screen]);
    expect(merged.map((e) => [e.id, new Date(e.startMs).getHours()])).toEqual([
      ['a', 15],
      ['b', 12],
    ]);
  });

  it('an equal age keeps the given order (standing first) and still shows each event once', () => {
    const merged = mergeWindowEvents([win([ev('a', 9)], 0), win([ev('a', 14)], 0, DAY)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.startMs).toBe(new Date(2026, 10, 20, 9).getTime());
  });

  it("uses Google's exclusive bounds: an event ending exactly at the span start is outside it", () => {
    const touching = { ...ev('edge', 23, 19), endMs: new Date(2026, 10, 20).getTime() };
    const merged = mergeWindowEvents([win([touching], 100), win([], 200, DAY)]);
    expect(merged.map((e) => e.id)).toEqual(['edge']);
  });
});
