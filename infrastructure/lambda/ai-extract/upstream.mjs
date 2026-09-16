/* global process */
/**
 * The one POST to Tinfoil, and the failure ladder that classifies it.
 *
 * WHY THIS IS THE ONLY THING #49 EXTRACTED. Both arms need it, and it is the piece that SURVIVES
 * the legacy arm's retirement — everything else the legacy arm owns (source validation, prompt
 * building, model-JSON parsing, the kind guard) dies with it, so moving that code would be churn
 * against something scheduled for deletion. This is a behaviour-free lift: the ladder below is
 * verbatim from the handler, and `handler.test.mjs` must pass UNCHANGED as the proof. If it does
 * not, this extraction is wrong and gets reverted rather than argued with.
 *
 * It returns a verdict rather than an HTTP response because `response()` needs the `event` for
 * origin-allowlisted CORS, which belongs to the handler, not here.
 *
 * ⚠️ NEVER accept a caller-supplied target. Tinfoil's documented proxy pattern lets a client name
 * the enclave in an `X-Tinfoil-Enclave-Url` header, and honouring it would let anyone holding the
 * `x-api-key` that ships in the public bundle point OUR Tinfoil key at a host of their choosing.
 * The base is ours, from the environment, always.
 */

const TINFOIL_API_KEY = process.env.TINFOIL_API_KEY;
const TINFOIL_API_BASE = (
  process.env.TINFOIL_API_BASE || 'https://inference.tinfoil.sh/v1'
).replace(/\/+$/, '');
/** Upstream call deadline (Lambda timeout is 29s; leave headroom to return a clean error). */
const UPSTREAM_TIMEOUT_MS = 25_000;

/**
 * POST to the enclave.
 *
 * @param {object}  args
 * @param {BodyInit} args.body           already-serialised request body (JSON string, or sealed bytes)
 * @param {string}  [args.contentType]   defaults to `application/json`
 * @param {object}  [args.extraHeaders]  additional headers, ALREADY allowlisted by the caller
 * @returns {Promise<{ ok: true, upstream: Response } | { ok: false, status: number, code: string }>}
 */
export async function callUpstream({ body, contentType = 'application/json', extraHeaders } = {}) {
  let upstream;
  try {
    upstream = await fetch(`${TINFOIL_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        // Spread FIRST so a caller's header can never overwrite our own two. The relay allowlist
        // already makes `Authorization` unmatchable by shape, and this ordering means that even
        // if the allowlist were ever loosened, our key still wins.
        ...(extraHeaders || {}),
        Authorization: `Bearer ${TINFOIL_API_KEY}`,
        'Content-Type': contentType,
      },
      body,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err && err.name === 'TimeoutError';
    console.error(`[ai-extract] upstream ${timedOut ? 'timeout' : 'network error'}`);
    return timedOut
      ? { ok: false, status: 504, code: 'upstream_timeout' }
      : { ok: false, status: 502, code: 'upstream_network' };
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
    return { ok: false, status: isUpstreamBusy ? 503 : 502, code };
  }

  return { ok: true, upstream };
}

/** The user-facing `error` string for each verdict code, so both arms word a failure the same. */
export const UPSTREAM_ERROR_TEXT = Object.freeze({
  upstream_timeout: 'AI service timed out',
  upstream_network: 'Upstream inference failed',
  upstream_auth: 'Upstream inference failed',
  upstream_http: 'Upstream inference failed',
  upstream_unavailable: 'AI service temporarily unavailable',
});

/** Is this configured at all? Both arms refuse identically when the key is unset. */
export function hasUpstreamKey() {
  return Boolean(TINFOIL_API_KEY);
}
