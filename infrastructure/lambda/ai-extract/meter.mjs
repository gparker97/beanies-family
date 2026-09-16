/**
 * The magic-bean meter, as two verbs.
 *
 * WHY A SEAM AND NOT FIVE INSERTIONS
 * `index.mjs` is one linear validate-then-call function and its own comment says why that
 * matters: "keeping this validation section flat is why it stays readable". The meter needs to
 * act at five points — consume a grant before the upstream call, pass a kind hint into the
 * prompt, tighten the shape check, count, and issue a grant — each knowing which table, which
 * attribute, and in what order. Five scattered touch points in a 320-line handler is the shape
 * that half-updates. So the handler learns `openRead` and `closeRead`, and everything else
 * lives behind them.
 *
 * The ordering invariant that must never be lost — count BEFORE grant, grant only if the count
 * landed — is enforced inside `closeRead`, where it can be unit-tested without a handler
 * fixture.
 */

import { COUNT_FAILED_PREFIX, COUNT_SKIPPED_PREFIX, countUsage } from './countUsage.mjs';
import { USAGE_ATTRS } from './ddb.mjs';
import {
  GRANT_MISMATCH_PREFIX,
  SHARE_KINDS,
  consumeGrant,
  issueGrant,
  sourceFingerprint,
  validateCorrection,
  validateCorrectionToken,
} from './correctionGrant.mjs';

// One import site for both arms. `sourceFingerprint` is re-exported here rather than imported
// straight from `correctionGrant.mjs` by the handler, because `openRead` stopped taking a
// `source` (#49) and the caller that still HAS the plaintext now has to hash it itself.
export { SHARE_KINDS, sourceFingerprint, validateCorrection, validateCorrectionToken };

/**
 * ⚠️ The log prefixes that have a CloudWatch metric filter. `meter.test.mjs` asserts each of
 * these appears verbatim in `modules/ai-extract/main.tf`.
 *
 * This map is ONLY the alarming ones. `[ai-extract] ok task=` and the limiter's
 * `rate_limited limit=` are triage lines with no filter; an "every prefix the Lambda logs"
 * assertion would fail on those and then get weakened to nothing.
 */
export const ALARMING_PREFIXES = Object.freeze({
  // ⚠️ IMPORTED, never re-typed. These used to be fresh literals, so `meter.test.mjs` asserted
  // the COPIES against terraform: changing the string a `console.error` actually emits left
  // every test green while the metric filter matched nothing — an alarm that silently stopped
  // firing, which looks exactly like an alarm with nothing to report.
  countFailed: COUNT_FAILED_PREFIX,
  countSkipped: COUNT_SKIPPED_PREFIX,
  grantMismatch: GRANT_MISMATCH_PREFIX,
});

/**
 * Decide, before the model runs, whether this read is free and what kind it is correcting.
 *
 * Called immediately before the upstream fetch — AFTER every pre-model refusal (401/413/400/429)
 * has already returned. Before the model is what stops two concurrent replays both getting a
 * free read; after the refusals is what stops a rate-limited or malformed correction silently
 * spending its grant on a request that never reached a model.
 *
 * ⚠️ A grant spent on a read that then FAILS is not given back, and that is a decision rather
 * than an omission. An earlier version refunded in the handler's `finally`; because a grant is
 * bound to the family and the document but NOT to a task, that turned the wrong-kind
 * 502 into an unbounded loop of free, uncounted, billable model calls — a meter bypass strictly
 * worse than the cost it removed. It also could not help the person it refunded: the banner
 * closes its host review modal before the re-read starts, so by the time a refund lands there is
 * no surface left to spend it from. The accepted trade stands: a correction lost to an upstream
 * failure costs the family a bean on the retry, and the fences stay simple enough to reason about.
 *
 * ⚠️ Takes `srcHash`, NOT `source`. The sealed arm (#49) forwards ciphertext and has no source to
 * fingerprint, so the hash is computed by whoever DOES have the plaintext: the legacy arm calls
 * `sourceFingerprint(source)` itself, the sealed arm reads it off the envelope. Deliberately one
 * parameter with one meaning rather than accepting either — a dual-mode signature would make this
 * shared meter the place where two transport arms became visible, which is exactly where that
 * knowledge must not leak to.
 *
 * @returns {{ free: boolean, reason: string|undefined, kindHint: string|undefined, srcHash: string|null, wasCorrection: boolean }}
 */
export async function openRead({
  familyId,
  srcHash = null,
  correction,
  now = Date.now(),
  ddb,
} = {}) {
  if (!correction) return { free: false, kindHint: undefined, srcHash, wasCorrection: false };

  const verdict = await consumeGrant({ familyId, correction, srcHash, now, ddb });
  return {
    free: verdict.free,
    // WHY the grant was not spent, so the handler can tell a genuine refusal from the kill
    // switch and from a store outage. Those three must not share an outcome: only the first
    // means "do not read this".
    reason: verdict.reason,
    // ⚠️ The hint is honoured ONLY when a grant was actually spent. Accepting it otherwise would
    // let any client bias every extraction, which is the "what IS this?" guess the one-surface
    // work exists to remove. A user-stated kind AFTER seeing a wrong answer is a categorically
    // different thing from a positional hint before the model has looked.
    kindHint: verdict.free ? correction.to : undefined,
    srcHash,
    wasCorrection: true,
  };
}

/**
 * Count the read, then issue a correction grant if one is warranted.
 *
 * Awaited before the 200 returns. Lambda freezes the execution environment the moment the
 * handler returns, so a fire-and-forget write frequently never lands AND never logs its own
 * failure — a silent, unalertable undercount.
 *
 * ⚠️ WHERE THE BEAN IS SPENT DIFFERS BY ARM, and the difference is user-visible (#49).
 *
 * On the LEGACY arm this is called after the answer has been parsed and shape-checked, so a read
 * that produced nothing usable is counted in neither column.
 *
 * On the SEALED arm the Lambda cannot read the answer at all, so it is called on any successful
 * response from the enclave. A model that returns unparseable JSON therefore COSTS A BEAN there,
 * where today it costs nothing. That is a real, small regression and it was accepted knowingly:
 * every alternative routes through the client declaring "that did not parse", and a
 * client-declared refund is a meter bypass by construction. The rule on the sealed arm is "a bean
 * is spent when the enclave answered", not "when we could read the answer". Timeouts and refusals
 * still cost nothing on both arms, because a non-200 upstream never reaches here.
 *
 * ⚠️ It takes no `result`. It used to derive `resultKind` for the grant's kind-binding, which #49
 * removed because the sealed arm has no result to read. Do not reintroduce the parameter for the
 * legacy arm's benefit: a grant that behaved differently depending on which arm issued it is a
 * far worse thing to reason about than the guard that was lost.
 *
 * @returns {{ token: string }|undefined} spread into the 200 body as `correction`.
 */
export async function closeRead(read, { familyId, task, now = Date.now(), ddb } = {}) {
  // A free correction still gets RECORDED, on its own attribute. `n` is what an allowance is
  // spent against; `c` is our cost, not the family's. An entitlement layer that summed the row
  // would bill families for our miscategorisations, which is the opposite of the promise.
  const counted = await countUsage({
    familyId,
    attr: read?.free ? USAGE_ATTRS.corrected : USAGE_ATTRS.charged,
    now,
    ddb,
  });

  return issueGrant({
    familyId,
    task,
    srcHash: read?.srcHash,
    counted,
    wasCorrection: Boolean(read?.wasCorrection),
    now,
    ddb,
  });
}
