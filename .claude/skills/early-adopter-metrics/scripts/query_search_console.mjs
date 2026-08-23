#!/usr/bin/env node
/**
 * early-adopter-metrics: Google Search Console Search Analytics (READ-ONLY).
 *
 * WHY THIS EXISTS: Plausible cannot report Google search terms, and no analytics
 * tool can — Google strips the query from the referrer, so every organic Google
 * visit arrives as nothing more than `source = Google`. Search terms live in one
 * place only: Search Console. This script is the bridge.
 *
 * WHAT IT RETURNS: per query — clicks, impressions, CTR, average position; plus
 * the query x landing-page join, which is what lets the dashboard attribute a
 * search term to the page it lands on.
 *
 * ⚠️ A HONEST LIMIT ON "HIGHEST-CONVERTING SEARCH TERMS": Search Console knows
 * clicks, NOT conversions. There is no identifier shared between a GSC click and
 * a Plausible session, so no tool can tell you "this search term produced a
 * signup". What this enables is an INFERENCE, not attribution: term -> landing
 * page (GSC) -> that page's downstream behaviour (Plausible). The dashboard
 * labels it as inferred. Do not present it as tracked conversion.
 *
 * ── Credentials (either works; service account preferred) ───────────────────
 * 1. Service account JSON key at ~/.config/beanies/gsc-service-account.json
 *    (or env GSC_SERVICE_ACCOUNT_JSON = the path, or GOOGLE_APPLICATION_CREDENTIALS).
 *    Setup: Google Cloud console -> enable "Google Search Console API" -> create a
 *    service account -> create a JSON key -> then in Search Console, Settings ->
 *    Users and permissions -> Add user -> the service account's email ->
 *    permission "Restricted" (read-only is enough).
 * 2. env GSC_ACCESS_TOKEN — a pre-minted OAuth access token, for a one-off run.
 *
 * Scope: https://www.googleapis.com/auth/webmasters.readonly
 *
 * Usage:
 *   node query_search_console.mjs [DAYS] [SITE_URL]
 *     DAYS     default 30
 *     SITE_URL default sc-domain:beanies.family
 *              (use "https://beanies.family/" if the property is URL-prefix, not domain)
 *
 * Exits 3 (not 1) when credentials are absent, matching query_plausible.mjs, so
 * the caller can degrade gracefully rather than failing the whole report.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createSign } from 'node:crypto';

const DAYS = Number(process.argv[2] || 30);
const SITE = process.argv[3] || 'sc-domain:beanies.family';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

function keyPath() {
  if (process.env.GSC_SERVICE_ACCOUNT_JSON) return process.env.GSC_SERVICE_ACCOUNT_JSON;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const dir = join(homedir(), '.config', 'beanies');
  const canonical = join(dir, 'gsc-service-account.json');
  if (existsSync(canonical)) return canonical;
  // Google hands you a key named like "my-project-ebb2d97c30a1.json" and nobody
  // renames it. Accept any service-account JSON sitting in the config dir so a
  // straight drag-and-drop of the download just works.
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json')) continue;
      const full = join(dir, name);
      try {
        const j = JSON.parse(readFileSync(full, 'utf8'));
        if (j?.type === 'service_account' && j.client_email && j.private_key) return full;
      } catch {
        /* not JSON, or not a key — keep looking */
      }
    }
  } catch {
    /* config dir missing */
  }
  return null;
}

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Mint an access token from a service-account key via the JWT-bearer grant. */
async function tokenFromServiceAccount(key) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope: SCOPE,
      aud: key.token_uri || 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const sig = b64url(signer.sign(key.private_key));
  const assertion = `${header}.${claim}.${sig}`;

  const res = await fetch(key.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`token exchange ${res.status}: ${body.error_description || body.error || 'unknown'}`);
  return body.access_token;
}

async function getToken() {
  if (process.env.GSC_ACCESS_TOKEN) return process.env.GSC_ACCESS_TOKEN.trim();
  const p = keyPath();
  if (!p) return null;
  let key;
  try {
    key = JSON.parse(readFileSync(p, 'utf8'));
  } catch (err) {
    throw new Error(`could not read service-account key at ${p}: ${err.message}`);
  }
  if (!key.client_email || !key.private_key) throw new Error(`${p} is not a service-account key (needs client_email + private_key)`);
  return tokenFromServiceAccount(key);
}

/** yyyy-mm-dd, N days back from today. GSC data lags ~2 days; we ask anyway. */
function isoDaysAgo(n) {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 10);
}

async function query(token, dimensions, limit = 100) {
  const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startDate: isoDaysAgo(DAYS),
      endDate: isoDaysAgo(0),
      dimensions,
      rowLimit: limit,
      type: 'web',
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { msg = JSON.parse(text).error?.message || text; } catch { /* raw */ }
    throw new Error(`Search Console ${res.status} for ${SITE} (${dimensions.join('+')}): ${msg}`);
  }
  const json = JSON.parse(text);
  return (json.rows || []).map((r) => {
    const o = {};
    dimensions.forEach((d, i) => (o[d] = r.keys[i]));
    o.clicks = r.clicks;
    o.impressions = r.impressions;
    o.ctr = Math.round((r.ctr || 0) * 1000) / 10; // percent, 1dp
    o.position = Math.round((r.position || 0) * 10) / 10;
    return o;
  });
}

async function main() {
  let token;
  try {
    token = await getToken();
  } catch (err) {
    process.stderr.write(`[query_search_console] CREDENTIAL ERROR: ${err.message}\n`);
    process.exit(3);
  }
  if (!token) {
    process.stderr.write(
      'GSC_CREDENTIALS_MISSING: no service-account key and no GSC_ACCESS_TOKEN.\n' +
        '  Put a key at ~/.config/beanies/gsc-service-account.json (Google Cloud -> enable\n' +
        '  "Google Search Console API" -> service account -> JSON key), then add that\n' +
        "  service account's email as a Restricted user on the Search Console property.\n",
    );
    process.exit(3);
  }

  const [queries, pages, queryPages] = await Promise.all([
    query(token, ['query'], 100),
    query(token, ['page'], 50),
    query(token, ['query', 'page'], 200),
  ]);

  process.stdout.write(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        site: SITE,
        days: DAYS,
        dateRange: { start: isoDaysAgo(DAYS), end: isoDaysAgo(0) },
        // Google ANONYMIZES rare queries — they are omitted from the `query`
        // dimension entirely. So query-level totals understate reality, often
        // badly (observed: 151 query impressions vs 256 on the homepage alone).
        // Page-level is the complete figure; report both and never present the
        // query total as site traffic.
        totals: {
          clicks: pages.reduce((a, r) => a + r.clicks, 0),
          impressions: pages.reduce((a, r) => a + r.impressions, 0),
        },
        queryLevelTotals: {
          clicks: queries.reduce((a, r) => a + r.clicks, 0),
          impressions: queries.reduce((a, r) => a + r.impressions, 0),
          note: 'query rows exclude anonymized rare queries — lower than page totals by design',
        },
        queries,
        pages,
        queryPages,
      },
      null,
      2,
    ) + '\n',
  );
}

main().catch((err) => {
  process.stderr.write(`[query_search_console] FAILED: ${err?.message || err}\n`);
  process.exit(1);
});
