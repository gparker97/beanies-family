import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { webcrypto } from 'node:crypto';

const logEvent = vi.fn();
vi.mock('@/services/telemetry/logEvent', () => ({
  logEvent: (...args: unknown[]) => logEvent(...args),
}));
const reportError = vi.fn();
vi.mock('@/utils/errorReporter', () => ({
  reportError: (...args: unknown[]) => reportError(...args),
}));

import {
  enrollPinUnlock,
  unlockWithPin,
  listPinUnlocks,
  removePinUnlocksForFamily,
  removeAllPinUnlocks,
  getPinUnlockRecord,
  isValidPin,
  MAX_PIN_ATTEMPTS,
} from '@/services/auth/deviceUnlock';
import { generateFamilyKey, exportFamilyKey } from '@/services/crypto/familyKeyService';

// happy-dom's crypto lacks subtle in some configs — pin to node's webcrypto.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

const member = { id: 'm-1', name: 'Mum', pinVersion: 1 };

describe('deviceUnlock', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await removeAllPinUnlocks();
  });

  it('isValidPin: exactly 6 digits', () => {
    expect(isValidPin('123456')).toBe(true);
    expect(isValidPin('12345')).toBe(false);
    expect(isValidPin('1234567')).toBe(false);
    expect(isValidPin('12345a')).toBe(false);
  });

  it('enrol → unlock round-trips the family key', async () => {
    const fk = await generateFamilyKey();
    const enrolled = await enrollPinUnlock({
      familyId: 'fam-1',
      member,
      pin: '123456',
      familyKey: fk,
      keyId: 'key-1',
    });
    expect(enrolled.success).toBe(true);

    const result = await unlockWithPin({ familyId: 'fam-1', memberId: 'm-1', pin: '123456' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Same raw key bytes back
      expect(await exportFamilyKey(result.familyKey)).toEqual(await exportFamilyKey(fk));
      expect(result.record.memberName).toBe('Mum');
    }
  });

  it('wrong PIN counts down and persists; correct PIN resets the counter', async () => {
    const fk = await generateFamilyKey();
    await enrollPinUnlock({ familyId: 'fam-1', member, pin: '123456', familyKey: fk, keyId: 'k' });

    const bad = await unlockWithPin({ familyId: 'fam-1', memberId: 'm-1', pin: '000000' });
    expect(bad).toMatchObject({
      ok: false,
      reason: 'wrong-pin',
      attemptsLeft: MAX_PIN_ATTEMPTS - 1,
    });
    // Persisted BEFORE returning — a fresh read sees it (refresh-proof lockout).
    expect((await getPinUnlockRecord('fam-1', 'm-1'))!.failCount).toBe(1);

    const good = await unlockWithPin({ familyId: 'fam-1', memberId: 'm-1', pin: '123456' });
    expect(good.ok).toBe(true);
    expect((await getPinUnlockRecord('fam-1', 'm-1'))!.failCount).toBe(0);
  });

  it(`destroys the wrap after ${MAX_PIN_ATTEMPTS} failures`, async () => {
    const fk = await generateFamilyKey();
    await enrollPinUnlock({ familyId: 'fam-1', member, pin: '123456', familyKey: fk, keyId: 'k' });

    for (let i = 1; i < MAX_PIN_ATTEMPTS; i++) {
      const r = await unlockWithPin({ familyId: 'fam-1', memberId: 'm-1', pin: '999999' });
      expect(r).toMatchObject({ ok: false, reason: 'wrong-pin' });
    }
    const last = await unlockWithPin({ familyId: 'fam-1', memberId: 'm-1', pin: '999999' });
    expect(last).toMatchObject({ ok: false, reason: 'destroyed' });
    expect(await getPinUnlockRecord('fam-1', 'm-1')).toBeUndefined();
    // Even the RIGHT pin is now a bootstrap case.
    const after = await unlockWithPin({ familyId: 'fam-1', memberId: 'm-1', pin: '123456' });
    expect(after).toMatchObject({ ok: false, reason: 'no-record' });
  });

  it('keyId mismatch fails closed and clears the record (#117 hook)', async () => {
    const fk = await generateFamilyKey();
    await enrollPinUnlock({
      familyId: 'fam-1',
      member,
      pin: '123456',
      familyKey: fk,
      keyId: 'old',
    });
    const r = await unlockWithPin({
      familyId: 'fam-1',
      memberId: 'm-1',
      pin: '123456',
      expectedKeyId: 'rotated',
    });
    expect(r).toMatchObject({ ok: false, reason: 'no-record' });
    expect(await getPinUnlockRecord('fam-1', 'm-1')).toBeUndefined();
  });

  it('family lifecycle: list + remove-for-family', async () => {
    const fk = await generateFamilyKey();
    await enrollPinUnlock({ familyId: 'fam-1', member, pin: '111111', familyKey: fk, keyId: 'k' });
    await enrollPinUnlock({
      familyId: 'fam-1',
      member: { id: 'm-2', name: 'Kid', pinVersion: 1 },
      pin: '222222',
      familyKey: fk,
      keyId: 'k',
    });
    await enrollPinUnlock({
      familyId: 'fam-2',
      member,
      pin: '333333',
      familyKey: fk,
      keyId: 'k',
    });

    expect((await listPinUnlocks('fam-1')).map((r) => r.memberId).sort()).toEqual(['m-1', 'm-2']);
    await removePinUnlocksForFamily('fam-1');
    expect(await listPinUnlocks('fam-1')).toHaveLength(0);
    expect(await listPinUnlocks('fam-2')).toHaveLength(1);
  });

  it('two members on one device use independent PINs', async () => {
    const fk = await generateFamilyKey();
    await enrollPinUnlock({ familyId: 'fam-1', member, pin: '111111', familyKey: fk, keyId: 'k' });
    await enrollPinUnlock({
      familyId: 'fam-1',
      member: { id: 'm-2', name: 'Kid', pinVersion: 1 },
      pin: '222222',
      familyKey: fk,
      keyId: 'k',
    });
    // Each other's PIN does NOT cross-unlock.
    expect((await unlockWithPin({ familyId: 'fam-1', memberId: 'm-1', pin: '222222' })).ok).toBe(
      false
    );
    expect((await unlockWithPin({ familyId: 'fam-1', memberId: 'm-2', pin: '222222' })).ok).toBe(
      true
    );
  });
});
