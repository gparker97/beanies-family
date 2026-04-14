#!/usr/bin/env node
/**
 * One-off migration: scan the prod registry table and split rows into
 * dev pollution vs real users.
 *
 * Auto-classifies rows whose ownerEmail matches a known dev pattern:
 *   - gpsp2001@gmail.com (incl. dot/+ aliases — Gmail normalizes both)
 *   - anything @test.com
 * Anything else is "uncertain" and listed for manual review.
 *
 * Run modes:
 *   node scripts/migrate-registry-dev-rows.mjs              # dry-run (default), email-pattern auto-classification
 *   node scripts/migrate-registry-dev-rows.mjs --copy       # copy classified-dev rows to dev table (no deletes)
 *   node scripts/migrate-registry-dev-rows.mjs --copy-and-purge   # copy + delete from prod
 *
 * After human review of the auto-classification, switch to:
 *   node scripts/migrate-registry-dev-rows.mjs --keep-prod-only   # treat ANY row not in KEEP_PROD_IDS as dev (dry-run)
 *   node scripts/migrate-registry-dev-rows.mjs --keep-prod-only --copy-and-purge   # final migration
 *
 * Clean the dev table itself (delete "Test Family" / "E2E Test Family" rows
 * that may have leaked from earlier migration passes or pre-cleanup E2E):
 *   node scripts/migrate-registry-dev-rows.mjs --scrub-dev          # dry-run
 *   node scripts/migrate-registry-dev-rows.mjs --scrub-dev --apply  # actually delete
 *
 * Requires AWS creds in env (same role used for terraform apply).
 *
 * Tables (hardcoded — change if names differ):
 *   prod: beanies-family-registry-prod
 *   dev:  beanies-family-registry-dev   (must exist — apply Terraform first)
 */

import {
  DynamoDBClient,
  ScanCommand,
  PutItemCommand,
  DeleteItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

const PROD_TABLE = 'beanies-family-registry-prod';
const DEV_TABLE = 'beanies-family-registry-dev';
const REGION = 'ap-southeast-1';

const args = new Set(process.argv.slice(2));
const COPY = args.has('--copy') || args.has('--copy-and-purge');
const PURGE = args.has('--copy-and-purge');
const SCRUB_DEV = args.has('--scrub-dev');
const APPLY = args.has('--apply');

const client = new DynamoDBClient({ region: REGION });

/** Normalize a Gmail address: strip dots before @, drop + suffix, lowercase. */
function normalizeGmail(email) {
  if (!email) return '';
  const lower = email.toLowerCase().trim();
  const at = lower.indexOf('@');
  if (at === -1) return lower;
  const local = lower.slice(0, at);
  const domain = lower.slice(at + 1);
  if (domain !== 'gmail.com') return lower;
  const stripped = local.split('+')[0].replace(/\./g, '');
  return `${stripped}@${domain}`;
}

const DEV_GMAIL = 'gpsp2001@gmail.com';

/**
 * Hardcoded list of family IDs that are CONFIRMED real-user pods and must
 * stay in the prod table. Built from the human review of the dry-run output
 * on 2026-04-14 (see commit message). When --keep-prod-only mode is used,
 * everything NOT in this list is treated as dev.
 */
const KEEP_PROD_IDS = new Set([
  // Auto-classified as real (had real-user emails)
  'dd11f715-b2ef-4e12-abdd-f034cb3a03f5', // jlcst100@gmail.com — Ponce
  'a9fa216e-85a8-46ea-aa3a-74e74b55ac7d', // richard@richardhsmith.co.uk — Parada dos montes
  // Manually identified as real (no email but recognized family names)
  '2ea57e06-3882-45c8-8988-6ea8c8416af0', // Tan
  '1d14bcfe-ea31-4910-9142-f851ebf66996', // Ando
  '19d03eb6-c6d6-41c9-b1c5-f09d438a8281', // Seesters
  '6053f1d8-1d9c-496a-92df-a79c8cee9d09', // The yamamichi family
  'cf6e3f2f-ad07-4567-9561-f388f0e55848', // W
  '13015bde-61a8-4f34-a994-adbad90f518d', // Graglios
  'c15380e2-68af-481a-823c-ad75884a22d7', // the big sausage family
  '9186db2b-976c-4b16-86f8-97af1c200cd1', // Desquiens
  '020cbbee-429c-428e-b0f3-3fa82fecbff2', // Soboszek
  'ae92950b-68c7-462a-b5b9-5f98fa046620', // Parker Meng Beanies
  '5e1ac66e-ec30-4a50-a737-28fb6b716bd6', // Quach
]);

const KEEP_PROD_ONLY = args.has('--keep-prod-only');

/** Family names that mark a row as E2E / dev pollution — delete entirely
 *  (do NOT move to the dev table). Going forward E2E uses the more obvious
 *  "E2E Test Family" name AND cleans up after itself in afterEach hooks;
 *  this list keeps draining historical "Test Family" rows + catches any
 *  E2E run that crashes before its teardown fires. */
const PURGE_FAMILY_NAMES = new Set(['Test Family', 'E2E Test Family']);

function classify(item) {
  // Always purge garbage rows — even in --keep-prod-only mode.
  if (PURGE_FAMILY_NAMES.has(item.familyName || '')) return 'purge';

  // --keep-prod-only mode: any other row not in KEEP_PROD_IDS is dev.
  if (KEEP_PROD_ONLY) {
    return KEEP_PROD_IDS.has(item.familyId) ? 'real' : 'dev';
  }
  const email = (item.ownerEmail || '').toLowerCase();
  if (!email) return 'uncertain'; // no email — manual review
  if (email.endsWith('@test.com')) return 'dev';
  if (normalizeGmail(email) === DEV_GMAIL) return 'dev';
  return 'real'; // not matching dev patterns — assume real user
}

async function scanAll(tableName) {
  const items = [];
  let key;
  do {
    const out = await client.send(
      new ScanCommand({ TableName: tableName, ExclusiveStartKey: key })
    );
    if (out.Items) for (const it of out.Items) items.push(unmarshall(it));
    key = out.LastEvaluatedKey;
  } while (key);
  return items;
}

(async () => {
  if (SCRUB_DEV) {
    console.log(`Mode: SCRUB-DEV ${APPLY ? '(APPLY)' : '(dry-run)'}`);
    console.log(`Scanning ${DEV_TABLE}…`);
    const items = await scanAll(DEV_TABLE);
    const purgeTargets = items.filter((it) => PURGE_FAMILY_NAMES.has(it.familyName || ''));
    console.log(`Total dev rows: ${items.length}`);
    console.log(
      `Will purge ${purgeTargets.length} (familyName ∈ {${[...PURGE_FAMILY_NAMES].join(', ')}})\n`
    );
    for (const it of purgeTargets.slice(0, 5)) {
      console.log(`  ${it.familyId}  familyName=${it.familyName}`);
    }
    if (purgeTargets.length > 5) console.log(`  …and ${purgeTargets.length - 5} more`);
    if (!APPLY) {
      console.log(`\nDry-run complete. Re-run with --scrub-dev --apply to actually delete.`);
      return;
    }
    console.log(`\nDeleting ${purgeTargets.length} rows from ${DEV_TABLE}…`);
    for (const it of purgeTargets) {
      await client.send(
        new DeleteItemCommand({ TableName: DEV_TABLE, Key: marshall({ familyId: it.familyId }) })
      );
      process.stdout.write('.');
    }
    console.log(`\nDone. Dev table now has ${items.length - purgeTargets.length} rows.`);
    return;
  }

  console.log(`Mode: ${COPY ? (PURGE ? 'COPY-AND-PURGE' : 'COPY-ONLY') : 'DRY-RUN'}`);
  console.log(`Scanning ${PROD_TABLE}…`);
  const items = await scanAll(PROD_TABLE);
  console.log(`Found ${items.length} rows.\n`);

  const dev = [];
  const real = [];
  const uncertain = [];
  const purge = [];
  for (const it of items) {
    const c = classify(it);
    if (c === 'dev') dev.push(it);
    else if (c === 'real') real.push(it);
    else if (c === 'purge') purge.push(it);
    else uncertain.push(it);
  }

  const fmt = (it) =>
    `${it.familyId}  ${(it.ownerEmail || '(no email)').padEnd(40)} created=${(it.createdAt || '?').slice(0, 10)} provider=${it.provider || '?'} familyName=${it.familyName || '(none)'}`;

  console.log(`=== AUTO-CLASSIFIED AS DEV (${dev.length}) — will be moved if --copy ===`);
  for (const it of dev) console.log(`  ${fmt(it)}`);
  console.log(`\n=== AUTO-CLASSIFIED AS REAL (${real.length}) — will stay in prod ===`);
  for (const it of real) console.log(`  ${fmt(it)}`);
  console.log(
    `\n=== PURGE (${purge.length}) — "Test Family" rows, deleted from prod, NOT copied ===`
  );
  console.log(`  (showing first 5)`);
  for (const it of purge.slice(0, 5)) console.log(`  ${fmt(it)}`);
  console.log(`\n=== UNCERTAIN — NEEDS YOUR REVIEW (${uncertain.length}) ===`);
  for (const it of uncertain) console.log(`  ${fmt(it)}`);

  if (!COPY) {
    console.log('\nDry-run complete. Re-run with --copy to migrate dev rows.');
    return;
  }

  console.log(`\nCopying ${dev.length} dev rows to ${DEV_TABLE}…`);
  for (const it of dev) {
    await client.send(
      new PutItemCommand({
        TableName: DEV_TABLE,
        Item: marshall(it, { removeUndefinedValues: true }),
      })
    );
    process.stdout.write('.');
  }
  console.log(`\nCopied.`);

  if (!PURGE) {
    console.log(
      '\nCOPY-ONLY mode: prod table left untouched. Verify the dev table looks right, then re-run with --copy-and-purge to delete from prod.'
    );
    return;
  }

  console.log(`\nDeleting ${dev.length} migrated dev rows from ${PROD_TABLE}…`);
  for (const it of dev) {
    await client.send(
      new DeleteItemCommand({ TableName: PROD_TABLE, Key: marshall({ familyId: it.familyId }) })
    );
    process.stdout.write('.');
  }

  if (purge.length > 0) {
    console.log(`\nPurging ${purge.length} "Test Family" rows from ${PROD_TABLE} (no copy)…`);
    for (const it of purge) {
      await client.send(
        new DeleteItemCommand({ TableName: PROD_TABLE, Key: marshall({ familyId: it.familyId }) })
      );
      process.stdout.write('.');
    }
  }

  console.log(
    `\nDone. Prod table now has ${real.length} real rows + ${uncertain.length} uncertain rows.`
  );
  console.log(
    'Review the uncertain list above; if any are also dev, delete them manually via the AWS console or a follow-up scripted run.'
  );
})().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
