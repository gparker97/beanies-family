/**
 * `KDF_READ_BOTH_SINCE` (ADR-041, #81).
 *
 * The durable invariant: the gate constant can never name a version EARLIER than the
 * first build that reads recorded KDF parameters (0.93). Earlier would open the 600k
 * upgrade for builds that cannot read the result. Later only delays the upgrade, and the
 * release step that bumps `APP_VERSION` sets the constant equal to it (runbook §7).
 */
import { describe, expect, it } from 'vitest';
import { APP_VERSION, KDF_READ_BOTH_SINCE, SCALAR_READ_SINCE } from '../appVersion';
import { compareAppVersions, isComparableVersion } from '@/utils/compareAppVersions';

/** The first release whose readers honour `iterations` on every wrap. Never lower this. */
const FIRST_READ_BOTH_RELEASE = '0.93';

describe('KDF_READ_BOTH_SINCE', () => {
  it('is a comparable version (no `R` suffix games, no typo)', () => {
    expect(isComparableVersion(KDF_READ_BOTH_SINCE)).toBe(true);
    expect(isComparableVersion(APP_VERSION)).toBe(true);
  });

  it('never names a version before the first read-both release', () => {
    expect(compareAppVersions(KDF_READ_BOTH_SINCE, FIRST_READ_BOTH_RELEASE)).not.toBe(-1);
  });
});

/** The #124 readers build. Never lower SCALAR_READ_SINCE below it. */
const FIRST_SCALAR_READ_RELEASE = '1.0.3';

describe('SCALAR_READ_SINCE', () => {
  it('is a comparable version', () => {
    expect(isComparableVersion(SCALAR_READ_SINCE)).toBe(true);
  });

  it('never names a version before the first scalar-reading release', () => {
    expect(compareAppVersions(SCALAR_READ_SINCE, FIRST_SCALAR_READ_RELEASE)).not.toBe(-1);
  });

  it('never names a version AHEAD of the build that carries the readers', () => {
    // The floor guard keys off this number. If it named a future version, a floor raise to
    // that version for an unrelated reason would open the writer on a fleet whose clients
    // below it lack the readers. The constant is set at the bump, never ahead of it.
    expect(compareAppVersions(APP_VERSION, SCALAR_READ_SINCE)).not.toBe(-1);
  });
});
