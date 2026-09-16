/* global process */
/**
 * The free correction: when beanies infers the WRONG kind, putting it right costs no bean.
 *
 * THE PROMISE. One bean per thing you hand over — and if we get the kind wrong, correcting it
 * is free, once. That is a stronger promise than the one it replaces, and it is ours to keep
 * because the error was ours.
 *
 * WHY THIS IS NOT JUST A FLAG ON THE REQUEST
 * A client that can say "this one is free" IS the meter bypass. So the exemption is a grant the
 * SERVER issues, stores, and can only be spent once — and every guard is in a single atomic
 * condition rather than a read-then-write that two concurrent replays could both pass.
 *
 * WHY IT IS SAFE WHERE AN `attemptId` WOULD NOT HAVE BEEN
 * An earlier design deduped writes with a client-supplied attempt id inside a transaction.
 * `TransactWriteItems` is all-or-nothing, so replaying an id would have cancelled the COUNTER
 * increment along with the marker — unlimited uncounted reads, one line of client code, and
 * silent by construction. The failure directions here are the opposite: a replayed grant fails
 * to grant an exemption, so the read is CHARGED. It fails toward billing, and a grant only
 * exists because a read was already paid for.
 *
 * THE SIX GUARDS, all in one ConditionExpression:
 *   exists          — a grant was actually issued for this family
 *   not consumed    — single use
 *   not expired     — enforced on READ, because DynamoDB's TTL reaper can lag ~48h
 *   same source     — the free read is a RE-read of the thing you paid for, not a new one
 *   same arm        — the two arms measure different things; see the ARM note on the condition
 *   same size       — the half a client cannot forge, which is what makes `srcHash` safe to trust
 *
 * ⚠️ A FOURTH, "different kind", was removed with #49. The sealed arm forwards ciphertext, so the
 * Lambda never sees the model's answer and cannot bind a grant to the kind it was earned on.
 * What still holds without it: a grant is single-use, and it is bound to `familyId + srcHash`.
 * So the worst case is ONE free re-read per paid read of the same document — which is exactly the
 * promise at the top of this file. What is lost is only the ability to refuse a "correction" that
 * asserts the kind the read already returned; that now costs the user nothing and gains them one
 * re-read they were already entitled to.
 *
 * The source binding is the one doing the heaviest lifting. Without it: pay for a 40-character
 * text read, then "correct" it with an 8-page PDF for free. The expensive half of every pair
 * would be free, forever. On the LEGACY arm it is also the fence that matters most, because
 * `FAMILY_LIMIT` is gated on `hasText` there and does not cover the image path at all. On the
 * SEALED arm that gap is closed: the limiter runs for every request, because ciphertext hides
 * the source kind and a client-declared one would be a fence anybody could step over.
 *
 * Grants live in the RATE table, not the usage table: the usage table is billing evidence with
 * PITR and prod deletion protection, and hourly grant rows do not belong in it. The rate
 * table's hourly TTL horizon is already exactly a grant's lifetime.
 */

import { grantKey, hash, resolveClient } from './ddb.mjs';

/** A grant only has to outlive the user reading the answer and deciding it is wrong. */
const GRANT_TTL_SECONDS = 3600;

/** The kinds a correction may target. Re-stated here because TypeScript does not exist at runtime. */
export const SHARE_KINDS = Object.freeze(['event', 'travel', 'recipe']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * ⚠️ The exact prefix a CloudWatch metric filter matches. `meter.test.mjs` asserts it against
 * `modules/ai-extract/main.tf`, so a drifted string fails CI rather than silently disarming the
 * alarm — which looks identical to an alarm with nothing to report.
 *
 * `different_source` is the one refusal reason that means the FEATURE is broken rather than
 * someone probing it: missing / spent / expired are all expected in normal operation.
 */
export const GRANT_MISMATCH_PREFIX = '[ai-extract] correction refused reason=different_source';

/** Every other refusal — missing, expired, already spent, or a no-op. Normal operation. */
export const GRANT_REFUSED_PREFIX = '[ai-extract] correction refused reason=';

/**
 * The refusal that means someone is PROBING THE METER, rather than the feature being broken or
 * a user being ordinary.
 *
 * `different_size` fires when a grant is presented against a document of a materially different
 * size to the one it was earned on, with a `srcHash` that matches anyway — which on the sealed
 * arm requires forging the hash, because it is client-supplied there. That is the
 * cheap-buys-expensive attempt the whole byte band exists to detect.
 *
 * ⚠️ It had no metric filter, so the condition detected the attack and then threw the evidence
 * into an unalarmed log line indistinguishable from a user who left a review modal open past the
 * grant's hour. Its own constant now, for the same reason `GRANT_MISMATCH_PREFIX` has one: a
 * composed string cannot be asserted against terraform, and `meter.test.mjs` asserts these.
 *
 * The measurement is deterministic for a genuine re-read — the legacy arm measures the source's
 * own length, the sealed arm a ciphertext whose only variation is the correction hint (~0.07% of
 * a ~14KB body) — so the expected steady state is exactly zero, not a trickle.
 */
export const GRANT_SIZE_MISMATCH_PREFIX = `${GRANT_REFUSED_PREFIX}different_size`;

/**
 * Fingerprint of what was actually sent to the model.
 *
 * Hashes the WIRE payload — the compressed data URLs or the text — because that is what the
 * correction will re-send. Hashing the original file instead would mean the guard depended on
 * canvas JPEG encoding being bit-identical across two passes, which is probably true and not
 * something to bet the feature on.
 */
export function sourceFingerprint({ text, imageDataUrls }) {
  if (typeof text === 'string') return hash(`t:${text}`);
  if (Array.isArray(imageDataUrls)) return hash(`i:${imageDataUrls.join('\n')}`);
  return null;
}

/**
 * Is this a well-formed correction request? Returns a reason, or null when it is fine.
 *
 * ⚠️ ABSENT is the only thing that passes without inspection. An earlier version short-circuited
 * on `typeof correction !== 'object'`, which let `correction: 42` / `'x'` / `true` through as
 * "well-formed": the closed-set fence never ran, `openRead`'s `if (!correction)` did not catch
 * them either, and DynamoDB was handed `{S: undefined}` — a ValidationException that the
 * refusal arm reports as an operator-facing store outage, triggerable by anyone holding the
 * api key that ships in the public bundle. Check the SHAPE, then the fields.
 */
/**
 * The token half of `validateCorrection`, on its own.
 *
 * Split out for the SEALED arm (#49), which sends `correction: { token }` and no `to`. There is
 * nothing left for `to` to do there: `consumeGrant` no longer conditions on the kind, and the
 * closed-set check below exists ONLY because `to` reaches the model's instruction — which, on the
 * sealed arm, it never does, because the client builds the prompt itself. Sending it anyway would
 * put the family's own assertion about their document ("this is a travel booking") on the wire in
 * cleartext for no remaining purpose.
 *
 * Both arms share this so the token rule cannot drift into two spellings.
 */
export function validateCorrectionToken(token) {
  // Bounds the grant key below DynamoDB's 2048-byte limit. Without it an oversized token throws
  // ValidationException, is caught by the refusal arm, and the family is CHARGED.
  if (typeof token !== 'string' || !UUID_RE.test(token)) return 'bad_token';
  return null;
}

export function validateCorrection(correction) {
  if (correction === undefined || correction === null) return null;
  if (typeof correction !== 'object' || Array.isArray(correction)) return 'bad_shape';
  const { token, to } = correction;
  // `to` reaches the model's INSTRUCTION, outside the untrusted-source fence that bounds the
  // document. An unvalidated value here is a prompt-injection channel on a call the family is
  // not even paying for — so it is a closed set, checked server-side, not a formality.
  if (!SHARE_KINDS.includes(to)) return 'bad_kind';
  return validateCorrectionToken(token);
}

/**
 * Which of the six guards refused, from the item `ALL_OLD` returns on the thrown error.
 *
 * `unknown` is the honest answer when the runtime gave us nothing to read — it is NOT folded
 * into `different_source`, which is the one reason that means the feature is broken rather than
 * someone probing it, and the only one with an alarm.
 *
 * ⚠️ The fallthrough has moved TWICE and the current one is deliberate. It was `same_kind` until
 * #49 removed that guard, then `unknown`. It is now `different_size`, because the size band is
 * the last clause that can refuse once existence, spend, expiry, source, binding and arm have
 * each been ruled out by their own branch. Naming it is worth more than `unknown` here: it is
 * the cheap-buys-expensive attempt, and it is the only refusal reason that indicates someone
 * probing the meter rather than ordinary use.
 */
function refusalReason(err, srcHash, nowSeconds, arm, srcBytes) {
  const item = err?.Item;
  if (!item || typeof item !== 'object') return 'unknown';
  if (item.consumed) return 'spent';
  // ⚠️ Only claim `expired` when the attribute PROVES it. `Number(undefined)` is NaN and every
  // NaN comparison is false, so a missing `expires_at` silently skipped this branch and used to
  // fall all the way through to the terminal one — which, once that terminal became
  // `different_size`, meant a grant written without a TTL was reported as a meter attack.
  //
  // A missing attribute is not an expiry, so it keeps looking: a differing `src` is still named
  // as `different_source` (the actionable, alarmed one), and if nothing else explains the
  // failure it lands on `unknown`, which is the honest answer for a grant that has no TTL and
  // should therefore never have been written.
  if (item.expires_at?.N && Number(item.expires_at.N) <= nowSeconds) return 'expired';
  if (item.src?.S && item.src.S !== srcHash) return 'different_source';
  // A grant minted before #49 shipped, which carries neither attribute. Bounded to one
  // GRANT_TTL_SECONDS window after the deploy and then impossible, so seeing this later means
  // something is writing grants by a path that skipped `issueGrant`.
  if (!item.bytes?.N || !item.arm?.S) return 'unbound_legacy_grant';
  // Earned on one arm, spent on the other. The two measure different things, so the band could
  // not be applied honestly — see the ARM note on the condition.
  if (item.arm.S !== arm) return 'different_arm';
  // ⚠️ A REAL BRANCH, not the fallthrough, and the difference matters more now than it did.
  // `different_size` is the cheap-buys-expensive attempt — a forged `srcHash` that matches with
  // a body that does not — and it is the one refusal with a CloudWatch alarm pointed at it. As
  // a fallthrough it asserted "attack" for anything the ladder could not explain, which sends
  // an operator hunting someone who does not exist and pre-breaks whoever adds a seventh
  // condition clause without a matching branch here. Prove it instead.
  if (srcBytes != null) {
    const measured = Number(item.bytes.N);
    const lo = Math.floor(srcBytes * (1 - GRANT_BYTES_TOLERANCE));
    const hi = Math.ceil(srcBytes * (1 + GRANT_BYTES_TOLERANCE));
    if (measured < lo || measured > hi) return 'different_size';
  }
  // Never name a guard you cannot prove refused. Restored deliberately: the docblock above has
  // said so since this function existed, and the terminal branch briefly stopped honouring it.
  return 'unknown';
}

/**
 * Spend a correction grant, if it is real.
 *
 * NEVER throws. Returns `{ free: boolean, reason?: string }` — `free: false` means charge
 * normally, which is the conservative outcome for every failure including an unavailable store.
 */
/**
 * How far a re-read's sealed size may differ from the read that earned the grant.
 *
 * ⚠️ THIS IS A SECURITY FENCE, not a tolerance for convenience. On the sealed arm `srcHash` is
 * CLIENT-supplied, so the source binding above — the guard this file calls the one doing the
 * heaviest lifting — can be forged: seal a ten-character prompt with `srcHash: 'a'.repeat(64)`
 * (cheap, charged, earns a grant), then seal an eight-page document with the SAME hash and that
 * token (expensive, free). `#src = :src` matches every time, and every cheap read buys a free
 * expensive one.
 *
 * The byte count is the half the client CANNOT forge, because the Lambda measures what it actually
 * received. A genuine re-read of the same document seals to within a few bytes of the original
 * (HPKE adds a fixed overhead and the plaintext is identical), so a tight band costs nothing real
 * while making the cheap-buys-expensive trade impossible.
 */
export const GRANT_BYTES_TOLERANCE = 0.05;

/**
 * Which refusal reasons DENY the read outright, rather than falling through to a charged one.
 *
 * ⚠️ This distinction used to be flattened: every conditional failure returned the single reason
 * `'refused'`, and both arms turned that into a hard 409. That was wrong for the reasons that are
 * OUR doing rather than the family's, and the deploy window made it concrete — grants minted
 * before the size band shipped carry neither `bytes` nor `arm`, so for one GRANT_TTL_SECONDS
 * after any such deploy a family who paid for a read and tapped the free-correction banner got
 * "that free re-read has already been used, or it was for a different document". Wrong on both
 * counts, no read at all, and the client discards the token so the affordance is gone too.
 *
 * In the set: the family is spending something they do not have, and refusing is honest.
 * Out of the set: we could not evaluate the grant, so they get the read and pay for it — which
 * is what ADR-030 promises, and it fails toward giving them what they asked for.
 */
/**
 * What to do about each way a grant can fail to be spent. ONE table, three columns.
 *
 * ⚠️ This was three scattered decisions and they did not compose. `refuse` lived in a Set,
 * `hint` lived in `meter.mjs` as `verdict.free ? correction.to : undefined`, and nothing
 * connected them — so making a reason "soft" silently produced the WORST outcome of the three:
 * the family is charged AND gets an unhinted re-read, which at temperature 0 on the same bytes
 * returns the same wrong answer. `index.mjs` spells that out as the thing to avoid, and a plain
 * 409 is strictly kinder, because at least it does not charge.
 *
 *   refuse: true   → 409, no model call, nothing charged. For the cases where the family really
 *                    is spending something they do not have.
 *   refuse: false  → the read proceeds and is CHARGED. Only defensible when `hint` is also true,
 *                    because a charged repeat of the same wrong answer helps nobody.
 *   hint: true     → `correction.to` still reaches the prompt, so the re-read is the one the
 *                    family asked for. Only for reasons a CLIENT CANNOT FORCE — otherwise anyone
 *                    biases every extraction for free by sending a token that does not exist.
 */
export const GRANT_REFUSAL_POLICY = Object.freeze({
  // ── The family is spending something they do not have. Refuse, charge nothing. ──────────
  spent: { refuse: true, hint: false },
  expired: { refuse: true, hint: false },
  different_source: { refuse: true, hint: false },
  // The cheap-buys-expensive attempt, and the one reason with an alarm pointed at it.
  different_size: { refuse: true, hint: false },

  // ── OUR doing. Serve the read they asked for, hinted, and charge for it. ────────────────
  // A grant minted before the size band shipped. Bounded to one GRANT_TTL_SECONDS window.
  unbound_legacy_grant: { refuse: false, hint: true },
  // They updated the app between the paid read and the correction.
  different_arm: { refuse: false, hint: true },
  // A caller reached consumeGrant with no measurement: a bug in the calling arm.
  unmeasured: { refuse: false, hint: true },

  // ── Cannot be explained. REFUSE, and charge nothing. ───────────────────────────────────
  //
  // A client can manufacture this with a token that does not exist, so it cannot carry a hint.
  // And `refuse: false, hint: false` is the combination this table exists to make impossible:
  // the family would be CHARGED for a re-read that, at temperature 0 on the same bytes with no
  // hint, returns the same wrong answer. A 409 charges nothing, which is strictly kinder.
  //
  // ⚠️ KNOWN FAILURE MODE, stated rather than hedged. `ALL_OLD` needs
  // @aws-sdk/client-dynamodb >= v3.400, resolved from the unpinned Lambda runtime (`ddb.mjs`
  // already warns AWS has signalled it will stop providing the SDK). On a runtime that stops
  // populating `Item`, EVERY conditional failure collapses to this reason and no correction is
  // ever free again — visible as a spike in `reason=unknown`, and degraded rather than
  // data-losing. The alternative — softening this to hedge a hypothetical — would change what
  // real families see today to protect against something nobody has observed. If that spike
  // ever appears, pin the SDK; do not soften this line.
  unknown: { refuse: true, hint: false },
});

/** Reasons that deny the read outright. Derived, so the table stays the single source. */
export const HARD_REFUSAL_REASONS = new Set(
  Object.entries(GRANT_REFUSAL_POLICY)
    .filter(([, v]) => v.refuse)
    .map(([k]) => k)
);

/** May `correction.to` still reach the prompt, even though no grant was spent? */
export function refusalAllowsHint(reason) {
  return GRANT_REFUSAL_POLICY[reason]?.hint === true;
}

export async function consumeGrant({
  familyId,
  correction,
  srcHash,
  srcBytes = null,
  arm = null,
  now = Date.now(),
  ddb,
} = {}) {
  const table = process.env.RATE_TABLE;
  if (!table || !process.env.CORRECTION_GRANTS) return { free: false, reason: 'disabled' };
  if (!familyId || !correction || !srcHash) return { free: false, reason: 'missing' };
  // ⚠️ FAIL CLOSED on a missing measurement. The previous version passed `srcBytes: null`
  // straight through and let the condition decide, where a `srcBytes ? … : MAX_SAFE_INTEGER`
  // sentinel turned the band into [0, MAX_SAFE_INTEGER] — every possible size. An exemption
  // path that waves through what it cannot measure is not a fence. There is no caller that
  // legitimately reaches here without both values, so this is a programming error, not a
  // user-facing one: charge the read and say so in the log rather than granting for free.
  if (srcBytes == null || !arm) {
    console.warn(
      `${GRANT_REFUSED_PREFIX}unmeasured family_hash=${hash(familyId).slice(0, 12)} ` +
        `arm=${arm ?? 'none'} — a caller reached consumeGrant without a measurement; ` +
        'this is a bug in the calling arm, not a client doing something clever'
    );
    // NOT a hard refusal: a programming error on our side must not be the most user-visible
    // outcome of the three. Charge the read, exactly as the kill switch and a store blip do.
    return { free: false, reason: 'unmeasured' };
  }

  try {
    const { send, commands } = await resolveClient(ddb);
    const { UpdateItemCommand } = commands;
    await send(
      new UpdateItemCommand({
        TableName: table,
        Key: Object.fromEntries(
          Object.entries(grantKey(familyId, correction.token)).map(([k, v]) => [k, { S: v }])
        ),
        UpdateExpression: 'SET #consumed = :t',
        // EVERY name aliased. DynamoDB's reserved-word list is long and easy to be wrong about,
        // and being wrong here throws ValidationException — caught by the same arm as a real
        // refusal, so the family would be charged for every correction forever while the UI
        // kept promising free. Do not audit the list; alias.
        // SIX clauses. `expires_at > :now` is not redundant with the TTL attribute: DynamoDB's
        // TTL is a best-effort reaper that can lag by up to ~48h, so without this a grant the
        // header calls one-hour-lived stays spendable for two days — and the `expired` refusal
        // reason cannot be produced deterministically at all. The hour is a PRIVACY bound (the
        // stored source fingerprint), not just a convenience, so it has to be enforced on read.
        //
        // ⚠️ `#kind <> :to` was the fifth and is GONE (#49). It is not merely unnecessary now that
        // grants carry no kind — it would be actively fatal: DynamoDB evaluates a comparison
        // against a MISSING attribute as false, so leaving it in would refuse every correction,
        // silently, on a path whose whole promise is that correcting our mistake is free.
        //
        // The BYTES clause is the real source binding, and it is UNCONDITIONAL (#49).
        //
        // ⚠️ It used to read `(attribute_not_exists(#bytes) OR (#bytes BETWEEN :lo AND :hi))`,
        // and the legacy arm wrote no `bytes` attribute at all — so for every legacy-issued
        // grant the whole clause was TRUE by default and the band did nothing. That is the
        // cheap-buys-expensive trade the band exists to prevent, reachable by earning a grant
        // cheaply on the legacy arm and spending it on an eight-page document on the sealed arm,
        // where `srcHash` is client-supplied. Both arms now always write a measurement, so an
        // absent attribute means a pre-#49 grant and refusing it is correct.
        //
        // The ARM clause is what makes the band meaningful, and it is not the `kind` mistake in
        // new clothes. `kind` gave a grant different SEMANTICS depending on who issued it. `arm`
        // records which measuring stick was used: the legacy arm measures the SOURCE's own
        // length, the sealed arm the ciphertext, and those two numbers are not comparable in
        // either direction. Without it, a grant earned on one arm could be spent on the other
        // against a number that means something else — which leaks BOTH ways, not just one.
        ConditionExpression:
          'attribute_exists(pk) AND attribute_not_exists(#consumed) AND ' +
          '#src = :src AND expires_at > :now AND ' +
          '#arm = :arm AND #bytes BETWEEN :lo AND :hi',
        ExpressionAttributeNames: {
          '#consumed': 'consumed',
          '#src': 'src',
          '#bytes': 'bytes',
          '#arm': 'arm',
        },
        ExpressionAttributeValues: {
          ':now': { N: String(Math.floor(now / 1000)) },
          ':t': { N: String(Math.floor(now / 1000)) },
          ':src': { S: srcHash },
          ':arm': { S: arm },
          // `srcBytes` is guaranteed non-null by the fail-closed guard above, so there is no
          // sentinel branch left to get wrong. Zero is a real measurement and bands to [0, 0].
          ':lo': { N: String(Math.floor(srcBytes * (1 - GRANT_BYTES_TOLERANCE))) },
          ':hi': { N: String(Math.ceil(srcBytes * (1 + GRANT_BYTES_TOLERANCE))) },
        },
        // The old item on a conditional failure, so the six guards can be told apart without a
        // second round trip. Supported since SDK v3.400; an older runtime simply omits it and
        // `refusalReason` falls back to `unknown` rather than asserting a cause.
        ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
      })
    );
    return { free: true };
  } catch (err) {
    if (err?.name === 'ConditionalCheckFailedException') {
      // WHICH guard fired, when the SDK tells us.
      //
      // ⚠️ The mismatch line used to be logged for EVERY conditional failure. Missing, expired,
      // spent and same-kind are all normal operation — a user leaving a review modal open past
      // the grant's hour produces one — so the alarm built on that literal (main.tf, threshold
      // 5/hour, described as "families are being charged for corrections the UI promises are
      // free") paged on ordinary use, and a genuine fingerprint divergence was indistinguishable
      // from the noise. `ALL_OLD` on the failure is what lets the two be told apart; when the
      // runtime does not supply it we log the neutral line, because claiming a cause we cannot
      // establish is worse than logging none.
      const reason = refusalReason(err, srcHash, Math.floor(now / 1000), arm, srcBytes);
      const family = hash(familyId).slice(0, 12);
      if (reason === 'different_source') {
        console.warn(`${GRANT_MISMATCH_PREFIX} family_hash=${family}`);
      } else if (reason === 'different_size') {
        console.warn(`${GRANT_SIZE_MISMATCH_PREFIX} family_hash=${family}`);
      } else {
        console.warn(`${GRANT_REFUSED_PREFIX}${reason} family_hash=${family}`);
      }
      // The SPECIFIC reason, not a flattened 'refused'. The arms decide what to do with it
      // via HARD_REFUSAL_REASONS; collapsing them here is what hid the deploy window.
      return { free: false, reason };
    }
    console.error(
      '[ai-extract] correction grant store unavailable — charging the read.\n' +
        `Check the ${table} table and the Lambda dynamodb:UpdateItem permission.`,
      err
    );
    return { free: false, reason: 'store_unavailable' };
  }
}

/**
 * Issue a grant for a read that was just counted.
 *
 * ⚠️ TWO INVARIANTS, both load-bearing:
 *  1. Only for a request that arrived WITHOUT a correction. This is now carried ENTIRELY by
 *     `wasCorrection`. It used to share the load with the different-kind guard in `consumeGrant`,
 *     which #49 removed — so read this one as the whole fence, not half of it. Without it the
 *     chain is unbounded: every free correction would buy another free correction, forever.
 *  2. Only when the count actually succeeded. An uncounted read must not also buy a free one.
 *
 * Only for the `share` task.
 *
 * ⚠️ It used to ALSO be conditional on the result being a real kind, which incidentally skipped
 * `kind: 'none'`. #49 removed that, because the sealed arm never sees the result. The cost is one
 * `UpdateItem` per `none` share read for a grant nobody can spend: a `none` result opens no review
 * modal, so there is no surface for the correction banner to mount on. Accepted deliberately as
 * the price of not being able to read the answer, and it is a write we pay for, never the family.
 *
 * Never throws. A failure just means no free correction, which degrades safely.
 */
export async function issueGrant({
  familyId,
  task,
  srcHash,
  /**
   * Bytes THIS LAMBDA measured on the request that earned the grant. Required — see the ARM note
   * on `consumeGrant`'s condition for why a grant that cannot be size-bound must not exist.
   */
  srcBytes = null,
  /** `'legacy'` or `'sealed'` — which measuring stick `srcBytes` was taken with. Required. */
  arm = null,
  counted,
  wasCorrection,
  now = Date.now(),
  ddb,
} = {}) {
  if (!process.env.CORRECTION_GRANTS) return undefined;
  const table = process.env.RATE_TABLE;
  if (!table || !familyId || !srcHash) return undefined;
  if (wasCorrection || !counted) return undefined;
  if (task !== 'share') return undefined;
  // A grant we cannot bind to a size is a grant that cannot be safely spent, so we do not mint
  // one. Silent rather than alarming: the family simply pays for a correction, which is the same
  // outcome as the store being unavailable below, and the log line above it says why.
  if (srcBytes == null || !arm) {
    console.warn(
      '[ai-extract] not issuing a correction grant: no size measurement for this read ' +
        `(arm=${arm ?? 'none'}). A correction will cost a bean.`
    );
    return undefined;
  }

  const token = globalThis.crypto.randomUUID();
  try {
    const { send, commands } = await resolveClient(ddb);
    const { UpdateItemCommand } = commands;
    await send(
      new UpdateItemCommand({
        TableName: table,
        Key: Object.fromEntries(
          Object.entries(grantKey(familyId, token)).map(([k, v]) => [k, { S: v }])
        ),
        // No `kind` attribute (#49). `consumeGrant` must not condition on one, and writing it
        // would be worse than useless: a value only the legacy arm can supply would make grants
        // behave differently depending on which arm issued them.
        //
        // `bytes` and `arm` are BOTH unconditional, and that is the point. The previous version
        // wrote them only when `srcBytes` was truthy, which meant the legacy arm minted grants
        // with no size attribute — and `consumeGrant`'s `attribute_not_exists(#bytes)` disjunct
        // then let those grants past the band entirely. Writing the pair always is what makes
        // the absent case at spend time unambiguously "a pre-#49 grant", safe to refuse.
        UpdateExpression: 'SET #src = :src, #bytes = :bytes, #arm = :arm, expires_at = :ttl',
        ExpressionAttributeNames: { '#src': 'src', '#bytes': 'bytes', '#arm': 'arm' },
        ExpressionAttributeValues: {
          ':src': { S: srcHash },
          ':bytes': { N: String(srcBytes) },
          ':arm': { S: arm },
          ':ttl': { N: String(Math.floor(now / 1000) + GRANT_TTL_SECONDS) },
        },
      })
    );
    return { token };
  } catch (err) {
    // Deliberately quiet relative to a lost COUNT: a lost grant costs the family one bean on a
    // correction, where a lost count costs us a number we cannot reconstruct.
    console.warn(
      '[ai-extract] could not issue a correction grant — corrections will cost a bean.',
      err
    );
    return undefined;
  }
}
