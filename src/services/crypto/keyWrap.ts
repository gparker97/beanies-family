/**
 * Mechanism-agnostic HKDF → AES-KW key-wrap helpers (2026-08-28 login rethink).
 *
 * Extracted from `passkeyCrypto.ts` so the PIN device-unlock path (Phase 2) reuses the
 * SAME primitives the PRF path always used, and so Phase 4's PRF retirement deletes only
 * the truly PRF-specific pieces (`getPRFOutput`, `buildPRFEvalExtension`) without
 * orphaning the wrap crypto Phase 2 depends on.
 *
 * Two derivation entry points, one wrap format:
 *   - `deriveWrappingKey(rawSecret, salt, info)` — raw bytes (a PRF output) → HKDF base
 *     key → AES-KW. What passkeyCrypto always did, now with the domain-separation `info`
 *     as a parameter.
 *   - `deriveWrappingKeyFromBaseKey(baseKey, salt, info)` — an already-imported
 *     NON-EXTRACTABLE HKDF base CryptoKey (the device secret) → AES-KW. NOTE: an AES key
 *     cannot serve as HKDF input material in WebCrypto — the secret must be created as
 *     an `'HKDF'` base key (`importKey('raw', bytes, 'HKDF', false, ['deriveKey'])`).
 */

import { bufferToBase64, base64ToBuffer } from '@/utils/encoding';

const HKDF_HASH = 'SHA-256';
const WRAPPING_ALGO = 'AES-KW';
const WRAPPING_KEY_LENGTH = 256;
export const HKDF_SALT_LENGTH = 32;

/** Generate a random HKDF salt (32 bytes). */
export function generateHKDFSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(HKDF_SALT_LENGTH));
}

/** Import raw secret bytes as a non-extractable HKDF base key. */
export async function importHKDFBaseKey(secret: ArrayBuffer | Uint8Array): Promise<CryptoKey> {
  const buf = secret instanceof Uint8Array ? (secret.buffer as ArrayBuffer) : secret;
  return crypto.subtle.importKey('raw', buf, 'HKDF', false, ['deriveKey']);
}

/**
 * Derive an HMAC-SHA256 signing key from an HKDF base key.
 *
 * Sibling of `deriveWrappingKeyFromBaseKey` — same `HKDF_HASH`, same salt/info contract,
 * so the HKDF parameter block lives in exactly one module. Used by `sessionSeal.ts` to
 * sign the persisted session (#80); the distinct `info` keeps that key useless for
 * unwrapping anything.
 *
 * @param baseKey - non-extractable `'HKDF'` CryptoKey (the per-device secret)
 * @param hkdfSalt - 32-byte salt
 * @param info - domain-separation string; immutable once shipped
 */
export async function deriveHmacKeyFromBaseKey(
  baseKey: CryptoKey,
  hkdfSalt: Uint8Array,
  info: string
): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: HKDF_HASH,
      salt: hkdfSalt.buffer as ArrayBuffer,
      info: new TextEncoder().encode(info),
    },
    baseKey,
    { name: 'HMAC', hash: HKDF_HASH },
    false,
    ['sign', 'verify']
  );
}

/**
 * Derive an AES-KW wrapping key from an HKDF base key.
 *
 * @param baseKey - non-extractable `'HKDF'` CryptoKey (device secret, or imported PRF output)
 * @param hkdfSalt - 32-byte per-record salt (stored alongside the wrap)
 * @param info - domain-separation string; each wrap mechanism uses its own, immutably
 */
export async function deriveWrappingKeyFromBaseKey(
  baseKey: CryptoKey,
  hkdfSalt: Uint8Array,
  info: string
): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: HKDF_HASH,
      salt: hkdfSalt.buffer as ArrayBuffer,
      info: new TextEncoder().encode(info),
    },
    baseKey,
    { name: WRAPPING_ALGO, length: WRAPPING_KEY_LENGTH },
    false,
    ['wrapKey', 'unwrapKey']
  );
}

/** Derive an AES-KW wrapping key from raw secret bytes (imports, then derives). */
export async function deriveWrappingKey(
  rawSecret: ArrayBuffer,
  hkdfSalt: Uint8Array,
  info: string
): Promise<CryptoKey> {
  const baseKey = await importHKDFBaseKey(rawSecret);
  return deriveWrappingKeyFromBaseKey(baseKey, hkdfSalt, info);
}

/**
 * Wrap (encrypt) a DEK using AES-KW.
 *
 * @param dek - The data encryption key to wrap (must be extractable)
 * @returns Base64-encoded wrapped key blob
 */
export async function wrapDEK(dek: CryptoKey, wrappingKey: CryptoKey): Promise<string> {
  const wrapped = await crypto.subtle.wrapKey('raw', dek, wrappingKey, WRAPPING_ALGO);
  return bufferToBase64(wrapped);
}

/**
 * Unwrap (decrypt) a DEK using AES-KW.
 *
 * @param wrappedBase64 - Base64-encoded wrapped key blob
 * @param extractable - pass true where the unwrapped family key must be re-wrappable
 *   (device-unlock wraps; matches `familyKeyService.unwrapFamilyKey`). The PRF path
 *   keeps its historical non-extractable default.
 * @returns AES-GCM CryptoKey ready for encrypt/decrypt
 */
export async function unwrapDEK(
  wrappedBase64: string,
  wrappingKey: CryptoKey,
  extractable = false
): Promise<CryptoKey> {
  const wrappedBuffer = base64ToBuffer(wrappedBase64);
  return crypto.subtle.unwrapKey(
    'raw',
    wrappedBuffer,
    wrappingKey,
    WRAPPING_ALGO,
    { name: 'AES-GCM', length: 256 },
    extractable,
    ['encrypt', 'decrypt']
  );
}
