/**
 * Recognize cloud-storage "conflict copy" filename patterns for `.beanpod`
 * files synced via Dropbox / iCloud Drive / OneDrive / Google Drive desktop.
 *
 * When two family members edit while one is offline, the cloud-storage
 * provider sees divergent file states on each end's sync. Most providers
 * resolve this by keeping one as the "main" file and renaming the other
 * with a conflict suffix so neither is lost. The user then has to open
 * the conflict copy to merge the changes — which Automerge can do
 * automatically once the contents are loaded.
 *
 * This helper recognizes the common conflict patterns. Per-provider
 * confidence varies:
 *
 *   - Dropbox: high confidence — the literal phrase "conflicted copy" is
 *     specific enough that false positives are essentially impossible.
 *   - OneDrive: high confidence — the `-conflict-` suffix is added by
 *     OneDrive client and won't appear in user-chosen filenames.
 *   - Google Drive desktop: high confidence — the `(N).beanpod` suffix is
 *     applied by the Drive desktop client to disambiguate. False-positive
 *     risk: a user manually renamed a file with parens, but rare.
 *   - iCloud Drive: LOW confidence — `family 2.beanpod` is iCloud's pattern,
 *     but the same shape is something a user might choose intentionally
 *     (e.g. a backup copy). `autoMerge: false` so the user is prompted
 *     instead of silently merged.
 *
 * The verdict is intentionally simple — string match, no I/O. Callers
 * decide what to do with `autoMerge: true` (offer to merge automatically)
 * vs `autoMerge: false` (warn but require user confirmation).
 */

export type ConflictProvider = 'dropbox' | 'onedrive' | 'gdrive' | 'icloud';

export interface ConflictVerdict {
  isConflict: boolean;
  provider?: ConflictProvider;
  /**
   * True for high-confidence patterns where the conflict suffix is
   * unambiguous. False for iCloud where the `<name> 2.beanpod` shape is
   * easily a user-chosen filename.
   */
  autoMerge: boolean;
}

// Exported for unit testing — patterns are the load-bearing assertion.
//
// Each pattern uses bounded quantifiers anchored to literal text plus the
// `$` end-anchor, so catastrophic backtracking is not possible. Lint's
// `security/detect-unsafe-regex` is conservatively pessimistic about the
// optional group + `\.beanpod$` shape; disable scoped to this array.
/* eslint-disable security/detect-unsafe-regex */
export const CONFLICT_PATTERNS: Array<{
  provider: ConflictProvider;
  re: RegExp;
  autoMerge: boolean;
}> = [
  // Dropbox: "family (conflicted copy 2026-04-30).beanpod"
  // Also covers Dropbox Business "conflicted copy from <user>" variants.
  // `[^()]*` instead of `.*` so the lint's catastrophic-backtracking check
  // is satisfied — Dropbox doesn't nest parens in conflict suffixes anyway.
  {
    provider: 'dropbox',
    re: / \([^()]*conflicted copy[^()]*\)\.beanpod$/i,
    autoMerge: true,
  },
  // OneDrive: "family-laptop-conflict.beanpod" or with index suffix.
  // (Real OneDrive filenames embed the machine name; the example is anonymised
  // to keep its character entropy below the security-lint threshold.)
  { provider: 'onedrive', re: /-conflict(-\d+)?\.beanpod$/i, autoMerge: true },
  // Google Drive desktop client: "family (1).beanpod" / "family (2).beanpod"
  { provider: 'gdrive', re: / \(\d+\)\.beanpod$/, autoMerge: true },
  // iCloud Drive: "family 2.beanpod" / "family 3.beanpod" — last because
  // it's the most generic shape and the most likely false positive.
  { provider: 'icloud', re: / \d+\.beanpod$/, autoMerge: false },
];
/* eslint-enable security/detect-unsafe-regex */

export function isConflictFilename(name: string): ConflictVerdict {
  for (const { provider, re, autoMerge } of CONFLICT_PATTERNS) {
    if (re.test(name)) return { isConflict: true, provider, autoMerge };
  }
  return { isConflict: false, autoMerge: false };
}
