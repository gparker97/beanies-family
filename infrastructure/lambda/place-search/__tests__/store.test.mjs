import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { takeToken, UNAVAILABLE_RETRY_SECONDS } from '../store.mjs';
import { hash } from '../ddb.mjs';
import { NOW, captureConsole, fakeDdb } from './helpers.mjs';

const logs = captureConsole();
const TABLE = 't';

describe('takeToken key grammar', () => {
  test('ip: i#<sha256(ip)>#<hour bucket>, TTL one spare window', async () => {
    const ddb = fakeDdb();
    await takeToken({ kind: 'ip', ip: '203.0.113.7', now: NOW, ddb, limit: 5, table: TABLE });
    const bucket = Math.floor(NOW / 1000 / 3600);
    const { input } = ddb.calls[0];
    assert.equal(input.Key.pk.S, `i#${hash('203.0.113.7')}#${bucket}`);
    assert.equal(input.ExpressionAttributeValues[':ttl'].N, String((bucket + 2) * 3600));
    assert.equal(input.TableName, TABLE);
  });

  test('suggest: gs#<day>; resolve: gr#<day>; TTL two days after the day starts', async () => {
    const ddb = fakeDdb();
    await takeToken({ kind: 'suggest', now: NOW, ddb, limit: 5, table: TABLE });
    await takeToken({ kind: 'resolve', now: NOW, ddb, limit: 5, table: TABLE });
    assert.deepEqual(ddb.keys(), ['gs#2026-12-01', 'gr#2026-12-01']);
    const dayStart = Date.parse('2026-12-01T00:00:00Z') / 1000;
    assert.equal(
      ddb.calls[0].input.ExpressionAttributeValues[':ttl'].N,
      String(dayStart + 2 * 86400)
    );
  });

  test('an unknown kind is a programming error and throws', async () => {
    await assert.rejects(
      takeToken({ kind: 'day', now: NOW, ddb: fakeDdb(), table: TABLE }),
      TypeError
    );
  });

  test('ip with no table or no address is allowed without a store call or a log', async () => {
    const ddb = fakeDdb();
    assert.deepEqual(await takeToken({ kind: 'ip', ip: '1.2.3.4', now: NOW, ddb, table: '' }), {
      allowed: true,
    });
    assert.deepEqual(await takeToken({ kind: 'ip', now: NOW, ddb, table: TABLE }), {
      allowed: true,
    });
    assert.equal(ddb.calls.length, 0);
    assert.equal(logs().error.length, 0);
  });

  test('day kinds with no table refuse without a store call', async () => {
    const ddb = fakeDdb();
    for (const kind of ['suggest', 'resolve']) {
      assert.deepEqual(await takeToken({ kind, now: NOW, ddb, table: '' }), {
        allowed: false,
        reason: 'unavailable',
        retryAfterSeconds: UNAVAILABLE_RETRY_SECONDS,
      });
    }
    assert.equal(ddb.calls.length, 0);
    assert.equal(logs().error.length, 2);
  });
});
