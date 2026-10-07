/**
 * PIN device-unlock (Phase 2 of the 2026-08-28 login rethink).
 *
 * A member's family key, AES-KW-wrapped under HKDF(deviceSecret, salt, info=PIN·v1).
 * The device secret is a per-device 256-bit random key that NEVER leaves this device,
 * so the wrap is useless to anyone holding only the Drive file — the file's
 * brute-force resistance is untouched by the 10⁶ PIN space. The PIN itself is the
 * family-wide identity secret (hash inside the encrypted doc, see FamilyMember.pinHash);
 * this module only concerns the DEVICE side: turning that PIN into the family key here.
 *
 * Binding rules from the plan (docs/plans/2026-08-28-login-auth-rethink-pin-recovery-kit.md):
 *  - SINGLE WRITER: every `failCount` write and the destroy-at-limit live in this module,
 *    never inline in views or the flow driver.
 *  - Lockout is crash/refresh-proof: the failure count is persisted (awaited) BEFORE the
 *    caller renders anything — closing the tab between attempts cannot reset it.
 *  - MAX_PIN_ATTEMPTS failures destroy the wrap (fall back to bootstrap/recovery). No
 *    tamper-proof pretense: an attacker who can edit the counter can read the blob.
 *  - `keyId` is stamped so #117 key rotation invalidates every device wrap fail-closed.
 *  - The device secret is a NON-EXTRACTABLE HKDF base CryptoKey where structured clone
 *    supports it; the extractable-bytes fallback additionally stretches the PIN with
 *    PBKDF2 and is flagged in telemetry.
 */

import type { DeviceUnlockRecord, FamilyMember } from '@/types/models';
import {
  deviceUnlockId,
  getDeviceUnlock,
  listDeviceUnlocksForFamily,
  saveDeviceUnlock,
  deleteDeviceUnlock,
} from '@/services/indexeddb/repositories/deviceUnlockRepository';
import * as repo from '@/services/indexeddb/repositories/deviceUnlockRepository';
import {
  deriveWrappingKeyFromBaseKey,
  generateHKDFSalt,
  wrapDEK,
  unwrapDEK,
} from '@/services/crypto/keyWrap';
import { getOrCreateDeviceSecret } from '@/services/auth/deviceSecret';
import { KDF_PROFILES, derivePbkdf2Bits } from '@/services/crypto/kdfParams';
import { bufferToBase64, base64ToBuffer } from '@/utils/encoding';
import { toISODateString } from '@/utils/date';
import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';

export const MAX_PIN_ATTEMPTS = 5;
export const PIN_LENGTH = 6;

/** Domain separation for the PIN wrap derivation. Immutable — changing it orphans every wrap. */
const PIN_WRAP_INFO_PREFIX = 'beanies.family-pin-unlock-v1:';

export type PinUnlockResult =
  | { ok: true; familyKey: CryptoKey; record: DeviceUnlockRecord }
  | {
      ok: false;
      reason: 'no-record' | 'wrong-pin' | 'destroyed' | 'error';
      /** Remaining attempts before destroy (present on 'wrong-pin'). */
      attemptsLeft?: number;
    };

export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}

/**
 * A device unlock record as stored, with the C10 value fence beside the version fence.
 * `pinHashFp` is absent on records enrolled before it existed (the version alone decides
 * for those). Local to this module so the shared model type stays unchanged.
 */
export type DeviceUnlockRecordWithFp = DeviceUnlockRecord & { pinHashFp?: string };

/**
 * A short fingerprint of a member's doc-side `pinHash` (C10, the pinVersion fence).
 *
 * `pinVersion` is a scalar two devices can both bump to the SAME number while setting
 * DIFFERENT PINs (each reads n, each writes n+1, last writer wins the hash). A wrap made on
 * the losing device then matches the doc's version but not its PIN, and the "changed
 * elsewhere" check stayed silent. Comparing the value too closes it: different hashes are
 * different fingerprints whatever the version says.
 *
 * 64 bits of SHA-256 over the stored hash string. Not secret-bearing on its own: the hash
 * it is derived from is salted PBKDF2, and the salt lives inside the encrypted doc.
 */
export async function pinHashFingerprint(pinHash: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pinHash));
  return Array.from(new Uint8Array(digest).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Was this device's wrap made for a PIN the doc no longer holds? True when the version
 * differs, or (when both sides carry one) when the hash fingerprint differs. A record or a
 * member with no fingerprint input falls back to the version alone.
 */
export async function pinWrapIsStale(
  record: Pick<DeviceUnlockRecordWithFp, 'pinVersion' | 'pinHashFp'>,
  live: Pick<FamilyMember, 'pinVersion' | 'pinHash'>
): Promise<boolean> {
  if (live.pinVersion && record.pinVersion !== live.pinVersion) return true;
  if (!record.pinHashFp || !live.pinHash) return false;
  return record.pinHashFp !== (await pinHashFingerprint(live.pinHash));
}

/**
 * Derive the AES-KW wrap key for a PIN. On the fallback path the PIN is first stretched
 * with PBKDF2 (the extractable secret bytes make offline grinding cheaper, so the PIN
 * side gets the extra work); the HKDF `info` then carries the stretched value.
 */
async function deriveWrapKeyForPin(
  pin: string,
  hkdfSalt: Uint8Array,
  baseKey: CryptoKey,
  kdf: 'hkdf' | 'hkdf+pbkdf2'
): Promise<CryptoKey> {
  let pinComponent = pin;
  if (kdf === 'hkdf+pbkdf2') {
    // Profile `deviceFallback`, used ONLY on the extractable-bytes fallback path.
    const stretched = await derivePbkdf2Bits(
      new TextEncoder().encode(pin),
      hkdfSalt,
      { profile: 'deviceFallback', iterations: KDF_PROFILES.deviceFallback },
      256
    );
    pinComponent = bufferToBase64(stretched);
  }
  return deriveWrappingKeyFromBaseKey(baseKey, hkdfSalt, PIN_WRAP_INFO_PREFIX + pinComponent);
}

// ── Enrolment ─────────────────────────────────────────────────────────────────

/**
 * Create (or replace) this device's PIN wrap for a member. The caller has already
 * verified the PIN against the doc-side hash (or just set it) — this module never
 * decides identity, it only stores the device-side material.
 */
export async function enrollPinUnlock(params: {
  familyId: string;
  /**
   * `pinHash` (C10): the doc-side hash this wrap is made against, fingerprinted beside the
   * version so a same-version change on another device is still detected. Optional only
   * for callers that do not hold it; they get the version fence alone.
   */
  member: Pick<FamilyMember, 'id' | 'name' | 'pinVersion'> & { pinHash?: string };
  pin: string;
  familyKey: CryptoKey;
  /** Envelope keyId at wrap time (#117 rotation hook). */
  keyId: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { baseKey, kdf } = await getOrCreateDeviceSecret();
    const hkdfSalt = generateHKDFSalt();
    const wrapKey = await deriveWrapKeyForPin(params.pin, hkdfSalt, baseKey, kdf);
    const wrappedFK = await wrapDEK(params.familyKey, wrapKey);

    const record: DeviceUnlockRecordWithFp = {
      id: deviceUnlockId(params.familyId, params.member.id),
      familyId: params.familyId,
      memberId: params.member.id,
      memberName: params.member.name,
      wrappedFK,
      hkdfSalt: bufferToBase64(hkdfSalt),
      keyId: params.keyId,
      pinVersion: params.member.pinVersion ?? 1,
      failCount: 0,
      kdf,
      createdAt: toISODateString(new Date()),
      ...(params.member.pinHash
        ? { pinHashFp: await pinHashFingerprint(params.member.pinHash) }
        : {}),
    };
    await saveDeviceUnlock(record);
    logEvent({
      level: 'info',
      surface: 'login-flow',
      message: 'pin_enroll',
      context: { action: 'enrolled', kind: kdf },
    });
    return { success: true };
  } catch (e) {
    reportError({
      surface: 'login-flow',
      message: 'PIN device-unlock enrolment failed',
      error: e,
      severity: 'warning',
      context: { action: 'enroll_failed' },
    });
    return { success: false, error: e instanceof Error ? e.message : 'enroll failed' };
  }
}

// ── Unlock ────────────────────────────────────────────────────────────────────

/**
 * Attempt a PIN unlock. On a wrong PIN the failure count is persisted BEFORE returning
 * (crash/refresh-proof); at MAX_PIN_ATTEMPTS the wrap is destroyed and only
 * bootstrap/recovery paths remain. `expectedKeyId` (the current envelope keyId, when the
 * caller holds one) makes #117 rotation fail closed: a rotated key destroys the record
 * rather than yielding a stale FK.
 */
export async function unlockWithPin(params: {
  familyId: string;
  memberId: string;
  pin: string;
  expectedKeyId?: string;
}): Promise<PinUnlockResult> {
  try {
    const record = await getDeviceUnlock(params.familyId, params.memberId);
    if (!record) return { ok: false, reason: 'no-record' };

    if (params.expectedKeyId && record.keyId !== params.expectedKeyId) {
      // The family key was rotated since this wrap was made — the wrap is dead by
      // design. Fail closed and clear it (a stale FK must never decrypt new data).
      await deleteDeviceUnlock(params.familyId, params.memberId);
      logEvent({
        level: 'warn',
        surface: 'login-flow',
        message: 'pin_wrap_invalidated',
        context: { action: 'keyid_mismatch' },
      });
      return { ok: false, reason: 'no-record' };
    }

    const { baseKey } = await getOrCreateDeviceSecret();
    const hkdfSalt = new Uint8Array(base64ToBuffer(record.hkdfSalt));
    const wrapKey = await deriveWrapKeyForPin(params.pin, hkdfSalt, baseKey, record.kdf);

    let familyKey: CryptoKey;
    try {
      // Extractable: the FK must be re-wrappable (self-heals, future enrolments) —
      // matches familyKeyService.unwrapFamilyKey's deliberate choice.
      familyKey = await unwrapDEK(record.wrappedFK, wrapKey, true);
    } catch {
      // Wrong PIN (AES-KW integrity check failed). Persist the count FIRST.
      const failCount = record.failCount + 1;
      if (failCount >= MAX_PIN_ATTEMPTS) {
        await deleteDeviceUnlock(params.familyId, params.memberId);
        logEvent({
          level: 'warn',
          surface: 'login-flow',
          message: 'pin_lockout_destroyed',
          context: { action: 'destroyed' },
        });
        return { ok: false, reason: 'destroyed' };
      }
      await saveDeviceUnlock({ ...record, failCount });
      return { ok: false, reason: 'wrong-pin', attemptsLeft: MAX_PIN_ATTEMPTS - failCount };
    }

    // Success resets the counter (any successful unlock, per the plan).
    if (record.failCount !== 0) {
      await saveDeviceUnlock({ ...record, failCount: 0 });
    }
    return { ok: true, familyKey, record };
  } catch (e) {
    reportError({
      surface: 'login-flow',
      message: 'PIN unlock threw',
      error: e,
      severity: 'warning',
      context: { action: 'unlock_error' },
    });
    return { ok: false, reason: 'error' };
  }
}

// ── Queries / lifecycle (thin passthroughs so callers never touch the repo) ──

export { deviceUnlockId };

export async function getPinUnlockRecord(
  familyId: string,
  memberId: string
): Promise<DeviceUnlockRecord | undefined> {
  return getDeviceUnlock(familyId, memberId);
}

export async function listPinUnlocks(familyId: string): Promise<DeviceUnlockRecord[]> {
  return listDeviceUnlocksForFamily(familyId);
}

export async function removePinUnlock(familyId: string, memberId: string): Promise<void> {
  await deleteDeviceUnlock(familyId, memberId);
}

export async function removePinUnlocksForFamily(familyId: string): Promise<void> {
  await repo.deleteDeviceUnlocksForFamily(familyId);
}

export async function removeAllPinUnlocks(): Promise<void> {
  await repo.clearAllDeviceUnlocks();
}
