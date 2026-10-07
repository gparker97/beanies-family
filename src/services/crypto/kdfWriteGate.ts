/**
 * The KDF write gate (ADR-041, #81): when may a `secret`-profile wrap be written at the
 * new cost?
 *
 * Readers always honour the count a record carries, but a pre-`KDF_READ_BOTH_SINCE`
 * client derives at `LEGACY_ITERATIONS` regardless. Meeting a 600k member wrap it cannot
 * unwrap, it HEALS it back down (`healStaleWrappedKey`); meeting a 600k passphrase wrap,
 * it refuses the passphrase. So new-cost writes wait until the fleet has been asked to be
 * on a read-both build: the gate is open only once the update floor
 * (`promptBelowVersion`, persisted by `fetchUpdateFloor`) is at or above
 * `KDF_READ_BOTH_SINCE`.
 *
 * ⚠️ FAIL CLOSED. No persisted floor, or one that cannot be compared, is "closed": the
 * cost of closed is staying at today's count; the cost of open-too-early is a ping-pong
 * with old clients. The verdict is recomputed from the persisted floor on every call and
 * never persisted itself, and a stale floor only ever lags upward ("closed longer").
 *
 * Applies only to `secret`-profile writes (`wrappedKeys`, `recoveryPassphrase`).
 * `docHash`, `highEntropy` and `deviceFallback` writers read `KDF_PROFILES` directly.
 *
 * Pure and synchronous: imports no store and no Capacitor.
 */
import { KDF_PROFILES, LEGACY_ITERATIONS, recordedIterations } from './kdfParams';
import { readPersistedUpdateFloor } from '@/services/appUpdate/updateFloorStore';
import { compareAppVersions } from '@/utils/compareAppVersions';
import { KDF_READ_BOTH_SINCE } from '@/constants/appVersion';
import { logEvent } from '@/services/telemetry/logEvent';

type GateDetail = 'open' | 'closed' | 'unknown';

/** The `kdf_gate` row is one per process: the first evaluation's verdict. */
let gateLogged = false;

/** Test seam only: forget the once-per-process latch so each case starts clean. */
export function __resetKdfWriteGateForTesting(): void {
  gateLogged = false;
}

function evaluate(): GateDetail {
  const floor = readPersistedUpdateFloor();
  if (floor === null) return 'unknown';
  // `null` (undecidable) is closed. `readPersistedUpdateFloor` already screens the
  // floor, so reaching `null` here means the constant itself does not parse.
  const order = compareAppVersions(floor, KDF_READ_BOTH_SINCE);
  if (order === null) return 'unknown';
  return order >= 0 ? 'open' : 'closed';
}

/**
 * Is the fleet floor at or above `KDF_READ_BOTH_SINCE`? `false` whenever that cannot be
 * established (`detail: 'unknown'` in telemetry).
 */
export function isKdfUpgradeGateOpen(): boolean {
  const detail = evaluate();
  if (!gateLogged) {
    gateLogged = true;
    logEvent({ level: 'info', surface: 'kdf', message: 'kdf_gate', context: { detail } });
  }
  return detail === 'open';
}

/** The iteration count a NEW `secret`-profile wrap is written with. */
export function secretWriteIterations(): number {
  return isKdfUpgradeGateOpen() ? KDF_PROFILES.secret : LEGACY_ITERATIONS;
}

/**
 * Should this existing `secret`-profile wrap be re-written at the new cost? Only when it
 * exists, the gate is open, and it was made with fewer than `KDF_PROFILES.secret`.
 *
 * ⚠️ A `KdfParamsError` from `recordedIterations` (a corrupt recorded count) PROPAGATES:
 * the caller's unwrap has already classified that record, and guessing here would hide it.
 */
export function needsSecretRewrap(record: { iterations?: unknown } | undefined | null): boolean {
  if (!record) return false;
  if (!isKdfUpgradeGateOpen()) return false;
  return recordedIterations(record) < KDF_PROFILES.secret;
}
