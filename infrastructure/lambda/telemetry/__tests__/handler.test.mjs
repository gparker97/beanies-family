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

  describe('server-side Slack escalation (build-integrity)', () => {
    // The Lambda is the only client-error path to Slack. `boot-integrity` is why
    // the webhook lives in the Lambda env: a dev build on the cloud host ships no
    // client webhook, so the missing webhook IS the condition being reported.

    it('escalates an allowlisted surface to Slack', async () => {
      process.env.SLACK_ERROR_WEBHOOK_URL = 'https://hooks.slack.test/abc';
      const calls = [];
      const realFetch = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return { ok: true, status: 200 };
      };
      const mod = await import(`../index.mjs?t=${Date.now()}-esc1`);
      const res = await mod.handler(
        makeEvent({
          headers: keyHeader,
          body: {
            events: [
              {
                level: 'error',
                severity: 'critical',
                surface: 'boot-integrity',
                message: 'A dev/local build is live on the cloud host',
                timestamp: '2026-08-10T05:00:00.000Z',
                build_sha: 'dev',
              },
            ],
          },
        })
      );
      globalThis.fetch = realFetch;
      delete process.env.SLACK_ERROR_WEBHOOK_URL;

      assert.equal(res.statusCode, 200);
      assert.equal(calls.length, 1);
      assert.match(calls[0].body.text, /beanies critical/);
      assert.match(calls[0].body.text, /`boot-integrity`/);
      assert.match(calls[0].body.text, /dev/);
    });

    it('does NOT escalate ordinary surfaces', async () => {
      process.env.SLACK_ERROR_WEBHOOK_URL = 'https://hooks.slack.test/abc';
      let called = 0;
      const realFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        called++;
        return { ok: true, status: 200 };
      };
      const mod = await import(`../index.mjs?t=${Date.now()}-esc2`);
      await mod.handler(makeEvent({ headers: keyHeader, body: { events: [sampleEvent] } }));
      globalThis.fetch = realFetch;
      delete process.env.SLACK_ERROR_WEBHOOK_URL;

      assert.equal(called, 0);
    });

    it('still returns 200 (and keeps the log line) when Slack fails', async () => {
      // The CloudWatch record is the primary artifact; Slack is the notification.
      // A Slack outage must not 500 and make the client retry the whole batch.
      process.env.SLACK_ERROR_WEBHOOK_URL = 'https://hooks.slack.test/abc';
      const realFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        throw new Error('slack down');
      };
      console.error = () => {};
      const mod = await import(`../index.mjs?t=${Date.now()}-esc3`);
      const res = await mod.handler(
        makeEvent({
          headers: keyHeader,
          body: {
            events: [
              {
                level: 'error',
                severity: 'critical',
                surface: 'boot-integrity',
                message: 'x',
                timestamp: '2026-08-10T05:00:00.000Z',
              },
            ],
          },
        })
      );
      globalThis.fetch = realFetch;
      delete process.env.SLACK_ERROR_WEBHOOK_URL;

      assert.equal(res.statusCode, 200);
      assert.equal(JSON.parse(res.body).count, 1);
    });

    it('logs loudly rather than throwing when the webhook is unset', async () => {
      delete process.env.SLACK_ERROR_WEBHOOK_URL;
      const errs = [];
      console.error = (...a) => errs.push(a.join(' '));
      const mod = await import(`../index.mjs?t=${Date.now()}-esc4`);
      const res = await mod.handler(
        makeEvent({
          headers: keyHeader,
          body: {
            events: [
              {
                level: 'error',
                severity: 'critical',
                surface: 'boot-integrity',
                message: 'x',
                timestamp: '2026-08-10T05:00:00.000Z',
              },
            ],
          },
        })
      );
      assert.equal(res.statusCode, 200);
      assert.ok(errs.some((e) => e.includes('SLACK_ERROR_WEBHOOK_URL unset')));
    });
  });

  describe('paging policy (critical AND allowlisted)', () => {
    let calls;
    let realFetch;
    let mod;

    beforeEach(async () => {
      process.env.SLACK_ERROR_WEBHOOK_URL = 'https://hooks.slack.test/abc';
      process.env.AWS_REGION = 'ap-southeast-1';
      calls = [];
      realFetch = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return { ok: true, status: 200 };
      };
      mod = await import(`../index.mjs?t=${Date.now()}-${Math.random()}-policy`);
    });

    afterEach(() => {
      globalThis.fetch = realFetch;
      delete process.env.SLACK_ERROR_WEBHOOK_URL;
      delete process.env.AWS_REGION;
    });

    const critical = {
      level: 'error',
      severity: 'critical',
      surface: 'pod-merge',
      message: 'remote merge failed',
      timestamp: '2026-10-15T05:00:00.000Z',
      family_id: '3f1c2a4b-1111-2222-3333-abcdef123456',
      family_name: 'The Parkers',
      build_sha: '48c85de8a1b2c3d4',
      browser:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    };
    const send = (events) => mod.handler(makeEvent({ headers: keyHeader, body: { events } }));

    it('exports the paging allowlist and the alarm prefixes', () => {
      assert.ok(mod.SLACK_ESCALATE_SURFACES instanceof Set);
      assert.ok(mod.SLACK_ESCALATE_SURFACES.has('boot-integrity'));
      assert.ok(mod.SLACK_ESCALATE_SURFACES.has('pod-merge'));
      const sorted = [...mod.SLACK_ESCALATE_SURFACES].sort();
      assert.deepEqual([...mod.SLACK_ESCALATE_SURFACES], sorted, 'keep the allowlist alphabetised');
      assert.deepEqual(mod.ALARMING_PREFIXES, {
        clientError: '[telemetry-lambda] client_error',
        clientCritical: '[telemetry-lambda] client_critical',
      });
      assert.ok(Object.isFrozen(mod.ALARMING_PREFIXES));
    });

    it('pages a critical event on an allowlisted surface', async () => {
      const res = await send([critical]);
      assert.equal(res.statusCode, 200);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'https://hooks.slack.test/abc');
    });

    it('does NOT page a critical event on a non-allowlisted surface', async () => {
      await send([{ ...critical, surface: 'unhandled-error' }]);
      assert.equal(calls.length, 0);
    });

    it('does NOT page an error-level event on an allowlisted surface without critical severity', async () => {
      await send([{ ...critical, severity: 'error' }]);
      await send([{ ...critical, severity: undefined, message: 'no severity at all' }]);
      assert.equal(calls.length, 0);
    });

    it('suppresses an identical page within 5 minutes in the same container', async () => {
      await send([critical]);
      await send([critical]);
      assert.equal(calls.length, 1);
      assert.ok(
        logs.includes(
          '[telemetry-lambda] Slack page suppressed (duplicate within 5 min): pod-merge'
        )
      );
      // A different message on the same surface is a different signature.
      await send([{ ...critical, message: 'remote merge failed differently' }]);
      assert.equal(calls.length, 2);
    });

    it('two families with the same code within 5 min both page', async () => {
      const coded = { ...critical, error_code: 'merge-conflict' };
      const other = { ...coded, family_id: '9a8b7c6d-4444-5555-6666-0123456789ab' };
      await send([coded]);
      await send([other]);
      assert.equal(calls.length, 2);
      // Same batch too: the batch-level set keys on the family as well.
      const third = { ...coded, family_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' };
      const fourth = { ...coded, family_id: undefined };
      await send([third, fourth]);
      assert.equal(calls.length, 3);
      assert.equal((calls[2].body.text.match(/beanies critical/g) || []).length, 2);
    });

    it('the same family with the same code within 5 min is still suppressed', async () => {
      const coded = { ...critical, error_code: 'merge-conflict' };
      await send([coded]);
      await send([{ ...coded, message: 'different detail text' }]);
      assert.equal(calls.length, 1);
      assert.ok(
        logs.includes(
          '[telemetry-lambda] Slack page suppressed (duplicate within 5 min): pod-merge'
        )
      );
    });

    it('collapses a duplicate inside one batch too', async () => {
      await send([critical, critical]);
      assert.equal(calls.length, 1);
      assert.doesNotMatch(calls[0].body.text, /remote merge failed[\s\S]*remote merge failed/);
    });

    it('pages again once the 5 minute window has passed', async () => {
      const realNow = Date.now;
      try {
        await send([critical]);
        const t0 = realNow();
        Date.now = () => t0 + 5 * 60_000 + 1;
        await send([critical]);
      } finally {
        Date.now = realNow;
      }
      assert.equal(calls.length, 2);
    });

    it('carries family name, id tail, short build, browser, surface, message and the deep link', async () => {
      await send([critical]);
      const text = calls[0].body.text;
      assert.match(text, /^🚨 \*beanies critical\* · `pod-merge`\n/);
      assert.match(text, /\nremote merge failed\n/);
      assert.match(text, /family The Parkers/);
      assert.match(text, /id …ef123456/);
      // The visible text carries only the tail; the full id lives in the query link.
      assert.doesNotMatch(text.split('\n<')[0], /3f1c2a4b-1111/, 'only the id tail is shown');
      assert.match(text, /build `48c85de`/);
      assert.match(text, /Chrome 141 on Android/);
      const link = mod.insightsLink(critical.family_id, critical.timestamp);
      assert.ok(text.includes(`<${link}|Logs Insights, +/-30 min>`));
    });

    it('omits the family fields cleanly and escapes Slack control characters', async () => {
      await send([
        {
          ...critical,
          family_id: undefined,
          family_name: undefined,
          build_sha: undefined,
          browser: undefined,
          message: 'a <b> & c',
        },
      ]);
      const text = calls[0].body.text;
      assert.doesNotMatch(text, /family /);
      assert.doesNotMatch(text, /id …/);
      assert.match(text, /build `unknown` · unknown browser/);
      assert.match(text, /a &lt;b&gt; &amp; c/);
    });

    it('keeps the 3-page fan-out cap', async () => {
      const events = Array.from({ length: 5 }, (_, i) => ({ ...critical, message: `m${i}` }));
      await send(events);
      assert.equal(calls.length, 1);
      assert.equal((calls[0].body.text.match(/beanies critical/g) || []).length, 3);
      assert.match(calls[0].body.text, /and 2 more in this batch/);
    });

    it('collapses messages differing only in a uuid or a number to one page', async () => {
      await send([
        {
          ...critical,
          surface: 'vue-render',
          message: 'Render failed for 3f1c2a4b-1111-2222-3333-abcdef123456 (len 42)',
        },
      ]);
      await send([
        {
          ...critical,
          surface: 'vue-render',
          message: 'render failed for 9a8b7c6d-4444-5555-6666-0123456789ab (len 1337)',
        },
      ]);
      await send([{ ...critical, message: 'connection 0xdeadbeef01: timeout' }]);
      await send([{ ...critical, message: 'connection 0xfeedface99: timeout' }]);
      assert.equal(calls.length, 2);
    });

    it('keys on error_code when present, so two codes on one surface both page', async () => {
      await send([
        {
          ...critical,
          surface: 'createPod.connectDrive',
          error_code: 'drive-api-disabled',
          message: 'connect failed: a',
        },
      ]);
      await send([
        {
          ...critical,
          surface: 'createPod.connectDrive',
          error_code: 'unknown',
          message: 'connect failed: a',
        },
      ]);
      // Same code, different detail text: one signature.
      await send([
        {
          ...critical,
          surface: 'createPod.connectDrive',
          error_code: 'drive-api-disabled',
          message: 'connect failed: b',
        },
      ]);
      assert.equal(calls.length, 2);
    });

    it('does not stamp the overflow beyond the 3-page cap; those page on the next batch', async () => {
      const events = ['a', 'b', 'c', 'd', 'e'].map((s) => ({ ...critical, message: `boom ${s}` }));
      await send(events);
      assert.equal(calls.length, 1);
      await send(events);
      assert.equal(calls.length, 2);
      const second = calls[1].body.text;
      assert.equal((second.match(/beanies critical/g) || []).length, 2);
      assert.match(second, /boom d/);
      assert.match(second, /boom e/);
      assert.doesNotMatch(second, /more in this batch/);
    });

    it('stamps nothing when Slack returns 500, so the same event pages next time', async () => {
      const errs = [];
      console.error = (...a) => errs.push(a.join(' '));
      globalThis.fetch = async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return { ok: false, status: 500 };
      };
      await send([critical]);
      assert.ok(errs.some((e) => e.includes('Slack escalation rejected')));
      globalThis.fetch = async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return { ok: true, status: 200 };
      };
      await send([critical]);
      assert.equal(calls.length, 2);
      assert.ok(!logs.some((l) => l.includes('Slack page suppressed')));
      // Delivered now, so a third send is a true duplicate.
      await send([critical]);
      assert.equal(calls.length, 2);
      assert.ok(logs.some((l) => l.includes('Slack page suppressed')));
    });

    it('stamps nothing when the Slack POST rejects', async () => {
      console.error = () => {};
      globalThis.fetch = async () => {
        throw new Error('slack down');
      };
      await send([critical]);
      globalThis.fetch = async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return { ok: true, status: 200 };
      };
      await send([critical]);
      assert.equal(calls.length, 1);
    });

    describe('late events (offline replays)', () => {
      const sendAt = (events, sentAt) =>
        mod.handler(makeEvent({ headers: keyHeader, body: { sentAt, events } }));
      const minutes = (iso, m) => new Date(Date.parse(iso) + m * 60_000).toISOString();
      const lines = () => logs.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));

      it('stamps late_s and does not page a critical that waited on the device', async () => {
        await sendAt([critical], minutes(critical.timestamp, 90));
        assert.equal(calls.length, 0);
        const line = lines().find((l) => l.surface === 'pod-merge');
        assert.equal(line.late_s, 5400);
        assert.ok(
          logs.includes('[telemetry-lambda] Slack page suppressed (late event, 5400s): pod-merge')
        );
      });

      it('an event sent within 5 minutes is not late and still pages', async () => {
        await sendAt([critical], minutes(critical.timestamp, 4));
        assert.equal(calls.length, 1);
        assert.equal(lines()[0].late_s, undefined);
      });

      it('a device clock that is off does not make events late (both sides are device time)', async () => {
        // Device 10 minutes slow: timestamp and sentAt are both 10 min behind the server, 1 s apart.
        const slow = new Date(Date.now() - 10 * 60_000).toISOString();
        await sendAt([{ ...critical, timestamp: slow }], minutes(slow, 1 / 60));
        assert.equal(calls.length, 1);
      });

      it('a missing, unparseable or non-string sentAt is never late (older clients)', async () => {
        await send([critical]);
        await sendAt([{ ...critical, message: 'b' }], 'not a date');
        await sendAt([{ ...critical, message: 'c' }], Date.parse(critical.timestamp) + 3_600_000);
        assert.equal(calls.length, 3);
        assert.ok(lines().every((l) => l.late_s === undefined));
      });

      it('an event with no client timestamp is never late (no server-time back-fill)', async () => {
        const { timestamp, ...noTs } = critical;
        void timestamp;
        await sendAt([noTs], new Date(Date.now() + 60 * 60_000).toISOString());
        assert.equal(calls.length, 1);
      });

      it('lateSeconds: null for future, unparseable or within the threshold', () => {
        const t = '2026-10-19T00:00:00.000Z';
        const at = (m) => Date.parse(t) + m * 60_000;
        assert.equal(mod.lateSeconds(t, at(-1)), null);
        assert.equal(mod.lateSeconds(t, at(5)), null);
        assert.equal(mod.lateSeconds(t, at(6)), 360);
        assert.equal(mod.lateSeconds('nope', at(60)), null);
        assert.equal(mod.lateSeconds(t, NaN), null);
        assert.equal(mod.lateSeconds(undefined, at(60)), null);
      });

      it('pageDecision orders late before duplicate', () => {
        const keys = new Set();
        assert.equal(mod.pageDecision({ ...critical, severity: 'error' }, null, 0, keys), null);
        assert.deepEqual(mod.pageDecision(critical, 99, 0, keys), { kind: 'late' });
        const first = mod.pageDecision(critical, null, 0, keys);
        assert.equal(first.kind, 'page');
        keys.add(first.key);
        assert.deepEqual(mod.pageDecision(critical, 99, 0, keys), { kind: 'late' });
        assert.deepEqual(mod.pageDecision(critical, null, 0, keys), { kind: 'duplicate' });
      });

      it('late_s and sentAt are server-side only: a client-sent late_s is dropped', async () => {
        assert.equal(mod.ALLOWED_CONTEXT_KEYS.has('late_s'), false);
        assert.equal(mod.ALLOWED_CONTEXT_KEYS.has('sentAt'), false);
        await send([{ ...sampleEvent, late_s: 1 }]);
        assert.equal(lines()[0].late_s, undefined);
      });
    });
  });

  describe('insightsLink', () => {
    afterEach(() => {
      delete process.env.AWS_REGION;
      delete process.env.AWS_LAMBDA_LOG_GROUP_NAME;
    });

    // Decode as the console does: `$` -> `%`, then one URI decode of the fragment.
    const decodeFragment = (url) => decodeURIComponent(url.split('#')[1].replace(/\$/g, '%'));

    it('pins the console deep-link shape (region, $-encoded fragment, JSURL queryDetail)', async () => {
      process.env.AWS_REGION = 'ap-southeast-1';
      process.env.AWS_LAMBDA_LOG_GROUP_NAME = '/aws/lambda/beanies-family-telemetry-prod';
      const { insightsLink } = await import(`../index.mjs?t=${Date.now()}-link1`);
      const url = insightsLink('3f1c2a4b-1111-2222-3333-abcdef123456', '2026-10-15T05:00:00.000Z');

      assert.ok(
        url.startsWith(
          'https://ap-southeast-1.console.aws.amazon.com/cloudwatch/home?region=ap-southeast-1' +
            '#logsV2:logs-insights$3FqueryDetail$3D$7E$28end$7E$272026-10-15T05$2A3a30$2A3a00.000Z' +
            '$7Estart$7E$272026-10-15T04$2A3a30$2A3a00.000Z$7EtimeType$7E$27ABSOLUTE$7Etz$7E$27UTC' +
            '$7EeditorString$7E$27fields$2A20$2A40timestamp'
        ),
        url
      );
      assert.ok(
        url.endsWith(
          '$7Esource$7E$28$7E$27$2A2faws$2A2flambda$2A2fbeanies-family-telemetry-prod$29$29'
        ),
        url
      );
      // Fully encoded: nothing Slack's link parser could trip on survives raw.
      assert.match(url.split('#')[1], /^logsV2:logs-insights[A-Za-z0-9$._-]+$/);

      assert.equal(
        decodeFragment(url),
        "logsV2:logs-insights?queryDetail=~(end~'2026-10-15T05*3a30*3a00.000Z" +
          "~start~'2026-10-15T04*3a30*3a00.000Z~timeType~'ABSOLUTE~tz~'UTC" +
          "~editorString~'fields*20*40timestamp*2c*20level*2c*20severity*2c*20surface*2c*20message" +
          '*2c*20route_path*2c*20build_sha*0a*7c*20filter*20t*20*3d*20*22beanlog*22*20and' +
          '*20family_id*20*3d*20*223f1c2a4b-1111-2222-3333-abcdef123456*22*0a*7c*20sort' +
          "*20*40timestamp*20asc*0a*7c*20limit*20500~source~(~'*2faws*2flambda*2fbeanies-family-telemetry-prod))"
      );
    });

    it('defaults the region and log group when the runtime env is absent', async () => {
      const savedFn = process.env.AWS_LAMBDA_FUNCTION_NAME;
      delete process.env.AWS_LAMBDA_FUNCTION_NAME;
      try {
        const { insightsLink } = await import(`../index.mjs?t=${Date.now()}-link2`);
        const url = insightsLink('fam', '2026-10-15T05:00:00.000Z');
        assert.ok(url.startsWith('https://ap-southeast-1.console.aws.amazon.com/'));
        assert.ok(decodeFragment(url).includes('beanies-family-telemetry-prod'));
      } finally {
        if (savedFn !== undefined) process.env.AWS_LAMBDA_FUNCTION_NAME = savedFn;
      }
    });

    it('reads the region from AWS_REGION', async () => {
      process.env.AWS_REGION = 'us-west-2';
      const { insightsLink } = await import(`../index.mjs?t=${Date.now()}-link3`);
      assert.ok(
        insightsLink('fam', '2026-10-15T05:00:00.000Z').startsWith(
          'https://us-west-2.console.aws.amazon.com/cloudwatch/home?region=us-west-2#'
        )
      );
    });

    it('strips quote-breaking characters from the family id and drops the filter when absent', async () => {
      const { insightsLink } = await import(`../index.mjs?t=${Date.now()}-link4`);
      const injected = decodeFragment(insightsLink('ab"c) | x', '2026-10-15T05:00:00.000Z'));
      assert.ok(injected.includes('family_id*20*3d*20*22abcx*22'));
      const none = decodeFragment(insightsLink(undefined, 'not a date'));
      assert.doesNotMatch(none, /family_id/);
      assert.match(none, /filter\*20t\*20\*3d\*20\*22beanlog\*22\*0a/);
    });
  });

  describe('alarm tally lines', () => {
    const tallies = () => logs.filter((l) => l.startsWith('[telemetry-lambda] client_'));
    const send = (evt) =>
      handler(makeEvent({ headers: keyHeader, body: { events: [{ ...sampleEvent, ...evt }] } }));

    it('writes client_error for an error-level event, right after its beanlog line', async () => {
      await send({ level: 'error', surface: 'sync-save' });
      assert.deepEqual(tallies(), ['[telemetry-lambda] client_error sync-save']);
      assert.ok(logs[0].startsWith('{"t":"beanlog"'));
      assert.equal(logs[1], '[telemetry-lambda] client_error sync-save');
    });

    it('writes both lines for a critical event', async () => {
      delete process.env.SLACK_ERROR_WEBHOOK_URL;
      console.error = () => {};
      await send({ level: 'error', severity: 'critical', surface: 'unhandled-error' });
      assert.deepEqual(tallies(), [
        '[telemetry-lambda] client_error unhandled-error',
        '[telemetry-lambda] client_critical unhandled-error',
      ]);
    });

    it('writes neither for an info event', async () => {
      await send({ level: 'info', surface: 'load-perf' });
      assert.deepEqual(tallies(), []);
      assert.equal(logs.length, 1);
    });
  });

  describe('allowlist drift guard', () => {
    // Pins the server-side allowlist. If a context key is added to the client
    // (src/utils/diagnosticContext.ts) it MUST be mirrored here or this fails.
    // `family_email` is intentionally absent — the firehose is PII-free.
    it('matches the expected key set exactly', () => {
      const expected = [
        'account_type',
        'action',
        'activity_id',
        'breadcrumbs',
        'browser',
        'build_sha',
        'cache_persist_error',
        'cache_persist_kind',
        'cold_start',
        'component',
        'connection_type',
        'consecutive_failures',
        'context_build_error',
        'count',
        'create_attempt_id',
        'credential_source',
        'detail',
        'detail_field_count',
        'drive_file_not_found',
        'dry_run',
        'entitlement_state',
        'error_code',
        'extraction_path',
        'family_id',
        'family_name',
        'file_count',
        'file_id_tail',
        'format',
        'from_path',
        'had_config',
        'has_account_number',
        'has_card_details',
        'has_online_banking',
        'has_prf_output',
        'has_session',
        'hint_count',
        'hint_expired',
        'hint_flag_on',
        'hint_generated',
        'hint_master_on',
        'hint_op',
        'hint_pruned_stale',
        'hint_reason',
        'hint_skipped_records',
        'hint_total',
        'hint_type',
        'http_status',
        'inferred_count',
        'ingredient_count',
        'invite_token_tail',
        'key_backing',
        'kind',
        'lost_siblings',
        'member_id_tail',
        'notif_activity_lead',
        'notif_backfilled',
        'notif_count',
        'notif_error_stage',
        'notif_exact_alarm',
        'notif_gated',
        'notif_kind',
        'notif_lateness_bucket',
        'notif_lead_default',
        'notif_permission',
        'notif_skipped',
        'notif_tap_outcome',
        'notif_truncated',
        'notif_tz_changed',
        'online',
        'os',
        'overwrote',
        'page_hidden_for_ms',
        'perf_doc_bytes',
        'perf_duration_ms',
        'perf_entity_count',
        'perf_op',
        'plan',
        'prf_enabled',
        'provider_type',
        'quick_add',
        'recovery_attempt',
        'recovery_method',
        'recur_children_expected',
        'recur_children_removed',
        'recur_end',
        'recur_interval',
        'recur_occurrence_ymd',
        'recur_outcome',
        'recur_reason',
        'recur_rescheduled',
        'recur_resolved_ymd',
        'recur_scope',
        'recur_stripped_fields',
        'recur_surface',
        'recur_unit',
        'refresh_token_age_ms',
        'registry_had_file_id',
        'route_name',
        'route_path',
        'save_failure_level',
        'save_status',
        'screen_h',
        'screen_w',
        'severity',
        'share_scope',
        'silent_refresh_attempts',
        'silent_refresh_consecutive_failures',
        'silent_refresh_had_refresh_token',
        'slot',
        'stage',
        'token_grant',
        'token_op',
        'token_outcome',
        'token_reason',
        'token_trigger',
        'token_valid',
        'unwrap_ok',
        'viewport_h',
        'viewport_w',
        'visibility_state',
        'vue_info',
        'wallet_count',
        'weather_age_min',
        'web_storage',
      ];
      assert.deepEqual([...ALLOWED_CONTEXT_KEYS].sort(), expected);
      assert.equal(ALLOWED_CONTEXT_KEYS.has('family_email'), false);
    });
  });
});
