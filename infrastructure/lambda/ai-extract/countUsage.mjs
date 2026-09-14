/* global process */
/**
 * The magic-bean meter: one atomic increment per read the family actually got an answer to.
 *
 * WHAT A BEAN IS
 * A bean is spent exactly when beanies answered you — the 200 path and nothing else. Every
 * refusal before the model (401/413/400/429) returns earlier and costs nothing; every upstream
 * or model failure (504/502/503) returns before the success point, so a family is never billed
 * for a read that produced nothing usable. We pay for some of those; that is our cost, not
 * theirs. An unrecognised `kind: 'none'` IS a 200 and DOES count: we paid for the read, and
 * counting it stops "keep pasting until something sticks" being free.
 *
 * WHY THIS IS NOT PART OF rateLimit.mjs
 * `checkLimits` is gated on `hasText` — the image path never touches the rate table, by explicit
 * decision. The meter has to count every path, so it is its own write. That separation is also
 * what lets the limiter stay fail-OPEN (a DynamoDB blip must not lock a family out) while the
 * meter is fail-LOUD (a lost count cannot be defended to a customer later).
 *
 * NEVER THROWS. Same contract as `checkLimits`. A count that cannot be written is a logged,
 * alertable gap — never a silent zero, and never a reason the user loses their extraction.
 */

import { USAGE_ATTRS, countOne, resolveClient, usageKey } from './ddb.mjs';

/** ~400 days. Billing evidence has to outlive an hourly window: a monthly plan is billed on it. */
const USAGE_TTL_SECONDS = 400 * 24 * 3600;

/**
 * ⚠️ These exact prefixes are what the CloudWatch metric filters match. Changing either string
 * means changing `modules/ai-extract/main.tf` in the SAME commit — `meter.test.mjs` asserts that
 * for you, so a drifted prefix is a test failure rather than an alarm that quietly stopped
 * firing. (An alarm that stopped firing is indistinguishable from one with nothing to report.)
 */
export const COUNT_FAILED_PREFIX = '[ai-extract] usage-count write failed';
export const COUNT_SKIPPED_PREFIX = '[ai-extract] usage-count skipped';

const COUNT_FAILED_REMEDIATION =
  'The read succeeded and was NOT counted. Check the USAGE_TABLE table, the Lambda ' +
  'dynamodb:UpdateItem permission, and the USAGE_TABLE env var in modules/ai-extract/main.tf.';

/** UTC day. The finest grain the pricing page sells; week and month are range queries. */
export function dayIso(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Count one read against a family's day.
 *
 * MUST be awaited before the handler returns. Lambda freezes the execution environment the
 * moment the handler returns, so a fire-and-forget write frequently never reaches DynamoDB AND
 * never logs its own failure — a silent, unalertable undercount, which is the one outcome the
 * whole meter exists to prevent. The cost is one DynamoDB write on a path that has just spent
 * several seconds inside a model.
 *
 * @param {object}   args
 * @param {string=}  args.familyId  Raw id. Hashed before it touches a key; never logged.
 * @param {string=}  args.attr      `USAGE_ATTRS.charged` (default) or `.corrected`.
 * @param {number=}  args.now       Epoch ms. Injectable so tests need no clock control.
 * @param {object=}  args.ddb       `{ send, commands }` stub — same seam as `checkLimits`.
 * @returns {Promise<boolean>} true iff a row was written. The grant writer keys off this: an
 *                             uncounted read must not also buy a free correction.
 */
export async function countUsage({
  familyId,
  attr = USAGE_ATTRS.charged,
  now = Date.now(),
  ddb,
} = {}) {
  // Read at CALL time, not module load — that is what lets `node --test` exercise both the
  // configured and the unset paths in one process without module-cache games. Unset is a VALID
  // configuration (it keeps the handler suite off a real DynamoDB call), so it logs nothing.
  const table = process.env.USAGE_TABLE;
  if (!table) return false;

  // The Lambda must keep accepting a request with no family id: every cached old bundle sends
  // none, and 400ing it would break working installs. But it cannot be counted — there is no
  // partition key to write under. Say so loudly and countably: a skipped count writes NO ROW, so
  // it is invisible to the metrics unattributed bucket, which can only see hashes that fail to
  // join. This line is the ONLY signal that the client-side no-family fence has been breached.
  if (!familyId) {
    console.warn(
      `${COUNT_SKIPPED_PREFIX} — no family id on the request. The read succeeded and was NOT ` +
        'counted. Expected only from an old cached bundle; a rising rate means the client-side ' +
        'no_family fence has been breached.'
    );
    return false;
  }

  try {
    const { send, commands } = await resolveClient(ddb);
    await countOne(send, commands, table, usageKey(familyId, dayIso(now)), {
      ttl: Math.floor(now / 1000) + USAGE_TTL_SECONDS,
      attr,
    });
    return true;
  } catch (err) {
    console.error(`${COUNT_FAILED_PREFIX}\n${COUNT_FAILED_REMEDIATION}`, err);
    return false;
  }
}
