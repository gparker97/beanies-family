/* global Buffer */
/**
 * The SEALED arm (#49, ADR-030 Gate 3): forward a body we cannot read.
 *
 * The client encrypts the chat-completions request to the enclave's ATTESTED HPKE public key
 * (EHBP, RFC 9180) before it leaves the device, so what arrives here is ciphertext. This function
 * attaches our Tinfoil key, relays the EHBP headers in both directions, meters the read, and
 * returns the sealed response untouched. It cannot read the document, and neither can any log
 * line it writes, because it never possesses plaintext at all.
 *
 * WHAT THIS ARM STILL DOES, and why each one survived the loss of plaintext:
 *   • `x-api-key`, CORS, the body cap   — the handler's, before we are called
 *   • correction TOKEN validation       — bounds the DynamoDB key; the `to` kind is gone (below)
 *   • the `task !== 'share'` fence      — a grant is only meaningful on `share`
 *   • rate limiting, UNCONDITIONALLY    — see the fence note below
 *   • `openRead` / `closeRead`          — the meter, keyed on the envelope's `familyId`
 *
 * WHAT IT CANNOT DO, permanently:
 *   • validate the source (mime, page count, text length). The client owns those now.
 *   • the `sources` fence that kept this from being a general-purpose text-LLM endpoint. Anyone
 *     holding the bundle's `x-api-key` can seal an arbitrary prompt, and no server-side check can
 *     see it. ⚠️ THE UNCONDITIONAL RATE LIMITER IS THE COMPENSATING CONTROL, not an incidental
 *     tightening — the legacy arm runs the limiter only for text sources, which was safe only
 *     because it could SEE that a request was text. Do not "optimise" it back to conditional.
 *   • read the answer. So the bean is counted on a successful enclave response; see `closeRead`.
 *
 * ⚠️ `task` here is a metering label and NOTHING else. It is compared and logged, never used as a
 * key into an object. `index.mjs` records the production bug where `EXTRACTION_TASKS['constructor']`
 * resolved up the prototype chain and threw outside the try/catch, returning a raw 502 with no CORS
 * headers to anyone holding the api key. That shape must not come back here.
 */

import { checkLimits } from './rateLimit.mjs';
import { closeRead, openRead, validateCorrectionToken } from './meter.mjs';
import { UPSTREAM_ERROR_TEXT, callUpstream } from './upstream.mjs';

/** The wire discriminator. Anything else is refused with a code the client can act on. */
export const SEALED_PROTOCOL = 'ehbp-1';

/**
 * Which headers may cross, in EITHER direction.
 *
 * A PREFIX RULE rather than a frozen allowlist, deliberately: `ehbp` is a pinned dependency that
 * will gain headers, and a frozen list turns that into a silent drop of something the protocol
 * needs. A prefix forwards the new one instead, which removes the version coupling rather than
 * compensating for it.
 *
 * `Authorization`, `x-api-key` and `Cookie` cannot match this shape, so no caller can overwrite
 * our key header or smuggle a credential upstream. Neither can `X-Tinfoil-Enclave-Url`, which is
 * the header Tinfoil's documented proxy pattern uses to name the enclave — we must never honour
 * it, because it would let anyone holding the bundle's api key point our key at an arbitrary host.
 */
const EHBP_HEADER_RE = /^ehbp-[a-z0-9-]{1,48}$/i;
/** Bounded so a hostile caller cannot make us build an unbounded header map. */
const MAX_EHBP_HEADERS = 16;
/** `task` is metering label only, but it is still logged and compared, so bound it. */
const MAX_TASK_CHARS = 32;

/**
 * Keep only `ehbp-*`, and say out loud what was dropped.
 *
 * Header NAMES carry no document bytes, so logging them leaks nothing. Silence here would make a
 * protocol upgrade look like a decryption bug at the other end.
 */
function relayEhbpHeaders(source, direction) {
  const out = {};
  const dropped = [];
  let kept = 0;
  for (const [name, value] of Object.entries(source || {})) {
    if (EHBP_HEADER_RE.test(name) && typeof value === 'string') {
      if (kept >= MAX_EHBP_HEADERS) {
        dropped.push(name);
        continue;
      }
      out[name] = value;
      kept += 1;
    } else {
      dropped.push(name);
    }
  }
  if (dropped.length) {
    console.warn(`[ai-extract] dropped ${direction} header(s): ${dropped.join(',')}`);
  }
  return out;
}

/** Collect `ehbp-*` off a real `Headers` instance (the upstream response). */
function collectEhbpFrom(headers) {
  const out = {};
  for (const [name, value] of headers.entries()) {
    if (EHBP_HEADER_RE.test(name)) out[name] = value;
  }
  return out;
}

/**
 * Handle one `protocol: 'ehbp-1'` request.
 *
 * @param {object} envelope  the parsed plaintext envelope (never the document)
 * @param {object} event     the Lambda event, for CORS on the response
 * @param {(status:number, body:unknown, event:object)=>object} respond  the handler's `response`
 */
export async function sealedForward(envelope, event, respond) {
  const { familyId, task: rawTask, srcHash, correction, ehbp, sealed } = envelope || {};

  // ── Shape. Each refusal is BEFORE any billable work and costs the family nothing. ──────────
  if (typeof sealed !== 'string' || sealed.length === 0) {
    return respond(400, { error: 'Expected a sealed body', code: 'bad_sealed' }, event);
  }
  const task = typeof rawTask === 'string' ? rawTask : '';
  if (!task || task.length > MAX_TASK_CHARS) {
    return respond(400, { error: 'Invalid task', code: 'bad_task' }, event);
  }
  // Client-computed, and forgeable at exactly the same trust level as `familyId`, which this
  // Lambda has always treated as forgeable. Forging it only lets a family mis-bind its OWN grant.
  if (typeof srcHash !== 'string' || srcHash.length === 0 || srcHash.length > 128) {
    return respond(400, { error: 'Invalid source hash', code: 'bad_srchash' }, event);
  }

  // A sealed correction carries a TOKEN ONLY. `to` is deliberately absent: `consumeGrant` no
  // longer conditions on the kind, and the closed-set check on `to` existed only because it
  // reached the model's instruction — which it cannot do here, because the CLIENT built the
  // prompt. Sending it would put the family's own assertion about their document on the wire in
  // cleartext for no remaining purpose.
  if (correction !== undefined && correction !== null) {
    if (typeof correction !== 'object' || Array.isArray(correction)) {
      return respond(400, { error: 'Bad correction', code: 'bad_correction' }, event);
    }
    if (validateCorrectionToken(correction.token)) {
      return respond(400, { error: 'Bad correction', code: 'bad_correction' }, event);
    }
    // Same fence as the legacy arm: a grant is bound to family and document but not to a task, so
    // without this a grant earned on `share` could be spent on another task, be ignored by the
    // builder, and be gone for a call that was never going to use it.
    if (task !== 'share') {
      return respond(400, { error: 'Bad correction', code: 'bad_correction' }, event);
    }
  }

  const family = typeof familyId === 'string' ? familyId : undefined;

  // ⚠️ UNCONDITIONAL, unlike the legacy arm. See the header: this is what replaces the `sources`
  // fence, which ciphertext makes unenforceable forever. `checkLimits` never throws and fails open
  // internally, which is why this is one `if` and not a nested try/catch.
  const verdict = await checkLimits({
    familyId: family,
    // NEVER `x-forwarded-for` — caller-controlled, and an attacker rotating it would defeat the
    // IP limit entirely. See rateLimit.mjs.
    ip: event?.requestContext?.http?.sourceIp,
  });
  if (!verdict.allowed) {
    return respond(
      429,
      {
        error: 'Too many requests',
        code: 'rate_limited',
        retryAfterSeconds: verdict.retryAfterSeconds,
      },
      event
    );
  }

  // After the refusals, before the model: the same placement the legacy arm uses, and for the same
  // two reasons (a refused request must not spend a grant; two concurrent replays must not both
  // get a free read).
  const read = await openRead({ familyId: family, srcHash, correction });

  // A correction the grant store REFUSED is refused here too, never silently downgraded to a
  // charged read. Gated on `reason === 'refused'` specifically: the kill switch and a store blip
  // must still fall through to a charged read. The legacy arm's comment explains why at length.
  if (correction && read.reason === 'refused') {
    return respond(409, { error: 'Correction refused', code: 'correction_refused' }, event);
  }

  let bytes;
  try {
    bytes = Buffer.from(sealed, 'base64');
  } catch {
    return respond(400, { error: 'Sealed body is not base64', code: 'bad_sealed' }, event);
  }
  if (bytes.length === 0) {
    return respond(400, { error: 'Sealed body is empty', code: 'bad_sealed' }, event);
  }

  const result = await callUpstream({
    body: bytes,
    // EHBP carries its own framing; the enclave reads the sealed body, not JSON.
    contentType: 'application/octet-stream',
    extraHeaders: relayEhbpHeaders(ehbp, 'request'),
  });

  if (!result.ok) {
    return respond(
      result.status,
      { error: UPSTREAM_ERROR_TEXT[result.code] ?? 'Upstream inference failed', code: result.code },
      event
    );
  }

  let responseBytes;
  try {
    responseBytes = Buffer.from(await result.upstream.arrayBuffer());
  } catch {
    console.error('[ai-extract] could not read the sealed upstream body');
    return respond(502, { error: 'Upstream inference failed', code: 'upstream_badbody' }, event);
  }

  // ⚠️ THE BEAN IS SPENT HERE, which is a different point from the legacy arm's. We cannot see the
  // answer, so "the enclave answered" is the only fact available. A model that returns unparseable
  // JSON therefore costs a bean here where it costs nothing on the legacy arm. Accepted knowingly:
  // every alternative routes through the client declaring "that did not parse", which is a meter
  // bypass by construction. `closeRead` documents it too, since that is where it is counted.
  const grant = await closeRead(read, { familyId: family, task });

  // Retain nothing, and here there is nothing to retain: no document bytes ever existed in this
  // process, and the response bytes are opaque to us.
  console.log(`[ai-extract] ok task=${task} sealed`);
  return respond(
    200,
    {
      sealed: responseBytes.toString('base64'),
      ehbp: collectEhbpFrom(result.upstream.headers),
      correction: grant,
      // No `attestation`. The CLIENT verified the enclave itself and holds the only trustworthy
      // answer; echoing our own view of it back would be theatre, and worse, something a reader
      // might mistake for a second, independent confirmation.
    },
    event
  );
}
