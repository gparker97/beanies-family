import { describe, it, expect } from 'vitest';
import {
  segmentSpan,
  classifySegmentPhase,
  buildWhenBand,
  collectSegmentDates,
  extendTripDates,
} from '@/utils/vacation';
import type {
  VacationTravelSegment,
  VacationAccommodation,
  VacationTransportation,
} from '@/types/models';

// ── classifySegmentPhase ──────────────────────────────────────────────────
// The ongoing-stay bug lived here: a span must be classified by its END date.

describe('classifySegmentPhase', () => {
  const T = '2026-08-06';

  it('single-point item: past / now / future by its own date', () => {
    expect(classifySegmentPhase({ start: '2026-08-05' }, T)).toBe('past');
    expect(classifySegmentPhase({ start: '2026-08-06' }, T)).toBe('now');
    expect(classifySegmentPhase({ start: '2026-08-07' }, T)).toBe('future');
  });

  it('spanning item is classified by its END date (the ongoing-stay fix)', () => {
    // checked in 3 Aug, checks out 8 Aug — today is 6 Aug → still "now", not past
    expect(classifySegmentPhase({ start: '2026-08-03', end: '2026-08-08' }, T)).toBe('now');
    // ended yesterday → past
    expect(classifySegmentPhase({ start: '2026-08-01', end: '2026-08-05' }, T)).toBe('past');
    // starts tomorrow → future
    expect(classifySegmentPhase({ start: '2026-08-07', end: '2026-08-10' }, T)).toBe('future');
  });

  it('inclusive boundaries: today == start and today == end are both "now"', () => {
    expect(classifySegmentPhase({ start: '2026-08-06', end: '2026-08-09' }, T)).toBe('now');
    expect(classifySegmentPhase({ start: '2026-08-03', end: '2026-08-06' }, T)).toBe('now');
  });

  it('day-roll: a stay ending today flips to past the next day', () => {
    const span = { start: '2026-08-03', end: '2026-08-06' };
    expect(classifySegmentPhase(span, '2026-08-06')).toBe('now');
    expect(classifySegmentPhase(span, '2026-08-07')).toBe('past');
  });

  it('is total: missing/blank dates fall through to "now" (never hides a segment)', () => {
    expect(classifySegmentPhase({}, T)).toBe('now');
    expect(classifySegmentPhase({ start: '' }, T)).toBe('now');
  });
});

// ── segmentSpan ────────────────────────────────────────────────────────────

describe('an open-ended stay is ONGOING, not finished', () => {
  // The wizard prefills check-out only on the FIRST accommodation, so every later stay is
  // added with both dates blank — this was the common case, not an edge one. Collapsing
  // `end ?? start` made a stay checked into days ago read as `past`: a grey rail circle, a
  // ✓ "done" pill, and no "staying now" chip on the one place the family is actually in.
  const T = '2026-08-25';

  it('is `now` when it started before today and has no check-out yet', () => {
    expect(classifySegmentPhase({ start: '2026-08-20', spanning: true }, T)).toBe('now');
  });

  it('is `now` on the day it starts', () => {
    expect(classifySegmentPhase({ start: T, spanning: true }, T)).toBe('now');
  });

  it('is still `future` when it has not started', () => {
    expect(classifySegmentPhase({ start: '2026-09-01', spanning: true }, T)).toBe('future');
  });

  it('a NON-spanning item with no end is unchanged — it really is one day', () => {
    // A flight on the 20th is past on the 25th. Only spans are open-ended.
    expect(classifySegmentPhase({ start: '2026-08-20' }, T)).toBe('past');
  });

  it('a closed stay still ends when its check-out passes', () => {
    expect(
      classifySegmentPhase({ start: '2026-08-10', end: '2026-08-15', spanning: true }, T)
    ).toBe('past');
  });
});

describe('segmentSpan', () => {
  it('accommodation returns check-in → check-out', () => {
    const acc = { checkInDate: '2026-08-03', checkOutDate: '2026-08-08' } as VacationAccommodation;
    expect(segmentSpan('accommodation', acc)).toEqual({
      start: '2026-08-03',
      end: '2026-08-08',
      spanning: true,
    });
  });

  it('flight is start-only even with an arrival date (not a multi-day span)', () => {
    const seg = {
      type: 'flight_outbound',
      departureDate: '2026-08-03',
      arrivalDate: '2026-08-04',
    } as VacationTravelSegment;
    expect(segmentSpan('travel', seg)).toEqual({ start: '2026-08-03', end: undefined });
  });

  it('rental car spans pickup → return; non-rental transport is start-only', () => {
    const rental = {
      type: 'rental_car',
      pickupDate: '2026-08-03',
      returnDate: '2026-08-09',
    } as VacationTransportation;
    expect(segmentSpan('transportation', rental)).toEqual({
      start: '2026-08-03',
      end: '2026-08-09',
      spanning: true,
    });

    const taxi = {
      type: 'taxi_rideshare',
      pickupDate: '2026-08-03',
      returnDate: '2026-08-09',
    } as VacationTransportation;
    expect(segmentSpan('transportation', taxi)).toEqual({ start: '2026-08-03', end: undefined });
  });

  it('bus falls back to departureDate for its start', () => {
    const bus = { type: 'bus', departureDate: '2026-08-03' } as VacationTransportation;
    expect(segmentSpan('transportation', bus)).toEqual({ start: '2026-08-03', end: undefined });
  });
});

// ── buildWhenBand ──────────────────────────────────────────────────────────

describe('buildWhenBand', () => {
  it('flight: two cells (departs → arrives) and consumes the date/time fields', () => {
    const seg = {
      type: 'flight_outbound',
      departureDate: '2026-08-03',
      departureTime: '09:15',
      arrivalTime: '17:30',
    } as VacationTravelSegment;
    const out = buildWhenBand('travel', seg)!;
    expect(out.band.start).toMatchObject({ captionKey: 'segmentRow.departs', time: '09:15' });
    expect(out.band.end).toMatchObject({ captionKey: 'segmentRow.arrives', time: '17:30' });
    // arrival borrows the departure date for display when no arrivalDate
    expect(out.band.end?.date).toBe('2026-08-03');
    expect(out.consumed).toEqual(
      expect.arrayContaining(['departureDate', 'departureTime', 'arrivalTime'])
    );
  });

  it('overnight flight: arrival cell prefers arrivalDate + flags next day', () => {
    const seg = {
      type: 'flight_outbound',
      departureDate: '2026-08-03',
      departureTime: '23:40',
      arrivalDate: '2026-08-04',
      arrivalTime: '06:10',
      arrivesNextDay: true,
    } as VacationTravelSegment;
    const out = buildWhenBand('travel', seg)!;
    expect(out.band.end).toMatchObject({ date: '2026-08-04', nextDay: true });
  });

  it('flight with no arrival time degrades to a single cell', () => {
    const seg = {
      type: 'flight_outbound',
      departureDate: '2026-08-03',
      departureTime: '09:15',
    } as VacationTravelSegment;
    const out = buildWhenBand('travel', seg)!;
    expect(out.band.end).toBeUndefined();
  });

  it('accommodation: check-in → check-out two-cell band', () => {
    const acc = { checkInDate: '2026-08-03', checkOutDate: '2026-08-08' } as VacationAccommodation;
    const out = buildWhenBand('accommodation', acc)!;
    expect(out.band.start.captionKey).toBe('segmentRow.checkIn');
    expect(out.band.end?.captionKey).toBe('segmentRow.checkOut');
    expect(out.consumed).toEqual(expect.arrayContaining(['checkInDate', 'checkOutDate']));
  });

  it('activity: single "starts" cell', () => {
    const seg = {
      type: 'activity',
      departureDate: '2026-08-05',
      startTime: '19:00',
    } as VacationTravelSegment;
    const out = buildWhenBand('travel', seg)!;
    expect(out.band.start.captionKey).toBe('segmentRow.starts');
    expect(out.band.end).toBeUndefined();
    expect(out.consumed).toEqual(expect.arrayContaining(['departureDate', 'startTime']));
  });

  it('non-rental transport does NOT consume returnDate (it survives as a row)', () => {
    const taxi = {
      type: 'taxi_rideshare',
      pickupDate: '2026-08-03',
      pickupTime: '08:00',
      returnDate: '2026-08-03',
      returnTime: '20:00',
    } as VacationTransportation;
    const out = buildWhenBand('transportation', taxi)!;
    expect(out.band.end).toBeUndefined();
    expect(out.consumed).toEqual(expect.arrayContaining(['pickupDate', 'pickupTime']));
    expect(out.consumed).not.toContain('returnDate');
    expect(out.consumed).not.toContain('returnTime');
  });

  it('returns null when the segment has no date and no time', () => {
    const seg = { type: 'flight_outbound' } as VacationTravelSegment;
    expect(buildWhenBand('travel', seg)).toBeNull();
  });
});

describe('collectSegmentDates → extendTripDates round-trip', () => {
  // Each function passed its own tests; only the PAIR was broken. collectSegmentDates pushed
  // RAW values while extendTripDates validates against a strict YYYY-MM-DD and skips anything
  // else — so a model-supplied ISO TIMESTAMP was silently discarded, the trip never widened
  // to cover that booking, and the "after your trip ends" hint sat there permanently.
  it('extends the trip window from a timestamped segment date', () => {
    const dates = collectSegmentDates({
      travelSegments: [{ departureDate: '2026-07-15T10:30:00.000Z' }],
      accommodations: [],
      transportation: [],
    } as never);

    // Every collected value must already be a plain date part.
    for (const d of dates) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const range = extendTripDates({ start: '2026-07-01', end: '2026-07-10' }, ...dates);
    expect(range.end).toBe('2026-07-15');
  });

  it('still extends from an already-plain date', () => {
    const dates = collectSegmentDates({
      travelSegments: [],
      accommodations: [{ checkInDate: '2026-06-20', checkOutDate: '2026-06-25' }],
      transportation: [],
    } as never);
    const range = extendTripDates({ start: '2026-07-01', end: '2026-07-10' }, ...dates);
    expect(range.start).toBe('2026-06-20');
  });
});
