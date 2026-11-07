import { describe, expect, it } from 'vitest';
import type { FlightCheck } from '@/types/flightStatus';
import type { VacationTravelSegment } from '@/types/models';
import { revisionOf, tupleFromLeg } from './schedule';
import {
  CANCELLED_REVISION_SUFFIX,
  deriveVerification,
  delayMinutes,
  isCancelRevision,
  planChange,
  providerTuple,
  revertPlan,
  shouldApply,
  takeProviderPatch,
  usableCheck,
  type VerifyContext,
} from './verify';
import { makeCheck, makeFlight, makeLeg, t } from './__tests__/fixtures';

const NOW = Date.parse('2026-12-12T09:00:00Z');
const COPY = { t, lang: 'en' as const };

const ctx = (over: Partial<VerifyContext> = {}): VerifyContext => ({
  nowMs: NOW,
  inWindow: true,
  past: false,
  departed: false,
  enabled: true,
  entitled: true,
  configured: true,
  online: true,
  ...over,
});

/** The airline moved SQ318 to 18:30 from Terminal 3, landing 00:40 the next day. */
const moved = makeLeg({
  dep: {
    scheduledLocal: '2026-12-13 18:30+08:00',
    scheduledUtc: '2026-12-13 10:30Z',
    terminal: '3',
  },
  arr: { scheduledLocal: '2026-12-14 00:40+00:00', scheduledUtc: '2026-12-14 00:40Z' },
});

/** What the device does on a run: apply when due, and return the segment as stored after. */
function applyRun(seg: VacationTravelSegment, check: FlightCheck): VacationTravelSegment {
  if (!check.leg || !shouldApply(seg, check.leg, check.arrivalLeg)) return seg;
  return { ...seg, ...planChange(seg, check.leg, check.arrivalLeg, NOW, COPY) };
}

describe('deriveVerification: the six states', () => {
  it('not-live for every non-flight type', () => {
    for (const type of ['train', 'ferry', 'cruise', 'car'] as const) {
      expect(deriveVerification(makeFlight({ type }), undefined, undefined, ctx()).state).toBe(
        'not-live'
      );
    }
  });

  it('verified when the segment matches the provider, with the check time and live details', () => {
    const leg = makeLeg({
      dep: { gate: 'C21', checkInDesk: '5-7', revisedLocal: '2026-12-13 17:20+08:00' },
      arr: { baggageBelt: '4' },
    });
    const v = deriveVerification(makeFlight(), makeCheck(leg), undefined, ctx());
    expect(v.state).toBe('verified');
    expect(v.checkedAt).toBe(makeCheck(leg).checkedAt);
    expect(v.live).toEqual({
      gate: 'C21',
      desk: '5-7',
      belt: '4',
      estimatedDeparture: '2026-12-13 17:20+08:00',
      status: 'Expected',
    });
    expect(v.was).toBeUndefined();
  });

  it('changed after an apply, until departure, with `was` from liveWas', () => {
    const check = makeCheck(moved);
    const applied = applyRun(makeFlight(), check);
    const v = deriveVerification(applied, check, undefined, ctx());
    expect(v.state).toBe('changed');
    expect(v.was).toEqual({
      departureTime: '17:00',
      terminal: 'Terminal 2',
      arrivalDate: '2026-12-13',
      arrivalTime: '23:10',
    });
    expect(deriveVerification(applied, check, undefined, ctx({ departed: true })).state).toBe(
      'verified'
    );
  });

  it('cancelled from the live leg', () => {
    const check = makeCheck(makeLeg({ status: 'Canceled' }));
    expect(deriveVerification(makeFlight(), check, undefined, ctx()).state).toBe('cancelled');
  });

  it('a reinstated flight stops showing cancelled (the live leg wins over liveCancelledAt)', () => {
    const seg = makeFlight({ status: 'pending', liveCancelledAt: '2026-12-11T00:00:00Z' });
    const v = deriveVerification(seg, makeCheck(makeLeg({})), undefined, ctx());
    expect(v.state).toBe('verified');
  });

  it('display-only statuses never change the state', () => {
    for (const status of ['CanceledUncertain', 'Diverted', 'Delayed']) {
      const v = deriveVerification(makeFlight(), makeCheck(makeLeg({ status })), undefined, ctx());
      expect(v.state).toBe('verified');
      expect(v.live?.status).toBe(status);
    }
  });

  it('conflict when the family edits after an apply, never overwritten', () => {
    const check = makeCheck(moved);
    const applied = applyRun(makeFlight(), check);
    const edited = { ...applied, departureTime: '18:00' };
    const v = deriveVerification(edited, check, undefined, ctx());
    expect(v.state).toBe('conflict');
    expect(v.provider?.departureTime).toBe('18:30');
    expect(v.mine?.departureTime).toBe('18:00');
    expect(shouldApply(edited, moved)).toBe(false);
  });

  it('conflict after "Put it back", and "Use the airline\'s" makes it changed again', () => {
    const check = makeCheck(moved);
    const applied = applyRun(makeFlight(), check);
    const reverted = { ...applied, ...revertPlan(applied) };
    expect(deriveVerification(reverted, check, undefined, ctx()).state).toBe('conflict');
    expect(shouldApply(reverted, moved)).toBe(false);
    const taken = { ...reverted, ...planChange(reverted, moved, undefined, NOW, COPY) };
    expect(deriveVerification(taken, check, undefined, ctx()).state).toBe('changed');
  });

  it('"Use the airline\'s" writes the values only: put back / take, repeated, adds no notes line', () => {
    const check = makeCheck(moved);
    const applied = applyRun(makeFlight({ notes: 'Window seats' }), check);
    let seg = applied;
    for (let i = 0; i < 3; i++) {
      seg = { ...seg, ...revertPlan(seg) };
      const patch = takeProviderPatch(seg, moved);
      expect(Object.keys(patch).some((k) => k === 'notes' || k.startsWith('live'))).toBe(false);
      seg = { ...seg, ...patch };
    }
    expect(seg.notes).toBe(applied.notes);
    expect(seg.notes!.split('\n')).toHaveLength(2); // the family's line + ONE airline line
    expect(seg.liveAppliedAt).toBe(applied.liveAppliedAt);
    expect(seg.liveWas).toEqual(applied.liveWas);
    expect(seg.departureTime).toBe('18:30');
    expect(deriveVerification(seg, check, undefined, ctx()).state).toBe('changed');
  });

  it('an airline change not yet written is changed, applied: false (never a conflict, never a tick)', () => {
    const v = deriveVerification(makeFlight(), makeCheck(moved), undefined, ctx());
    expect(v).toMatchObject({ state: 'changed', applied: false });
    // The plan's values of the moved fields only (the `liveWas` shape).
    expect(v.was).toEqual({
      departureTime: '17:00',
      terminal: 'Terminal 2',
      arrivalDate: '2026-12-13',
      arrivalTime: '23:10',
    });
    expect(v.provider?.departureTime).toBe('18:30');
  });

  it("applied: true once the plan carries the airline's schedule; conflict is applied: false", () => {
    const check = makeCheck(moved);
    const applied = applyRun(makeFlight(), check);
    expect(deriveVerification(applied, check, undefined, ctx()).applied).toBe(true);
    expect(
      deriveVerification(makeFlight(), makeCheck(makeLeg({})), undefined, ctx())
    ).toMatchObject({ state: 'verified', applied: true });
    const edited = { ...applied, departureTime: '18:00' };
    expect(deriveVerification(edited, check, undefined, ctx())).toMatchObject({
      state: 'conflict',
      applied: false,
    });
  });

  it('an unwritten quiet fill (a terminal the booking never had) stays verified', () => {
    const leg = makeLeg({ dep: { terminal: '3' } });
    const v = deriveVerification(
      makeFlight({ terminal: undefined }),
      makeCheck(leg),
      undefined,
      ctx()
    );
    expect(v).toMatchObject({ state: 'verified', applied: false });
  });
});

describe('deriveVerification: unavailable reasons', () => {
  const reason = (
    seg: VacationTravelSegment,
    check?: FlightCheck,
    over: Partial<VerifyContext> = {},
    failure?: Parameters<typeof deriveVerification>[2]
  ) => {
    const v = deriveVerification(seg, check, failure, ctx(over));
    expect(v.state).toBe('unavailable');
    return v.reason;
  };

  it('the device gates, in order, and a cached check is ignored under them', () => {
    const check = makeCheck(makeLeg({}));
    expect(reason(makeFlight(), check, { entitled: false, enabled: false })).toBe('unentitled');
    expect(reason(makeFlight(), check, { enabled: false })).toBe('disabled');
    expect(reason(makeFlight(), check, { configured: false })).toBe('not_configured');
  });

  it('no flight number, or no date', () => {
    expect(reason(makeFlight({ flightNumber: '318', airline: 'Singapore Airlines' }))).toBe(
      'no_flight_number'
    );
    expect(reason(makeFlight({ departureDate: undefined }))).toBe('no_flight_number');
  });

  it('past, and before the window with its opening date', () => {
    expect(reason(makeFlight(), undefined, { past: true, inWindow: false })).toBe('past');
    const v = deriveVerification(
      makeFlight(),
      undefined,
      undefined,
      ctx({ inWindow: false, opensAt: '2026-12-10T09:00:00.000Z' })
    );
    expect(v).toMatchObject({
      state: 'unavailable',
      reason: 'before_window',
      opensAt: '2026-12-10T09:00:00.000Z',
    });
  });

  it('no match, and no coverage, from the cached miss', () => {
    expect(reason(makeFlight(), makeCheck(null))).toBe('no_match');
    expect(reason(makeFlight(), makeCheck(null, { miss: 'no_coverage' }))).toBe('no_coverage');
  });

  it('offline, failed, and none while the first check is on its way', () => {
    expect(reason(makeFlight(), undefined, { online: false })).toBe('offline');
    expect(
      reason(makeFlight(), undefined, {}, { code: 'http_5xx', count: 1, until: NOW + 60_000 })
    ).toBe('failed');
    expect(reason(makeFlight())).toBeUndefined();
  });

  it('a check for a flight number the segment no longer has is ignored', () => {
    expect(reason(makeFlight({ flightNumber: 'SQ322' }), makeCheck(makeLeg({})))).toBeUndefined();
  });

  it('a check for a day the segment no longer has is ignored (no stale Conflict)', () => {
    const seg = makeFlight({ departureDate: '2026-12-14', arrivalDate: '2026-12-14' });
    expect(reason(seg, makeCheck(moved))).toBeUndefined();
  });
});

describe('deriveVerification: no check on this device (the synced fields alone)', () => {
  const check = makeCheck(moved);
  const applied = applyRun(makeFlight(), check);

  it('changed, from liveAppliedAt + liveWas, on a second device before its first fetch', () => {
    const v = deriveVerification(applied, undefined, undefined, ctx());
    expect(v.state).toBe('changed');
    expect(v.was?.departureTime).toBe('17:00');
    expect(v.provider).toBeUndefined();
  });

  it('also when this device is unentitled or switched off', () => {
    expect(deriveVerification(applied, check, undefined, ctx({ entitled: false })).state).toBe(
      'changed'
    );
  });

  it('never conflict without a provider tuple, even after a revert', () => {
    const reverted = { ...applied, ...revertPlan(applied) };
    expect(deriveVerification(reverted, undefined, undefined, ctx()).state).toBe('unavailable');
  });

  it('cancelled from the cancel marker while the segment is still pending', () => {
    const seg = makeFlight({
      status: 'pending',
      liveCancelledAt: '2026-12-12T08:00:00Z',
      liveRevision: `2026-12-13|17:00|2|2026-12-13|23:10${CANCELLED_REVISION_SUFFIX}`,
    });
    expect(deriveVerification(seg, undefined, undefined, ctx()).state).toBe('cancelled');
    expect(
      deriveVerification({ ...seg, status: 'booked' }, undefined, undefined, ctx()).state
    ).toBe('unavailable');
  });

  it('a reinstated flight (plain revision, liveCancelledAt still set) is not cancelled', () => {
    const seg = makeFlight({
      status: 'pending',
      liveCancelledAt: '2026-12-12T08:00:00Z',
      liveRevision: '2026-12-13|17:00|2|2026-12-13|23:10',
    });
    expect(deriveVerification(seg, undefined, undefined, ctx()).state).toBe('unavailable');
  });

  it('a past cancelled flight is unavailable/past (no chip), from the leg or the marker', () => {
    const cancelledLeg = makeLeg({ status: 'Canceled' });
    const recorded = {
      ...makeFlight(),
      ...planChange(makeFlight(), cancelledLeg, undefined, NOW, COPY),
    };
    const past = ctx({ past: true, inWindow: false, departed: true });
    expect(deriveVerification(recorded, makeCheck(cancelledLeg), undefined, past)).toMatchObject({
      state: 'unavailable',
      reason: 'past',
    });
    expect(deriveVerification(recorded, undefined, undefined, past)).toMatchObject({
      state: 'unavailable',
      reason: 'past',
    });
  });

  it('a past flight is unavailable/past', () => {
    expect(
      deriveVerification(applied, undefined, undefined, ctx({ past: true, departed: true }))
    ).toMatchObject({ state: 'unavailable', reason: 'past' });
  });
});

describe('shouldApply / planChange: idempotency', () => {
  it('a first check on a flight that already matches writes nothing', () => {
    expect(shouldApply(makeFlight(), makeLeg({}))).toBe(false);
  });

  it('applies a change once; a second run (or a second device) writes nothing', () => {
    const seg = makeFlight();
    expect(shouldApply(seg, moved)).toBe(true);
    const applied = { ...seg, ...planChange(seg, moved, undefined, NOW, COPY) };
    expect(shouldApply(applied, moved)).toBe(false);
    expect(applied.liveRevision).toBe(revisionOf(tupleFromLeg(moved)));
  });

  it('the full patch: new values, revision, liveWas of the changed fields, notes, arrivesNextDay', () => {
    const seg = makeFlight({ notes: 'Window seats' });
    const patch = planChange(seg, moved, undefined, NOW, COPY);
    expect(patch).toEqual({
      departureTime: '18:30',
      terminal: '3',
      arrivalDate: '2026-12-14',
      arrivalTime: '00:40',
      liveRevision: '2026-12-13|18:30|3|2026-12-14|00:40',
      liveWas: {
        at: new Date(NOW).toISOString(),
        departureTime: '17:00',
        terminal: 'Terminal 2',
        arrivalDate: '2026-12-13',
        arrivalTime: '23:10',
      },
      liveAppliedAt: new Date(NOW).toISOString(),
      notes: expect.stringMatching(/^Window seats\nChanged on .*: Was 5pm from Terminal 2$/),
      arrivesNextDay: true,
    });
    expect(patch.sortDate).toBeUndefined();
  });

  it('a provider-undefined terminal is never compared or written', () => {
    const noTerminal = makeLeg({
      dep: { terminal: undefined, scheduledLocal: '2026-12-13 18:30+08:00' },
    });
    const patch = planChange(makeFlight(), noTerminal, undefined, NOW, COPY);
    expect(patch).not.toHaveProperty('terminal');
    expect(patch.departureTime).toBe('18:30');
    expect(shouldApply(makeFlight({ departureTime: '18:30' }), noTerminal)).toBe(false);
  });

  it('a quiet fill: the airline publishes a terminal the booking never had', () => {
    const seg = makeFlight({ terminal: undefined });
    const leg = makeLeg({ dep: { terminal: '3' } });
    expect(shouldApply(seg, leg)).toBe(true);
    const patch = planChange(seg, leg, undefined, NOW, COPY);
    expect(patch.terminal).toBe('3');
    expect(patch.liveRevision).toBe(revisionOf(tupleFromLeg(leg)));
    expect(patch.notes).toMatch(/^Terminal 3 added from Singapore Airlines, /);
    expect(patch).not.toHaveProperty('liveWas');
    expect(patch).not.toHaveProperty('liveAppliedAt');
    const filled = { ...seg, ...patch };
    expect(shouldApply(filled, leg)).toBe(false);
    expect(deriveVerification(filled, makeCheck(leg), undefined, ctx()).state).toBe('verified');
  });

  it('cancellation: pending + liveCancelledAt + revision + a note, once', () => {
    const leg = makeLeg({ status: 'Canceled' });
    const seg = makeFlight();
    expect(shouldApply(seg, leg)).toBe(true);
    const patch = planChange(seg, leg, undefined, NOW, COPY);
    expect(patch).toEqual({
      status: 'pending',
      liveCancelledAt: new Date(NOW).toISOString(),
      liveRevision: `${revisionOf(tupleFromLeg(leg))}|cancelled`,
      notes: expect.stringMatching(/^Cancelled by Singapore Airlines, /),
    });
    const recorded = { ...seg, ...patch };
    expect(shouldApply(recorded, leg)).toBe(false);
    expect(deriveVerification(recorded, makeCheck(leg), undefined, ctx()).state).toBe('cancelled');
  });

  it('re-booked after a recorded cancellation stays booked: a Conflict, never flipped back', () => {
    const leg = makeLeg({ status: 'Canceled' });
    const seg = makeFlight();
    const recorded = { ...seg, ...planChange(seg, leg, undefined, NOW, COPY) };
    const rebooked = { ...recorded, status: 'booked' as const };
    expect(shouldApply(rebooked, leg)).toBe(false);
    const v = deriveVerification(rebooked, makeCheck(leg), undefined, ctx());
    expect(v.state).toBe('conflict');
    expect(v.live?.status).toBe('Canceled');
  });

  it('a reinstated flight clears the cancel marker, so a later cancellation records again', () => {
    const cancelled = makeLeg({ status: 'Canceled' });
    const seg = makeFlight();
    const recorded = { ...seg, ...planChange(seg, cancelled, undefined, NOW, COPY) };
    const running = makeLeg({});
    expect(shouldApply(recorded, running)).toBe(true);
    const reinstated = { ...recorded, ...planChange(recorded, running, undefined, NOW, COPY) };
    expect(reinstated.liveRevision).toBe(revisionOf(tupleFromLeg(running)));
    expect(reinstated.status).toBe('pending'); // nothing un-flips automatically
    expect(shouldApply(reinstated, running)).toBe(false);
    expect(shouldApply({ ...reinstated, status: 'booked' }, cancelled)).toBe(true);
  });

  it('a cancelled flight whose listing drifts (terminal dropped) is never recorded twice', () => {
    const leg = makeLeg({ status: 'Canceled' });
    const recorded = { ...makeFlight(), ...planChange(makeFlight(), leg, undefined, NOW, COPY) };
    const drifted = makeLeg({ status: 'Canceled', dep: { terminal: undefined } });
    expect(shouldApply(recorded, drifted)).toBe(false);
    const rebooked = { ...recorded, status: 'booked' as const };
    expect(shouldApply(rebooked, drifted)).toBe(false);
    expect(deriveVerification(rebooked, makeCheck(drifted), undefined, ctx()).state).toBe(
      'conflict'
    );
  });

  it('a Canceled → CanceledUncertain → Canceled flap writes nothing after the first cancel', () => {
    const recorded = {
      ...makeFlight(),
      ...planChange(makeFlight(), makeLeg({ status: 'Canceled' }), undefined, NOW, COPY),
    };
    for (const status of ['CanceledUncertain', 'Unknown', 'Diverted', 'Canceled']) {
      expect(shouldApply(recorded, makeLeg({ status }))).toBe(false);
    }
    // A firm running status does reinstate.
    expect(shouldApply(recorded, makeLeg({ status: 'Delayed' }))).toBe(true);
  });

  it('only a firm Canceled writes: CanceledUncertain never does', () => {
    expect(shouldApply(makeFlight(), makeLeg({ status: 'CanceledUncertain' }))).toBe(false);
  });
});

describe('usableCheck: the check answers this flight on this day', () => {
  it('needs the current flight number', () => {
    expect(usableCheck(makeFlight(), makeCheck(makeLeg({})))).toBeDefined();
    expect(
      usableCheck(makeFlight({ flightNumber: 'SQ322' }), makeCheck(makeLeg({})))
    ).toBeUndefined();
    expect(usableCheck(makeFlight(), undefined)).toBeUndefined();
  });

  it("the queried day or the leg's own day: an apply keeps it, a hand edit drops it", () => {
    const nextDay = makeLeg({ dep: { scheduledLocal: '2026-12-14 17:00+08:00' } });
    const check = makeCheck(nextDay); // queried 2026-12-13
    expect(usableCheck(makeFlight(), check)).toBeDefined(); // not yet written
    expect(usableCheck(makeFlight({ departureDate: '2026-12-14' }), check)).toBeDefined(); // applied
    expect(usableCheck(makeFlight({ departureDate: '2026-12-15' }), check)).toBeUndefined();
    expect(usableCheck(makeFlight({ departureDate: undefined }), check)).toBeUndefined();
  });

  it('a no-match check (leg null) fits only its queried day', () => {
    expect(usableCheck(makeFlight(), makeCheck(null))).toBeDefined();
    expect(
      usableCheck(makeFlight({ departureDate: '2026-12-14' }), makeCheck(null))
    ).toBeUndefined();
  });
});

describe('isCancelRevision', () => {
  it('is the marker, nothing else', () => {
    expect(isCancelRevision(`a|b${CANCELLED_REVISION_SUFFIX}`)).toBe(true);
    expect(isCancelRevision('2026-12-13|17:00|2||')).toBe(false);
    expect(isCancelRevision(undefined)).toBe(false);
  });
});

describe('multi-stop numbers: the arrival half from arrivalLeg', () => {
  // SQ25 SIN→FRA→JFK, booked SIN→JFK: the departure from sector 1, the arrival from sector 2.
  const sector1 = makeLeg({
    number: 'SQ 25',
    dep: { scheduledLocal: '2026-12-13 01:00+08:00', scheduledUtc: '2026-12-12 17:00Z' },
    arr: {
      iata: 'FRA',
      scheduledLocal: '2026-12-13 07:30+01:00',
      scheduledUtc: '2026-12-13 06:30Z',
    },
  });
  const sector2 = makeLeg({
    number: 'SQ 25',
    dep: {
      iata: 'FRA',
      scheduledLocal: '2026-12-13 09:00+01:00',
      scheduledUtc: '2026-12-13 08:00Z',
      terminal: '1',
    },
    arr: {
      iata: 'JFK',
      scheduledLocal: '2026-12-13 12:15-05:00',
      scheduledUtc: '2026-12-13 17:15Z',
    },
  });
  const seg = makeFlight({
    flightNumber: 'SQ25',
    departureTime: '01:00',
    arrivalAirport: 'New York (JFK)',
    arrivalDate: '2026-12-13',
    arrivalTime: '12:15',
  });

  it('a booking that matches end to end is verified, with the arrival from sector 2', () => {
    const check = makeCheck(sector1, { flight: 'SQ25', arrivalLeg: sector2 });
    expect(providerTuple(check)?.arrivalTime).toBe('12:15');
    expect(deriveVerification(seg, check, undefined, ctx()).state).toBe('verified');
    expect(shouldApply(seg, sector1, sector2)).toBe(false);
  });

  it('without arrivalLeg the first sector would read as an arrival change', () => {
    expect(shouldApply(seg, sector1)).toBe(true);
  });

  it('arrivalLeg null leaves the arrival half undefined: never compared, never written', () => {
    const check = makeCheck(sector1, { flight: 'SQ25', arrivalLeg: null });
    expect(providerTuple(check)?.arrivalTime).toBeUndefined();
    expect(deriveVerification(seg, check, undefined, ctx()).state).toBe('verified');
    expect(shouldApply(seg, sector1, null)).toBe(false);
  });
});

describe('revertPlan', () => {
  it('restores the liveWas values only, keeping the live keys', () => {
    const applied = applyRun(makeFlight(), makeCheck(moved));
    const patch = revertPlan(applied);
    expect(patch).toEqual({
      departureTime: '17:00',
      terminal: 'Terminal 2',
      arrivalDate: '2026-12-13',
      arrivalTime: '23:10',
      arrivesNextDay: false,
    });
  });

  it('is empty for a segment that was never changed', () => {
    expect(revertPlan(makeFlight())).toEqual({});
  });
});

describe('delayMinutes', () => {
  it('minutes past the schedule, from the same airport clock', () => {
    expect(delayMinutes(makeLeg({ dep: { revisedLocal: '2026-12-13 17:25+08:00' } }))).toBe(25);
    expect(delayMinutes(makeLeg({ dep: { revisedLocal: '2026-12-14 00:10+08:00' } }))).toBe(430);
    expect(delayMinutes(makeLeg({ dep: { revisedLocal: '2026-12-13 16:55+08:00' } }))).toBe(-5);
  });

  it('null without an estimate', () => {
    expect(delayMinutes(makeLeg({}))).toBeNull();
  });
});
