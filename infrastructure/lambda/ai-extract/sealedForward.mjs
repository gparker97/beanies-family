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
 * A client asking which model to name inside its sealed body.
 *
 * Shares the POST route deliberately, so this needs no new API Gateway path and no terraform.
 * See the handler for why the client cannot simply hardcode it.
 */
export const SEALED_CONFIG_PROTOCOL = 'ehbp-config';

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

/**
 * Make a client-supplied string safe to put in a log line.
 *
 * ⚠️ NOT cosmetic. CloudWatch metric filters match quoted substrings anywhere in a line, and
 * several of ours page a human (`main.tf`). A JSON key may contain a newline, so an unsanitised
 * value interpolated into a log lets any caller holding the public `x-api-key` FORGE a production
 * alarm on demand — including `correction refused reason=different_source`, the one this codebase
 * documents as meaning the feature is broken rather than someone probing it. Strip the line
 * breaks, bound the length, and keep it to characters that cannot be mistaken for structure.
 */
function logSafe(value, max = 48) {
  return String(value)
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[^\x20-\x7e]/g, '')
    .slice(0, max);
}
/** Bounded so a hostile caller cannot make us build an unbounded header map. */
const MAX_EHBP_HEADERS = 16;
/**
 * `task` is a metering label, but it is LOGGED, and our log lines feed CloudWatch metric filters
 * that page a human. Bounding the length is not enough on its own: `[ai-extract] usage-count
 * skipped` is exactly 32 characters, so a length-only rule still lets a caller forge that alarm.
 * A charset with no spaces makes every one of our alarm terms unrepresentable as a task.
 *
 * The legacy arm never needed this because `Object.hasOwn(EXTRACTION_TASKS, task)` gated it; the
 * sealed arm has no registry to check against, so the shape is the fence.
 */
const TASK_RE = /^[a-z][a-z0-9_-]{0,31}$/;

/** A closed set, because this value is caller-supplied and becomes an upstream request header. */
const ALLOWED_CONTENT_TYPES = new Set(['application/json']);

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
  let seen = 0;
  for (const [name, value] of Object.entries(source || {})) {
    // ⚠️ BOTH counters are bounded, not just `kept`. An earlier version bounded only the kept
    // headers, so a caller could still push 50,000 junk keys into `dropped` and make us build one
    // multi-megabyte log line per invocation.
    if (++seen > MAX_EHBP_HEADERS * 4) break;
    if (EHBP_HEADER_RE.test(name) && typeof value === 'string' && kept < MAX_EHBP_HEADERS) {
      out[name] = value;
      kept += 1;
    } else if (dropped.length < MAX_EHBP_HEADERS) {
      dropped.push(logSafe(name));
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
  const {
    familyId,
    task: rawTask,
    srcHash,
    correction,
    ehbp,
    sealed,
    contentType,
  } = envelope || {};

  // ── Shape. Each refusal is BEFORE any billable work and costs the family nothing. ──────────
  if (typeof sealed !== 'string' || sealed.length === 0) {
    return respond(400, { error: 'Expected a sealed body', code: 'bad_sealed' }, event);
  }
  const task = typeof rawTask === 'string' ? rawTask : '';
  if (!TASK_RE.test(task)) {
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

  // ⚠️ DECODE BEFORE THE METER. `openRead` atomically consumes a one-use grant, so anything that
  // can reject the request must happen first or a malformed body spends the family's free
  // correction and then 400s — with no refund path, and the banner's host modal already closed.
  // The legacy arm states this rule explicitly ("so a malformed request never consumes a family's
  // budget"); an earlier version of this arm inverted it.
  //
  // Node's base64 decoder never throws, it silently discards non-alphabet characters, so a
  // try/catch here would be dead code and garbage would reach the billable enclave. Round-trip
  // instead: re-encode and compare, which is the only way to tell well-formed input from mush.
  const bytes = Buffer.from(sealed, 'base64');
  if (
    bytes.length === 0 ||
    bytes.toString('base64').replace(/=+$/, '') !== sealed.replace(/=+$/, '')
  ) {
    return respond(400, { error: 'Sealed body is not valid base64', code: 'bad_sealed' }, event);
  }

  // After the refusals, before the model: the same placement the legacy arm uses, and for the same
  // two reasons (a refused request must not spend a grant; two concurrent replays must not both
  // get a free read).
  //
  // `srcBytes` is what THIS Lambda measured. On the sealed arm `srcHash` is client-supplied and
  // therefore forgeable, so the measured size is the half of the source binding a caller cannot
  // lie about. See GRANT_BYTES_TOLERANCE in correctionGrant.mjs.
  const read = await openRead({ familyId: family, srcHash, srcBytes: bytes.length, correction });

  // A correction the grant store REFUSED is refused here too, never silently downgraded to a
  // charged read. Gated on `reason === 'refused'` specifically: the kill switch and a store blip
  // must still fall through to a charged read. The legacy arm's comment explains why at length.
  if (correction && read.reason === 'refused') {
    return respond(409, { error: 'Correction refused', code: 'correction_refused' }, event);
  }

  const result = await callUpstream({
    body: bytes,
    // ⚠️ The client's value, describing the PLAINTEXT inside the envelope, not the envelope. EHBP
    // keeps content-type in cleartext for exactly this reason, and the enclave's inner
    // /v1/chat/completions handler still needs to know it is being handed JSON. Hardcoding
    // application/octet-stream here risks a 415 on every sealed request. Bounded and allowlisted
    // because it is caller-supplied and ends up in an upstream header.
    contentType: ALLOWED_CONTENT_TYPES.has(contentType) ? contentType : 'application/json',
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
  console.log(`[ai-extract] ok task=${task} arm=sealed`);
  return respond(
    200,
    {
      sealed: responseBytes.toString('base64'),
      ehbp: collectEhbpFrom(result.upstream.headers),
      correction: grant,
      // Whether a grant was actually SPENT on this request. The client's moved kind-guard needs
      // it: the Lambda's version ran on `read.kindHint`, set only on a spent grant, so it could
      // never fire on the kill-switch or store-blip fall-through paths. Without this the client
      // would charge a family during exactly the incident the kill switch exists for, then show a
      // toast saying nothing was charged.
      correctionFree: read.free === true,
      // No `attestation`. The CLIENT verified the enclave itself and holds the only trustworthy
      // answer; echoing our own view of it back would be theatre, and worse, something a reader
      // might mistake for a second, independent confirmation.
    },
    event
  );
}
