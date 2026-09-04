#!/usr/bin/env node
/**
 * Fail an App Store release EARLY when its marketing version has already been used.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────
 *
 * `scripts/derive-store-version.mjs` strips the beanies `R<n>` revision suffix, because iOS
 * `CFBundleShortVersionString` must be at most three dot-separated integers. That means
 * `0.15`, `0.15R1`, `0.15R2` and `0.15R3` are all the SAME version number to Apple.
 *
 * On 2026-09-03 a `0.15R3` release ran `npm run build`, then `xcodebuild`, then died at the
 * very last step with:
 *
 *     The version number has been previously used. - /data/attributes/versionString
 *
 * Five minutes of signed build, and no retry could ever have fixed it — the only fix is a
 * different version string. This check takes a couple of seconds and runs BEFORE the build,
 * so the failure is instant and the message says what to do instead of leaving a Ruby
 * backtrace to interpret.
 *
 * ── Scope ────────────────────────────────────────────────────────────────────────────────
 *
 * App Store submissions ONLY. TestFlight builds legitimately reuse a marketing version (they
 * are told apart by build number), so the workflow runs this only for `appstore-*`.
 *
 * ── Failure posture: FAIL OPEN ───────────────────────────────────────────────────────────
 *
 * If App Store Connect cannot be reached, or the response cannot be parsed, this logs loudly
 * and exits 0. A preflight that blocks a good release because Apple had a wobble is worse
 * than the failure it prevents, and the real upload still refuses a duplicate — this is an
 * early-warning, never the enforcement. It exits non-zero for exactly one reason: the version
 * is confirmed used.
 *
 * Auth, the bundle-id lookup and the app-id lookup live in `ascClient.mjs`, shared with the
 * pending-submission preflight so there is exactly one JWT builder to keep correct.
 */

import {
  ascCredentials,
  ascGet,
  resolveAppId,
  resolveBundleId,
  tokenFromCredentials,
} from './ascClient.mjs';

/**
 * Decide the outcome from the versions App Store Connect reports.
 *
 * Split out from the network call so the decision — the part that can be WRONG in a way that
 * matters — is unit-testable without mocking HTTP.
 *
 * @param {string} version the marketing version this release would ship
 * @param {string[]} existing every versionString already on App Store Connect
 * @returns {{ ok: true, existing: string[] } | { ok: false, message: string }}
 */
export function judge(version, existing) {
  const used = existing.filter((v) => typeof v === 'string' && v.length > 0);
  if (!used.includes(version)) return { ok: true, existing: used };
  return {
    ok: false,
    message:
      `App Store version ${version} has ALREADY BEEN USED.\n\n` +
      `  Versions on App Store Connect: ${[...used].sort().join(', ')}\n\n` +
      `This is almost always the R-suffix trap: APP_VERSION "x.yRn" collapses to "x.y" for\n` +
      `the App Store, because CFBundleShortVersionString takes at most three integers — so\n` +
      `0.15R1, 0.15R2 and 0.15R3 are all "0.15" to Apple.\n\n` +
      `  FIX: set a new NUMERIC APP_VERSION in src/constants/appVersion.ts (e.g. 0.15.1,\n` +
      `       not 0.15R3), then re-run. Web and Play accept R revisions freely; only the\n` +
      `       App Store does not.`,
  };
}

/**
 * Every `versionString` App Store Connect holds for the app. Throws on any transport fault —
 * `main` turns that into the fail-open path.
 *
 * `fetchImpl` is injectable so the two-hop shape (apps lookup → versions lookup) is testable
 * without reaching Apple; it defaults to the global `fetch` at call time.
 */
export async function fetchExistingVersions({ bundleId, token, fetchImpl = fetch }) {
  const appId = await resolveAppId({ bundleId, token, fetchImpl });
  // `limit=200` rather than paging: an app with more than 200 released versions is not a
  // situation this check needs to handle, and a partial list can only fail OPEN (it might
  // miss a used version, which the real upload then catches).
  const versions = await ascGet(
    `/v1/apps/${appId}/appStoreVersions?limit=200&fields[appStoreVersions]=versionString`,
    token,
    fetchImpl
  );
  return (versions?.data ?? []).map((v) => v?.attributes?.versionString).filter(Boolean);
}

async function main() {
  const version = process.env.MARKETING_VERSION?.trim();
  const credentials = ascCredentials();

  if (!version) {
    // A missing version is a workflow wiring fault, not an Apple outage — fail CLOSED, since
    // continuing would build and stamp an empty version.
    console.error(
      '[preflight] MARKETING_VERSION is empty — refusing to build an unversioned release.'
    );
    process.exit(1);
  }

  if (!credentials) {
    console.warn(
      '[preflight] App Store Connect credentials are not set ' +
        '(APP_STORE_CONNECT_API_KEY_ID / _ISSUER_ID / ASC_API_KEY_P8_PATH). ' +
        `Skipping the version check for ${version}; the upload step still refuses a duplicate.`
    );
    return;
  }

  let existing;
  try {
    // Inside the try, with the network calls: an unreadable config or key is the same class
    // of environment fault as an unreachable Apple, and takes the same fail-open path.
    const token = tokenFromCredentials(credentials);
    existing = await fetchExistingVersions({ bundleId: resolveBundleId(), token });
  } catch (err) {
    // FAIL OPEN — see the header. Loud, so a persistently broken preflight is visible in the
    // log rather than quietly protecting nothing.
    console.warn(
      `[preflight] could not read existing versions from App Store Connect ` +
        `(${err instanceof Error ? err.message : String(err)}). Continuing — the upload step ` +
        `still refuses a duplicate version.`
    );
    return;
  }

  const verdict = judge(version, existing);
  if (!verdict.ok) {
    console.error(`[preflight] ${verdict.message}`);
    process.exit(1);
  }
  console.log(
    `[preflight] App Store version ${version} is unused. ` +
      `Existing: ${verdict.existing.sort().join(', ') || '(none)'}`
  );
}

// CLI only when invoked directly, so the test can import the pure parts.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((err) => {
    // Anything unforeseen also fails open: this check must never be the reason a good
    // release cannot ship.
    console.warn(`[preflight] unexpected error, continuing: ${err?.message ?? err}`);
  });
}
