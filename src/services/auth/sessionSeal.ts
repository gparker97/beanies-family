/**
 * Integrity seal for the persisted session (#80).
 *
 * The session in localStorage was plain JSON with no integrity check: editing `memberId`
 * in devtools and reloading made you that member, and editing `role` alone granted owner
 * rights. This module signs it so a hand-edited session fails CLOSED.
 *
 * WHAT THIS IS NOT. A client-side signature is **not** a cryptographic boundary. The
 * devtools console shares the page's origin and can call any key the app can call,
 * including a non-extractable CryptoKey in IndexedDB. What this defeats is *hand-editing*
 * — which is exactly what the realistic attacker (a technical child on the family
 * desktop) actually does. The real boundary is the PIN step-up on the irreversible
 * actions (`useReauth`), because a forger does not have the member's PIN.
 *
 * The signing key is derived from the per-device secret (`deviceSecret.ts`), which lives
 * in the REGISTRY IndexedDB — deliberately NOT in localStorage beside the session it
 * signs. That store can be evicted by iOS ITP independently of localStorage, so the
 * envelope carries a key id and a lost secret reports as `key-changed`, never as
 * tampering: conflating the two would drown the one metric that means "somebody edited
 * a session".
 */

// Type-only, so this is erased at build time: no runtime import of the store, no cycle,
// and the module stays unit-testable in isolation.
import type { AuthUser } from '@/stores/authStore';
import { getOrCreateDeviceSecret } from '@/services/auth/deviceSecret';
import { deriveHmacKeyFromBaseKey } from '@/services/crypto/keyWrap';
import { bufferToBase64, base64ToBuffer } from '@/utils/encoding';

/** Domain separation. Immutable — changing it invalidates every sealed session. */
const SEAL_INFO = 'beanies.family-session-seal-v1';

/**
 * Fixed salt, and deliberately so. HKDF's salt is non-secret and optional, and the base
 * key is already 256 random bits unique to this device, so a per-session salt would add
 * storage and no strength. Immutable for the same reason as SEAL_INFO.
 */
const SEAL_SALT = new Uint8Array([
  0x62, 0x65, 0x61, 0x6e, 0x69, 0x65, 0x73, 0x2e, 0x66, 0x61, 0x6d, 0x69, 0x6c, 0x79, 0x2d, 0x73,
  0x65, 0x73, 0x73, 0x69, 0x6f, 0x6e, 0x2d, 0x73, 0x65, 0x61, 0x6c, 0x2d, 0x76, 0x31, 0x00, 0x01,
]);

/**
 * MIGRATION ONLY — DELETE THIS BRANCH AND THIS CONSTANT AFTER THE DATE BELOW.
 *
 * A bare pre-#80 session (no `v`, no `t`) is accepted so the release logs nobody out. It
 * is by definition an unauthenticated shape, so while it is accepted the seal can be
 * bypassed by DELETING fields rather than forging a tag. It is therefore time-boxed:
 * after the sunset a bare object is `malformed` like any other unverifiable blob.
 *
 * Tracked for removal by follow-up issue #80-b. No test other than the two boundary
 * tests may depend on this branch — one that does becomes a CI time bomb on this date.
 */
export const LEGACY_SESSION_SUNSET = Date.parse('2026-12-01T00:00:00Z');

export type SealResult =
  | { ok: true; user: AuthUser; legacy: boolean }
  | { ok: false; reason: 'malformed' | 'bad-signature' | 'key-changed' | 'unavailable' };

interface SealEnvelope {
  v: 1;
  /** Key id — which device secret signed this. Checked BEFORE the tag. */
  k: string;
  p: AuthUser;
  /** base64 HMAC over the exact JSON text of `p`. */
  t: string;
}

/**
 * Memoised HMAC key.
 *
 * Only a SUCCESSFUL derivation is cached. A `null` must never be cached: the first call
 * can lose a race with registry initialisation, and a memoised failure would silently
 * disable sealing for the rest of the page load — sessions would stop being written with
 * no signal at all.
 */
let cachedKey: Promise<CryptoKey> | null = null;

async function getSessionKey(): Promise<CryptoKey | null> {
  try {
    cachedKey ??= getOrCreateDeviceSecret().then(({ baseKey }) =>
      deriveHmacKeyFromBaseKey(baseKey, SEAL_SALT, SEAL_INFO)
    );
    return await cachedKey;
  } catch {
    // Private browsing / blocked IndexedDB: getRegistryDatabase and saveDeviceSecret both
    // throw. Drop the memo so a later call can still succeed, and report "no key" rather
    // than throwing out of the boot path. The caller counts this — see authStore.
    cachedKey = null;
    return null;
  }
}

/** Test-only: drop the derived-key memo. */
export function __resetSessionKeyCacheForTests(): void {
  cachedKey = null;
}

async function hmac(key: CryptoKey, text: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return bufferToBase64(sig);
}

/**
 * Key id: a one-way function of the key, used to tell "the device secret changed" apart
 * from "the payload was edited". Derived, never stored, and safe to publish — it reveals
 * nothing an attacker on this device does not already hold.
 */
async function getKeyId(key: CryptoKey): Promise<string> {
  return (await hmac(key, 'kid')).slice(0, 12);
}

/** Seal a session for storage. `null` when this device has no usable key. */
export async function seal(user: AuthUser): Promise<string | null> {
  const key = await getSessionKey();
  if (!key) return null;
  // The tag covers this string; `open` re-serialises the parsed `p` and verifies against
  // THAT. The two agree because `JSON.stringify` preserves insertion order for
  // non-integer-like keys and `JSON.parse` preserves the order it read — and every
  // `AuthUser` key is a plain identifier. Adding a numeric-looking key to `AuthUser` would
  // break that (V8 hoists integer-like keys), and the symptom would be a fleet-wide false
  // `bad-signature` that signs everyone out. Do not add one.
  const payload = JSON.stringify(user);
  const [k, t] = await Promise.all([getKeyId(key), hmac(key, payload)]);
  return JSON.stringify({ v: 1, k, p: JSON.parse(payload) as AuthUser, t } satisfies SealEnvelope);
}

/** Open a stored session, classifying every way it can fail. Never throws. */
export async function open(raw: string): Promise<SealResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'malformed' };

  const env = parsed as Partial<SealEnvelope>;
  const sealed = env.v === 1 && typeof env.k === 'string' && typeof env.t === 'string';

  if (!sealed) {
    // Bare pre-#80 shape. Accepted once, until the sunset — see LEGACY_SESSION_SUNSET.
    if (Date.now() >= LEGACY_SESSION_SUNSET) return { ok: false, reason: 'malformed' };
    const user = parsed as AuthUser;
    if (typeof user.memberId !== 'string') return { ok: false, reason: 'malformed' };
    return { ok: true, user, legacy: true };
  }

  if (!env.p || typeof env.p !== 'object') return { ok: false, reason: 'malformed' };

  const key = await getSessionKey();
  if (!key) return { ok: false, reason: 'unavailable' };

  // Key id FIRST. A mismatch means the device secret was regenerated (ITP eviction,
  // cleared site data, a different browser profile) — expected churn, not an attack. Only
  // when the key matches does a bad tag unambiguously mean "the payload was edited".
  if ((await getKeyId(key)) !== env.k) return { ok: false, reason: 'key-changed' };

  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      'HMAC',
      key,
      // base64ToBuffer -> atob THROWS on a non-base64 tag (a truncated localStorage write,
      // or an attacker who edits the tag rather than the payload). That must classify as a
      // bad signature, not escape as an exception: the restore site has no catch of its
      // own, so a throw would skip the tamper telemetry AND leave the bad blob in place to
      // fail again on every subsequent boot.
      base64ToBuffer(env.t as string),
      new TextEncoder().encode(JSON.stringify(env.p))
    );
  } catch {
    return { ok: false, reason: 'bad-signature' };
  }
  // crypto.subtle.verify is constant-time by construction. NEVER compare tags with ===.
  if (!ok) return { ok: false, reason: 'bad-signature' };

  return { ok: true, user: env.p, legacy: false };
}
