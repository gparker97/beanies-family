import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { computed, ref } from 'vue';
import {
  buildTravelKeyValue,
  travelDetailRows,
  useVacationTimeline,
} from '@/composables/useVacationTimeline';
import type { FamilyVacation, VacationTravelSegment } from '@/types/models';

// Locks the terminal display (#30 follow-up; departure + arrival terminals 2026-11-26): a
// terminal is key info and must surface on the collapsed summary line AND in the expanded
// card, for flights + cruises. A flight's terminal is never shown bare: the summary ties it to
// its airport, and the card shows it in the band's place line, or as a labelled row when the
// band cannot (undated, one-cell band).

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
    it('ties each flight terminal to its airport: "SIN T3 → PVG T2"', () => {
      expect(buildTravelKeyValue(flight({ terminal: '3', arrivalTerminal: 'Terminal 2' }))).toBe(
        'MU 5678 · 6 jun · 9am · SIN T3 → PVG T2'
      );
    });

    it('shows only the known side, never a bare terminal', () => {
      const dep = buildTravelKeyValue(flight({ terminal: 'T1' }));
      expect(dep).toContain('SIN T1');
      expect(dep).not.toContain('→ PVG');
      const arr = buildTravelKeyValue(flight({ arrivalTerminal: '2' }));
      expect(arr).toContain('PVG T2');
      expect(arr).not.toContain('SIN');
    });

    it('keeps a named terminal as written', () => {
      expect(
        buildTravelKeyValue(flight({ arrivalAirport: 'LAX', arrivalTerminal: 'TBIT' }))
      ).toContain('LAX TBIT');
    });

    it('omits a terminal whose airport is not entered', () => {
      const summary = buildTravelKeyValue(
        flight({ departureAirport: undefined, terminal: '3', arrivalTerminal: '2' })
      );
      expect(summary).toContain('PVG T2');
      expect(summary).not.toMatch(/T3|→/);
    });

    it('appends the cruise terminal as before', () => {
      expect(buildTravelKeyValue(cruise({ terminal: 'Cruise Terminal A' }))).toBe(
        'Wonder of the Seas · 1 jul – 8 jul · Cruise Terminal A'
      );
    });

    it('omits the terminal segment when absent', () => {
      expect(buildTravelKeyValue(flight())).not.toMatch(/T\d|Terminal|→/);
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

    it('adds two labelled, read-only terminal rows for flights', () => {
      const rows = travelDetailRows(flight({ terminal: 'Terminal 3', arrivalTerminal: '2' }), t);
      expect(rows.find((r) => r.label === 'vacation.field.departureTerminal')).toEqual({
        label: 'vacation.field.departureTerminal',
        value: 'Terminal 3',
        bandField: 'terminal',
        check: undefined,
      });
      expect(rows.find((r) => r.label === 'vacation.field.arrivalTerminal')).toEqual({
        label: 'vacation.field.arrivalTerminal',
        value: '2',
        bandField: 'arrivalTerminal',
        check: undefined,
      });
      // read-only: no inline-edit field binding, and no unlabelled "Terminal" row
      expect(rows.some((r) => r.label === 'segmentRow.terminal')).toBe(false);
      expect(rows.filter((r) => r.bandField).every((r) => r.field === undefined)).toBe(true);
    });

    it('pushes each terminal row only when its value exists', () => {
      const rows = travelDetailRows(flight({ arrivalTerminal: '2' }), t);
      expect(rows.map((r) => r.bandField).filter(Boolean)).toEqual(['arrivalTerminal']);
    });

    it('adds a read-only terminal row for cruises, unchanged', () => {
      const row = travelDetailRows(cruise({ terminal: 'Cruise Terminal A' }), t).find(
        (r) => r.label === 'segmentRow.terminal'
      );
      expect(row).toEqual({ label: 'segmentRow.terminal', value: 'Cruise Terminal A' });
    });

    it('omits the terminal rows when absent', () => {
      expect(travelDetailRows(flight(), t).some((r) => /erminal/.test(r.label))).toBe(false);
    });
  });

  describe("the band is the terminals' home; the labelled rows are its fallback", () => {
    beforeEach(() => setActivePinia(createPinia()));

    const itemFor = (seg: VacationTravelSegment) => {
      const vacation = {
        id: 'trip-1',
        name: 'Test trip',
        assigneeIds: [],
        ideas: [],
        travelSegments: [seg],
        accommodations: [],
        transportation: [],
      } as unknown as FamilyVacation;
      const { timelineItems } = useVacationTimeline(
        computed(() => vacation),
        ref('2026-06-01')
      );
      return timelineItems.value[0]!;
    };
    const terminalRows = (seg: VacationTravelSegment) =>
      itemFor(seg)
        .detailRows.filter((r) => r.bandField)
        .map((r) => r.bandField);

    it('drops both terminal rows when the band shows them', () => {
      const seg = flight({ terminal: '3', arrivalTerminal: '2' });
      expect(itemFor(seg).timing?.band.end?.place).toEqual({ code: 'PVG', terminal: '2' });
      expect(terminalRows(seg)).toEqual([]);
    });

    it('drops a known terminal while the other side reads "not known yet" in the band', () => {
      const seg = flight({ terminal: '3' });
      expect(itemFor(seg).timing?.band.end?.place).toEqual({ code: 'PVG' });
      expect(terminalRows(seg)).toEqual([]);
    });

    it('an undated flight has no band and keeps both labelled rows', () => {
      const seg = flight({
        terminal: '3',
        arrivalTerminal: '2',
        departureDate: undefined,
        departureTime: undefined,
        arrivalTime: undefined,
        sortDate: undefined,
      });
      const item = itemFor(seg);
      expect(item.timing).toBeUndefined();
      expect(terminalRows(seg)).toEqual(['terminal', 'arrivalTerminal']);
    });

    it('a one-cell band keeps only the "Arrival Terminal" row', () => {
      const seg = flight({ terminal: '3', arrivalTerminal: '2', arrivalTime: undefined });
      const item = itemFor(seg);
      expect(item.timing?.band.end).toBeUndefined();
      expect(item.timing?.band.start.place).toEqual({ code: 'SIN', terminal: '3' });
      expect(terminalRows(seg)).toEqual(['arrivalTerminal']);
    });

    it('a one-cell band with only the arrival terminal shows no place line and keeps its row', () => {
      const seg = flight({ arrivalTerminal: '2', arrivalTime: undefined });
      const item = itemFor(seg);
      expect(item.timing?.band.start.place).toBeUndefined();
      expect(terminalRows(seg)).toEqual(['arrivalTerminal']);
    });

    it('a cruise keeps its Terminal row beside its band', () => {
      const item = itemFor(cruise({ terminal: 'Cruise Terminal A' }));
      expect(item.timing?.band.start.place).toBeUndefined();
      expect(item.detailRows.some((r) => r.value === 'Cruise Terminal A')).toBe(true);
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

// The collapsed summary's carrier token (2026-09-15). It was `${code} ${flightNumber}`
// unconditionally, inside an `if (seg.airline)` gate — so "Singapore Airlines (SQ)" + "SQ25"
// read "SQ SQ25", and a flight number with no airline vanished.
describe('buildTravelKeyValue — the carrier token', () => {
  it('keeps the carrier + plain number form', () => {
    expect(buildTravelKeyValue(flight())).toContain('MU 5678');
  });

  it('does not repeat a carrier the flight number already names', () => {
    const row = buildTravelKeyValue(
      flight({ airline: 'Singapore Airlines (SQ)', flightNumber: 'SQ25' })
    );
    expect(row).toContain('SQ25');
    expect(row).not.toContain('SQ SQ25');
  });

  it('handles the bare code the model now returns', () => {
    const row = buildTravelKeyValue(flight({ airline: 'HO', flightNumber: 'HO1602' }));
    expect(row).toContain('HO1602');
    expect(row).not.toContain('HO HO1602');
  });

  it('renders a flight number that has no airline, which used to disappear', () => {
    expect(buildTravelKeyValue(flight({ airline: undefined, flightNumber: 'SQ25' }))).toContain(
      'SQ25'
    );
  });
});
