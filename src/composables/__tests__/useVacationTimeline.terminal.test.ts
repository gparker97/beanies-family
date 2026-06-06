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
    it('adds a read-only terminal row for flights', () => {
      const row = travelDetailRows(flight({ terminal: 'Terminal 2' })).find(
        (r) => r.label === 'terminal'
      );
      expect(row).toEqual({ label: 'terminal', value: 'Terminal 2' });
      // read-only: no inline-edit field binding
      expect(row?.field).toBeUndefined();
    });

    it('adds a read-only terminal row for cruises', () => {
      const row = travelDetailRows(cruise({ terminal: 'Cruise Terminal A' })).find(
        (r) => r.label === 'terminal'
      );
      expect(row).toEqual({ label: 'terminal', value: 'Cruise Terminal A' });
    });

    it('omits the terminal row when absent', () => {
      expect(travelDetailRows(flight()).some((r) => r.label === 'terminal')).toBe(false);
    });
  });
});
