#!/usr/bin/env node
/**
 * Fail if any CloudWatch log group has no retention, or if any Lambda module
 * declares a function without a matching retention-pinned log group.
 *
 * WHY
 * ---
 * A Lambda that writes its first log line with no `aws_cloudwatch_log_group`
 * resource declared gets one auto-created by AWS with retention "Never expire".
 * Nothing errors, nothing alarms, and the group grows forever — which is how
 * `oauth` (10.3 MB) and `registry` (1.4 MB) accumulated unbounded history while
 * four sibling groups were correctly pinned at 90 days. The failure mode is
 * silence, so the check has to be explicit.
 *
 * Two modes:
 *   --live   query AWS and assert every existing group has retention set
 *            (needs credentials; skipped automatically when absent)
 *   default  static scan of infrastructure/modules — every `aws_lambda_function`
 *            must have a sibling `aws_cloudwatch_log_group` in the same module
 *            with `retention_in_days` set
 *
 * The static check is the one that matters in CI: it catches the omission when
 * the module is written, before anything has been deployed and long before a
 * bill or a free-tier alert would notice.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const MODULES_DIR = 'infrastructure/modules';
const live = process.argv.includes('--live');
const failures = [];

// ── Static: every Lambda module pins its own log group ─────────────────────

if (!existsSync(MODULES_DIR)) {
  console.error(`[log-retention] ${MODULES_DIR} not found — run from the repo root`);
  process.exit(2);
}

for (const mod of readdirSync(MODULES_DIR)) {
  const mainTf = join(MODULES_DIR, mod, 'main.tf');
  if (!existsSync(mainTf)) continue;
  const tf = readFileSync(mainTf, 'utf8');

  const lambdas = [...tf.matchAll(/resource\s+"aws_lambda_function"\s+"([^"]+)"/g)].map(
    (m) => m[1]
  );
  if (lambdas.length === 0) continue;

  const groups = [
    ...tf.matchAll(/resource\s+"aws_cloudwatch_log_group"\s+"([^"]+)"\s*\{([\s\S]*?)\n\}/g),
  ];
  const pinned = groups.filter(([, , body]) => /retention_in_days\s*=/.test(body)).length;
  const unpinned = groups
    .filter(([, name, body]) => !/retention_in_days\s*=/.test(body))
    .map(([, n]) => n);

  for (const name of unpinned) {
    failures.push(
      `${mod}: log group "${name}" has no retention_in_days — an unset retention keeps logs forever`
    );
  }
  if (pinned < lambdas.length) {
    failures.push(
      `${mod}: ${lambdas.length} Lambda function(s) [${lambdas.join(', ')}] but only ${pinned} ` +
        `retention-pinned log group(s). An undeclared group is auto-created by AWS with NO retention. ` +
        `Add an aws_cloudwatch_log_group with retention_in_days = var.log_retention_days, and ` +
        `depends_on it from the Lambda so AWS cannot create the unbounded one first.`
    );
  }
}

// ── Live: nothing in the account is unbounded ──────────────────────────────

if (live) {
  try {
    const raw = execFileSync(
      'aws',
      [
        'logs',
        'describe-log-groups',
        '--query',
        'logGroups[].[logGroupName,retentionInDays]',
        '--output',
        'json',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    for (const [name, retention] of JSON.parse(raw)) {
      if (retention === null || retention === undefined) {
        failures.push(`live: ${name} has NO retention set — it will grow forever`);
      }
    }
  } catch (err) {
    // Missing credentials must not turn a local run red; the static check above
    // is the one CI depends on.
    console.error(`[log-retention] live check skipped (${err.message.split('\n')[0]})`);
  }
}

if (failures.length) {
  console.error('\n[log-retention] FAILED:\n' + failures.map((f) => `  - ${f}`).join('\n') + '\n');
  process.exit(1);
}
console.log('[log-retention] OK — every Lambda module pins its log-group retention.');
