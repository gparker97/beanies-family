/* global process */
/**
 * content-fetch Lambda (#72) — the app's first user-controlled outbound request.
 *
 * WHY ITS OWN LAMBDA rather than a mode on ai-extract, in order of weight:
 *   1. Blast radius. ai-extract is a small hardened inference proxy that activity and travel
 *      extraction both depend on in production. Adding URL fetching, HTML parsing, JSON-LD
 *      extraction and YouTube scraping roughly triples its surface; a hang or a bug in any
 *      of that would take down two shipped features that have nothing to do with recipes.
 *   2. Security isolation. Fetching a user-supplied URL is an SSRF vector. It wants its own
 *      IAM role, its own egress posture and its own concurrency ceiling — not to be
 *      smuggled into the component holding the Tinfoil key.
 *   3. Different operational shape. ~3s page fetches vs ~25s inference; 2 MB of HTML vs
 *      5 MB of base64; different error taxonomy. They would fight inside one handler.
 *
 * ACCEPTED RESIDUAL RISK: this is, by construction, a semi-open web proxy. Its only auth is
 * the same soft x-api-key that ships in the public bundle (the established four-Lambda
 * convention). The SSRF guard stops it reaching anything PRIVATE, but nothing stops a
 * bundle-reader using it to fetch arbitrary PUBLIC URLs. Bounded rather than solved:
 * reserved_concurrent_executions caps parallelism and a route throttle caps volume, so the
 * worst case is a capped bill and a throttle. Do NOT "fix" this by inventing per-family auth
 * the feature does not otherwise need.
 *
 * This file is a DISPATCHER. It owns HTTP shape and nothing else: no page, YouTube or image
 * logic lives here, and no mode-specific conditionals. Each mode returns
 * `{ok:true,data} | {ok:false,code,blockReason?}` and never throws or builds a response.
 */

import { fetchPage } from './modes/page.mjs';
import { fetchYoutube } from './modes/youtube.mjs';
import { fetchImage } from './modes/image.mjs';

const API_KEY = process.env.CONTENT_FETCH_API_KEY;
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'https://app.beanies.family')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

/** Request bodies here are a mode + a URL — kilobytes, never megabytes. */
const MAX_BODY_BYTES = 8 * 1024;

const MODES = { page: fetchPage, youtube: fetchYoutube, image: fetchImage };

/** code → HTTP status. One mapping, so no mode invents its own. */
const STATUS_FOR_CODE = {
  bad_url: 400,
  bad_mode: 400,
  blocked: 400,
  not_image: 422,
  not_readable: 422,
  not_found: 404,
  site_refused: 403,
  no_captions: 422,
  too_large: 413,
  timeout: 504,
  fetch_failed: 502,
};

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

/**
 * Log hygiene: never the full URL, never the body. A registrable-ish host only, with
 * control characters stripped — an attacker-supplied hostname is untrusted LOG input, and
 * a newline in it forges log lines.
 */
function safeHost(raw) {
  try {
    return new URL(raw).hostname.replace(/[^\w.-]/g, '').slice(0, 100);
  } catch {
    return 'unparseable';
  }
}

export async function handler(event) {
  const method = event?.requestContext?.http?.method;
  if (method === 'OPTIONS') return response(204, null, event);
  if (method !== 'POST') return response(405, { error: 'Method not allowed' }, event);

  const key = event?.headers?.['x-api-key'];
  if (!API_KEY || key !== API_KEY) return response(401, { error: 'Unauthorized' }, event);

  const rawBody = event?.body || '';
  if (rawBody.length > MAX_BODY_BYTES) return response(413, { error: 'Payload too large' }, event);

  let parsed;
  try {
    parsed = JSON.parse(rawBody || '{}');
  } catch {
    return response(400, { error: 'Malformed JSON body' }, event);
  }

  const { mode, url } = parsed || {};
  // Object.hasOwn, not truthiness: MODES is a plain object literal, so 'constructor' and
  // friends resolve up the prototype chain to a truthy function and would sail past a
  // `!MODES[mode]` check straight into an unhandled TypeError.
  if (typeof mode !== 'string' || !Object.hasOwn(MODES, mode)) {
    return response(400, { error: 'Unknown mode', code: 'bad_mode' }, event);
  }
  if (typeof url !== 'string' || url.length === 0) {
    return response(400, { error: 'Missing url', code: 'bad_url' }, event);
  }

  try {
    const result = await MODES[mode](url);
    if (result.ok) return response(200, result.data, event);

    const status = STATUS_FOR_CODE[result.code] ?? 502;
    if (result.code === 'blocked') {
      console.warn(
        `[content-fetch] blocked mode=${mode} reason=${result.blockReason} host=${safeHost(url)}`
      );
    } else {
      console.warn(`[content-fetch] ${result.code} mode=${mode} host=${safeHost(url)}`);
    }
    return response(
      status,
      { error: 'Fetch refused', code: result.code, blockReason: result.blockReason },
      event
    );
  } catch (err) {
    // A mode is contracted never to throw; if one does it is a bug, and the caller still
    // gets a clean CORS-bearing 500 rather than a raw gateway error.
    console.error(`[content-fetch] unhandled error mode=${mode}:`, err);
    return response(500, { error: 'Internal error', code: 'fetch_failed' }, event);
  }
}
