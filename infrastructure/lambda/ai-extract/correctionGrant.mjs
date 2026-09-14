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
 * THE FOUR GUARDS, all in one ConditionExpression:
 *   exists          — a grant was actually issued for this family
 *   not consumed    — single use
 *   different kind  — you cannot "correct" event → event and get a free re-read
 *   same source     — the free read is a RE-read of the thing you paid for, not a new one
 *
 * The source binding is the one doing the heaviest lifting. Without it: pay for a 40-character
 * text read, then "correct" it with an 8-page PDF for free. The expensive half of every pair
 * would be free, forever. It is also the fence that matters most because `FAMILY_LIMIT` is
 * gated on `hasText` and does not cover the image path at all.
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
 * someone probing it: missing / spent / same_kind are all expected in normal operation.
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
export function validateCorrection(correction) {
  if (correction === undefined || correction === null) return null;
  if (typeof correction !== 'object' || Array.isArray(correction)) return 'bad_shape';
  const { token, to } = correction;
  // `to` reaches the model's INSTRUCTION, outside the untrusted-source fence that bounds the
  // document. An unvalidated value here is a prompt-injection channel on a call the family is
  // not even paying for — so it is a closed set, checked server-side, not a formality.
  if (!SHARE_KINDS.includes(to)) return 'bad_kind';
  // Bounds the grant key below DynamoDB's 2048-byte limit. Without it an oversized token throws
  // ValidationException, is caught by the refusal arm, and the family is CHARGED.
  if (typeof token !== 'string' || !UUID_RE.test(token)) return 'bad_token';
  return null;
}

/**
 * Which of the four guards refused, from the item `ALL_OLD` returns on the thrown error.
 *
 * `unknown` is the honest answer when the runtime gave us nothing to read — it is NOT folded
 * into `different_source`, which is the one reason that means the feature is broken rather than
 * someone probing it, and the only one with an alarm.
 */
function refusalReason(err, srcHash, nowSeconds) {
  const item = err?.Item;
  if (!item || typeof item !== 'object') return 'unknown';
  if (item.consumed) return 'spent';
  if (Number(item.expires_at?.N) <= nowSeconds) return 'expired';
  if (item.src?.S && item.src.S !== srcHash) return 'different_source';
  return 'same_kind';
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
        // FIVE guards. `expires_at > :now` is not redundant with the TTL attribute: DynamoDB's
        // TTL is a best-effort reaper that can lag by up to ~48h, so without this a grant the
        // header calls one-hour-lived stays spendable for two days — and the `expired` refusal
        // reason cannot be produced deterministically at all. The hour is a PRIVACY bound (the
        // stored source fingerprint), not just a convenience, so it has to be enforced on read.
        ConditionExpression:
          'attribute_exists(pk) AND attribute_not_exists(#consumed) AND #kind <> :to AND ' +
          '#src = :src AND expires_at > :now',
        ExpressionAttributeNames: { '#consumed': 'consumed', '#kind': 'kind', '#src': 'src' },
        ExpressionAttributeValues: {
          ':now': { N: String(Math.floor(now / 1000)) },
          ':t': { N: String(Math.floor(now / 1000)) },
          ':to': { S: correction.to },
          ':src': { S: srcHash },
        },
        // The old item on a conditional failure, so the four guards can be told apart without a
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
 *  1. Only for a request that arrived WITHOUT a correction. Otherwise the kind rotates
 *     (event → travel → recipe → event), the different-kind guard never fires, and one paid
 *     read buys an unlimited chain of free ones.
 *  2. Only when the count actually succeeded. An uncounted read must not also buy a free one.
 *
 * Only for the `share` task, and never for `kind: 'none'`: a `none` result opens no review
 * modal, so there is no surface a correction banner could mount on and the grant would be a row
 * nobody can spend. Without that condition this doubles the function's DynamoDB traffic for
 * grants most reads can never use.
 *
 * Never throws. A failure just means no free correction, which degrades safely.
 */
export async function issueGrant({
  familyId,
  task,
  resultKind,
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
  if (task !== 'share' || !SHARE_KINDS.includes(resultKind)) return undefined;

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
        UpdateExpression: 'SET #kind = :kind, #src = :src, expires_at = :ttl',
        ExpressionAttributeNames: { '#kind': 'kind', '#src': 'src' },
        ExpressionAttributeValues: {
          ':kind': { S: resultKind },
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
