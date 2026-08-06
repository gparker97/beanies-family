import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { ref, computed } from 'vue';
import { useVacationTimeline } from '@/composables/useVacationTimeline';
import type { FamilyVacation } from '@/types/models';

// End-to-end: the composable promotes date/time into `timing.band`, drops exactly
// those rows, and classifies each segment's phase from an injected `today`.

function makeVacation(): FamilyVacation {
  return {
    id: 'trip-1',
    name: 'Test trip',
    assigneeIds: [],
    ideas: [],
    travelSegments: [
      {
        id: 'flight-past',
        type: 'flight_outbound',
        title: 'SIN → NRT',
        status: 'booked',
        airline: 'All Nippon (NH)',
        flightNumber: '802',
        departureAirport: 'SIN',
        arrivalAirport: 'NRT',
        departureDate: '2026-08-01',
        departureTime: '09:15',
        arrivalTime: '17:30',
      },
    ],
    accommodations: [
      {
        id: 'hotel-ongoing',
        type: 'hotel',
        name: 'Shinjuku Granbell',
        status: 'booked',
        checkInDate: '2026-08-03',
        checkOutDate: '2026-08-08',
      },
    ],
    transportation: [
      {
        id: 'undated-shuttle',
        type: 'airport_shuttle',
        status: 'pending',
      },
    ],
  } as unknown as FamilyVacation;
}

describe('useVacationTimeline — when-band + phase', () => {
  beforeEach(() => setActivePinia(createPinia()));

  function run(today = '2026-08-06') {
    const vacation = makeVacation();
    const { timelineItems } = useVacationTimeline(
      computed(() => vacation),
      ref(today)
    );
    const by = (id: string) => timelineItems.value.find((i) => i.id === id)!;
    return { by };
  }

  it('flight: band leads with departs→arrives; the date/time rows are dropped', () => {
    const flight = run().by('flight-past');
    expect(flight.timing?.band.start.time).toBe('09:15');
    expect(flight.timing?.band.end?.time).toBe('17:30');
    const fields = flight.detailRows.map((r) => r.field);
    expect(fields).not.toContain('departureDate');
    expect(fields).not.toContain('departureTime');
    expect(fields).not.toContain('arrivalTime');
    // non-date rows survive (flight # stays inline-editable)
    expect(fields).toContain('flightNumber');
  });

  it('a fully-past flight is phase "past", not ongoing', () => {
    const flight = run().by('flight-past');
    expect(flight.timing?.phase).toBe('past');
    expect(flight.timing?.isOngoingSpan).toBe(false);
  });

  it('an ongoing hotel (checked in, not yet checked out) is "now" + staying-now', () => {
    const hotel = run('2026-08-06').by('hotel-ongoing');
    expect(hotel.timing?.phase).toBe('now');
    expect(hotel.timing?.isOngoingSpan).toBe(true);
    expect(hotel.timing?.band.end?.date).toBe('2026-08-08');
    const fields = hotel.detailRows.map((r) => r.field);
    expect(fields).not.toContain('checkInDate');
    expect(fields).not.toContain('checkOutDate');
  });

  it('the same hotel flips to past once check-out has passed', () => {
    const hotel = run('2026-08-09').by('hotel-ongoing');
    expect(hotel.timing?.phase).toBe('past');
    expect(hotel.timing?.isOngoingSpan).toBe(false);
  });

  it('an undated segment has no timing at all', () => {
    const shuttle = run().by('undated-shuttle');
    expect(shuttle.timing).toBeUndefined();
  });
});
