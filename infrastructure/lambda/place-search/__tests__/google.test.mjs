import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTOCOMPLETE_FIELD_MASK,
  AUTOCOMPLETE_URL,
  GEOCODE_URL,
  kindOf,
  PROVIDER_ERROR_CODES,
  PROVIDER_REASONS,
  ProviderError,
  resolvePlace,
  suggestPlaces,
} from '../providers/google.mjs';
import { fakeResponse } from './helpers.mjs';

const KEY = 'provider-SECRET-key-123';

/** A fake fetch that records each call and answers with `reply(url, init)`. */
function fakeFetch(reply) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return reply(url, init);
  };
  return { fetchImpl, calls };
}

const ok = (obj) => () => fakeResponse(200, JSON.stringify(obj));

async function rejects(promise, code, reason) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof ProviderError, `expected ProviderError, got ${err?.name}`);
    assert.equal(err.code, code);
    if (reason !== undefined) assert.equal(err.reason, reason);
    assert.ok(PROVIDER_ERROR_CODES.includes(err.code));
    if (err.reason !== undefined) assert.ok(PROVIDER_REASONS.includes(err.reason));
    assert.equal(
      err.cause,
      undefined,
      'no cause: a fetch or parse error can carry the URL or body'
    );
    return true;
  });
}

const GOOGLE_OK = {
  suggestions: [
    {
      placePrediction: {
        placeId: 'ChIJ127SouthBridge',
        structuredFormat: {
          mainText: { text: '127 South Bridge Road' },
          secondaryText: { text: 'Singapore' },
        },
        types: ['street_address', 'geocode'],
      },
    },
    {
      placePrediction: {
        placeId: 'ChIJHungarianTouch',
        structuredFormat: {
          mainText: { text: 'The Hungarian Touch' },
          secondaryText: { text: 'East Coast Road, Singapore' },
        },
        types: ['restaurant', 'food', 'point_of_interest', 'establishment'],
      },
    },
    { queryPrediction: { text: { text: 'ignored' } } },
    { placePrediction: { placeId: 'ChIJnoMain', structuredFormat: {} } },
    {
      placePrediction: {
        placeId: 'ChIJnoSecondary',
        structuredFormat: { mainText: { text: 'X' } },
      },
    },
  ],
};

describe('suggestPlaces: the fixed request', () => {
  test('POSTs the fixed URL with the key in a header and the trimmed field mask', async () => {
    const { fetchImpl, calls } = fakeFetch(ok(GOOGLE_OK));
    await suggestPlaces({ q: '127 south bridge', lang: 'en', apiKey: KEY, fetchImpl });
    assert.equal(calls.length, 1);
    const { url, init } = calls[0];
    assert.equal(url, AUTOCOMPLETE_URL);
    assert.equal(url, 'https://places.googleapis.com/v1/places:autocomplete');
    assert.equal(init.method, 'POST');
    assert.deepEqual(init.headers, {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': KEY,
      'X-Goog-FieldMask':
        'suggestions.placePrediction.placeId,' +
        'suggestions.placePrediction.structuredFormat.mainText.text,' +
        'suggestions.placePrediction.structuredFormat.secondaryText.text,' +
        'suggestions.placePrediction.types',
    });
    assert.equal(init.headers['X-Goog-FieldMask'], AUTOCOMPLETE_FIELD_MASK);
    assert.ok(init.signal instanceof AbortSignal);
    assert.ok(!url.includes(KEY));
  });

  test('without a bias the body is exactly { input, languageCode }', async () => {
    const { fetchImpl, calls } = fakeFetch(ok(GOOGLE_OK));
    await suggestPlaces({ q: 'Marina Bay Sands', lang: 'zh-CN', apiKey: KEY, fetchImpl });
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      input: 'Marina Bay Sands',
      languageCode: 'zh-CN',
    });
  });

  test('with a bias: a 50 km circle, and regionCode only when a country is known', async () => {
    const { fetchImpl, calls } = fakeFetch(ok(GOOGLE_OK));
    await suggestPlaces({
      q: '127 south bridge',
      lang: 'en',
      bias: { lat: 1.29, lon: 103.85, countryCode: 'SG' },
      apiKey: KEY,
      fetchImpl,
    });
    await suggestPlaces({
      q: '127 south bridge',
      lang: 'en',
      bias: { lat: 1.29, lon: 103.85 },
      apiKey: KEY,
      fetchImpl,
    });
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      input: '127 south bridge',
      languageCode: 'en',
      locationBias: { circle: { center: { latitude: 1.29, longitude: 103.85 }, radius: 50000 } },
      regionCode: 'sg',
    });
    assert.deepEqual(JSON.parse(calls[1].init.body), {
      input: '127 south bridge',
      languageCode: 'en',
      locationBias: { circle: { center: { latitude: 1.29, longitude: 103.85 }, radius: 50000 } },
    });
  });

  test('maps place predictions to the beanies shape and skips query predictions and junk', async () => {
    const { fetchImpl } = fakeFetch(ok(GOOGLE_OK));
    const out = await suggestPlaces({ q: 'abc', lang: 'en', apiKey: KEY, fetchImpl });
    assert.deepEqual(out, {
      suggestions: [
        {
          placeId: 'ChIJ127SouthBridge',
          main: '127 South Bridge Road',
          secondary: 'Singapore',
          kind: 'address',
        },
        {
          placeId: 'ChIJHungarianTouch',
          main: 'The Hungarian Touch',
          secondary: 'East Coast Road, Singapore',
          kind: 'place',
        },
        { placeId: 'ChIJnoSecondary', main: 'X', secondary: '', kind: 'address' },
      ],
    });
  });

  test('kind: a place only when the types name an establishment or point of interest', () => {
    assert.equal(kindOf(['establishment']), 'place');
    assert.equal(kindOf(['point_of_interest', 'park']), 'place');
    assert.equal(kindOf(['street_address', 'geocode']), 'address');
    assert.equal(kindOf(['premise']), 'address');
    assert.equal(kindOf([]), 'address');
    assert.equal(kindOf(undefined), 'address');
    assert.equal(kindOf('establishment'), 'address', 'a string is not a types list');
  });

  test('an answer with no suggestions key is an empty list (proto3 omits empty fields)', async () => {
    const { fetchImpl } = fakeFetch(ok({}));
    assert.deepEqual(await suggestPlaces({ q: 'abc', lang: 'en', apiKey: KEY, fetchImpl }), {
      suggestions: [],
    });
  });
});

describe('suggestPlaces: error mapping', () => {
  const run = (reply) =>
    suggestPlaces({ q: 'abc', lang: 'en', apiKey: KEY, fetchImpl: fakeFetch(reply).fetchImpl });
  const envelope = (code, status, reason) =>
    JSON.stringify({
      error: {
        code,
        status,
        message: 'API key not valid. BODYSENTINEL',
        details: reason ? [{ reason }] : [],
      },
    });

  test('401 and 403 are upstream_auth', async () => {
    await rejects(
      run(() => fakeResponse(401, '{}')),
      'upstream_auth'
    );
    await rejects(
      run(() => fakeResponse(403, envelope(403, 'PERMISSION_DENIED'))),
      'upstream_auth'
    );
  });

  test("a 400 API_KEY_INVALID (Google's answer to a bad key) is upstream_auth", async () => {
    await rejects(
      run(() => fakeResponse(400, envelope(400, 'INVALID_ARGUMENT', 'API_KEY_INVALID'))),
      'upstream_auth'
    );
  });

  test('a plain 400 is upstream_http', async () => {
    await rejects(
      run(() => fakeResponse(400, envelope(400, 'INVALID_ARGUMENT'))),
      'upstream_http'
    );
    await rejects(
      run(() => fakeResponse(400, 'not json')),
      'upstream_http'
    );
  });

  test('429 and RESOURCE_EXHAUSTED are upstream_rate_limited', async () => {
    await rejects(
      run(() => fakeResponse(429, 'slow down')),
      'upstream_rate_limited'
    );
    await rejects(
      run(() => fakeResponse(400, envelope(400, 'RESOURCE_EXHAUSTED'))),
      'upstream_rate_limited'
    );
  });

  test('5xx is upstream_unavailable', async () => {
    await rejects(
      run(() => fakeResponse(503, 'down')),
      'upstream_unavailable'
    );
  });

  test("a 200 that is not JSON is upstream_http bad_json (Node's message would quote the body)", async () => {
    await rejects(
      run(() => fakeResponse(200, '<html>BODYSENTINEL</html>')),
      'upstream_http',
      'bad_json'
    );
  });

  test('a 200 with the wrong shape is upstream_http bad_shape', async () => {
    await rejects(run(ok([])), 'upstream_http', 'bad_shape');
    await rejects(run(ok({ suggestions: 'x' })), 'upstream_http', 'bad_shape');
    await rejects(
      run(() => fakeResponse(200, 'null')),
      'upstream_http',
      'bad_shape'
    );
  });

  test('a fetch that throws is upstream_network; an aborted one is upstream_timeout', async () => {
    await rejects(
      run(() => {
        throw new TypeError(`fetch failed ${AUTOCOMPLETE_URL}`);
      }),
      'upstream_network'
    );
    await rejects(
      suggestPlaces({
        q: 'abc',
        lang: 'en',
        apiKey: KEY,
        signal: AbortSignal.abort(),
        fetchImpl: async (url, init) => {
          throw init.signal.reason;
        },
      }),
      'upstream_timeout'
    );
  });

  test('the error message never carries the key or body text', async () => {
    try {
      await run(() => fakeResponse(400, envelope(400, 'INVALID_ARGUMENT', 'API_KEY_INVALID')));
      assert.fail('should throw');
    } catch (err) {
      assert.ok(!String(err.message).includes(KEY));
      assert.ok(!String(err.message).includes('BODYSENTINEL'));
    }
  });
});

describe('resolvePlace', () => {
  const geocodeOk = {
    status: 'OK',
    results: [{ formatted_address: '127 S Bridge Rd, Singapore 058285', place_id: 'ChIJx' }],
  };

  test('GETs the Geocoding URL with exactly place_id, language and key (URLSearchParams)', async () => {
    const { fetchImpl, calls } = fakeFetch(ok(geocodeOk));
    const out = await resolvePlace({
      placeId: 'ChIJ127_x-y',
      lang: 'zh-TW',
      apiKey: 'k&y=1',
      fetchImpl,
    });
    assert.deepEqual(out, { address: '127 S Bridge Rd, Singapore 058285' });
    const u = new URL(calls[0].url);
    assert.equal(`${u.origin}${u.pathname}`, GEOCODE_URL);
    assert.equal(GEOCODE_URL, 'https://maps.googleapis.com/maps/api/geocode/json');
    assert.deepEqual([...u.searchParams.keys()], ['place_id', 'language', 'key']);
    assert.equal(u.searchParams.get('place_id'), 'ChIJ127_x-y');
    assert.equal(u.searchParams.get('language'), 'zh-TW');
    assert.equal(u.searchParams.get('key'), 'k&y=1', 'the key is encoded, not spliced');
    assert.equal(calls[0].init.method, 'GET');
  });

  const run = (reply) =>
    resolvePlace({
      placeId: 'ChIJx',
      lang: 'en',
      apiKey: KEY,
      fetchImpl: fakeFetch(reply).fetchImpl,
    });

  const statusCases = [
    ['REQUEST_DENIED', 'upstream_auth', 'request_denied'],
    ['OVER_DAILY_LIMIT', 'upstream_auth', 'over_daily_limit'],
    ['OVER_QUERY_LIMIT', 'upstream_rate_limited', 'over_query_limit'],
    ['ZERO_RESULTS', 'upstream_http', 'zero_results'],
    ['INVALID_REQUEST', 'upstream_http', 'invalid_request'],
    ['UNKNOWN_ERROR', 'upstream_unavailable', 'unknown_error'],
    ['SOMETHING_NEW', 'upstream_http', 'unexpected_status'],
  ];
  for (const [status, code, reason] of statusCases) {
    test(`Geocoding status ${status} → ${code} (${reason})`, async () => {
      await rejects(
        run(
          ok({
            status,
            error_message: 'The provided API key is invalid. BODYSENTINEL',
            results: [],
          })
        ),
        code,
        reason
      );
    });
  }

  test('HTTP failures map like Autocomplete', async () => {
    await rejects(
      run(() => fakeResponse(403, 'x')),
      'upstream_auth'
    );
    await rejects(
      run(() => fakeResponse(429, 'x')),
      'upstream_rate_limited'
    );
    await rejects(
      run(() => fakeResponse(500, 'x')),
      'upstream_unavailable'
    );
    await rejects(
      run(() => fakeResponse(404, 'x')),
      'upstream_http'
    );
  });

  test('a 200 that is not JSON, or OK without an address, is upstream_http', async () => {
    await rejects(
      run(() => fakeResponse(200, 'BODYSENTINEL{')),
      'upstream_http',
      'bad_json'
    );
    await rejects(run(ok({ status: 'OK', results: [] })), 'upstream_http', 'bad_shape');
    await rejects(
      run(ok({ status: 'OK', results: [{ formatted_address: '  ' }] })),
      'upstream_http',
      'bad_shape'
    );
    await rejects(run(ok({ results: [] })), 'upstream_http', 'bad_shape');
  });

  test('a fetch error never carries the URL (which holds the key) onward', async () => {
    await rejects(
      run((url) => {
        throw new TypeError(`Failed to fetch ${url}`);
      }),
      'upstream_network'
    );
  });
});
