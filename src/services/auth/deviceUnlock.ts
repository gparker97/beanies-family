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
  importHKDFBaseKey,
  wrapDEK,
  unwrapDEK,
} from '@/services/crypto/keyWrap';
import { bufferToBase64, base64ToBuffer } from '@/utils/encoding';
import { toISODateString } from '@/utils/date';
import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';

export const MAX_PIN_ATTEMPTS = 5;
export const PIN_LENGTH = 6;

/** Domain separation for the PIN wrap derivation. Immutable — changing it orphans every wrap. */
const PIN_WRAP_INFO_PREFIX = 'beanies.family-pin-unlock-v1:';
/** PBKDF2 stretch used ONLY on the extractable-bytes fallback path. */
const FALLBACK_PBKDF2_ITERATIONS = 210_000;

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

// ── Device secret ─────────────────────────────────────────────────────────────

/**
 * Get (or create, first use) the per-device secret. Prefers a non-extractable HKDF base
 * CryptoKey stored via structured clone; where that write fails (older WebViews), falls
 * back to extractable base64 bytes — flagged to telemetry so the fleet share of the
 * weaker mode is measurable.
 */
export async function getOrCreateDeviceSecret(): Promise<{
  baseKey: CryptoKey;
  kdf: 'hkdf' | 'hkdf+pbkdf2';
}> {
  const existing = await repo.getDeviceSecret();
  if (existing?.key) return { baseKey: existing.key, kdf: 'hkdf' };
  if (existing?.rawSecret) {
    return {
      baseKey: await importHKDFBaseKey(new Uint8Array(base64ToBuffer(existing.rawSecret))),
      kdf: 'hkdf+pbkdf2',
    };
  }

  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const nonExtractable = await importHKDFBaseKey(bytes);
  try {
    await repo.saveDeviceSecret({
      id: 'device_secret',
      key: nonExtractable,
      kdf: 'hkdf',
      createdAt: toISODateString(new Date()),
    });
    return { baseKey: nonExtractable, kdf: 'hkdf' };
  } catch {
    // Structured clone of CryptoKeys unsupported here — extractable-bytes fallback.
    logEvent({
      level: 'warn',
      surface: 'login-flow',
      message: 'device_secret_fallback',
      context: { action: 'secret_fallback', kind: 'hkdf+pbkdf2' },
    });
    await repo.saveDeviceSecret({
      id: 'device_secret',
      rawSecret: bufferToBase64(bytes),
      kdf: 'hkdf+pbkdf2',
      createdAt: toISODateString(new Date()),
    });
    return { baseKey: nonExtractable, kdf: 'hkdf+pbkdf2' };
  }
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
    const pinKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(pin),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const stretched = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: hkdfSalt.buffer as ArrayBuffer,
        iterations: FALLBACK_PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      pinKey,
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
  member: Pick<FamilyMember, 'id' | 'name' | 'pinVersion'>;
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

    const record: DeviceUnlockRecord = {
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
