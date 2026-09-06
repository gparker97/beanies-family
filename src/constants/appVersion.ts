/**
 * The human-facing PRODUCT version, bumped manually on each production release.
 *
 * Convention (increment on every prod deploy):
 *   0.9        baseline major.minor
 *   0.9.1      a release (patch increment)
 *   0.9.1R1    a revision / hotfix within a release (append R<n>)
 *   0.9.2      the next release
 *   1.0        reserved for the full public launch
 *
 * This is DISTINCT from the build marker (`getBuildVersionLabel` in
 * `diagnosticContext.ts` — a short commit SHA + build date, derived automatically
 * from the deploy). The two answer different questions:
 *   • product version — "which release is this?" (human-chosen, marketing-facing)
 *   • build marker     — "which exact build is running?" (matches the `Build:`
 *                        field in #beanies-errors, for pinning a Slack alert)
 *
 * The sidebar shows just the product version; the Settings "about" footer shows the
 * product version AND the build marker (see `getProductVersionLabel` /
 * `getFullVersionLabel`). Bump this constant as the first step of a prod release so
 * the shown version never goes stale the way the old hardcoded "v1.0.0 - MVP" did.
 */
// ⚠️ AN `R<n>` SUFFIX CANNOT REACH THE APP STORE TWICE WITHIN ONE BASE VERSION.
//
// `scripts/derive-store-version.mjs` strips `R<n>` because iOS
// `CFBundleShortVersionString` must be at most three dot-separated integers — so `0.15`,
// `0.15R1`, `0.15R2` and `0.15R3` are all the SAME version number to Apple. The 0.15R3
// release failed at upload with "The version number has been previously used" because 0.15
// was already taken, and no retry could have fixed it.
//
// The web and Play accept any `R<n>` freely (Play keys on `versionCode`), so an R revision is
// fine for a web-only or Play-only ship. **If a release is going to the App Store, use a new
// numeric version** (`0.15.1`, not `0.15R3`).
// ⚠️ BUMPING THIS DOES NOT ASK ANYONE TO UPDATE. The native update prompt reads a
// separate floor, `web/public/min-app-version.json`, which is deployed by hand and
// deliberately lags this constant: a normal release does not raise it. Raise it only
// when there is a reason everyone should move.
// See `docs/runbooks/native-store-submission.md` § 7. Raising the update floor.
export const APP_VERSION = '0.16';
