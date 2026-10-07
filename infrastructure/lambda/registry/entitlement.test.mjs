import { describe, expect, it } from 'vitest';
import {
  ENTITLEMENT_REASONS,
  ENTITLEMENT_STATES,
  SUBSCRIBED_STATUSES,
  TRIAL_DAYS,
  computeEntitlement,
  isNeverFinishedRow,
  isValidInstant,
} from './entitlement.mjs';

const DAY = 24 * 60 * 60 * 1000;
const LAUNCH = '2026-11-01T00:00:00.000Z';
const LAUNCH_MS = Date.parse(LAUNCH);
const iso = (ms) => new Date(ms).toISOString();

/** A family created before launch: its trial runs from launch, not from signup. */
const BETA_CREATED = '2026-06-01T00:00:00.000Z';
/** A family created after launch: its trial runs from signup. */
const LATE_CREATED = '2026-12-15T00:00:00.000Z';
const LATE_TRIAL_END = Date.parse(LATE_CREATED) + TRIAL_DAYS * DAY;

describe('computeEntitlement: the table', () => {
  // Each row: [name, input, expected subset]. `now` defaults to mid-trial of a beta family.
  const cases = [
    [
      'beta: no launch date',
      { createdAt: BETA_CREATED, launchAt: undefined },
      { state: 'beta', reason: 'no_launch', plan: null, trialEndsAt: null },
    ],
    [
      'beta: empty launch date (the Terraform default)',
      { createdAt: BETA_CREATED, launchAt: '' },
      { state: 'beta', reason: 'no_launch' },
    ],
    [
      'active: subscribed with no launch date is still active (paying is paying)',
      {
        createdAt: BETA_CREATED,
        launchAt: '',
        billing: { status: 'active', plan: 'full', currentPeriodEnd: '2027-01-01T00:00:00.000Z' },
      },
      {
        state: 'active',
        reason: 'subscribed',
        plan: 'full',
        trialEndsAt: null,
        currentPeriodEnd: '2027-01-01T00:00:00.000Z',
      },
    ],
    [
      'active: subscribed with no launch but an override reports the override as trialEndsAt',
      {
        launchAt: '',
        billing: { status: 'past_due', plan: 'basic', trialEndsAt: iso(LAUNCH_MS) },
      },
      { state: 'active', reason: 'subscribed', trialEndsAt: iso(LAUNCH_MS) },
    ],
    [
      'active: subscribed after launch reports the launch-derived trialEndsAt',
      { billing: { status: 'active', plan: 'full' }, now: LAUNCH_MS + 200 * DAY },
      { state: 'active', trialEndsAt: iso(LAUNCH_MS + 90 * DAY) },
    ],
    [
      'override, no launch: a future override is a trial (the pre-launch soak)',
      {
        launchAt: '',
        billing: { trialEndsAt: iso(LAUNCH_MS + 5 * DAY) },
        now: LAUNCH_MS,
      },
      { state: 'trial', reason: 'in_trial', trialEndsAt: iso(LAUNCH_MS + 5 * DAY) },
    ],
    [
      'override, no launch: a past override is read_only / trial_ended (the pre-launch soak)',
      {
        launchAt: undefined,
        billing: { trialEndsAt: iso(LAUNCH_MS - DAY), cohort: 'pre_v1' },
        now: LAUNCH_MS,
      },
      {
        state: 'read_only',
        reason: 'trial_ended',
        trialEndsAt: iso(LAUNCH_MS - DAY),
        cohort: 'pre_v1',
      },
    ],
    [
      'override, no launch: a past override with a lapsed subscription is read_only / lapsed',
      {
        launchAt: '',
        billing: {
          trialEndsAt: iso(LAUNCH_MS - DAY),
          status: 'canceled',
          stripeSubscriptionId: 'sub_1',
        },
        now: LAUNCH_MS,
      },
      { state: 'read_only', reason: 'lapsed' },
    ],
    [
      'beta: no override and no launch, with a cohort-only billing row',
      { launchAt: '', billing: { cohort: 'first_ten' } },
      { state: 'beta', reason: 'no_launch', trialEndsAt: null, cohort: 'first_ten' },
    ],
    [
      'beta: an unparseable override and no launch is still beta',
      { launchAt: '', billing: { trialEndsAt: 'soon' } },
      { state: 'beta', reason: 'no_launch', trialEndsAt: null },
    ],
    [
      'trial: a pre-launch family gets a fresh 90 days from launch',
      { createdAt: BETA_CREATED, now: LAUNCH_MS + 10 * DAY },
      { state: 'trial', reason: 'in_trial', plan: null, trialEndsAt: iso(LAUNCH_MS + 90 * DAY) },
    ],
    [
      'trial: a post-launch family gets 90 days from signup',
      { createdAt: LATE_CREATED, now: Date.parse(LATE_CREATED) + DAY },
      { state: 'trial', reason: 'in_trial', trialEndsAt: iso(LATE_TRIAL_END) },
    ],
    [
      'active: status active carries the plan and period end',
      {
        billing: {
          status: 'active',
          plan: 'basic',
          stripeSubscriptionId: 'sub_1',
          currentPeriodEnd: '2027-12-01T00:00:00.000Z',
        },
        now: LAUNCH_MS + 200 * DAY,
      },
      {
        state: 'active',
        reason: 'subscribed',
        plan: 'basic',
        currentPeriodEnd: '2027-12-01T00:00:00.000Z',
      },
    ],
    [
      'active: status trialing',
      { billing: { status: 'trialing', plan: 'full' }, now: LAUNCH_MS + 200 * DAY },
      { state: 'active', reason: 'subscribed', plan: 'full' },
    ],
    [
      'active: status past_due is still paying (Smart Retries running)',
      { billing: { status: 'past_due', plan: 'full' }, now: LAUNCH_MS + 200 * DAY },
      { state: 'active', reason: 'subscribed', plan: 'full' },
    ],
    [
      'active: subscribing during the trial is active at once',
      { billing: { status: 'active', plan: 'full' }, now: LAUNCH_MS + DAY },
      { state: 'active', reason: 'subscribed' },
    ],
    [
      'read_only: status unpaid after the trial is lapsed',
      {
        billing: { status: 'unpaid', plan: 'full', stripeSubscriptionId: 'sub_1' },
        now: LAUNCH_MS + 200 * DAY,
      },
      { state: 'read_only', reason: 'lapsed', plan: null },
    ],
    [
      'read_only: status canceled after the trial is lapsed',
      {
        billing: { status: 'canceled', plan: 'basic', stripeSubscriptionId: 'sub_1' },
        now: LAUNCH_MS + 200 * DAY,
      },
      { state: 'read_only', reason: 'lapsed', plan: null },
    ],
    [
      'trial: a canceled subscription inside the trial window still has its trial',
      {
        billing: { status: 'canceled', plan: 'basic', stripeSubscriptionId: 'sub_1' },
        now: LAUNCH_MS + 10 * DAY,
      },
      { state: 'trial', reason: 'in_trial' },
    ],
    [
      'read_only: trial ended with no subscription ever',
      { now: LAUNCH_MS + 90 * DAY },
      { state: 'read_only', reason: 'trial_ended', trialEndsAt: iso(LAUNCH_MS + 90 * DAY) },
    ],
    [
      'read_only: a cohort-only billing row (no subscription) is trial_ended, cohort kept',
      { billing: { cohort: 'pre_v1' }, now: LAUNCH_MS + 91 * DAY },
      { state: 'read_only', reason: 'trial_ended', cohort: 'pre_v1' },
    ],
    [
      'override: trialEndsAt in the past ends the trial early (the prod soak lever)',
      { billing: { trialEndsAt: iso(LAUNCH_MS + 2 * DAY) }, now: LAUNCH_MS + 3 * DAY },
      { state: 'read_only', reason: 'trial_ended', trialEndsAt: iso(LAUNCH_MS + 2 * DAY) },
    ],
    [
      'override: trialEndsAt in the future extends the trial (the support lever)',
      { billing: { trialEndsAt: iso(LAUNCH_MS + 400 * DAY) }, now: LAUNCH_MS + 200 * DAY },
      { state: 'trial', reason: 'in_trial', trialEndsAt: iso(LAUNCH_MS + 400 * DAY) },
    ],
    [
      'override: an unparseable trialEndsAt is ignored for the computed date',
      { billing: { trialEndsAt: 'soon' }, now: LAUNCH_MS + 10 * DAY },
      { state: 'trial', trialEndsAt: iso(LAUNCH_MS + 90 * DAY) },
    ],
    [
      'bad createdAt: garbage is treated as now, a full trial',
      { createdAt: 'not a date', now: LAUNCH_MS + 500 * DAY },
      { state: 'trial', reason: 'in_trial', trialEndsAt: iso(LAUNCH_MS + 590 * DAY) },
    ],
    [
      'bad createdAt: missing is treated as now',
      { createdAt: undefined, now: LAUNCH_MS + 500 * DAY },
      { state: 'trial', trialEndsAt: iso(LAUNCH_MS + 590 * DAY) },
    ],
    [
      'bad createdAt: a number (not ISO) is treated as now',
      { createdAt: 12345, now: LAUNCH_MS + 500 * DAY },
      { state: 'trial' },
    ],
    [
      'bad launchAt: unparseable is treated as unset (beta)',
      { launchAt: 'next tuesday' },
      { state: 'beta', reason: 'no_launch' },
    ],
  ];

  it.each(cases)('%s', (_name, input, expected) => {
    const result = computeEntitlement({
      createdAt: BETA_CREATED,
      billing: null,
      launchAt: LAUNCH,
      now: LAUNCH_MS + 10 * DAY,
      enforce: false,
      ...input,
    });
    expect(result).toMatchObject(expected);
  });

  it('trial ends exactly at trialEndsAt (now === end is read_only)', () => {
    const end = LAUNCH_MS + 90 * DAY;
    expect(
      computeEntitlement({ createdAt: BETA_CREATED, launchAt: LAUNCH, now: end - 1 }).state
    ).toBe('trial');
    expect(computeEntitlement({ createdAt: BETA_CREATED, launchAt: LAUNCH, now: end }).state).toBe(
      'read_only'
    );
  });
});

describe('computeEntitlement: the enforce flag', () => {
  it('active carries the subscription detail: cancelAt, pastDue, interval, currency (null/false otherwise)', () => {
    const now = Date.parse('2026-10-01T00:00:00Z');
    const active = computeEntitlement({
      createdAt: '2026-01-01T00:00:00Z',
      billing: {
        status: 'active',
        plan: 'full',
        interval: 'year',
        currency: 'usd',
        currentPeriodEnd: '2027-10-01T00:00:00Z',
        cancelAt: '2027-10-01T00:00:00Z',
      },
      now,
    });
    expect(active.state).toBe('active');
    expect(active.cancelAt).toBe('2027-10-01T00:00:00.000Z');
    expect(active.pastDue).toBe(false);
    expect(active.interval).toBe('year');
    expect(active.currency).toBe('usd');

    // A row written before `cancelAt` existed: the boolean marker means "ends at the period end".
    const legacy = computeEntitlement({
      billing: {
        status: 'active',
        plan: 'full',
        currentPeriodEnd: '2027-10-01T01:05:18Z',
        cancelAtPeriodEnd: 'true',
      },
      now,
    });
    expect(legacy.cancelAt).toBe('2027-10-01T01:05:18.000Z');

    const pastDue = computeEntitlement({
      billing: { status: 'past_due', plan: 'basic', interval: 'bogus' },
      now,
    });
    expect(pastDue.state).toBe('active');
    expect(pastDue.pastDue).toBe(true);
    expect(pastDue.cancelAt).toBeNull();
    expect(pastDue.interval).toBeNull();

    const beta = computeEntitlement({ billing: null, now });
    expect(beta).toMatchObject({ cancelAt: null, pastDue: false, interval: null, currency: null });
  });

  it('passes BILLING_ENFORCE through as `enforced`, without changing the state', () => {
    const args = { createdAt: BETA_CREATED, launchAt: LAUNCH, now: LAUNCH_MS + 100 * DAY };
    const on = computeEntitlement({ ...args, enforce: true });
    const off = computeEntitlement({ ...args, enforce: false });
    expect(on.enforced).toBe(true);
    expect(off.enforced).toBe(false);
    // Dry-run still reports the would-be state; enforcement is the client's decision.
    expect(on.state).toBe('read_only');
    expect(off.state).toBe('read_only');
  });

  it('treats anything but boolean true as not enforced', () => {
    for (const enforce of [undefined, null, 'true', 1]) {
      expect(computeEntitlement({ enforce }).enforced).toBe(false);
    }
  });
});

describe('computeEntitlement: the shape', () => {
  it('always returns every key, with serverTime from `now`', () => {
    const now = LAUNCH_MS + 5 * DAY;
    const result = computeEntitlement({ createdAt: BETA_CREATED, launchAt: LAUNCH, now });
    expect(Object.keys(result).sort()).toEqual(
      [
        'cancelAt',
        'cohort',
        'currency',
        'currentPeriodEnd',
        'enforced',
        'interval',
        'pastDue',
        'plan',
        'reason',
        'serverTime',
        'state',
        'trialEndsAt',
      ].sort()
    );
    expect(result.serverTime).toBe(iso(now));
  });

  it('never throws, even with no arguments at all', () => {
    expect(() => computeEntitlement()).not.toThrow();
    expect(computeEntitlement().state).toBe('beta');
  });

  it('only emits states and reasons from the exported vocabularies', () => {
    const states = new Set(Object.values(ENTITLEMENT_STATES));
    const reasons = new Set(Object.values(ENTITLEMENT_REASONS));
    const inputs = [
      {},
      { launchAt: LAUNCH, now: LAUNCH_MS },
      { launchAt: LAUNCH, now: LAUNCH_MS + 100 * DAY },
      { launchAt: LAUNCH, billing: { status: 'active' } },
      {
        launchAt: LAUNCH,
        billing: { status: 'unpaid', stripeSubscriptionId: 's' },
        now: LAUNCH_MS + 100 * DAY,
      },
    ];
    for (const input of inputs) {
      const r = computeEntitlement(input);
      expect(states.has(r.state)).toBe(true);
      expect(reasons.has(r.reason)).toBe(true);
    }
  });

  it('exports the pricing-page trial length and the paying statuses', () => {
    expect(TRIAL_DAYS).toBe(90);
    expect([...SUBSCRIBED_STATUSES].sort()).toEqual(['active', 'past_due', 'trialing']);
  });
});

describe('isValidInstant', () => {
  it('accepts ISO strings and rejects everything else', () => {
    expect(isValidInstant(LAUNCH)).toBe(true);
    expect(isValidInstant('2026-11-01')).toBe(true);
    for (const bad of [undefined, null, '', 'garbage', 12345, {}]) {
      expect(isValidInstant(bad)).toBe(false);
    }
  });
});

describe('isNeverFinishedRow (#125: the one "pod exists" predicate)', () => {
  const STARTED = '2026-10-07T08:00:00.000Z';
  const CREATED = '2026-10-07T08:05:00.000Z';

  it.each([
    ['step 1 only (signupStartedAt, no createdAt)', { signupStartedAt: STARTED }, true],
    ['finished (both stamps)', { signupStartedAt: STARTED, createdAt: CREATED }, false],
    ['legacy pod (createdAt only)', { createdAt: CREATED }, false],
    ['legacy row with neither field (still a pod)', { provider: 'local' }, false],
  ])('%s', (_label, row, expected) => {
    expect(isNeverFinishedRow(row)).toBe(expected);
  });

  it('a step-1 tombstone is still never-finished; null and undefined are not', () => {
    expect(isNeverFinishedRow({ signupStartedAt: STARTED, deletedAt: CREATED })).toBe(true);
    expect(isNeverFinishedRow(null)).toBe(false);
    expect(isNeverFinishedRow(undefined)).toBe(false);
    expect(isNeverFinishedRow({ signupStartedAt: STARTED, createdAt: null })).toBe(true);
  });
});
