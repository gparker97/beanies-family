#!/usr/bin/env node
/**
 * revoke-breadth-check.mjs — one-off empirical test for beanies.family #62.
 *
 * THE QUESTION (gates the final revoke ordering in the token-churn fix):
 *   For a single Google account + OAuth client, if you hold TWO separate refresh
 *   tokens (from two independent `prompt=consent` flows — exactly the Drive-grant
 *   + Calendar-grant situation) and revoke ONE of them, does the OTHER still work?
 *
 *     • STILL WORKS  → NARROW  (revoke is per-authorization-grant). The correct,
 *                      cancel-safe design is REVOKE-AFTER-MINT: mint the new token
 *                      first, then revoke the old one. Kills review findings 1 & 3.
 *     • ALSO DEAD    → BROAD   (revoke kills the whole user+client grant). The
 *                      shipped REVOKE-BEFORE-MINT ordering is forced, and the
 *                      cancel-a-healthy-switch tradeoff is unavoidable.
 *
 * The `/revoke` semantics are a Google-platform behaviour (RFC 7009 + Google's
 * implementation), the same for the app's Web client and a throwaway Desktop
 * client — the Desktop client just makes this scriptable (loopback redirect).
 *
 * ─── SETUP (about 2 minutes) ────────────────────────────────────────────────
 *   1. Google Cloud Console → the SAME project as beanies → APIs & Services →
 *      Credentials → Create Credentials → OAuth client ID → Application type:
 *      "Desktop app". Name it e.g. "revoke-breadth-throwaway". Copy its Client ID
 *      + Client secret. (Delete this client when you're done.)
 *        ▸ To test the REAL Web client instead: on it, add an Authorized redirect
 *          URI of  http://localhost:8719  and pass that client's id + secret.
 *   2. The account you'll consent with must be allowed: if the OAuth consent
 *      screen is in "Testing", add the account as a Test user; if it's "In
 *      production" (beanies is), any account works.
 *   3. Run:
 *        GOOGLE_CLIENT_ID=xxxx GOOGLE_CLIENT_SECRET=yyyy \
 *          node scripts/revoke-breadth-check.mjs
 *   4. It prints TWO consent URLs. Open each in a browser, approve with the SAME
 *      Google account both times. The script captures the codes on localhost and
 *      prints the verdict.
 *   5. Delete the throwaway Desktop OAuth client.
 *
 * No secrets are stored: client id/secret come from env; tokens live only in
 * memory for the duration of the run and are revoked at the end.
 *
 * Requires Node 18+ (global fetch). No npm dependencies.
 */

import http from 'node:http';
import crypto from 'node:crypto';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PORT = Number(process.env.PORT || 8719);
const REDIRECT_URI = `http://localhost:${PORT}`;

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

// Two DIFFERENT scopes to mirror the app's Drive-grant + Calendar-grant exactly.
// (The grant-separation answer does not actually depend on scope, but this makes
// the test a faithful stand-in for the real situation.)
const SCOPE_A = 'https://www.googleapis.com/auth/drive.file';
const SCOPE_B = 'https://www.googleapis.com/auth/calendar.events.owned';

function die(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

if (!CLIENT_ID || !CLIENT_SECRET) {
  die(
    'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (a throwaway Desktop OAuth client — see the header of this file).'
  );
}

const b64url = (buf) => buf.toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest();

/**
 * Run one full consent → code → token exchange, capturing the code on a
 * short-lived loopback server. Returns the token response (incl. refresh_token).
 */
async function consentAndExchange(label, scope) {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(sha256(verifier));
  const state = b64url(crypto.randomBytes(16));

  const authUrl =
    `${AUTH_URL}?` +
    new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope,
      access_type: 'offline',
      prompt: 'consent', // force a refresh token every time — the app's invariant
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    }).toString();

  console.log(`\n── Consent ${label} (scope: ${scope.split('/').pop()}) ─────────────`);
  console.log('Open this URL and approve with the SAME Google account:\n');
  console.log(`  ${authUrl}\n`);

  const code = await waitForCode(state);
  console.log(`  ✓ captured authorization code for ${label}`);

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.refresh_token) {
    die(
      `Token exchange for ${label} failed (${res.status}): ${JSON.stringify(json)}\n` +
        `(No refresh_token usually means the account had a prior grant and Google skipped consent — ` +
        `revoke the app at myaccount.google.com/permissions and retry, or ensure prompt=consent.)`
    );
  }
  return json;
}

/** Start a loopback server, wait for the OAuth redirect with matching state. */
function waitForCode(expectedState) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const err = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      if (err) {
        res.end(`<h2>OAuth error: ${err}</h2>You can close this tab.`);
        die(`Consent returned error: ${err}`);
      }
      if (!code || state !== expectedState) {
        res.end('<h2>Waiting…</h2>Ignore — mismatched request. You can close this tab.');
        return;
      }
      res.end('<h2>✓ Captured. Return to the terminal.</h2>You can close this tab.');
      server.close();
      resolve(code);
    });
    server.listen(PORT);
  });
}

async function refreshWorks(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const json = await res.json();
  return { ok: res.ok && !!json.access_token, status: res.status, body: json };
}

async function revoke(token) {
  const res = await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: 'POST' });
  return res.status;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('revoke-breadth-check — beanies #62');
  console.log(`redirect_uri: ${REDIRECT_URI}  (must be a registered/loopback URI on the client)`);

  const a = await consentAndExchange('A', SCOPE_A);
  const b = await consentAndExchange('B', SCOPE_B);

  if (a.refresh_token === b.refresh_token) {
    die(
      'Both consents returned the SAME refresh_token — Google did not mint a second grant. ' +
        'Retry after revoking the app at myaccount.google.com/permissions so each consent is fresh.'
    );
  }

  console.log('\n── Baseline: confirm BOTH refresh tokens work before revoking ──');
  const aBefore = await refreshWorks(a.refresh_token);
  const bBefore = await refreshWorks(b.refresh_token);
  console.log(`  token A refresh: ${aBefore.ok ? '✓ works' : '✗ FAILED'}`);
  console.log(`  token B refresh: ${bBefore.ok ? '✓ works' : '✗ FAILED'}`);
  if (!aBefore.ok || !bBefore.ok) {
    die('A token did not work even before revoking — cannot draw a conclusion. See bodies above.');
  }

  console.log('\n── Revoking token A only ──');
  const revokeStatus = await revoke(a.refresh_token);
  console.log(`  /revoke(A) → HTTP ${revokeStatus}`);
  console.log('  waiting 5s for propagation…');
  await sleep(5000);

  console.log('\n── The verdict: does token B still work AFTER revoking A? ──');
  const bAfter = await refreshWorks(b.refresh_token);
  const aAfter = await refreshWorks(a.refresh_token);
  console.log(
    `  token A (revoked) refresh: ${aAfter.ok ? '✗ still works?!' : '✓ dead (expected)'}`
  );
  console.log(`  token B (sibling) refresh: ${bAfter.ok ? 'WORKS' : 'DEAD'}`);

  console.log('\n════════════════════════════════════════════════════════════');
  if (bAfter.ok) {
    console.log('RESULT: NARROW — revoke is per-grant.');
    console.log('  → Switch the token-churn fix to REVOKE-AFTER-MINT (cancel-safe);');
    console.log('    review findings 1 & 3 are resolved. The disconnect/reconnect');
    console.log('    Drive-safety guards can be relaxed to always revoke.');
  } else {
    console.log('RESULT: BROAD — revoke kills the whole user+client grant.');
    console.log('  → REVOKE-BEFORE-MINT (as shipped) is correct and required.');
    console.log('    The cancel-a-healthy-switch tradeoff (finding 1) is inherent;');
    console.log('    keep the Drive-safety guards. Consider mint-then-swap only if');
    console.log('    a mechanism to avoid the cancel window is worth it.');
    console.log(`  (token B error body: ${JSON.stringify(bAfter.body)})`);
  }
  console.log('════════════════════════════════════════════════════════════');

  console.log('\nCleanup: revoking token B…');
  await revoke(b.refresh_token);
  console.log('  ✓ done. Remember to delete the throwaway Desktop OAuth client.\n');
  process.exit(0);
}

main().catch((e) => die(e?.stack || String(e)));
