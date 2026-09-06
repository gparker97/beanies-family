/**
 * Compare two beanies PRODUCT versions (`APP_VERSION`), not store versions.
 *
 * ⚠️ PRODUCT, NOT STORE. `scripts/derive-store-version.mjs` strips the `R<n>`
 * revision suffix so iOS will accept the value, which makes `0.15R2` and `0.15`
 * the SAME string to the stores. They are not the same build, and anything
 * deciding "is this device behind" has to be able to tell them apart.
 *
 * The whole grammar, written once and shared with `isComparableVersion` so the
 * shape check and the comparison cannot drift into two regexes that disagree:
 * up to three dot-separated integers, optionally followed by `R` and an
 * integer. A missing field counts as zero, so `0.16` and `0.16.0` are equal.
 */

/**
 * `0.16`, `0.16.1`, `0.15R2`. Anchored; a trailing or leading anything fails.
 *
 * `security/detect-unsafe-regex` flags this and is wrong here, the same way it
 * is wrong about `beanpodFilename.ts`. Catastrophic backtracking needs two
 * quantifiers that can match the SAME character; every group below is separated
 * by a literal `.` or `R`, so a digit belongs to exactly one group and there is
 * nothing to backtrack over. Matching is linear in the input, which is at most a
 * short version string from a file we deploy.
 */
// eslint-disable-next-line security/detect-unsafe-regex
const VERSION_RE = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:R(\d+))?$/;

/** Is this string something `compareAppVersions` can decide about? */
export function isComparableVersion(s: string): boolean {
  return VERSION_RE.test(s.trim());
}

/**
 * `-1` when `a` is older than `b`, `1` when newer, `0` when equal, and **`null`
 * when it cannot be decided** because either side is not version-shaped.
 *
 * ⚠️ `null`, NEVER A NUMERIC SENTINEL, and never a throw.
 *
 * A sentinel like `0` would read as "equal" at a glance, so a typo reaching the
 * hand-edited static floor would silently mean "this device is fine" instead of
 * "we do not know". Under `strict: true` a nullable return forces every caller
 * to say what it does about the undecidable case, at the type level.
 *
 * And it must not throw: this is called with a string from a file a human edits
 * by hand and deploys, so a throw would turn a typo into a crash on every
 * device that fetched it.
 */
export function compareAppVersions(a: string, b: string): -1 | 0 | 1 | null {
  const left = VERSION_RE.exec(a.trim());
  const right = VERSION_RE.exec(b.trim());
  if (!left || !right) return null;

  // Groups 1-4: major, minor, patch, revision. `?? '0'` is what makes a missing
  // field zero, so `0.16` === `0.16.0` and `0.15` < `0.15R1`.
  for (let i = 1; i <= 4; i++) {
    const l = Number(left[i] ?? '0');
    const r = Number(right[i] ?? '0');
    if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}
