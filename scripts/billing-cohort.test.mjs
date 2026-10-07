import { describe, expect, it } from 'vitest';
import {
  BILLING_TABLE,
  firstTenUpdate,
  isExplicitInstant,
  parseArgs,
  selectPreV1Targets,
  snapshotPreV1Update,
  trialEndsAtUpdate,
} from './billing-cohort.mjs';

const FAMILY_ID = '11111111-2222-4333-8444-555555555555';

/**
 * The attributes the OTHER two billing-row writers own (webhook + claim). A PutItem, or a SET
 * that names one of these, would erase a subscription or a claimed token.
 */
const FOREIGN_ATTRS = [
  'status',
  'plan',
  'interval',
  'currency',
  'currentPeriodEnd',
  'stripeCustomerId',
  'stripeSubscriptionId',
  'updatedAt',
];

function namedAttrs(input) {
  return Object.values(input.ExpressionAttributeNames);
}

describe('billing-cohort: write discipline (UpdateItem SET on own attributes only)', () => {
  const builders = {
    snapshot: snapshotPreV1Update(FAMILY_ID),
    firstTen: firstTenUpdate(FAMILY_ID),
    trialEndsAt: trialEndsAtUpdate(FAMILY_ID, '2027-01-01'),
  };

  it.each(Object.entries(builders))('%s is a SET on the billing table by familyId', (_n, input) => {
    expect(input.TableName).toBe(BILLING_TABLE);
    expect(input.Key).toEqual({ familyId: FAMILY_ID });
    expect(input.UpdateExpression).toMatch(/^SET /);
    expect(input.UpdateExpression).not.toMatch(/\b(REMOVE|DELETE|ADD)\b/);
  });

  it.each(Object.entries(builders))('%s never names another writer’s attribute', (_n, input) => {
    for (const attr of namedAttrs(input)) expect(FOREIGN_ATTRS).not.toContain(attr);
  });

  it('the snapshot never overwrites an existing cohort (so first_ten is never downgraded)', () => {
    expect(builders.snapshot.ConditionExpression).toBe('attribute_not_exists(#cohort)');
    expect(builders.snapshot.ExpressionAttributeValues[':cohort']).toBe('pre_v1');
  });

  it('first_ten is unconditional (it upgrades pre_v1)', () => {
    expect(builders.firstTen.ConditionExpression).toBeUndefined();
    expect(builders.firstTen.ExpressionAttributeValues[':cohort']).toBe('first_ten');
  });

  it('normalises the trial override to a full ISO string', () => {
    expect(builders.trialEndsAt.ExpressionAttributeValues[':trialEndsAt']).toBe(
      '2027-01-01T00:00:00.000Z'
    );
  });
});

describe('billing-cohort: arguments', () => {
  it('is dry-run unless --apply is given', () => {
    expect(parseArgs(['--snapshot-pre-v1'])).toEqual({ mode: 'snapshot', apply: false });
    expect(parseArgs(['--snapshot-pre-v1', '--apply']).apply).toBe(true);
    expect(parseArgs(['--apply', '--first-ten', FAMILY_ID])).toEqual({
      mode: 'first-ten',
      familyId: FAMILY_ID,
      apply: true,
    });
  });

  it('parses each single-family mode', () => {
    expect(parseArgs(['--trial-ends-at', FAMILY_ID, '2027-01-01T00:00:00Z'])).toMatchObject({
      mode: 'trial-ends-at',
      familyId: FAMILY_ID,
      iso: '2027-01-01T00:00:00Z',
    });
  });

  it('refuses a malformed familyId, a bad date, extra arguments and unknown flags', () => {
    expect(() => parseArgs(['--first-ten', 'nope'])).toThrow(/UUID/);
    expect(() => parseArgs(['--trial-ends-at', FAMILY_ID, 'soon'])).toThrow(/offset is required/);
    expect(() => parseArgs(['--snapshot-pre-v1', FAMILY_ID])).toThrow(/no arguments/);
    expect(() => parseArgs(['--frist-ten', FAMILY_ID])).toThrow(/Unknown flag/);
    expect(() => parseArgs([])).toThrow(/No command/);
  });
});

describe('billing-cohort: --trial-ends-at needs an explicit offset', () => {
  it('accepts Z and +/-HH:MM offsets', () => {
    for (const ok of [
      '2027-01-15T00:00:00Z',
      '2027-01-15T00:00:00.000Z',
      '2027-01-15T09:00:00+08:00',
      '2027-01-15T09:00-05:00',
    ]) {
      expect(isExplicitInstant(ok)).toBe(true);
      expect(parseArgs(['--trial-ends-at', FAMILY_ID, ok]).iso).toBe(ok);
    }
  });

  it('refuses a zone-less date-time (it would parse in the operator’s local zone)', () => {
    for (const bad of ['2027-01-15T09:00:00', '2027-01-15', '2027-01-15T09:00:00+0800']) {
      expect(isExplicitInstant(bad)).toBe(false);
      expect(() => parseArgs(['--trial-ends-at', FAMILY_ID, bad])).toThrow(/offset is required/);
    }
  });

  it('refuses an explicit-offset string that does not parse', () => {
    expect(isExplicitInstant('2027-13-45T99:00:00Z')).toBe(false);
  });
});

describe('billing-cohort: snapshot selection mirrors attribute_not_exists(cohort)', () => {
  const id = (n) => `${n}1111111-2222-4333-8444-555555555555`;
  const registry = [
    { familyId: id(1) }, // no billing row
    { familyId: id(2) }, // billing row without cohort
    { familyId: id(3) }, // cohort: NULL attribute (exists; the condition would refuse it)
    { familyId: id(4) }, // first_ten
    { familyId: id(5), deletedAt: '2026-09-09T00:00:00.000Z' }, // tombstoned
  ];
  const billing = [
    { familyId: id(2), status: 'active' },
    { familyId: id(3), cohort: null },
    { familyId: id(4), cohort: 'first_ten' },
    { familyId: id(5) },
  ];

  it('writes only live families whose billing row is missing or has no cohort attribute', () => {
    const { toWrite, already, live } = selectPreV1Targets(registry, billing);
    expect(live).toHaveLength(4);
    expect(toWrite.map((r) => r.familyId)).toEqual([id(1), id(2)]);
    expect(already.map((a) => [a.reg.familyId, a.cohort])).toEqual([
      [id(3), null],
      [id(4), 'first_ten'],
    ]);
  });

  it('skips never-finished sign-up starts (#125) and lists them, so they get no cohort', () => {
    const started = { familyId: id(6), signupStartedAt: '2026-10-07T00:00:00.000Z' };
    const pod = {
      familyId: id(7),
      signupStartedAt: '2026-10-07T00:00:00.000Z',
      createdAt: '2026-10-07T01:00:00.000Z',
    };
    const { toWrite, live, skippedNeverFinished } = selectPreV1Targets(
      [...registry, started, pod],
      billing
    );
    expect(skippedNeverFinished).toEqual([started]);
    expect(live.map((r) => r.familyId)).not.toContain(id(6));
    expect(toWrite.map((r) => r.familyId)).toEqual([id(1), id(2), id(7)]);
  });
});
