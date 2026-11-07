import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  fetchLegs,
  mapLeg,
  buildUrl,
  parseQuota,
  ProviderError,
  PROVIDER_ERROR_CODES,
  PROVIDER_MODES,
} from '../providers/aerodatabox.mjs';

const FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/aerodatabox-sq318.json', import.meta.url), 'utf8')
);
const KEY = 'test-key-SECRET-123';
/** The fixed query every mode sends (built from parts: one literal trips no-secrets' entropy). */
const EXPECTED_QUERY = [
  'dateLocalRole=Departure',
  'withLocation=false',
  'withAircraftImage=false',
  'withFlightPlan=false',
].join('&');

/** A fake fetch that records every call and answers with `respond(url, init)`. */
function fakeFetch(respond) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    return respond(url, init);
  };
  return { impl, calls };
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function rejectsWith(promise, code, httpStatus) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof ProviderError, `expected ProviderError, got ${err?.name}`);
    assert.equal(err.code, code);
    assert.ok(PROVIDER_ERROR_CODES.includes(err.code));
    assert.equal(err.httpStatus, httpStatus);
    assert.ok(!String(err.message).includes(KEY), 'key must never appear in an error message');
    return true;
  });
}

describe('mapLeg', () => {
  test('maps the recorded SQ318 fixture to exactly the FlightLeg fields', () => {
    assert.deepEqual(mapLeg(FIXTURE[0]), {
      number: 'SQ 318',
      airline: { name: 'Singapore Airlines', iata: 'SQ', icao: 'SIA' },
      status: 'Expected',
      codeshareStatus: 'IsOperator',
      isCargo: false,
      lastUpdatedUtc: '2026-12-13 09:12Z',
      departure: {
        iata: 'SIN',
        icao: 'WSSS',
        name: 'Singapore, Changi',
        timeZone: 'Asia/Singapore',
        scheduledLocal: '2026-12-13 23:05+08:00',
        scheduledUtc: '2026-12-13 15:05Z',
        revisedLocal: '2026-12-13 23:20+08:00',
        terminal: '3',
        gate: 'B4',
        checkInDesk: '6-7',
        quality: ['Basic', 'Live'],
      },
      arrival: {
        iata: 'LHR',
        icao: 'EGLL',
        name: 'London Heathrow',
        timeZone: 'Europe/London',
        scheduledLocal: '2026-12-14 05:40+00:00',
        scheduledUtc: '2026-12-14 05:40Z',
        terminal: '2',
        baggageBelt: '7',
        quality: ['Basic'],
      },
    });
  });

  test('never carries vendor-only fields (aircraft, location, callSign, predictedTime)', () => {
    const s = JSON.stringify(mapLeg(FIXTURE[0]));
    for (const vendorOnly of [
      'aircraft',
      'location',
      'callSign',
      'predictedTime',
      'greatCircle',
      '9V-',
    ]) {
      assert.ok(!s.includes(vendorOnly), `${vendorOnly} leaked`);
    }
  });

  test('cargo → null; non-objects → null', () => {
    assert.equal(mapLeg({ ...FIXTURE[0], isCargo: true }), null);
    assert.equal(mapLeg(null), null);
    assert.equal(mapLeg('SQ318'), null);
    assert.equal(mapLeg([FIXTURE[0]]), null);
  });

  test('status enums pass through verbatim, Unknown when absent', () => {
    for (const status of ['Canceled', 'CanceledUncertain', 'Diverted', 'Arrived', 'SomethingNew']) {
      assert.equal(mapLeg({ ...FIXTURE[0], status }).status, status);
    }
    assert.equal(
      mapLeg({ ...FIXTURE[0], codeshareStatus: 'IsCodeshared' }).codeshareStatus,
      'IsCodeshared'
    );
    const bare = mapLeg({ number: 'SQ 318' });
    assert.equal(bare.status, 'Unknown');
    assert.equal(bare.codeshareStatus, 'Unknown');
    assert.deepEqual(bare.departure, { quality: [] });
    assert.equal('airline' in bare, false);
  });
});

describe('fetchLegs', () => {
  test('200 → mapped legs, cargo dropped', async () => {
    const cargo = { ...FIXTURE[0], number: 'SQ 7318', isCargo: true };
    const { impl } = fakeFetch(() => json([FIXTURE[0], cargo]));
    const out = await fetchLegs({
      flight: 'SQ318',
      date: '2026-12-13',
      apiKey: KEY,
      fetchImpl: impl,
    });
    assert.equal(out.status, 200);
    assert.equal(out.legs.length, 1);
    assert.equal(out.legs[0].number, 'SQ 318');
  });

  test('204 → legs: [] (a valid empty answer)', async () => {
    const { impl } = fakeFetch(() => new Response(null, { status: 204 }));
    const out = await fetchLegs({
      flight: 'SQ318',
      date: '2026-12-13',
      apiKey: KEY,
      fetchImpl: impl,
    });
    assert.deepEqual(out, { legs: [], status: 204, quota: null });
  });

  for (const [status, code] of [
    [401, 'upstream_auth'],
    [403, 'upstream_auth'],
    [429, 'upstream_rate_limited'],
    [500, 'upstream_unavailable'],
    [503, 'upstream_unavailable'],
    [400, 'upstream_http'],
    [404, 'upstream_http'],
  ]) {
    test(`HTTP ${status} → ${code}`, async () => {
      const { impl } = fakeFetch(() => json({ message: 'nope' }, status));
      await rejectsWith(
        fetchLegs({ flight: 'SQ318', date: '2026-12-13', apiKey: KEY, fetchImpl: impl }),
        code,
        status
      );
    });
  }

  test('a network failure → upstream_network', async () => {
    const impl = async () => {
      throw new TypeError('fetch failed');
    };
    await rejectsWith(
      fetchLegs({ flight: 'SQ318', date: '2026-12-13', apiKey: KEY, fetchImpl: impl }),
      'upstream_network',
      undefined
    );
  });

  test("the caller's signal aborting → upstream_timeout", async () => {
    const impl = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      });
    await rejectsWith(
      fetchLegs({
        flight: 'SQ318',
        date: '2026-12-13',
        apiKey: KEY,
        fetchImpl: impl,
        signal: AbortSignal.timeout(20),
      }),
      'upstream_timeout',
      undefined
    );
  });

  test('a signal is always passed, even without a caller signal (the 8 s ceiling)', async () => {
    const { impl, calls } = fakeFetch(() => json([]));
    await fetchLegs({ flight: 'SQ318', date: '2026-12-13', apiKey: KEY, fetchImpl: impl });
    assert.ok(calls[0].init.signal instanceof AbortSignal);
  });

  test('unparseable JSON or a non-array body → upstream_http', async () => {
    const bad = fakeFetch(() => new Response('<html>', { status: 200 }));
    await rejectsWith(
      fetchLegs({ flight: 'SQ318', date: '2026-12-13', apiKey: KEY, fetchImpl: bad.impl }),
      'upstream_http',
      200
    );
    const obj = fakeFetch(() => json({ legs: [] }));
    await rejectsWith(
      fetchLegs({ flight: 'SQ318', date: '2026-12-13', apiKey: KEY, fetchImpl: obj.impl }),
      'upstream_http',
      200
    );
  });

  test('an unknown mode throws a plain Error (configuration bug, not upstream)', async () => {
    const { impl, calls } = fakeFetch(() => json([]));
    await assert.rejects(
      fetchLegs({
        flight: 'SQ318',
        date: '2026-12-13',
        apiKey: KEY,
        mode: 'flightaware',
        fetchImpl: impl,
      }),
      (err) => !(err instanceof ProviderError) && /unknown mode/.test(err.message)
    );
    assert.equal(calls.length, 0);
  });
});

describe('quota', () => {
  const UNITS = {
    'x-ratelimit-api-units-limit': '600',
    'x-ratelimit-api-units-remaining': '42',
  };

  test('parseQuota: both counts, either alone, or null when neither is usable', () => {
    assert.deepEqual(parseQuota(new Headers(UNITS)), { limit: 600, remaining: 42 });
    assert.deepEqual(parseQuota(new Headers({ 'X-RateLimit-API-Units-Remaining': ' 0 ' })), {
      remaining: 0,
    });
    assert.deepEqual(parseQuota(new Headers({ 'x-ratelimit-api-units-limit': '600' })), {
      limit: 600,
    });
    assert.equal(parseQuota(new Headers()), null);
    assert.equal(parseQuota(undefined), null);
    for (const bad of ['', 'lots', '-1', '1.5', '1e3', '99999999999999999999']) {
      assert.equal(
        parseQuota(
          new Headers({
            'x-ratelimit-api-units-limit': bad,
            'x-ratelimit-api-units-remaining': bad,
          })
        ),
        null,
        `"${bad}" is not a unit count`
      );
    }
  });

  test('fetchLegs returns the quota on a 200 and a 204, null when the channel sends none', async () => {
    const ok = fakeFetch(
      () =>
        new Response(JSON.stringify([FIXTURE[0]]), {
          status: 200,
          headers: { 'content-type': 'application/json', ...UNITS },
        })
    );
    const out = await fetchLegs({
      flight: 'SQ318',
      date: '2026-12-13',
      apiKey: KEY,
      mode: 'rapidapi',
      fetchImpl: ok.impl,
    });
    assert.deepEqual(out.quota, { limit: 600, remaining: 42 });

    const empty = fakeFetch(() => new Response(null, { status: 204, headers: UNITS }));
    const none = await fetchLegs({
      flight: 'ZZ9999',
      date: '2026-12-13',
      apiKey: KEY,
      mode: 'rapidapi',
      fetchImpl: empty.impl,
    });
    assert.deepEqual(none, { legs: [], status: 204, quota: { limit: 600, remaining: 42 } });

    const direct = fakeFetch(() => json([FIXTURE[0]]));
    const plain = await fetchLegs({
      flight: 'SQ318',
      date: '2026-12-13',
      apiKey: KEY,
      fetchImpl: direct.impl,
    });
    assert.equal(plain.quota, null);
  });
});

describe('modes', () => {
  const EXPECT = {
    direct: { base: 'https://api.aerodatabox.com/', headers: { 'X-Api-Key': KEY } },
    rapidapi: {
      base: 'https://aerodatabox.p.rapidapi.com/',
      headers: { 'X-RapidAPI-Key': KEY, 'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com' },
    },
    apimarket: {
      base: 'https://prod.api.market/api/v1/aedbx/aerodatabox/',
      headers: { 'x-api-market-key': KEY },
    },
  };

  test('PROVIDER_MODES lists exactly the three channels', () => {
    assert.deepEqual([...PROVIDER_MODES], Object.keys(EXPECT));
  });

  for (const mode of Object.keys(EXPECT)) {
    test(`${mode}: base URL, path, query and auth headers; the key never in the URL`, async () => {
      const { impl, calls } = fakeFetch(() => json(FIXTURE));
      const args = { flight: 'SQ318', date: '2026-12-13', apiKey: KEY, fetchImpl: impl };
      await fetchLegs(mode === 'direct' ? args : { ...args, mode });
      assert.equal(calls.length, 1);
      const { url, init } = calls[0];
      assert.equal(url, `${EXPECT[mode].base}flights/number/SQ318/2026-12-13?${EXPECTED_QUERY}`);
      assert.equal(url, buildUrl(mode, 'SQ318', '2026-12-13'));
      assert.ok(!url.includes(KEY), 'key leaked into the URL');
      assert.equal(init.method, 'GET');
      for (const [name, value] of Object.entries(EXPECT[mode].headers)) {
        assert.equal(init.headers[name], value, `${name} header`);
      }
      // The key appears in exactly the documented auth header and nowhere else.
      const carrying = Object.entries(init.headers).filter(([, v]) => String(v).includes(KEY));
      assert.equal(carrying.length, 1);
    });
  }
});
