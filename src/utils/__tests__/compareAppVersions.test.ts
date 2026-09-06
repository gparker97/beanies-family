/**
 * The version comparison the update floor rests on.
 *
 * Two regressions are pinned here, and both have bitten this class of code
 * before: a string compare (which makes `0.9` newer than `0.16`, so a whole
 * fleet reads as up to date), and a throw on malformed input (which turns a
 * typo in a hand-edited, hand-deployed static file into a crash on every device
 * that fetched it).
 */
import { describe, it, expect } from 'vitest';
import { compareAppVersions, isComparableVersion } from '../compareAppVersions';

describe('compareAppVersions', () => {
  it('orders by number, not by string', () => {
    // ⚠️ THE STRING-COMPARE PIN. `'0.9' > '0.16'` lexically, so a naive compare
    // reports every 0.9 device as ahead of the floor and nobody is ever
    // prompted. This ordering is the whole point of the function existing.
    expect(compareAppVersions('0.9', '0.16')).toBe(-1);
    expect(compareAppVersions('0.16', '0.9')).toBe(1);
    expect(compareAppVersions('0.16', '0.16.1')).toBe(-1);
    expect(compareAppVersions('0.16.1', '0.17')).toBe(-1);
    expect(compareAppVersions('1.0', '0.99')).toBe(1);
  });

  it('orders a revision after the version it revises', () => {
    // The stores cannot tell these apart (`derive-store-version.mjs` strips the
    // suffix), which is exactly why the floor compares product versions.
    expect(compareAppVersions('0.15', '0.15R1')).toBe(-1);
    expect(compareAppVersions('0.15R1', '0.15R2')).toBe(-1);
    expect(compareAppVersions('0.15R2', '0.16')).toBe(-1);
  });

  it('treats a missing field as zero, so 0.16 and 0.16.0 are the same build', () => {
    expect(compareAppVersions('0.16', '0.16.0')).toBe(0);
    expect(compareAppVersions('0.16.0.0' as string, '0.16')).toBeNull(); // four dots is not the grammar
    expect(compareAppVersions('0.16', '0.16')).toBe(0);
    expect(compareAppVersions('2', '2.0.0')).toBe(0);
  });

  it('tolerates surrounding whitespace, because a hand-edited file will have it', () => {
    expect(compareAppVersions(' 0.16 ', '0.16')).toBe(0);
    expect(isComparableVersion('  0.15R2  ')).toBe(true);
  });

  it('returns null rather than throwing on anything it cannot decide', () => {
    // ⚠️ THE NO-THROW PIN. Every one of these is a plausible typo in the static
    // floor file. None may crash the app, and none may quietly read as "equal".
    for (const bad of ['', 'v0.16', '0.16-beta', 'latest', '0.x', '16.0.0.1', 'R2', '0.16R']) {
      expect(compareAppVersions(bad, '0.16'), bad).toBeNull();
      expect(compareAppVersions('0.16', bad), bad).toBeNull();
      expect(isComparableVersion(bad), bad).toBe(false);
    }
  });

  it('refuses a padded field rather than silently reading it as another version', () => {
    // ⚠️ WRONG, NOT UNDECIDED, which is the worse failure. `'0.09'` used to
    // parse as major 0 minor 9 and compare EQUAL to `'0.9'`, so a leading zero
    // typed into a hand-edited, hand-deployed file would have moved the floor
    // silently rather than being ignored.
    expect(compareAppVersions('0.09', '0.9')).toBeNull();
    expect(compareAppVersions('0.016', '0.16')).toBeNull();
    expect(isComparableVersion('01')).toBe(false);
    // A bare zero is still a number.
    expect(compareAppVersions('0.0', '0')).toBe(0);
  });

  it('refuses a field too long to compare exactly', () => {
    // Past 2^53 two different versions compare equal, which is the same class
    // of confident-and-wrong. Six digits per field is far beyond anything this
    // app can produce and well inside the exact range.
    expect(compareAppVersions('9007199254740993', '9007199254740992')).toBeNull();
    expect(compareAppVersions('1234567', '1')).toBeNull();
    expect(compareAppVersions('999999.999999', '1')).toBe(1);
  });

  it('still accepts every version this app can actually produce', () => {
    // The tightening must not reject the real thing. `APP_VERSION`'s stated
    // convention, plus the shapes a future release can take.
    for (const v of ['0.16', '1.0', '10.0', '0.16.1', '0.16.10', '0.15R2', '0.15R10', '0.9.4R1']) {
      expect(isComparableVersion(v), v).toBe(true);
    }
  });

  it('agrees with isComparableVersion on the same inputs', () => {
    // One regex, shared. If these ever disagree, the floor's shape check and
    // the comparison have drifted apart and one of them is lying.
    for (const s of ['0.16', '0.16.1', '0.15R2', '1', 'v1', '', 'nope']) {
      expect(compareAppVersions(s, '0.16') !== null, s).toBe(isComparableVersion(s));
    }
  });
});
