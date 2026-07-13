/* global process */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const API_KEY = 'test-key';
const originalLog = console.log;
const originalError = console.error;

function makeEvent({
  method = 'POST',
  headers = {},
  body,
  queryStringParameters,
  origin = 'https://beanies.family',
} = {}) {
  return {
    requestContext: { http: { method } },
    headers: { origin, ...headers },
    queryStringParameters,
    body: body === undefined ? '{}' : typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function parseResponse(result) {
  return {
    ...result,
    parsedBody: result.body ? JSON.parse(result.body) : null,
  };
}

describe('Telemetry Lambda handler', () => {
  let handler;
  let ALLOWED_CONTEXT_KEYS;
  let logs;

  beforeEach(async () => {
    process.env.LOG_INGEST_API_KEY = API_KEY;
    process.env.CORS_ORIGINS = 'https://beanies.family,http://localhost:5173';
    logs = [];
    console.log = (...args) => logs.push(args.join(' '));
    const mod = await import(`../index.mjs?t=${Date.now()}-${Math.random()}`);
    handler = mod.handler;
    ALLOWED_CONTEXT_KEYS = mod.ALLOWED_CONTEXT_KEYS;
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
    delete process.env.LOG_INGEST_API_KEY;
    delete process.env.CORS_ORIGINS;
  });

  const keyHeader = { 'x-api-key': API_KEY };
  const sampleEvent = {
    level: 'warn',
    surface: 'silent-refresh',
    message: 'token refresh failed',
    timestamp: '2026-05-20T03:00:00.000Z',
    family_id: 'fam-uuid',
    build_sha: 'abc123',
  };

  describe('method + auth', () => {
    it('returns 405 for GET', async () => {
      const res = parseResponse(await handler(makeEvent({ method: 'GET', headers: keyHeader })));
      assert.equal(res.statusCode, 405);
    });

    it('returns 204 for OPTIONS preflight', async () => {
      const res = await handler(makeEvent({ method: 'OPTIONS' }));
      assert.equal(res.statusCode, 204);
    });

    it('returns 401 with no api key', async () => {
      const res = parseResponse(await handler(makeEvent({ body: { events: [sampleEvent] } })));
      assert.equal(res.statusCode, 401);
    });

    it('returns 401 with a wrong api key', async () => {
      const res = parseResponse(
        await handler(
          makeEvent({ headers: { 'x-api-key': 'nope' }, body: { events: [sampleEvent] } })
        )
      );
      assert.equal(res.statusCode, 401);
    });

    it('accepts the key via ?k= query param (beacon path)', async () => {
      const res = parseResponse(
        await handler(
          makeEvent({ queryStringParameters: { k: API_KEY }, body: { events: [sampleEvent] } })
        )
      );
      assert.equal(res.statusCode, 200);
      assert.equal(res.parsedBody.count, 1);
    });
  });

  describe('ingest', () => {
    it('writes one beanlog JSON line per valid event', async () => {
      const res = parseResponse(
        await handler(makeEvent({ headers: keyHeader, body: { events: [sampleEvent] } }))
      );
      assert.equal(res.statusCode, 200);
      assert.equal(res.parsedBody.count, 1);
      assert.equal(logs.length, 1);
      const parsed = JSON.parse(logs[0]);
      assert.equal(parsed.t, 'beanlog');
      assert.equal(parsed.v, 1);
      assert.equal(parsed.surface, 'silent-refresh');
      assert.equal(parsed.family_id, 'fam-uuid');
    });

    it('stamps t first and v server-side, ignoring client-sent t/v', async () => {
      const res = parseResponse(
        await handler(
          makeEvent({
            headers: keyHeader,
            body: { events: [{ ...sampleEvent, t: 'spoofed', v: 999 }] },
          })
        )
      );
      assert.equal(res.statusCode, 200);
      const line = logs[0];
      assert.ok(line.startsWith('{"t":"beanlog"'), 'line must start with t:"beanlog"');
      const parsed = JSON.parse(line);
      assert.equal(parsed.v, 1);
    });

    it('strips non-allowlisted keys and family_email (PII-free firehose)', async () => {
      const res = parseResponse(
        await handler(
          makeEvent({
            headers: keyHeader,
            body: {
              events: [
                {
                  ...sampleEvent,
                  memberName: 'Alice',
                  transactionAmount: 100,
                  family_email: 'leaked@example.com',
                },
              ],
            },
          })
        )
      );
      assert.equal(res.statusCode, 200);
      const parsed = JSON.parse(logs[0]);
      assert.equal(parsed.memberName, undefined);
      assert.equal(parsed.transactionAmount, undefined);
      assert.equal(parsed.family_email, undefined);
    });

    it('preserves system fields', async () => {
      await handler(makeEvent({ headers: keyHeader, body: { events: [sampleEvent] } }));
      const parsed = JSON.parse(logs[0]);
      assert.equal(parsed.level, 'warn');
      assert.equal(parsed.message, 'token refresh failed');
      assert.equal(parsed.timestamp, '2026-05-20T03:00:00.000Z');
    });

    it('coerces an invalid level to info', async () => {
      await handler(
        makeEvent({ headers: keyHeader, body: { events: [{ ...sampleEvent, level: 'bogus' }] } })
      );
      assert.equal(JSON.parse(logs[0]).level, 'info');
    });
  });

  describe('validation (never 500 on bad input)', () => {
    it('returns 400 on malformed JSON', async () => {
      const res = parseResponse(
        await handler(makeEvent({ headers: keyHeader, body: '{not json' }))
      );
      assert.equal(res.statusCode, 400);
    });

    it('returns 400 when body is not { events: [...] }', async () => {
      const res = parseResponse(await handler(makeEvent({ headers: keyHeader, body: { foo: 1 } })));
      assert.equal(res.statusCode, 400);
    });

    it('returns 200 count 0 for an empty batch', async () => {
      const res = parseResponse(
        await handler(makeEvent({ headers: keyHeader, body: { events: [] } }))
      );
      assert.equal(res.statusCode, 200);
      assert.equal(res.parsedBody.count, 0);
    });

    it('returns 400 when too many events', async () => {
      const events = Array.from({ length: 101 }, () => sampleEvent);
      const res = parseResponse(await handler(makeEvent({ headers: keyHeader, body: { events } })));
      assert.equal(res.statusCode, 400);
    });
  });

  describe('allowlist drift guard', () => {
    // Pins the server-side allowlist. If a context key is added to the client
    // (src/utils/diagnosticContext.ts) it MUST be mirrored here or this fails.
    // `family_email` is intentionally absent — the firehose is PII-free.
    it('matches the expected key set exactly', () => {
      const expected = [
        'action',
        'breadcrumbs',
        'browser',
        'build_sha',
        'cache_persist_error',
        'cache_persist_kind',
        'component',
        'connection_type',
        'context_build_error',
        'drive_file_not_found',
        'error_code',
        'family_id',
        'family_name',
        'file_id_tail',
        'from_path',
        'http_status',
        'incr_chunk_count',
        'incr_dirty',
        'incr_phase',
        'incr_reason',
        'incr_seq',
        'invite_token_tail',
        'member_id_tail',
        'online',
        'os',
        'page_hidden_for_ms',
        'provider_type',
        'refresh_token_age_ms',
        'route_name',
        'route_path',
        'save_failure_level',
        'severity',
        'silent_refresh_attempts',
        'silent_refresh_consecutive_failures',
        'silent_refresh_had_refresh_token',
        'visibility_state',
        'vue_info',
        'web_storage',
      ];
      assert.deepEqual([...ALLOWED_CONTEXT_KEYS].sort(), expected);
      assert.equal(ALLOWED_CONTEXT_KEYS.has('family_email'), false);
    });
  });
});
