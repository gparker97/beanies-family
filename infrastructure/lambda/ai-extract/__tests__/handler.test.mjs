/* global process, Buffer */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { __setRateLimitClientForTests } from '../rateLimit.mjs';
import { USAGE_ATTRS, __setDdbClientForTests } from '../ddb.mjs';
import { ALARMING_PREFIXES } from '../meter.mjs';

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

      it('does NOT write the ADR-030 retirement counter for a shed request', async () => {
        /**
         * ⚠️ THE SUNSET GATE DEPENDS ON THIS. ADR-030 step 3 allows deleting the plaintext arm
         * once `[ai-extract] legacy plaintext request` reads ZERO for a release cycle. The log
         * line sat ABOVE the 429 return, so every rate-limited attempt still wrote it — and
         * the `x-api-key` ships in the public bundle, so one throttled scanner kept the gate
         * permanently unsatisfiable and made "un-updated store builds still extracting" (do
         * not delete) indistinguishable from "a bot being shed" (safe to delete).
         *
         * The comment above the line has claimed "after the LAST pre-model refusal" since
         * before it was true. This is the assertion that makes it so.
         */
        const lines = [];
        const original = console.log;
        console.log = (...a) => lines.push(a.map(String).join(' '));
        let res;
        try {
          res = parseResponse(
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
        } finally {
          console.log = original;
        }

        assert.equal(res.statusCode, 429, 'precondition: the request must actually be shed');
        assert.ok(
          !lines.some((l) => l.startsWith('[ai-extract] legacy plaintext request')),
          'a shed request must not count toward the retirement gate'
        );
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
      // A grant is bound to the family, the document, its size and the issuing arm — but not to
      // a TASK. Without
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

  // ── The sealed arm (#49) ────────────────────────────────────────────────────────────────
  //
  // Every case here is NEW. Nothing above changed, which is the proof that extracting
  // `upstream.mjs` and adding the router left the legacy arm byte-for-byte as it was.
  describe('sealed arm — the blind forwarder', () => {
    const SEALED = Buffer.from('pretend-ciphertext').toString('base64');
    const sealedBody = (over = {}) => ({
      protocol: 'ehbp-1',
      familyId: 'fam-sealed-01',
      task: 'share',
      srcHash: 'a'.repeat(64),
      sealed: SEALED,
      ...over,
    });

    /** A sealed upstream reply: opaque bytes plus its own ehbp headers. */
    function fakeSealedUpstream({ ok = true, status = 200, headers = {} } = {}) {
      const all = {
        'ehbp-response-nonce': 'nonce-xyz',
        'content-type': 'application/octet-stream',
        ...headers,
      };
      return {
        ok,
        status,
        headers: {
          get: (k) => all[String(k).toLowerCase()] ?? null,
          entries: () => Object.entries(all),
        },
        arrayBuffer: async () => new TextEncoder().encode('sealed-reply').buffer,
      };
    }

    it('forwards the decoded bytes and returns the sealed reply, never a result', async () => {
      let seen;
      globalThis.fetch = async (url, init) => {
        seen = { url, init };
        return fakeSealedUpstream();
      };

      const res = parseResponse(
        await handler(makeEvent({ headers: keyHeader, body: sealedBody() }))
      );

      assert.equal(res.statusCode, 200);
      assert.ok(res.parsedBody.sealed, 'the reply is sealed');
      assert.equal(res.parsedBody.result, undefined, 'we cannot produce a result we cannot read');
      assert.equal(res.parsedBody.attestation, undefined, 'the client verified it, not us');
      // The body that went upstream is the DECODED ciphertext, not our JSON envelope.
      assert.ok(Buffer.isBuffer(seen.init.body) || seen.init.body instanceof Uint8Array);
      assert.equal(Buffer.from(seen.init.body).toString(), 'pretend-ciphertext');
    });

    it('relays ehbp-* headers upstream and back, and NEVER a credential', async () => {
      let seen;
      globalThis.fetch = async (url, init) => {
        seen = init;
        return fakeSealedUpstream();
      };

      const res = parseResponse(
        await handler(
          makeEvent({
            headers: keyHeader,
            body: sealedBody({
              ehbp: {
                'ehbp-encapsulated-key': 'KEY',
                // Every one of these must be dropped. A relayed Authorization would overwrite our
                // Tinfoil key; a relayed X-Tinfoil-Enclave-Url would let anyone holding the
                // bundle's api key point that key at a host of their choosing.
                Authorization: 'Bearer stolen',
                'x-api-key': 'stolen',
                Cookie: 'session=stolen',
                'X-Tinfoil-Enclave-Url': 'https://evil.example',
              },
            }),
          })
        )
      );

      assert.equal(seen.headers['ehbp-encapsulated-key'], 'KEY', 'the protocol header crosses');
      assert.equal(seen.headers.Authorization, 'Bearer tinfoil-secret', 'OUR key, not theirs');
      assert.ok(!('x-api-key' in seen.headers), 'no api key upstream');
      assert.ok(!('Cookie' in seen.headers), 'no cookie upstream');
      assert.ok(
        !Object.keys(seen.headers).some((h) => /tinfoil-enclave-url/i.test(h)),
        'never let a caller name the enclave'
      );
      assert.equal(res.parsedBody.ehbp['ehbp-response-nonce'], 'nonce-xyz', 'and back again');
    });

    it('refuses an unknown protocol with a code the client can act on', async () => {
      const res = parseResponse(
        await handler(makeEvent({ headers: keyHeader, body: sealedBody({ protocol: 'ehbp-9' }) }))
      );
      assert.equal(res.statusCode, 400);
      assert.equal(res.parsedBody.code, 'unknown_protocol');
    });

    it('still serves a legacy body with no protocol — the whole reason that arm survives', async () => {
      globalThis.fetch = async () => fakeUpstream();
      const res = parseResponse(await handler(makeEvent({ headers: keyHeader, body: goodBody })));
      assert.equal(res.statusCode, 200);
      assert.ok(res.parsedBody.result, 'the old path still produces a parsed result');
    });

    it('refuses a malformed sealed envelope before any upstream call', async () => {
      let called = false;
      globalThis.fetch = async () => {
        called = true;
        return fakeSealedUpstream();
      };

      for (const over of [{ sealed: '' }, { task: '' }, { srcHash: '' }]) {
        const res = parseResponse(
          await handler(makeEvent({ headers: keyHeader, body: sealedBody(over) }))
        );
        assert.equal(res.statusCode, 400, JSON.stringify(over));
      }
      assert.equal(called, false, 'nothing billable ran');
    });

    it('REFUSES a prototype-shaped or alarm-shaped task rather than logging it', async () => {
      globalThis.fetch = async () => fakeSealedUpstream();
      const hostile = [
        '__proto__', // leading underscore fails the charset
        'toString', // uppercase fails it
        // Exactly 32 characters, and exactly a CloudWatch metric-filter term that pages a human.
        // A length-only bound would have let this through; the SPACE is what the charset stops.
        'usage-count skipped',
        'x\n[ai-extract] correction refused reason=different_source',
      ];
      for (const task of hostile) {
        const res = parseResponse(
          await handler(
            makeEvent({ headers: keyHeader, body: sealedBody({ task, correction: undefined }) })
          )
        );
        assert.equal(res.statusCode, 400, task);
        assert.equal(res.parsedBody.code, 'bad_task', task);
      }
    });

    it('allows `constructor` as a task, because here it is a LABEL and never a key', async () => {
      globalThis.fetch = async () => fakeSealedUpstream();
      const res = await handler(
        makeEvent({ headers: keyHeader, body: sealedBody({ task: 'constructor' }) })
      );
      // It passes the charset, and that is correct rather than an oversight: this arm looks
      // nothing up by task, so the prototype-chain bug the legacy arm hit cannot occur. Asserted
      // so nobody "hardens" it into a denial that would refuse a legitimate future task name.
      assert.equal(res.statusCode, 200);
    });

    it('never lets a client-supplied header name forge an alarm line', async () => {
      const warned = [];
      const realWarn = console.warn;
      console.warn = (m) => warned.push(String(m));
      globalThis.fetch = async () => fakeSealedUpstream();
      try {
        await handler(
          makeEvent({
            headers: keyHeader,
            body: sealedBody({
              ehbp: {
                'x\n[ai-extract] correction refused reason=different_source family_hash=dead': '',
              },
            }),
          })
        );
      } finally {
        console.warn = realWarn;
      }
      // Metric filters match a quoted substring ANYWHERE in a line, so a newline in a client
      // string is an alarm-forging primitive. The sanitiser must flatten it.
      assert.ok(
        warned.every((line) => !line.includes('\n')),
        'no client newline may reach a log line'
      );
      assert.ok(
        !warned.some((l) => l.includes('correction refused reason=different_source')),
        'and the forged alarm term must not survive intact'
      );
    });

    it('classifies an upstream failure with the same ladder as the legacy arm', async () => {
      globalThis.fetch = async () => fakeSealedUpstream({ ok: false, status: 503 });
      const res = parseResponse(
        await handler(makeEvent({ headers: keyHeader, body: sealedBody() }))
      );
      assert.equal(res.statusCode, 503);
      assert.equal(res.parsedBody.code, 'upstream_unavailable');
    });

    it('classifies an oversized body so the client can say WHY', async () => {
      const huge = 'x'.repeat(5 * 1024 * 1024 + 10);
      const res = parseResponse(
        await handler(makeEvent({ headers: keyHeader, body: sealedBody({ sealed: huge }) }))
      );
      assert.equal(res.statusCode, 413);
      assert.equal(res.parsedBody.code, 'payload_too_large');
    });

    it('refuses a non-object `ehbp` instead of enumerating it character by character', async () => {
      // ⚠️ THE OOM. `Object.entries(source || {})` materialises the ENTIRE value before the
      // `seen` bound in the loop body can run, and `Object.entries` on a string yields one
      // [index, char] pair per character. `ehbp: "<4.5MB string>"` therefore allocates ~4.5M
      // two-element arrays in a 256MB Lambda and the process DIES — reproduced with
      // `node --max-old-space-size=256 -e "Object.entries('a'.repeat(4500000))"`.
      //
      // Because the process dies rather than throwing, the arm's own try/catch never runs and
      // API Gateway returns a bare 502 with no CORS headers, which pages #beanies-errors. A
      // bound that runs after the allocation is not a bound.
      let upstreamCalls = 0;
      globalThis.fetch = async () => {
        upstreamCalls += 1;
        return fakeSealedUpstream();
      };

      for (const bad of ['a-long-string', ['x'], 42]) {
        const res = parseResponse(
          await handler(makeEvent({ headers: keyHeader, body: sealedBody({ ehbp: bad }) }))
        );
        assert.equal(res.statusCode, 400, `ehbp: ${JSON.stringify(bad)} must be refused`);
        assert.equal(res.parsedBody.code, 'bad_ehbp');
      }
      assert.equal(upstreamCalls, 0, 'and none of them reach the enclave');
    });

    it('still accepts an absent `ehbp`, which is the ordinary case', async () => {
      globalThis.fetch = async () => fakeSealedUpstream();
      const res = await handler(makeEvent({ headers: keyHeader, body: sealedBody() }));
      assert.equal(res.statusCode, 200);
    });

    it('drops a header VALUE that would make the upstream fetch throw', async () => {
      // ⚠️ Header NAMES were validated (regex, bounded count) and VALUES were not, so a
      // caller-supplied `'a\r\nb'` — or any codepoint above 255 — reached `fetch(...)`, where
      // undici throws ("invalid header value" / "Cannot convert argument to a ByteString").
      // `callUpstream` classifies that as `upstream_network` → 502, and because the relay ran
      // AFTER `openRead` the family's free correction was already spent: no model call, a
      // charged-feeling failure, and CloudWatch pointing whoever triages it at Tinfoil.
      //
      // Dropping is the right verdict rather than a 400: it matches what happens to every other
      // header that fails the prefix rule, and it keeps a forward-compatible `ehbp` version from
      // being refused outright over one value we did not expect.
      let seen;
      globalThis.fetch = async (url, init) => {
        seen = init;
        return fakeSealedUpstream();
      };

      const res = await handler(
        makeEvent({
          headers: keyHeader,
          body: sealedBody({
            ehbp: {
              'ehbp-encapsulated-key': 'GOOD',
              'ehbp-crlf': 'a\r\nb',
              'ehbp-unicode': 'caf\u00e9\u4e2d\u6587',
              'ehbp-huge': 'x'.repeat(10_000),
            },
          }),
        })
      );

      assert.equal(res.statusCode, 200, 'a bad value must not fail the whole request');
      const relayed = Object.keys(seen.headers).filter((h) => /^ehbp-/i.test(h));
      assert.deepEqual(relayed, ['ehbp-encapsulated-key'], 'only the sane value is relayed');
    });

    it('decides what to relay BEFORE the grant is consumed', async () => {
      // Ordering, stated as its own case because the file's own rule says so 40 lines up:
      // "anything that can reject the request must happen first or a malformed body spends the
      // family's free correction". That was honoured for the base64 decode and for the `ehbp`
      // shape, and not for its values.
      const order = [];
      const origWarn = console.warn;
      console.warn = (...a) => {
        const line = a.map(String).join(' ');
        if (line.includes('dropped')) order.push('relay');
        origWarn(...a);
      };
      __setDdbClientForTests({
        send: async (cmd) => {
          if (cmd.input.ConditionExpression?.includes('#consumed')) order.push('consume');
          return {};
        },
        commands: {
          UpdateItemCommand: class {
            constructor(input) {
              this.input = input;
            }
          },
        },
      });
      process.env.RATE_TABLE = 'beanies-ai-rate-test';
      process.env.CORRECTION_GRANTS = '1';
      globalThis.fetch = async () => fakeSealedUpstream();

      try {
        await handler(
          makeEvent({
            headers: keyHeader,
            body: sealedBody({
              correction: { token: '11111111-2222-3333-4444-555555555555' },
              ehbp: { 'ehbp-ok': 'v', 'not-ehbp': 'dropped-for-its-name' },
            }),
          })
        );
      } finally {
        console.warn = origWarn;
        __setDdbClientForTests(null);
        delete process.env.RATE_TABLE;
        delete process.env.CORRECTION_GRANTS;
      }

      assert.deepEqual(order, ['relay', 'consume'], 'the relay decision comes first');
    });

    it('does not let junk keys starve the real ehbp header out of the budget', async () => {
      // ⚠️ `relayEhbpHeaders` DROPS, it never refuses — so a starved header does not fail the
      // request, it proceeds into `openRead`, spends the family's one-use grant, and pays
      // Tinfoil for ciphertext the enclave cannot decapsulate. The encapsulated key is listed
      // LAST here on purpose, behind more junk than the old `seen` bound allowed.
      let seen;
      globalThis.fetch = async (url, init) => {
        seen = init;
        return fakeSealedUpstream();
      };
      const junk = Object.fromEntries(
        Array.from({ length: 300 }, (_, i) => [`not-ehbp-${i}`, 'x'])
      );

      const res = await handler(
        makeEvent({
          headers: keyHeader,
          body: sealedBody({ ehbp: { ...junk, 'ehbp-encapsulated-key': 'REAL' } }),
        })
      );

      assert.equal(res.statusCode, 200);
      assert.equal(
        seen.headers['ehbp-encapsulated-key'],
        'REAL',
        'the real header must survive any amount of junk in front of it'
      );
    });

    it('does not let PREFIX-MATCHING junk starve the real ehbp header', async () => {
      /**
       * ⚠️ THE CASE THE SIBLING TEST ABOVE CANNOT REACH. It builds its junk as `not-ehbp-${i}`,
       * which fails the prefix test and never touches the `kept` counter — so it passed
       * throughout, while sixteen keys that DO match the prefix filled the budget and the
       * seventeenth, the encapsulated key, fell into the drop arm. Proven before the fix:
       *
       *     kept: 16 | real header relayed? false
       *
       * Moving the bound onto the input (MAX_EHBP_KEYS) did not help: 17 keys is far under the
       * ceiling. The required header is now admitted before the budgeted walk.
       */
      let seen;
      globalThis.fetch = async (url, init) => {
        seen = init;
        return fakeSealedUpstream();
      };
      const junk = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`ehbp-junk${i}`, 'x']));

      const res = await handler(
        makeEvent({
          headers: keyHeader,
          body: sealedBody({ ehbp: { ...junk, 'ehbp-encapsulated-key': 'REAL' } }),
        })
      );

      assert.equal(res.statusCode, 200);
      assert.equal(
        seen.headers['ehbp-encapsulated-key'],
        'REAL',
        'the real header must survive junk that also matches the ehbp- prefix'
      );
    });

    it('refuses, rather than spending the grant, when nothing is relayable', async () => {
      // `relayEhbpHeaders` DROPS by design so a protocol upgrade does not look like a malformed
      // request. But an `ehbp` that arrived with content and relayed NOTHING — over the key
      // ceiling, or every value failing its bounds — cannot be an upgrade. Left unchecked it
      // sailed past `openRead`, which atomically spends the family's one-use grant, and on to
      // `callUpstream`, which bills Tinfoil to decapsulate ciphertext with no key.
      const tooMany = Object.fromEntries(
        Array.from({ length: 2100 }, (_, i) => [`ehbp-k${i}`, 'x'])
      );
      const res = await handler(
        makeEvent({ headers: keyHeader, body: sealedBody({ ehbp: tooMany }) })
      );
      assert.equal(res.statusCode, 400);
      assert.equal(JSON.parse(res.body).code, 'bad_ehbp');
    });

    it('cannot be used to forge an alarm literal through a header NAME', async () => {
      // ⚠️ A caller picks the key names in `ehbp`, and a dropped one is echoed into a warn line.
      // Stripping control characters and bounding the length was not enough: every one of our
      // alarm literals is printable ASCII under 48 characters, and main.tf matches them as
      // SUBSTRINGS at threshold 1 — so one request with the api key that ships in the public
      // bundle could page #beanies-errors with a fabricated incident.
      const lines = [];
      const original = console.warn;
      console.warn = (...a) => lines.push(a.map(String).join(' '));
      globalThis.fetch = async () => fakeSealedUpstream();
      try {
        await handler(
          makeEvent({
            headers: keyHeader,
            body: sealedBody({
              ehbp: {
                '[ai-extract] usage-count write failed': 'x',
                '[ai-extract] correction refused reason=different_source': 'x',
              },
            }),
          })
        );
      } finally {
        console.warn = original;
      }

      const all = lines.join('\n');
      for (const literal of Object.values(ALARMING_PREFIXES)) {
        assert.ok(
          !all.includes(literal),
          `a caller reproduced the alarm literal "${literal}" in our own logs:\n${all}`
        );
      }
    });

    describe('metering, limiting and corrections — wired, not assumed', () => {
      // ⚠️ WHY THIS BLOCK EXISTS. Every test above runs with no `USAGE_TABLE`, no `RATE_TABLE`
      // and no `CORRECTION_GRANTS`, so on the sealed arm the limiter, the meter and the grant
      // store were all no-ops and three acceptance criteria were asserted nowhere. The proof it
      // mattered: deleting `srcBytes: bytes.length` from sealedForward.mjs — the unforgeable
      // half of the sealed arm's source binding — left the entire lambda suite green.
      //
      // A test that passes because the code under test was switched off is worse than no test:
      // it reports coverage it does not have. Wire the dependencies, then assert.
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
        process.env.RATE_TABLE = 'beanies-ai-rate-test';
        process.env.CORRECTION_GRANTS = '1';
        recorder = recordingDdb();
        __setDdbClientForTests(recorder.ddb);
        globalThis.fetch = async () => fakeSealedUpstream();
      });

      afterEach(() => {
        delete process.env.USAGE_TABLE;
        delete process.env.RATE_TABLE;
        delete process.env.CORRECTION_GRANTS;
        __setDdbClientForTests(null);
      });

      /** Which usage attributes were incremented, in order — matching the legacy arm's helper. */
      const counted = () =>
        recorder.sent
          .filter((i) => i.TableName === 'beanies-ai-usage-test')
          .map((i) => i.ExpressionAttributeNames?.['#n']);

      it('counts exactly one bean, on the CHARGED attribute, when the enclave answers', async () => {
        const res = await handler(makeEvent({ headers: keyHeader, body: sealedBody() }));

        assert.equal(res.statusCode, 200);
        // Finding M: on this arm the bean is spent when the enclave ANSWERED, not when we could
        // read the answer — we cannot read it at all.
        assert.deepEqual(counted(), [USAGE_ATTRS.charged], 'one charged count, and only one');
      });

      it('counts NOTHING when the enclave does not answer', async () => {
        globalThis.fetch = async () => fakeSealedUpstream({ ok: false, status: 503 });

        const res = await handler(makeEvent({ headers: keyHeader, body: sealedBody() }));

        assert.notEqual(res.statusCode, 200);
        // "Timeouts and refusals cost nothing" stays true on this arm, because a non-200
        // upstream never reaches closeRead. Only the UNREADABLE-answer case changed.
        assert.deepEqual(counted(), [], 'a read the enclave refused is free');
      });

      it('binds the grant to the ciphertext it actually measured', async () => {
        // ⚠️ THE REGRESSION GUARD. `srcBytes` is the half of the sealed arm's source binding a
        // caller cannot forge (`srcHash` there is client-supplied). Deleting it used to change
        // nothing observable in this suite, which is how the cheap-buys-expensive bypass
        // survived review. Assert the measured number reaches the grant.
        await handler(makeEvent({ headers: keyHeader, body: sealedBody() }));

        const grant = recorder.sent.find((i) => i.ExpressionAttributeValues?.[':bytes']);
        assert.ok(grant, 'a grant must be issued for a counted share read');
        assert.equal(
          grant.ExpressionAttributeValues[':bytes'].N,
          String(Buffer.from(SEALED, 'base64').length),
          'the grant must carry the ciphertext length this Lambda measured'
        );
        assert.equal(
          grant.ExpressionAttributeValues[':arm'].S,
          'sealed',
          'and the arm that measured it, so it cannot be spent against the legacy number'
        );
      });

      it('rate-limits a sealed request, which carries no text to gate on', async () => {
        // The `hasText` gate died with plaintext: ciphertext hides the source kind, so the
        // limiter must run for EVERY sealed request. ADR-030 names this as THE compensating
        // control for the `sources` fence that ciphertext retires permanently — without it the
        // proxy is a general-purpose text-LLM endpoint for anyone holding the api key that ships
        // in the public bundle.
        //
        // ⚠️ THIS ASSERTION USED TO BE A TAUTOLOGY. It counted sends through
        // `__setRateLimitClientForTests`, which rateLimit.mjs:87 re-exports as literally the
        // SAME seam as `__setDdbClientForTests` — so the meter's own writes satisfied it, and
        // replacing `checkLimits(...)` with `{ allowed: true }` left the test green. Assert on
        // the rate table's own key grammar instead, the way the legacy limiter tests already do.
        const event = makeEvent({ headers: keyHeader, body: sealedBody() });
        event.requestContext = { http: { method: 'POST', sourceIp: '203.0.113.7' } };
        await handler(event);

        const rateKeys = recorder.sent
          .filter((i) => i.TableName === 'beanies-ai-rate-test')
          .map((i) => i.Key?.pk?.S ?? '');
        assert.ok(
          rateKeys.some((k) => k.startsWith('f#')),
          `no per-family rate-limit write was made (keys seen: ${JSON.stringify(rateKeys)})`
        );
        assert.ok(
          rateKeys.some((k) => k.startsWith('i#')),
          `no per-IP rate-limit write was made (keys seen: ${JSON.stringify(rateKeys)})`
        );
      });

      it('validates and spends a token-only correction', async () => {
        // The sealed envelope carries `correction: { token }` and deliberately no `to` — the
        // closed-set check on `to` existed only because it reached the model's instruction
        // server-side, which it cannot do now. Sending it would leak the family's own assertion
        // about their document in cleartext for no remaining purpose.
        const res = await handler(
          makeEvent({
            headers: keyHeader,
            body: sealedBody({
              correction: { token: '11111111-2222-3333-4444-555555555555' },
            }),
          })
        );

        assert.equal(res.statusCode, 200);
        const spend = recorder.sent.find((i) => i.ConditionExpression?.includes('#consumed'));
        assert.ok(spend, 'the grant store must actually be asked');
        assert.match(spend.ConditionExpression, /#arm = :arm/, 'pinned to the arm');
        assert.equal(spend.ExpressionAttributeValues[':arm'].S, 'sealed');
      });

      it('refuses a correction whose grant the store rejected, rather than charging for it', async () => {
        recorder.ddb.send = async (cmd) => {
          if (cmd.input.ConditionExpression?.includes('#consumed')) {
            const err = new Error('condition failed');
            err.name = 'ConditionalCheckFailedException';
            throw err;
          }
          return {};
        };
        let upstreamCalls = 0;
        globalThis.fetch = async () => {
          upstreamCalls += 1;
          return fakeSealedUpstream();
        };

        const res = parseResponse(
          await handler(
            makeEvent({
              headers: keyHeader,
              body: sealedBody({
                correction: { token: '11111111-2222-3333-4444-555555555555' },
              }),
            })
          )
        );

        assert.equal(res.statusCode, 409);
        assert.equal(res.parsedBody.code, 'correction_refused');
        assert.equal(upstreamCalls, 0, 'a refused correction must not reach the enclave at all');
      });
    });
  });

  describe('a grant we cannot evaluate must not deny the read', () => {
    // ⚠️ THE DEPLOY WINDOW. Every grant minted before the size band shipped carries neither
    // `bytes` nor `arm`, so for one GRANT_TTL_SECONDS (3600s) after the deploy the condition
    // cannot be evaluated honestly. That is OUR doing, not the family's.
    //
    // Flattening it to `reason: 'refused'` sent it down the hard-409 path, where the family who
    // paid for a read at 13:40 and tapped the free-correction banner at 14:05 got
    // "That free re-read has already been used, or it was for a different document" — wrong on
    // both counts — no read at all, and a discarded token so the affordance is gone. ADR-030
    // says they pay a bean for that one re-read; this is what makes that true.
    //
    // The same applies to `different_arm` (they updated the app mid-hour) and to the fail-closed
    // guard for a caller that reached consumeGrant with no measurement, which is a programming
    // error. `spent` / `expired` / `different_source` / `different_size` stay hard refusals:
    // those ARE the family spending something they do not have, and `different_size` is the
    // cheap-buys-expensive attempt.
    function recordingDdb(onSend) {
      const sent = [];
      return {
        sent,
        ddb: {
          send: async (cmd) => {
            sent.push(cmd.input);
            return onSend ? onSend(cmd) : {};
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

    /** A conditional failure carrying the OLD item, the way ALL_OLD returns it. */
    function conditionFailure(item) {
      return (cmd) => {
        if (!cmd.input.ConditionExpression?.includes('#consumed')) return {};
        const err = new Error('condition failed');
        err.name = 'ConditionalCheckFailedException';
        err.Item = item;
        throw err;
      };
    }

    const body = {
      text: 'Ollie party Sat 2pm at the hall',
      todayIso: '2026-09-16',
      task: 'share',
      familyId: 'fam-window',
      correction: { token: '11111111-2222-3333-4444-555555555555', to: 'event' },
    };

    beforeEach(() => {
      process.env.USAGE_TABLE = 'beanies-ai-usage-test';
      process.env.RATE_TABLE = 'beanies-ai-rate-test';
      process.env.CORRECTION_GRANTS = '1';
      globalThis.fetch = async () =>
        fakeUpstream({ content: JSON.stringify({ kind: 'event', event: VALID_EXTRACTION }) });
    });
    afterEach(() => {
      delete process.env.USAGE_TABLE;
      delete process.env.RATE_TABLE;
      delete process.env.CORRECTION_GRANTS;
      __setDdbClientForTests(null);
    });

    it('charges the read when the grant predates the size band, rather than 409ing', async () => {
      // A pre-#49 grant: right document, right family, but no `bytes` and no `arm`.
      const stub = recordingDdb(
        conditionFailure({
          src: { S: createHash('sha256').update(`t:${body.text}`).digest('hex') },
          expires_at: { N: String(Math.floor(Date.now() / 1000) + 3600) },
        })
      );
      __setDdbClientForTests(stub.ddb);

      const res = await handler(makeEvent({ headers: keyHeader, body }));

      assert.equal(res.statusCode, 200, 'the family must still get their re-read');
      const counted = stub.sent
        .filter((i) => i.TableName === 'beanies-ai-usage-test')
        .map((i) => i.ExpressionAttributeNames?.['#n']);
      assert.deepEqual(
        counted,
        [USAGE_ATTRS.charged],
        'and it is charged, exactly as ADR-030 says'
      );
    });

    it('HINTS the re-read it charges for, or charging is indefensible', async () => {
      // ⚠️ THE HALF OF THE POLICY THAT MAKES CHARGING DEFENSIBLE. A soft refusal serves the read
      // and bills for it. Without the hint the model, at temperature 0 on the same bytes,
      // returns the SAME wrong answer — so the family pays for a repeat of the thing they were
      // correcting, which is strictly worse for them than the 409 this replaced.
      //
      // ⚠️ Asserted by DIFFERENCE, not by substring. A first version checked that the prompt
      // contained "event" and passed with the hint removed, because the share prompt enumerates
      // every kind anyway. Comparing the hinted prompt against the unhinted one for the same
      // source is discriminating by construction.
      const promptFor = async (reqBody, ddb) => {
        let sent;
        globalThis.fetch = async (_url, init) => {
          sent = JSON.parse(init.body);
          return fakeUpstream({
            content: JSON.stringify({ kind: 'event', event: VALID_EXTRACTION }),
          });
        };
        __setDdbClientForTests(ddb);
        await handler(makeEvent({ headers: keyHeader, body: reqBody }));
        return JSON.stringify(sent.messages);
      };

      const staleGrant = () =>
        recordingDdb(
          conditionFailure({
            src: { S: createHash('sha256').update(`t:${body.text}`).digest('hex') },
            expires_at: { N: String(Math.floor(Date.now() / 1000) + 3600) },
          })
        ).ddb;

      // Same document, same task. The ONLY difference is the correction.
      const plain = await promptFor(
        { text: body.text, todayIso: body.todayIso, task: 'share', familyId: body.familyId },
        recordingDdb().ddb
      );
      const softRefused = await promptFor(body, staleGrant());

      assert.notEqual(
        softRefused,
        plain,
        'a charged soft-refused correction produced the SAME prompt as an ordinary read — the ' +
          'hint never reached the model, so the family pays for a repeat of the wrong answer'
      );
    });

    it('still REFUSES a grant spent on a different-sized document', async () => {
      // The cheap-buys-expensive attempt. This one must not fall through to a charged read —
      // refusing is the whole point of the band.
      const stub = recordingDdb(
        conditionFailure({
          src: { S: createHash('sha256').update(`t:${body.text}`).digest('hex') },
          expires_at: { N: String(Math.floor(Date.now() / 1000) + 3600) },
          bytes: { N: '40' },
          arm: { S: 'legacy' },
        })
      );
      __setDdbClientForTests(stub.ddb);

      const res = parseResponse(await handler(makeEvent({ headers: keyHeader, body })));

      assert.equal(res.statusCode, 409);
      assert.equal(res.parsedBody.code, 'correction_refused');
    });
  });

  describe('the legacy arm measures the SOURCE, not the request envelope', () => {
    // ⚠️ THE REGRESSION THIS PINS, which is subtle and would have hit every current user.
    //
    // The grant's size band compares what was measured on the PAID read against what is measured
    // on the CORRECTION re-read. Those two requests carry the same document — but the correction
    // request also carries a `correction: { token, to }` field, roughly 75 extra bytes of JSON.
    //
    // Measure the whole `rawBody` and those 75 bytes are 75/L of the total, so the band (±5%)
    // only absorbs them once L exceeds ~1500 bytes. A short text share is ~100 bytes. Every one
    // of those corrections would have been refused, silently, on the arm every un-updated client
    // still uses — and the family would be charged for a re-read the UI promised was free.
    //
    // So the measurement must be of the SOURCE, which is byte-identical across both requests.
    const SHORT_TEXT = 'Ollie party Sat 2pm at the hall';

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
      process.env.RATE_TABLE = 'beanies-ai-rate-test';
      process.env.CORRECTION_GRANTS = '1';
      recorder = recordingDdb();
      __setDdbClientForTests(recorder.ddb);
      globalThis.fetch = async () =>
        fakeUpstream({ content: JSON.stringify({ kind: 'event', event: VALID_EXTRACTION }) });
    });
    afterEach(() => {
      delete process.env.USAGE_TABLE;
      delete process.env.RATE_TABLE;
      delete process.env.CORRECTION_GRANTS;
      __setDdbClientForTests(null);
    });

    it('bands a correction re-read around the size it measured on the paid read', async () => {
      // 1. The paid read. Its measurement is what the grant stores.
      await handler(
        makeEvent({
          headers: keyHeader,
          body: { text: SHORT_TEXT, todayIso: '2026-09-16', task: 'share', familyId: 'fam-l' },
        })
      );
      const issued = recorder.sent.find((i) => i.ExpressionAttributeValues?.[':bytes']);
      assert.ok(issued, 'the paid read must issue a grant');
      const storedBytes = Number(issued.ExpressionAttributeValues[':bytes'].N);

      // 2. The correction re-read of the SAME document, which carries an extra JSON field.
      recorder.sent.length = 0;
      await handler(
        makeEvent({
          headers: keyHeader,
          body: {
            text: SHORT_TEXT,
            todayIso: '2026-09-16',
            task: 'share',
            familyId: 'fam-l',
            correction: { token: '11111111-2222-3333-4444-555555555555', to: 'event' },
          },
        })
      );
      const spend = recorder.sent.find((i) => i.ConditionExpression?.includes('#consumed'));
      assert.ok(spend, 'the correction must ask the grant store');
      const lo = Number(spend.ExpressionAttributeValues[':lo'].N);
      const hi = Number(spend.ExpressionAttributeValues[':hi'].N);

      assert.ok(
        storedBytes >= lo && storedBytes <= hi,
        `the paid read measured ${storedBytes}, but the correction bands [${lo}, ${hi}] — ` +
          'the same document must land inside its own band, or every short-text correction is ' +
          'refused and charged'
      );
    });
  });

  describe('the LEGACY-PLAINTEXT-ARM deletion boundary is safe to act on', () => {
    // ⚠️ This guards a FUTURE edit — ADR-030 sunset step 4, "delete the marked block" — which is
    // the only kind of guard that can protect a runbook step nobody has performed yet. If that
    // deletion removes the handler's last `return`, every un-updated store build falls off the
    // end of the function and API Gateway answers a bare CORS-less 502.
    //
    // ⚠️ THE FIRST VERSION OF THIS TEST COULD NOT FAIL, and the way it failed is worth keeping.
    // It used `src.indexOf('LEGACY-PLAINTEXT-ARM ends')`, which matched the PROSE MENTION of
    // that marker inside the block's own opening comment ("Everything from here to
    // `LEGACY-PLAINTEXT-ARM ends` serves clients that predate…") — 2 lines after `begins`, not
    // 346. So it sliced from the top of the arm and found 21 `return response(` calls, and
    // deleting the real terminal return left it green. Mutation-proven, twice.
    //
    // Match the MARKER LINES, not the string: a `── … ──` banner comment is the marker, a
    // sentence mentioning it is not.
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../index.mjs'), 'utf8');
    const lines = src.split('\n');
    const markerLines = (word) =>
      lines
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => /^\s*\/\/ ── LEGACY-PLAINTEXT-ARM /.test(l) && l.includes(word));

    it('has exactly one begins marker and one ends marker, in that order', () => {
      const begins = markerLines('begins');
      const ends = markerLines('ends');
      assert.equal(begins.length, 1, `expected one begins marker, found ${begins.length}`);
      assert.equal(ends.length, 1, `expected one ends marker, found ${ends.length}`);
      assert.ok(ends[0].i > begins[0].i, 'the closing marker must come after the opening one');
    });

    it('leaves a terminal return AFTER the ends marker, so deleting the block still returns', () => {
      const ends = markerLines('ends');
      // Correct in both states: once the arm is retired the markers are gone, and the property
      // that matters — the handler has a terminal return — must still be checked rather than
      // failing on a missing marker and reading as a regression in the change that retired it.
      const after = ends.length ? lines.slice(ends[0].i).join('\n') : src;
      assert.match(
        after,
        /return response\(/,
        'nothing returns after the deletable block — removing it per ADR-030 sunset step 4 would ' +
          'make the handler return undefined for every legacy request, which API Gateway renders ' +
          'as a 502 with no CORS headers'
      );
    });
  });

  describe('the retirement counter (ADR-030 sunset step 3)', () => {
    // ⚠️ WHAT THIS PROTECTS. ADR-030's sunset says "the legacy counter reads zero for a full
    // release cycle, THEN delete the legacy arm". Its Logs Insights query filters for the
    // literal below — and that literal was specified in the plan and never actually written, so
    // the query matched nothing and the counter read zero from the day it shipped. Anyone
    // following the runbook would have read "no legacy traffic, safe to delete" while every
    // un-updated store build was still depending on that arm.
    //
    // A retirement trigger that cannot be told apart from a broken one is worse than no trigger,
    // so the literal is pinned here rather than left to prose.
    const LEGACY_LINE = '[ai-extract] legacy plaintext request';

    it('logs the line ADR-030 counts, on a legacy request', async () => {
      const lines = [];
      const original = console.log;
      console.log = (...a) => lines.push(a.map(String).join(' '));
      globalThis.fetch = async () =>
        fakeUpstream({ content: JSON.stringify({ kind: 'event', event: VALID_EXTRACTION }) });
      try {
        await handler(makeEvent({ headers: keyHeader, body: { ...goodBody, task: 'share' } }));
      } finally {
        console.log = original;
      }

      assert.ok(
        lines.some((l) => l.startsWith(LEGACY_LINE)),
        `a legacy request must log "${LEGACY_LINE}" or the sunset condition can never be met`
      );
    });

    it('does NOT log it on a sealed request, or the counter never reaches zero', async () => {
      const lines = [];
      const original = console.log;
      console.log = (...a) => lines.push(a.map(String).join(' '));
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null, entries: () => [] },
        arrayBuffer: async () => new TextEncoder().encode('r').buffer,
      });
      try {
        await handler(
          makeEvent({
            headers: keyHeader,
            body: {
              protocol: 'ehbp-1',
              familyId: 'f',
              task: 'share',
              srcHash: 'a'.repeat(64),
              sealed: Buffer.from('c').toString('base64'),
            },
          })
        );
      } finally {
        console.log = original;
      }

      assert.ok(!lines.some((l) => l.startsWith(LEGACY_LINE)));
    });

    it('cannot be used to forge one of our alarm literals', () => {
      // `[ai-extract] usage-count skipped` is exactly 32 characters, so a length bound alone
      // would let a caller put an alarm string in `task`. TWO things stop it now, and the second
      // is the stronger: the charset fence in `safeTaskLabel`, and the fact that the counter was
      // moved AFTER the task-registry check — so a forged task is refused before it can be
      // logged at all. Asserted on the shape rather than by driving a request, because the
      // request no longer reaches the line.
      const src = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '../index.mjs'),
        'utf8'
      );
      const counterAt = src.indexOf('legacy plaintext request');
      const registryAt = src.indexOf('Object.hasOwn(EXTRACTION_TASKS');
      assert.ok(registryAt > 0, 'the task-registry check must still exist');
      assert.ok(
        counterAt > registryAt,
        'the retirement counter must sit AFTER the task check, or junk and forged tasks count ' +
          'as legacy traffic and the sunset condition can never be satisfied'
      );
      assert.match(src.slice(counterAt - 200, counterAt + 80), /safeTaskLabel\(task\)/);
    });

    it('labels the OLDEST clients by their resolved task, not as invalid', async () => {
      // The clients that send no `task` at all are the exact generation the sunset waits out —
      // that is what the `rawTask === undefined ? 'event'` default exists for. Logging them as
      // `task=invalid` made them byte-identical to a forged task in the one signal an operator
      // uses to decide whether it is safe to delete the arm.
      const lines = [];
      const original = console.log;
      console.log = (...a) => lines.push(a.map(String).join(' '));
      globalThis.fetch = async () => fakeUpstream();
      try {
        await handler(makeEvent({ headers: keyHeader, body: goodBody }));
      } finally {
        console.log = original;
      }

      const line = lines.find((l) => l.startsWith(LEGACY_LINE));
      assert.ok(line, 'an old client must still be counted');
      assert.match(line, /task=event$/, 'resolved, not "invalid"');
    });
  });
});
