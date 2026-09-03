/* global process */
/**
 * The abuse limits that replaced the text arm's provenance guarantee (#83, ADR-035).
 *
 * `node --test` with an INJECTED client — there is no `aws-sdk-client-mock` in this repo, and
 * `checkLimits` takes `ddb` precisely so a stub can stand in for one.
 *
 * The two cases that matter most, because getting either wrong is silent:
 *   - a throwing store FAILS OPEN and says so, rather than taking down every extraction;
 *   - the family id never appears in a response or a log line.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { checkLimits, FAMILY_LIMIT, IP_LIMIT } from '../rateLimit.mjs';

const NOW = Date.UTC(2026, 8, 3, 10, 30, 0); // 10:30 → 1800s into the 10:00 bucket

/** A stub that records every UpdateItem and refuses the keys named in `atLimit`. */
function stubClient({ atLimit = [], throws = null } = {}) {
  const calls = [];
  return {
    calls,
    commands: {
      // The real command is a class whose input we need to read back; a plain wrapper is
      // enough, since `send` here never talks to AWS.
      UpdateItemCommand: class {
        constructor(input) {
          this.input = input;
        }
      },
    },
    send(cmd) {
      if (throws) return Promise.reject(throws);
      calls.push(cmd.input);
      const pk = cmd.input.Key.pk.S;
      if (atLimit.some((prefix) => pk.startsWith(prefix))) {
        const err = new Error('The conditional request failed');
        err.name = 'ConditionalCheckFailedException';
        return Promise.reject(err);
      }
      return Promise.resolve({});
    },
  };
}

describe('checkLimits', () => {
  let originalTable;
  let logs;
  let originalWarn;
  let originalError;

  beforeEach(() => {
    originalTable = process.env.RATE_TABLE;
    process.env.RATE_TABLE = 'beanies-ai-rate-test';
    logs = [];
    originalWarn = console.warn;
    originalError = console.error;
    console.warn = (...args) => logs.push(args.map(String).join(' '));
    console.error = (...args) => logs.push(args.map(String).join(' '));
  });

  afterEach(() => {
    if (originalTable === undefined) delete process.env.RATE_TABLE;
    else process.env.RATE_TABLE = originalTable;
    console.warn = originalWarn;
    console.error = originalError;
  });

  describe('the no-op paths', () => {
    test('an unset RATE_TABLE is an immediate, silent no-op', async () => {
      // Without this the existing 386-line handler suite (every case a POST) would attempt a
      // real DynamoDB call per test, and a non-prod deploy would depend on credentials it
      // does not need. Silent on purpose: an unset table is a valid configuration.
      delete process.env.RATE_TABLE;
      const ddb = stubClient();
      const verdict = await checkLimits({ familyId: 'fam-1', ip: '1.2.3.4', now: NOW, ddb });

      assert.deepEqual(verdict, { allowed: true });
      assert.equal(ddb.calls.length, 0);
      assert.deepEqual(logs, []);
    });

    test('both identifiers missing is allowed and writes nothing', async () => {
      // `handler.test.mjs`'s makeEvent() builds requestContext with no sourceIp, so this is
      // the shape the existing suite actually sends.
      const ddb = stubClient();
      const verdict = await checkLimits({ now: NOW, ddb });

      assert.deepEqual(verdict, { allowed: true });
      assert.equal(ddb.calls.length, 0);
    });
  });

  describe('under the limits', () => {
    test('allows, and counts BOTH the family and the IP', async () => {
      const ddb = stubClient();
      const verdict = await checkLimits({ familyId: 'fam-1', ip: '1.2.3.4', now: NOW, ddb });

      assert.deepEqual(verdict, { allowed: true });
      assert.equal(ddb.calls.length, 2);
      assert.match(ddb.calls[0].Key.pk.S, /^f#[0-9a-f]{64}#\d+$/);
      assert.match(ddb.calls[1].Key.pk.S, /^i#[0-9a-f]{64}#\d+$/);
    });

    test('applies each limit to its own key', async () => {
      const ddb = stubClient();
      await checkLimits({ familyId: 'fam-1', ip: '1.2.3.4', now: NOW, ddb });

      assert.equal(ddb.calls[0].ExpressionAttributeValues[':max'].N, String(FAMILY_LIMIT));
      assert.equal(ddb.calls[1].ExpressionAttributeValues[':max'].N, String(IP_LIMIT));
      // The IP limit must be the LOOSER of the two: shared NAT legitimately puts several
      // real families behind one address.
      assert.ok(IP_LIMIT > FAMILY_LIMIT);
    });

    test('increments atomically, with the limit as a condition', async () => {
      // The whole limit is this one expression: DynamoDB applies condition and increment
      // together, so two concurrent invocations cannot both see "79" and both proceed.
      const ddb = stubClient();
      await checkLimits({ familyId: 'fam-1', now: NOW, ddb });

      assert.equal(ddb.calls[0].UpdateExpression, 'ADD #n :one SET expires_at = :ttl');
      assert.equal(ddb.calls[0].ConditionExpression, 'attribute_not_exists(#n) OR #n < :max');
      // Aliased rather than a bare `n`: a reserved-word ValidationException would fail every
      // request, and the outer catch cannot tell that from a transient store error — so it
      // would fail open forever.
      assert.deepEqual(ddb.calls[0].ExpressionAttributeNames, { '#n': 'n' });
    });

    test('sets a TTL in the future, so windows reap themselves', async () => {
      const ddb = stubClient();
      await checkLimits({ familyId: 'fam-1', now: NOW, ddb });

      const ttl = Number(ddb.calls[0].ExpressionAttributeValues[':ttl'].N);
      assert.ok(ttl > NOW / 1000, 'TTL must be in the future');
      // The bucket ends at 11:00; the TTL allows one further window of slack.
      assert.ok(ttl <= NOW / 1000 + 2 * 3600 + 1);
    });

    test('a missing familyId falls back to the IP limit rather than failing', async () => {
      // The wire contract is additive in BOTH directions: an old cached bundle sends no
      // familyId and must still be served, throttled by IP alone.
      const ddb = stubClient();
      const verdict = await checkLimits({ ip: '1.2.3.4', now: NOW, ddb });

      assert.deepEqual(verdict, { allowed: true });
      assert.equal(ddb.calls.length, 1);
      assert.ok(ddb.calls[0].Key.pk.S.startsWith('i#'));
    });
  });

  describe('the window', () => {
    test('puts the same identifier in the same bucket within the hour', async () => {
      const ddb = stubClient();
      await checkLimits({ familyId: 'fam-1', now: NOW, ddb });
      await checkLimits({ familyId: 'fam-1', now: NOW + 29 * 60_000, ddb });

      assert.equal(ddb.calls[0].Key.pk.S, ddb.calls[1].Key.pk.S);
    });

    test('rolls to a new bucket at the hour boundary', async () => {
      const ddb = stubClient();
      await checkLimits({ familyId: 'fam-1', now: NOW, ddb });
      await checkLimits({ familyId: 'fam-1', now: NOW + 31 * 60_000, ddb });

      assert.notEqual(ddb.calls[0].Key.pk.S, ddb.calls[1].Key.pk.S);
    });
  });

  describe('at the limit', () => {
    test('refuses, naming which limit tripped and when it lifts', async () => {
      const ddb = stubClient({ atLimit: ['f#'] });
      const verdict = await checkLimits({ familyId: 'fam-1', ip: '1.2.3.4', now: NOW, ddb });

      assert.equal(verdict.allowed, false);
      assert.equal(verdict.limit, 'family');
      // 10:30 → the bucket ends at 11:00, i.e. 1800 seconds away.
      assert.equal(verdict.retryAfterSeconds, 1800);
    });

    test('does not count the IP once the family limit has already refused', async () => {
      const ddb = stubClient({ atLimit: ['f#'] });
      await checkLimits({ familyId: 'fam-1', ip: '1.2.3.4', now: NOW, ddb });

      // The family write was attempted and refused; the IP one was never reached. Charging
      // the IP for a request the family limit already rejected would make one heavy family
      // look like an IP-level attack, and would burn a shared NAT's budget on it.
      assert.equal(ddb.calls.length, 1);
      assert.ok(ddb.calls[0].Key.pk.S.startsWith('f#'));
      assert.ok(!ddb.calls.some((c) => c.Key.pk.S.startsWith('i#')));
    });

    test('the two limits trip INDEPENDENTLY', async () => {
      const ddb = stubClient({ atLimit: ['i#'] });
      const verdict = await checkLimits({ familyId: 'fam-1', ip: '1.2.3.4', now: NOW, ddb });

      assert.equal(verdict.allowed, false);
      assert.equal(verdict.limit, 'ip');
    });

    test('always returns a retryAfterSeconds of at least one second', async () => {
      // Exactly on a bucket boundary the naive calculation would be 3600, and one millisecond before
      // the next it would round to 0 — a Retry-After of 0 invites an immediate retry.
      const onBoundary = Date.UTC(2026, 8, 3, 11, 0, 0);
      const ddb = stubClient({ atLimit: ['f#'] });
      const verdict = await checkLimits({ familyId: 'fam-1', now: onBoundary - 1, ddb });

      assert.ok(verdict.retryAfterSeconds >= 1);
    });
  });

  describe('failure posture', () => {
    test('a throwing store FAILS OPEN and marks the verdict degraded', async () => {
      // Silently allowing would be a silent failure; silently refusing would take down every
      // extraction including the image path this feature does not touch. So: allow, loudly.
      const ddb = stubClient({ throws: new Error('ProvisionedThroughputExceeded') });
      const verdict = await checkLimits({ familyId: 'fam-1', ip: '1.2.3.4', now: NOW, ddb });

      assert.deepEqual(verdict, { allowed: true, degraded: true });
    });

    test('never throws, whatever the store does', async () => {
      const ddb = stubClient({ throws: new TypeError('not a function') });
      await assert.doesNotReject(() => checkLimits({ familyId: 'f', ip: '1.1.1.1', ddb }));
    });

    test('logs the exact prefix the CloudWatch metric filter matches', async () => {
      // ⚠️ If this string changes, `modules/ai-extract/main.tf`'s metric-filter pattern must
      // change in the same commit — otherwise the fail-open alarm silently stops firing.
      const ddb = stubClient({ throws: new Error('boom') });
      await checkLimits({ familyId: 'fam-1', now: NOW, ddb });

      assert.ok(
        logs.some((l) => l.includes('[ai-extract] rate-limit store unavailable')),
        `expected the fail-open line, got: ${JSON.stringify(logs)}`
      );
    });
  });

  describe('privacy', () => {
    test('the family id never appears in a response or a log line', async () => {
      const familyId = 'a-very-distinctive-family-id-9f2c';
      const ddb = stubClient({ atLimit: ['f#'] });
      const verdict = await checkLimits({ familyId, ip: '203.0.113.7', now: NOW, ddb });

      assert.ok(!JSON.stringify(verdict).includes(familyId));
      assert.ok(!logs.join('\n').includes(familyId));
    });

    test('the raw IP never appears in a stored key, a response or a log line', async () => {
      const ip = '203.0.113.7';
      const ddb = stubClient({ atLimit: ['i#'] });
      const verdict = await checkLimits({ familyId: 'fam-1', ip, now: NOW, ddb });

      assert.ok(!JSON.stringify(verdict).includes(ip));
      assert.ok(!logs.join('\n').includes(ip));
      assert.ok(!JSON.stringify(ddb.calls).includes(ip));
    });

    test('the refusal names WHICH limit tripped but no identifier', async () => {
      // A NAT false-positive must show as an IP-limit spike without deanonymising anyone.
      const ddb = stubClient({ atLimit: ['i#'] });
      await checkLimits({ familyId: 'fam-1', ip: '203.0.113.7', now: NOW, ddb });

      assert.ok(logs.some((l) => l.includes('rate_limited limit=ip')));
    });

    test('hashes the identifiers, so a raw id is never a partition key', async () => {
      const ddb = stubClient();
      await checkLimits({ familyId: 'fam-1', ip: '1.2.3.4', now: NOW, ddb });

      for (const call of ddb.calls) {
        assert.ok(!call.Key.pk.S.includes('fam-1'));
        assert.ok(!call.Key.pk.S.includes('1.2.3.4'));
      }
    });

    test('IPv6 addresses in one /64 share a bucket, so a prefix cannot be farmed', async () => {
      // ⚠️ The IP limit's whole job is catching an attacker who rotates family ids. A
      // residential subscriber gets a /56 or /64 and a cloud VM a /64, so keying the full
      // /128 would hand out a fresh 120/hour bucket per source address — and combined with
      // omitting familyId, BOTH limits become no-ops.
      const ddb = stubClient();
      await checkLimits({ ip: '2001:db8:1234:5678:aaaa:bbbb:cccc:dddd', now: NOW, ddb });
      await checkLimits({ ip: '2001:db8:1234:5678:1111:2222:3333:4444', now: NOW, ddb });

      assert.equal(ddb.calls[0].Key.pk.S, ddb.calls[1].Key.pk.S);
    });

    test('a DIFFERENT IPv6 /64 gets its own bucket', async () => {
      const ddb = stubClient();
      await checkLimits({ ip: '2001:db8:1234:5678::1', now: NOW, ddb });
      await checkLimits({ ip: '2001:db8:1234:9999::1', now: NOW, ddb });

      assert.notEqual(ddb.calls[0].Key.pk.S, ddb.calls[1].Key.pk.S);
    });

    test('IPv4 is keyed WHOLE — the prefix collapse must not widen it', async () => {
      // Collapsing IPv4 would put a whole ISP behind one bucket and refuse real families.
      const ddb = stubClient();
      await checkLimits({ ip: '203.0.113.7', now: NOW, ddb });
      await checkLimits({ ip: '203.0.113.8', now: NOW, ddb });

      assert.notEqual(ddb.calls[0].Key.pk.S, ddb.calls[1].Key.pk.S);
    });

    test('an IPv4-mapped IPv6 address is treated as IPv4', async () => {
      const ddb = stubClient();
      await checkLimits({ ip: '::ffff:203.0.113.7', now: NOW, ddb });
      await checkLimits({ ip: '::ffff:203.0.113.8', now: NOW, ddb });

      assert.notEqual(ddb.calls[0].Key.pk.S, ddb.calls[1].Key.pk.S);
    });

    test('different identifiers land on different keys', async () => {
      const ddb = stubClient();
      await checkLimits({ familyId: 'fam-1', now: NOW, ddb });
      await checkLimits({ familyId: 'fam-2', now: NOW, ddb });

      assert.notEqual(ddb.calls[0].Key.pk.S, ddb.calls[1].Key.pk.S);
    });
  });
});
