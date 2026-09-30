/* global process, Buffer */
/**
 * The magic-beans allowance (#95 Phase 4): how many CHARGED reads a family may make per period.
 *
 * ── What it decides ────────────────────────────────────────────────────────────────────
 *
 * One tier per request, from ONE billing-table read, then the family's usage for that tier's
 * period, then allowed or not:
 *
 *   full   subscribed (active | trialing | past_due), on the `full` plan, AND the request carries
 *          the family's plan token (sha256 matches `planTokenHash`). 10 a UTC day.
 *   basic  subscribed without that: the basic plan, or a full plan whose token is missing or
 *          wrong. 1 a UTC month.
 *   trial  everything else, INCLUDING a family whose trial has ended. 1 a UTC day.
 *
 * ⚠️ THE TOKEN ALONE NEVER MAKES A READ `full`. Every paying family is issued a token at claim,
 * basic ones included, so "subscribed + matching token" without the plan check would hand a basic
 * subscriber ten beans a day. The token proves the caller is the family; the row's `plan` says
 * what the family bought. Both are required.
 *
 * ⚠️ NO TRIAL CLOCK HERE, and no registry read. This Lambda has no Origin-keyed dev/prod table
 * split (RATE_TABLE / USAGE_TABLE are single names) while the registry picks its table by Origin,
 * so a registry read would need a second copy of `tableForOrigin`. The consequence is deliberate
 * and documented in the plan: a family whose trial has ended keeps the 1-a-day floor server-side,
 * and the client's write gate (plus the magic-beans door refusing to send while read-only) is what
 * stops them. The exposure is one hand-made read a day.
 *
 * ⚠️ THE DAY AND MONTH ARE UTC, because the usage table's sort key is the UTC day
 * (`countUsage.mjs` `dayIso`). `resetsAt` is therefore the next UTC midnight or UTC month start,
 * and the client renders it in LOCAL time (decided 2026-09-30: "keep UTC, show local reset time").
 *
 * ⚠️ THE PRE-CHECK RACES THE COUNT. This reads before the model; `closeRead` counts after it. Two
 * simultaneous reads at `limit - 1` can both pass and overrun by one. Accepted: the hourly rate
 * limiter bounds it, and closing it needs a reservation write per read.
 *
 * Only `n` (USAGE_ATTRS.charged) is summed. `c` (a correction we gave away) and `f` (a free task)
 * are our cost, never the family's; summing the row would bill families for our mistakes.
 *
 * ── Contract (the same as `rateLimit.mjs` `checkLimits`) ───────────────────────────────
 *
 * NEVER THROWS. Unset table ⇒ `{ allowed: true }`, silently (a valid configuration: it keeps the
 * handler suite off a real DynamoDB call and a self-host off billing). A store failure FAILS OPEN
 * with one `console.error` carrying `ALLOWANCE_STORE_ERROR_PREFIX` (a CloudWatch metric filter in
 * `modules/ai-extract/main.tf` alarms on it) and a remediation sentence. Failing closed would take
 * every managed read down with a DynamoDB blip; the route throttle and rate limiter stay in front.
 *
 * DRY-RUN BY DEFAULT. `AI_ALLOWANCE_ENFORCE` must be exactly `'true'` to refuse. Otherwise a read
 * over the limit logs `allowance_would_deny` and goes through: that line is the soak signal.
 */

import { timingSafeEqual } from 'node:crypto';

import { dayIso } from './countUsage.mjs';
import { USAGE_ATTRS, hash, marshalKey, resolveClient, usageKey } from './ddb.mjs';

/**
 * The allowance per tier. ⚠️ Must equal `MAGIC_BEANS` in `packages/brand/pricing.ts` (the numbers
 * the pricing page sells); `lambdaContractParity.test.ts` asserts it. It lives HERE rather than in
 * the registry's entitlement module because this Lambda is its only consumer and every Lambda is
 * its own zip.
 */
export const PLAN_ALLOWANCE = Object.freeze({
  trial: Object.freeze({ perDay: 1 }),
  basic: Object.freeze({ perMonth: 1 }),
  full: Object.freeze({ perDay: 10 }),
});

/** Billing statuses that count as paying. `past_due` is still paying (Smart Retries running). */
export const SUBSCRIBED_STATUSES = Object.freeze(new Set(['active', 'trialing', 'past_due']));

/** The body discriminator for the usage read on the shared POST route (no new API path). */
export const ALLOWANCE_PROTOCOL = 'allowance';

/**
 * ⚠️ The exact prefix the CloudWatch metric filter matches (`allowance_store_unavailable` in
 * `modules/ai-extract/main.tf`). It is in `meter.mjs` `ALARMING_PREFIXES`, so `meter.test.mjs`
 * fails if the two drift.
 */
export const ALLOWANCE_STORE_ERROR_PREFIX = '[ai-extract] allowance_store_error';

const ALLOWANCE_STORE_REMEDIATION =
  'Check the BILLING_TABLE_NAME and USAGE_TABLE env vars in modules/ai-extract/main.tf, that both tables ' +
  'exist, and the Lambda role: dynamodb:GetItem on the billing table, dynamodb:GetItem and ' +
  'dynamodb:Query on the usage table.';

/**
 * Longest id we will put in a DynamoDB key. Real family ids are UUIDs (36 chars). The bound keeps
 * a hostile 5 KB `familyId` from turning into a ValidationException, which would read as a store
 * failure and fire the alarm on demand.
 */
const MAX_ID_CHARS = 128;
/** A plan token is 43 chars of base64url. Anything much longer is not one. */
const MAX_TOKEN_CHARS = 256;

/**
 * Constant-time string comparison. `timingSafeEqual` throws on unequal lengths, so the length is
 * checked first (a length leak is fine: every sha256 hex digest is 64 chars).
 */
export function safeEqual(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Which allowance a billing row + request token earns. Pure, so the tier table is testable
 * without a client.
 *
 * @param {{ status?: string, plan?: string, planTokenHash?: string } | null} billing
 * @param {string | undefined} planToken
 * @returns {'trial' | 'basic' | 'full'}
 */
export function tierFor(billing, planToken) {
  if (!billing || !SUBSCRIBED_STATUSES.has(billing.status)) return 'trial';
  const tokenMatches =
    typeof planToken === 'string' &&
    planToken.length > 0 &&
    typeof billing.planTokenHash === 'string' &&
    safeEqual(hash(planToken), billing.planTokenHash);
  return billing.plan === 'full' && tokenMatches ? 'full' : 'basic';
}

/** `{ period, limit }` for a tier, straight from PLAN_ALLOWANCE. */
function periodFor(tier) {
  const rule = PLAN_ALLOWANCE[tier];
  return rule.perMonth !== undefined
    ? { period: 'month', limit: rule.perMonth }
    : { period: 'day', limit: rule.perDay };
}

/** The next UTC midnight, or the first instant of the next UTC month. ISO. */
export function resetsAtFor(period, now) {
  const d = new Date(now);
  const at =
    period === 'month'
      ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
      : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  return new Date(at).toISOString();
}

/** The allowance tables, read at CALL time (the `countUsage.mjs` convention). */
function tables() {
  return { billing: process.env.BILLING_TABLE_NAME, usage: process.env.USAGE_TABLE };
}

const asString = (attr) => (typeof attr?.S === 'string' ? attr.S : undefined);
const asCount = (attr) => {
  const n = Number(attr?.N ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * The raw numbers: tier, period, limit, used, resetsAt. THROWS on a store failure; the two public
 * verbs below own the catch, so each keeps its own failure posture.
 */
async function computeUsage({ familyId, planToken, now, ddb, table }) {
  const { send, commands } = await resolveClient(ddb);
  const { GetItemCommand, QueryCommand } = commands;
  const today = dayIso(now);
  const key = usageKey(familyId, today);

  // Billing rows are keyed on the raw family id (the registry's key). An over-long id cannot be a
  // real family, so it skips the lookup and gets the trial floor rather than a ValidationException.
  const readBilling = async () => {
    if (familyId.length > MAX_ID_CHARS) return null;
    const { Item } = await send(
      new GetItemCommand({
        TableName: table.billing,
        Key: { familyId: { S: familyId } },
        // Strongly consistent: a family that has just paid must not read as trial.
        ConsistentRead: true,
        // `status` is a DynamoDB reserved word; alias all three rather than remember which.
        ProjectionExpression: '#status, #plan, #hash',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#plan': 'plan',
          '#hash': 'planTokenHash',
        },
      })
    );
    return Item
      ? {
          status: asString(Item.status),
          plan: asString(Item.plan),
          planTokenHash: asString(Item.planTokenHash),
        }
      : null;
  };

  // Today's `n`, read BESIDE the billing row rather than after it: two of the three tiers are
  // per-day, so this is the answer most of the time and the pre-check costs one round trip, not
  // two. `n` ONLY (see the header); `#n` because a bare short name is a reserved-word gamble.
  const readToday = async () => {
    const { Item } = await send(
      new GetItemCommand({
        TableName: table.usage,
        Key: marshalKey(key),
        ConsistentRead: true,
        ProjectionExpression: '#n',
        ExpressionAttributeNames: { '#n': USAGE_ATTRS.charged },
      })
    );
    return asCount(Item?.[USAGE_ATTRS.charged]);
  };

  // Either rejecting rejects the whole computation, which the caller's catch turns into its own
  // failure posture (fail open for a check, "unavailable" for a read).
  const [billing, todayUsed] = await Promise.all([readBilling(), readToday()]);

  const token =
    typeof planToken === 'string' && planToken.length <= MAX_TOKEN_CHARS ? planToken : undefined;
  const tier = tierFor(billing, token);
  const { period, limit } = periodFor(tier);

  let used = todayUsed;
  if (period === 'month') {
    // Only the basic tier pays for this Query. A month is at most 31 day items of one counter
    // each, far below a 1 MB page, but the loop costs nothing and means a page boundary can never
    // silently undercount.
    used = 0;
    let startKey;
    let pages = 0;
    do {
      const page = await send(
        new QueryCommand({
          TableName: table.usage,
          KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :month)',
          ExpressionAttributeNames: { '#pk': 'pk', '#sk': 'sk', '#n': USAGE_ATTRS.charged },
          ExpressionAttributeValues: {
            ':pk': { S: key.pk },
            // `d#YYYY-MM`: the UTC calendar month of today's UTC day.
            ':month': { S: `d#${today.slice(0, 7)}` },
          },
          ProjectionExpression: '#n',
          ConsistentRead: true,
          ...(startKey ? { ExclusiveStartKey: startKey } : {}),
        })
      );
      for (const item of page?.Items ?? []) used += asCount(item?.[USAGE_ATTRS.charged]);
      startKey = page?.LastEvaluatedKey;
      pages += 1;
    } while (startKey && pages < 10);
  }

  return { tier, period, limit, used, resetsAt: resetsAtFor(period, now) };
}

/** One structured JSON line, the registry's `entitlement_computed` shape. Hash only, never the id. */
function logLine(msg, familyId, fields) {
  // eslint-disable-next-line no-console -- structured success-path decision line, read by CloudWatch
  console.log(JSON.stringify({ msg, family_id_hash: hash(familyId), ...fields }));
}

/** Only a string id within bounds can key a usage row. Absent ⇒ nothing to count against. */
function usableFamilyId(familyId) {
  return typeof familyId === 'string' && familyId.length > 0 ? familyId : undefined;
}

/**
 * Decide one CHARGED read. Called by both arms after `openRead`, and only when the read will be
 * counted on `n` (a free correction or a free task is never refused for being over the allowance:
 * it does not spend one).
 *
 * NEVER THROWS. Returns:
 *   `{ allowed: true }`                                        unset table, or no family id
 *   `{ allowed: true, degraded: true }`                        the store failed; allowed, alarmed
 *   `{ allowed, used, limit, period, resetsAt, tier, enforced }` a real decision
 *
 * @param {object}   args
 * @param {string=}  args.familyId  Raw id from the request. Hashed before it touches a usage key or
 *                                  a log line; used raw only as the billing table's key.
 * @param {string=}  args.planToken The family's plan token, when the client holds one.
 * @param {boolean=} args.enforce   Refuse over the limit. Defaults to `AI_ALLOWANCE_ENFORCE ===
 *                                  'true'`, read at call time.
 * @param {number=}  args.now       Epoch ms, injectable.
 * @param {object=}  args.ddb       `{ send, commands }` stub, the `checkLimits` seam.
 */
export async function checkAllowance({
  familyId,
  planToken,
  enforce = process.env.AI_ALLOWANCE_ENFORCE === 'true',
  now = Date.now(),
  ddb,
} = {}) {
  const table = tables();
  if (!table.billing || !table.usage) return { allowed: true };

  // No family id: an old cached bundle. There is no usage row to count against (countUsage skips
  // it too, and says so loudly under COUNT_SKIPPED_PREFIX, which is the alarm for this case).
  const family = usableFamilyId(familyId);
  if (!family) return { allowed: true };

  let usage;
  try {
    usage = await computeUsage({ familyId: family, planToken, now, ddb, table });
  } catch (err) {
    console.error(
      `${ALLOWANCE_STORE_ERROR_PREFIX}: the allowance could not be read, so this read was ` +
        `ALLOWED unchecked.\n${ALLOWANCE_STORE_REMEDIATION}`,
      err
    );
    return { allowed: true, degraded: true };
  }

  const over = usage.used >= usage.limit;
  const allowed = !over || !enforce;
  const numbers = {
    tier: usage.tier,
    period: usage.period,
    used: usage.used,
    limit: usage.limit,
  };

  if (over) logLine(enforce ? 'allowance_denied' : 'allowance_would_deny', family, numbers);
  // The success-path line, on EVERY decision, so the deny and would-deny RATES are measurable.
  logLine('allowance_checked', family, { ...numbers, allowed, enforced: enforce });

  return { allowed, ...usage, enforced: enforce };
}

/**
 * The usage read behind `protocol: 'allowance'`. Never refuses anything: it is a read, so the
 * client can show "N of M left". NEVER THROWS; returns a discriminated result.
 *
 * @returns {Promise<{ ok: true, usage: { used, limit, period, resetsAt, tier } }
 *   | { ok: false, reason: 'no_family' | 'unconfigured' | 'store_error' }>}
 */
export async function readAllowance({ familyId, planToken, now = Date.now(), ddb } = {}) {
  const family = usableFamilyId(familyId);
  if (!family) return { ok: false, reason: 'no_family' };
  const table = tables();
  if (!table.billing || !table.usage) return { ok: false, reason: 'unconfigured' };
  try {
    const usage = await computeUsage({ familyId: family, planToken, now, ddb, table });
    logLine('allowance_read', family, {
      tier: usage.tier,
      period: usage.period,
      used: usage.used,
      limit: usage.limit,
    });
    return { ok: true, usage };
  } catch (err) {
    console.error(
      `${ALLOWANCE_STORE_ERROR_PREFIX}: the usage read failed, so the client was told usage is ` +
        `unavailable.\n${ALLOWANCE_STORE_REMEDIATION}`,
      err
    );
    return { ok: false, reason: 'store_error' };
  }
}

/**
 * The 402 body, shared by both arms so the client parses one shape. `tier` rides along so the
 * client's `quota_prompt_shown` event can name the plan without a second request.
 */
export function allowanceRefusalBody(verdict) {
  return {
    error: 'Magic beans allowance reached',
    code: 'allowance_exceeded',
    used: verdict.used,
    limit: verdict.limit,
    period: verdict.period,
    resetsAt: verdict.resetsAt,
    tier: verdict.tier,
  };
}
