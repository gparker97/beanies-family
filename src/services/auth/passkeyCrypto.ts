/**
 * Passkey crypto helpers for WebAuthn PRF-based key wrapping.
 *
 * PRF path: PRF output → HKDF → AES-KW wrapping key → wrap/unwrap the family key
 *
 * All key material stays in Web Crypto (non-extractable where possible).
 *
 * WEB/PWA ONLY. Native biometric no longer uses WebAuthn/PRF — it uses the hardware
 * Keystore via `nativeBiometric.ts` (ADR-029, 2026-07-14). So the real browser
 * WebAuthn API is the only consumer here: the PRF eval salt is a `BufferSource` and
 * the PRF output comes back as an `ArrayBuffer`.
 */

import { bufferToBase64, base64ToBuffer } from '@/utils/encoding';

const HKDF_HASH = 'SHA-256';
const WRAPPING_ALGO = 'AES-KW';
const WRAPPING_KEY_LENGTH = 256;
const HKDF_SALT_LENGTH = 32;

/**
 * Fixed, app-wide PRF eval salt (32 bytes). MUST NOT change — the PRF output is
 * deterministic per (credential, salt), so an existing passkey only unwraps its
 * stored secret if this salt is identical to the one used when it was wrapped.
 * Changing it orphans every registered passkey (web + native).
 */
function prfSaltBytes(): Uint8Array {
  const salt = new TextEncoder().encode('beanies.family-prf-salt-v1');
  const padded = new Uint8Array(HKDF_SALT_LENGTH);
  padded.set(salt.slice(0, HKDF_SALT_LENGTH));
  return padded;
}

/**
 * Normalize a PRF `results.first` value to an ArrayBuffer (real WebAuthn returns an
 * ArrayBuffer / typed-array view). Returns null for empty / absent / unrecognized
 * values. Single "was PRF usable?" predicate feeder for `getPRFOutput`.
 */
function normalizePRFOutput(raw: unknown): ArrayBuffer | null {
  if (raw == null) return null;
  if (raw instanceof ArrayBuffer) {
    return raw.byteLength > 0 ? raw : null;
  }
  if (ArrayBuffer.isView(raw)) {
    const view = raw as ArrayBufferView;
    if (view.byteLength === 0) return null;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
  }
  return null;
}

/**
 * Extract the PRF first output from extension results, normalized to an
 * ArrayBuffer (decoding the native base64url string when needed). Returns null when
 * PRF was not evaluated / returned nothing — this is the single "was PRF usable?"
 * predicate (callers test `getPRFOutput(...) !== null`).
 */
export function getPRFOutput(
  extensionResults: AuthenticationExtensionsClientOutputs
): ArrayBuffer | null {
  const prf = (extensionResults as Record<string, unknown>).prf as
    { results?: { first?: unknown } } | undefined;
  return normalizePRFOutput(prf?.results?.first);
}

/**
 * Generate a random HKDF salt (32 bytes).
 */
export function generateHKDFSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(HKDF_SALT_LENGTH));
}

/**
 * Derive an AES-KW wrapping key from PRF output using HKDF.
 *
 * @param prfOutput - Raw PRF first output (ArrayBuffer from authenticator)
 * @param hkdfSalt - 32-byte salt (stored alongside the credential)
 * @returns AES-KW CryptoKey for wrap/unwrap operations
 */
export async function deriveWrappingKey(
  prfOutput: ArrayBuffer,
  hkdfSalt: Uint8Array
): Promise<CryptoKey> {
  // Import PRF output as HKDF key material
  const keyMaterial = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);

  // Derive AES-KW wrapping key via HKDF
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: HKDF_HASH,
      salt: hkdfSalt.buffer as ArrayBuffer,
      info: new TextEncoder().encode('beanies.family-passkey-dek-wrap'),
    },
    keyMaterial,
    { name: WRAPPING_ALGO, length: WRAPPING_KEY_LENGTH },
    false,
    ['wrapKey', 'unwrapKey']
  );
}

/**
 * Wrap (encrypt) a DEK using AES-KW.
 *
 * @param dek - The data encryption key to wrap (must be extractable)
 * @param wrappingKey - AES-KW key derived from PRF output
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
 * @param wrappingKey - AES-KW key derived from PRF output
 * @returns AES-GCM CryptoKey ready for encrypt/decrypt
 */
export async function unwrapDEK(wrappedBase64: string, wrappingKey: CryptoKey): Promise<CryptoKey> {
  const wrappedBuffer = base64ToBuffer(wrappedBase64);
  return crypto.subtle.unwrapKey(
    'raw',
    wrappedBuffer,
    wrappingKey,
    WRAPPING_ALGO,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * PRF extension input to EVALUATE PRF (at create for Safari 18+, and at assertion).
 * The real WebAuthn API decodes the `BufferSource` salt directly.
 */
export function buildPRFEvalExtension(): { prf: { eval: { first: BufferSource } } } {
  return { prf: { eval: { first: prfSaltBytes() as BufferSource } } };
}
