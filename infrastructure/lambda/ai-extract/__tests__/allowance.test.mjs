/* global process */
/**
 * The magic-beans allowance (#95 Phase 4). `node --test` with an INJECTED client, the
 * `rateLimit.test.mjs` pattern: there is no aws-sdk-client-mock in this repo.
 *
 * The cases that matter most, because getting either wrong is silent:
 *   - the token alone never makes a read `full` (a basic subscriber with a token stays basic);
 *   - a throwing store FAILS OPEN and says so under the alarmed prefix;
 *   - a missing or malformed Full allowance env value FAILS CLOSED to the fallback, never
 *     unlimited, and says so under its own alarmed prefix (#120).
 */

import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALLOWANCE_CONFIG_ERROR_PREFIX,
  ALLOWANCE_STORE_ERROR_PREFIX,
  FULL_PER_DAY_FALLBACK,
  allowanceRefusalBody,
  checkAllowance,
  planAllowance,
  publicLimits,
  readAllowance,
  resetsAtFor,
  safeEqual,
  tierFor,
} from '../allowance.mjs';
import { hash } from '../ddb.mjs';

const FAMILY = 'fam-allowance-01';
const TOKEN = 'plan-token-abc';
const NOW = Date.UTC(2026, 8, 30, 15, 45); // 2026-09-30 15:45 UTC
const BILLING = 'beanies-billing-test';
const USAGE = 'beanies-usage-test';
/** The Terraform-fed Full allowance the tier tests run under (#120). Not the fallback. */
const FULL_PER_DAY_ENV = '25';

class GetItemCommand {
  constructor(input) {
    this.kind = 'get';
    this.input = input;
  }
}
class QueryCommand {
  constructor(input) {
    this.kind = 'query';
    this.input = input;
  }
}

/**
 * A stub over both tables. `billing` is the row (or null), `day` is today's `n`, `month` the
 * per-day `n` values the month Query returns. `calls` is a closure, not `this.calls`: the module
 * destructures `{ send }` and calls it detached (see rateLimit.test.mjs).
 */
function stub({ billing = null, day = 0, month = [], throws = null } = {}) {
  const calls = [];
  return {
    calls,
    ddb: {
      commands: { GetItemCommand, QueryCommand },
      send(cmd) {
        calls.push({ kind: cmd.kind, input: cmd.input });
        if (throws) return Promise.reject(throws);
        if (cmd.kind === 'get' && cmd.input.TableName === BILLING) {
          if (!billing) return Promise.resolve({});
          const Item = {};
          for (const [k, v] of Object.entries(billing)) Item[k] = { S: v };
          return Promise.resolve({ Item });
        }
        if (cmd.kind === 'get') {
          return Promise.resolve(day ? { Item: { n: { N: String(day) } } } : {});
        }
        return Promise.resolve({ Items: month.map((n) => ({ n: { N: String(n) } })) });
      },
    },
  };
}

const FULL_ROW = { status: 'active', plan: 'full', planTokenHash: hash(TOKEN) };
const BASIC_ROW = { status: 'active', plan: 'basic', planTokenHash: hash(TOKEN) };

describe('allowance', () => {
  let lines;
  let errors;
  const original = { log: console.log, error: console.error };

  beforeEach(() => {
    process.env.BILLING_TABLE_NAME = BILLING;
    process.env.USAGE_TABLE = USAGE;
    process.env.AI_FULL_ALLOWANCE_PER_DAY = FULL_PER_DAY_ENV;
    delete process.env.AI_ALLOWANCE_ENFORCE;
    lines = [];
    errors = [];
    console.log = (...a) => lines.push(a.map(String).join(' '));
    console.error = (...a) => errors.push(a.map(String).join(' '));
  });

  afterEach(() => {
    console.log = original.log;
    console.error = original.error;
    delete process.env.BILLING_TABLE_NAME;
    delete process.env.USAGE_TABLE;
    delete process.env.AI_FULL_ALLOWANCE_PER_DAY;
    delete process.env.AI_ALLOWANCE_ENFORCE;
  });

  const json = (msg) => lines.map((l) => JSON.parse(l)).filter((l) => l.msg === msg);

  describe('tierFor', () => {
    it('full needs subscribed AND the full plan AND a matching token', () => {
      assert.equal(tierFor(FULL_ROW, TOKEN), 'full');
      assert.equal(tierFor({ ...FULL_ROW, status: 'trialing' }, TOKEN), 'full');
      assert.equal(tierFor({ ...FULL_ROW, status: 'past_due' }, TOKEN), 'full');
    });

    it('a wrong or missing token on a full plan is basic, never full', () => {
      assert.equal(tierFor(FULL_ROW, 'someone-elses-guess'), 'basic');
      assert.equal(tierFor(FULL_ROW, undefined), 'basic');
      assert.equal(tierFor({ ...FULL_ROW, planTokenHash: undefined }, TOKEN), 'basic');
    });

    it('a basic subscriber WITH its valid token stays basic (the token is not the plan)', () => {
      assert.equal(tierFor(BASIC_ROW, TOKEN), 'basic');
    });

    it('no row, or a lapsed status, is the trial floor', () => {
      assert.equal(tierFor(null, TOKEN), 'trial');
      assert.equal(tierFor({ ...FULL_ROW, status: 'canceled' }, TOKEN), 'trial');
      assert.equal(tierFor({ ...FULL_ROW, status: 'unpaid' }, TOKEN), 'trial');
    });
  });

  it('safeEqual compares by value and survives unequal lengths without throwing', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'abcd'), false);
  });

  it('resetsAt is the next UTC midnight for a day, the next UTC month start for a month', () => {
    assert.equal(resetsAtFor('day', NOW), '2026-10-01T00:00:00.000Z');
    assert.equal(resetsAtFor('month', NOW), '2026-10-01T00:00:00.000Z');
    const mid = Date.UTC(2026, 11, 15, 9);
    assert.equal(resetsAtFor('day', mid), '2026-12-16T00:00:00.000Z');
    assert.equal(resetsAtFor('month', mid), '2027-01-01T00:00:00.000Z');
  });

  describe('checkAllowance', () => {
    it('full: the env-fed allowance a day, read from today’s `n` only', async () => {
      const s = stub({ billing: FULL_ROW, day: 3 });
      const v = await checkAllowance({ familyId: FAMILY, planToken: TOKEN, now: NOW, ddb: s.ddb });
      assert.deepEqual(
        { allowed: v.allowed, tier: v.tier, period: v.period, used: v.used, limit: v.limit },
        { allowed: true, tier: 'full', period: 'day', used: 3, limit: Number(FULL_PER_DAY_ENV) }
      );
      assert.equal(planAllowance().full.perDay, Number(FULL_PER_DAY_ENV));
      assert.equal(v.resetsAt, '2026-10-01T00:00:00.000Z');
      const usageGet = s.calls.find((c) => c.input.TableName === USAGE);
      assert.equal(usageGet.kind, 'get');
      assert.deepEqual(usageGet.input.Key, {
        pk: { S: `f#${hash(FAMILY)}` },
        sk: { S: 'd#2026-09-30' },
      });
      assert.deepEqual(usageGet.input.ExpressionAttributeNames, { '#n': 'n' });
    });

    it('basic: 1 a month, summed over the UTC month’s day items', async () => {
      const s = stub({ billing: BASIC_ROW, month: [0, 1] });
      const v = await checkAllowance({ familyId: FAMILY, planToken: TOKEN, now: NOW, ddb: s.ddb });
      assert.equal(v.tier, 'basic');
      assert.equal(v.period, 'month');
      assert.equal(v.used, 1);
      assert.equal(v.limit, 1);
      const q = s.calls.find((c) => c.kind === 'query');
      assert.equal(q.input.ExpressionAttributeValues[':month'].S, 'd#2026-09');
      assert.equal(q.input.ExpressionAttributeValues[':pk'].S, `f#${hash(FAMILY)}`);
      assert.match(q.input.KeyConditionExpression, /begins_with/);
    });

    it('reads the billing row and today together; queries the month only for basic', async () => {
      const perDay = stub({ billing: FULL_ROW, day: 2 });
      await checkAllowance({ familyId: FAMILY, planToken: TOKEN, now: NOW, ddb: perDay.ddb });
      assert.deepEqual(
        perDay.calls.map((c) => [c.kind, c.input.TableName]),
        [
          ['get', BILLING],
          ['get', USAGE],
        ],
        'both GetItems, issued before either resolves, and no Query for a per-day tier'
      );

      const trial = stub({ billing: null, day: 0 });
      await checkAllowance({ familyId: FAMILY, now: NOW, ddb: trial.ddb });
      assert.equal(trial.calls.filter((c) => c.kind === 'query').length, 0);

      const basic = stub({ billing: BASIC_ROW, day: 5, month: [1] });
      const v = await checkAllowance({
        familyId: FAMILY,
        planToken: TOKEN,
        now: NOW,
        ddb: basic.ddb,
      });
      assert.deepEqual(
        basic.calls.map((c) => c.kind),
        ['get', 'get', 'query']
      );
      assert.equal(v.used, 1, "basic counts the month's sum, not today's GetItem");
    });

    it('a failure in either parallel read fails open', async () => {
      const ddb = {
        commands: { GetItemCommand, QueryCommand },
        send(cmd) {
          return cmd.input.TableName === USAGE
            ? Promise.reject(new Error('usage down'))
            : Promise.resolve({});
        },
      };
      const v = await checkAllowance({ familyId: FAMILY, now: NOW, ddb, enforce: true });
      assert.deepEqual(v, { allowed: true, degraded: true });
      assert.ok(errors[0].startsWith(ALLOWANCE_STORE_ERROR_PREFIX));
    });

    it('no billing row: the trial floor, 1 a day', async () => {
      const s = stub({ billing: null, day: 0 });
      const v = await checkAllowance({ familyId: FAMILY, now: NOW, ddb: s.ddb });
      assert.equal(v.tier, 'trial');
      assert.equal(v.period, 'day');
      assert.equal(v.limit, 1);
      assert.equal(v.allowed, true);
    });

    it('a wrong token on a full plan is checked against the basic allowance', async () => {
      const s = stub({ billing: FULL_ROW, month: [1] });
      const v = await checkAllowance({
        familyId: FAMILY,
        planToken: 'forged',
        now: NOW,
        ddb: s.ddb,
      });
      assert.equal(v.tier, 'basic');
      assert.equal(v.used, 1);
    });

    it('dry-run: over the limit is ALLOWED and logs allowance_would_deny', async () => {
      const s = stub({ billing: null, day: 1 });
      const v = await checkAllowance({ familyId: FAMILY, now: NOW, ddb: s.ddb, enforce: false });
      assert.equal(v.allowed, true);
      const [would] = json('allowance_would_deny');
      assert.deepEqual(would, {
        msg: 'allowance_would_deny',
        family_id_hash: hash(FAMILY),
        tier: 'trial',
        period: 'day',
        used: 1,
        limit: 1,
      });
      assert.equal(json('allowance_denied').length, 0);
      const [checked] = json('allowance_checked');
      assert.equal(checked.allowed, true);
      assert.equal(checked.enforced, false);
    });

    it('enforce reads AI_ALLOWANCE_ENFORCE at call time, and only the exact string "true"', async () => {
      process.env.AI_ALLOWANCE_ENFORCE = 'TRUE';
      let v = await checkAllowance({ familyId: FAMILY, now: NOW, ddb: stub({ day: 1 }).ddb });
      assert.equal(v.allowed, true);
      process.env.AI_ALLOWANCE_ENFORCE = 'true';
      v = await checkAllowance({ familyId: FAMILY, now: NOW, ddb: stub({ day: 1 }).ddb });
      assert.equal(v.allowed, false);
      assert.equal(json('allowance_denied').length, 1);
    });

    it('under the limit logs allowance_checked only, never a deny line', async () => {
      await checkAllowance({
        familyId: FAMILY,
        now: NOW,
        ddb: stub({ day: 0 }).ddb,
        enforce: true,
      });
      assert.equal(json('allowance_checked').length, 1);
      assert.equal(json('allowance_would_deny').length + json('allowance_denied').length, 0);
    });

    it('never logs the raw family id', async () => {
      await checkAllowance({ familyId: FAMILY, now: NOW, ddb: stub({ day: 5 }).ddb });
      assert.ok(lines.every((l) => !l.includes(FAMILY)));
    });

    it('a store failure FAILS OPEN under the alarmed prefix, with remediation', async () => {
      const s = stub({ throws: new Error('AccessDeniedException') });
      const v = await checkAllowance({ familyId: FAMILY, now: NOW, ddb: s.ddb, enforce: true });
      assert.deepEqual(v, { allowed: true, degraded: true });
      assert.equal(errors.length, 1);
      assert.ok(errors[0].startsWith(ALLOWANCE_STORE_ERROR_PREFIX));
      assert.match(errors[0], /BILLING_TABLE_NAME/);
      assert.match(errors[0], /dynamodb:Query/);
    });

    it('an unset table is a silent no-op', async () => {
      delete process.env.BILLING_TABLE_NAME;
      const s = stub({ day: 9 });
      const v = await checkAllowance({ familyId: FAMILY, now: NOW, ddb: s.ddb, enforce: true });
      assert.deepEqual(v, { allowed: true });
      assert.equal(s.calls.length, 0);
      assert.equal(lines.length + errors.length, 0);
    });

    it('no family id: allowed without a read (nothing to count against)', async () => {
      const s = stub({ day: 9 });
      const v = await checkAllowance({ now: NOW, ddb: s.ddb, enforce: true });
      assert.deepEqual(v, { allowed: true });
      assert.equal(s.calls.length, 0);
    });

    it('an over-long family id skips the billing lookup (trial floor), never a store error', async () => {
      const s = stub({ billing: FULL_ROW, day: 1 });
      const v = await checkAllowance({
        familyId: 'x'.repeat(5000),
        planToken: TOKEN,
        now: NOW,
        ddb: s.ddb,
        enforce: true,
      });
      assert.equal(v.tier, 'trial');
      assert.equal(v.allowed, false);
      assert.ok(s.calls.every((c) => c.input.TableName !== BILLING));
      assert.equal(errors.length, 0);
    });
  });

  describe('readAllowance', () => {
    it('returns the usage shape and never refuses, even over the limit', async () => {
      const r = await readAllowance({ familyId: FAMILY, now: NOW, ddb: stub({ day: 4 }).ddb });
      assert.deepEqual(r, {
        ok: true,
        usage: {
          tier: 'trial',
          period: 'day',
          limit: 1,
          used: 4,
          resetsAt: '2026-10-01T00:00:00.000Z',
        },
      });
      assert.equal(json('allowance_read').length, 1);
      assert.equal(json('allowance_checked').length, 0, 'a read is not a decision');
    });

    it('classifies what it cannot answer', async () => {
      assert.deepEqual(await readAllowance({ now: NOW }), { ok: false, reason: 'no_family' });
      const failing = stub({ throws: new Error('boom') });
      assert.deepEqual(await readAllowance({ familyId: FAMILY, now: NOW, ddb: failing.ddb }), {
        ok: false,
        reason: 'store_error',
      });
      assert.ok(errors[0].startsWith(ALLOWANCE_STORE_ERROR_PREFIX));
      delete process.env.USAGE_TABLE;
      assert.deepEqual(await readAllowance({ familyId: FAMILY, now: NOW }), {
        ok: false,
        reason: 'unconfigured',
      });
    });
  });

  it('the 402 body carries the numbers the client shows', () => {
    assert.deepEqual(
      allowanceRefusalBody({
        allowed: false,
        used: 1,
        limit: 1,
        period: 'day',
        resetsAt: '2026-10-01T00:00:00.000Z',
        tier: 'trial',
      }),
      {
        error: 'Magic beans allowance reached',
        code: 'allowance_exceeded',
        used: 1,
        limit: 1,
        period: 'day',
        resetsAt: '2026-10-01T00:00:00.000Z',
        tier: 'trial',
      }
    );
  });
});

describe('publicLimits: the keyless GET body (#120)', () => {
  const original = { log: console.log, error: console.error };
  let lines;

  beforeEach(() => {
    process.env.AI_FULL_ALLOWANCE_PER_DAY = FULL_PER_DAY_ENV;
    lines = [];
    console.log = (...a) => lines.push(JSON.parse(a.map(String).join(' ')));
    console.error = () => {};
  });

  afterEach(() => {
    console.log = original.log;
    console.error = original.error;
    delete process.env.AI_FULL_ALLOWANCE_PER_DAY;
  });

  it('is the planLimits.ts shape: three tiers with period + limit, and the source', () => {
    assert.deepEqual(publicLimits(), {
      trial: { period: 'day', limit: 1 },
      basic: { period: 'month', limit: 1 },
      full: { period: 'day', limit: Number(FULL_PER_DAY_ENV) },
      source: 'env',
    });
  });

  it('logs allowance_limits_read on every call, with no family hash', () => {
    publicLimits();
    publicLimits();
    const reads = lines.filter((l) => l.msg === 'allowance_limits_read');
    assert.equal(reads.length, 2);
    assert.deepEqual(reads[0], {
      msg: 'allowance_limits_read',
      outcome: 'ok',
      full_per_day: Number(FULL_PER_DAY_ENV),
      source: 'env',
    });
    assert.ok(lines.every((l) => !('family_id_hash' in l)));
  });
});

describe('the Full allowance env value (#120)', () => {
  // ⚠️ Each case imports a FRESH module: the `allowance_config_loaded` latch is module state, so
  // with the shared top-level import a "loaded once" assertion would depend on the raw value the
  // previous case left behind (the handler.test.mjs pattern). The error line is NOT latched.
  const fresh = () => import(`../allowance.mjs?t=${Date.now()}-${Math.random()}`);
  const original = { log: console.log, error: console.error };
  let lines;
  let errors;

  beforeEach(() => {
    delete process.env.AI_FULL_ALLOWANCE_PER_DAY;
    lines = [];
    errors = [];
    console.log = (...a) => lines.push(JSON.parse(a.map(String).join(' ')));
    console.error = (...a) => errors.push(a);
  });

  afterEach(() => {
    console.log = original.log;
    console.error = original.error;
    delete process.env.AI_FULL_ALLOWANCE_PER_DAY;
  });

  const loaded = () => lines.filter((l) => l.msg === 'allowance_config_loaded');

  it('honours a positive whole number, with no error and one loaded line', async () => {
    process.env.AI_FULL_ALLOWANCE_PER_DAY = '7';
    const mod = await fresh();
    assert.equal(mod.planAllowance().full.perDay, 7);
    assert.equal(mod.publicLimits().source, 'env');
    assert.equal(errors.length, 0);
    assert.deepEqual(loaded(), [
      { msg: 'allowance_config_loaded', full_per_day: 7, source: 'env' },
    ]);
  });

  for (const [label, raw] of [
    ['abc', 'abc'],
    ['0', '0'],
    ['-3', '-3'],
    ['2.5', '2.5'],
    ['1e1 (exponent)', '1e1'],
    ['0x19 (hex)', '0x19'],
    ['25.0 (trailing decimal)', '25.0'],
    ['" 25 " (padded)', ' 25 '],
    ['empty', ''],
    ['unset', undefined],
  ]) {
    it(`${label}: falls back to ${FULL_PER_DAY_FALLBACK} with an alarmed error line per read, never throws`, async () => {
      if (raw !== undefined) process.env.AI_FULL_ALLOWANCE_PER_DAY = raw;
      const mod = await fresh();
      assert.equal(mod.FULL_PER_DAY_FALLBACK, FULL_PER_DAY_FALLBACK);
      assert.equal(mod.planAllowance().full.perDay, FULL_PER_DAY_FALLBACK);
      const body = mod.publicLimits();
      assert.equal(body.full.limit, FULL_PER_DAY_FALLBACK);
      assert.equal(body.source, 'fallback');

      assert.equal(errors.length, 2, 'one error line per fallback read (two reads above)');
      const [message, context] = errors[0];
      assert.deepEqual(errors[1], errors[0]);
      assert.ok(message.startsWith(ALLOWANCE_CONFIG_ERROR_PREFIX));
      assert.equal(mod.ALLOWANCE_CONFIG_ERROR_PREFIX, ALLOWANCE_CONFIG_ERROR_PREFIX);
      assert.match(message, /TF_VAR_ai_full_allowance_per_day/);
      assert.match(message, /\.beanies-tf\.env\.example/);
      assert.match(message, /Changing the magic beans allowance/);
      assert.deepEqual(context, {
        raw: raw === undefined ? null : raw,
        reason: raw === undefined || raw === '' ? 'unset' : 'not_a_positive_whole_number',
      });
      assert.deepEqual(loaded(), [
        { msg: 'allowance_config_loaded', full_per_day: FULL_PER_DAY_FALLBACK, source: 'fallback' },
      ]);
    });
  }

  it('within one module: the error fires on every fallback read, the loaded line once per distinct value', async () => {
    const mod = await fresh();
    process.env.AI_FULL_ALLOWANCE_PER_DAY = 'abc';
    mod.planAllowance();
    mod.planAllowance();
    assert.equal(errors.length, 2, 'the error is not latched: the alarm must stay in ALARM');

    process.env.AI_FULL_ALLOWANCE_PER_DAY = 'xyz';
    mod.planAllowance();
    assert.equal(errors.length, 3);

    process.env.AI_FULL_ALLOWANCE_PER_DAY = '25';
    assert.equal(mod.planAllowance().full.perDay, 25);
    mod.planAllowance();
    assert.equal(errors.length, 3, 'a good value logs no error');
    assert.deepEqual(
      loaded().map((l) => [l.full_per_day, l.source]),
      [
        [FULL_PER_DAY_FALLBACK, 'fallback'],
        [FULL_PER_DAY_FALLBACK, 'fallback'],
        [25, 'env'],
      ],
      'one loaded line per distinct raw value: abc, xyz, 25'
    );
  });
});

describe('chargesABean: only a read that spends a bean is checked', () => {
  // Imported late so this block reads as the meter-side half of the contract.
  it('a spent correction grant and an in-bound sealed free task are exempt; everything else is not', async () => {
    const { chargesABean, FREE_TASK_MAX_BYTES } = await import('../meter.mjs');
    const bound = FREE_TASK_MAX_BYTES.get('dedupe');
    assert.equal(chargesABean({ free: true }, 'share'), false);
    assert.equal(chargesABean({ free: false, arm: 'sealed', srcBytes: 100 }, 'dedupe'), false);
    assert.equal(chargesABean({ free: false, arm: 'sealed', srcBytes: 100 }, 'share'), true);
    assert.equal(chargesABean({ free: false, arm: 'sealed', srcBytes: bound + 1 }, 'dedupe'), true);
    assert.equal(chargesABean({ free: false, arm: 'legacy', srcBytes: 100 }, 'dedupe'), true);
  });

  it('asking does not log the free-task warning (closeRead logs it once, when it counts)', async () => {
    const { chargesABean } = await import('../meter.mjs');
    const warned = [];
    const original = console.warn;
    console.warn = (...a) => warned.push(a.join(' '));
    try {
      chargesABean({ free: false, arm: 'legacy', srcBytes: 100 }, 'dedupe');
    } finally {
      console.warn = original;
    }
    assert.equal(warned.length, 0);
  });
});
