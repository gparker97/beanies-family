/**
 * The revision contract (#143 Phase 2, ADR-046): the client and the `flight-status` Lambda must
 * compute the SAME revision for the same leg, byte for byte, and the Lambda must pick the same
 * leg from the provider codes the device registered. The device seeds the server's `sent_rev`
 * with the revision its plan holds; one byte of drift and the first webhook pushes a revision
 * the device already knows (or the suppression rule never sees the push it got).
 *
 * Imports the REAL Lambda source (`schedule.mjs`, a restatement, not a copy: every Lambda is
 * its own zero-dependency zip) beside the client's `schedule.ts` / `verify.ts` / `match.ts`,
 * the `flightStatusApiParity.test.ts` precedent.
 */
import { describe, expect, it } from 'vitest';
import type { FlightLeg, ScheduleTuple } from '@/types/flightStatus';
import type { FamilyMember, VacationTravelSegment } from '@/types/models';
// @ts-expect-error: plain JS Lambda source, deliberately imported for parity rather than copied.
import * as server from '../../../../infrastructure/lambda/flight-status/schedule.mjs';
import { desiredAlerts, registrationRev } from '../alerts';
import { pickLeg } from '../match';
import { parseUtcMs, revisionOf, tupleFromLeg } from '../schedule';
import { cancelRevisionOf, CANCELLED_REVISION_SUFFIX } from '../verify';
import { makeCheck, makeFlight, makeLeg } from './fixtures';

/** The Lambda module, typed at the boundary (plain JS, JSDoc only). */
const lambda = server as unknown as {
  revisionOf: (t: ScheduleTuple) => string;
  cancelRevisionOf: (t: ScheduleTuple) => string;
  CANCELLED_REVISION_SUFFIX: string;
  tupleFromLeg: (leg: FlightLeg, arrivalLeg?: FlightLeg | null) => ScheduleTuple;
  legForCodes: (
    legs: FlightLeg[],
    codes: { dep: string; arr?: string; date: string; rev?: string }
  ) => { leg: FlightLeg; arrivalLeg: FlightLeg | null } | null;
  planPushes: (
    legs: FlightLeg[],
    devices: Array<{ sk: string; date: string; dep: string; arr?: string; sent_rev: string }>,
    flight: string
  ) => {
    pushes: Array<{ rev: string }>;
    skipped_same_rev: number;
    skipped_no_leg: number;
  };
};

const EDGE_TUPLES: ScheduleTuple[] = [
  {},
  { departureDate: '2026-12-13', departureTime: '17:00' },
  { departureDate: '2026-12-13', departureTime: '17:00', terminal: 'T2' },
  { departureDate: '2026-12-13', departureTime: '17:00', terminal: 'Terminal 2' },
  { departureDate: '2026-12-13', departureTime: '17:00', terminal: ' terminal 2 ' },
  { departureDate: '2026-12-13', departureTime: '9:05', terminal: '1A' },
  { departureDate: '2026-12-13', departureTime: '09:05:00', terminal: 'TA' },
  { departureDate: '2026-12-13T00:00:00', departureTime: '23:55', arrivalDate: '2026-12-14' },
  {
    departureDate: '2026-12-13',
    departureTime: '23:05',
    terminal: '3',
    arrivalDate: '2026-12-14',
    arrivalTime: '06:40',
  },
  { arrivalDate: '2026-12-14', arrivalTime: '6:40' },
  { departureDate: 'soon', departureTime: 'later', terminal: '' },
];

describe('revisionOf / cancelRevisionOf agree byte for byte', () => {
  it.each(EDGE_TUPLES.map((t) => [JSON.stringify(t), t]))('%s', (_label, tuple) => {
    expect(lambda.revisionOf(tuple)).toBe(revisionOf(tuple));
    expect(lambda.cancelRevisionOf(tuple)).toBe(cancelRevisionOf(tuple));
  });

  it('the cancel suffix is the same persisted value', () => {
    expect(lambda.CANCELLED_REVISION_SUFFIX).toBe(CANCELLED_REVISION_SUFFIX);
  });
});

// ── The leg the server picks from the device's registered codes ──────────────────────────────

const sector = (
  number: string,
  dep: [string, string, string, string?],
  arr: [string, string, string],
  status = 'Expected'
): FlightLeg =>
  makeLeg({
    number,
    status,
    dep: { iata: dep[0], scheduledLocal: dep[1], scheduledUtc: dep[2], terminal: dep[3] },
    arr: { iata: arr[0], scheduledLocal: arr[1], scheduledUtc: arr[2] },
  });

/** SQ25 SIN → FRA → JFK, and the previous rotation's FRA → JFK leaving before SIN → FRA lands. */
const SIN_FRA = sector(
  'SQ 25',
  ['SIN', '2026-12-13 23:55+08:00', '2026-12-13 15:55Z', '3'],
  ['FRA', '2026-12-14 06:40+01:00', '2026-12-14 05:40Z']
);
const FRA_JFK = sector(
  'SQ 25',
  ['FRA', '2026-12-14 08:50+01:00', '2026-12-14 07:50Z', '1'],
  ['JFK', '2026-12-14 11:55-05:00', '2026-12-14 16:55Z']
);
const FRA_JFK_PREVIOUS = sector(
  'SQ 25',
  ['FRA', '2026-12-13 08:50+01:00', '2026-12-13 07:50Z', '1'],
  ['JFK', '2026-12-13 11:55-05:00', '2026-12-13 16:55Z']
);

interface Scenario {
  name: string;
  legs: FlightLeg[];
  seg: Partial<VacationTravelSegment>;
}

const SCENARIOS: Scenario[] = [
  { name: 'single sector', legs: [makeLeg({})], seg: {} },
  {
    name: 'next-day arrival',
    legs: [
      sector(
        'SQ 318',
        ['SIN', '2026-12-13 23:05+08:00', '2026-12-13 15:05Z', 'T2'],
        ['LHR', '2026-12-14 05:40+00:00', '2026-12-14 05:40Z']
      ),
    ],
    seg: { departureTime: '23:05', arrivalDate: '2026-12-14', arrivalTime: '05:40' },
  },
  {
    name: 'no terminal published',
    legs: [makeLeg({ dep: { terminal: undefined } })],
    seg: {},
  },
  {
    name: 'multi-stop booked end to end (arrival from the continuation)',
    legs: [SIN_FRA, FRA_JFK, FRA_JFK_PREVIOUS],
    seg: {
      flightNumber: 'SQ25',
      departureTime: '23:55',
      arrivalAirport: 'New York JFK (JFK)',
      arrivalDate: '2026-12-14',
      arrivalTime: '11:55',
    },
  },
  {
    name: 'multi-stop booked first sector only',
    legs: [SIN_FRA, FRA_JFK],
    seg: {
      flightNumber: 'SQ25',
      departureTime: '23:55',
      arrivalAirport: 'Frankfurt (FRA)',
      arrivalDate: '2026-12-14',
      arrivalTime: '06:40',
    },
  },
  {
    name: 'no returned sector reaches the booked arrival (no arrival half)',
    legs: [SIN_FRA],
    seg: { flightNumber: 'SQ25', departureTime: '23:55', arrivalAirport: 'New York JFK (JFK)' },
  },
  {
    name: 'a daily flight seen on two adjacent dates: the booked date wins',
    legs: [
      makeLeg({}),
      makeLeg({
        dep: { scheduledLocal: '2026-12-14 17:00+08:00', scheduledUtc: '2026-12-14 09:00Z' },
        arr: { scheduledLocal: '2026-12-14 23:10+00:00', scheduledUtc: '2026-12-14 23:10Z' },
      }),
    ],
    seg: {},
  },
  { name: 'cancelled', legs: [makeLeg({ status: 'Canceled' })], seg: {} },
];

const mum = { id: 'mum', name: 'Mum', role: 'owner', ageGroup: 'adult' } as FamilyMember;
const TOKEN = 'v1.1800000000.c2lnbmF0dXJl';

/** What this device registers for the scenario: its own pick, through `desiredAlerts`. */
function registration(s: Scenario) {
  const seg = makeFlight(s.seg);
  const pick = pickLeg(s.legs, seg);
  if (!pick || pick.how === 'ambiguous') throw new Error(`${s.name}: the client did not match`);
  const check = makeCheck(pick.leg, {
    flight: seg.flightNumber,
    ...(pick.arrivalLeg !== undefined ? { arrivalLeg: pick.arrivalLeg } : {}),
  });
  const nowMs = parseUtcMs(pick.leg.departure.scheduledUtc)! - 3_600_000;
  const spec = desiredAlerts(
    [{ segment: seg, tripAssigneeIds: ['mum'] }],
    { [seg.id]: check },
    {
      nowMs,
      alertsEnabled: true,
      currentMember: mum,
      alertToken: TOKEN,
      homeZone: 'Asia/Singapore',
    }
  ).get(seg.id);
  if (!spec) throw new Error(`${s.name}: not desired`);
  return { seg, pick, spec };
}

/** The revision the server computes for its own pick. */
function serverRev(sel: { leg: FlightLeg; arrivalLeg: FlightLeg | null }): string {
  const tuple = lambda.tupleFromLeg(sel.leg, sel.arrivalLeg);
  return sel.leg.status === 'Canceled' ? lambda.cancelRevisionOf(tuple) : lambda.revisionOf(tuple);
}

describe('the server picks the leg this device matched, from the codes it registered', () => {
  it.each(SCENARIOS.map((s) => [s.name, s]))('%s', (_name, s) => {
    const { pick, spec } = registration(s);
    const sel = lambda.legForCodes(s.legs, spec);
    expect(sel).not.toBeNull();
    expect(sel!.leg).toBe(pick.leg);
    // Same arrival half: the client's `undefined` (= the leg itself) is the server's `leg`.
    const clientArrival = pick.arrivalLeg === undefined ? pick.leg : pick.arrivalLeg;
    expect(sel!.arrivalLeg).toBe(clientArrival);
    expect(lambda.tupleFromLeg(sel!.leg, sel!.arrivalLeg)).toEqual(
      tupleFromLeg(pick.leg, pick.arrivalLeg)
    );
    expect(serverRev(sel!)).toBe(spec.rev);
    expect(serverRev(sel!)).toBe(
      registrationRev({}, { leg: pick.leg, arrivalLeg: pick.arrivalLeg })
    );
  });

  it.each(SCENARIOS.map((s) => [s.name, s]))(
    '%s: a revision the device registered is never pushed back to it',
    (_name, s) => {
      const { spec } = registration(s);
      const plan = lambda.planPushes(
        s.legs,
        [{ sk: 'd', date: spec.date, dep: spec.dep, arr: spec.arr, sent_rev: spec.rev }],
        spec.flight
      );
      expect(plan.pushes).toEqual([]);
      expect(plan.skipped_same_rev).toBe(1);
    }
  );
});

describe('a pushed revision is the one the device will hold once it applies the change', () => {
  it('a time and terminal move', () => {
    const { spec } = registration(SCENARIOS[0]!);
    const moved = makeLeg({
      dep: {
        scheduledLocal: '2026-12-13 18:30+08:00',
        scheduledUtc: '2026-12-13 10:30Z',
        terminal: '3',
      },
    });
    const plan = lambda.planPushes(
      [moved],
      [{ sk: 'd', date: spec.date, dep: spec.dep, arr: spec.arr, sent_rev: spec.rev }],
      spec.flight
    );
    expect(plan.pushes.map((p) => p.rev)).toEqual([revisionOf(tupleFromLeg(moved))]);
  });

  it('a retime past midnight is still found from the old registered date', () => {
    const { spec } = registration(SCENARIOS[0]!);
    const pastMidnight = makeLeg({
      dep: { scheduledLocal: '2026-12-14 01:30+08:00', scheduledUtc: '2026-12-13 17:30Z' },
      arr: { scheduledLocal: '2026-12-14 07:40+00:00', scheduledUtc: '2026-12-14 07:40Z' },
    });
    const plan = lambda.planPushes(
      [pastMidnight],
      [{ sk: 'd', date: spec.date, dep: spec.dep, arr: spec.arr, sent_rev: spec.rev }],
      spec.flight
    );
    expect(plan.pushes.map((p) => p.rev)).toEqual([revisionOf(tupleFromLeg(pastMidnight))]);
  });

  it("the number's next daily instance (24 h on, a partial payload) is not this device's flight", () => {
    const { spec } = registration(SCENARIOS[0]!);
    const nextInstance = makeLeg({
      dep: { scheduledLocal: '2026-12-14 17:00+08:00', scheduledUtc: '2026-12-14 09:00Z' },
      arr: { scheduledLocal: '2026-12-14 23:10+00:00', scheduledUtc: '2026-12-14 23:10Z' },
    });
    const plan = lambda.planPushes(
      [nextInstance],
      [{ sk: 'd', date: spec.date, dep: spec.dep, arr: spec.arr, sent_rev: spec.rev }],
      spec.flight
    );
    expect(plan.pushes).toEqual([]);
    expect(plan.skipped_no_leg).toBe(1);
  });

  it('a device pushed off its date: the on-date former instance is not its flight; its own retime is pushed as the client revises it', () => {
    const { spec } = registration(SCENARIOS[0]!);
    const pastMidnight = makeLeg({
      dep: { scheduledLocal: '2026-12-14 01:30+08:00', scheduledUtc: '2026-12-13 17:30Z' },
      arr: { scheduledLocal: '2026-12-14 07:40+00:00', scheduledUtc: '2026-12-14 07:40Z' },
    });
    // The previous day's instance, delayed onto the registered date.
    const formerOnDate = makeLeg({
      dep: { scheduledLocal: '2026-12-13 03:00+08:00', scheduledUtc: '2026-12-12 19:00Z' },
      arr: { scheduledLocal: '2026-12-13 09:10+00:00', scheduledUtc: '2026-12-13 09:10Z' },
    });
    // What the device holds once it applied the earlier push (a non-writer: still registered for spec.date).
    const device = {
      sk: 'd',
      date: spec.date,
      dep: spec.dep,
      arr: spec.arr,
      sent_rev: revisionOf(tupleFromLeg(pastMidnight)),
    };
    const unchanged = lambda.planPushes([formerOnDate, pastMidnight], [device], spec.flight);
    expect(unchanged.pushes).toEqual([]);
    expect(unchanged.skipped_same_rev).toBe(1);

    const retimed = makeLeg({
      dep: { scheduledLocal: '2026-12-14 02:15+08:00', scheduledUtc: '2026-12-13 18:15Z' },
      arr: { scheduledLocal: '2026-12-14 08:25+00:00', scheduledUtc: '2026-12-14 08:25Z' },
    });
    const moved = lambda.planPushes([formerOnDate, retimed], [device], spec.flight);
    expect(moved.pushes.map((p) => p.rev)).toEqual([revisionOf(tupleFromLeg(retimed))]);
  });

  it('a cancellation', () => {
    const { spec } = registration(SCENARIOS[0]!);
    const cancelled = makeLeg({ status: 'Canceled' });
    const plan = lambda.planPushes(
      [cancelled],
      [{ sk: 'd', date: spec.date, dep: spec.dep, arr: spec.arr, sent_rev: spec.rev }],
      spec.flight
    );
    expect(plan.pushes.map((p) => p.rev)).toEqual([cancelRevisionOf(tupleFromLeg(cancelled))]);
  });
});
