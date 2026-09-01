/**
 * The per-device secret — one 256-bit random key that never leaves this device.
 *
 * Extracted from `deviceUnlock.ts` for #80: that module is about PIN unlock, lockout
 * counters and `MAX_PIN_ATTEMPTS`, and the session seal has no business importing any
 * of that to sign a session. The secret is a shared primitive, so it lives on its own.
 *
 * ONE SECRET, N INFO-DOMAINS. Every consumer derives its own key from this base via
 * HKDF with a distinct `info` label, so a key in one domain is useless in another:
 *   - PIN wrap        — `deviceUnlock.ts`      (`beanies.family-pin-unlock-v1:`)
 *   - Trusted auto-open — `trustedAutoOpen.ts`
 *   - Session seal    — `sessionSeal.ts`       (`beanies.family-session-seal-v1`)
 *
 * The secret lives in the REGISTRY IndexedDB, which iOS ITP can evict independently of
 * localStorage. Consumers must therefore treat "the secret changed" as an expected
 * environmental event, not as tampering — see `sessionSeal.open`'s `key-changed`.
 */

import * as repo from '@/services/indexeddb/repositories/deviceUnlockRepository';
import { importHKDFBaseKey } from '@/services/crypto/keyWrap';
import { bufferToBase64, base64ToBuffer } from '@/utils/encoding';
import { toISODateString } from '@/utils/date';
import { logEvent } from '@/services/telemetry/logEvent';

export type DeviceSecret = { baseKey: CryptoKey; kdf: 'hkdf' | 'hkdf+pbkdf2' };

/**
 * In-flight memo. `getOrCreateDeviceSecret` is create-on-miss, so two concurrent
 * callers that both miss would each generate 32 random bytes and both write — last
 * write wins, and anything sealed with the losing key fails as `key-changed` on the
 * next boot (an unexplained logout). #80 put a third caller on the BOOT path, which
 * made that race reachable, so it is closed here once for all consumers.
 *
 * Not cleared on success: the secret is created once and never rotated, so a
 * stale-but-valid key cannot exist. Cleared on failure so a transient registry error
 * is not cached.
 */
let inflight: Promise<DeviceSecret> | null = null;

/**
 * Get (or create, first use) the per-device secret. Prefers a non-extractable HKDF base
 * CryptoKey stored via structured clone; where that write fails (older WebViews), falls
 * back to extractable base64 bytes — flagged to telemetry so the fleet share of the
 * weaker mode is measurable.
 */
export function getOrCreateDeviceSecret(): Promise<DeviceSecret> {
  inflight ??= load().catch((e) => {
    inflight = null;
    throw e;
  });
  return inflight;
}

async function load(): Promise<DeviceSecret> {
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

/** Test-only: drop the memo so a suite can exercise the create-on-miss path repeatedly. */
export function __resetDeviceSecretCacheForTests(): void {
  inflight = null;
}
