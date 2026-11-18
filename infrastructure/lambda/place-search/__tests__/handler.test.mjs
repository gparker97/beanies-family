/* global process */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Env BEFORE any import of the Lambda's modules. The factory takes its env as an argument, so
// these only matter to the index.mjs wiring test at the bottom.
process.env.PLACE_SEARCH_API_KEY = 'soft-test-key';
process.env.PLACE_PROVIDER_API_KEY = 'provider-SECRET-key-123';
delete process.env.COUNTER_TABLE;

const {
  createHandler,
  ERROR_CODES,
  STATUS_FOR_CODE,
  ALARMING_PREFIXES,
  MAX_SUGGESTIONS,
  MAX_TEXT_CHARS,
  normaliseLang,
  normaliseBias,
  normaliseQuery,
} = await import('../createHandler.mjs');
const { __setDdbClientForTests } = await import('../ddb.mjs');
const {
  BASE_ENV,
  FakeProviderError,
  NOW,
  TABLE,
  captureConsole,
  ev,
  fakeDdb,
  fakeProvider,
  json,
  requestLines,
} = await import('./helpers.mjs');

const logs = captureConsole();
afterEach(() => __setDdbClientForTests(null));

function make({ env = {}, provider = fakeProvider(), now = NOW, ddb = fakeDdb() } = {}) {
  const handler = createHandler({
    provider,
    env: { ...BASE_ENV, ...env },
    now: () => now,
    fetchImpl: () => {
      throw new Error('the fake provider must never reach fetch');
    },
    ddb,
  });
  return { handler, provider, ddb };
}

/** Every non-2xx answer must carry a code from the table, with its status. */
function assertCode(res, code) {
  const body = json(res);
  assert.equal(body.code, code);
  assert.ok(ERROR_CODES.includes(code), `${code} is not in ERROR_CODES`);
  assert.equal(res.statusCode, STATUS_FOR_CODE[code].status);
}

const errorsWith = (prefix) => logs().error.filter((l) => l.includes(prefix));

// ── HTTP shape ───────────────────────────────────────────────────────────────────────────────

describe('HTTP shape and dispatch', () => {
  test('OPTIONS answers 204 with CORS and an empty body, no key needed', async () => {
    const { handler, ddb } = make();
    const res = await handler(ev({ method: 'OPTIONS', key: null }));
    assert.equal(res.statusCode, 204);
    assert.equal(res.body, '');
    assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://app.beanies.family');
    assert.equal(ddb.calls.length, 0);
  });

  test('CORS echoes an allowed origin and falls back to the first for any other', async () => {
    const { handler } = make();
    const ok = await handler(ev({ origin: 'capacitor://app.beanies.family' }));
    assert.equal(ok.headers['Access-Control-Allow-Origin'], 'capacitor://app.beanies.family');
    const other = await handler(ev({ origin: 'https://evil.example' }));
    assert.equal(other.headers['Access-Control-Allow-Origin'], 'https://app.beanies.family');
  });

  test('CORS default list is the PWA origin when CORS_ORIGINS is unset', async () => {
    const { handler } = make({ env: { CORS_ORIGINS: '' } });
    const res = await handler(ev({ origin: 'https://evil.example' }));
    assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://app.beanies.family');
  });

  test('an unknown route is 404 not_found and touches nothing', async () => {
    const { handler, ddb, provider } = make();
    const res = await handler(ev({ routeKey: 'POST /place-search/details' }));
    assertCode(res, 'not_found');
    assert.equal(ddb.calls.length, 0);
    assert.equal(provider.calls.suggest.length + provider.calls.resolve.length, 0);
    assert.equal(requestLines(logs())[0].outcome, 'not_found');
  });

  test('a non-POST method on a route is 405', async () => {
    const { handler } = make();
    assertCode(await handler(ev({ method: 'GET' })), 'method_not_allowed');
  });

  test('suggest success: the beanies shape, one request line with the agreed fields', async () => {
    const { handler, provider } = make();
    const res = await handler(ev());
    assert.equal(res.statusCode, 200);
    assert.deepEqual(json(res), {
      suggestions: [
        {
          placeId: 'ChIJplace1',
          main: '127 South Bridge Road',
          secondary: 'Singapore',
          kind: 'address',
        },
      ],
    });
    assert.equal(provider.calls.suggest.length, 1);
    const [line] = requestLines(logs());
    assert.deepEqual(Object.keys(line).sort(), [
      'count',
      'msg',
      'outcome',
      'provider_ms',
      'q_len',
      'route',
      'status',
    ]);
    assert.equal(line.route, 'suggest');
    assert.equal(line.outcome, 'provider_ok');
    assert.equal(line.count, 1);
    assert.equal(line.q_len, '127 south bridge road'.length);
    assert.equal(typeof line.provider_ms, 'number');
  });

  test('suggest with no results is a 200 empty list, logged provider_empty', async () => {
    const { handler } = make({ provider: fakeProvider({ suggest: () => ({ suggestions: [] }) }) });
    const res = await handler(ev());
    assert.deepEqual(json(res), { suggestions: [] });
    assert.equal(requestLines(logs())[0].outcome, 'provider_empty');
  });

  test('resolve success echoes the validated place id with the address', async () => {
    const { handler, provider } = make();
    const res = await handler(
      ev({ route: 'resolve', body: { placeId: 'ChIJplace1', lang: 'en' } })
    );
    assert.equal(res.statusCode, 200);
    assert.deepEqual(json(res), {
      placeId: 'ChIJplace1',
      address: '127 S Bridge Rd, Singapore 058285',
    });
    assert.equal(provider.calls.resolve.length, 1);
    assert.equal(requestLines(logs())[0].q_len, null);
  });
});

// ── Soft key ─────────────────────────────────────────────────────────────────────────────────

describe('soft key', () => {
  test('a missing or wrong x-api-key is 401 before the body is read or a token spent', async () => {
    const { handler, ddb, provider } = make();
    assertCode(await handler(ev({ key: null })), 'unauthorized');
    assertCode(await handler(ev({ key: 'nope', body: 'not json' })), 'unauthorized');
    assert.equal(ddb.calls.length, 0);
    assert.equal(provider.calls.suggest.length, 0);
  });

  test('an UNSET soft key refuses everything, even a request with no header', async () => {
    const { handler } = make({ env: { PLACE_SEARCH_API_KEY: '' } });
    assertCode(await handler(ev({ key: null })), 'unauthorized');
    assertCode(await handler(ev({ key: '' })), 'unauthorized');
  });
});

// ── Validation ───────────────────────────────────────────────────────────────────────────────

describe('validation', () => {
  test('the 1 KB body cap answers too_large; a non-object body is bad_request', async () => {
    const { handler } = make();
    assertCode(await handler(ev({ body: { q: 'x'.repeat(1100) } })), 'too_large');
    assertCode(await handler(ev({ body: 'not json' })), 'bad_request');
    assertCode(await handler(ev({ body: '[1,2]' })), 'bad_request');
  });

  const badQueries = [
    ['missing', undefined],
    ['not a string', 42],
    ['too short after trim', '  ab  '],
    ['too long', 'a'.repeat(201)],
    ['a link', 'https://zoom.us/j/123'],
    ['a scheme without http', 'zoommtg://zoom.us/join'],
    ['an email', 'greg@example.com'],
    ['an email mid-text', 'meet at bob@mail.example.org lobby'],
    ['a line break', '127 south bridge\nroad'],
    ['a carriage return', '127 south bridge\rroad'],
    ['a trailing newline', '127 south bridge road\n'],
    ['a unicode line separator', '127 south\u2028bridge'],
  ];
  for (const [name, q] of badQueries) {
    test(`q refused with bad_query: ${name}`, async () => {
      const { handler, ddb, provider } = make();
      assertCode(await handler(ev({ body: { q, lang: 'en' } })), 'bad_query');
      assert.equal(ddb.calls.length, 0, 'no token spent on a refused query');
      assert.equal(provider.calls.suggest.length, 0);
    });
  }

  test('q is trimmed; 3 and 200 characters are accepted; a bare @ is fine', () => {
    assert.equal(normaliseQuery('  abc  '), 'abc');
    assert.equal(normaliseQuery('a'.repeat(200)), 'a'.repeat(200));
    assert.equal(normaliseQuery('Lunch @ Main St.'), 'Lunch @ Main St.');
    assert.equal(
      normaliseQuery('Blk 293 Yishun Street 22 #05-12'),
      'Blk 293 Yishun Street 22 #05-12'
    );
  });

  test('lang: allowlisted tags pass (case-normalised), others fall back, never refused', () => {
    assert.equal(normaliseLang('en'), 'en');
    assert.equal(normaliseLang('zh-cn'), 'zh-CN');
    assert.equal(normaliseLang('zh_TW'), 'zh-TW');
    assert.equal(normaliseLang('en-US'), 'en');
    assert.equal(normaliseLang('fr-CA'), 'fr');
    assert.equal(normaliseLang('zh-Hans'), 'zh');
    assert.equal(normaliseLang('xx'), 'en');
    assert.equal(normaliseLang('"><script>'), 'en');
    assert.equal(normaliseLang(undefined), 'en');
    assert.equal(normaliseLang(7), 'en');
    assert.equal(normaliseLang('e'.repeat(40)), 'en');
  });

  test('an unlisted lang still succeeds, and only the allowlisted value reaches the adapter', async () => {
    const { handler, provider } = make();
    const res = await handler(ev({ body: { q: 'Marina Bay Sands', lang: 'tlh-KLINGON' } }));
    assert.equal(res.statusCode, 200);
    assert.equal(provider.calls.suggest[0].lang, 'en');
  });

  test('bias is range-checked and re-rounded to 2 decimals on the server', async () => {
    const { handler, provider } = make();
    await handler(
      ev({
        body: {
          q: '127 south bridge',
          lang: 'en',
          bias: { lat: 1.2894567, lon: 103.8512345, countryCode: 'sg' },
        },
      })
    );
    assert.deepEqual(provider.calls.suggest[0].bias, { lat: 1.29, lon: 103.85, countryCode: 'SG' });
  });

  test('bias: absent or null means no bias; countryCode optional', () => {
    assert.deepEqual(normaliseBias(undefined), { ok: true });
    assert.deepEqual(normaliseBias(null), { ok: true });
    assert.deepEqual(normaliseBias({ lat: -33.868, lon: 151.209 }), {
      ok: true,
      bias: { lat: -33.87, lon: 151.21 },
    });
  });

  const badBiases = [
    ['lat out of range', { lat: 91, lon: 0 }],
    ['lon out of range', { lat: 0, lon: -180.5 }],
    ['lat a string', { lat: '1.29', lon: 103.85 }],
    ['lon missing', { lat: 1.29 }],
    ['NaN encoded as null', { lat: null, lon: 1 }],
    ['country of three letters', { lat: 1, lon: 1, countryCode: 'SGP' }],
    ['country with a digit', { lat: 1, lon: 1, countryCode: 'S1' }],
    ['country not a string', { lat: 1, lon: 1, countryCode: 65 }],
    ['an array', [1, 2]],
    ['a string', '1.29,103.85'],
  ];
  for (const [name, bias] of badBiases) {
    test(`bias refused with bad_bias: ${name}`, async () => {
      const { handler, provider } = make();
      assertCode(await handler(ev({ body: { q: 'Marina Bay', lang: 'en', bias } })), 'bad_bias');
      assert.equal(provider.calls.suggest.length, 0);
    });
  }

  const badPlaceIds = [
    ['missing', undefined],
    ['empty', ''],
    ['too long', 'a'.repeat(513)],
    ['a slash', 'ChIJ/../x'],
    ['a space', 'ChIJ abc'],
    ['a query string', 'ChIJabc?key=1'],
    ['not a string', 12345],
  ];
  for (const [name, placeId] of badPlaceIds) {
    test(`resolve refused with bad_place_id: ${name}`, async () => {
      const { handler, provider, ddb } = make();
      const res = await handler(ev({ route: 'resolve', body: { placeId, lang: 'en' } }));
      assertCode(res, 'bad_place_id');
      assert.equal(provider.calls.resolve.length, 0);
      assert.equal(ddb.calls.length, 0);
    });
  }

  test('a 512-character place id with - and _ is accepted', async () => {
    const { handler } = make();
    const placeId = `Ch-_${'a'.repeat(508)}`;
    const res = await handler(ev({ route: 'resolve', body: { placeId, lang: 'en' } }));
    assert.equal(res.statusCode, 200);
  });

  test('unknown body fields never reach the adapter (only q, lang, bias / placeId, lang)', async () => {
    const { handler, provider } = make();
    await handler(
      ev({
        body: {
          q: 'Marina Bay',
          lang: 'en',
          input: 'something else',
          key: 'k',
          fieldMask: '*',
          includedPrimaryTypes: ['x'],
          bias: { lat: 1, lon: 2, radius: 999999, extra: 1 },
        },
      })
    );
    const args = provider.calls.suggest[0];
    assert.deepEqual(Object.keys(args).sort(), [
      'apiKey',
      'bias',
      'fetchImpl',
      'lang',
      'q',
      'signal',
    ]);
    assert.deepEqual(args.bias, { lat: 1, lon: 2 });
    await handler(
      ev({ route: 'resolve', body: { placeId: 'ChIJx', lang: 'en', fields: '*', key: 'k' } })
    );
    assert.deepEqual(Object.keys(provider.calls.resolve[0]).sort(), [
      'apiKey',
      'fetchImpl',
      'lang',
      'placeId',
      'signal',
    ]);
  });
});

// ── Answer caps ──────────────────────────────────────────────────────────────────────────────

describe('answer caps', () => {
  test('at most 5 suggestions, 200 characters a string, malformed rows dropped', async () => {
    const long = 'x'.repeat(300);
    const rows = [
      { placeId: 'bad id with spaces', main: 'dropped', secondary: '' },
      { placeId: 'ChIJ1', main: '', secondary: 'dropped: empty main' },
      { placeId: 'ChIJ2', main: long, secondary: long },
      { placeId: 'ChIJ3', main: 'three' },
      { placeId: 'ChIJ4', main: 'four', secondary: 4 },
      { placeId: 'ChIJ5', main: 'five', secondary: 's' },
      { placeId: 'ChIJ6', main: 'six', secondary: 's' },
      { placeId: 'ChIJ7', main: 'seven', secondary: 's' },
    ];
    const { handler } = make({
      provider: fakeProvider({ suggest: () => ({ suggestions: rows }) }),
    });
    const { suggestions } = json(await handler(ev()));
    assert.equal(suggestions.length, MAX_SUGGESTIONS);
    assert.deepEqual(
      suggestions.map((s) => s.placeId),
      ['ChIJ2', 'ChIJ3', 'ChIJ4', 'ChIJ5', 'ChIJ6']
    );
    assert.equal(suggestions[0].main.length, MAX_TEXT_CHARS);
    assert.equal(suggestions[0].secondary.length, MAX_TEXT_CHARS);
    assert.equal(suggestions[1].secondary, '');
    assert.equal(suggestions[2].secondary, '');
    for (const s of suggestions) {
      assert.deepEqual(Object.keys(s), ['placeId', 'main', 'secondary', 'kind']);
    }
    assert.equal(requestLines(logs())[0].count, 5);
  });

  test('kind passes through only as place or address; anything else is an address', async () => {
    const rows = [
      { placeId: 'ChIJ1', main: 'one', secondary: '', kind: 'place' },
      { placeId: 'ChIJ2', main: 'two', secondary: '', kind: 'address' },
      { placeId: 'ChIJ3', main: 'three', secondary: '' },
      { placeId: 'ChIJ4', main: 'four', secondary: '', kind: 'establishment' },
      { placeId: 'ChIJ5', main: 'five', secondary: '', kind: ['place'] },
    ];
    const { handler } = make({
      provider: fakeProvider({ suggest: () => ({ suggestions: rows }) }),
    });
    const { suggestions } = json(await handler(ev()));
    assert.deepEqual(
      suggestions.map((s) => s.kind),
      ['place', 'address', 'address', 'address', 'address']
    );
  });

  test('clipping never leaves half a surrogate pair', async () => {
    const main = `${'a'.repeat(199)}😀tail`;
    const { handler } = make({
      provider: fakeProvider({ suggest: () => ({ suggestions: [{ placeId: 'ChIJ1', main }] }) }),
    });
    const { suggestions } = json(await handler(ev()));
    assert.equal(suggestions[0].main, 'a'.repeat(199));
  });

  test('the resolved address is clipped to 200 characters', async () => {
    const { handler } = make({
      provider: fakeProvider({ resolve: () => ({ address: 'y'.repeat(260) }) }),
    });
    const res = await handler(ev({ route: 'resolve', body: { placeId: 'ChIJ1', lang: 'en' } }));
    assert.equal(json(res).address.length, MAX_TEXT_CHARS);
  });

  test('a 200 answer in the wrong shape is upstream_http, never an empty list', async () => {
    for (const [route, provider, body] of [
      ['suggest', fakeProvider({ suggest: () => ({ suggestions: 'nope' }) }), undefined],
      ['suggest', fakeProvider({ suggest: () => null }), undefined],
      [
        'resolve',
        fakeProvider({ resolve: () => ({ address: '' }) }),
        { placeId: 'ChIJ1', lang: 'en' },
      ],
      ['resolve', fakeProvider({ resolve: () => ({}) }), { placeId: 'ChIJ1', lang: 'en' }],
    ]) {
      const { handler } = make({ provider });
      const res = await handler(ev({ route, ...(body ? { body } : {}) }));
      assertCode(res, 'upstream_http');
    }
    const lines = requestLines(logs());
    assert.ok(lines.every((l) => l.reason === 'bad_shape' && typeof l.provider_ms === 'number'));
  });
});

// ── Per-IP limit ─────────────────────────────────────────────────────────────────────────────

describe('per-IP hourly limit', () => {
  test('IP_LIMIT requests pass, the next is 429 with retryAfterSeconds to the hour', async () => {
    const { handler, ddb } = make({ env: { IP_LIMIT: '3' } });
    for (let i = 0; i < 3; i++) assert.equal((await handler(ev())).statusCode, 200);
    const res = await handler(ev());
    assertCode(res, 'rate_limited');
    assert.equal(json(res).retryAfterSeconds, 3600);
    // A different address still passes.
    assert.equal((await handler(ev({ ip: '198.51.100.9' }))).statusCode, 200);
    assert.ok(
      ddb.keys().every((k) => !k.includes('203.0.113.7')),
      'the raw IP is never a key'
    );
  });

  test('suggest and resolve share one per-IP bucket', async () => {
    const { handler } = make({ env: { IP_LIMIT: '2' } });
    await handler(ev());
    await handler(ev({ route: 'resolve', body: { placeId: 'ChIJ1', lang: 'en' } }));
    assertCode(await handler(ev()), 'rate_limited');
  });

  test('IPv6 addresses in one /64 share a bucket', async () => {
    const { handler } = make({ env: { IP_LIMIT: '1' } });
    await handler(ev({ ip: '2001:db8:1:2::1' }));
    assertCode(await handler(ev({ ip: '2001:db8:1:2::ffff' })), 'rate_limited');
  });

  test('the default IP_LIMIT is 60 an hour', async () => {
    const { handler } = make({ env: { DAILY_SUGGEST_CAP: '1000' } });
    for (let i = 0; i < 60; i++) assert.equal((await handler(ev())).statusCode, 200);
    assertCode(await handler(ev()), 'rate_limited');
  });

  test('a per-IP store fault ALLOWS the request and logs the alarmed store prefix', async () => {
    const ddb = fakeDdb();
    ddb.failOn((op, input) => input.Key.pk.S.startsWith('i#'));
    const { handler, provider } = make({ ddb });
    const res = await handler(ev());
    assert.equal(res.statusCode, 200);
    assert.equal(provider.calls.suggest.length, 1);
    const lines = errorsWith(ALARMING_PREFIXES.rateStoreUnavailable);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /kind=ip/);
    assert.match(lines[0], new RegExp(TABLE));
    assert.match(lines[0], /dynamodb:UpdateItem/);
  });
});

// ── Daily caps ───────────────────────────────────────────────────────────────────────────────

describe('global daily caps', () => {
  test('DAILY_SUGGEST_CAP calls pass, the next is budget_exhausted with time to UTC midnight', async () => {
    const { handler, provider, ddb } = make({ env: { DAILY_SUGGEST_CAP: '2' } });
    assert.equal((await handler(ev({ ip: '192.0.2.1' }))).statusCode, 200);
    assert.equal((await handler(ev({ ip: '192.0.2.2' }))).statusCode, 200);
    const res = await handler(ev({ ip: '192.0.2.3' }));
    assertCode(res, 'budget_exhausted');
    assert.equal(json(res).retryAfterSeconds, 12 * 3600);
    assert.equal(provider.calls.suggest.length, 2);
    const lines = errorsWith(ALARMING_PREFIXES.budgetExhausted);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /kind=suggest cap=2/);
    assert.ok(ddb.keys().includes('gs#2026-12-01'));
  });

  test('suggest and resolve spend SEPARATE day counters', async () => {
    const { handler, ddb } = make({ env: { DAILY_SUGGEST_CAP: '1', DAILY_RESOLVE_CAP: '1' } });
    const resolve = () => ev({ route: 'resolve', body: { placeId: 'ChIJ1', lang: 'en' } });
    assert.equal((await handler(ev())).statusCode, 200);
    assert.equal((await handler(resolve())).statusCode, 200);
    assertCode(await handler(ev()), 'budget_exhausted');
    assertCode(await handler(resolve()), 'budget_exhausted');
    assert.ok(ddb.keys().includes('gs#2026-12-01'));
    assert.ok(ddb.keys().includes('gr#2026-12-01'));
    assert.match(errorsWith(ALARMING_PREFIXES.budgetExhausted)[1], /kind=resolve cap=1/);
  });

  test('the default caps are 650 suggest and 320 resolve', async () => {
    const ddb = fakeDdb();
    ddb.items.set('gs#2026-12-01', { n: { N: '649' } });
    ddb.items.set('gr#2026-12-01', { n: { N: '319' } });
    const { handler } = make({ ddb });
    const resolve = () => ev({ route: 'resolve', body: { placeId: 'ChIJ1', lang: 'en' } });
    assert.equal((await handler(ev())).statusCode, 200);
    assertCode(await handler(ev()), 'budget_exhausted');
    assert.equal((await handler(resolve())).statusCode, 200);
    assertCode(await handler(resolve()), 'budget_exhausted');
  });

  test('the cap resets on the next UTC day', async () => {
    const ddb = fakeDdb();
    const day1 = make({ env: { DAILY_SUGGEST_CAP: '1' }, ddb });
    await day1.handler(ev());
    assertCode(await day1.handler(ev()), 'budget_exhausted');
    const day2 = make({ env: { DAILY_SUGGEST_CAP: '1' }, ddb, now: NOW + 86_400_000 });
    assert.equal((await day2.handler(ev())).statusCode, 200);
  });

  for (const route of ['suggest', 'resolve']) {
    const body = route === 'resolve' ? { placeId: 'ChIJ1', lang: 'en' } : undefined;

    test(`${route}: an UNSET table refuses with budget_unavailable and logs the alarmed prefix`, async () => {
      const { handler, provider } = make({ env: { COUNTER_TABLE: '' } });
      const res = await handler(ev({ route, ...(body ? { body } : {}) }));
      assertCode(res, 'budget_unavailable');
      assert.equal(json(res).retryAfterSeconds, 300);
      assert.equal(provider.calls.suggest.length + provider.calls.resolve.length, 0);
      const lines = errorsWith(ALARMING_PREFIXES.rateStoreUnavailable);
      assert.equal(lines.length, 1);
      assert.match(lines[0], new RegExp(`kind=${route} reason=table_unset`));
      assert.match(lines[0], /COUNTER_TABLE/);
      assert.match(lines[0], /dynamodb:UpdateItem/);
    });

    test(`${route}: a counter fault refuses with budget_unavailable and logs the alarmed prefix`, async () => {
      const ddb = fakeDdb();
      ddb.failOn((op, input) => input.Key.pk.S.startsWith(route === 'suggest' ? 'gs#' : 'gr#'));
      const { handler, provider } = make({ ddb });
      const res = await handler(ev({ route, ...(body ? { body } : {}) }));
      assertCode(res, 'budget_unavailable');
      assert.equal(provider.calls.suggest.length + provider.calls.resolve.length, 0);
      const lines = errorsWith(ALARMING_PREFIXES.rateStoreUnavailable);
      assert.equal(lines.length, 1);
      assert.match(lines[0], new RegExp(`kind=${route}: refusing`));
      assert.match(lines[0], new RegExp(TABLE));
      assert.match(lines[0], /dynamodb:UpdateItem/);
    });
  }

  test('a malformed cap env value warns and uses the default', async () => {
    make({ env: { DAILY_SUGGEST_CAP: 'lots' } });
    assert.ok(
      logs().warn.some((l) => l.includes('DAILY_SUGGEST_CAP is not a positive integer; using 650'))
    );
  });
});

// ── Provider failures ────────────────────────────────────────────────────────────────────────

describe('provider failures', () => {
  test('an unset provider key is upstream_auth with the alarmed prefix, before a day token', async () => {
    const { handler, ddb, provider } = make({ env: { PLACE_PROVIDER_API_KEY: '' } });
    assertCode(await handler(ev()), 'upstream_auth');
    assert.equal(provider.calls.suggest.length, 0);
    assert.ok(!ddb.keys().some((k) => k.startsWith('gs#')), 'no day token spent');
    const lines = errorsWith(ALARMING_PREFIXES.providerAuthFailed);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /reason=key_unset/);
  });

  const cases = [
    ['upstream_auth', ALARMING_PREFIXES.providerAuthFailed, 'error'],
    ['upstream_rate_limited', ALARMING_PREFIXES.providerRateLimited, 'error'],
    ['upstream_timeout', '[place-search] provider error', 'warn'],
    ['upstream_network', '[place-search] provider error', 'warn'],
    ['upstream_unavailable', '[place-search] provider error', 'warn'],
    ['upstream_http', '[place-search] provider error', 'warn'],
  ];
  for (const [code, prefix, level] of cases) {
    for (const route of ['suggest', 'resolve']) {
      test(`${route}: ProviderError ${code} answers ${code} and logs ${prefix}`, async () => {
        const boom = () => {
          throw new FakeProviderError(code, { httpStatus: 418, reason: 'zero_results' });
        };
        const { handler } = make({ provider: fakeProvider({ suggest: boom, resolve: boom }) });
        const body = route === 'resolve' ? { placeId: 'ChIJ1', lang: 'en' } : undefined;
        const res = await handler(ev({ route, ...(body ? { body } : {}) }));
        assertCode(res, code);
        const lines = logs()[level].filter((l) => l.includes(prefix));
        assert.equal(lines.length, 1);
        assert.match(lines[0], new RegExp(`route=${route}`));
        assert.match(lines[0], /http_status=418/);
        const [line] = requestLines(logs());
        assert.equal(line.outcome, 'provider_error');
        assert.equal(line.code, code);
        assert.equal(line.reason, 'zero_results');
        assert.equal(typeof line.provider_ms, 'number');
      });
    }
  }

  test('the provider gets a signal bounded by the time the invocation has left', async () => {
    const { handler, provider } = make();
    await handler(ev(), { getRemainingTimeInMillis: () => 9000 });
    assert.ok(provider.calls.suggest[0].signal instanceof AbortSignal);
    assert.equal(provider.calls.suggest[0].apiKey, 'provider-SECRET-key-123');
  });
});

// ── The outer catch ──────────────────────────────────────────────────────────────────────────

describe('the outer catch', () => {
  test('an adapter that throws something other than ProviderError is internal_error, alarmed', async () => {
    const { handler } = make({
      provider: fakeProvider({
        suggest: () => {
          throw new TypeError('adapter bug');
        },
      }),
    });
    const res = await handler(ev());
    assertCode(res, 'internal_error');
    assert.equal(res.headers['Access-Control-Allow-Origin'], 'https://app.beanies.family');
    const lines = errorsWith(ALARMING_PREFIXES.internalError);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /route=suggest: TypeError: adapter bug/);
    assert.equal(requestLines(logs())[0].outcome, 'internal_error');
  });

  test('a throw anywhere in the handler (here: the Lambda context) is internal_error', async () => {
    const { handler } = make();
    const res = await handler(ev(), {
      getRemainingTimeInMillis() {
        throw new RangeError('context broke');
      },
    });
    assertCode(res, 'internal_error');
    assert.equal(errorsWith(ALARMING_PREFIXES.internalError).length, 1);
  });

  test('a store that throws a programming error is caught too', async () => {
    const ddb = {
      commands: {},
      send: async () => {
        throw new Error('unreachable');
      },
    };
    // `commands` has no UpdateItemCommand, so countOne throws a TypeError inside the store's try:
    // the ip kind fails open (logged), and the day kind fails closed.
    const { handler } = make({ ddb });
    assertCode(await handler(ev()), 'budget_unavailable');
  });
});

// ── Wiring ───────────────────────────────────────────────────────────────────────────────────

describe('index.mjs wiring', () => {
  test('ALARMING_PREFIXES are the five agreed strings', () => {
    assert.deepEqual(Object.values(ALARMING_PREFIXES).sort(), [
      '[place-search] daily budget exhausted',
      '[place-search] internal error',
      '[place-search] provider auth FAILED',
      '[place-search] provider rate limited',
      '[place-search] rate-limit store unavailable',
    ]);
    assert.ok(Object.isFrozen(ALARMING_PREFIXES));
  });

  test('index.mjs wires the real adapter and re-exports the contract', async () => {
    const index = await import('../index.mjs');
    const real = await import('../providers/google.mjs');
    assert.equal(index.ERROR_CODES, ERROR_CODES);
    assert.equal(index.ALARMING_PREFIXES, ALARMING_PREFIXES);
    assert.equal(typeof index.handler, 'function');
    assert.equal((await index.handler(ev({ method: 'OPTIONS' }))).statusCode, 204);
    for (const code of real.PROVIDER_ERROR_CODES) {
      assert.ok(ERROR_CODES.includes(code), `adapter code ${code} has no HTTP mapping`);
    }
    // No table in this process env: the real wiring fails CLOSED rather than uncapped.
    __setDdbClientForTests(fakeDdb());
    assert.equal(json(await index.handler(ev())).code, 'budget_unavailable');
  });
});
