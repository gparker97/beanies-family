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
 * THE THREE GUARDS, all in one ConditionExpression:
 *   exists          — a grant was actually issued for this family
 *   not consumed    — single use
 *   same source     — the free read is a RE-read of the thing you paid for, not a new one
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
 * Which of the three guards refused, from the item `ALL_OLD` returns on the thrown error.
 *
 * `unknown` is the honest answer when the runtime gave us nothing to read — it is NOT folded
 * into `different_source`, which is the one reason that means the feature is broken rather than
 * someone probing it, and the only one with an alarm.
 *
 * ⚠️ The final fallthrough used to be `same_kind`, because that guard existed and was the only
 * remaining explanation. #49 removed it, so every guard that CAN refuse now has its own branch
 * above. Reaching the end therefore means something genuinely unexplained, and saying `unknown`
 * is the honest answer rather than naming a guard that is no longer there.
 */
function refusalReason(err, srcHash, nowSeconds) {
  const item = err?.Item;
  if (!item || typeof item !== 'object') return 'unknown';
  if (item.consumed) return 'spent';
  if (Number(item.expires_at?.N) <= nowSeconds) return 'expired';
  if (item.src?.S && item.src.S !== srcHash) return 'different_source';
  return 'unknown';
}

/**
 * Spend a correction grant, if it is real.
 *
 * NEVER throws. Returns `{ free: boolean, reason?: string }` — `free: false` means charge
 * normally, which is the conservative outcome for every failure including an unavailable store.
 */
export async function consumeGrant({ familyId, correction, srcHash, now = Date.now(), ddb } = {}) {
  const table = process.env.RATE_TABLE;
  if (!table || !process.env.CORRECTION_GRANTS) return { free: false, reason: 'disabled' };
  if (!familyId || !correction || !srcHash) return { free: false, reason: 'missing' };

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
        // FOUR clauses. `expires_at > :now` is not redundant with the TTL attribute: DynamoDB's
        // TTL is a best-effort reaper that can lag by up to ~48h, so without this a grant the
        // header calls one-hour-lived stays spendable for two days — and the `expired` refusal
        // reason cannot be produced deterministically at all. The hour is a PRIVACY bound (the
        // stored source fingerprint), not just a convenience, so it has to be enforced on read.
        //
        // ⚠️ `#kind <> :to` was the fifth and is GONE (#49). It is not merely unnecessary now that
        // grants carry no kind — it would be actively fatal: DynamoDB evaluates a comparison
        // against a MISSING attribute as false, so leaving it in would refuse every correction,
        // silently, on a path whose whole promise is that correcting our mistake is free.
        ConditionExpression:
          'attribute_exists(pk) AND attribute_not_exists(#consumed) AND ' +
          '#src = :src AND expires_at > :now',
        ExpressionAttributeNames: { '#consumed': 'consumed', '#src': 'src' },
        ExpressionAttributeValues: {
          ':now': { N: String(Math.floor(now / 1000)) },
          ':t': { N: String(Math.floor(now / 1000)) },
          ':src': { S: srcHash },
        },
        // The old item on a conditional failure, so the three guards can be told apart without a
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
      const reason = refusalReason(err, srcHash, Math.floor(now / 1000));
      const family = hash(familyId).slice(0, 12);
      if (reason === 'different_source') {
        console.warn(`${GRANT_MISMATCH_PREFIX} family_hash=${family}`);
      } else {
        console.warn(`${GRANT_REFUSED_PREFIX}${reason} family_hash=${family}`);
      }
      return { free: false, reason: 'refused' };
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
        UpdateExpression: 'SET #src = :src, expires_at = :ttl',
        ExpressionAttributeNames: { '#src': 'src' },
        ExpressionAttributeValues: {
          ':src': { S: srcHash },
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
