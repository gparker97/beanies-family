/**
 * Trusted-device auto-open wraps (Phase 4 of the 2026-08-28 login rethink) — the
 * replacement for the plaintext `cachedFamilyKeys` store (#77 route 2).
 *
 * The family key is AES-KW-wrapped under
 * `HKDF(deviceSecret, salt, info='beanies.family-trusted-auto-open-v1')` and stored
 * per family in the registry's `trustedAutoOpen` store. There is deliberately NO
 * user secret in the derivation: this is a TRUST wrap whose whole purpose is a
 * silent open on a trusted device. The win over plaintext is at-rest only — a
 * registry-DB dump no longer yields the FK without also executing code in the
 * origin (the device secret is a non-extractable CryptoKey where the platform
 * allows; the extractable-bytes fallback is flagged in telemetry by deviceUnlock).
 *
 * Reuses `keyWrap.ts` + the SAME per-device secret the PIN wraps use
 * (`getOrCreateDeviceSecret`) — one secret, two info-domains.
 *
 * Honest threat model (same as the PIN wrap's): profile malware/XSS running in the
 * origin remains game-over, exactly as it was with the plaintext cache.
 */

import type { TrustedAutoOpenRecord } from '@/types/models';
import { getRegistryDatabase } from '@/services/indexeddb/registryDatabase';
import { getOrCreateDeviceSecret } from '@/services/auth/deviceUnlock';
import {
  deriveWrappingKeyFromBaseKey,
  generateHKDFSalt,
  wrapDEK,
  unwrapDEK,
} from '@/services/crypto/keyWrap';
import { bufferToBase64, base64ToBuffer } from '@/utils/encoding';
import { importFamilyKey } from '@/services/crypto/familyKeyService';
import { toISODateString } from '@/utils/date';
import { reportError } from '@/utils/errorReporter';

/** Domain separation vs the PIN wraps. Immutable — changing it orphans every wrap. */
const AUTO_OPEN_INFO = 'beanies.family-trusted-auto-open-v1';

async function deriveAutoOpenKey(salt: Uint8Array): Promise<CryptoKey> {
  const { baseKey } = await getOrCreateDeviceSecret();
  return deriveWrappingKeyFromBaseKey(baseKey, salt, AUTO_OPEN_INFO);
}

/**
 * Wrap + store the family key (base64 exported raw — the wire format every caller
 * already holds) for silent trusted-device open. Replaces any prior entry. The
 * b64↔CryptoKey conversion lives HERE so the settings store stays crypto-free.
 */
export async function saveTrustedAutoOpenKey(
  familyId: string,
  exportedKeyB64: string
): Promise<void> {
  const familyKey = await importFamilyKey(new Uint8Array(base64ToBuffer(exportedKeyB64)));
  const salt = generateHKDFSalt();
  const wrapKey = await deriveAutoOpenKey(salt);
  const wrapped = await wrapDEK(familyKey, wrapKey);
  const { kdf } = await getOrCreateDeviceSecret();
  const record: TrustedAutoOpenRecord = {
    familyId,
    wrapped,
    salt: bufferToBase64(salt.buffer as ArrayBuffer),
    kdf,
    createdAt: toISODateString(new Date()),
  };
  const db = await getRegistryDatabase();
  await db.put('trustedAutoOpen', record);
}

/**
 * Unwrap this device's auto-open family key for a family (returned as base64
 * exported raw, the wire format the decrypt paths consume), or null when none is
 * stored (or the wrap no longer unwraps — a corrupt/foreign record is deleted so
 * it cannot permanently poison the silent-open path).
 */
export async function loadTrustedAutoOpenKey(familyId: string): Promise<string | null> {
  const db = await getRegistryDatabase();
  const record = await db.get('trustedAutoOpen', familyId);
  if (!record) return null;
  try {
    const salt = new Uint8Array(base64ToBuffer(record.salt));
    const wrapKey = await deriveAutoOpenKey(salt);
    const fk = await unwrapDEK(record.wrapped, wrapKey, true);
    const raw = await crypto.subtle.exportKey('raw', fk);
    return bufferToBase64(raw);
  } catch (e) {
    // Unwrap failure = the record is unusable on this device (secret rotated,
    // corrupt row). Delete it — callers degrade to the normal prove path.
    reportError({
      surface: 'login-flow',
      message: 'trusted auto-open unwrap failed — record removed',
      error: e,
      severity: 'warning',
      context: { action: 'auto_open_unwrap_failed' },
    });
    await db.delete('trustedAutoOpen', familyId).catch(() => {});
    return null;
  }
}

export async function hasTrustedAutoOpenKey(familyId: string): Promise<boolean> {
  const db = await getRegistryDatabase();
  return (await db.getKey('trustedAutoOpen', familyId)) !== undefined;
}

export async function removeTrustedAutoOpenKey(familyId: string): Promise<void> {
  const db = await getRegistryDatabase();
  await db.delete('trustedAutoOpen', familyId);
}

export async function clearAllTrustedAutoOpenKeys(): Promise<void> {
  const db = await getRegistryDatabase();
  await db.clear('trustedAutoOpen');
}
