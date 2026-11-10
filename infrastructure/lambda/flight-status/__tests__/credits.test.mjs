import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  CREDITS_REFILLED_PREFIX,
  CREDIT_EXHAUSTED_PREFIX,
  CREDIT_REFILL_FAILED_PREFIX,
  createCredits,
} from '../credits.mjs';
import { STORE_UNAVAILABLE_PREFIX } from '../alertsStore.mjs';
import {
  FakeProviderError,
  captureConsole,
  fakeAlertsClient,
  fakeDdb,
  linesFor,
} from './helpers.mjs';

const NOW = Date.parse('2026-12-10T12:00:00Z');
const ENV = { ALERTS_TABLE: 'alerts-test' };
const logs = captureConsole();

function make({ env = {}, provider = fakeAlertsClient() } = {}) {
  const ddb = fakeDdb();
  const ensureCredits = createCredits({ provider, env: { ...ENV, ...env }, ddb, now: () => NOW });
  return { ddb, provider, ensureCredits };
}

describe('ensureCredits', () => {
  test('at or above the floor: nothing happens', async () => {
    const { ddb, provider, ensureCredits } = make();
    assert.deepEqual(await ensureCredits(100, 'webhook'), {
      creditsRemaining: 100,
      refilled: false,
    });
    assert.deepEqual(provider.calls, []);
    assert.deepEqual(ddb.calls, []);
  });

  test('under the floor: one token, one refill of 200, an info line with before/added/units', async () => {
    const { provider, ensureCredits } = make();
    provider.state.balance = 99;
    const out = await ensureCredits(99, 'webhook');
    assert.deepEqual(out, { creditsRemaining: 299, refilled: true });
    assert.deepEqual(provider.calls, [['refillCredits', 200]]);
    const [line] = linesFor(logs(), CREDITS_REFILLED_PREFIX);
    assert.deepEqual(
      {
        before: line.before,
        added: line.added,
        units_remaining: line.units_remaining,
        source: line.source,
      },
      { before: 99, added: 200, units_remaining: 4000, source: 'webhook' }
    );
  });

  test('null (no balance row yet) counts as zero: the first sweep seeds it', async () => {
    const { provider, ensureCredits } = make();
    provider.state.balance = null;
    const out = await ensureCredits(null, 'cleanup');
    assert.equal(out.refilled, true);
    assert.equal(linesFor(logs(), CREDITS_REFILLED_PREFIX)[0].before, null);
  });

  test('the daily cap: two refills, then the alarmed exhausted line and no provider call', async () => {
    const { provider, ensureCredits } = make({
      env: { ALERT_REFILL_DAILY_CAP: '2', ALERT_CREDIT_REFILL: '50' },
    });
    await ensureCredits(0, 'webhook');
    await ensureCredits(0, 'webhook');
    const third = await ensureCredits(0, 'webhook');
    assert.deepEqual(third, { creditsRemaining: 0, refilled: false });
    assert.equal(provider.calls.filter((c) => c[0] === 'refillCredits').length, 2);
    assert.deepEqual(provider.calls[0], ['refillCredits', 50]);
    assert.ok(logs().error.some((l) => l.startsWith(CREDIT_EXHAUSTED_PREFIX)));
  });

  test('a refill-counter store fault refills NOTHING (fail closed) and is alarmed by the store', async () => {
    const { ddb, provider, ensureCredits } = make();
    ddb.failOn(() => true);
    assert.deepEqual(await ensureCredits(0, 'webhook'), { creditsRemaining: 0, refilled: false });
    assert.deepEqual(provider.calls, []);
    assert.ok(logs().error[0].startsWith(STORE_UNAVAILABLE_PREFIX));
  });

  test('a provider refill failure is alarmed and never throws', async () => {
    const provider = fakeAlertsClient({
      refillCredits: () => {
        throw new FakeProviderError('upstream_auth', 401);
      },
    });
    const { ensureCredits } = make({ provider });
    assert.deepEqual(await ensureCredits(5, 'cleanup'), { creditsRemaining: 5, refilled: false });
    assert.match(
      logs().error[0],
      new RegExp(
        `^\\${CREDIT_REFILL_FAILED_PREFIX.slice(0)} source=cleanup code=upstream_auth http_status=401`
      )
    );
  });

  test('a custom floor', async () => {
    const { provider, ensureCredits } = make({ env: { ALERT_CREDIT_FLOOR: '500' } });
    await ensureCredits(499, 'webhook');
    assert.equal(provider.calls.length, 1);
  });
});
