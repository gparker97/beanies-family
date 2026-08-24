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
export const APP_VERSION = '0.9.13';
