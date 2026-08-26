/* global process */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

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

    it('refuses TEXT for the share task, which is images-only', async () => {
      // The soft x-api-key ships in the public bundle, so an unfenced free-text task would
      // turn this proxy into a general text endpoint anyone could bill us for.
      const res = await handler(
        makeEvent({
          headers: keyHeader,
          body: { task: 'share', text: 'hello', todayIso: '2026-06-03' },
        })
      );
      assert.equal(res.statusCode, 400);
    });

    it('validates travel required-keys (502 on wrong shape for travel task)', async () => {
      globalThis.fetch = async () => fakeUpstream({ content: JSON.stringify({ isTravel: true }) });
      const res = await handler(
        makeEvent({ headers: keyHeader, body: { ...goodBody, task: 'travel' } })
      );
      assert.equal(res.statusCode, 502);
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
