import { describe, it, expect } from 'vitest';
import { buildTravelKeyValue, travelDetailRows } from '@/composables/useVacationTimeline';
import type { VacationTravelSegment } from '@/types/models';

// Locks the `terminal` field display (#30 follow-up): terminal is key info and must surface
// both on the collapsed summary line AND in the expanded dropdown details, for flights + cruises.

function flight(overrides: Partial<VacationTravelSegment> = {}): VacationTravelSegment {
  return {
    id: 'seg-1',
    type: 'flight_outbound',
    title: 'SIN → PVG',
    status: 'booked',
    airline: 'China Eastern (MU)',
    flightNumber: '5678',
    departureAirport: 'SIN',
    arrivalAirport: 'PVG',
    departureDate: '2026-06-06',
    departureTime: '09:00',
    arrivalTime: '14:30',
    ...overrides,
  };
}

function cruise(overrides: Partial<VacationTravelSegment> = {}): VacationTravelSegment {
  return {
    id: 'seg-2',
    type: 'cruise',
    title: 'Caribbean cruise',
    status: 'booked',
    cruiseLine: 'Royal Caribbean',
    shipName: 'Wonder of the Seas',
    departurePort: 'Miami',
    embarkationDate: '2026-07-01',
    disembarkationDate: '2026-07-08',
    ...overrides,
  };
}

describe('terminal display', () => {
  describe('collapsed summary — buildTravelKeyValue', () => {
    it('appends the flight terminal when present', () => {
      expect(buildTravelKeyValue(flight({ terminal: 'Terminal 1' }))).toContain('Terminal 1');
    });

    it('appends the cruise terminal when present', () => {
      expect(buildTravelKeyValue(cruise({ terminal: 'Cruise Terminal A' }))).toContain(
        'Cruise Terminal A'
      );
    });

    it('omits the terminal segment when absent', () => {
      expect(buildTravelKeyValue(flight())).not.toContain('Terminal');
    });

    it('shows the departure time but not the arrival time (space is at a premium)', () => {
      const summary = buildTravelKeyValue(flight({ departureTime: '07:30', arrivalTime: '10:35' }));
      expect(summary).toContain('7:30');
      expect(summary).not.toContain('10:35');
      expect(summary).not.toContain('–'); // no time range dash
    });
  });

  describe('expanded details — travelDetailRows', () => {
    // Labels are translation keys resolved via `t`; the stub returns the key
    // unchanged so the row assertions stay readable.
    const t = ((k: string) => k) as unknown as Parameters<typeof travelDetailRows>[1];

    it('adds a read-only terminal row for flights', () => {
      const row = travelDetailRows(flight({ terminal: 'Terminal 2' }), t).find(
        (r) => r.label === 'segmentRow.terminal'
      );
      expect(row).toEqual({ label: 'segmentRow.terminal', value: 'Terminal 2' });
      // read-only: no inline-edit field binding
      expect(row?.field).toBeUndefined();
    });

    it('adds a read-only terminal row for cruises', () => {
      const row = travelDetailRows(cruise({ terminal: 'Cruise Terminal A' }), t).find(
        (r) => r.label === 'segmentRow.terminal'
      );
      expect(row).toEqual({ label: 'segmentRow.terminal', value: 'Cruise Terminal A' });
    });

    it('omits the terminal row when absent', () => {
      expect(travelDetailRows(flight(), t).some((r) => r.label === 'segmentRow.terminal')).toBe(
        false
      );
    });
  });
});

describe('the arrival row says how many days later the flight lands', () => {
  /**
   * Reported: a westbound date-line crossing saved as +2 showed the right arrival
   * DATE but was labelled "Arrives (+1)". The row read the `arrivesNextDay`
   * boolean, which cannot say +2 — so the label and the date disagreed.
   *
   * The offset is derived from the two dates by `arrivalDayOffset`, the single
   * helper the edit drawer, the trip wizard and this row now share.
   */
  const t = ((k: string) => k) as unknown as Parameters<typeof travelDetailRows>[1];
  const flight = (over: Record<string, unknown> = {}) =>
    ({
      type: 'flight_outbound',
      arrivalTime: '06:20',
      departureDate: '2026-10-05',
      ...over,
    }) as unknown as Parameters<typeof travelDetailRows>[0];

  const arrivalLabel = (over: Record<string, unknown> = {}) =>
    travelDetailRows(flight(over), t).find((r) => r.field === 'arrivalTime')?.label;

  it('🔴 says +2 for a flight that lands two calendar days later', () => {
    expect(arrivalLabel({ arrivalDate: '2026-10-07' })).toContain('arrivesPlusDays');
  });

  it('says +1 for an overnight flight', () => {
    expect(arrivalLabel({ arrivalDate: '2026-10-06' })).toContain('arrivesPlusDays');
  });

  it('says a plain "Arrives" for a same-day flight', () => {
    expect(arrivalLabel({ arrivalDate: '2026-10-05' })).toBe('segmentRow.arrives');
  });

  it('🔴 does not read the stale boolean when the dates disagree with it', () => {
    // The exact shape of the bug: saved as +2, but the shadow still says "next
    // day". The dates win.
    expect(arrivalLabel({ arrivalDate: '2026-10-07', arrivesNextDay: true })).toContain(
      'arrivesPlusDays'
    );
  });

  it('falls back to the boolean for a pre-update record with no arrival date', () => {
    expect(arrivalLabel({ arrivesNextDay: true })).toContain('arrivesPlusDays');
    expect(arrivalLabel({ arrivesNextDay: false })).toBe('segmentRow.arrives');
  });
});
