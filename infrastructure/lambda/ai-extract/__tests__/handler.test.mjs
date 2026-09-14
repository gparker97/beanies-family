/* global process */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { __setRateLimitClientForTests } from '../rateLimit.mjs';
import { USAGE_ATTRS, __setDdbClientForTests } from '../ddb.mjs';

const API_KEY = 'test-key';
const originalLog = console.log;
const originalError = console.error;
const originalFetch = globalThis.fetch;

const VALID_EXTRACTION = {
  isEvent: true,
  title: "Mia's Party",
  date: '2026-07-12',
  startTime: '14:00',
  endTime: '16:00',
  isAllDay: false,
  location: 'Hall',
  description: '',
  confidence: { title: 0.9, date: 0.9, startTime: 0.8, endTime: 0.7, location: 0.8 },
};

const VALID_TRAVEL = {
  isTravel: true,
  tripName: 'Tokyo Trip',
  tripTypeHint: 'fly_and_stay',
  segments: [
    {
      kind: 'travel',
      type: 'flight_outbound',
      title: 'SIN → HND',
      status: 'booked',
      bookingReference: 'ABC123',
      notes: '',
      confidence: { overall: 0.9 },
    },
  ],
};

const IMAGE = 'data:image/jpeg;base64,AAAA';

function makeEvent({
  method = 'POST',
  headers = {},
  body,
  origin = 'https://beanies.family',
} = {}) {
  return {
    requestContext: { http: { method } },
    headers: { origin, ...headers },
    body: body === undefined ? '{}' : typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function parseResponse(result) {
  return { ...result, parsedBody: result.body ? JSON.parse(result.body) : null };
}

/** Build a fake Tinfoil chat-completion Response. */
function fakeUpstream({
  ok = true,
  status = 200,
  content = JSON.stringify(VALID_EXTRACTION),
  enclave = 'gemma4-31b.inf10.tinfoil.sh',
  json = true,
} = {}) {
  return {
    ok,
    status,
    headers: { get: (k) => (k === 'tinfoil-enclave' ? enclave : null) },
    json: async () => {
      if (!json) throw new Error('non-json');
      return { choices: [{ message: { content } }] };
    },
  };
}

describe('ai-extract Lambda handler', () => {
  let handler;

  beforeEach(async () => {
    process.env.AI_EXTRACT_API_KEY = API_KEY;
    process.env.TINFOIL_API_KEY = 'tinfoil-secret';
    process.env.CORS_ORIGINS = 'https://beanies.family,http://localhost:5173';
    console.log = () => {};
    console.error = () => {};
    globalThis.fetch = async () => fakeUpstream();
    const mod = await import(`../index.mjs?t=${Date.now()}-${Math.random()}`);
    handler = mod.handler;
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
    globalThis.fetch = originalFetch;
    delete process.env.AI_EXTRACT_API_KEY;
    delete process.env.TINFOIL_API_KEY;
    delete process.env.CORS_ORIGINS;
  });

  const keyHeader = { 'x-api-key': API_KEY };
  const goodBody = { imageDataUrl: IMAGE, todayIso: '2026-06-03' };

  describe('method + auth', () => {
    it('returns 204 for OPTIONS preflight', async () => {
      const res = await handler(makeEvent({ method: 'OPTIONS' }));
      assert.equal(res.statusCode, 204);
    });

    it('returns 405 for GET', async () => {
      const res = await handler(makeEvent({ method: 'GET', headers: keyHeader }));
      assert.equal(res.statusCode, 405);
    });

    it('returns 401 with no api key', async () => {
      const res = await handler(makeEvent({ body: goodBody }));
      assert.equal(res.statusCode, 401);
    });

    it('returns 401 with a wrong api key', async () => {
      const res = await handler(makeEvent({ headers: { 'x-api-key': 'nope' }, body: goodBody }));
      assert.equal(res.statusCode, 401);
    });
  });

  describe('request validation', () => {
    it('returns 400 on malformed JSON', async () => {
      const res = await handler(makeEvent({ headers: keyHeader, body: '{not json' }));
      assert.equal(res.statusCode, 400);
    });

    it('returns 400 when imageDataUrl is missing or not an image data URL', async () => {
      const res = await handler(
        makeEvent({
          headers: keyHeader,
          body: { imageDataUrl: 'https://x/y.jpg', todayIso: '2026-06-03' },
        })
      );
      assert.equal(res.statusCode, 400);
    });

    it('returns 400 on a non-allowed mime (gif)', async () => {
      const res = await handler(
        makeEvent({
          headers: keyHeader,
          body: { imageDataUrl: 'data:image/gif;base64,AAAA', todayIso: '2026-06-03' },
        })
      );
      assert.equal(res.statusCode, 400);
    });

    it('returns 400 on a bad todayIso', async () => {
      const res = await handler(
        makeEvent({ headers: keyHeader, body: { imageDataUrl: IMAGE, todayIso: 'today' } })
      );
      assert.equal(res.statusCode, 400);
    });

    it('accepts a full ISO timestamp for todayIso (normalized to the date)', async () => {
      const res = await handler(
        makeEvent({
          headers: keyHeader,
          body: { imageDataUrl: IMAGE, todayIso: '2026-06-03T09:20:40.593Z' },
        })
      );
      assert.equal(res.statusCode, 200);
    });

    it('returns our clean 413 on a body over the 5 MB guard (below the 6 MB platform ceiling)', async () => {
      const huge = 'data:image/jpeg;base64,' + 'A'.repeat(5 * 1024 * 1024 + 10);
      const res = await handler(
        makeEvent({ headers: keyHeader, body: { imageDataUrl: huge, todayIso: '2026-06-03' } })
      );
      assert.equal(res.statusCode, 413);
    });
  });

  describe('multi-image (multi-page PDF) requests', () => {
    it('accepts an imageDataUrls array and returns 200', async () => {
      const res = parseResponse(
        await handler(
          makeEvent({
            headers: keyHeader,
            body: { imageDataUrls: [IMAGE, IMAGE, IMAGE], todayIso: '2026-06-03' },
          })
        )
      );
      assert.equal(res.statusCode, 200);
      assert.equal(res.parsedBody.result.title, "Mia's Party");
    });

    it('still accepts a legacy single imageDataUrl (old cached clients)', async () => {
      const res = await handler(
        makeEvent({ headers: keyHeader, body: { imageDataUrl: IMAGE, todayIso: '2026-06-03' } })
      );
      assert.equal(res.statusCode, 200);
    });

    it('returns 400 on an empty imageDataUrls array', async () => {
      const res = await handler(
        makeEvent({ headers: keyHeader, body: { imageDataUrls: [], todayIso: '2026-06-03' } })
      );
      assert.equal(res.statusCode, 400);
    });

    it('returns 400 when the array exceeds the server MAX_IMAGES backstop (8)', async () => {
      const res = await handler(
        makeEvent({
          headers: keyHeader,
          body: { imageDataUrls: Array(9).fill(IMAGE), todayIso: '2026-06-03' },
        })
      );
      assert.equal(res.statusCode, 400);
    });

    it('returns 400 when any array element is not an allowed image data URL', async () => {
      const res = await handler(
        makeEvent({
          headers: keyHeader,
          body: { imageDataUrls: [IMAGE, 'https://x/y.gif'], todayIso: '2026-06-03' },
        })
      );
      assert.equal(res.statusCode, 400);
    });
  });

  describe('happy path', () => {
    it('returns 200 with the structured result + attestation', async () => {
      const res = parseResponse(await handler(makeEvent({ headers: keyHeader, body: goodBody })));
      assert.equal(res.statusCode, 200);
      assert.equal(res.parsedBody.result.title, "Mia's Party");
      assert.equal(res.parsedBody.attestation.enclave, 'gemma4-31b.inf10.tinfoil.sh');
    });

    it('strips markdown fences around the model JSON', async () => {
      globalThis.fetch = async () =>
        fakeUpstream({ content: '```json\n' + JSON.stringify(VALID_EXTRACTION) + '\n```' });
      const res = parseResponse(await handler(makeEvent({ headers: keyHeader, body: goodBody })));
      assert.equal(res.statusCode, 200);
      assert.equal(res.parsedBody.result.isEvent, true);
    });
  });

  describe('upstream + parsing failures', () => {
    it('maps a Tinfoil 5xx to a retryable 503 (upstream_unavailable)', async () => {
      globalThis.fetch = async () => fakeUpstream({ ok: false, status: 503 });
      const res = parseResponse(await handler(makeEvent({ headers: keyHeader, body: goodBody })));
      assert.equal(res.statusCode, 503);
      assert.equal(res.parsedBody.code, 'upstream_unavailable');
    });

    it('maps a Tinfoil 500 to a retryable 503 (upstream_unavailable)', async () => {
      globalThis.fetch = async () => fakeUpstream({ ok: false, status: 500 });
      const res = parseResponse(await handler(makeEvent({ headers: keyHeader, body: goodBody })));
      assert.equal(res.statusCode, 503);
      assert.equal(res.parsedBody.code, 'upstream_unavailable');
    });

    it('returns 502 + upstream_auth on a 401 from Tinfoil (revoked key)', async () => {
      globalThis.fetch = async () => fakeUpstream({ ok: false, status: 401 });
      const res = parseResponse(await handler(makeEvent({ headers: keyHeader, body: goodBody })));
      assert.equal(res.statusCode, 502);
      assert.equal(res.parsedBody.code, 'upstream_auth');
    });

    it('returns 502 + upstream_http on a non-auth 4xx from Tinfoil', async () => {
      globalThis.fetch = async () => fakeUpstream({ ok: false, status: 429 });
      const res = parseResponse(await handler(makeEvent({ headers: keyHeader, body: goodBody })));
      assert.equal(res.statusCode, 502);
      assert.equal(res.parsedBody.code, 'upstream_http');
    });

    it('returns 502 when the model output is not JSON', async () => {
      globalThis.fetch = async () => fakeUpstream({ content: 'sorry, I cannot do that' });
      const res = await handler(makeEvent({ headers: keyHeader, body: goodBody }));
      assert.equal(res.statusCode, 502);
    });

    it('returns 502 when the model output is missing required keys', async () => {
      globalThis.fetch = async () => fakeUpstream({ content: JSON.stringify({ title: 'x' }) });
      const res = await handler(makeEvent({ headers: keyHeader, body: goodBody }));
      assert.equal(res.statusCode, 502);
    });

    it('returns 504 when the upstream call times out', async () => {
      globalThis.fetch = async () => {
        const e = new Error('timeout');
        e.name = 'TimeoutError';
        throw e;
      };
      const res = await handler(makeEvent({ headers: keyHeader, body: goodBody }));
      assert.equal(res.statusCode, 504);
    });
  });

  describe('task routing (#30)', () => {
    it('runs the travel task and returns the travel-shaped result', async () => {
      globalThis.fetch = async () => fakeUpstream({ content: JSON.stringify(VALID_TRAVEL) });
      const res = parseResponse(
        await handler(makeEvent({ headers: keyHeader, body: { ...goodBody, task: 'travel' } }))
      );
      assert.equal(res.statusCode, 200);
      assert.equal(res.parsedBody.result.isTravel, true);
      assert.equal(res.parsedBody.result.segments.length, 1);
    });

    it('defaults a missing task to event (backward-compat)', async () => {
      const res = parseResponse(await handler(makeEvent({ headers: keyHeader, body: goodBody })));
      assert.equal(res.statusCode, 200);
      assert.equal(res.parsedBody.result.title, "Mia's Party");
    });

    it('rejects an unknown task with 400 AND a machine-readable code', async () => {
      const res = parseResponse(
        await handler(makeEvent({ headers: keyHeader, body: { ...goodBody, task: 'bogus' } }))
      );
      assert.equal(res.statusCode, 400);
      // DEPLOY ORDER: this Lambda must ship a new task before any client that asks for it.
      // Without the code the client falls through to a status-based branch and shows
      // "something went wrong", which reads as a broken feature rather than one that is
      // simply not deployed yet. The client maps this code to the friendly notice.
      assert.equal(res.parsedBody.code, 'unknown_task');
    });

    it('accepts the share task (#64) — one call that classifies and extracts', async () => {
      globalThis.fetch = async () =>
        fakeUpstream({ content: JSON.stringify({ kind: 'event', event: VALID_EXTRACTION }) });
      const res = parseResponse(
        await handler(makeEvent({ headers: keyHeader, body: { ...goodBody, task: 'share' } }))
      );
      assert.equal(res.statusCode, 200);
      assert.equal(res.parsedBody.result.kind, 'event');
    });

    it('accepts TEXT for the share task (#64 links)', async () => {
      // Shared LINKS send the page content that content-fetch already retrieved — never the
      // bare URL, and never raw user input.
      globalThis.fetch = async () =>
        fakeUpstream({ content: JSON.stringify({ kind: 'event', event: VALID_EXTRACTION }) });
      const res = parseResponse(
        await handler(
          makeEvent({
            headers: keyHeader,
            body: { task: 'share', text: 'a page about a school fair', todayIso: '2026-06-03' },
          })
        )
      );
      assert.equal(res.statusCode, 200);
    });

    it('still refuses TEXT for images-only tasks, with a machine-readable code', async () => {
      // The fence is what stops the soft x-api-key — which ships in the public bundle —
      // buying a general text endpoint. `event` and `travel` never accept text.
      for (const task of ['event', 'travel']) {
        const res = parseResponse(
          await handler(
            makeEvent({
              headers: keyHeader,
              body: { task, text: 'hello', todayIso: '2026-06-03' },
            })
          )
        );
        assert.equal(res.statusCode, 400, `${task} must refuse text`);
        // Same code as the unknown-task rejection, so a client deployed ahead of this Lambda
        // shows the friendly "not set up yet" notice rather than a generic error.
        assert.equal(res.parsedBody.code, 'unknown_task', `${task} must carry the code`);
      }
    });

    it('validates travel required-keys (502 on wrong shape for travel task)', async () => {
      globalThis.fetch = async () => fakeUpstream({ content: JSON.stringify({ isTravel: true }) });
      const res = await handler(
        makeEvent({ headers: keyHeader, body: { ...goodBody, task: 'travel' } })
      );
      assert.equal(res.statusCode, 502);
    });
  });

  describe('rate limiting (#83)', () => {
    /**
     * A stub that refuses whichever key prefix is named.
     *
     * ⚠️ `calls` is a CLOSURE, not `this.calls`. `checkLimits` destructures `{ send }` and
     * calls it detached, so a method using `this` throws — and that throw is swallowed by the
     * limiter's fail-open catch, which silently allows the request. That failure looks exactly
     * like a passing limiter, which is how it wasted a debugging pass.
     */
    function refusingClient(prefix) {
      const calls = [];
      return {
        calls,
        commands: {
          UpdateItemCommand: class {
            constructor(input) {
              this.input = input;
            }
          },
        },
        send(cmd) {
          calls.push(cmd.input);
          if (cmd.input.Key.pk.S.startsWith(prefix)) {
            const err = new Error('conditional request failed');
            err.name = 'ConditionalCheckFailedException';
            return Promise.reject(err);
          }
          return Promise.resolve({});
        },
      };
    }

    describe('when the limiter actually refuses', () => {
      let ddb;
      beforeEach(() => {
        process.env.RATE_TABLE = 'beanies-ai-rate-test';
        ddb = refusingClient('f#');
        __setRateLimitClientForTests(ddb);
      });
      afterEach(() => {
        delete process.env.RATE_TABLE;
        __setRateLimitClientForTests(null);
      });

      it('returns 429 with a machine-readable code and a retry hint', async () => {
        const res = parseResponse(
          await handler(
            makeEvent({
              headers: keyHeader,
              body: {
                task: 'share',
                text: 'a page about a school fair',
                todayIso: '2026-06-03',
                familyId: 'fam-1',
              },
            })
          )
        );

        assert.equal(res.statusCode, 429);
        assert.equal(res.parsedBody.code, 'rate_limited');
        assert.ok(res.parsedBody.retryAfterSeconds > 0);
      });

      it('carries CORS headers, which an API-Gateway-generated 429 would not', async () => {
        // This is WHY the refusal goes through `response()`. Without them the browser sees an
        // opaque network error, classifies it as `provider_error`, and pages #beanies-errors —
        // the exact noise the 429 mapping exists to stop.
        const res = await handler(
          makeEvent({
            headers: keyHeader,
            body: {
              task: 'share',
              text: 'a page about a school fair',
              todayIso: '2026-06-03',
              familyId: 'fam-1',
            },
          })
        );
        assert.equal(res.statusCode, 429);
        assert.ok(res.headers['Access-Control-Allow-Origin']);
      });

      it('makes NO upstream call when it refuses', async () => {
        let called = false;
        globalThis.fetch = async () => {
          called = true;
          return fakeUpstream({ content: '{}' });
        };
        await handler(
          makeEvent({
            headers: keyHeader,
            body: {
              task: 'share',
              text: 'a page about a school fair',
              todayIso: '2026-06-03',
              familyId: 'fam-1',
            },
          })
        );
        assert.equal(called, false, 'a refused request must not be billable');
      });

      it('does NOT limit the image path — the hasText gate', async () => {
        // Deliberate scope: the image path is bounded by its own size limits and has run under
        // the route throttle since #133. Widening to it can break a working reader.
        globalThis.fetch = async () => fakeUpstream({ content: JSON.stringify(VALID_EXTRACTION) });
        const res = await handler(makeEvent({ headers: keyHeader, body: goodBody }));

        assert.equal(res.statusCode, 200);
        assert.equal(ddb.calls.length, 0, 'the image path must reach no rate-limit write');
      });

      it('keys the IP on requestContext.http.sourceIp and NEVER x-forwarded-for', async () => {
        // ⚠️ rateLimit.mjs calls this "the single most bypassable detail in this module":
        // x-forwarded-for is caller-controlled, so honouring it would defeat the IP limit
        // entirely — an attacker would just rotate the header.
        const allowing = refusingClient('never-matches');
        __setRateLimitClientForTests(allowing);

        const event = makeEvent({
          headers: { ...keyHeader, 'x-forwarded-for': '9.9.9.9' },
          body: { task: 'share', text: 'a page about a school fair', todayIso: '2026-06-03' },
        });
        event.requestContext = { http: { method: 'POST', sourceIp: '203.0.113.7' } };

        globalThis.fetch = async () =>
          fakeUpstream({ content: JSON.stringify({ kind: 'event', event: VALID_EXTRACTION }) });
        await handler(event);

        const sha = (v) => createHash('sha256').update(v).digest('hex');
        const ipKeys = allowing.calls.map((c) => c.Key.pk.S).filter((k) => k.startsWith('i#'));
        assert.equal(ipKeys.length, 1, 'exactly one IP bucket should be counted');
        assert.ok(ipKeys[0].includes(sha('203.0.113.7')), 'must key on sourceIp');
        assert.ok(!ipKeys[0].includes(sha('9.9.9.9')), 'must NOT key on x-forwarded-for');
      });
    });
  });

  // ── The meter, where it meets the handler ────────────────────────────────────────────────
  //
  // `meter.test.mjs` covers the two verbs in isolation. What can only be checked HERE is that
  // they are wired to the right points in the handler's control flow: a bean is spent exactly
  // when beanies answered you, and never on a request that returned nothing.
  describe('counting, at the 200 and nowhere else', () => {
    const SHARE = JSON.stringify({ kind: 'event', event: VALID_EXTRACTION });

    /** Records every UpdateItem the meter sends, so the counted attribute can be asserted. */
    function recordingDdb() {
      const sent = [];
      return {
        sent,
        ddb: {
          send: async (cmd) => {
            sent.push(cmd.input);
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

    let recorder;

    beforeEach(() => {
      process.env.USAGE_TABLE = 'beanies-ai-usage-test';
      recorder = recordingDdb();
      __setDdbClientForTests(recorder.ddb);
    });

    afterEach(() => {
      delete process.env.USAGE_TABLE;
      delete process.env.CORRECTION_GRANTS;
      __setDdbClientForTests(null);
    });

    /** Which usage attributes were incremented, in order. */
    const counted = () =>
      recorder.sent
        .filter((i) => i.TableName === 'beanies-ai-usage-test')
        .map((i) => i.ExpressionAttributeNames?.['#n']);

    it('counts exactly one read on a 200', async () => {
      globalThis.fetch = async () => fakeUpstream({ content: SHARE });
      const res = await handler(
        makeEvent({
          headers: keyHeader,
          body: { ...goodBody, task: 'share', familyId: 'fam-handler-01' },
        })
      );
      assert.equal(res.statusCode, 200);
      assert.deepEqual(counted(), [USAGE_ATTRS.charged]);
    });

    it('counts NOTHING on a refusal before the model', async () => {
      // No api key — 401, returned long before anything reaches the model.
      const res = await handler(makeEvent({ body: { ...goodBody, familyId: 'fam-handler-01' } }));
      assert.equal(res.statusCode, 401);
      assert.deepEqual(counted(), [], 'a read that never happened is not a bean');
    });

    it('counts NOTHING when the model returns wrong-shape output', async () => {
      globalThis.fetch = async () => fakeUpstream({ content: JSON.stringify({ nope: true }) });
      const res = await handler(
        makeEvent({
          headers: keyHeader,
          body: { ...goodBody, task: 'share', familyId: 'fam-handler-01' },
        })
      );
      assert.equal(res.statusCode, 502);
      assert.deepEqual(counted(), [], 'we pay for this one, the family does not');
    });

    it('counts NOTHING when a CORRECTION comes back as the wrong kind', async () => {
      // ⚠️ The regression this pins: the kind check once sat AFTER `closeRead`, so a correction
      // the model answered wrongly was recorded as a free correction on a 502 that returned the
      // user nothing. Every other 502 here counts in neither column; this must match.
      process.env.RATE_TABLE = 'beanies-ai-rate-test';
      process.env.CORRECTION_GRANTS = '1';
      globalThis.fetch = async () => fakeUpstream({ content: SHARE }); // kind: 'event'
      const res = await handler(
        makeEvent({
          headers: keyHeader,
          body: {
            ...goodBody,
            task: 'share',
            familyId: 'fam-handler-01',
            correction: { token: '11111111-2222-3333-4444-555555555555', to: 'recipe' },
          },
        })
      );
      delete process.env.RATE_TABLE;
      assert.equal(res.statusCode, 502);
      assert.deepEqual(counted(), []);
    });

    it('REFUSES a correction whose grant was not spent, rather than charging for it', async () => {
      // Without the refusal it falls through as an ordinary read: the hint is dropped, so at
      // temperature 0 on the same bytes the model returns the same wrong kind, `n` is charged,
      // and the client has already discarded the token — the user tapped a button labelled
      // free, paid for it, got the same answer, and lost the affordance.
      process.env.RATE_TABLE = 'beanies-ai-rate-test';
      process.env.CORRECTION_GRANTS = '1';
      recorder.ddb.send = async () => {
        const err = new Error('condition failed');
        err.name = 'ConditionalCheckFailedException';
        throw err;
      };
      let upstreamCalls = 0;
      globalThis.fetch = async () => {
        upstreamCalls += 1;
        return fakeUpstream({ content: SHARE });
      };

      const res = await handler(
        makeEvent({
          headers: keyHeader,
          body: {
            ...goodBody,
            task: 'share',
            familyId: 'fam-handler-01',
            correction: { token: '11111111-2222-3333-4444-555555555555', to: 'recipe' },
          },
        })
      );

      delete process.env.RATE_TABLE;
      assert.equal(res.statusCode, 409);
      assert.equal(JSON.parse(res.body).code, 'correction_refused');
      assert.equal(upstreamCalls, 0, 'a refused correction must not reach the model at all');
    });

    it('does NOT read at all when a correction arrives on a non-share task', async () => {
      // A grant is bound to the family, the document and the kind — but not to a TASK. Without
      // this fence a grant earned on `share` is spendable on `recipe`: the builder ignores the
      // hint, the model is CALLED AND BILLED, the result carries no `kind`, and the wrong-kind
      // guard 502s a request that could never have succeeded. Deterministic, and on a path no
      // UI produces.
      process.env.RATE_TABLE = 'beanies-ai-rate-test';
      process.env.CORRECTION_GRANTS = '1';
      let upstreamCalls = 0;
      globalThis.fetch = async () => {
        upstreamCalls += 1;
        return fakeUpstream({ content: SHARE });
      };

      const res = await handler(
        makeEvent({
          headers: keyHeader,
          body: {
            ...goodBody,
            task: 'recipe',
            familyId: 'fam-handler-01',
            correction: { token: '11111111-2222-3333-4444-555555555555', to: 'travel' },
          },
        })
      );

      delete process.env.RATE_TABLE;
      assert.equal(res.statusCode, 400);
      assert.equal(upstreamCalls, 0, 'nothing may reach the model, and nothing may be billed');
      assert.equal(recorder.sent.length, 0, 'and the grant must not be touched');
    });

    it('says DISAGREED, not malformed, when the model declines an asserted kind', async () => {
      // Observed live: correcting a parents-evening notice to `travel` comes back `none`, which
      // is the one way out the hinted prompt leaves. `model_shape` renders as "couldn't make
      // sense of that one, try a clearer photo" — false about a perfectly legible document, and
      // it invites a retry that costs a bean.
      process.env.RATE_TABLE = 'beanies-ai-rate-test';
      process.env.CORRECTION_GRANTS = '1';
      globalThis.fetch = async () => fakeUpstream({ content: JSON.stringify({ kind: 'none' }) });

      const res = await handler(
        makeEvent({
          headers: keyHeader,
          body: {
            ...goodBody,
            task: 'share',
            familyId: 'fam-handler-01',
            correction: { token: '11111111-2222-3333-4444-555555555555', to: 'recipe' },
          },
        })
      );

      delete process.env.RATE_TABLE;
      assert.equal(res.statusCode, 422);
      assert.equal(JSON.parse(res.body).code, 'correction_disagreed');
      assert.deepEqual(counted(), [], 'a disagreement is still not a read anyone pays for');
    });

    it('still says model_shape when the model returns a DIFFERENT kind', async () => {
      // The model was told not to re-decide the category. Coming back with a third kind is a
      // genuine shape failure, and must not be softened into a disagreement.
      process.env.RATE_TABLE = 'beanies-ai-rate-test';
      process.env.CORRECTION_GRANTS = '1';
      globalThis.fetch = async () => fakeUpstream({ content: SHARE }); // kind: 'event'

      const res = await handler(
        makeEvent({
          headers: keyHeader,
          body: {
            ...goodBody,
            task: 'share',
            familyId: 'fam-handler-01',
            correction: { token: '11111111-2222-3333-4444-555555555555', to: 'recipe' },
          },
        })
      );

      delete process.env.RATE_TABLE;
      assert.equal(res.statusCode, 502);
      assert.equal(JSON.parse(res.body).code, 'model_shape');
    });

    it('issues no grant when the feature is switched off', async () => {
      globalThis.fetch = async () => fakeUpstream({ content: SHARE });
      const res = await handler(
        makeEvent({
          headers: keyHeader,
          body: { ...goodBody, task: 'share', familyId: 'fam-handler-01' },
        })
      );
      assert.equal(JSON.parse(res.body).correction, undefined);
    });
  });

  describe('misconfiguration', () => {
    it('returns 500 when TINFOIL_API_KEY is unset', async () => {
      delete process.env.TINFOIL_API_KEY;
      const mod = await import(`../index.mjs?t=${Date.now()}-${Math.random()}-b`);
      const res = await mod.handler(makeEvent({ headers: keyHeader, body: goodBody }));
      assert.equal(res.statusCode, 500);
    });
  });
});
