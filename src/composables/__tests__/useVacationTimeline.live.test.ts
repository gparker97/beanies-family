/**
 * Live flight rows (#143): `travelDetailRows` adds read-only rows from a flight check's
 * display-only `live` details, each flagged `live` (the card draws the pill), and the
 * composable reads them through the INJECTED `verificationFor`, never the store.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { computed, ref } from 'vue';
import { travelDetailRows, useVacationTimeline } from '@/composables/useVacationTimeline';
import type { FamilyVacation, VacationTravelSegment } from '@/types/models';
import type { FlightVerification } from '@/types/flightStatus';

const t = (k: string) => k;

function flight(over: Partial<VacationTravelSegment> = {}): VacationTravelSegment {
  return {
    id: 'f1',
    type: 'flight_outbound',
    title: 'SIN → LHR',
    status: 'booked',
    airline: 'Singapore Airlines (SQ)',
    flightNumber: '318',
    departureDate: '2026-12-13',
    departureTime: '17:00',
    arrivalDate: '2026-12-13',
    arrivalTime: '23:10',
    ...over,
  };
}

describe('travelDetailRows live rows', () => {
  it('adds gate, desk, estimates and belt as read-only live rows', () => {
    const rows = travelDetailRows(flight(), t as never, {
      state: 'verified',
      live: {
        gate: 'C21',
        desk: '5-7',
        belt: '9',
        estimatedDeparture: '2026-12-13 17:25+08:00',
        estimatedArrival: '2026-12-14 00:05+00:00',
      },
    });
    const live = rows.filter((r) => r.live);
    expect(live.map((r) => [r.label, r.value])).toEqual([
      ['travel.live.row.gate', 'C21'],
      ['travel.live.row.desk', '5-7'],
      ['travel.live.row.estDeparts', '5:25pm'],
      ['travel.live.row.estArrives', expect.stringMatching(/^12:05am · /)],
      ['travel.live.row.belt', '9'],
    ]);
    expect(live.every((r) => r.field === undefined)).toBe(true);
  });

  it('drops an estimate that says exactly what the plan says', () => {
    const rows = travelDetailRows(flight(), t as never, {
      state: 'verified',
      live: { estimatedDeparture: '2026-12-13T17:00:00+08:00' },
    });
    expect(rows.some((r) => r.live)).toBe(false);
  });

  it('adds nothing without live details', () => {
    expect(travelDetailRows(flight(), t as never).some((r) => r.live)).toBe(false);
  });
});

describe('travelDetailRows plan-value checks (terminal, from, to)', () => {
  const rowOf = (rows: ReturnType<typeof travelDetailRows>, label: string) =>
    rows.find((r) => r.label === label);
  const answer = (
    terminal: string,
    over: Partial<FlightVerification> = {}
  ): FlightVerification => ({
    state: 'verified',
    checkedAt: 1,
    mine: { terminal: 'Terminal 2' },
    provider: { terminal },
    ...over,
  });

  it("marks the flight terminal with what the airline's latest answer says, however old", () => {
    const seg = flight({ terminal: 'Terminal 2' });
    const check = (v?: FlightVerification) =>
      rowOf(travelDetailRows(seg, t as never, v), 'segmentRow.terminal')?.check;
    expect(check(answer('T2'))).toBe('confirmed');
    expect(check(answer('2', { fresh: false }))).toBe('confirmed');
    expect(check(answer('3', { state: 'conflict', applied: false }))).toBe('conflict');
    expect(check()).toBeUndefined();
  });

  it("marks From / To when the booking carries the matched leg's airport code", () => {
    const seg = flight({ departureAirport: 'Singapore (SIN)', arrivalAirport: 'Tokyo' });
    const rows = travelDetailRows(
      seg,
      t as never,
      answer('2', { route: { from: 'SIN', to: 'NRT' } })
    );
    expect(rowOf(rows, 'segmentRow.from')?.check).toBe('confirmed');
    expect(rowOf(rows, 'segmentRow.to')?.check).toBeUndefined();
  });

  it('never marks a cruise terminal', () => {
    const cruise = flight({ type: 'cruise', terminal: 'Terminal 2' });
    expect(
      rowOf(travelDetailRows(cruise, t as never, answer('2')), 'segmentRow.terminal')?.check
    ).toBeUndefined();
  });
});

describe('useVacationTimeline verificationFor', () => {
  beforeEach(() => setActivePinia(createPinia()));

  function trip(): FamilyVacation {
    return {
      id: 'trip',
      name: 'London',
      assigneeIds: [],
      ideas: [],
      travelSegments: [flight(), { id: 't1', type: 'train', title: 'Train', status: 'booked' }],
      accommodations: [],
      transportation: [],
      createdBy: 'm',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    } as unknown as FamilyVacation;
  }

  it('flight items carry `flight` and the live rows; other items carry neither', () => {
    const asked: string[] = [];
    const verificationFor = (id: string): FlightVerification | undefined => {
      asked.push(id);
      return { state: 'verified', live: { gate: 'C21' } };
    };
    const { timelineItems } = useVacationTimeline(
      computed(() => trip()),
      ref('2026-12-01'),
      { verificationFor }
    );
    const f = timelineItems.value.find((i) => i.id === 'f1')!;
    const train = timelineItems.value.find((i) => i.id === 't1')!;
    expect(f.segmentType).toBe('flight_outbound');
    expect(f.flight?.label).toBe('SQ318');
    expect(f.detailRows.some((r) => r.live && r.value === 'C21')).toBe(true);
    expect(train.segmentType).toBe('train');
    expect(train.flight).toBeUndefined();
    // Only flights are asked: a train is never checked live.
    expect(asked).toEqual(['f1']);
  });

  it('without a getter (the wall), no live rows appear', () => {
    const { timelineItems } = useVacationTimeline(
      computed(() => trip()),
      ref('2026-12-01')
    );
    expect(timelineItems.value.flatMap((i) => i.detailRows).some((r) => r.live)).toBe(false);
  });
});
