#!/usr/bin/env node
/**
 * Magic-bean usage per family, straight from the meter's own table.
 *
 * WHY NOT CLOUDWATCH
 * The ai-extract log group carries no `family_id` at all — its only success line is
 * `task` + `enclave` — and the telemetry firehose has no surface covering event/travel/share
 * extraction. So there is no log-derived number to have. The table IS the record.
 *
 * WHY IT IMPORTS FROM THE LAMBDA
 * Five facts have to agree for a join to work: the hash function, the pk prefix, the sk prefix,
 * the attribute names and the table name. Re-deriving any of them here is how the join silently
 * returns zero rows — which looks exactly like "no reads yet". So this imports the grammar from
 * `infrastructure/lambda/ai-extract/ddb.mjs` rather than restating it. That module imports only
 * `node:crypto` at module scope, so this pulls in no SDK it does not already need.
 *
 * READ-ONLY, like every collector in this skill. Scan and sum; never write.
 *
 * Usage:  node pull_ai_usage.mjs [--days 30] > "$OUT/ai_usage.json"
 */

import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

import { USAGE_ATTRS, hash, usageTableName } from '../../../../infrastructure/lambda/ai-extract/ddb.mjs';

const REGION = 'ap-southeast-1';
const TABLE = usageTableName('prod');

/** Rows whose hash joins nothing, above this share, means something is wrong. */
const UNATTRIBUTED_WARN_RATIO = 0.05;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

async function scanAll() {
  const client = new DynamoDBClient({ region: REGION });
  const items = [];
  let ExclusiveStartKey;
  do {
    const page = await client.send(
      new ScanCommand({ TableName: TABLE, ExclusiveStartKey })
    );
    for (const raw of page.Items ?? []) items.push(unmarshall(raw));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function main() {
  const days = Number(arg('days', 30));
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

  const rows = await scanAll();

  // Only counter rows. Written defensively rather than because grants share this table — they
  // live in the rate table — so that a future second item shape cannot silently be summed in.
  const counters = rows.filter((r) => typeof r.sk === 'string' && r.sk.startsWith('d#'));

  // The registry is the only place a RAW family id lives; the meter stores only the hash. Join
  // by hashing locally, which is why this file and the Lambda must share one hash function.
  let registry = [];
  try {
    const raw = process.env.REGISTRY_JSON;
    if (raw) registry = JSON.parse(raw).families ?? JSON.parse(raw);
  } catch {
    registry = [];
  }
  const byHash = new Map(
    registry
      .filter((f) => f?.familyId)
      .map((f) => [hash(f.familyId), f])
  );

  const perFamily = new Map();
  let charged = 0;
  let corrected = 0;
  let unattributed = 0;
  // ⚠️ The DENOMINATOR must be window-filtered too. `unattributed` is counted only for rows
  // inside the window, so dividing by `counters.length` — every row the scan returned, up to
  // the ~400-day TTL horizon — dilutes the ratio by roughly the ratio of the two spans. At a
  // 30-day default that is ~13x: 100% of in-window rows failing to join could report 0.075
  // against a 0.05 threshold, and a typical 30% drift would never fire at all. This is the one
  // alarm that exists to catch hash drift; a diluted one is worse than none.
  let inWindow = 0;

  for (const row of counters) {
    const day = row.sk.slice(2);
    if (day < since) continue;
    inWindow += 1;
    const n = Number(row[USAGE_ATTRS.charged] ?? 0);
    const c = Number(row[USAGE_ATTRS.corrected] ?? 0);
    charged += n;
    corrected += c;

    const familyHash = String(row.pk).slice(2);
    const known = byHash.get(familyHash);
    if (!known && byHash.size) unattributed += 1;

    const key = familyHash;
    const acc = perFamily.get(key) ?? {
      familyHash,
      name: known?.familyName ?? null,
      charged: 0,
      corrected: 0,
      days: 0,
    };
    acc.charged += n;
    acc.corrected += c;
    acc.days += 1;
    perFamily.set(key, acc);
  }

  // Zero rows is a FAILURE, not "no reads yet" — a wrong pk prefix returns nothing at all, so
  // the unattributed warning below can never fire for it. Exit non-zero so the pipeline says so.
  if (counters.length === 0 && byHash.size > 0) {
    console.error(
      `[pull_ai_usage] ${TABLE} returned NO counter rows while the registry has ` +
        `${byHash.size} families. That is a failure, not an empty meter: suspect the key ` +
        'grammar or the table name before concluding nobody has used magic beans.'
    );
    process.exit(1);
  }

  if (byHash.size && unattributed / Math.max(inWindow, 1) > UNATTRIBUTED_WARN_RATIO) {
    console.error(
      `[pull_ai_usage] ${unattributed}/${inWindow} usage rows in the window do not join to a ` +
        'registry family. First suspect is hash drift between ddb.mjs and whatever wrote these ' +
        'rows.'
    );
  }

  process.stdout.write(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: { table: TABLE, region: REGION },
        windowDays: days,
        // `charged` is what an allowance is spent against. `corrected` is OUR cost — a free
        // re-read after we inferred the wrong kind — and must never be summed into an
        // entitlement calculation. Labelled here so the dashboard cannot get it wrong.
        totals: { charged, corrected, unattributedRows: unattributed },
        families: [...perFamily.values()].sort((a, b) => b.charged - a.charged),
      },
      null,
      2
    ) + '\n'
  );
}

main().catch((err) => {
  console.error('[pull_ai_usage] failed:', err?.message ?? err);
  process.exit(1);
});
