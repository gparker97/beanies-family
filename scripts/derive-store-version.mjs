#!/usr/bin/env node
/**
 * Derive a STORE-SAFE marketing version from the app's single product version
 * (`APP_VERSION` in `src/constants/appVersion.ts`), so the App Store / Play Store
 * marketing version tracks the in-app version instead of a hardcoded `1.0.<run#>`.
 *
 * Why a transform is needed: `APP_VERSION` follows the beanies convention
 * (`0.9.4`, `0.9.4R1`, `1.0`), but iOS `CFBundleShortVersionString` must be at
 * most three dot-separated non-negative integers — `0.9.4R1` is REJECTED at
 * upload. This strips the `R<n>` revision suffix (`0.9.4R1` → `0.9.4`); the build
 * number (iOS `CFBundleVersion` / Android `versionCode`) carries per-build
 * uniqueness via the CI run number, so collapsing revisions here is correct.
 *
 * Contract (deliberately narrow + fail-loud — never a silent fallback):
 *   - `readAppVersion(fileText)` → the bare `APP_VERSION` string, or throws.
 *   - `deriveStoreVersion(raw)`  → store-safe `x[.y[.z]]`, or throws.
 *   - CLI prints ONLY the bare version to stdout; any error → stderr + exit 1,
 *     so a `set -euo pipefail` CI step fails the job rather than stamping an
 *     empty/garbage version (see .github/workflows/mobile-*-release.yml).
 *
 * Text-level parse (same technique as scripts/updateTranslations.mjs): the
 * coupling to appVersion.ts's format is intentionally simple and is guarded by a
 * real-file unit test (scripts/__tests__/derive-store-version.test.mjs) that runs
 * on every `npm run validate`, so a reformat of that file breaks CI immediately
 * rather than silently at release time in the dormant lane.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Extract the `APP_VERSION` string literal from the text of appVersion.ts.
 * Throws (never returns a fallback) if the `export const APP_VERSION = '…'`
 * line can't be found.
 *
 * @param {string} fileText
 * @returns {string}
 */
export function readAppVersion(fileText) {
  const match = /export\s+const\s+APP_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(fileText);
  if (!match) {
    throw new Error(
      "Could not find `export const APP_VERSION = '…'` in appVersion.ts — did its format change?"
    );
  }
  return match[1];
}

/**
 * Convert a beanies product version into a store-safe marketing version.
 * Strips a trailing `R<n>` revision suffix and validates the result is a
 * period-separated list of at most three non-negative integers. Throws on
 * anything else.
 *
 * @param {string} rawAppVersion
 * @returns {string}
 */
export function deriveStoreVersion(rawAppVersion) {
  if (typeof rawAppVersion !== 'string') {
    throw new Error(`APP_VERSION must be a string, got ${typeof rawAppVersion}`);
  }
  const stripped = rawAppVersion.trim().replace(/R\d+$/, '');
  if (!/^\d+(\.\d+){0,2}$/.test(stripped)) {
    throw new Error(
      `APP_VERSION '${rawAppVersion}' does not yield a store-safe marketing version ` +
        `(expected at most three dot-separated integers after stripping any R<n> suffix, got '${stripped}')`
    );
  }
  return stripped;
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const appVersionPath = path.resolve(here, '../src/constants/appVersion.ts');
  const text = fs.readFileSync(appVersionPath, 'utf8');
  const version = deriveStoreVersion(readAppVersion(text));
  // stdout carries ONLY the bare version so `$(node …)` capture is clean.
  process.stdout.write(version + '\n');
}

// Run as a CLI only when invoked directly (not when imported by the test).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main();
  } catch (error) {
    console.error(`[derive-store-version] ${error.message}`);
    process.exit(1);
  }
}
