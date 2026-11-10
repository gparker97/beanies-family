/* global process */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Env BEFORE any import of the Lambda's modules (the content-fetch convention). The factory below
// takes its env as an argument, so these only matter to the index.mjs wiring test at the bottom.
process.env.FLIGHT_STATUS_API_KEY = 'test-key';
process.env.AERODATABOX_API_KEY = 'provider-key';
process.env.CORS_ORIGINS = 'https://app.beanies.family,capacitor://app.beanies.family';
delete process.env.CACHE_TABLE;

const {
  createHandler,
  ERROR_CODES,
  ALARMING_PREFIXES,
  STATUS_FOR_CODE,
  BAD_MODE_PREFIX,
  PROVIDER_UNITS_LOW_PREFIX,
  normaliseFlight,
} = await import('../createHandler.mjs');
const { __setDdbClientForTests } = await import('../ddb.mjs');
const { TTL_EMPTY_SECONDS, TTL_FAR_SECONDS, TTL_NEAR_SECONDS, ttlSecondsFor, ipKey } =
  await import('../store.mjs');

const HERE = dirname(fileURLToPath(import.meta.url));

// ── Fakes ────────────────────────────────────────────────────────────────────────────────────

class Cmd {
  constructor(input) {
    this.input = input;
  }
}
class GetItemCommand extends Cmd {}
class PutItemCommand extends Cmd {}
class UpdateItemCommand extends Cmd {}

/** In-memory DynamoDB speaking the three raw-AttributeValue commands this Lambda sends. */
function fakeDdb() {
  const items = new Map();
  const calls = [];
  let failing = null;
  const send = async (cmd) => {
    const op = cmd.constructor.name;
    calls.push(op);
    if (failing?.(op)) throw Object.assign(new Error('store down'), { name: 'ServiceUnavailable' });
    if (op === 'GetItemCommand') {
      const it = items.get(cmd.input.Key.pk.S);
      return it ? { Item: structuredClone(it) } : {};
    }
    if (op === 'PutItemCommand') {
      items.set(cmd.input.Item.pk.S, structuredClone(cmd.input.Item));
      return {};
    }
    if (op === 'UpdateItemCommand') {
      const pk = cmd.input.Key.pk.S;
      const cur = items.get(pk) ?? { pk: { S: pk } };
      const n = Number(cur.n?.N ?? 0);
      const max = cmd.input.ExpressionAttributeValues[':max'];
      if (max && cur.n && !(n < Number(max.N))) {
        throw Object.assign(new Error('at limit'), { name: 'ConditionalCheckFailedException' });
      }
      items.set(pk, {
        ...cur,
        n: { N: String(n + 1) },
        expires_at: cmd.input.ExpressionAttributeValues[':ttl'],
      });
      return {};
    }
    throw new Error(`unexpected command ${op}`);
  };
  return {
    send,
    commands: { GetItemCommand, PutItemCommand, UpdateItemCommand },
    items,
    calls,
    failOn(fn) {
      failing = fn;
    },
  };
}

/** Same shape as the adapter's ProviderError, without importing the adapter. */
class FakeProviderError extends Error {
  constructor(code, httpStatus) {
    super(code);
    this.name = 'ProviderError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function fakeProvider(impl = () => ({ legs: [leg()], status: 200 })) {
  const calls = [];
  return {
    calls,
    PROVIDER_MODES: Object.freeze(['direct', 'rapidapi', 'apimarket']),
    fetchLegs: async (args) => {
      calls.push(args);
      return impl(args);
    },
  };
}

// 2026-12-01 12:00 UTC, a Tuesday. Every date below is relative to it.
const NOW = Date.parse('2026-12-01T12:00:00Z');
const NOW_S = Math.floor(NOW / 1000);
const FAR_DATE = '2026-12-13';

function leg({ utc = '2026-12-13 09:00Z', number = 'SQ 318' } = {}) {
  return {
    number,
    airline: { name: 'Singapore Airlines', iata: 'SQ', icao: 'SIA' },
    status: 'Expected',
    departure: {
      iata: 'SIN',
      scheduledUtc: utc,
      scheduledLocal: '2026-12-13 17:00+08:00',
      terminal: '2',
    },
    arrival: {
      iata: 'LHR',
      scheduledUtc: '2026-12-14 00:40Z',
      scheduledLocal: '2026-12-14 00:40+00:00',
    },
  };
}

const BASE_ENV = Object.freeze({
  FLIGHT_STATUS_API_KEY: 'test-key',
  AERODATABOX_API_KEY: 'provider-key',
  CORS_ORIGINS: 'https://app.beanies.family,capacitor://app.beanies.family',
  CACHE_TABLE: 'flight-status-test',
});

function make({ env = {}, provider = fakeProvider(), now = NOW } = {}) {
  const handler = createHandler({
    provider,
    env: { ...BASE_ENV, ...env },
    now: () => now,
    fetchImpl: () => {
      throw new Error('the fake provider must never reach fetch');
    },
  });
  return { handler, provider };
}

function ev({
  method = 'POST',
  body = { flight: 'SQ318', date: FAR_DATE },
  key = 'test-key',
  origin = 'https://app.beanies.family',
  ip = '203.0.113.7',
} = {}) {
  const headers = { origin };
  if (key !== null) headers['x-api-key'] = key;
  return {
    routeKey: 'POST /flight-status',
    requestContext: { http: { method, sourceIp: ip } },
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

const json = (res) => (res.body ? JSON.parse(res.body) : null);

/** Every non-2xx answer must carry a code the client knows about. */
function assertCode(res, code) {
  const body = json(res);
  assert.equal(body.code, code);
  assert.ok(ERROR_CODES.includes(code), `${code} is not in ERROR_CODES`);
  assert.equal(res.statusCode, STATUS_FOR_CODE[code].status);
}

/** Capture console output so tests can assert alarmed prefixes, and keep the run quiet. */
let logs;
const originals = {};
beforeEach(() => {
  logs = { log: [], warn: [], error: [] };
  for (const level of Object.keys(logs)) {
    originals[level] = console[level];
    console[level] = (...args) => logs[level].push(args.map(String).join(' '));
  }
});
afterEach(() => {
  for (const level of Object.keys(logs)) console[level] = originals[level];
  __setDdbClientForTests(null);
});

let ddb;
function useDdb() {
  ddb = fakeDdb();
  __setDdbClientForTests(ddb);
  return ddb;
}

const requestLines = () =>
  logs.log.map((l) => JSON.parse(l)).filter((l) => l.msg === 'flight-status');

// ── HTTP shape ───────────────────────────────────────────────────────────────────────────────

describe('HTTP shape', () => {
  test('OPTIONS answers 204 with CORS and an empty body', async () => {
    useDdb();
    const res = await make().handler(ev({ method: 'OPTIONS', key: null }));
    assert.equal(res.statusCode, 204);
    assert.equal(res.body, '');
    assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://app.beanies.family');
    assert.equal(res.headers['Access-Control-Allow-Methods'], 'POST, OPTIONS');
  });

  test('non-POST is 405', async () => {
    useDdb();
    assertCode(await make().handler(ev({ method: 'GET' })), 'method_not_allowed');
  });

  test('missing or wrong x-api-key is 401; an unset key refuses everyone', async () => {
    useDdb();
    const { handler } = make();
    assertCode(await handler(ev({ key: null })), 'unauthorized');
    assertCode(await handler(ev({ key: 'nope' })), 'unauthorized');
    const unset = make({ env: { FLIGHT_STATUS_API_KEY: '' } });
    assertCode(await unset.handler(ev({ key: '' })), 'unauthorized');
    assert.equal(unset.provider.calls.length, 0);
  });

  test('a body over 1 KB is 413, before any store call', async () => {
    useDdb();
    const res = await make().handler(
      ev({ body: JSON.stringify({ flight: 'SQ318', pad: 'x'.repeat(1100) }) })
    );
    assertCode(res, 'too_large');
    assert.deepEqual(ddb.calls, []);
  });

  test('malformed or non-object JSON is 400 bad_request', async () => {
    useDdb();
    const { handler } = make();
    assertCode(await handler(ev({ body: '{"flight":' })), 'bad_request');
    assertCode(await handler(ev({ body: '["SQ318"]' })), 'bad_request');
    assertCode(await handler(ev({ body: 'null' })), 'bad_request');
  });

  test('CORS on every response: allowed origins echoed, others get the first', async () => {
    useDdb();
    const { handler } = make({ env: { IP_LIMIT: '1' } });
    const cases = [
      ev({ method: 'OPTIONS' }),
      ev({ method: 'GET' }),
      ev({ key: 'nope' }),
      ev({ body: 'x'.repeat(2000) }),
      ev({ body: '{' }),
      ev({ body: { flight: '??', date: FAR_DATE } }),
      ev({ body: { flight: 'SQ318', date: 'soon' } }),
      ev({ body: { flight: 'SQ318', date: '2030-01-01' } }),
      ev({ ip: '198.51.100.1' }), // 200
      ev({ ip: '198.51.100.1' }), // 429
    ];
    const statuses = [];
    for (const origin of ['https://app.beanies.family', 'capacitor://app.beanies.family']) {
      for (const e of cases) {
        const res = await handler({ ...e, headers: { ...e.headers, origin } });
        statuses.push(res.statusCode);
        assert.equal(res.headers['Access-Control-Allow-Origin'], origin);
        assert.equal(res.headers['Content-Type'], 'application/json');
      }
    }
    assert.ok(statuses.includes(200) && statuses.includes(429) && statuses.includes(204));
    const foreign = await handler(ev({ origin: 'https://evil.example' }));
    assert.equal(foreign.headers['Access-Control-Allow-Origin'], 'https://app.beanies.family');
  });
});

// ── Validation ───────────────────────────────────────────────────────────────────────────────

describe('validation', () => {
  test('flight numbers normalise (case, spaces, hyphens) or are bad_flight', async () => {
    assert.equal(normaliseFlight('sq 318'), 'SQ318');
    assert.equal(normaliseFlight('SQ-318'), 'SQ318');
    assert.equal(normaliseFlight('u2 8'), 'U28');
    assert.equal(normaliseFlight('3K 1234'), '3K1234');
    for (const bad of ['SQ', 'SQ12345', 'SQA318', 'S', '!!318', '', 318, null, undefined]) {
      assert.equal(normaliseFlight(bad), null, `accepted ${bad}`);
    }
    const ddbFake = useDdb();
    const { handler, provider } = make();
    assertCode(await handler(ev({ body: { flight: 'SQ12345', date: FAR_DATE } })), 'bad_flight');
    assertCode(await handler(ev({ body: { date: FAR_DATE } })), 'bad_flight');
    assert.equal(provider.calls.length, 0);
    assert.deepEqual(ddbFake.calls, []);

    const ok = await handler(ev({ body: { flight: 'sq-318', date: FAR_DATE } }));
    assert.equal(ok.statusCode, 200);
    assert.equal(provider.calls[0].flight, 'SQ318');
  });

  test('malformed or impossible dates are bad_date', async () => {
    useDdb();
    const { handler } = make();
    for (const date of [
      '2026-12-1',
      '13/12/2026',
      '2026-02-30',
      '2026-13-01',
      20261213,
      undefined,
    ]) {
      assertCode(await handler(ev({ body: { flight: 'SQ318', date } })), 'bad_date');
    }
  });

  test('dates outside [today-2d, today+365d] UTC are date_out_of_range; the edges are allowed', async () => {
    useDdb();
    const { handler, provider } = make();
    assertCode(
      await handler(ev({ body: { flight: 'SQ318', date: '2026-11-28' } })),
      'date_out_of_range'
    );
    assertCode(
      await handler(ev({ body: { flight: 'SQ318', date: '2027-12-02' } })),
      'date_out_of_range'
    );
    for (const date of ['2026-11-29', '2027-12-01']) {
      const res = await handler(ev({ body: { flight: 'SQ318', date } }));
      assert.equal(res.statusCode, 200, date);
    }
    assert.equal(provider.calls.length, 2);
  });
});

// ── Cache ────────────────────────────────────────────────────────────────────────────────────

describe('cache', () => {
  test('a miss calls the provider once with flight, date, key and mode, and writes the cache', async () => {
    useDdb();
    const { handler, provider } = make();
    const res = await handler(ev());
    assert.equal(res.statusCode, 200);
    const body = json(res);
    assert.equal(body.cached, false);
    assert.equal(body.fetchedAt, new Date(NOW).toISOString());
    assert.equal(body.legs.length, 1);

    assert.equal(provider.calls.length, 1);
    const call = provider.calls[0];
    assert.equal(call.flight, 'SQ318');
    assert.equal(call.date, FAR_DATE);
    assert.equal(call.apiKey, 'provider-key');
    assert.equal(call.mode, 'direct');
    assert.ok(call.signal instanceof AbortSignal);

    const item = ddb.items.get(`SQ318#${FAR_DATE}`);
    assert.ok(item, 'cache item written');
    assert.deepEqual(JSON.parse(item.body.S), body.legs);
    assert.equal(item.fetched_at.S, body.fetchedAt);
    assert.equal(Number(item.expires_at.N), NOW_S + TTL_FAR_SECONDS);
  });

  test('a hit is served without the provider and without spending a day token', async () => {
    useDdb();
    const { handler, provider } = make();
    await handler(ev());
    const res = await handler(ev({ body: { flight: 'sq 318', date: FAR_DATE } }));
    assert.equal(res.statusCode, 200);
    const body = json(res);
    assert.equal(body.cached, true);
    assert.equal(body.fetchedAt, new Date(NOW).toISOString());
    assert.equal(provider.calls.length, 1);
    assert.equal(ddb.items.get('g#2026-12-01').n.N, '1');
    assert.deepEqual(
      requestLines().map((l) => l.outcome),
      ['provider_ok', 'cache_hit']
    );
  });

  test('an expired item is not served even though the TTL reaper has not removed it', async () => {
    useDdb();
    const first = make();
    await first.handler(ev());
    const later = make({ now: NOW + (TTL_FAR_SECONDS + 1) * 1000 });
    const res = await later.handler(ev());
    assert.equal(json(res).cached, false);
    assert.equal(later.provider.calls.length, 1);
  });

  test('TTL: 10 min within 24 h of the earliest leg (past included), 6 h further out, 30 min empty', () => {
    assert.equal(ttlSecondsFor([leg({ utc: '2026-12-02 11:00Z' })], NOW), TTL_NEAR_SECONDS);
    assert.equal(ttlSecondsFor([leg({ utc: '2026-11-30 11:00Z' })], NOW), TTL_NEAR_SECONDS);
    assert.equal(
      ttlSecondsFor([leg({ utc: '2026-12-05 11:00Z' }), leg({ utc: '2026-12-01T20:00:00Z' })], NOW),
      TTL_NEAR_SECONDS
    );
    assert.equal(ttlSecondsFor([leg({ utc: '2026-12-02 13:00Z' })], NOW), TTL_FAR_SECONDS);
    assert.equal(ttlSecondsFor([leg({ utc: undefined })], NOW), TTL_FAR_SECONDS);
    assert.equal(ttlSecondsFor([], NOW), TTL_EMPTY_SECONDS);
    assert.equal(TTL_NEAR_SECONDS, 600);
    assert.equal(TTL_FAR_SECONDS, 21_600);
    assert.equal(TTL_EMPTY_SECONDS, 1800);
  });

  test('a near flight is cached for 10 minutes', async () => {
    useDdb();
    const provider = fakeProvider(() => ({
      legs: [leg({ utc: '2026-12-01 20:00Z' })],
      status: 200,
    }));
    const { handler } = make({ provider });
    const res = await handler(ev({ body: { flight: 'SQ318', date: '2026-12-01' } }));
    assert.equal(res.statusCode, 200);
    assert.equal(Number(ddb.items.get('SQ318#2026-12-01').expires_at.N), NOW_S + TTL_NEAR_SECONDS);
    assert.equal(requestLines()[0].ttl_s, TTL_NEAR_SECONDS);
  });

  test('an empty answer (provider 204) is 200 with no legs and is cached for 30 minutes', async () => {
    useDdb();
    const provider = fakeProvider(() => ({ legs: [], status: 204 }));
    const { handler } = make({ provider });
    const res = await handler(ev());
    assert.equal(res.statusCode, 200);
    assert.deepEqual(json(res).legs, []);
    assert.equal(json(res).cached, false);
    const item = ddb.items.get(`SQ318#${FAR_DATE}`);
    assert.equal(Number(item.expires_at.N), NOW_S + TTL_EMPTY_SECONDS);

    const again = await handler(ev());
    assert.deepEqual(json(again), {
      legs: [],
      fetchedAt: new Date(NOW).toISOString(),
      cached: true,
    });
    assert.equal(provider.calls.length, 1);
    assert.deepEqual(
      requestLines().map((l) => [l.outcome, l.legs]),
      [
        ['provider_empty', 0],
        ['cache_hit', 0],
      ]
    );
  });
});

// ── Limits ───────────────────────────────────────────────────────────────────────────────────

describe('limits', () => {
  test('per-IP hourly limit → 429 rate_limited with retryAfterSeconds to the end of the hour', async () => {
    useDdb();
    const { handler } = make({ env: { IP_LIMIT: '2' } });
    assert.equal((await handler(ev())).statusCode, 200);
    assert.equal((await handler(ev())).statusCode, 200); // cache hit still spends an IP token
    const res = await handler(ev());
    assertCode(res, 'rate_limited');
    assert.equal(json(res).retryAfterSeconds, 3600 - (NOW_S % 3600));
    assert.equal(
      (await handler(ev({ ip: '198.51.100.9' }))).statusCode,
      200,
      'another IP is unaffected'
    );
    assert.equal(requestLines().at(-2).outcome, 'rate_limited');
  });

  test('IPv6 collapses to its /64, so rotating the host half does not mint new buckets', async () => {
    assert.equal(ipKey('2001:db8:1:2:aaaa::1'), '2001:db8:1:2::/64');
    assert.equal(ipKey('203.0.113.7'), '203.0.113.7');
    useDdb();
    const { handler } = make({ env: { IP_LIMIT: '1' } });
    assert.equal((await handler(ev({ ip: '2001:db8:1:2:aaaa::1' }))).statusCode, 200);
    assertCode(await handler(ev({ ip: '2001:db8:1:2:bbbb::2' })), 'rate_limited');
  });

  test('IP_LIMIT defaults to 240 an hour', async () => {
    useDdb();
    const { handler } = make({ env: { IP_LIMIT: undefined } });
    for (let i = 0; i < 240; i += 1) assert.equal((await handler(ev())).statusCode, 200);
    assertCode(await handler(ev()), 'rate_limited');
  });

  test('daily cap reached → 503 budget_exhausted, provider NOT called, while a cache hit is still served', async () => {
    useDdb();
    const { handler, provider } = make({ env: { DAILY_PROVIDER_CAP: '1' } });
    assert.equal((await handler(ev())).statusCode, 200); // spends the one token, caches SQ318

    const refused = await handler(ev({ body: { flight: 'BA12', date: FAR_DATE } }));
    assertCode(refused, 'budget_exhausted');
    // 12:00 UTC → 12 h to midnight.
    assert.equal(json(refused).retryAfterSeconds, 12 * 3600);
    assert.equal(provider.calls.length, 1, 'no provider call once the cap is spent');
    assert.ok(logs.error.some((l) => l.startsWith(ALARMING_PREFIXES.budgetExhausted)));

    const hit = await handler(ev());
    assert.equal(hit.statusCode, 200);
    assert.equal(json(hit).cached, true);
    assert.equal(provider.calls.length, 1);
    assert.deepEqual(
      requestLines().map((l) => l.outcome),
      ['provider_ok', 'budget_exhausted', 'cache_hit']
    );
  });

  test('the cap is keyed on the UTC day, with a two-day TTL', async () => {
    useDdb();
    const { handler } = make();
    await handler(ev());
    const day = ddb.items.get('g#2026-12-01');
    assert.equal(day.n.N, '1');
    assert.equal(Number(day.expires_at.N), Date.parse('2026-12-03T00:00:00Z') / 1000);
  });

  test('DAILY_PROVIDER_CAP defaults to 600; a malformed value warns and uses the default', async () => {
    useDdb();
    const { handler } = make({ env: { DAILY_PROVIDER_CAP: 'lots', IP_LIMIT: '100000' } });
    assert.ok(logs.warn.some((l) => l.includes('DAILY_PROVIDER_CAP')));
    for (let i = 0; i < 600; i += 1) {
      const res = await handler(ev({ body: { flight: `SQ${i + 1}`, date: FAR_DATE } }));
      assert.equal(res.statusCode, 200);
    }
    assertCode(await handler(ev({ body: { flight: 'BA12', date: FAR_DATE } })), 'budget_exhausted');
  });
});

// ── Provider ─────────────────────────────────────────────────────────────────────────────────

describe('provider errors', () => {
  const cases = [
    ['upstream_timeout', undefined, 504],
    ['upstream_network', undefined, 502],
    ['upstream_auth', 401, 502],
    ['upstream_auth', 403, 502],
    ['upstream_rate_limited', 429, 503],
    ['upstream_unavailable', 503, 503],
    ['upstream_http', 400, 502],
  ];
  for (const [code, httpStatus, status] of cases) {
    test(`${code}${httpStatus ? ` (${httpStatus})` : ''} → ${status}, called once, nothing cached`, async () => {
      useDdb();
      const provider = fakeProvider(() => {
        throw new FakeProviderError(code, httpStatus);
      });
      const { handler } = make({ provider });
      const res = await handler(ev());
      assert.equal(res.statusCode, status);
      assertCode(res, code);
      assert.equal(provider.calls.length, 1, 'no retry');
      assert.equal(ddb.items.has(`SQ318#${FAR_DATE}`), false);
      const line = requestLines()[0];
      assert.equal(line.outcome, 'provider_error');
      assert.equal(line.code, code);
      assert.equal(typeof line.provider_ms, 'number');
    });
  }

  test('auth and rate-limit failures log their alarmed prefixes; others do not', async () => {
    for (const [code, prefix] of [
      ['upstream_auth', ALARMING_PREFIXES.providerAuthFailed],
      ['upstream_rate_limited', ALARMING_PREFIXES.providerRateLimited],
    ]) {
      useDdb();
      logs.error.length = 0;
      const provider = fakeProvider(() => {
        throw new FakeProviderError(code, 401);
      });
      await make({ provider }).handler(ev());
      assert.ok(
        logs.error.some((l) => l.startsWith(prefix)),
        `${code} logs ${prefix}`
      );
    }
    useDdb();
    logs.error.length = 0;
    await make({
      provider: fakeProvider(() => {
        throw new FakeProviderError('upstream_unavailable', 503);
      }),
    }).handler(ev());
    assert.equal(logs.error.length, 0);
  });

  test('a throw that is not a ProviderError is a clean 500 internal_error', async () => {
    useDdb();
    const provider = fakeProvider(() => {
      throw new TypeError('cannot read properties of undefined');
    });
    assertCode(await make({ provider }).handler(ev()), 'internal_error');
    const notLegs = fakeProvider(() => ({ status: 200 }));
    assertCode(await make({ provider: notLegs }).handler(ev()), 'internal_error');
  });

  test('an unset provider key is upstream_auth with the alarmed prefix, and spends nothing', async () => {
    useDdb();
    const { handler, provider } = make({ env: { AERODATABOX_API_KEY: '' } });
    assertCode(await handler(ev()), 'upstream_auth');
    assert.equal(provider.calls.length, 0);
    assert.equal(ddb.items.has('g#2026-12-01'), false, 'no day token spent');
    assert.ok(logs.error.some((l) => l.startsWith(ALARMING_PREFIXES.providerAuthFailed)));
  });

  test('the provider signal is bounded by the time the function has left', async () => {
    useDdb();
    let seen;
    const provider = fakeProvider(({ signal }) => {
      seen = signal;
      return { legs: [], status: 204 };
    });
    await make({ provider }).handler(ev(), { getRemainingTimeInMillis: () => 3000 });
    assert.ok(seen instanceof AbortSignal);
    assert.equal(seen.aborted, false);
  });
});

describe('provider mode', () => {
  test('AERODATABOX_MODE reaches the injected provider', async () => {
    useDdb();
    const { handler, provider } = make({ env: { AERODATABOX_MODE: 'apimarket' } });
    assert.equal((await handler(ev())).statusCode, 200);
    assert.equal(provider.calls[0].mode, 'apimarket');
  });

  test('unset mode is direct; an unknown mode logs once at cold start and falls back to direct', async () => {
    useDdb();
    const unset = make({ env: { AERODATABOX_MODE: undefined } });
    await unset.handler(ev());
    assert.equal(unset.provider.calls[0].mode, 'direct');

    const bad = make({ env: { AERODATABOX_MODE: 'scraper' } });
    assert.equal(logs.error.filter((l) => l.startsWith(BAD_MODE_PREFIX)).length, 1);
    await bad.handler(ev({ body: { flight: 'BA12', date: FAR_DATE } }));
    assert.equal(bad.provider.calls[0].mode, 'direct');
  });
});

// ── Fail-open store ──────────────────────────────────────────────────────────────────────────

describe('store failures fail open, loudly', () => {
  test('cache read failure: served from the provider, cache-unavailable logged', async () => {
    useDdb().failOn((op) => op === 'GetItemCommand');
    const { handler, provider } = make();
    const res = await handler(ev());
    assert.equal(res.statusCode, 200);
    assert.equal(provider.calls.length, 1);
    assert.ok(logs.error.some((l) => l.startsWith(ALARMING_PREFIXES.cacheUnavailable)));
  });

  test('cache write failure: still 200, cache-unavailable logged', async () => {
    useDdb().failOn((op) => op === 'PutItemCommand');
    const res = await make().handler(ev());
    assert.equal(res.statusCode, 200);
    assert.ok(logs.error.some((l) => l.startsWith(ALARMING_PREFIXES.cacheUnavailable)));
  });

  test('limiter store failure: allowed, rate-limit-store-unavailable logged for ip and day', async () => {
    useDdb().failOn((op) => op === 'UpdateItemCommand');
    const res = await make().handler(ev());
    assert.equal(res.statusCode, 200);
    const lines = logs.error.filter((l) => l.startsWith(ALARMING_PREFIXES.rateStoreUnavailable));
    assert.equal(lines.length, 2);
    assert.ok(lines.some((l) => l.includes('kind=day') && l.includes('NOT being enforced')));
  });

  test('no CACHE_TABLE: a silent no-op (no store calls, provider every time)', async () => {
    useDdb();
    const { handler, provider } = make({ env: { CACHE_TABLE: '' } });
    await handler(ev());
    await handler(ev());
    assert.equal(provider.calls.length, 2);
    assert.deepEqual(ddb.calls, []);
    assert.equal(logs.error.length, 0);
  });
});

// ── Logging ──────────────────────────────────────────────────────────────────────────────────

describe('logging', () => {
  test('one structured line per request with the fixed field set, never a key or header', async () => {
    useDdb();
    const { handler } = make();
    await handler(ev());
    await handler(ev({ key: 'nope' }));
    await handler(ev({ body: { flight: 'SQ318', date: 'soon' } }));
    const lines = requestLines();
    assert.equal(lines.length, 3);
    for (const l of lines) {
      assert.deepEqual(
        Object.keys(l)
          .filter((k) => k !== 'code')
          .sort(),
        ['date', 'flight', 'legs', 'msg', 'outcome', 'provider_ms', 'route', 'status', 'ttl_s']
      );
    }
    assert.deepEqual(
      lines.map((l) => [l.outcome, l.status, l.flight, l.date]),
      [
        ['provider_ok', 200, 'SQ318', FAR_DATE],
        ['bad_request', 401, null, null],
        ['bad_request', 400, 'SQ318', null],
      ]
    );
    const all = [...logs.log, ...logs.warn, ...logs.error].join('\n');
    assert.ok(!all.includes('test-key'), 'soft key never logged');
    assert.ok(!all.includes('provider-key'), 'provider key never logged');
    assert.ok(!all.includes('203.0.113.7'), 'source IP never logged');
  });
});

describe('provider units', () => {
  const lowLines = () => logs.warn.filter((l) => l.startsWith(PROVIDER_UNITS_LOW_PREFIX));

  test('units_remaining rides on the provider line when reported; no warning above 10%', async () => {
    useDdb();
    const provider = fakeProvider(() => ({
      legs: [leg()],
      status: 200,
      quota: { limit: 600, remaining: 60 },
    }));
    const { handler } = make({ provider });
    await handler(ev());
    const [line] = requestLines();
    assert.equal(line.outcome, 'provider_ok');
    assert.equal(line.units_remaining, 60);
    assert.deepEqual(lowLines(), []);
  });

  test('under 10% of the limit → one unalarmed warn line per answer, empty answers too', async () => {
    useDdb();
    const provider = fakeProvider(() => ({
      legs: [],
      status: 204,
      quota: { limit: 600, remaining: 59 },
    }));
    const { handler } = make({ provider });
    await handler(ev());
    const [line] = requestLines();
    assert.equal(line.outcome, 'provider_empty');
    assert.equal(line.units_remaining, 59);
    const low = lowLines();
    assert.equal(low.length, 1);
    assert.match(low[0], /remaining=59 limit=600 mode=direct/);
    assert.equal(logs.error.length, 0, 'low units is a warning, never an error');
    assert.ok(!Object.values(ALARMING_PREFIXES).includes(PROVIDER_UNITS_LOW_PREFIX));
  });

  test('no quota, a remaining without a limit, or a cache hit → no field and no warning', async () => {
    useDdb();
    let quota = null;
    const provider = fakeProvider(() => ({ legs: [leg()], status: 200, quota }));
    const { handler } = make({ provider });
    await handler(ev({ body: { flight: 'SQ318', date: FAR_DATE } }));
    quota = { remaining: 1 };
    await handler(ev({ body: { flight: 'SQ319', date: FAR_DATE } }));
    await handler(ev({ body: { flight: 'SQ318', date: FAR_DATE } }));
    const lines = requestLines();
    assert.deepEqual(
      lines.map((l) => [l.outcome, l.units_remaining]),
      [
        ['provider_ok', undefined],
        ['provider_ok', 1],
        ['cache_hit', undefined],
      ]
    );
    assert.ok(!('units_remaining' in lines[0]));
    assert.deepEqual(lowLines(), []);
  });
});

// ── Contract exports ─────────────────────────────────────────────────────────────────────────

describe('contract exports', () => {
  test('ERROR_CODES lists every code and each maps to a status', () => {
    assert.ok(Object.isFrozen(ERROR_CODES));
    for (const code of ERROR_CODES) assert.ok(STATUS_FOR_CODE[code].status >= 400, code);
    assert.equal(new Set(ERROR_CODES).size, ERROR_CODES.length);
  });

  test('ALARMING_PREFIXES: the five Phase 1 and seven Phase 2 alarmed prefixes', () => {
    assert.deepEqual(Object.values(ALARMING_PREFIXES).sort(), [
      '[flight-alerts] credit balance exhausted',
      '[flight-alerts] credit refill FAILED',
      '[flight-alerts] provider cancel FAILED',
      '[flight-alerts] provider subscribe FAILED',
      '[flight-alerts] push send FAILED',
      '[flight-alerts] store unavailable',
      '[flight-alerts] webhook rejected',
      '[flight-status] cache unavailable',
      '[flight-status] daily budget exhausted',
      '[flight-status] provider auth FAILED',
      '[flight-status] provider rate limited',
      '[flight-status] rate-limit store unavailable',
    ]);
  });

  // The real adapter is written in parallel; this wiring check runs once it exists.
  const adapter = join(HERE, '..', 'providers', 'aerodatabox.mjs');
  test(
    'index.mjs wires the real adapter and re-exports the contract',
    { skip: !existsSync(adapter) },
    async () => {
      const index = await import('../index.mjs');
      const real = await import('../providers/aerodatabox.mjs');
      assert.equal(index.ERROR_CODES, ERROR_CODES);
      assert.equal(index.ALARMING_PREFIXES, ALARMING_PREFIXES);
      assert.equal(typeof index.handler, 'function');
      const res = await index.handler(ev({ method: 'OPTIONS' }));
      assert.equal(res.statusCode, 204);

      const list = (x) =>
        Array.isArray(x) ? x : x instanceof Set ? [...x] : Object.values(x ?? {});
      for (const code of list(real.PROVIDER_ERROR_CODES)) {
        assert.ok(ERROR_CODES.includes(code), `adapter code ${code} has no HTTP mapping`);
      }
      const modes = list(real.PROVIDER_MODES);
      assert.ok(modes.includes('direct'), 'adapter exports PROVIDER_MODES including direct');
    }
  );
});
