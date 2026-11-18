/**
 * Shared fakes for the place-search suites (not a test file: the `*.test.mjs` glob skips it).
 */

import { afterEach, beforeEach } from 'node:test';

class Cmd {
  constructor(input) {
    this.input = input;
  }
}
export class UpdateItemCommand extends Cmd {}

/**
 * In-memory DynamoDB speaking the one command this Lambda sends (UpdateItem through
 * `countOne`). An expression it does not know throws, so a store change the fake would
 * silently mis-model fails loudly instead.
 */
export function fakeDdb() {
  const items = new Map();
  const calls = [];
  let failing = null;
  const send = async (cmd) => {
    const op = cmd.constructor.name;
    calls.push({ op, input: cmd.input });
    if (failing?.(op, cmd.input)) {
      throw Object.assign(new Error('store down'), { name: 'ServiceUnavailable' });
    }
    if (op !== 'UpdateItemCommand') throw new Error(`fake ddb: unexpected command ${op}`);
    const { Key, UpdateExpression, ConditionExpression } = cmd.input;
    if (UpdateExpression !== 'ADD #n :one SET expires_at = :ttl') {
      throw new Error(`fake ddb: unknown update "${UpdateExpression}"`);
    }
    const pk = Key.pk.S;
    const cur = items.get(pk);
    const values = cmd.input.ExpressionAttributeValues;
    const n = Number(cur?.n?.N ?? 0);
    if (ConditionExpression !== undefined) {
      if (ConditionExpression !== 'attribute_not_exists(#n) OR #n < :max') {
        throw new Error(`fake ddb: unknown condition "${ConditionExpression}"`);
      }
      if (cur?.n !== undefined && !(n < Number(values[':max'].N))) {
        throw Object.assign(new Error('at limit'), { name: 'ConditionalCheckFailedException' });
      }
    }
    items.set(pk, { pk: { S: pk }, n: { N: String(n + 1) }, expires_at: values[':ttl'] });
    return {};
  };
  return {
    send,
    commands: { UpdateItemCommand },
    items,
    calls,
    keys: () => calls.map((c) => c.input.Key.pk.S),
    failOn(fn) {
      failing = fn;
    },
  };
}

/** Capture console output per test; `logs()` returns the current capture. */
export function captureConsole() {
  let logs = { log: [], warn: [], error: [] };
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
  });
  return () => logs;
}

/** Every console line of every level, one string each. */
export const allLines = (logs) => [...logs.log, ...logs.warn, ...logs.error];

/** Every structured request line. */
export function requestLines(logs) {
  return logs.log
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l))
    .filter((l) => l.msg === 'place-search');
}

export const json = (res) => (res.body ? JSON.parse(res.body) : null);

export const SOFT_KEY = 'soft-test-key';
export const PROVIDER_KEY = 'provider-SECRET-key-123';
export const TABLE = 'place-search-counters-test';
export const ORIGINS = 'https://app.beanies.family,capacitor://app.beanies.family';

export const BASE_ENV = Object.freeze({
  PLACE_SEARCH_API_KEY: SOFT_KEY,
  PLACE_PROVIDER_API_KEY: PROVIDER_KEY,
  CORS_ORIGINS: ORIGINS,
  COUNTER_TABLE: TABLE,
});

// 2026-12-01 12:00 UTC.
export const NOW = Date.parse('2026-12-01T12:00:00Z');

/** An API Gateway payload 2.0 event. */
export function ev({
  route = 'suggest',
  method = 'POST',
  body = { q: '127 south bridge road', lang: 'en' },
  key = SOFT_KEY,
  origin = 'https://app.beanies.family',
  ip = '203.0.113.7',
  routeKey,
} = {}) {
  const headers = { origin };
  if (key !== null) headers['x-api-key'] = key;
  return {
    routeKey: routeKey ?? `POST /place-search/${route}`,
    requestContext: { http: { method, sourceIp: ip } },
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

/** Same shape as the adapter's ProviderError, without importing the adapter. */
export class FakeProviderError extends Error {
  constructor(code, { httpStatus, reason } = {}) {
    super(code);
    this.name = 'ProviderError';
    this.code = code;
    if (httpStatus !== undefined) this.httpStatus = httpStatus;
    if (reason !== undefined) this.reason = reason;
  }
}

/** A fake adapter. `suggest` / `resolve` decide each answer. */
export function fakeProvider({
  suggest = () => ({
    suggestions: [{ placeId: 'ChIJplace1', main: '127 South Bridge Road', secondary: 'Singapore' }],
  }),
  resolve = () => ({ address: '127 S Bridge Rd, Singapore 058285' }),
} = {}) {
  const calls = { suggest: [], resolve: [] };
  return {
    calls,
    suggestPlaces: async (args) => {
      calls.suggest.push(args);
      return suggest(args);
    },
    resolvePlace: async (args) => {
      calls.resolve.push(args);
      return resolve(args);
    },
  };
}

/** A `Response`-like for a fake fetch. `text` is the raw body. */
export function fakeResponse(status, text) {
  return new Response(text, { status, headers: { 'Content-Type': 'application/json' } });
}
