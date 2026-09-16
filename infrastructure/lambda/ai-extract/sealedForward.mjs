import { HARD_REFUSAL_REASONS } from './correctionGrant.mjs';
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
 * The most keys we will even LOOK at on a caller-supplied `ehbp` object.
 *
 * ⚠️ A DoS BACKSTOP, NOT A FUNCTIONAL LIMIT, and the gap between those two is the whole
 * reason for the number. A real EHBP body carries a handful of headers, so 2048 is orders of
 * magnitude above anything legitimate — deliberately, because the requirement the tests encode
 * is that the real `ehbp-encapsulated-key` survives ANY amount of junk in front of it (the
 * starvation case sends 300 junk keys and expects the 301st to be relayed). A tight ceiling
 * would satisfy the DoS concern by reintroducing exactly the starvation bug. What this bounds
 * is the hundreds of thousands of keys an abusive caller can send, where the per-key regex work
 * stops being free. Under the ceiling every key is still examined.
 */
const MAX_EHBP_KEYS = 2048;

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
  return (
    String(value)
      .replace(/[\r\n\t]/g, ' ')
      // ⚠️ SPACES TOO, and this is the whole defect the length bound could not cover. Stripping
      // control characters and bounding the length still let a caller-chosen `ehbp` key name
      // reproduce one of our alarm literals verbatim: `[ai-extract] usage-count write failed` is
      // 37 printable-ASCII characters, so it passed through unchanged and was echoed into the
      // dropped-header warn line. The metric filter in main.tf matches that string as a
      // SUBSTRING anywhere in a line, at threshold 1 — so one request with the api key that
      // ships in the public bundle pages #beanies-errors with a fabricated "we lost a usage
      // count" incident, and `dropped.length < MAX_EHBP_HEADERS` allows 16 per body.
      //
      // This is exactly the reasoning `safeTaskLabel` already carries for `task`. It was applied
      // there and not here, which is how a fence ends up guarding one door of two.
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/[^a-zA-Z0-9_.-]/g, '?')
      .slice(0, max)
  );
}
/** Bounded so a hostile caller cannot make us build an unbounded header map. */
const MAX_EHBP_HEADERS = 16;

/**
 * ⚠️ VALUES are validated too, not just names. A name that passed the prefix rule used to carry
 * ANY string straight into `fetch(...)`, where undici throws on a control character ("invalid
 * header value") or on any codepoint above 255 ("Cannot convert argument to a ByteString").
 * `callUpstream` classifies that throw as `upstream_network` → 502 — after `openRead` has already
 * atomically consumed the family's free correction, so the grant is spent, no model is called,
 * and CloudWatch points whoever triages it at Tinfoil.
 *
 * Printable ASCII only, which is what an HTTP field value may contain unencoded anyway, and a
 * length bound so 16 slots cannot ship multi-megabyte headers upstream — the same resource class
 * as the `Object.entries` OOM above, one level down.
 */
const EHBP_VALUE_RE = /^[\x20-\x7e]*$/;
const MAX_EHBP_VALUE_CHARS = 4096;
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

/**
 * A caller-supplied `task` rendered safe to put in a log line, from EITHER arm.
 *
 * Exported because the legacy arm needs exactly this and must not grow its own copy: its
 * retirement counter logs the task before the arm has validated it, and the charset is what
 * stops a caller forging one of our alarm literals (`[ai-extract] usage-count skipped` is 32
 * characters, so a length bound alone is not enough — a space is the whole attack).
 */
export function safeTaskLabel(task) {
  return typeof task === 'string' && TASK_RE.test(task) ? task : 'invalid';
}

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

  // ⚠️ THE BOUND IS ON THE INPUT, NOT ON THE LOOP, and both alternatives were tried and are
  // wrong:
  //
  //  · A `break` inside the loop STARVES the real header. A body shaped
  //    `{a0..a63: 'x', 'ehbp-encapsulated-key': '<real>'}` exhausts the budget on junk and
  //    leaves before reaching the one header that matters — and this function does not refuse,
  //    it drops silently, so execution continues into `openRead`, spends the family's one-use
  //    grant, and pays Tinfoil for ciphertext the enclave cannot decapsulate. There is a test
  //    named for exactly that ("does not let junk keys starve the real ehbp header").
  //  · No bound at all leaves the walk unbounded. A rewrite that replaced the `break` with
  //    `dropped.length < MAX && ++seen <= MAX * 4` bounded nothing: `dropped` fills to MAX
  //    first, the `&&` short-circuits, and `seen` freezes at 16 and never reaches 64.
  //
  // Refusing an ABSURD key count up front satisfies both. A legitimate EHBP body carries a
  // handful of headers, so anything past this ceiling is not a protocol upgrade we want to
  // tolerate — and every key below it is still examined, so no amount of junk under the
  // ceiling can hide the real header.
  // `Object.keys` throws on null/undefined where `for…in` was simply a no-op, and an absent
  // `ehbp` is the ORDINARY case (only the sealed arm sends one). Without this the relay turned
  // every unsealed request into a 500.
  if (!source || typeof source !== 'object') return out;

  const names = Object.keys(source);
  if (names.length > MAX_EHBP_KEYS) {
    // Loud, because this is the one path that returns nothing on a request that looked sealed.
    // Silence here would surface downstream as a decryption failure and point the reader at the
    // cryptography, which is the misdiagnosis this whole module keeps having to undo.
    console.warn(
      `[ai-extract] refused ${direction} ehbp: ${names.length} keys exceeds ${MAX_EHBP_KEYS}`
    );
    return out;
  }

  // ⚠️ `Object.keys` ABOVE ALREADY MATERIALISED THE KEY LIST, which is the same thing
  // `for…in` does — measured at ~3.8s and ~40MB for `for (const k in '<4.5MB string>')`,
  // because V8 builds the whole own-enumerable-key list before the first loop body runs. So no
  // in-loop counter could ever have bounded the allocation; only the `typeof ehbp !== 'object'`
  // guard upstream does that, and this loop is NOT a second line of defence if it is relaxed.
  // What the ceiling above bounds is the per-key WORK (a regex test each), which is the part
  // that was genuinely unbounded.
  for (const name of names) {
    const value = source[name];
    // ⚠️ THE PREFIX TEST COMES FIRST. See the starvation note above: anything that spends
    // budget before looking at the name can drop the only header that matters. The client's
    // `selectEhbpHeaders` had the same bug and is fixed the same way.
    if (!EHBP_HEADER_RE.test(name)) {
      // `dropped` is capped independently of the walk, so a body full of junk under the ceiling
      // still cannot build one multi-megabyte log line per invocation.
      if (dropped.length < MAX_EHBP_HEADERS) dropped.push(logSafe(name));
      continue;
    }
    if (
      typeof value === 'string' &&
      EHBP_VALUE_RE.test(value) &&
      value.length <= MAX_EHBP_VALUE_CHARS &&
      kept < MAX_EHBP_HEADERS
    ) {
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
  // ⚠️ Type-check BEFORE anything walks it. A string here used to be enumerated character by
  // character by `Object.entries`, allocating one pair per character and killing a 256MB
  // process on a few megabytes of input — see the note on `relayEhbpHeaders`. Absent is fine
  // and ordinary; present-but-not-a-plain-object is a malformed request, never our own client.
  if (ehbp !== undefined && ehbp !== null) {
    if (typeof ehbp !== 'object' || Array.isArray(ehbp)) {
      return respond(400, { error: 'Invalid ehbp headers', code: 'bad_ehbp' }, event);
    }
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

  // Decide what to relay BEFORE the meter, for the same reason the decode sits above it: this is
  // the last thing that inspects caller-supplied input, and anything that can reject or drop must
  // happen before `openRead` consumes the grant. It also keeps every "we did not like your input"
  // log line on the near side of the billing boundary, which is where a triager looks first.
  const upstreamEhbp = relayEhbpHeaders(ehbp, 'request');

  // After the refusals, before the model: the same placement the legacy arm uses, and for the same
  // two reasons (a refused request must not spend a grant; two concurrent replays must not both
  // get a free read).
  //
  // `srcBytes` is what THIS Lambda measured. On the sealed arm `srcHash` is client-supplied and
  // therefore forgeable, so the measured size is the half of the source binding a caller cannot
  // lie about. See GRANT_BYTES_TOLERANCE in correctionGrant.mjs.
  const read = await openRead({
    familyId: family,
    srcHash,
    srcBytes: bytes.length,
    arm: 'sealed',
    correction,
  });

  // A correction the grant store REFUSED is refused here too, never silently downgraded to a
  // charged read — but ONLY for the reasons that are the family's doing. `HARD_REFUSAL_REASONS`
  // draws that line: the kill switch, a store blip, a grant minted before the size band shipped,
  // and a grant earned on the other arm all fall through to a CHARGED read instead, because none
  // of those is something the family did. See the set's own comment.
  if (correction && HARD_REFUSAL_REASONS.has(read.reason)) {
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
    extraHeaders: upstreamEhbp,
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
