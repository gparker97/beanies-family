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
 *   node scripts/migrate-registry-dev-rows.mjs              # dry-run (default)
 *   node scripts/migrate-registry-dev-rows.mjs --copy       # copy classified-dev rows to dev table (no deletes)
 *   node scripts/migrate-registry-dev-rows.mjs --copy-and-purge   # copy + delete from prod
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

function classify(item) {
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
  console.log(`Mode: ${COPY ? (PURGE ? 'COPY-AND-PURGE' : 'COPY-ONLY') : 'DRY-RUN'}`);
  console.log(`Scanning ${PROD_TABLE}…`);
  const items = await scanAll(PROD_TABLE);
  console.log(`Found ${items.length} rows.\n`);

  const dev = [];
  const real = [];
  const uncertain = [];
  for (const it of items) {
    const c = classify(it);
    (c === 'dev' ? dev : c === 'real' ? real : uncertain).push(it);
  }

  const fmt = (it) =>
    `${it.familyId}  ${(it.ownerEmail || '(no email)').padEnd(40)} created=${(it.createdAt || '?').slice(0, 10)} provider=${it.provider || '?'} familyName=${it.familyName || '(none)'}`;

  console.log(`=== AUTO-CLASSIFIED AS DEV (${dev.length}) — will be moved if --copy ===`);
  for (const it of dev) console.log(`  ${fmt(it)}`);
  console.log(`\n=== AUTO-CLASSIFIED AS REAL (${real.length}) — will stay in prod ===`);
  for (const it of real) console.log(`  ${fmt(it)}`);
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

  console.log(`\nDeleting ${dev.length} dev rows from ${PROD_TABLE}…`);
  for (const it of dev) {
    await client.send(
      new DeleteItemCommand({ TableName: PROD_TABLE, Key: marshall({ familyId: it.familyId }) })
    );
    process.stdout.write('.');
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
