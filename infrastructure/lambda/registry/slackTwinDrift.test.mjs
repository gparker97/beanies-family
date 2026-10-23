/**
 * Pins `./slack.mjs` to its verbatim twin `../billing/slack.mjs` (every Lambda is its own zip, so
 * the shared helpers are copied, not imported; owner.mjs `realEmail` is the precedent). A change
 * to one copy that is not made to the other fails here.
 */
import { describe, expect, it } from 'vitest';
import * as billing from '../billing/slack.mjs';
import * as registry from './slack.mjs';

const ESCAPES = ['plain', 'a & b', '<script>', 'x > y < z', '', 42, null, 'The Parkers'];

const IDENTITIES = [
  { familyId: '11111111-2222-4333-8444-555555555555', familyName: 'The Parkers' },
  { familyId: '11111111-2222-4333-8444-555555555555', ownerEmail: 'greg@example.com' },
  { familyId: '11111111-2222-4333-8444-555555555555', familyName: '<b>&co</b>' },
  { ownerEmail: 'no-at-sign' },
  { familyId: '' },
  {},
  undefined,
];

/** A fetch double that records the call and answers with the given status, or throws. */
function fetchDouble(outcome) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    if (outcome instanceof Error) throw outcome;
    return { ok: outcome < 300, status: outcome };
  };
  return { impl, calls };
}

describe('registry slack.mjs is a verbatim twin of billing slack.mjs', () => {
  it('shares the timeout and the plan labels', () => {
    expect(registry.SLACK_TIMEOUT_MS).toBe(billing.SLACK_TIMEOUT_MS);
    expect(registry.PLAN_LABELS).toEqual(billing.PLAN_LABELS);
  });

  it('slackEscape agrees on every input', () => {
    for (const v of ESCAPES) expect(registry.slackEscape(v)).toBe(billing.slackEscape(v));
  });

  it('familyIdentity agrees on every input', () => {
    for (const v of IDENTITIES) expect(registry.familyIdentity(v)).toBe(billing.familyIdentity(v));
  });

  it('postToSlack sends the same request and returns the same result', async () => {
    const outcomes = [
      200,
      500,
      Object.assign(new Error('t'), { name: 'TimeoutError' }),
      Object.assign(new Error('a'), { name: 'AbortError' }),
      new Error('socket hang up'),
    ];
    for (const outcome of outcomes) {
      const a = fetchDouble(outcome);
      const b = fetchDouble(outcome);
      const ra = await registry.postToSlack('https://hooks.example/x', 'hello', {
        fetchImpl: a.impl,
      });
      const rb = await billing.postToSlack('https://hooks.example/x', 'hello', {
        fetchImpl: b.impl,
      });
      expect(ra).toEqual(rb);
      expect(a.calls).toEqual(b.calls);
    }
    expect(await registry.postToSlack('', 'x')).toEqual(await billing.postToSlack('', 'x'));
  });

  it('the shared functions have identical source', () => {
    for (const name of ['slackEscape', 'familyIdentity', 'postToSlack']) {
      expect(registry[name].toString()).toBe(billing[name].toString());
    }
  });
});
