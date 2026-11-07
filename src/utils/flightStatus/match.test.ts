import { describe, expect, it } from 'vitest';
import type { FlightLeg } from '@/types/flightStatus';
import { operatedAs, pickLeg } from './match';
import { tupleFromLeg } from './schedule';

let n = 0;
function leg(
  from: string,
  to: string,
  depLocal: string,
  opts: {
    arrLocal?: string;
    depUtc?: string;
    arrUtc?: string;
    cargo?: boolean;
    number?: string;
    fromName?: string;
  } = {}
): FlightLeg {
  n += 1;
  return {
    number: opts.number ?? 'SQ 25',
    status: 'Expected',
    codeshareStatus: 'IsOperator',
    isCargo: opts.cargo ?? false,
    departure: {
      iata: from,
      name: opts.fromName,
      scheduledLocal: depLocal,
      scheduledUtc: opts.depUtc,
      quality: ['Basic'],
    },
    arrival: {
      iata: to,
      scheduledLocal: opts.arrLocal ?? depLocal.replace(/ \d{2}:/, ' 23:'),
      scheduledUtc: opts.arrUtc,
      quality: ['Basic'],
    },
    lastUpdatedUtc: `2026-12-01 00:0${n % 10}Z`,
  };
}

const SIN_FRA = leg('SIN', 'FRA', '2026-12-13 23:55+08:00', {
  arrLocal: '2026-12-14 06:45+01:00',
  depUtc: '2026-12-13 15:55Z',
});
const FRA_JFK = leg('FRA', 'JFK', '2026-12-14 08:45+01:00', {
  arrLocal: '2026-12-14 11:40-05:00',
  depUtc: '2026-12-14 07:45Z',
});
const SIN_LHR = leg('SIN', 'LHR', '2026-12-13 23:05+08:00', { number: 'SQ 318' });

describe('pickLeg', () => {
  it('airport: departure IATA from a bare or picker-shaped code', () => {
    expect(
      pickLeg([SIN_FRA, FRA_JFK], {
        departureAirport: 'FRA',
        arrivalAirport: 'JFK',
        departureDate: '2026-12-14',
      })
    ).toEqual({
      leg: FRA_JFK,
      how: 'airport',
    });
    expect(
      pickLeg([SIN_FRA, FRA_JFK], {
        departureAirport: 'Frankfurt (FRA) Terminal 1',
        departureDate: '2026-12-14',
      })
    ).toEqual({ leg: FRA_JFK, how: 'airport' });
  });

  it('arrival: arrival IATA when the departure carries no code', () => {
    expect(
      pickLeg([SIN_FRA, FRA_JFK], {
        arrivalAirport: 'Frankfurt (FRA)',
        departureDate: '2026-12-13',
      })
    ).toEqual({ leg: SIN_FRA, how: 'airport' });
  });

  it('arrival match with a departure name that names an earlier sector → multi-stop', () => {
    const r = pickLeg([SIN_FRA, FRA_JFK], {
      departureAirport: 'Singapore',
      arrivalAirport: 'JFK',
      departureDate: '2026-12-13',
    });
    expect(r).toEqual({ leg: SIN_FRA, arrivalLeg: FRA_JFK, how: 'airport' });
  });

  it('arrival match whose departure contradicts the booking name → null', () => {
    expect(
      pickLeg([FRA_JFK], {
        departureAirport: 'Tokyo Narita',
        arrivalAirport: 'JFK',
        departureDate: '2026-12-14',
      })
    ).toBeNull();
  });

  it('name: city or airport name against AIRPORTS and the provider name', () => {
    expect(
      pickLeg([SIN_FRA, FRA_JFK], { departureAirport: 'Frankfurt', departureDate: '2026-12-14' })
    ).toEqual({
      leg: FRA_JFK,
      how: 'name',
    });
    const named = leg('XSP', 'SIN', '2026-12-13 09:00+08:00', { fromName: 'Seletar' });
    const other = leg('KUL', 'SIN', '2026-12-13 10:00+08:00');
    expect(
      pickLeg([named, other], { departureAirport: 'Seletar Airport', departureDate: '2026-12-13' })
    ).toEqual({
      leg: named,
      how: 'name',
    });
  });

  it('name matching is whole-word ("York" does not name New York)', () => {
    const r = pickLeg([SIN_FRA, FRA_JFK], {
      departureAirport: 'York',
      departureDate: '2026-12-14',
    });
    expect(r).toEqual({ legs: [SIN_FRA, FRA_JFK], how: 'ambiguous' });
  });

  it('single: the lone leg when the booking carries no code on either side', () => {
    expect(pickLeg([SIN_LHR], { departureDate: '2026-12-13' })).toEqual({
      leg: SIN_LHR,
      how: 'single',
    });
    expect(
      pickLeg([SIN_LHR], { departureAirport: 'somewhere warm', departureDate: '2026-12-13' })
    ).toEqual({
      leg: SIN_LHR,
      how: 'single',
    });
  });

  it('a lone leg contradicting a resolvable booking code → null, never accepted', () => {
    expect(pickLeg([SIN_LHR], { departureAirport: 'HKG', departureDate: '2026-12-13' })).toBeNull();
    expect(
      pickLeg([SIN_LHR], { arrivalAirport: 'Paris (CDG)', departureDate: '2026-12-13' })
    ).toBeNull();
  });

  it('ambiguous: several candidates and nothing to separate them', () => {
    expect(pickLeg([SIN_FRA, FRA_JFK], { departureDate: '2026-12-13' })).toEqual({
      legs: [SIN_FRA, FRA_JFK],
      how: 'ambiguous',
    });
    const lhr = leg('LHR', 'SIN', '2026-12-13 10:00+00:00');
    const lgw = leg('LGW', 'SIN', '2026-12-13 11:00+00:00');
    expect(
      pickLeg([lhr, lgw], { departureAirport: 'London', departureDate: '2026-12-13' })
    ).toEqual({
      legs: [lhr, lgw],
      how: 'ambiguous',
    });
  });

  it('two legs from the booked airport: the booked date wins, else ambiguous', () => {
    const d13 = leg('SIN', 'LHR', '2026-12-13 23:05+08:00');
    const d14 = leg('SIN', 'LHR', '2026-12-14 23:05+08:00');
    expect(pickLeg([d13, d14], { departureAirport: 'SIN', departureDate: '2026-12-14' })).toEqual({
      leg: d14,
      how: 'airport',
    });
    const a = leg('SIN', 'LHR', '2026-12-13 01:00+08:00');
    const b = leg('SIN', 'LHR', '2026-12-13 23:05+08:00');
    expect(pickLeg([a, b], { departureAirport: 'SIN', departureDate: '2026-12-13' })).toMatchObject(
      {
        how: 'ambiguous',
      }
    );
  });

  it('cargo legs are dropped', () => {
    const cargo = leg('SIN', 'LHR', '2026-12-13 20:00+08:00', { cargo: true });
    expect(pickLeg([cargo], { departureAirport: 'SIN', departureDate: '2026-12-13' })).toBeNull();
    expect(
      pickLeg([cargo, SIN_LHR], { departureAirport: 'SIN', departureDate: '2026-12-13' })
    ).toEqual({
      leg: SIN_LHR,
      how: 'airport',
    });
  });

  it('legs without a usable departure schedule are dropped', () => {
    const unknown: FlightLeg = {
      ...SIN_LHR,
      status: 'Unknown',
      departure: { ...SIN_LHR.departure, scheduledLocal: undefined },
    };
    expect(pickLeg([unknown], { departureDate: '2026-12-13' })).toBeNull();
  });

  it('±1 day filter on the departure local date', () => {
    const dMinus1 = leg('SIN', 'LHR', '2026-12-12 23:05+08:00');
    const dPlus1 = leg('SIN', 'LHR', '2026-12-14 00:10+08:00');
    const dPlus2 = leg('SIN', 'LHR', '2026-12-15 23:05+08:00');
    const dMinus2 = leg('SIN', 'LHR', '2026-12-11 23:05+08:00');
    expect(pickLeg([dMinus1], { departureAirport: 'SIN', departureDate: '2026-12-13' })).toEqual({
      leg: dMinus1,
      how: 'airport',
    });
    expect(pickLeg([dPlus1], { departureAirport: 'SIN', departureDate: '2026-12-13' })).toEqual({
      leg: dPlus1,
      how: 'airport',
    });
    expect(
      pickLeg([dPlus2, dMinus2], { departureAirport: 'SIN', departureDate: '2026-12-13' })
    ).toBeNull();
  });

  it('empty answer → null', () => {
    expect(pickLeg([], { departureAirport: 'SIN', departureDate: '2026-12-13' })).toBeNull();
  });

  describe('multi-stop (SQ25 SIN→FRA→JFK)', () => {
    it('booked end to end: departure from sector 1, arrival from sector 2', () => {
      const r = pickLeg([SIN_FRA, FRA_JFK], {
        departureAirport: 'Singapore (SIN)',
        arrivalAirport: 'New York (JFK)',
        departureDate: '2026-12-13',
      });
      expect(r).toEqual({ leg: SIN_FRA, arrivalLeg: FRA_JFK, how: 'airport' });
      if (!r || r.how === 'ambiguous') throw new Error('expected a leg');
      expect(tupleFromLeg(r.leg, r.arrivalLeg)).toEqual({
        departureDate: '2026-12-13',
        departureTime: '23:55',
        arrivalDate: '2026-12-14',
        arrivalTime: '11:40',
      });
    });

    it('booked on the second sector picks the second leg alone', () => {
      expect(
        pickLeg([SIN_FRA, FRA_JFK], {
          departureAirport: 'FRA',
          arrivalAirport: 'JFK',
          departureDate: '2026-12-14',
        })
      ).toEqual({ leg: FRA_JFK, how: 'airport' });
    });

    it('arrival never comes from an EARLIER sector', () => {
      const r = pickLeg([SIN_FRA, FRA_JFK], {
        departureAirport: 'FRA',
        arrivalAirport: 'Frankfurt (FRA)',
        departureDate: '2026-12-14',
      });
      expect(r).toEqual({ leg: FRA_JFK, arrivalLeg: null, how: 'airport' });
    });

    it('no returned sector reaches the booked arrival → arrivalLeg null, arrival half undefined', () => {
      const r = pickLeg([SIN_FRA], {
        departureAirport: 'SIN',
        arrivalAirport: 'JFK',
        departureDate: '2026-12-13',
      });
      expect(r).toEqual({ leg: SIN_FRA, arrivalLeg: null, how: 'airport' });
      if (!r || r.how === 'ambiguous') throw new Error('expected a leg');
      const t = tupleFromLeg(r.leg, r.arrivalLeg);
      expect(t.arrivalDate).toBeUndefined();
      expect(t.departureTime).toBe('23:55');
    });

    it("without UTC, a continuation is judged on the shared airport's local clock", () => {
      const a = leg('SIN', 'FRA', '2026-12-13 23:55+08:00');
      const b = leg('FRA', 'JFK', '2026-12-14 08:45+01:00', { arrLocal: '2026-12-14 11:40-05:00' });
      expect(
        pickLeg([a, b], {
          departureAirport: 'SIN',
          arrivalAirport: 'JFK',
          departureDate: '2026-12-13',
        })
      ).toEqual({ leg: a, arrivalLeg: b, how: 'airport' });
    });
  });

  describe('continuation rule (Spike 0: SQ25 JFK→FRA→SIN on 2026-12-14)', () => {
    // What AeroDataBox answers for /flights/number/SQ25/2026-12-14?dateLocalRole=Departure:
    // both sectors DEPARTING that local date. The FRA→SIN one is the previous rotation's
    // continuation: it leaves Frankfurt before the JFK sector has even landed.
    const JFK_FRA = leg('JFK', 'FRA', '2026-12-14 20:15-05:00', {
      arrLocal: '2026-12-15 09:50+01:00',
      depUtc: '2026-12-15 01:15Z',
      arrUtc: '2026-12-15 08:50Z',
    });
    const FRA_SIN_PREV = leg('FRA', 'SIN', '2026-12-14 11:25+01:00', {
      arrLocal: '2026-12-15 06:50+08:00',
      depUtc: '2026-12-14 10:25Z',
      arrUtc: '2026-12-14 22:50Z',
    });
    const booking = {
      departureAirport: 'New York (JFK)',
      arrivalAirport: 'Singapore (SIN)',
      departureDate: '2026-12-14',
    };
    const noUtc = (l: FlightLeg): FlightLeg => ({
      ...l,
      departure: { ...l.departure, scheduledUtc: undefined },
      arrival: { ...l.arrival, scheduledUtc: undefined },
    });

    it("the previous rotation's sector is never the arrival half → arrivalLeg null", () => {
      const r = pickLeg([JFK_FRA, FRA_SIN_PREV], booking);
      expect(r).toEqual({ leg: JFK_FRA, arrivalLeg: null, how: 'airport' });
      if (!r || r.how === 'ambiguous') throw new Error('expected a leg');
      const t = tupleFromLeg(r.leg, r.arrivalLeg);
      expect(t.arrivalDate).toBeUndefined();
      expect(t.arrivalTime).toBeUndefined();
      expect(t.departureTime).toBe('20:15');
    });

    it('same refusal from the local clocks alone when UTC is missing', () => {
      expect(pickLeg([noUtc(JFK_FRA), noUtc(FRA_SIN_PREV)], booking)).toEqual({
        leg: noUtc(JFK_FRA),
        arrivalLeg: null,
        how: 'airport',
      });
    });

    it('the true continuation (departs FRA after the JFK sector lands) is accepted', () => {
      const FRA_SIN_NEXT = leg('FRA', 'SIN', '2026-12-15 12:00+01:00', {
        arrLocal: '2026-12-16 07:25+08:00',
        depUtc: '2026-12-15 11:00Z',
        arrUtc: '2026-12-15 23:25Z',
      });
      const r = pickLeg([JFK_FRA, FRA_SIN_PREV, FRA_SIN_NEXT], booking);
      expect(r).toEqual({ leg: JFK_FRA, arrivalLeg: FRA_SIN_NEXT, how: 'airport' });
      if (!r || r.how === 'ambiguous') throw new Error('expected a leg');
      expect(tupleFromLeg(r.leg, r.arrivalLeg)).toEqual({
        departureDate: '2026-12-14',
        departureTime: '20:15',
        arrivalDate: '2026-12-16',
        arrivalTime: '07:25',
      });
      // And without UTC, on the Frankfurt wall clock.
      expect(pickLeg([noUtc(JFK_FRA), noUtc(FRA_SIN_NEXT)], booking)).toMatchObject({
        arrivalLeg: noUtc(FRA_SIN_NEXT),
      });
    });

    it('a sector leaving FRA while the JFK sector is still in the air is not a continuation', () => {
      // Departs after JFK→FRA departs (so "later" by departure) but before it lands.
      const midFlight = leg('FRA', 'SIN', '2026-12-15 05:00+01:00', {
        depUtc: '2026-12-15 04:00Z',
      });
      expect(pickLeg([JFK_FRA, midFlight], booking)).toEqual({
        leg: JFK_FRA,
        arrivalLeg: null,
        how: 'airport',
      });
    });

    it('a sector from another airport is not a continuation, whatever its timing', () => {
      const LHR_SIN = leg('LHR', 'SIN', '2026-12-15 12:00+00:00', { depUtc: '2026-12-15 12:00Z' });
      expect(pickLeg([JFK_FRA, LHR_SIN], booking)).toEqual({
        leg: JFK_FRA,
        arrivalLeg: null,
        how: 'airport',
      });
    });

    it('a sector departing more than 36 h after the arrival is not a continuation', () => {
      const inbound = leg('JFK', 'FRA', '2026-12-13 17:00-05:00', {
        arrLocal: '2026-12-14 07:00+01:00',
        depUtc: '2026-12-13 22:00Z',
        arrUtc: '2026-12-14 06:00Z',
      });
      const at36h = leg('FRA', 'SIN', '2026-12-15 19:00+01:00', { depUtc: '2026-12-15 18:00Z' });
      const past36h = leg('FRA', 'SIN', '2026-12-15 19:01+01:00', { depUtc: '2026-12-15 18:01Z' });
      const seg = { ...booking, departureDate: '2026-12-14' };
      expect(pickLeg([inbound, past36h], seg)).toEqual({
        leg: inbound,
        arrivalLeg: null,
        how: 'airport',
      });
      expect(pickLeg([inbound, at36h], seg)).toEqual({
        leg: inbound,
        arrivalLeg: at36h,
        how: 'airport',
      });
    });

    it('times that cannot be compared are rejected, never guessed', () => {
      const inbound: FlightLeg = {
        ...noUtc(JFK_FRA),
        arrival: { ...JFK_FRA.arrival, scheduledUtc: undefined, scheduledLocal: undefined },
      };
      const onward = noUtc(
        leg('FRA', 'SIN', '2026-12-15 12:00+01:00', { arrLocal: '2026-12-16 07:25+08:00' })
      );
      expect(pickLeg([inbound, onward], booking)).toEqual({
        leg: inbound,
        arrivalLeg: null,
        how: 'airport',
      });
    });

    it('arrival-code path: a departure name only pairs with an inbound it continues', () => {
      // Booked "New York" → SIN: the arrival code picks FRA→SIN, and the JFK sector does not
      // feed it (it lands after FRA→SIN has left), so nothing is matched.
      expect(
        pickLeg([JFK_FRA, FRA_SIN_PREV], { ...booking, departureAirport: 'New York' })
      ).toBeNull();
    });
  });
});

describe('operatedAs', () => {
  it('names the operating flight when the provider answered another number', () => {
    expect(
      operatedAs(leg('SIN', 'LHR', '2026-12-13 23:05+08:00', { number: 'BA 12' }), 'QF1')
    ).toBe('BA12');
  });
  it('undefined for the queried number in any spelling', () => {
    expect(operatedAs(SIN_LHR, 'SQ318')).toBeUndefined();
  });
});
