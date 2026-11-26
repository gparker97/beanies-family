import { describe, expect, it, vi } from 'vitest';
import type { FamilyMember } from '@/types/models';
import type { FlightVerification } from '@/types/flightStatus';
import type { TravelSegmentOccurrence } from '@/utils/vacation';
import { t } from '@/utils/flightStatus/__tests__/fixtures';
import { buildTravelBriefingRows, travelRowsRange, type TravelRowsContext } from '../travelRows';

const member = (id: string, name: string, ageGroup: 'adult' | 'child', isPet = false) =>
  ({ id, name, ageGroup, role: 'member', isPet }) as FamilyMember;
const mum = member('mum', 'Jill', 'adult');
const dad = member('dad', 'Sam', 'adult');
const kid = member('kid', 'Ansel', 'child');
const kid2 = member('kid2', 'Bea', 'child');
const pet = member('pet', 'Rex', 'adult', true);
const members = [mum, dad, kid, kid2, pet];

const NOW = Date.parse('2026-12-13T08:00:00Z');

function occ(over: Partial<TravelSegmentOccurrence> = {}): TravelSegmentOccurrence {
  return {
    vacationId: 'vac-1',
    segmentIndex: 0,
    segmentId: 'seg-1',
    transportType: 'flight_outbound',
    kind: 'departure',
    status: 'booked',
    date: '2026-12-13',
    time: '17:00',
    title: 'SIN → LHR',
    tripAssigneeIds: ['mum', 'dad', 'kid', 'kid2'],
    airline: 'Singapore Airlines (SQ)',
    flightNumber: 'SQ318',
    departureAirport: 'Singapore (SIN)',
    arrivalAirport: 'LHR',
    schedule: { departureDate: '2026-12-13', departureTime: '17:00', terminal: '2' },
    ...over,
  };
}

function ctx(viewer: FamilyMember, over: Partial<TravelRowsContext> = {}): TravelRowsContext {
  return {
    today: '2026-12-13',
    nowMs: NOW,
    viewer,
    members,
    resolveMember: (id) => members.find((m) => m.id === id),
    t,
    verificationFor: () => undefined,
    homecomingFor: () => [],
    ...over,
  };
}

const verified = (live: FlightVerification['live'] = {}): FlightVerification => ({
  state: 'verified',
  checkedAt: NOW - 12 * 60_000,
  live,
});

describe('plain departure row', () => {
  it('names everyone when the whole family flies, with flight, terminal and "checked" caption', () => {
    const rows = buildTravelBriefingRows([occ()], ctx(mum, { verificationFor: () => verified() }));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'travel-departure:seg-1',
      type: 'travel',
      message: 'Everyone flies at 5pm today',
      caption: 'SQ318 · SIN Terminal 2 · Checked 12 min ago',
      time: '17:00',
      route: { path: '/travel', query: { vacation: 'vac-1', segment: 'seg-1' } },
    });
  });

  it('adds the live gate when the airline published one', () => {
    const [row] = buildTravelBriefingRows(
      [occ()],
      ctx(mum, { verificationFor: () => verified({ gate: 'B12' }) })
    );
    expect(row!.caption).toBe('SQ318 · SIN Terminal 2 · Checked 12 min ago · Gate B12');
  });

  it('names both places with their terminals: "SIN Terminal 3 → LHR Terminal 2"', () => {
    const schedule = { departureDate: '2026-12-13', terminal: 'T3', arrivalTerminal: '2' };
    const [row] = buildTravelBriefingRows([occ({ schedule })], ctx(mum));
    expect(row!.caption).toBe('SQ318 · SIN Terminal 3 → LHR Terminal 2 · Not checked live');
  });

  it('a lone arrival terminal is still tied to its airport', () => {
    const [row] = buildTravelBriefingRows([occ({ schedule: { arrivalTerminal: '2' } })], ctx(mum));
    expect(row!.caption).toBe('SQ318 · LHR Terminal 2 · Not checked live');
  });

  it('omits a terminal whose airport is not entered, never showing it bare', () => {
    const schedule = { terminal: '3', arrivalTerminal: '2' };
    const [row] = buildTravelBriefingRows(
      [occ({ departureAirport: undefined, schedule })],
      ctx(mum)
    );
    expect(row!.caption).toBe('SQ318 · LHR Terminal 2 · Not checked live');
    const [none] = buildTravelBriefingRows(
      [occ({ departureAirport: undefined, arrivalAirport: undefined, schedule })],
      ctx(mum)
    );
    expect(none!.caption).toBe('SQ318 · Not checked live');
  });

  it("a cruise's caption keeps its one terminal, unchanged", () => {
    const [row] = buildTravelBriefingRows(
      [
        occ({
          transportType: 'cruise',
          airline: undefined,
          flightNumber: undefined,
          departureAirport: undefined,
          arrivalAirport: undefined,
          schedule: { terminal: '2' },
        }),
      ],
      ctx(mum)
    );
    expect(row!.caption).toBe('Terminal 2 · Not checked live');
  });

  it('says "Not checked live" for a train, and uses the leaves verb', () => {
    const [row] = buildTravelBriefingRows(
      [occ({ transportType: 'train', airline: undefined, flightNumber: undefined, schedule: {} })],
      ctx(mum)
    );
    expect(row!.message).toBe('Everyone leaves at 5pm today');
    expect(row!.caption).toBe('Not checked live');
  });

  it('names the travellers when only some fly, and hides it from the others', () => {
    const o = occ({ travellerIds: ['mum', 'kid'] });
    const [row] = buildTravelBriefingRows([o], ctx(mum));
    expect(row!.message).toBe('Jill & Ansel fly at 5pm today');
    expect(buildTravelBriefingRows([o], ctx(dad))).toEqual([]); // a parent owns it: assignees only
    expect(buildTravelBriefingRows([o], ctx(kid2))).toEqual([]);
  });

  it("shows an adult a child's solo flight by the child's name", () => {
    const [row] = buildTravelBriefingRows([occ({ travellerIds: ['kid'] })], ctx(dad));
    expect(row!.message).toBe('Ansel flies at 5pm today');
  });

  it('skips an untimed departure, an arrival, and another day', () => {
    expect(buildTravelBriefingRows([occ({ time: undefined })], ctx(mum))).toEqual([]);
    expect(buildTravelBriefingRows([occ({ kind: 'arrival' })], ctx(mum))).toEqual([]);
    expect(buildTravelBriefingRows([occ({ date: '2026-12-14' })], ctx(mum))).toEqual([]);
  });
});

describe('change and cancellation rows replace the plain row', () => {
  const changed = occ({
    time: '18:30',
    schedule: { departureDate: '2026-12-13', departureTime: '18:30', terminal: '3' },
    live: {
      liveRevision: '2026-12-13|18:30|3||',
      liveWas: { departureTime: '17:00', terminal: '2', at: '2026-12-12T10:00:00.000Z' },
      liveAppliedAt: '2026-12-12T10:00:00.000Z',
    },
  });

  it('one row, the change sentence, "was" caption, keyed on the revision', () => {
    const rows = buildTravelBriefingRows([changed], ctx(mum));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'travel-changed:seg-1:2026-12-13|18:30|3||',
      message: 'SQ318 now leaves at 6:30pm from Terminal 3. Your plan has been updated.',
      caption: 'SQ318 · Was 5pm from Terminal 2',
      icon: '🔄',
      route: { path: '/travel', query: { vacation: 'vac-1', segment: 'seg-1' } },
    });
  });

  it('goes to every adult, plus a travelling child, not to a child who is not on it', () => {
    const solo = { ...changed, travellerIds: ['kid'] };
    expect(buildTravelBriefingRows([solo], ctx(dad))).toHaveLength(1); // adult at home
    expect(buildTravelBriefingRows([solo], ctx(kid))).toHaveLength(1);
    expect(buildTravelBriefingRows([solo], ctx(kid2))).toEqual([]);
  });

  it('stops being news after 24 hours and the plain row returns', () => {
    const rows = buildTravelBriefingRows([changed], ctx(mum, { nowMs: NOW + 40 * 3_600_000 }));
    expect(rows[0]!.id).toBe('travel-departure:seg-1');
  });

  it('a cancellation wins and stays', () => {
    const cancelled = occ({
      status: 'pending',
      live: {
        liveRevision: 'rev|cancelled',
        liveCancelledAt: '2026-12-01T10:00:00.000Z',
        liveAppliedAt: '2026-12-12T10:00:00.000Z',
        liveWas: { departureTime: '17:00', at: '2026-12-12T10:00:00.000Z' },
      },
    });
    const [row] = buildTravelBriefingRows([cancelled], ctx(mum));
    expect(row).toMatchObject({
      id: 'travel-cancelled:seg-1:rev|cancelled@2026-12-01T10:00:00.000Z',
      message: 'Singapore Airlines cancelled SQ318 on 13 Dec. This flight is now pending.',
      caption: 'SQ318 · Cancelled',
      icon: '🚫',
      route: { path: '/travel', query: { vacation: 'vac-1', segment: 'seg-1' } },
    });
  });

  it('a reinstated flight (plain revision, liveCancelledAt kept) has no cancelled row', () => {
    const reinstated = occ({
      status: 'pending',
      live: { liveRevision: 'rev-plain', liveCancelledAt: '2026-12-01T10:00:00.000Z' },
    });
    const rows = buildTravelBriefingRows([reinstated], ctx(mum));
    expect(rows.some((r) => r.id.startsWith('travel-cancelled:'))).toBe(false);
  });
});

describe('travelRowsRange', () => {
  it('fetches departures from two days back to tomorrow', () => {
    expect(travelRowsRange('2026-12-13')).toEqual({ from: '2026-12-11', to: '2026-12-14' });
    expect(travelRowsRange('2027-01-01')).toEqual({ from: '2026-12-30', to: '2027-01-02' });
  });

  it('just today when today is not a date, so no undefined bound reaches the filter', () => {
    expect(travelRowsRange('bad')).toEqual({ from: 'bad', to: 'bad' });
  });
});

describe('arrival row: the flight home, for the people at home', () => {
  /** Jill's flight home: leaves LHR yesterday evening, lands in Singapore today at 17:05. */
  function home(over: Partial<TravelSegmentOccurrence> = {}): TravelSegmentOccurrence {
    return occ({
      segmentId: 'seg-2',
      transportType: 'flight_return',
      title: 'LHR → SIN',
      date: '2026-12-12',
      time: '21:00',
      travellerIds: ['mum'],
      flightNumber: 'SQ317',
      departureAirport: 'LHR',
      arrivalAirport: 'Singapore (SIN)',
      schedule: {
        departureDate: '2026-12-12',
        departureTime: '21:00',
        terminal: '4',
        arrivalDate: '2026-12-13',
        arrivalTime: '17:05',
        arrivalTerminal: '1',
      },
      ...over,
    });
  }
  const jillHome = (id: string) => (id === 'seg-2' ? ['mum'] : []);
  const at = (viewer: FamilyMember, over: Partial<TravelRowsContext> = {}) =>
    ctx(viewer, { homecomingFor: jillHome, ...over });

  it('a non-travelling adult gets it: message, caption, id, icon, time and route', () => {
    const rows = buildTravelBriefingRows([home()], at(dad));
    expect(rows).toEqual([
      {
        id: 'travel-arrival:seg-2',
        type: 'travel',
        message: 'Jill lands at 5:05pm',
        caption: 'SQ317 · SIN Terminal 1 · Not checked live',
        icon: '🛬',
        time: '17:05',
        completable: false,
        route: { path: '/travel', query: { vacation: 'vac-1', segment: 'seg-2' } },
      },
    ]);
  });

  it('a non-travelling child gets it; the traveller and a pet do not', () => {
    expect(buildTravelBriefingRows([home()], at(kid)).map((r) => r.id)).toEqual([
      'travel-arrival:seg-2',
    ]);
    expect(buildTravelBriefingRows([home()], at(mum))).toEqual([]);
    expect(buildTravelBriefingRows([home()], at(pet))).toEqual([]);
  });

  it('a flight that departed yesterday and lands today produces the row', () => {
    // `home()` departs on the 12th; today is the 13th, so there is no departure row at all.
    const rows = buildTravelBriefingRows([home()], at(kid2));
    expect(rows.map((r) => r.id)).toEqual(['travel-arrival:seg-2']);
  });

  it('keeps the arrival airport in the caption when its terminal is unknown', () => {
    const [row] = buildTravelBriefingRows(
      [home({ schedule: { ...home().schedule, arrivalTerminal: undefined } })],
      at(dad)
    );
    expect(row!.caption).toBe('SQ317 · SIN · Not checked live');
  });

  it('only a flight home: an outbound or connecting flight (no homecoming) has none', () => {
    expect(buildTravelBriefingRows([home()], ctx(dad))).toEqual([]);
  });

  it('flights only: a train home has no arrival row', () => {
    const train = home({ transportType: 'train', airline: undefined, flightNumber: undefined });
    expect(buildTravelBriefingRows([train], at(dad))).toEqual([]);
  });

  it('names every traveller for whom it is the flight home', () => {
    const both = home({ travellerIds: ['mum', 'dad'] });
    const [row] = buildTravelBriefingRows([both], at(kid, { homecomingFor: () => ['mum', 'dad'] }));
    expect(row!.message).toBe('Jill & Sam land at 5:05pm');
    // Only the people it is the flight home for, even when more are on it.
    const [one] = buildTravelBriefingRows([both], at(kid));
    expect(one!.message).toBe('Jill lands at 5:05pm');
  });

  it('the whole family on the flight: no row for anyone', () => {
    const all = home({ travellerIds: undefined });
    const everyone = () => ['mum', 'dad', 'kid', 'kid2'];
    for (const viewer of members) {
      expect(buildTravelBriefingRows([all], at(viewer, { homecomingFor: everyone }))).toEqual([]);
    }
  });

  it('a child flying alone: an adult at home sees both rows, each with its own id', () => {
    const solo = home({ date: '2026-12-13', time: '09:00', travellerIds: ['kid'] });
    const rows = buildTravelBriefingRows([solo], at(dad, { homecomingFor: () => ['kid'] }));
    expect(rows.map((r) => [r.id, r.message])).toEqual([
      ['travel-departure:seg-2', 'Ansel flies at 9am today'],
      ['travel-arrival:seg-2', 'Ansel lands at 5:05pm'],
    ]);
  });

  describe('today, tonight or not at all', () => {
    const early = (date: string, time: string) =>
      home({ schedule: { ...home().schedule, arrivalDate: date, arrivalTime: time } });

    it('lands tomorrow before 6am: "lands tonight" today, "lands at" tomorrow', () => {
      const o = early('2026-12-14', '00:40');
      const [tonight] = buildTravelBriefingRows([o], at(dad));
      expect(tonight).toMatchObject({
        id: 'travel-arrival:seg-2',
        message: 'Jill lands tonight at 12:40am',
        time: '23:59',
      });
      const [tomorrow] = buildTravelBriefingRows([o], at(dad, { today: '2026-12-14' }));
      expect(tomorrow).toMatchObject({ message: 'Jill lands at 12:40am', time: '00:40' });
    });

    it('lands tomorrow at 6am or later: nothing today', () => {
      expect(buildTravelBriefingRows([early('2026-12-14', '06:00')], at(dad))).toEqual([]);
      expect(buildTravelBriefingRows([early('2026-12-14', '09:30')], at(dad))).toEqual([]);
    });

    it('landed yesterday, or with no usable arrival: nothing', () => {
      expect(buildTravelBriefingRows([early('2026-12-12', '23:00')], at(dad))).toEqual([]);
      expect(buildTravelBriefingRows([early('2026-12-13', '25:00')], at(dad))).toEqual([]);
      expect(buildTravelBriefingRows([home({ schedule: undefined })], at(dad))).toEqual([]);
    });
  });

  describe('live data', () => {
    it('the airline’s arrival terminal wins while a live check carries one', () => {
      const v = { ...verified(), provider: { arrivalTerminal: '3' } };
      const [row] = buildTravelBriefingRows([home()], at(dad, { verificationFor: () => v }));
      expect(row!.caption).toBe('SQ317 · SIN Terminal 3 · Checked 12 min ago');
    });

    it('the estimate replaces the planned time, with the belt and "Scheduled ..."', () => {
      const v = verified({ estimatedArrival: '2026-12-13 17:45+08:00', belt: '7' });
      const [row] = buildTravelBriefingRows([home()], at(dad, { verificationFor: () => v }));
      expect(row).toMatchObject({
        message: 'Jill lands at 5:45pm',
        caption: 'SQ317 · SIN Terminal 1 · Checked 12 min ago · Belt 7 · Scheduled 5:05pm',
        time: '17:45',
      });
    });

    it('an on-time estimate adds no "Scheduled"', () => {
      const v = verified({ estimatedArrival: '2026-12-13 17:05+08:00' });
      const [row] = buildTravelBriefingRows([home()], at(dad, { verificationFor: () => v }));
      expect(row!.caption).toBe('SQ317 · SIN Terminal 1 · Checked 12 min ago');
    });

    it('an estimate can move the row to another day', () => {
      const pastMidnight = verified({ estimatedArrival: '2026-12-14 00:30+08:00' });
      const late = home({ schedule: { ...home().schedule, arrivalTime: '23:30' } });
      const [row] = buildTravelBriefingRows(
        [late],
        at(dad, { verificationFor: () => pastMidnight })
      );
      expect(row!.message).toBe('Jill lands tonight at 12:30am');
      const morning = verified({ estimatedArrival: '2026-12-14 07:10+08:00' });
      expect(buildTravelBriefingRows([late], at(dad, { verificationFor: () => morning }))).toEqual(
        []
      );
    });

    it('once the check window has closed: the planned time and "Not checked live"', () => {
      // `deriveVerification` after Arrived, or 2 h past scheduled arrival: no live, no checkedAt.
      const closed: FlightVerification = { state: 'unavailable', reason: 'past' };
      const [row] = buildTravelBriefingRows([home()], at(dad, { verificationFor: () => closed }));
      expect(row).toMatchObject({
        message: 'Jill lands at 5:05pm',
        caption: 'SQ317 · SIN Terminal 1 · Not checked live',
      });
    });
  });

  describe('a cancelled flight has no arrival row', () => {
    it('cancelled on the plan', () => {
      const cancelled = home({
        live: { liveRevision: 'rev|cancelled', liveCancelledAt: '2026-12-12T10:00:00.000Z' },
      });
      expect(buildTravelBriefingRows([cancelled], at(dad))).toEqual([]);
    });

    it('cancelled as known on this device only', () => {
      const v: FlightVerification = { state: 'cancelled', checkedAt: NOW - 60_000 };
      expect(buildTravelBriefingRows([home()], at(dad, { verificationFor: () => v }))).toEqual([]);
    });
  });

  describe('a throw while building one row never drops the other', () => {
    it('a throwing departure path still yields the arrival row, and is reported', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const onSkipped = vi.fn();
      const o = home({ date: '2026-12-13', travellerIds: ['kid'] });
      Object.defineProperty(o, 'time', {
        get() {
          throw new Error('boom');
        },
      });
      const rows = buildTravelBriefingRows(
        [o],
        at(dad, { homecomingFor: () => ['kid'], onSkipped })
      );
      expect(rows.map((r) => r.id)).toEqual(['travel-arrival:seg-2']);
      expect(onSkipped).toHaveBeenCalledOnce();
      expect(onSkipped).toHaveBeenCalledWith(o, expect.any(Error), 'departure');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('seg-2'), expect.any(Error));
      warn.mockRestore();
    });

    it('a throwing arrival path still yields the departure row', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const onSkipped = vi.fn();
      const o = home({ date: '2026-12-13', travellerIds: ['kid'] });
      const rows = buildTravelBriefingRows(
        [o],
        at(dad, {
          homecomingFor: () => {
            throw new Error('boom');
          },
          onSkipped,
        })
      );
      expect(rows.map((r) => r.id)).toEqual(['travel-departure:seg-2']);
      expect(onSkipped).toHaveBeenCalledOnce();
      warn.mockRestore();
    });
  });
});
