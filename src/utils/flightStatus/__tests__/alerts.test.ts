/**
 * The pure flight-alert decisions (#143 Phase 2): `registrationRev`, `desiredAlerts`,
 * `diffAlerts`, `pushCovered`. Fixtures only: no Pinia, no I/O.
 */
import { describe, expect, it } from 'vitest';
import type { AlertRegistration } from '@/types/flightStatus';
import type { FamilyMember } from '@/types/models';
import {
  MAX_ALERT_CALLS_PER_RUN,
  alertTokenExpiry,
  desiredAlerts,
  diffAlerts,
  pushCovered,
  registrationRev,
  sameFlightDay,
  type AlertContext,
  type AlertSpec,
} from '../alerts';
import { revisionOf, tupleFromLeg } from '../schedule';
import { CANCELLED_REVISION_SUFFIX } from '../verify';
import { makeCheck, makeFlight, makeLeg } from './fixtures';

/** Inside SQ318's window (it leaves 2026-12-13 09:00Z). */
const NOW = Date.parse('2026-12-12T09:00:00Z');
/** 2027-01-15: unexpired at NOW. */
const TOKEN = 'v1.1800000000.c2lnbmF0dXJl';

const member = (id: string, ageGroup: 'adult' | 'child') =>
  ({ id, name: id, role: 'member', ageGroup }) as FamilyMember;
const mum = member('mum', 'adult');
const kid = member('kid', 'child');

const ctx = (over: Partial<AlertContext> = {}): AlertContext => ({
  nowMs: NOW,
  alertsEnabled: true,
  currentMember: mum,
  alertToken: TOKEN,
  homeZone: 'Asia/Singapore',
  ...over,
});

const leg = makeLeg({});
const LEG_REV = revisionOf(tupleFromLeg(leg));
const candidate = (over: Parameters<typeof makeFlight>[0] = {}, trip = ['mum', 'kid']) => ({
  segment: makeFlight(over),
  tripAssigneeIds: trip,
});
const checks = (l = leg, over: Parameters<typeof makeCheck>[1] = {}) => ({
  'seg-1': makeCheck(l, over),
});

const spec = (over: Partial<AlertSpec> = {}): AlertSpec => ({
  segmentId: 'seg-1',
  flight: 'SQ318',
  date: '2026-12-13',
  dep: 'SIN',
  arr: 'LHR',
  rev: LEG_REV,
  ...over,
});
const reg = (over: Partial<AlertRegistration> = {}): AlertRegistration => {
  const { confirmed = true, ...fields } = over;
  const { segmentId: _s, ...r } = spec(fields);
  return { ...r, confirmed };
};

describe('registrationRev', () => {
  it("is the plan's liveRevision when the segment carries one", () => {
    expect(registrationRev({ liveRevision: 'held-rev' }, { leg })).toBe('held-rev');
  });

  it("is the fetched leg's own revision when it carries none", () => {
    expect(registrationRev({}, { leg })).toBe(LEG_REV);
    expect(registrationRev({}, { leg })).toBe('2026-12-13|17:00|2|2026-12-13|23:10');
  });

  it('is the cancel revision for a Canceled leg', () => {
    const cancelled = makeLeg({ status: 'Canceled' });
    expect(registrationRev({}, { leg: cancelled })).toBe(LEG_REV + CANCELLED_REVISION_SUFFIX);
  });

  it('builds the arrival half from the continuation sector, none when null', () => {
    const onward = makeLeg({
      dep: { iata: 'LHR', scheduledLocal: '2026-12-14 08:00+00:00', terminal: '5' },
      arr: { iata: 'JFK', scheduledLocal: '2026-12-14 11:00-05:00' },
    });
    expect(registrationRev({}, { leg, arrivalLeg: onward })).toBe(
      '2026-12-13|17:00|2|2026-12-14|11:00'
    );
    expect(registrationRev({}, { leg, arrivalLeg: null })).toBe('2026-12-13|17:00|2||');
  });
});

describe('alertTokenExpiry', () => {
  it('reads exp (seconds) from v1.<exp>.<sig>; anything else is null', () => {
    expect(alertTokenExpiry(TOKEN)).toBe(1_800_000_000_000);
    expect(alertTokenExpiry(null)).toBeNull();
    expect(alertTokenExpiry('v2.1800000000.sig')).toBeNull();
    expect(alertTokenExpiry('v1.soon.sig')).toBeNull();
  });
});

describe('desiredAlerts', () => {
  it('a matched in-window flight is desired with the provider codes and the plan revision', () => {
    const out = desiredAlerts([candidate()], checks(), ctx());
    expect([...out.values()]).toEqual([spec()]);
  });

  it('sends the liveRevision the plan holds, not the newer leg', () => {
    const out = desiredAlerts([candidate({ liveRevision: 'old-rev' })], checks(), ctx());
    expect(out.get('seg-1')?.rev).toBe('old-rev');
  });

  it('the arrival code comes from the continuation sector; null arrivalLeg omits it', () => {
    const onward = makeLeg({
      dep: { iata: 'LHR', scheduledLocal: '2026-12-14 08:00+00:00' },
      arr: { iata: 'JFK', scheduledLocal: '2026-12-14 11:00-05:00' },
    });
    expect(
      desiredAlerts([candidate()], checks(leg, { arrivalLeg: onward }), ctx()).get('seg-1')?.arr
    ).toBe('JFK');
    const none = desiredAlerts([candidate()], checks(leg, { arrivalLeg: null }), ctx()).get(
      'seg-1'
    );
    expect(none).toBeDefined();
    expect(none).not.toHaveProperty('arr');
  });

  it('(i) outside the window is not desired', () => {
    const early = Date.parse('2026-12-09T09:00:00Z');
    expect(desiredAlerts([candidate()], checks(), ctx({ nowMs: early })).size).toBe(0);
    const late = Date.parse('2026-12-14T02:00:00Z');
    expect(desiredAlerts([candidate()], checks(), ctx({ nowMs: late })).size).toBe(0);
  });

  it('(ii) no flight number or no date is not desired', () => {
    expect(desiredAlerts([candidate({ flightNumber: '' })], checks(), ctx()).size).toBe(0);
    expect(desiredAlerts([candidate({ departureDate: '' })], checks(), ctx()).size).toBe(0);
  });

  it('(iii) alerts off is not desired', () => {
    expect(desiredAlerts([candidate()], checks(), ctx({ alertsEnabled: false })).size).toBe(0);
  });

  it('(iv) only a change recipient: every adult, a child only on their own flight', () => {
    expect(desiredAlerts([candidate()], checks(), ctx({ currentMember: kid })).size).toBe(1);
    const parentsOnly = candidate({}, ['mum']);
    expect(desiredAlerts([parentsOnly], checks(), ctx({ currentMember: kid })).size).toBe(0);
    expect(desiredAlerts([parentsOnly], checks(), ctx({ currentMember: mum })).size).toBe(1);
    expect(desiredAlerts([candidate()], checks(), ctx({ currentMember: null })).size).toBe(0);
  });

  it('(v) no alert token, or an expired or malformed one, is not desired', () => {
    expect(desiredAlerts([candidate()], checks(), ctx({ alertToken: null })).size).toBe(0);
    const expired = 'v1.1700000000.sig';
    expect(desiredAlerts([candidate()], checks(), ctx({ alertToken: expired })).size).toBe(0);
    expect(desiredAlerts([candidate()], checks(), ctx({ alertToken: 'nope' })).size).toBe(0);
  });

  it('(vi) no usable matched leg is not desired: no check, no match, another flight, no code', () => {
    expect(desiredAlerts([candidate()], {}, ctx()).size).toBe(0);
    expect(desiredAlerts([candidate()], checks(null as never), ctx()).size).toBe(0);
    expect(
      desiredAlerts([candidate()], { 'seg-1': makeCheck(leg, { flight: 'BA12' }) }, ctx()).size
    ).toBe(0);
    const noCode = makeLeg({ dep: { iata: undefined } });
    expect(desiredAlerts([candidate()], checks(noCode), ctx()).size).toBe(0);
  });

  it('does not depend on a push token (none is an input)', () => {
    expect(desiredAlerts.length).toBe(3);
  });
});

describe('diffAlerts', () => {
  const desired = (...specs: AlertSpec[]) => new Map(specs.map((s) => [s.segmentId, s]));

  it('subscribes what is desired and not registered', () => {
    const plan = diffAlerts(desired(spec()), { alerts: {}, pushToken: null }, 'tok');
    expect(plan).toMatchObject({ subscribe: [spec()], unsubscribe: [], overCap: 0 });
    expect(plan.retoken).toBe(true); // the first token is adopted
  });

  it('nothing to do when the registration matches', () => {
    const plan = diffAlerts(
      desired(spec()),
      { alerts: { 'seg-1': reg() }, pushToken: 'tok' },
      'tok'
    );
    expect(plan).toEqual({
      subscribe: [],
      unsubscribe: [],
      overCap: 0,
      unchanged: 1,
      reconfirm: 0,
      retoken: false,
    });
  });

  it('re-subscribes on a new rev or new provider codes, with no unsubscribe', () => {
    const registered = { alerts: { 'seg-1': reg({ rev: 'old' }) }, pushToken: 'tok' };
    expect(diffAlerts(desired(spec()), registered, 'tok')).toMatchObject({
      subscribe: [spec()],
      unsubscribe: [],
    });
    const otherCodes = { alerts: { 'seg-1': reg({ arr: 'LGW' }) }, pushToken: 'tok' };
    expect(diffAlerts(desired(spec()), otherCodes, 'tok').subscribe).toEqual([spec()]);
  });

  it('a changed flight or date unsubscribes the old key and subscribes the new one', () => {
    const registered = { alerts: { 'seg-1': reg({ date: '2026-12-12' }) }, pushToken: 'tok' };
    expect(diffAlerts(desired(spec()), registered, 'tok')).toMatchObject({
      unsubscribe: [{ segmentId: 'seg-1', flight: 'SQ318', date: '2026-12-12', token: 'tok' }],
      subscribe: [spec()],
    });
  });

  it('unsubscribes what is no longer desired, under the token it was registered with', () => {
    const registered = { alerts: { gone: reg() }, pushToken: 'tok' };
    expect(diffAlerts(desired(), registered, null)).toMatchObject({
      unsubscribe: [{ segmentId: 'gone', flight: 'SQ318', date: '2026-12-13', token: 'tok' }],
      subscribe: [],
      retoken: false,
    });
  });

  it('re-token: every registration goes under the old token, every desired comes under the new', () => {
    const registered = {
      alerts: { 'seg-1': reg(), gone: reg({ flight: 'SQ25' }) },
      pushToken: 'old',
    };
    const plan = diffAlerts(desired(spec()), registered, 'new');
    expect(plan.retoken).toBe(true);
    expect(plan.unsubscribe.map((k) => [k.segmentId, k.token])).toEqual([
      ['seg-1', 'old'],
      ['gone', 'old'],
    ]);
    expect(plan.subscribe).toEqual([spec()]);
  });

  it('no push token: no subscribes (the run registers nothing), no re-token', () => {
    const plan = diffAlerts(desired(spec()), { alerts: {}, pushToken: null }, null);
    expect(plan).toMatchObject({ subscribe: [], unsubscribe: [], retoken: false });
  });

  it(`at most ${MAX_ALERT_CALLS_PER_RUN} calls, unsubscribes first; the rest is counted`, () => {
    const many = Array.from({ length: 10 }, (_, i) => spec({ segmentId: `s${i}` }));
    const registered = { alerts: { gone1: reg(), gone2: reg() }, pushToken: 'tok' };
    const plan = diffAlerts(desired(...many), registered, 'tok');
    expect(plan.unsubscribe).toHaveLength(2);
    expect(plan.subscribe).toHaveLength(MAX_ALERT_CALLS_PER_RUN - 2);
    expect(plan.overCap).toBe(12 - MAX_ALERT_CALLS_PER_RUN);
  });

  it.each([-1, 0.5])('a max of %s behaves as 0: no calls, everything counted over cap', (max) => {
    const registered = { alerts: { gone: reg() }, pushToken: 'tok' };
    const plan = diffAlerts(desired(spec()), registered, 'tok', max);
    expect(plan.unsubscribe).toEqual([]);
    expect(plan.subscribe).toEqual([]);
    expect(plan.overCap).toBe(2);
  });

  describe('unconfirmed registrations', () => {
    const registered = (r: AlertRegistration) => ({ alerts: { 'seg-1': r }, pushToken: 'tok' });

    it('re-asks an identical but unconfirmed entry and counts it in reconfirm', () => {
      const plan = diffAlerts(desired(spec()), registered(reg({ confirmed: false })), 'tok');
      expect(plan.subscribe).toEqual([spec()]);
      expect(plan).toMatchObject({ reconfirm: 1, unchanged: 0, overCap: 0 });
    });

    it('does not re-ask a confirmed identical entry', () => {
      const plan = diffAlerts(desired(spec()), registered(reg()), 'tok');
      expect(plan).toMatchObject({ subscribe: [], reconfirm: 0, unchanged: 1 });
    });

    it('orders re-asks after fresh subscribes, so a full cap registers new flights first', () => {
      const held = spec({ segmentId: 'seg-1' });
      const fresh = spec({ segmentId: 'seg-2', flight: 'SQ25' });
      const plan = diffAlerts(
        desired(held, fresh),
        registered(reg({ confirmed: false })),
        'tok',
        1
      );
      expect(plan.subscribe).toEqual([fresh]);
      expect(plan).toMatchObject({ reconfirm: 0, overCap: 1 });
      const roomy = diffAlerts(desired(held, fresh), registered(reg({ confirmed: false })), 'tok');
      expect(roomy.subscribe).toEqual([fresh, held]);
      expect(roomy.reconfirm).toBe(1);
    });

    it('splits the cap between fresh subscribes and re-asks, counting only kept re-asks', () => {
      const held1 = spec({ segmentId: 'seg-1' });
      const held2 = spec({ segmentId: 'seg-2', flight: 'SQ25' });
      const fresh = spec({ segmentId: 'seg-3', flight: 'SQ26' });
      const plan = diffAlerts(
        desired(held1, held2, fresh),
        {
          alerts: {
            'seg-1': reg({ confirmed: false }),
            'seg-2': reg({ flight: 'SQ25', confirmed: false }),
          },
          pushToken: 'tok',
        },
        'tok',
        2
      );
      expect(plan.subscribe).toEqual([fresh, held1]);
      expect(plan).toMatchObject({ reconfirm: 1, overCap: 1, unchanged: 0 });
    });

    it('an unconfirmed entry whose rev changed is a fresh subscribe, not a re-ask', () => {
      const plan = diffAlerts(
        desired(spec({ rev: 'NEW' })),
        registered(reg({ confirmed: false })),
        'tok'
      );
      expect(plan.subscribe).toEqual([spec({ rev: 'NEW' })]);
      expect(plan.reconfirm).toBe(0);
    });
  });
});

describe('pushCovered', () => {
  const seg = makeFlight();

  it('covered: a registration for this flight whose rev is not the plan revision', () => {
    expect(pushCovered(reg({ rev: 'X' }), seg, 'R')).toBe(true);
  });

  it('not covered: the registration already said the plan revision', () => {
    expect(pushCovered(reg({ rev: 'R' }), seg, 'R')).toBe(false);
  });

  it('not covered: no registration, or no revision', () => {
    expect(pushCovered(undefined, seg, 'R')).toBe(false);
    expect(pushCovered(reg({ rev: 'X' }), seg, undefined)).toBe(false);
  });

  it('not covered: a stale registration for another flight, or a date days away', () => {
    expect(pushCovered(reg({ rev: 'X', flight: 'SQ25' }), seg, 'R')).toBe(false);
    expect(pushCovered(reg({ rev: 'X', date: '2026-12-10' }), seg, 'R')).toBe(false);
  });

  it('still covered when the airline moved the flight to the next day (the server matches ±1 day)', () => {
    const moved = makeFlight({ departureDate: '2026-12-14' });
    expect(pushCovered(reg({ rev: 'X', date: '2026-12-13' }), moved, 'R')).toBe(true);
  });
});

describe('pushCovered: confirmation', () => {
  const seg = { airline: 'SQ', flightNumber: '318', departureDate: '2026-12-13' };

  it('is false for an unconfirmed registration whatever its rev', () => {
    expect(pushCovered(reg({ rev: 'X', confirmed: false }), seg, 'R')).toBe(false);
    expect(pushCovered(reg({ rev: 'R', confirmed: false }), seg, 'R')).toBe(false);
  });

  it('is true for a confirmed registration with a different rev', () => {
    expect(pushCovered(reg({ rev: 'X', confirmed: true }), seg, 'R')).toBe(true);
  });
});

describe('sameFlightDay', () => {
  it('same number within a day either way', () => {
    const seg = makeFlight();
    expect(sameFlightDay({ flight: 'SQ318', date: '2026-12-12' }, seg)).toBe(true);
    expect(sameFlightDay({ flight: 'SQ318', date: '2026-12-14' }, seg)).toBe(true);
    expect(sameFlightDay({ flight: 'SQ318', date: '2026-12-15' }, seg)).toBe(false);
    expect(sameFlightDay({ flight: 'SQ319', date: '2026-12-13' }, seg)).toBe(false);
  });
});
