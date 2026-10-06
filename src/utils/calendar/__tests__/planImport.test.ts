import { describe, it, expect } from 'vitest';

import { planImport, redateToOccurrence, type ImportSource } from '../planImport';
import type { CalendarEventFull } from '@/services/calendar/CalendarClient';
import type { CalendarEventLink } from '@/types/models';
import { deterministicEventId } from '../deterministicEventId';

const ME = 'member-1';
const DEST = 'primary-cal';

// The family's home zone. Explicit, so every date/time below is the same on any
// device (`TZ`) the suite runs under.
const HOME = 'Asia/Singapore';
const defaults = { memberId: ME, destinationCalendarId: DEST, homeTimeZone: HOME };

function ev(overrides: Partial<CalendarEventFull> = {}): CalendarEventFull {
  return {
    id: 'g-1',
    summary: 'Joey swimming',
    start: { dateTime: '2026-09-15T16:00:00+08:00' },
    end: { dateTime: '2026-09-15T16:45:00+08:00' },
    isOrganizer: true,
    ...overrides,
  };
}

function source(events: CalendarEventFull[], calendarId = DEST): ImportSource {
  return { connectionId: 'c1', calendarId, calendarLabel: 'Greg Brambleworth', events };
}

const plan = (events: CalendarEventFull[], links: CalendarEventLink[] = [], calendarId = DEST) =>
  planImport([source(events, calendarId)], links, defaults);

describe('the outcome a row promises', () => {
  it('adopts an event you organize on the destination calendar', () => {
    const { candidates } = plan([ev()]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].outcome).toBe('adopt');
    expect(candidates[0].origin).toBe('adopted');
  });

  it('copies an event someone else created', () => {
    const { candidates } = plan([ev({ isOrganizer: false })]);
    expect(candidates[0].outcome).toBe('copy');
    expect(candidates[0].origin).toBe('external');
  });

  it('copies your OWN event when it lives on another calendar', () => {
    // The link carries no calendarId and every push targets the destination, so an
    // adopted event elsewhere would 404 then be re-inserted as a duplicate.
    const { candidates } = plan([ev()], [], 'other-cal');
    expect(candidates[0].outcome).toBe('copy');
    expect(candidates[0].origin).toBe('external');
  });
});

describe('an occurrence the family deleted in Google', () => {
  // Google does NOT add an EXDATE to the master when you delete one occurrence in
  // its UI. It writes a separate cancelled instance. The master's own `recurrence[]`
  // therefore looks perfectly clean, and adopting it verbatim would put the deleted
  // lesson back on the family's planner.
  const master = ev({ id: 'm', recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TU'] });
  const tombstone = ev({ id: 'm_20260922T080000Z', status: 'cancelled', recurringEventId: 'm' });

  it('refuses to adopt the series as recurring', () => {
    const { candidates } = plan([master, tombstone]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].outcome).toBe('unsupported-recurrence');
    expect(candidates[0].draft.rule).toBeUndefined();
  });

  it('leaves an untouched series alone', () => {
    const { candidates } = plan([master]);
    expect(candidates[0].outcome).toBe('adopt');
    expect(candidates[0].draft.rule).toBeDefined();
  });

  it('does not offer the tombstone itself as something to import', () => {
    const { candidates, skipped } = plan([master, tombstone]);
    expect(candidates.map((c) => c.googleEventId)).toEqual(['m']);
    expect(skipped.some((s) => s.id === tombstone.id)).toBe(true);
  });
});

describe('recurrence', () => {
  it('imports a readable weekly series as ONE recurring activity', () => {
    const { candidates } = plan([ev({ recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TU'] })]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].draft.rule).toEqual({
      unit: 'week',
      interval: 1,
      weekdays: [2],
      end: { kind: 'never' },
    });
    expect(candidates[0].draft.recurrence).toBe('weekly');
  });

  it('derives the legacy shadow fields rather than inventing them', () => {
    const { candidates } = plan([ev({ recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TU'] })]);
    // activityShadowFromRule is the only sanctioned derivation; if this drifts,
    // activityInWindow and computePushHash quietly disagree with the rule.
    expect(candidates[0].draft.daysOfWeek).toEqual([2]);
  });

  it('keeps a long-running series whose first occurrence is years ago', () => {
    // The most valuable thing this feature imports. `draft.date` is wall clock in
    // the family's HOME zone (Singapore here), so it no longer depends on the
    // importing device: under TZ=Pacific/Honolulu this used to land a day earlier.
    const { candidates } = plan([
      ev({
        start: { dateTime: '2024-09-17T16:00:00+08:00', timeZone: 'Asia/Singapore' },
        end: { dateTime: '2024-09-17T16:45:00+08:00', timeZone: 'Asia/Singapore' },
        recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TU'],
      }),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].draft.date).toBe('2024-09-17');
    // The point of the test: the SERIES survived, rather than being demoted.
    expect(candidates[0].draft.recurrence).toBe('weekly');
  });

  it('anchors the RRULE on the EVENT’s zone, not the home (or device) zone', () => {
    // A Singapore Tuesday series imported into a family whose HOME zone is far west
    // of Singapore. `times.date` is Monday there, so anchoring on it would fail the
    // BYDAY=TU agreement check and silently demote a two-year weekly series to a
    // single event. The anchor must stay in the event's own zone.
    const { candidates } = planImport(
      [
        source([
          ev({
            start: { dateTime: '2026-09-15T06:00:00+08:00', timeZone: 'Asia/Singapore' },
            end: { dateTime: '2026-09-15T07:00:00+08:00', timeZone: 'Asia/Singapore' },
            recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TU'],
          }),
        ]),
      ],
      [],
      { ...defaults, homeTimeZone: 'Pacific/Honolulu' }
    );
    expect(candidates[0].draft.date).toBe('2026-09-14'); // Monday in Honolulu
    expect(candidates[0].outcome).not.toBe('unsupported-recurrence');
    expect(candidates[0].draft.rule?.unit).toBe('week');
  });
});

describe('🔴 an unexpressible repeat pattern is NEVER adopted', () => {
  // If this regresses, the user's first ordinary edit in beanies PATCHes the Google
  // master with `recurrence: []` and destroys every future occurrence of their real
  // series. It is the single most destructive thing this feature could do.
  const unsupported = ['RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1'];

  it('is marked unsupported-recurrence even when the user organizes it', () => {
    const { candidates } = plan([ev({ recurrence: unsupported, isOrganizer: true })]);
    expect(candidates[0].outcome).toBe('unsupported-recurrence');
  });

  it('is pinned to origin external, so beanies can never write to it', () => {
    const { candidates } = plan([ev({ recurrence: unsupported, isOrganizer: true })]);
    expect(candidates[0].origin).toBe('external');
  });

  it('imports as a one-off, carrying no rule', () => {
    const { candidates } = plan([ev({ recurrence: unsupported })]);
    expect(candidates[0].draft.recurrence).toBe('none');
    expect(candidates[0].draft.rule).toBeUndefined();
  });

  it('also refuses adoption for a series carrying EXDATE', () => {
    const { candidates } = plan([
      ev({ recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TU', 'EXDATE:20260922T160000Z'] }),
    ]);
    expect(candidates[0].outcome).toBe('unsupported-recurrence');
    expect(candidates[0].origin).toBe('external');
  });
});

describe('field mapping', () => {
  it('puts Google’s description in NOTES, never in description', () => {
    // Only `notes` is pushed back out. Importing into `description` would mean the
    // first push wipes the user's event body in Google.
    const { candidates } = plan([ev({ description: 'Bring goggles' })]);
    expect(candidates[0].draft.notes).toBe('Bring goggles');
    expect(candidates[0].draft.description).toBeUndefined();
  });

  it('maps a timed event to wall clock in the HOME zone', () => {
    const { draft } = plan([ev()]).candidates[0];
    expect(draft.isAllDay).toBe(false);
    expect(draft.date).toBe('2026-09-15');
    expect(draft.startTime).toBe('16:00');
    expect(draft.endTime).toBe('16:45');
  });

  it('an LA device importing a Singapore 10:45 keeps 10:45 on the same day (home SG)', () => {
    // Device-independent by construction; the suite is also run under
    // TZ=America/Los_Angeles, where the device clock would read 2026-09-04 19:45.
    const { draft } = plan([
      ev({
        start: { dateTime: '2026-09-05T10:45:00+08:00', timeZone: 'Asia/Singapore' },
        end: { dateTime: '2026-09-05T11:30:00+08:00', timeZone: 'Asia/Singapore' },
      }),
    ]).candidates[0];
    expect(draft.date).toBe('2026-09-05');
    expect(draft.startTime).toBe('10:45');
    expect(draft.endTime).toBe('11:30');
  });

  it('maps an all-day event and converts Google’s exclusive end', () => {
    const { draft } = plan([ev({ start: { date: '2026-09-15' }, end: { date: '2026-09-18' } })])
      .candidates[0];
    expect(draft.isAllDay).toBe(true);
    expect(draft.date).toBe('2026-09-15');
    expect(draft.endDate).toBe('2026-09-17'); // inclusive
  });

  it('omits endDate for a single all-day event', () => {
    const { draft } = plan([ev({ start: { date: '2026-09-15' }, end: { date: '2026-09-16' } })])
      .candidates[0];
    expect(draft.endDate).toBeUndefined();
  });

  it('carries location, and supplies the fields Google cannot', () => {
    const { draft } = plan([ev({ location: 'Katong' })]).candidates[0];
    expect(draft.location).toBe('Katong');
    expect(draft.category).toBe('other_activity');
    expect(draft.feeSchedule).toBe('none');
    expect(draft.isActive).toBe(true);
    expect(draft.createdBy).toBe(ME);
    // The activity form requires a non-empty assignee list and createActivity does
    // not validate, so an import writing none makes malformed activities.
    expect(draft.assigneeIds).toEqual([ME]);
  });

  it('never carries an attendee list into the draft, even if one somehow arrives', () => {
    // The fixture MUST carry attendee-shaped data or this test proves nothing: with
    // a clean fixture "no @ in the draft" is true however the planner is written.
    // `CalendarEventFull` has no `attendees` field by design (the client's field
    // mask is the real guarantee, tested there); this asserts the second line of
    // defence — the planner copies named fields and never spreads the event.
    const withGuests = {
      ...ev(),
      attendees: [{ email: 'another.parent@example.com' }],
      organizer: { email: 'head@school.example.com' },
    } as unknown as CalendarEventFull;

    const { draft } = plan([withGuests]).candidates[0];
    expect(JSON.stringify(draft)).not.toMatch(/@/);
    expect(JSON.stringify(withGuests)).toMatch(/@/); // the fixture really is dirty
  });

  it('falls back to an empty title rather than dropping the event', () => {
    expect(plan([ev({ summary: undefined })]).candidates[0].draft.title).toBe('');
  });
});

describe('what never reaches the review list', () => {
  it('skips cancelled events', () => {
    const { candidates, skipped } = plan([ev({ status: 'cancelled' })]);
    expect(candidates).toHaveLength(0);
    expect(skipped[0].reason).toBe('cancelled');
  });

  it('skips a modified INSTANCE of a series, because the master carries it', () => {
    const { candidates, skipped } = plan([ev({ recurringEventId: 'master-1' })]);
    expect(candidates).toHaveLength(0);
    expect(skipped[0].reason).toBe('series-instance');
  });

  it('skips beanies’ OWN events, even if their link was lost', () => {
    const ownId = deterministicEventId('11111111-2222-3333-4444-555555555555');
    const { candidates, skipped } = plan([ev({ id: ownId })]);
    expect(candidates).toHaveLength(0);
    expect(skipped[0].reason).toBe('beanies-own-event');
  });

  it('skips an event with no usable start', () => {
    const { candidates, skipped } = plan([ev({ start: undefined })]);
    expect(candidates).toHaveLength(0);
    expect(skipped[0].reason).toBe('unreadable-times');
  });
});

describe('re-running the import', () => {
  it('marks an already-linked event rather than offering it fresh', () => {
    const link = {
      id: 'c1:a1',
      connectionId: 'c1',
      activityId: 'a1',
      googleEventId: 'g-1',
      lastPushedHash: 'h',
      lastPushedAt: '2026-09-11T00:00:00.000Z',
      createdAt: '2026-09-11T00:00:00.000Z',
      updatedAt: '2026-09-11T00:00:00.000Z',
    } as CalendarEventLink;

    const { candidates } = plan([ev()], [link]);
    expect(candidates[0].alreadyImported).toBe(true);
  });

  it('leaves an unrelated event alone', () => {
    expect(plan([ev()], []).candidates[0].alreadyImported).toBe(false);
  });
});

describe('multiple calendars merge into one list', () => {
  it('labels each row by its source and orders the whole list by date', () => {
    const result = planImport(
      [
        source([ev({ id: 'a', start: { date: '2026-10-01' }, end: { date: '2026-10-02' } })], DEST),
        {
          connectionId: 'c1',
          calendarId: 'fam',
          calendarLabel: 'Family',
          events: [ev({ id: 'b', start: { date: '2026-09-20' }, end: { date: '2026-09-21' } })],
        },
      ],
      [],
      defaults
    );

    expect(result.candidates.map((c) => c.googleEventId)).toEqual(['b', 'a']);
    expect(result.candidates[0].calendarLabel).toBe('Family');
    expect(result.candidates[1].calendarLabel).toBe('Greg Brambleworth');
  });
});

describe('redateToOccurrence reads the occurrence in the home zone', () => {
  it('re-dates a master onto its next occurrence in the family’s wall clock', () => {
    const [candidate] = plan([
      ev({
        start: { dateTime: '2019-09-17T16:00:00+08:00', timeZone: 'Asia/Singapore' },
        end: { dateTime: '2019-09-17T16:45:00+08:00', timeZone: 'Asia/Singapore' },
      }),
    ]).candidates;
    const moved = redateToOccurrence(
      candidate!,
      { dateTime: '2026-10-06T16:00:00+08:00' },
      { dateTime: '2026-10-06T16:45:00+08:00' },
      HOME
    );
    expect(moved.draft).toMatchObject({ date: '2026-10-06', startTime: '16:00', endTime: '16:45' });
  });
});
