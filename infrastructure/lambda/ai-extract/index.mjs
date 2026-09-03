/* global process */
/**
 * AI document-extraction proxy Lambda (#133, ADR-030).
 *
 * Holds the Tinfoil API key server-side (a browser PWA cannot safely hold it) and forwards
 * a SINGLE document image to Tinfoil's confidential-inference enclave (OpenAI-compatible),
 * returning the structured event JSON + a pass-through attestation tag. Retains nothing.
 *
 * Mirrors the registry/telemetry contract: origin-allowlisted CORS via getHeaders(),
 * `x-api-key` soft-auth → 401, OPTIONS → 204, body-size guard → 413, malformed JSON → 400,
 * top-level try/catch → 500. The body cap is deliberately MUCH larger than telemetry's 256 KB
 * because the payload is a base64 image data-URL (~1.33× the compressed bytes).
 *
 * GATE 3 (deferred): integrate Tinfoil's EHBP so the client encrypts the document body to the
 * attested enclave and THIS proxy forwards ciphertext it cannot read. Until then the proxy sees
 * the image plaintext transiently in memory (retains nothing) — so claims are scoped to
 * "attested confidential compute + zero retention", NOT "no intermediary sees the document"
 * (ADR-030 binding principle). Never log the document bytes.
 */

import { EXTRACTION_TASKS } from './extractionPrompt.mjs';
import { checkLimits } from './rateLimit.mjs';

const TINFOIL_API_KEY = process.env.TINFOIL_API_KEY;
const API_KEY = process.env.AI_EXTRACT_API_KEY;
const TINFOIL_API_BASE = (
  process.env.TINFOIL_API_BASE || 'https://inference.tinfoil.sh/v1'
).replace(/\/+$/, '');
// Prod sets TINFOIL_MODEL via Terraform (default gemma4-31b). This fallback must stay a
// CURRENT multimodal model — the old qwen3-vl-30b was retired by Tinfoil (every call 503'd).
const TINFOIL_MODEL = process.env.TINFOIL_MODEL || 'gemma4-31b';
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'https://beanies.family')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// Body cap. A multi-page PDF sends up to `MAX_EXTRACT_PAGES` (client) images; base64 is
// ~1.33× the compressed bytes, so a realistic request is ~1.5–2.5 MB. Set to 5 MB — this is a
// classified-413 BACKSTOP that must sit BELOW the ~6 MB Lambda synchronous-invocation ceiling:
// at exactly 6 MB the platform rejects the invoke before this handler runs and the client gets
// an opaque error instead of our clean 413. Do NOT raise to 6 MB or above.
const MAX_BODY_BYTES = 5 * 1024 * 1024;
// Server-side page-count backstop. Intentionally LOOSER than the client's MAX_EXTRACT_PAGES (5):
// this only guards against a malformed/hostile request, it is not the product cap. Do not
// "reconcile" the two to match.
const MAX_IMAGES = 8;
// Hard cap on a TEXT source. Sits comfortably above the client's ~24k page-text reduction
// while keeping a single request's token cost (and therefore its bill) bounded.
const MAX_TEXT_CHARS = 32_000;
// Allowed document mime prefixes (JPEG/PNG only — data-minimization).
const ALLOWED_DATA_URL = /^data:image\/(jpeg|png);base64,/;
// Upstream call deadline (Lambda timeout is 29s; leave headroom to return a clean error).
const UPSTREAM_TIMEOUT_MS = 25_000;

function getHeaders(event) {
  const origin = event?.headers?.origin || ALLOWED_ORIGINS[0];
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function response(statusCode, body, event) {
  return {
    statusCode,
    headers: getHeaders(event),
    body: body === null ? '' : JSON.stringify(body),
  };
}

/** Strip ```json … ``` fences a model may wrap its JSON in, then parse. */
function parseModelJson(content) {
  const jsonText = String(content || '')
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  return JSON.parse(jsonText);
}

export async function handler(event) {
  const method = event?.requestContext?.http?.method;
  if (method === 'OPTIONS') return response(204, null, event);
  if (method !== 'POST') return response(405, { error: 'Method not allowed' }, event);

  // Soft API key (in the public bundle; deters casual abuse, mirrors registry/telemetry).
  const key = event?.headers?.['x-api-key'];
  if (!API_KEY || key !== API_KEY) {
    return response(401, { error: 'Unauthorized' }, event);
  }

  if (!TINFOIL_API_KEY) {
    console.error('[ai-extract] misconfigured: TINFOIL_API_KEY unset');
    return response(500, { error: 'Server misconfigured' }, event);
  }

  const rawBody = event?.body || '';
  if (rawBody.length > MAX_BODY_BYTES) {
    return response(413, { error: 'Payload too large' }, event);
  }

  let parsed;
  try {
    parsed = JSON.parse(rawBody || '{}');
  } catch {
    return response(400, { error: 'Malformed JSON body' }, event);
  }

  const { imageDataUrls, imageDataUrl, text, todayIso, task: rawTask, familyId } = parsed || {};
  // Task selects the prompt + required-keys. Default to 'event' so older clients (which
  // send no task) keep the original #133 behavior byte-for-byte. Reject an unknown task.
  const task = rawTask === undefined ? 'event' : rawTask;
  // Object.hasOwn, NOT a truthiness check: EXTRACTION_TASKS is a plain object literal, so
  // `EXTRACTION_TASKS['constructor']` (or toString/valueOf/__proto__) resolves up the
  // prototype chain to a truthy function whose `.sources` is undefined. That slipped past a
  // `if (!taskConfig)` guard and then threw on the deref below — which sits BEFORE the
  // handler's try/catch, so the caller got a raw API-Gateway 502 with no CORS headers
  // instead of our classified error. Reachable by anyone: the x-api-key is in the bundle.
  const taskConfig = Object.hasOwn(EXTRACTION_TASKS, task) ? EXTRACTION_TASKS[task] : undefined;
  if (!taskConfig) {
    // `code` matters: DEPLOY ORDER is load-bearing here. This Lambda must ship a new task
    // before any client that requests it, and without a machine-readable code the client
    // falls through to a status-based branch and shows "something went wrong" — which
    // reads as a broken feature rather than a not-yet-deployed one. `unknown_task` lets
    // the client render the friendly "not set up yet" notice instead.
    return response(400, { error: `Unknown task: ${String(task)}`, code: 'unknown_task' }, event);
  }
  // A TEXT source is accepted only for a task that declares it (`sources` on the registry
  // entry). This is a real fence, not a formality: the soft x-api-key ships in the public
  // bundle, so an unrestricted free-text field would turn this proxy into a general-purpose
  // text-LLM endpoint anyone could bill us for. `event`/`travel` stay images-only.
  if (typeof text === 'string') {
    if (!taskConfig.sources.includes('text')) {
      // Same `code` as the unknown-task rejection above, and for the same reason: a client
      // deployed AHEAD of this Lambda asks for a source the deployed registry does not yet
      // declare, and without a machine-readable code it falls through to a generic "something
      // went wrong". `managedProvider` maps this to `not_available` → the friendly "not set
      // up yet" notice. Keep the two together.
      return response(
        400,
        { error: `Task "${task}" does not accept text input`, code: 'unknown_task' },
        event
      );
    }
    if (text.length === 0) {
      return response(400, { error: 'Empty text source' }, event);
    }
    if (text.length > MAX_TEXT_CHARS) {
      return response(413, { error: 'Text source too large' }, event);
    }
  }

  // Dual-accept: new clients send `imageDataUrls` (array, one per page); older cached clients
  // send a single `imageDataUrl` string — normalize both to an array so one code path handles
  // it. Validate BEFORE the billable upstream call (cheap belt-and-braces vs a malformed request).
  //
  // NOTE the wire format is deliberately UNCHANGED for the image path. The bundle and this
  // Lambda deploy independently, so renaming these fields to a nested `source` object would
  // 400 every event and travel extraction from a new bundle hitting an old Lambda.
  const images = Array.isArray(imageDataUrls)
    ? imageDataUrls
    : typeof imageDataUrl === 'string'
      ? [imageDataUrl]
      : null;
  const hasText = typeof text === 'string' && text.length > 0;
  if (!hasText) {
    if (!images || images.length === 0) {
      return response(400, { error: 'Expected one or more JPEG/PNG image data URLs' }, event);
    }
    if (images.length > MAX_IMAGES) {
      return response(400, { error: `Too many images (max ${MAX_IMAGES})` }, event);
    }
    if (!images.every((u) => typeof u === 'string' && ALLOWED_DATA_URL.test(u))) {
      return response(400, { error: 'Expected JPEG/PNG image data URL(s)' }, event);
    }
  }
  const source = hasText ? { kind: 'text', text } : { kind: 'images', imageDataUrls: images };
  // Accept a date-only string (YYYY-MM-DD) or a full ISO timestamp; normalize to the
  // date part for the prompt so either client format works.
  if (typeof todayIso !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(todayIso)) {
    return response(400, { error: 'Invalid todayIso' }, event);
  }
  const todayDate = todayIso.slice(0, 10);

  // ── Abuse limits (#83) ────────────────────────────────────────────────────────────────
  //
  // Placement is deliberate on all three sides:
  //   • AFTER the x-api-key check, so an unauthenticated flood costs no DynamoDB writes;
  //   • AFTER body/JSON/task/text/image/todayIso validation, so a malformed request never
  //     consumes a family's budget;
  //   • BEFORE the try/catch around the billable upstream call.
  //
  // Gated on `hasText`: TEXT SOURCES ONLY for now. The image path is bounded by its own size
  // limits and `AI_PICKER_MAX_BYTES`, has not changed, and has run under the route throttle
  // since #133 — widening to it is a strictly larger blast radius (it can break a working
  // reader) for no new risk in this change. A deliberate follow-up, not smuggled in.
  //
  // ⚠️ `checkLimits` never throws and fails open internally, which is why this is one `if`
  // and not a nested try/catch. Keeping this validation section flat is why it stays readable.
  if (hasText) {
    const verdict = await checkLimits({
      familyId: typeof familyId === 'string' ? familyId : undefined,
      // NEVER `x-forwarded-for` — that header is caller-controlled, and an attacker rotating
      // it would defeat the IP limit entirely. See rateLimit.mjs.
      ip: event?.requestContext?.http?.sourceIp,
    });
    if (!verdict.allowed) {
      // Through `response()` so the CORS headers are present. An API-Gateway-generated 429
      // carries none, which from a browser surfaces as an opaque network error instead of a
      // classifiable refusal.
      return response(
        429,
        {
          error: 'Too many requests',
          code: 'rate_limited',
          retryAfterSeconds: verdict.retryAfterSeconds,
        },
        event
      );
    }
  }

  try {
    let upstream;
    try {
      upstream = await fetch(`${TINFOIL_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TINFOIL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: TINFOIL_MODEL,
          messages: taskConfig.buildMessages(source, todayDate),
          temperature: 0,
        }),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (err) {
      const timedOut = err && err.name === 'TimeoutError';
      console.error(`[ai-extract] upstream ${timedOut ? 'timeout' : 'network error'}`);
      return timedOut
        ? response(504, { error: 'AI service timed out', code: 'upstream_timeout' }, event)
        : response(502, { error: 'Upstream inference failed', code: 'upstream_network' }, event);
    }

    if (!upstream.ok) {
      // Classify the failure so the client can react correctly (byte-free log either way):
      //   • 5xx  → the provider is overloaded/down. TRANSIENT — tell the client it's retryable
      //            (503 + upstream_unavailable), and don't treat it like a hard error.
      //   • 401/403 → OUR Tinfoil key is bad. Hard config failure (502 + upstream_auth).
      //   • other non-2xx → generic upstream HTTP error (502 + upstream_http).
      const isAuth = upstream.status === 401 || upstream.status === 403;
      const isUpstreamBusy = upstream.status >= 500;
      const code = isAuth
        ? 'upstream_auth'
        : isUpstreamBusy
          ? 'upstream_unavailable'
          : 'upstream_http';
      console.error(`[ai-extract] ${code} status=${upstream.status}`);
      return isUpstreamBusy
        ? response(503, { error: 'AI service temporarily unavailable', code }, event)
        : response(502, { error: 'Upstream inference failed', code }, event);
    }

    // Pass through the attested enclave identity (NOT yet client-verified — Gate 3).
    const enclave = upstream.headers.get('tinfoil-enclave') || undefined;

    let data;
    try {
      data = await upstream.json();
    } catch {
      console.error('[ai-extract] upstream returned non-JSON envelope');
      return response(502, { error: 'Upstream inference failed', code: 'upstream_badjson' }, event);
    }

    const content = data?.choices?.[0]?.message?.content ?? '';
    let result;
    try {
      result = parseModelJson(content);
    } catch {
      console.error('[ai-extract] model returned unparseable JSON');
      return response(
        502,
        { error: 'Model returned unparseable output', code: 'model_unparseable' },
        event
      );
    }

    // `k in result` throws on null/primitives, and JSON.parse('null') is legal — an
    // unclassified TypeError here would escape as a raw 500 instead of model_shape.
    if (typeof result !== 'object' || result === null) {
      console.error('[ai-extract] model returned a non-object');
      return response(
        502,
        { error: 'Model returned wrong-shape output', code: 'model_shape' },
        event
      );
    }
    const missing = taskConfig.requiredKeys.filter((k) => !(k in result));
    if (missing.length) {
      console.error(`[ai-extract] model output missing keys: ${missing.join(',')}`);
      return response(
        502,
        { error: 'Model returned wrong-shape output', code: 'model_shape' },
        event
      );
    }

    // Retain nothing: no document bytes, no model content — only a structured success line.
    console.log(`[ai-extract] ok task=${task} enclave=${enclave || 'unknown'}`);
    return response(200, { result, attestation: enclave ? { enclave } : undefined }, event);
  } catch (err) {
    console.error('[ai-extract] error:', err);
    return response(500, { error: 'Internal server error' }, event);
  }
}
