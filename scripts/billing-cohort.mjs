#!/usr/bin/env node
/**
 * Admin writes to the billing table (#95): cohorts, trial overrides and plan-token reissue.
 *
 * The billing row has three writers with DISJOINT attributes: the billing Lambda's webhook
 * (subscription fields), its claim route (token hash, claim time, Stripe ids) and this script
 * (`cohort`, `trialEndsAt`, `planTokenHash` + `tokenClaimedAt` on reissue). Every write here is
 * an UpdateItem that SETs only this script's own attributes, never a PutItem: a PutItem would
 * erase the subscription the webhook wrote, and the next registry GET would compute a paying
 * family as trial or read-only. See docs/plans/2026-09-30-pricing-entitlement-read-only.md.
 *
 * Run modes (dry-run by default: prints every row it would touch and writes nothing):
 *   node scripts/billing-cohort.mjs --snapshot-pre-v1 [--apply]
 *       Scan the prod registry; for every live (non-tombstoned) family, set cohort = pre_v1 on
 *       its billing row WHERE NO COHORT IS SET YET. Idempotent, and never downgrades first_ten.
 *       Run once, at launch, per the pricing runbook.
 *   node scripts/billing-cohort.mjs --first-ten <familyId> [--apply]
 *       Set cohort = first_ten ($1/mo, $12/yr Prices). Overwrites pre_v1 on purpose.
 *   node scripts/billing-cohort.mjs --trial-ends-at <familyId> <iso> [--apply]
 *       Pin this family's trial end (the prod soak lever on greg's test family, and the only
 *       support lever for extending a trial). Counts before launch too: an override runs this
 *       family's trial clock even while V1_LAUNCH_AT is unset. The ISO instant must carry an
 *       explicit offset (`Z` or `+08:00`); a zone-less time would be read in the operator's
 *       local zone and write the wrong instant to prod.
 *   node scripts/billing-cohort.mjs --reissue-token <familyId> [--apply]
 *       Mint a fresh plan token (32 random bytes, base64url), print it ONCE, store only its
 *       sha256 hex as planTokenHash and stamp tokenClaimedAt. The manual recovery path when a
 *       family's settings.planToken was lost (the `plan_token_missing` warning). Printing the
 *       token is the only copy that ever exists; nothing can recover it later.
 *
 * Requires AWS creds in env (same profile as terraform apply: `source ~/.beanies-tf.env`).
 *
 * Tables (hardcoded, like scripts/migrate-registry-dev-rows.mjs; change if names differ):
 *   registry: beanies-family-registry-prod
 *   billing:  beanies-family-billing-prod   (must exist: apply modules/billing first)
 */

import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
// The one parse rule for billing-row dates: whatever the registry's `computeEntitlement` accepts
// as `trialEndsAt` is what this script may write. (The script runs from the repo checkout.)
import { isValidInstant } from '../infrastructure/lambda/registry/entitlement.mjs';

export const REGISTRY_TABLE = 'beanies-family-registry-prod';
export const BILLING_TABLE = 'beanies-family-billing-prod';
const REGION = 'ap-southeast-1';

export const COHORTS = Object.freeze({ preV1: 'pre_v1', firstTen: 'first_ten' });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An explicit zone at the end of a date-time: `Z` or `+HH:MM` / `-HH:MM`. Required because
 * `Date.parse('2027-01-15T09:00:00')` is LOCAL time, so the same command would write different
 * instants from Singapore and from London.
 */
const EXPLICIT_OFFSET_RE = /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/i;

/** True for an ISO instant the registry can parse AND that names its own offset. */
export function isExplicitInstant(value) {
  return typeof value === 'string' && EXPLICIT_OFFSET_RE.test(value) && isValidInstant(value);
}

// ── Update builders (pure; the write discipline lives here and is unit-tested) ──────────────
//
// Each returns the UpdateItem input minus the SDK marshalling, so the test can assert that the
// expression names this script's attributes and nothing else.

/** cohort = pre_v1, only where no cohort exists: the snapshot never downgrades first_ten. */
export function snapshotPreV1Update(familyId) {
  return {
    TableName: BILLING_TABLE,
    Key: { familyId },
    UpdateExpression: 'SET #cohort = :cohort',
    ConditionExpression: 'attribute_not_exists(#cohort)',
    ExpressionAttributeNames: { '#cohort': 'cohort' },
    ExpressionAttributeValues: { ':cohort': COHORTS.preV1 },
  };
}

/** cohort = first_ten, unconditionally (upgrading a pre_v1 family is the point). */
export function firstTenUpdate(familyId) {
  return {
    TableName: BILLING_TABLE,
    Key: { familyId },
    UpdateExpression: 'SET #cohort = :cohort',
    ExpressionAttributeNames: { '#cohort': 'cohort' },
    ExpressionAttributeValues: { ':cohort': COHORTS.firstTen },
  };
}

/** trialEndsAt = the override, normalised to a full ISO string (what entitlement.mjs parses). */
export function trialEndsAtUpdate(familyId, iso) {
  return {
    TableName: BILLING_TABLE,
    Key: { familyId },
    UpdateExpression: 'SET #trialEndsAt = :trialEndsAt',
    ExpressionAttributeNames: { '#trialEndsAt': 'trialEndsAt' },
    ExpressionAttributeValues: { ':trialEndsAt': new Date(iso).toISOString() },
  };
}

/**
 * sha256 hex of the token string. The Phase 5 claim and portal routes and the Phase 4 allowance
 * check must hash the same way, or a reissued token never matches.
 */
export function hashPlanToken(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** A fresh plan token: 32 random bytes, base64url. */
export function mintPlanToken() {
  return randomBytes(32).toString('base64url');
}

/** planTokenHash + tokenClaimedAt. Only the hash is stored; the token itself never is. */
export function reissueTokenUpdate(familyId, token, now = new Date()) {
  return {
    TableName: BILLING_TABLE,
    Key: { familyId },
    UpdateExpression: 'SET #planTokenHash = :hash, #tokenClaimedAt = :claimedAt',
    ExpressionAttributeNames: {
      '#planTokenHash': 'planTokenHash',
      '#tokenClaimedAt': 'tokenClaimedAt',
    },
    ExpressionAttributeValues: { ':hash': hashPlanToken(token), ':claimedAt': now.toISOString() },
  };
}

/**
 * Which live registry families the snapshot writes. Mirrors the write's
 * `attribute_not_exists(#cohort)` condition EXACTLY: a family qualifies only when its billing row
 * is missing or has no `cohort` attribute at all. A DynamoDB NULL attribute (`cohort: null` after
 * unmarshall) EXISTS, so the condition would refuse it; it is listed as untouched, not written.
 * Tombstoned registry rows (`deletedAt`) are skipped entirely.
 */
export function selectPreV1Targets(registry, billing) {
  const billingOf = new Map(billing.map((b) => [b.familyId, b]));
  const live = registry.filter((r) => !r.deletedAt);
  const toWrite = [];
  const already = [];
  for (const reg of live) {
    const row = billingOf.get(reg.familyId);
    if (row && Object.hasOwn(row, 'cohort')) already.push({ reg, cohort: row.cohort });
    else toWrite.push(reg);
  }
  return { live, toWrite, already };
}

// ── Argument parsing ──────────────────────────────────────────────────────────────────────

const USAGE = `Usage:
  node scripts/billing-cohort.mjs --snapshot-pre-v1 [--apply]
  node scripts/billing-cohort.mjs --first-ten <familyId> [--apply]
  node scripts/billing-cohort.mjs --trial-ends-at <familyId> <iso-with-offset> [--apply]
      e.g. 2027-01-15T00:00:00Z; counts before launch too (runs this family's trial clock)
  node scripts/billing-cohort.mjs --reissue-token <familyId> [--apply]`;

/** Parse argv into one command, or throw with the reason and the usage text. */
export function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const rest = argv.filter((a) => a !== '--apply');
  const [flag, ...params] = rest;
  const fail = (why) => {
    throw new Error(`${why}\n\n${USAGE}`);
  };
  const requireFamilyId = (id) => {
    if (!id || !UUID_RE.test(id)) fail(`Expected a familyId (UUID), got "${id ?? ''}".`);
    return id;
  };

  switch (flag) {
    case '--snapshot-pre-v1':
      if (params.length) fail(`--snapshot-pre-v1 takes no arguments.`);
      return { mode: 'snapshot', apply };
    case '--first-ten':
      if (params.length !== 1) fail('--first-ten takes exactly one familyId.');
      return { mode: 'first-ten', familyId: requireFamilyId(params[0]), apply };
    case '--trial-ends-at': {
      if (params.length !== 2) fail('--trial-ends-at takes a familyId and an ISO date.');
      const iso = params[1];
      if (!isExplicitInstant(iso)) {
        fail(
          `"${iso}" is not an ISO-8601 date-time with an explicit offset. An offset is required ` +
            '(e.g. 2027-01-15T00:00:00Z or 2027-01-15T09:00:00+08:00); a zone-less time is read ' +
            'in your local zone and would write the wrong instant.'
        );
      }
      return { mode: 'trial-ends-at', familyId: requireFamilyId(params[0]), iso, apply };
    }
    case '--reissue-token':
      if (params.length !== 1) fail('--reissue-token takes exactly one familyId.');
      return { mode: 'reissue-token', familyId: requireFamilyId(params[0]), apply };
    default:
      return fail(flag ? `Unknown flag "${flag}".` : 'No command given.');
  }
}

// ── AWS ───────────────────────────────────────────────────────────────────────────────────

async function aws() {
  const ddb = await import('@aws-sdk/client-dynamodb');
  const util = await import('@aws-sdk/util-dynamodb');
  return { ...ddb, ...util, client: new ddb.DynamoDBClient({ region: REGION }) };
}

async function scanAll(sdk, tableName) {
  const items = [];
  let key;
  do {
    const out = await sdk.client.send(
      new sdk.ScanCommand({ TableName: tableName, ExclusiveStartKey: key })
    );
    for (const it of out.Items ?? []) items.push(sdk.unmarshall(it));
    key = out.LastEvaluatedKey;
  } while (key);
  return items;
}

async function getRow(sdk, tableName, familyId) {
  const { Item } = await sdk.client.send(
    new sdk.GetItemCommand({
      TableName: tableName,
      Key: sdk.marshall({ familyId }),
      ConsistentRead: true,
    })
  );
  return Item ? sdk.unmarshall(Item) : null;
}

/** Marshal a builder's plain input for the SDK and send it. */
function sendUpdate(sdk, input) {
  return sdk.client.send(
    new sdk.UpdateItemCommand({
      ...input,
      Key: sdk.marshall(input.Key),
      ExpressionAttributeValues: sdk.marshall(input.ExpressionAttributeValues),
    })
  );
}

const fmtFamily = (reg) =>
  `${reg.familyId}  ${(reg.familyName || '(no name)').padEnd(28)} ${(reg.ownerEmail || '(no email)').padEnd(36)} created=${(reg.createdAt || '?').slice(0, 10)}`;

/**
 * Single-family modes act only on a LIVE registry family: a typo'd id would otherwise create a
 * billing row for a family that does not exist, and a tombstoned family has asked to be gone.
 */
async function requireLiveFamily(sdk, familyId) {
  const reg = await getRow(sdk, REGISTRY_TABLE, familyId);
  if (!reg) throw new Error(`No registry row for ${familyId} in ${REGISTRY_TABLE}. Check the id.`);
  if (reg.deletedAt) {
    throw new Error(`${familyId} is tombstoned (deletedAt=${reg.deletedAt}). Refusing to write.`);
  }
  return reg;
}

// ── Modes ─────────────────────────────────────────────────────────────────────────────────

async function snapshotPreV1(sdk, apply) {
  console.log(`Mode: SNAPSHOT-PRE-V1 ${apply ? '(APPLY)' : '(dry-run)'}`);
  console.log(`Scanning ${REGISTRY_TABLE} and ${BILLING_TABLE}…`);
  const [registry, billing] = await Promise.all([
    scanAll(sdk, REGISTRY_TABLE),
    scanAll(sdk, BILLING_TABLE),
  ]);
  const { live, toWrite, already } = selectPreV1Targets(registry, billing);

  console.log(
    `Registry rows: ${registry.length} (${registry.length - live.length} tombstoned, skipped)\n`
  );
  console.log(`=== WILL SET cohort=pre_v1: no cohort attribute at all (${toWrite.length}) ===`);
  for (const r of toWrite) console.log(`  ${fmtFamily(r)}`);
  console.log(
    `\n=== HAVE A cohort ATTRIBUTE (any value, NULL included), untouched (${already.length}) ===`
  );
  for (const { reg, cohort } of already) {
    console.log(`  ${fmtFamily(reg)}  cohort=${cohort === null ? 'NULL' : cohort}`);
  }

  if (!apply) {
    console.log('\nDry-run complete. Re-run with --snapshot-pre-v1 --apply to write.');
    return;
  }

  let written = 0;
  const raced = [];
  for (const r of toWrite) {
    try {
      await sendUpdate(sdk, snapshotPreV1Update(r.familyId));
      written++;
      process.stdout.write('.');
    } catch (err) {
      // The condition refused: a cohort landed between the scan and this write (for example
      // --first-ten ran meanwhile). That is the guard doing its job, not a failure, but name the
      // family so the operator can check which cohort it ended up with.
      if (err?.name === 'ConditionalCheckFailedException') {
        raced.push(r.familyId);
        console.log(
          `\n  skipped ${r.familyId}: a cohort attribute was written after the scan (condition refused; left as is)`
        );
        continue;
      }
      throw err;
    }
  }
  console.log(`\nDone. ${written} set to pre_v1; ${raced.length} skipped (listed above).`);
}

async function singleFamily(sdk, cmd) {
  const reg = await requireLiveFamily(sdk, cmd.familyId);
  const before = await getRow(sdk, BILLING_TABLE, cmd.familyId);
  console.log(`Mode: ${cmd.mode.toUpperCase()} ${cmd.apply ? '(APPLY)' : '(dry-run)'}`);
  console.log(`Family:  ${fmtFamily(reg)}`);
  console.log(
    `Billing: ${before ? `cohort=${before.cohort ?? '(none)'} trialEndsAt=${before.trialEndsAt ?? '(none)'} status=${before.status ?? '(none)'} tokenClaimedAt=${before.tokenClaimedAt ?? '(none)'}` : '(no billing row yet; the write creates it)'}`
  );

  let input;
  if (cmd.mode === 'first-ten') {
    input = firstTenUpdate(cmd.familyId);
    console.log(`Change:  cohort ${before?.cohort ?? '(none)'} -> first_ten`);
  } else if (cmd.mode === 'trial-ends-at') {
    input = trialEndsAtUpdate(cmd.familyId, cmd.iso);
    console.log(
      `Change:  trialEndsAt ${before?.trialEndsAt ?? '(computed)'} -> ${input.ExpressionAttributeValues[':trialEndsAt']}`
    );
  } else {
    console.log(
      `Change:  planTokenHash + tokenClaimedAt replaced; the family's current token (if any) stops working`
    );
  }

  if (!cmd.apply) {
    console.log(`\nDry-run complete. Re-run with --apply to write.`);
    return;
  }

  if (cmd.mode === 'reissue-token') {
    // Minted only on --apply, so a dry-run never prints a token that was never stored.
    const token = mintPlanToken();
    await sendUpdate(sdk, reissueTokenUpdate(cmd.familyId, token));
    console.log(`\nPlan token (shown ONCE, only its hash is stored):\n\n  ${token}\n`);
    console.log(
      "Deliver it into the family's settings.planToken per docs/runbooks/pricing-launch.md."
    );
    return;
  }

  await sendUpdate(sdk, input);
  console.log('\nDone.');
}

async function main(argv) {
  let cmd;
  try {
    cmd = parseArgs(argv);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  const sdk = await aws();
  if (cmd.mode === 'snapshot') await snapshotPreV1(sdk, cmd.apply);
  else await singleFamily(sdk, cmd);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    const remediation =
      err?.name === 'ResourceNotFoundException'
        ? `\nA table is missing: apply modules/billing (terraform) so ${BILLING_TABLE} exists.`
        : err?.name === 'CredentialsProviderError' || err?.name === 'UnrecognizedClientException'
          ? '\nNo usable AWS credentials: `source ~/.beanies-tf.env` and retry.'
          : '';
    console.error('FATAL:', err, remediation);
    process.exit(1);
  });
}
