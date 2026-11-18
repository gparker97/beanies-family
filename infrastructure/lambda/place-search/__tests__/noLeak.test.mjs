/**
 * The logging promise, end to end: the REAL Google adapter behind the real handler, over a fake
 * fetch, on every path (success and every error). No console line of any level may contain the
 * provider key, the soft key, the query, a place id (sent or returned), an address, a place's
 * name or types, the source IP, or any provider body text.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { createHandler } from '../createHandler.mjs';
import * as google from '../providers/google.mjs';
import {
  BASE_ENV,
  NOW,
  PROVIDER_KEY,
  SOFT_KEY,
  allLines,
  captureConsole,
  ev,
  fakeDdb,
  fakeResponse,
  requestLines,
} from './helpers.mjs';

const Q = 'zqxsentinel 42 lane';
const PLACE_ID = 'ChIJsentinelPlaceId';
const RETURNED_ID = 'ChIJreturnedSentinel';
const MAIN = 'ReturnedMainSentinel';
const ADDRESS = 'SentinelAddress 9, Singapore';
const TYPE = 'sentinel_type';
const BODY = 'BODYSENTINEL';
const IP = '203.0.113.77';

const SECRETS = [PROVIDER_KEY, SOFT_KEY, Q, PLACE_ID, RETURNED_ID, MAIN, ADDRESS, TYPE, BODY, IP];

const logs = captureConsole();

const json = (o) => () => fakeResponse(200, JSON.stringify(o));
const status = (code, text) => () => fakeResponse(code, text);
/** A body that echoes everything a careless log line might quote. */
const echo = `${BODY} ${Q} ${PLACE_ID} ${PROVIDER_KEY}`;

const suggestBody = { q: Q, lang: 'en', bias: { lat: 1.29, lon: 103.85, countryCode: 'SG' } };
const resolveBody = { placeId: PLACE_ID, lang: 'en' };

/**
 * [name, { route, body?, reply?, env?, ddb?(d), context?, fetchThrows? }]
 * `reply` answers the fake fetch; `ddb` prepares the fake store.
 */
const scenarios = [
  [
    'suggest ok',
    {
      route: 'suggest',
      reply: json({
        suggestions: [
          {
            placePrediction: {
              placeId: RETURNED_ID,
              structuredFormat: { mainText: { text: MAIN }, secondaryText: { text: ADDRESS } },
              types: [TYPE, 'establishment'],
            },
          },
        ],
      }),
    },
  ],
  ['suggest empty', { route: 'suggest', reply: json({}) }],
  [
    'resolve ok',
    { route: 'resolve', reply: json({ status: 'OK', results: [{ formatted_address: ADDRESS }] }) },
  ],

  ['suggest 401', { route: 'suggest', reply: status(401, echo) }],
  [
    'suggest 400 API_KEY_INVALID',
    {
      route: 'suggest',
      reply: status(
        400,
        JSON.stringify({
          error: {
            status: 'INVALID_ARGUMENT',
            message: echo,
            details: [{ reason: 'API_KEY_INVALID' }],
          },
        })
      ),
    },
  ],
  [
    'suggest 400 other',
    { route: 'suggest', reply: status(400, JSON.stringify({ error: { message: echo } })) },
  ],
  ['suggest 429', { route: 'suggest', reply: status(429, echo) }],
  ['suggest 500', { route: 'suggest', reply: status(500, echo) }],
  ['suggest 200 not json', { route: 'suggest', reply: status(200, `<html>${echo}`) }],
  ['suggest 200 bad shape', { route: 'suggest', reply: json({ suggestions: echo }) }],
  [
    'suggest network',
    { route: 'suggest', fetchThrows: () => new TypeError(`fetch failed ${echo}`) },
  ],
  // A real abort: the handler's floor of 1 s, then the adapter classifies it as a timeout.
  [
    'suggest timeout',
    { route: 'suggest', context: { getRemainingTimeInMillis: () => 0 }, waitForAbort: true },
  ],

  ['resolve 403', { route: 'resolve', reply: status(403, echo) }],
  ['resolve 500', { route: 'resolve', reply: status(500, echo) }],
  [
    'resolve REQUEST_DENIED',
    { route: 'resolve', reply: json({ status: 'REQUEST_DENIED', error_message: echo }) },
  ],
  [
    'resolve OVER_QUERY_LIMIT',
    { route: 'resolve', reply: json({ status: 'OVER_QUERY_LIMIT', error_message: echo }) },
  ],
  [
    'resolve ZERO_RESULTS',
    { route: 'resolve', reply: json({ status: 'ZERO_RESULTS', results: [] }) },
  ],
  ['resolve 200 not json', { route: 'resolve', reply: status(200, `{${echo}`) }],
  [
    'resolve OK without address',
    {
      route: 'resolve',
      reply: json({ status: 'OK', results: [{ formatted_address: 7 }], note: echo }),
    },
  ],
  [
    'resolve network (URL carries the key)',
    {
      route: 'resolve',
      fetchThrows: (init, url) => new TypeError(`Failed to fetch ${url} ${echo}`),
    },
  ],

  [
    'suggest ip store fault',
    {
      route: 'suggest',
      reply: json({}),
      ddb: (d) => d.failOn((op, i) => i.Key.pk.S.startsWith('i#')),
    },
  ],
  [
    'suggest day store fault',
    { route: 'suggest', ddb: (d) => d.failOn((op, i) => i.Key.pk.S.startsWith('gs#')) },
  ],
  [
    'resolve day store fault',
    { route: 'resolve', ddb: (d) => d.failOn((op, i) => i.Key.pk.S.startsWith('gr#')) },
  ],
  ['suggest table unset', { route: 'suggest', env: { COUNTER_TABLE: '' } }],
  ['resolve table unset', { route: 'resolve', env: { COUNTER_TABLE: '' } }],
  [
    'suggest budget exhausted',
    {
      route: 'suggest',
      env: { DAILY_SUGGEST_CAP: '1' },
      ddb: (d) => d.items.set('gs#2026-12-01', { n: { N: '1' } }),
    },
  ],
  [
    'resolve budget exhausted',
    {
      route: 'resolve',
      env: { DAILY_RESOLVE_CAP: '1' },
      ddb: (d) => d.items.set('gr#2026-12-01', { n: { N: '1' } }),
    },
  ],
  ['rate limited', { route: 'suggest', env: { IP_LIMIT: '1' }, preRequest: true, reply: json({}) }],
  ['provider key unset', { route: 'suggest', env: { PLACE_PROVIDER_API_KEY: '' } }],
  ['wrong soft key', { route: 'suggest', key: 'wrong' }],
  ['bad query (link + sentinel)', { route: 'suggest', body: { q: `https://${Q}`, lang: 'en' } }],
  ['bad query (line break)', { route: 'suggest', body: { q: `${Q}\nflat 2`, lang: 'en' } }],
  ['bad bias', { route: 'suggest', body: { q: Q, lang: 'en', bias: { lat: Q, lon: 1 } } }],
  ['bad place id', { route: 'resolve', body: { placeId: `${PLACE_ID}/x`, lang: 'en' } }],
  ['bad json body', { route: 'suggest', body: `{"q":"${Q}"` }],
  ['too large', { route: 'suggest', body: { q: Q, pad: `${BODY}${'x'.repeat(1100)}` } }],
  [
    'outer catch',
    {
      route: 'suggest',
      context: {
        getRemainingTimeInMillis() {
          throw new Error('context gone');
        },
      },
    },
  ],
];

/** The answer each path must produce, so a scenario cannot quietly test a different path. */
const EXPECTED = {
  'suggest ok': 200,
  'suggest empty': 200,
  'resolve ok': 200,
  'suggest 401': 'upstream_auth',
  'suggest 400 API_KEY_INVALID': 'upstream_auth',
  'suggest 400 other': 'upstream_http',
  'suggest 429': 'upstream_rate_limited',
  'suggest 500': 'upstream_unavailable',
  'suggest 200 not json': 'upstream_http',
  'suggest 200 bad shape': 'upstream_http',
  'suggest network': 'upstream_network',
  'suggest timeout': 'upstream_timeout',
  'resolve 403': 'upstream_auth',
  'resolve 500': 'upstream_unavailable',
  'resolve REQUEST_DENIED': 'upstream_auth',
  'resolve OVER_QUERY_LIMIT': 'upstream_rate_limited',
  'resolve ZERO_RESULTS': 'upstream_http',
  'resolve 200 not json': 'upstream_http',
  'resolve OK without address': 'upstream_http',
  'resolve network (URL carries the key)': 'upstream_network',
  'suggest ip store fault': 200,
  'suggest day store fault': 'budget_unavailable',
  'resolve day store fault': 'budget_unavailable',
  'suggest table unset': 'budget_unavailable',
  'resolve table unset': 'budget_unavailable',
  'suggest budget exhausted': 'budget_exhausted',
  'resolve budget exhausted': 'budget_exhausted',
  'rate limited': 'rate_limited',
  'provider key unset': 'upstream_auth',
  'wrong soft key': 'unauthorized',
  'bad query (link + sentinel)': 'bad_query',
  'bad query (line break)': 'bad_query',
  'bad bias': 'bad_bias',
  'bad place id': 'bad_place_id',
  'bad json body': 'bad_request',
  'too large': 'too_large',
  'outer catch': 'internal_error',
};

describe('no secret, query, place id, address, IP or provider body text in any log line', () => {
  for (const [name, s] of scenarios) {
    test(name, async () => {
      const ddb = fakeDdb();
      s.ddb?.(ddb);
      const fetchImpl = async (url, init) => {
        if (s.fetchThrows) throw s.fetchThrows(init, url);
        if (s.waitForAbort) {
          return new Promise((resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error(echo)));
          });
        }
        return (s.reply ?? json({}))(url, init);
      };
      const handler = createHandler({
        provider: google,
        env: { ...BASE_ENV, ...(s.env ?? {}) },
        now: () => NOW,
        fetchImpl,
        ddb,
      });
      const body = s.body ?? (s.route === 'resolve' ? resolveBody : suggestBody);
      const event = () => ev({ route: s.route, body, ip: IP, ...(s.key ? { key: s.key } : {}) });
      if (s.preRequest) await handler(event());
      const res = await handler(event(), s.context);
      const want = EXPECTED[name];
      if (want === 200) assert.equal(res.statusCode, 200, res.body);
      else assert.equal(JSON.parse(res.body).code, want);

      const lines = allLines(logs());
      assert.ok(lines.length > 0, 'every path logs something');
      for (const line of lines) {
        for (const secret of SECRETS) {
          assert.ok(!line.includes(secret), `"${name}" logged ${secret}: ${line}`);
        }
      }
      assert.ok(requestLines(logs()).length >= 1, 'one structured request line');
    });
  }
});
