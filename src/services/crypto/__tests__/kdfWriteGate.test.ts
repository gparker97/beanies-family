/**
 * The KDF write gate (ADR-041): the five floor states, the two policy helpers, and the
 * once-per-process `kdf_gate` row.
 *
 * Driven through the persisted floor in (happy-dom's) `localStorage`, exactly as
 * `fetchUpdateFloor` leaves it, so a pass says something about the shipped read path.
 * `KDF_READ_BOTH_SINCE` is pinned to `0.93` here so the cases do not move with releases.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/constants/storageKeys';

const h = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: h.logEvent }));
vi.mock('@/constants/appVersion', () => ({ APP_VERSION: '0.93', KDF_READ_BOTH_SINCE: '0.93' }));

import { KDF_PROFILES, KdfParamsError, LEGACY_ITERATIONS } from '../kdfParams';
import {
  __resetKdfWriteGateForTesting,
  isKdfUpgradeGateOpen,
  needsSecretRewrap,
  secretWriteIterations,
} from '../kdfWriteGate';

function setFloor(raw: string | null): void {
  if (raw === null) localStorage.removeItem(STORAGE_KEYS.UPDATE_FLOOR);
  else localStorage.setItem(STORAGE_KEYS.UPDATE_FLOOR, JSON.stringify(raw));
}

function gateRows() {
  return h.logEvent.mock.calls
    .map((c) => c[0] as { level: string; surface: string; message: string; context?: unknown })
    .filter((e) => e.surface === 'kdf' && e.message === 'kdf_gate');
}

beforeEach(() => {
  __resetKdfWriteGateForTesting();
  localStorage.clear();
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('isKdfUpgradeGateOpen', () => {
  it.each([
    ['no persisted floor', null, false, 'unknown'],
    ['a floor below KDF_READ_BOTH_SINCE', '0.92', false, 'closed'],
    ['a revision below it', '0.92R3', false, 'closed'],
    ['a floor equal to it', '0.93', true, 'open'],
    ['a floor equal to it, spelled with a patch', '0.93.0', true, 'open'],
    ['a floor above it', '0.94.1', true, 'open'],
    // Screened out (and removed) by `readPersistedUpdateFloor`; still fails closed.
    ['an incomparable floor', 'v0.95-beta', false, 'unknown'],
  ])('with %s is %s', (_label, floor, open, detail) => {
    setFloor(floor);
    expect(isKdfUpgradeGateOpen()).toBe(open);
    expect(gateRows()).toEqual([
      { level: 'info', surface: 'kdf', message: 'kdf_gate', context: { detail } },
    ]);
  });

  it('logs kdf_gate ONCE per process, but recomputes the verdict on every call', () => {
    setFloor('0.92');
    expect(isKdfUpgradeGateOpen()).toBe(false);
    expect(isKdfUpgradeGateOpen()).toBe(false);

    // The floor is raised mid-process (this launch's fetch landed): the verdict follows
    // immediately, the telemetry row does not repeat.
    setFloor('0.93');
    expect(isKdfUpgradeGateOpen()).toBe(true);
    expect(secretWriteIterations()).toBe(KDF_PROFILES.secret);
    expect(needsSecretRewrap({})).toBe(true);

    const rows = gateRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.context).toEqual({ detail: 'closed' });
  });

  it('the reset seam re-arms the once latch', () => {
    isKdfUpgradeGateOpen();
    __resetKdfWriteGateForTesting();
    isKdfUpgradeGateOpen();
    expect(gateRows()).toHaveLength(2);
  });
});

describe('secretWriteIterations', () => {
  it('writes legacy while the gate is closed', () => {
    setFloor('0.92');
    expect(secretWriteIterations()).toBe(LEGACY_ITERATIONS);
  });

  it('writes legacy when the floor is unknown (fail closed)', () => {
    expect(secretWriteIterations()).toBe(LEGACY_ITERATIONS);
  });

  it('writes the secret profile once the gate is open', () => {
    setFloor('0.93');
    expect(secretWriteIterations()).toBe(KDF_PROFILES.secret);
  });
});

describe('needsSecretRewrap', () => {
  describe('with the gate open', () => {
    beforeEach(() => setFloor('0.93'));

    it('rewraps a legacy record with no recorded count', () => {
      expect(needsSecretRewrap({ iterations: undefined })).toBe(true);
      expect(needsSecretRewrap({})).toBe(true);
    });

    it('rewraps a record that recorded the legacy count', () => {
      expect(needsSecretRewrap({ iterations: LEGACY_ITERATIONS })).toBe(true);
    });

    it('leaves a record already at the secret count alone', () => {
      expect(needsSecretRewrap({ iterations: KDF_PROFILES.secret })).toBe(false);
    });

    it('leaves a record above the secret count alone (a future raise is not a downgrade)', () => {
      expect(needsSecretRewrap({ iterations: KDF_PROFILES.secret * 2 })).toBe(false);
    });

    it('is false when there is no record to rewrap', () => {
      expect(needsSecretRewrap(undefined)).toBe(false);
      expect(needsSecretRewrap(null)).toBe(false);
    });

    it('lets a corrupt recorded count throw rather than guess', () => {
      expect(() => needsSecretRewrap({ iterations: 'lots' })).toThrow(KdfParamsError);
      expect(() => needsSecretRewrap({ iterations: -1 })).toThrow(KdfParamsError);
    });
  });

  it('never rewraps while the gate is closed, whatever the record says', () => {
    setFloor('0.92');
    expect(needsSecretRewrap({})).toBe(false);
    expect(needsSecretRewrap({ iterations: LEGACY_ITERATIONS })).toBe(false);
  });

  it('never rewraps while the floor is unknown', () => {
    expect(needsSecretRewrap({})).toBe(false);
  });
});
