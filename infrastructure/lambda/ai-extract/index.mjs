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

import { buildExtractionMessages, REQUIRED_KEYS } from './extractionPrompt.mjs';

const TINFOIL_API_KEY = process.env.TINFOIL_API_KEY;
const API_KEY = process.env.AI_EXTRACT_API_KEY;
const TINFOIL_API_BASE = (
  process.env.TINFOIL_API_BASE || 'https://inference.tinfoil.sh/v1'
).replace(/\/+$/, '');
const TINFOIL_MODEL = process.env.TINFOIL_MODEL || 'qwen3-vl-30b';
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'https://beanies.family')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// Base64 image data-URL: ~1.33× the compressed bytes. A 2048px/q0.85 JPEG is routinely
// 270 KB–1.3 MB → cap at ~2 MB, comfortably under the API GW 10 MB / Lambda 6 MB ceilings.
const MAX_BODY_BYTES = 2 * 1024 * 1024;
// Allowed document mime prefixes (single image only — data-minimization).
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

  const { imageDataUrl, todayIso } = parsed || {};
  // Validate exactly one image of an allowed type within the cap BEFORE the billable upstream
  // call (cheap belt-and-braces against a malformed/oversized request burning a request).
  if (typeof imageDataUrl !== 'string' || !ALLOWED_DATA_URL.test(imageDataUrl)) {
    return response(400, { error: 'Expected a single JPEG/PNG image data URL' }, event);
  }
  // Accept a date-only string (YYYY-MM-DD) or a full ISO timestamp; normalize to the
  // date part for the prompt so either client format works.
  if (typeof todayIso !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(todayIso)) {
    return response(400, { error: 'Invalid todayIso' }, event);
  }
  const todayDate = todayIso.slice(0, 10);

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
          messages: buildExtractionMessages(imageDataUrl, todayDate),
          temperature: 0,
        }),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (err) {
      const timedOut = err && err.name === 'TimeoutError';
      console.error(`[ai-extract] upstream ${timedOut ? 'timeout' : 'network error'}`);
      return response(timedOut ? 504 : 502, { error: 'Upstream inference failed' }, event);
    }

    if (!upstream.ok) {
      // Distinct, byte-free log so a revoked/rotated Tinfoil key is diagnosable from CloudWatch.
      const code =
        upstream.status === 401 || upstream.status === 403 ? 'upstream_auth' : 'upstream_http';
      console.error(`[ai-extract] ${code} status=${upstream.status}`);
      return response(502, { error: 'Upstream inference failed' }, event);
    }

    // Pass through the attested enclave identity (NOT yet client-verified — Gate 3).
    const enclave = upstream.headers.get('tinfoil-enclave') || undefined;

    let data;
    try {
      data = await upstream.json();
    } catch {
      console.error('[ai-extract] upstream returned non-JSON envelope');
      return response(502, { error: 'Upstream inference failed' }, event);
    }

    const content = data?.choices?.[0]?.message?.content ?? '';
    let result;
    try {
      result = parseModelJson(content);
    } catch {
      console.error('[ai-extract] model returned unparseable JSON');
      return response(502, { error: 'Model returned unparseable output' }, event);
    }

    const missing = REQUIRED_KEYS.filter((k) => !(k in result));
    if (missing.length) {
      console.error(`[ai-extract] model output missing keys: ${missing.join(',')}`);
      return response(502, { error: 'Model returned wrong-shape output' }, event);
    }

    // Retain nothing: no document bytes, no model content — only a structured success line.
    console.log(
      `[ai-extract] ok enclave=${enclave || 'unknown'} isEvent=${result.isEvent === true}`
    );
    return response(200, { result, attestation: enclave ? { enclave } : undefined }, event);
  } catch (err) {
    console.error('[ai-extract] error:', err);
    return response(500, { error: 'Internal server error' }, event);
  }
}
