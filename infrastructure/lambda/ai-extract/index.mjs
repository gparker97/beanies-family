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
 * GATE 3 (#49): see ADR-030 § Gates for the current status. Do NOT restate it here.
 *
 * ⚠️ This header has carried a WRONG Gate-3 status three times now — "SHIPPED" when the feature
 * was 100% broken, then "NOT YET PROVEN" after a real sealed extraction had succeeded. Each
 * version also said "ADR-030 is the authority", which is the tell: a status duplicated in a
 * comment drifts from the document that owns it, and the comment is always the stale copy. So it
 * is a pointer now, and the only rules kept here are the ones that are local and durable:
 *
 *   · a client sending `protocol: 'ehbp-1'` encrypts to the ATTESTED enclave key before anything
 *     leaves the device, and `sealedForward.mjs` relays ciphertext this function cannot read;
 *   · the legacy plaintext arm below still serves store builds that have not updated, and on
 *     that arm this proxy DOES see the document in memory (retaining nothing);
 *   · NEVER log the document bytes, on either arm.
 */

import { EXTRACTION_TASKS } from './extractionPrompt.mjs';
import { closeRead, openRead, sourceFingerprint, validateCorrection } from './meter.mjs';
import { HARD_REFUSAL_REASONS } from './correctionGrant.mjs';
import { checkLimits } from './rateLimit.mjs';
import {
  SEALED_CONFIG_PROTOCOL,
  SEALED_PROTOCOL,
  safeTaskLabel,
  sealedForward,
} from './sealedForward.mjs';
import { UPSTREAM_ERROR_TEXT, callUpstream } from './upstream.mjs';

const TINFOIL_API_KEY = process.env.TINFOIL_API_KEY;
const API_KEY = process.env.AI_EXTRACT_API_KEY;
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
 * A stable SIZE for the source, for the correction grant's band. Never the request envelope.
 *
 * ⚠️ Two constraints, and the obvious implementations break one each.
 *
 *  1. It must be IDENTICAL on the paid read and on the correction re-read. `rawBody.length` is
 *     not: the correction request carries ~76 extra bytes of `correction:{token,to}` JSON, which
 *     only falls inside the ±5% band above ~1500 bytes — so every short text share would have its
 *     free correction refused and charged.
 *  2. It must not ALLOCATE. `JSON.stringify(source).length` satisfies (1) but builds a complete
 *     second copy of the payload — up to ~5MB of base64 — purely to read a length, in a 256MB
 *     Lambda that already holds `rawBody`, `parsed`, the image array and the fingerprint's own
 *     join. `sealedForward.mjs` documents what a large transient costs here: the process dies
 *     before any try/catch, and API Gateway answers a bare 502 with no CORS headers.
 *
 * Summing the lengths satisfies both. Note this counts UTF-16 code units, not bytes — the grant
 * attribute is called `bytes` for historical reasons. That is fine: it only ever has to be a
 * stable, server-measured number compared against itself.
 */
function sourceSize(source) {
  if (source.kind === 'text') return source.text.length;
  return source.imageDataUrls.reduce((n, url) => n + url.length, 0);
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
    // `code` added with #49 and deliberately BEFORE the arm router, so it covers both. A sealed
    // client cannot cheaply pre-guess this bound (it would have to model the envelope overhead),
    // so the server's verdict is the real one and it needs to be classifiable rather than a bare
    // status the client reports as a generic failure.
    return response(413, { error: 'Payload too large', code: 'payload_too_large' }, event);
  }

  let parsed;
  try {
    parsed = JSON.parse(rawBody || '{}');
  } catch {
    return response(400, { error: 'Malformed JSON body' }, event);
  }

  // ── Arm router (#49) ──────────────────────────────────────────────────────────────────────
  //
  // `protocol` absent means a client built before the sealed arm existed, which is the ONLY
  // reason the plaintext arm below still exists: `VITE_AI_EXTRACT_URL` is baked into store
  // builds, and a store build updates when the USER updates it, not when we deploy. Removing
  // the legacy arm would hand every un-updated install a 400 with no `code`, which the client
  // maps to the generic "something went wrong" toast.
  //
  // ⚠️ DEPLOY ORDER IS ASYMMETRIC. New Lambda + old bundle works (it takes the legacy arm). New
  // bundle + old Lambda does not, because an old Lambda reads `protocol` as an unknown field and
  // falls into the legacy path with no source. Lambda first, always.
  // The model id a sealed client must put INSIDE its sealed body.
  //
  // ⚠️ WHY THIS EXISTS AT ALL. The enclave requires `model` and rejects a body without it
  // (`400 Missing required parameter: 'model'`, validated before auth). The body is ciphertext,
  // so this Lambda CANNOT add the field on the way through — the client has to know it before it
  // seals. Baking it into the bundle would work but would destroy the `TINFOIL_MODEL` Terraform
  // lever, and `variables.tf` records that lever being used to hotfix a Tinfoil model retirement
  // the same day; without it the next retirement would need an App Store release.
  //
  // So the client asks, on this same route (no new API Gateway path, no terraform), and memoises
  // the answer alongside its attestation. A model change stays a Lambda env change.
  if (parsed?.protocol === SEALED_CONFIG_PROTOCOL) {
    return response(200, { model: TINFOIL_MODEL }, event);
  }
  if (parsed?.protocol === SEALED_PROTOCOL) {
    // AWAITED inside the handler's own try/catch below would be ideal, but the legacy arm owns
    // that try. So the sealed arm gets its own here: without it a throw rejects the handler
    // promise and API Gateway synthesises a raw 502 with NO CORS headers, which a browser sees as
    // an opaque network error. That is the exact incident the task-registry comment below records.
    try {
      return await sealedForward(parsed, event, response);
    } catch (err) {
      console.error('[ai-extract] sealed arm error:', err);
      return response(500, { error: 'Internal server error' }, event);
    }
  }
  if (parsed?.protocol !== undefined) {
    // Its own code, like `unknown_task`: this is a DEPLOY-ORDER problem, not a user problem, and
    // without a machine-readable code the client shows "something went wrong" for what is really
    // "not deployed yet".
    console.warn('[ai-extract] unknown protocol');
    return response(400, { error: 'Unknown protocol', code: 'unknown_protocol' }, event);
  }

  // ── LEGACY-PLAINTEXT-ARM begins ───────────────────────────────────────────────────────────
  //
  // Everything from here to `LEGACY-PLAINTEXT-ARM ends` serves clients that predate the sealed
  // arm. It is scheduled for deletion; see ADR-030's sunset condition. `grep -rn
  // LEGACY-PLAINTEXT-ARM` finds every site that goes with it.
  //
  const {
    imageDataUrls,
    imageDataUrl,
    text,
    todayIso,
    task: rawTask,
    familyId,
    correction,
  } = parsed || {};
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
  // Gated on `hasText`, and that is now a statement about THIS ARM ONLY. It was safe here only
  // because this arm can SEE that a request is text. The sealed arm cannot, so it runs the
  // limiter unconditionally — which is not an incidental tightening but the compensating control
  // for the `sources` fence above, which ciphertext makes unenforceable forever. The follow-up
  // that ADR-035 recorded as "widen the limits to images" has therefore landed, on the arm where
  // it was needed. Do not reconcile the two: widening it here would change a working reader's
  // behaviour for no new safety, on an arm scheduled for deletion.
  //
  // ⚠️ `checkLimits` never throws and fails open internally, which is why this is one `if`
  // and not a nested try/catch. Keeping this validation section flat is why it stays readable.
  // Shape-check the correction BEFORE the grant is consumed, so a malformed one costs nothing
  // and leaves the grant spendable. `to` reaches the model's INSTRUCTION rather than its fenced
  // source, so a closed set is a security fence here, not a formality.
  const correctionFault = validateCorrection(correction);
  if (correctionFault) {
    return response(400, { error: 'Bad correction', code: 'bad_correction' }, event);
  }

  // ⚠️ A correction is only meaningful on `share`, and refusing it elsewhere is a FENCE, not
  // tidiness. A grant is bound to the family and the document — but not to a task,
  // so without this a grant earned on a `share` read can be spent on a `recipe` one: the
  // builder ignores the hint, the model is called and billed, the result carries no `kind`, and
  // the wrong-kind guard below 502s a request that was never going to succeed. The grant is
  // gone and the call is paid for, deterministically, on a path no UI can produce.
  if (correction && task !== 'share') {
    return response(400, { error: 'Bad correction', code: 'bad_correction' }, event);
  }

  // ⚠️ THE COUNTER THE WHOLE RETIREMENT DEPENDS ON. ADR-030 step 3 says "the legacy counter
  // reads zero for a full release cycle", and its Logs Insights query filters for exactly this
  // literal. The line was specified in the plan and then never written, so the query matched
  // nothing and the counter read zero FROM DAY ONE — which would have read as "no legacy
  // traffic, safe to delete" while every un-updated store build was still using this arm. A
  // retirement trigger indistinguishable from a broken trigger is worse than none.
  //
  // ⚠️ PLACEMENT AND LABEL ARE BOTH LOAD-BEARING, and the first version got both wrong.
  //
  //  · It sat immediately after the arm router, so every authenticated POST merely lacking a
  //    `protocol` counted — including junk that 400s a few lines later. The `x-api-key` ships in
  //    the public bundle, so one scanner would keep "reads zero" permanently unsatisfiable and
  //    the operator could not tell "un-updated store builds still extracting" (do not delete)
  //    from "a bot" (safe to delete). It now sits after the LAST pre-model refusal, so it counts
  //    requests that were actually going to be served.
  //  · It logged `safeTaskLabel(parsed?.task)`, and the OLDEST clients send no `task` at all —
  //    that is what the `rawTask === undefined ? 'event'` default above exists for. So the exact
  //    generation the sunset is waiting out was labelled `task=invalid`, byte-identical to a
  //    forged task. It now logs the RESOLVED task.
  //
  // Deliberately NOT alarming: it must stay out of ALARMING_PREFIXES so ordinary legacy traffic
  // never pages. Note `meter.test.mjs` only asserts the FORWARD direction (every alarming prefix
  // has a filter in main.tf) — nothing stops someone adding a filter that pages on this line, so
  // that remains a review matter rather than a guarded one.
  console.log(`[ai-extract] legacy plaintext request task=${safeTaskLabel(task)}`);

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

  // Everything the meter needs to know, decided once and here: after the refusals (so a
  // rate-limited correction does not spend its grant) and before the model (so two concurrent
  // replays cannot both get a free read).
  const read = await openRead({
    familyId: typeof familyId === 'string' ? familyId : undefined,
    // The hash, not the source (#49). `openRead` is shared with the sealed arm, which has only
    // ciphertext and reads its hash off the envelope — so the side that HAS the plaintext is the
    // side that fingerprints it.
    srcHash: sourceFingerprint(source),
    // The legacy arm's own measuring stick: THE SOURCE, not the request that carried it.
    //
    // This arm used to pass no measurement at all, which combined with
    // `attribute_not_exists(#bytes)` in the grant condition to make the size band a no-op for
    // every grant it issued — the cheap-buys-expensive bypass (#49).
    //
    // ⚠️ AND IT MUST NOT BE `rawBody.length`, which was the obvious first answer and is wrong.
    // The band compares the PAID read against the CORRECTION re-read, and the correction request
    // carries an extra `correction: { token, to }` field — about 75 bytes of JSON the paid read
    // did not have. As a fraction of the whole body those 75 bytes only fall inside ±5% once the
    // body exceeds ~1500 bytes, so every SHORT TEXT share (a pasted line is ~100 bytes) would
    // have had its free correction refused and charged, silently, on the arm every un-updated
    // client still uses. The source is byte-identical across both requests; the envelope is not.
    //
    // Tagged `legacy` because this number is plaintext source bytes and the sealed arm's is
    // ciphertext length; the two are not interchangeable, and the `arm` clause is what stops
    // them ever being compared.
    srcBytes: sourceSize(source),
    arm: 'legacy',
    correction,
  });

  // ⚠️ A correction the grant store REFUSED is refused here too, not silently downgraded.
  //
  // Downgrading runs the request as an ordinary read: the hint is dropped (it is honoured only
  // against a spent grant), so at temperature 0 on the same bytes the model returns the same
  // wrong kind; the kind guard below cannot fire because there is no hint; and `countUsage`
  // charges `n`. The user tapped a button labelled free, was charged, got the same wrong
  // answer, and — because the client discards the token when it sends it — lost the affordance.
  //
  // ⚠️ Gated on `reason === 'refused'`, NOT on `!read.free`. The other two outcomes must still
  // fall through to a charged read:
  //   · `disabled`       — the CORRECTION_GRANTS kill switch. `variables.tf` promises that
  //                        turning it off makes corrections "simply cost a bean"; 409ing every
  //                        in-flight token during the exact incident the switch exists for
  //                        would make that documentation false.
  //   · `store_unavailable` — a DynamoDB blip. `checkLimits` next door deliberately fails OPEN
  //                        on the identical failure, because a blip must not lock a family out.
  if (correction && HARD_REFUSAL_REASONS.has(read.reason)) {
    return response(409, { error: 'Correction refused', code: 'correction_refused' }, event);
  }

  try {
    // ⚠️ Through `upstream.mjs`, the SHARED ladder. An earlier version of #49 left this inline
    // and added a second copy in that module, so "both arms need it" was aspiration rather than
    // fact: a new retryable status or a timeout change applied there would have silently missed
    // every legacy request, which is the fleet of un-updated store builds that cannot self-heal.
    const call = await callUpstream({
      body: JSON.stringify({
        model: TINFOIL_MODEL,
        messages: taskConfig.buildMessages(source, todayDate, read.kindHint),
        temperature: 0,
      }),
    });
    if (!call.ok) {
      return response(
        call.status,
        { error: UPSTREAM_ERROR_TEXT[call.code] ?? 'Upstream inference failed', code: call.code },
        event
      );
    }
    const upstream = call.upstream;

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

    // LEGACY-PLAINTEXT-ARM. The sealed arm cannot run this guard, because it never sees the
    // result; the CLIENT reproduces it there, including the `none` split below. Two copies exist
    // only until this arm is retired, and they must agree — `managedProvider.ts` cites this block.
    //
    // A correction ASSERTED what this is, so a result of a different kind is a wrong-shape
    // answer rather than a re-classification. Only reachable when a grant was actually spent.
    //
    // ⚠️ BEFORE `closeRead`, with the other shape checks. After it, a wrong-kind answer would
    // be RECORDED as a free correction on a request that returned the user nothing — and every
    // other 502 here already follows the opposite rule: a read that produced nothing usable is
    // counted in neither column.
    if (read.kindHint && result?.kind !== read.kindHint) {
      // ⚠️ `safeTaskLabel` ON BOTH. `result.kind` is MODEL OUTPUT derived from caller-supplied
      // document text, so a prompt injection can make it any string — including
      // "[ai-extract] usage-count write failed", whose metric filter (main.tf) matches as a
      // SUBSTRING anywhere in the line and alarms at threshold 1. One request would then page
      // #beanies-errors with a fabricated "read succeeded but was NOT counted" incident. The
      // `ehbp` key names and `task` were sanitised for exactly this; this sink was missed.
      console.error(
        `[ai-extract] correction returned kind=${safeTaskLabel(result?.kind)} ` +
          `want=${safeTaskLabel(read.kindHint)}`
      );
      // `none` is a DISAGREEMENT, not a malformed answer: the hinted prompt asks the model to
      // extract the asserted kind and leaves it exactly one way out — "only if the document
      // contains nothing at all that could fill those fields". Observed live, correcting a
      // parents-evening notice to `travel`. Folding it into `model_shape` tells the user
      // "couldn't make sense of that one, try a clearer photo", which is false and invites a
      // retry that costs a bean. Its own code, so the toast can say what actually happened.
      //
      // A different concrete kind IS a shape failure — the model was told not to re-decide.
      const disagreed = result?.kind === 'none';
      return response(
        disagreed ? 422 : 502,
        disagreed
          ? { error: 'Correction not supported by the document', code: 'correction_disagreed' }
          : { error: 'Model returned wrong-shape output', code: 'model_shape' },
        event
      );
    }

    // Count the bean. AWAITED, not fire-and-forget: Lambda freezes the execution environment
    // the moment the handler returns, so a `void` call frequently never reaches DynamoDB AND
    // never logs its own failure — a silent, unalertable undercount. It never throws and never
    // fails the request; a lost count is a logged, alertable gap (see countUsage.mjs).
    //
    // Here and nowhere else: this is the only `response(200, …)` in the handler, so "a bean is
    // spent exactly when beanies answered you" falls out of the existing control flow with no
    // special-casing. A `kind: 'none'` share is a 200 and counts, deliberately.
    const grant = await closeRead(read, {
      familyId: typeof familyId === 'string' ? familyId : undefined,
      task,
    });

    // Retain nothing: no document bytes, no model content — only a structured success line.
    console.log(`[ai-extract] ok task=${task} enclave=${enclave || 'unknown'}`);
    return response(
      200,
      { result, attestation: enclave ? { enclave } : undefined, correction: grant },
      event
    );
  } catch (err) {
    console.error('[ai-extract] error:', err);
    return response(500, { error: 'Internal server error' }, event);
  }
  // ── LEGACY-PLAINTEXT-ARM ends ─────────────────────────────────────────────────────────────

  // ⚠️ THE TERMINAL REFUSAL, AND IT LIVES OUTSIDE THE MARKED BLOCK ON PURPOSE.
  //
  // Everything from `LEGACY-PLAINTEXT-ARM begins` to `ends` goes in one deletion at retirement
  // (ADR-030 sunset step 4), together with `extractionPrompt.mjs`. Unreachable while that block
  // is here, because every path above returns.
  //
  // The first version of these markers put `ends` after this line, which made the deletion the
  // runbook describes actively unsafe: removing the block would have taken the handler's only
  // terminal path with it, so a request with no `protocol` fell off the end of the function and
  // returned undefined. API Gateway answers that with a bare 502 carrying NO CORS headers — the
  // exact incident this file documents twice — for every un-updated store build, at the moment
  // we believed we were tidying up. A boundary marker that makes the deletion wrong is worse
  // than no marker.
  //
  // After retirement this is what an un-updated client gets, and it is the honest answer: the
  // client maps `unknown_protocol` to the friendly "not set up yet" notice rather than an opaque
  // failure, and the update prompt (`min-app-version.json`) is what actually resolves it.
  // ⚠️ The `no-unreachable` suppression below is DELIBERATE, and the lint error is the proof
  // that this line is doing its job. It is unreachable precisely because the legacy arm above
  // still returns on every path — that is the point. It is the floor the handler lands on once
  // that block is deleted at retirement. Deleting it to silence the lint would restore the exact
  // defect it exists to prevent: a handler that returns undefined, which API Gateway renders as
  // a CORS-less 502 for every un-updated store build.
  // eslint-disable-next-line no-unreachable
  return response(400, { error: 'Unknown protocol', code: 'unknown_protocol' }, event);
}
