/**
 * Spike 1 for flight change push (#143 Phase 2). THROWAWAY HARNESS: not shipped, not tested, not
 * linted into the app. Plan: ~/projects/beanies-ops/docs/plans/2026-11-09-travel-live-flight-checks-phase-2-push.md
 * (requirement 14, Approach "Commit 0").
 *
 * THE QUESTIONS: is the AeroDataBox Flight Alert API callable on the channel we hold, what does a
 * subscription / an event / a refill cost, does a real event reach the production webhook route,
 * and do APNs and FCM deliver to greg's phones with the real keys?
 *
 * It runs the REAL Lambda modules (the alerts client in `providers/aerodatabox.mjs`, the senders
 * in `push/apns.mjs` and `push/fcm.mjs`, the callback-url builder in `alerts.mjs`), so what it
 * proves is what the Lambda will do.
 *
 *   node scripts/spikes/flight-alerts-spike.mts --help
 *   node scripts/spikes/flight-alerts-spike.mts --balance
 *   node scripts/spikes/flight-alerts-spike.mts --list
 *   node scripts/spikes/flight-alerts-spike.mts --subscribe SQ318            # real prod callback url
 *   node scripts/spikes/flight-alerts-spike.mts --subscribe SQ318 --callback https://webhook.site/...
 *   node scripts/spikes/flight-alerts-spike.mts --cancel <subscription id>
 *   node scripts/spikes/flight-alerts-spike.mts --refill 200
 *   node scripts/spikes/flight-alerts-spike.mts --apns <device token> [--sandbox]
 *   node scripts/spikes/flight-alerts-spike.mts --fcm <registration token>
 *
 * Credentials come from the environment when set, else from `~/.beanies-tf.env` (parsed, never
 * sourced, never written): TF_VAR_aerodatabox_api_key, TF_VAR_aerodatabox_webhook_secret,
 * TF_VAR_apns_key_p8 / _key_id / _team_id / _bundle_id, TF_VAR_fcm_project_id / _client_email /
 * _private_key. AERODATABOX_MODE (default rapidapi, the held channel) and FLIGHT_ALERTS_API_BASE
 * (default https://api.beanies.family) are optional.
 *
 * NEVER PRINTS a key, a secret, a device token or a listed subscription url: --list prints each
 * subscription's id, number and whether its url is OURS, STALE (our base, another secret) or
 * FOREIGN, which is exactly the sweep's own classification. Plain `node` (v24 strips types).
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const HELP = `flight-alerts-spike: Spike 1 for flight change push (#143 Phase 2)

Usage:
  node scripts/spikes/flight-alerts-spike.mts <one command> [options]

Commands:
  --balance                 GET /subscriptions/balance (free)
  --list                    GET /subscriptions/webhook (free); urls classified, never printed
  --subscribe <FLIGHT>      POST /subscriptions/webhook/FlightByNumber/<FLIGHT>
      --callback <url>      use this callback instead of the real prod webhook url
  --cancel <id>             DELETE /subscriptions/webhook/<id>
  --refill <n>              POST /subscriptions/balance/refill { credits: n } (spends n units)
  --apns <device token>     one test push through the real APNs sender
      --sandbox             use api.sandbox.push.apple.com (an Xcode debug build's token)
  --fcm <token>             one test push through the real FCM sender
  --help                    this text

Env (else read from ~/.beanies-tf.env; never printed):
  TF_VAR_aerodatabox_api_key, TF_VAR_aerodatabox_webhook_secret, TF_VAR_apns_*, TF_VAR_fcm_*
  AERODATABOX_MODE          rapidapi (default) | direct | apimarket
  FLIGHT_ALERTS_API_BASE    https://api.beanies.family (default)
`;

let args: ReturnType<typeof parse>;
function parse() {
  return parseArgs({
    options: {
      help: { type: 'boolean' },
      balance: { type: 'boolean' },
      list: { type: 'boolean' },
      subscribe: { type: 'string' },
      callback: { type: 'string' },
      cancel: { type: 'string' },
      refill: { type: 'string' },
      apns: { type: 'string' },
      sandbox: { type: 'boolean' },
      fcm: { type: 'string' },
    },
    allowPositionals: false,
  });
}
try {
  args = parse();
} catch (err) {
  console.error(`flight-alerts-spike: ${(err as Error).message}\n\n${HELP}`);
  process.exit(1);
}
const v = args.values;
const commands = ['balance', 'list', 'subscribe', 'cancel', 'refill', 'apns', 'fcm'].filter(
  (c) => v[c as keyof typeof v] !== undefined
);
if (v.help || commands.length !== 1) {
  if (!v.help) console.error('flight-alerts-spike: give exactly one command.\n');
  process.stdout.write(HELP);
  process.exit(v.help ? 0 : 1);
}

// ── Credentials: env first, else ~/.beanies-tf.env parsed (never sourced) ─────────────────────

/** `export NAME=value` / `'multi-line value'` / `"value with $REF"`, as a shell would read them. */
function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  const assign = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)=/;
  while (i < text.length) {
    const lineEnd = text.indexOf('\n', i) === -1 ? text.length : text.indexOf('\n', i);
    const m = assign.exec(text.slice(i, lineEnd));
    if (!m) {
      i = lineEnd + 1;
      continue;
    }
    const name = m[1]!;
    let j = i + m[0].length;
    let value = '';
    if (text[j] === "'") {
      const close = text.indexOf("'", j + 1);
      value = text.slice(j + 1, close === -1 ? text.length : close);
      j = close === -1 ? text.length : close + 1;
    } else if (text[j] === '"') {
      let k = j + 1;
      while (k < text.length && !(text[k] === '"' && text[k - 1] !== '\\')) k += 1;
      value = text
        .slice(j + 1, k)
        .replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_, ref: string) => out[ref] ?? '');
      j = k + 1;
    } else {
      const raw = /^[^\s#;]*/.exec(text.slice(j, lineEnd))?.[0] ?? '';
      value = raw;
      j += raw.length;
    }
    out[name] = value;
    const next = text.indexOf('\n', j);
    i = next === -1 ? text.length : next + 1;
  }
  return out;
}

const envFile = join(homedir(), '.beanies-tf.env');
const fileVars = existsSync(envFile) ? parseEnvFile(readFileSync(envFile, 'utf8')) : {};
const cred = (name: string): string => (process.env[name] ?? fileVars[name] ?? '').trim();

const MODE = process.env.AERODATABOX_MODE?.trim() || 'rapidapi';
const API_BASE = process.env.FLIGHT_ALERTS_API_BASE?.trim() || 'https://api.beanies.family';

// Dynamic imports so --help and arg errors never load the Lambda modules.
const adapter = await import('../../infrastructure/lambda/flight-status/providers/aerodatabox.mjs');
const { webhookUrl } = await import('../../infrastructure/lambda/flight-status/alerts.mjs');

function alertsClient() {
  const apiKey = cred('TF_VAR_aerodatabox_api_key');
  if (!apiKey) {
    console.error(
      'flight-alerts-spike: no AeroDataBox key (TF_VAR_aerodatabox_api_key in env or ~/.beanies-tf.env).'
    );
    process.exit(1);
  }
  return adapter.createAlertsClient({ apiKey, mode: MODE });
}

/** A ProviderError without its cause (a cause could carry a request with headers). */
function describeError(err: unknown): string {
  const e = err as { name?: string; code?: string; httpStatus?: number; message?: string };
  return e?.code
    ? `${e.name ?? 'Error'} code=${e.code} http_status=${e.httpStatus ?? '-'}`
    : `${e?.name ?? 'Error'}: ${String(e?.message ?? err).slice(0, 200)}`;
}

async function run(): Promise<void> {
  console.log(`flight-alerts-spike: mode=${MODE} api_base=${API_BASE}`);

  if (v.balance) {
    const balance = await alertsClient().getBalance();
    console.log(`balance: creditsRemaining=${balance ?? 'null (no balance row yet)'}`);
    return;
  }

  if (v.list) {
    const secret = cred('TF_VAR_aerodatabox_webhook_secret');
    const own = secret ? webhookUrl(API_BASE, secret) : null;
    const base = webhookUrl(API_BASE, '');
    const subs = await alertsClient().listAlerts();
    console.log(
      `list: ${subs.length} subscription(s)${own ? '' : ' (webhook secret unset: OURS cannot be told from STALE)'}`
    );
    for (const s of subs) {
      const kind = own && s.url === own ? 'OURS' : s.url.startsWith(base) ? 'STALE' : 'FOREIGN';
      console.log(
        `  id=${s.id} flight=${s.flight ?? '(not a number)'} url=${kind} url_present=${s.url !== ''}`
      );
    }
    return;
  }

  if (v.subscribe !== undefined) {
    const flight = v.subscribe.toUpperCase().replace(/[\s-]/g, '');
    if (!/^[A-Z0-9]{2}\d{1,4}$/.test(flight)) {
      console.error(`flight-alerts-spike: "${v.subscribe}" is not a flight number.`);
      process.exit(1);
    }
    let callback = v.callback;
    let which = 'custom --callback';
    if (!callback) {
      const secret = cred('TF_VAR_aerodatabox_webhook_secret');
      if (!secret) {
        console.error(
          'flight-alerts-spike: no TF_VAR_aerodatabox_webhook_secret; pass --callback <url> or set it.'
        );
        process.exit(1);
      }
      callback = webhookUrl(API_BASE, secret);
      which = 'the production webhook route (secret path)';
    }
    const { id } = await alertsClient().subscribeAlert(flight, callback);
    console.log(`subscribe: flight=${flight} id=${id} callback=${which}`);
    console.log(
      `  cancel it this session: node scripts/spikes/flight-alerts-spike.mts --cancel ${id}`
    );
    console.log(
      '  (the 6-hourly sweep would cancel an own-url subscription with no table row anyway)'
    );
    return;
  }

  if (v.cancel !== undefined) {
    await alertsClient().cancelAlert(v.cancel);
    console.log(`cancel: id=${v.cancel} done (a 404 counts as done)`);
    return;
  }

  if (v.refill !== undefined) {
    const credits = Number(v.refill);
    if (!Number.isInteger(credits) || credits < 1 || credits > 600) {
      console.error('flight-alerts-spike: --refill takes an integer 1-600 (the Pro per-call cap).');
      process.exit(1);
    }
    const { creditsRemaining, quota } = await alertsClient().refillCredits(credits);
    console.log(
      `refill: added=${credits} creditsRemaining=${creditsRemaining ?? 'null'} ` +
        `units_remaining=${quota?.remaining ?? '-'} units_limit=${quota?.limit ?? '-'}`
    );
    return;
  }

  const msg = (collapse: string) => ({
    title: 'beanies.family',
    body: 'Spike 1 (e): a test push from the flight-alerts harness.',
    data: { kind: 'travel-change', flight: 'SQ318', date: '2026-12-13' },
    collapseId: collapse,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  });

  if (v.apns !== undefined) {
    const { createApnsSender } =
      await import('../../infrastructure/lambda/flight-status/push/apns.mjs');
    const sender = createApnsSender({
      keyP8: cred('TF_VAR_apns_key_p8'),
      keyId: cred('TF_VAR_apns_key_id'),
      teamId: cred('TF_VAR_apns_team_id'),
      bundleId: cred('TF_VAR_apns_bundle_id') || 'family.beanies.app',
      env: v.sandbox ? 'sandbox' : 'production',
    });
    try {
      const out = await sender.send({ token: v.apns, ...msg('spike#apns') });
      console.log(`apns (${v.sandbox ? 'sandbox' : 'production'}): ${JSON.stringify(out)}`);
    } finally {
      sender.close();
    }
    return;
  }

  if (v.fcm !== undefined) {
    const { createFcmSender } =
      await import('../../infrastructure/lambda/flight-status/push/fcm.mjs');
    const sender = createFcmSender({
      projectId: cred('TF_VAR_fcm_project_id'),
      clientEmail: cred('TF_VAR_fcm_client_email'),
      privateKey: cred('TF_VAR_fcm_private_key'),
    });
    const out = await sender.send({ token: v.fcm, ...msg('spike#fcm') });
    console.log(`fcm: ${JSON.stringify(out)}`);
  }
}

try {
  await run();
} catch (err) {
  console.error(`flight-alerts-spike: FAILED ${describeError(err)}`);
  process.exit(1);
}
