/* global process */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, beforeEach, describe, it } from 'node:test';

import { USAGE_ATTRS, hash, usageKey } from '../ddb.mjs';
import { COUNT_FAILED_PREFIX, COUNT_SKIPPED_PREFIX, countUsage, dayIso } from '../countUsage.mjs';

const FAMILY = 'fam-0001-aaaa';
const NOW = Date.UTC(2026, 8, 14, 10, 30); // 2026-09-14T10:30Z

/** Capture one command without an SDK: same stub shape `checkLimits` accepts. */
function stub({ throws } = {}) {
  const sent = [];
  return {
    sent,
    ddb: {
      send: async (cmd) => {
        sent.push(cmd);
        if (throws) throw throws;
        return {};
      },
      commands: {
        UpdateItemCommand: class {
          constructor(input) {
            this.input = input;
          }
        },
      },
    },
  };
}

function captureConsole(method) {
  const original = console[method];
  const lines = [];
  console[method] = (...args) => lines.push(args.map(String).join(' '));
  return {
    lines,
    restore: () => {
      console[method] = original;
    },
  };
}

describe('countUsage', () => {
  beforeEach(() => {
    delete process.env.USAGE_TABLE;
  });
  after(() => {
    delete process.env.USAGE_TABLE;
  });

  describe('the unset table is a supported silent no-op', () => {
    it('writes nothing, logs nothing and returns false', async () => {
      const { sent, ddb } = stub();
      const err = captureConsole('error');
      const warn = captureConsole('warn');

      const counted = await countUsage({ familyId: FAMILY, now: NOW, ddb });

      err.restore();
      warn.restore();
      assert.equal(counted, false);
      assert.equal(sent.length, 0, 'no DynamoDB call without USAGE_TABLE');
      assert.deepEqual([...err.lines, ...warn.lines], [], 'unset is configuration, not a fault');
    });
  });

  describe('a counted read', () => {
    it('increments `n` once on the family-day row and returns true', async () => {
      process.env.USAGE_TABLE = 'usage-table';
      const { sent, ddb } = stub();

      const counted = await countUsage({ familyId: FAMILY, now: NOW, ddb });

      assert.equal(counted, true);
      assert.equal(sent.length, 1);
      const { input } = sent[0];
      assert.equal(input.TableName, 'usage-table');
      assert.equal(input.UpdateExpression, 'ADD #n :one SET expires_at = :ttl');
      assert.equal(input.ExpressionAttributeNames['#n'], USAGE_ATTRS.charged);
      assert.equal(input.ExpressionAttributeValues[':one'].N, '1');
      assert.equal(
        input.ConditionExpression,
        undefined,
        'the meter increments unconditionally — a cap is the limiter’s job, not the meter’s'
      );
    });

    it('marshals the key to AttributeValues — a plain string is a ValidationException', async () => {
      process.env.USAGE_TABLE = 'usage-table';
      const { sent, ddb } = stub();

      await countUsage({ familyId: FAMILY, now: NOW, ddb });

      const key = usageKey(FAMILY, '2026-09-14');
      assert.deepEqual(sent[0].input.Key, { pk: { S: key.pk }, sk: { S: key.sk } });
    });

    it('keys on the sha256 of the family id, never the raw id', async () => {
      process.env.USAGE_TABLE = 'usage-table';
      const { sent, ddb } = stub();

      await countUsage({ familyId: FAMILY, now: NOW, ddb });

      const serialised = JSON.stringify(sent[0].input);
      assert.ok(!serialised.includes(FAMILY), 'raw family id must never reach a key');
      assert.ok(serialised.includes(hash(FAMILY)), 'the hash is what is stored');
    });

    it('increments `c` for a free correction, leaving `n` alone', async () => {
      process.env.USAGE_TABLE = 'usage-table';
      const { sent, ddb } = stub();

      await countUsage({ familyId: FAMILY, attr: USAGE_ATTRS.corrected, now: NOW, ddb });

      assert.equal(sent[0].input.ExpressionAttributeNames['#n'], USAGE_ATTRS.corrected);
      assert.notEqual(USAGE_ATTRS.corrected, USAGE_ATTRS.charged);
    });

    it('writes a TTL far beyond an hourly window — this is billing evidence', async () => {
      process.env.USAGE_TABLE = 'usage-table';
      const { sent, ddb } = stub();

      await countUsage({ familyId: FAMILY, now: NOW, ddb });

      const ttl = Number(sent[0].input.ExpressionAttributeValues[':ttl'].N);
      const days = (ttl - NOW / 1000) / 86400;
      assert.ok(days > 365, `expected a year-plus horizon, got ${Math.round(days)} days`);
    });
  });

  describe('a read with no family id', () => {
    it('writes nothing, returns false, and logs the alertable skip prefix', async () => {
      process.env.USAGE_TABLE = 'usage-table';
      const { sent, ddb } = stub();
      const warn = captureConsole('warn');

      const counted = await countUsage({ now: NOW, ddb });

      warn.restore();
      assert.equal(counted, false);
      assert.equal(sent.length, 0);
      assert.equal(warn.lines.length, 1);
      assert.ok(
        warn.lines[0].startsWith(COUNT_SKIPPED_PREFIX),
        'the prefix is what the metric filter matches'
      );
    });
  });

  describe('a failed write', () => {
    it('never throws, returns false, and logs the prefix WITH remediation', async () => {
      process.env.USAGE_TABLE = 'usage-table';
      const { ddb } = stub({ throws: new Error('ProvisionedThroughputExceeded') });
      const err = captureConsole('error');

      const counted = await countUsage({ familyId: FAMILY, now: NOW, ddb });

      err.restore();
      assert.equal(
        counted,
        false,
        'the grant writer keys off this — an uncounted read grants none'
      );
      assert.equal(err.lines.length, 1);
      assert.ok(err.lines[0].startsWith(COUNT_FAILED_PREFIX));
      assert.ok(
        err.lines[0].includes('dynamodb:UpdateItem'),
        'an alarm without remediation is a page nobody can action'
      );
    });

    it('does not leak the family id into the failure log', async () => {
      process.env.USAGE_TABLE = 'usage-table';
      const { ddb } = stub({ throws: new Error('boom') });
      const err = captureConsole('error');

      await countUsage({ familyId: FAMILY, now: NOW, ddb });

      err.restore();
      assert.ok(!err.lines.join(' ').includes(FAMILY), 'never logged, never stored');
    });
  });

  describe('dayIso', () => {
    it('is UTC, so a family near midnight does not get two days at once', () => {
      assert.equal(dayIso(Date.UTC(2026, 8, 14, 23, 59)), '2026-09-14');
      assert.equal(dayIso(Date.UTC(2026, 8, 15, 0, 1)), '2026-09-15');
    });
  });

  describe('the hash contract shared with the metrics skill', () => {
    it('matches a pinned vector — a drift here returns a zero-row join, silently', () => {
      assert.equal(
        hash('family-fixture-0000'),
        'f22eef17bc9a171456220e0fc66fa4bd342421b3e746b773a3a9e64ba7c0988f'
      );
    });
  });

  describe('the alarming prefixes are asserted against terraform', () => {
    // Resolved from import.meta.url, NOT process.cwd() — `npm run test:lambda` does not
    // guarantee a working directory.
    const tf = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../../modules/ai-extract/main.tf'),
      'utf8'
    );

    // ONLY the prefixes that have a filter. `ok task=` and `usage counted` are triage lines with
    // no alarm, and an "every prefix the Lambda logs" assertion would fail on those and then be
    // weakened to nothing.
    for (const [name, prefix] of Object.entries({
      COUNT_FAILED_PREFIX,
      COUNT_SKIPPED_PREFIX,
    })) {
      it(`${name} appears verbatim in a metric filter pattern`, () => {
        assert.ok(
          tf.includes(prefix),
          `${prefix} has no matching pattern in modules/ai-extract/main.tf — the alarm would ` +
            'silently stop firing, which looks identical to having nothing to report'
        );
      });
    }
  });
});
