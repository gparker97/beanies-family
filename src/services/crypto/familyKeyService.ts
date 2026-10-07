/**
 * Family Key Service — per-family AES-256-GCM key with AES-KW wrapping.
 *
 * The family key (FK) is a random 256-bit AES-GCM key used to encrypt the
 * Automerge binary payload. Each family member holds a wrapped copy of the FK,
 * produced via their password-derived AES-KW key.
 *
 * Key design decisions:
 * - encryptPayload/decryptPayload work with raw Uint8Array (Automerge binary).
 * - importFamilyKey and unwrapFamilyKey return extractable keys so they can
 *   be re-wrapped for new members.
 * - deriveMemberKey outputs AES-KW (for wrapping) through the one PBKDF2 primitive in
 *   `kdfParams.ts`; the caller supplies the `KdfParams` (a reader the RECORDED count,
 *   a writer the policy count). This module stays policy-free: no gate read here.
 * - Wrong-password errors propagate as native DOMException (see `isWrongKeyUnwrap`).
 */

import { bufferToBase64, base64ToBuffer } from '@/utils/encoding';
import { derivePbkdf2Key, type KdfParams } from './kdfParams';

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const WRAPPING_ALGO = 'AES-KW';
/** PBKDF2 salt length in bytes, for every wrap and the doc-side hashes. */
export const SALT_LENGTH = 16;
/** AES-GCM IV length in bytes. */
export const IV_LENGTH = 12;

// ── Key generation & serialization ──────────────────────────────────

/** Generate a new random 256-bit AES-GCM family key. */
export async function generateFamilyKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: ALGORITHM, length: KEY_LENGTH }, true, [
    'encrypt',
    'decrypt',
  ]);
}

/** Export a family key to raw bytes. */
export async function exportFamilyKey(key: CryptoKey): Promise<Uint8Array> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return new Uint8Array(raw);
}

/** Import a family key from raw bytes. Returns an extractable key. */
export async function importFamilyKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    raw.buffer as ArrayBuffer,
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt']
  );
}

// ── Member wrapping (password → AES-KW) ────────────────────────────

/**
 * Derive an AES-KW wrapping key from a member's password (or the family recovery
 * passphrase) + salt, with the given parameters. Readers pass
 * `{ profile: 'secret', iterations: recordedIterations(entry) }`.
 */
export function deriveMemberKey(
  secret: string,
  salt: Uint8Array,
  params: KdfParams
): Promise<CryptoKey> {
  return derivePbkdf2Key(new TextEncoder().encode(secret), salt, params);
}

/** Wrap a family key with an AES-KW wrapping key. Returns base64. */
export async function wrapFamilyKey(familyKey: CryptoKey, wrappingKey: CryptoKey): Promise<string> {
  const wrapped = await crypto.subtle.wrapKey('raw', familyKey, wrappingKey, WRAPPING_ALGO);
  return bufferToBase64(wrapped);
}

/** Unwrap a family key. Returns an extractable AES-GCM key. */
export async function unwrapFamilyKey(
  wrappedBase64: string,
  unwrappingKey: CryptoKey
): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    'raw',
    base64ToBuffer(wrappedBase64),
    unwrappingKey,
    WRAPPING_ALGO,
    { name: ALGORITHM, length: KEY_LENGTH },
    true, // extractable — so the FK can be re-wrapped for new members
    ['encrypt', 'decrypt']
  );
}

/**
 * The ONE failure that means "this secret does not open this wrap": AES-KW's integrity
 * check refusing the unwrap, which WebCrypto raises as a DOMException named
 * `OperationError`. Read by name, not `instanceof`, so it holds across realms and test
 * DOMs. Anything else (a malformed salt, a refused KDF, a `KdfParamsError`) is a broken
 * entry, not a wrong secret, and callers must log it rather than report "wrong password".
 */
export function isWrongKeyUnwrap(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'OperationError';
}

// ── Payload encryption (AES-GCM) ───────────────────────────────────

/**
 * Encrypt an Automerge binary payload with the family key.
 * Returns `Uint8Array( IV || ciphertext )`.
 */
export async function encryptPayload(familyKey: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  // Pass the VIEWS, never `.buffer`. Every caller happens to pass a
  // whole-buffer Uint8Array today so `.buffer` works by luck, but the moment
  // anyone passes a subarray it would silently encrypt the WHOLE underlying
  // buffer instead of the intended slice. One rule for this file: never
  // `.buffer`.
  // The casts are type-level only (TS models Uint8Array as ArrayBufferLike,
  // which does not satisfy BufferSource). The runtime values stay VIEWS.
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv: iv as BufferSource },
    familyKey,
    data as BufferSource
  );

  const result = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(ciphertext), IV_LENGTH);
  return result;
}

/**
 * Decrypt an Automerge binary payload with the family key.
 * Expects `Uint8Array( IV || ciphertext )`.
 */
export async function decryptPayload(
  familyKey: CryptoKey,
  encrypted: Uint8Array
): Promise<Uint8Array> {
  // `slice` on the IV is a deliberate 12-byte copy. The CIPHERTEXT is a VIEW:
  // slicing it copied the entire payload (multiple MB on a real pod) for no
  // reason, since `crypto.subtle.decrypt` accepts any ArrayBufferView.
  //
  // ⚠️ It must be passed as the VIEW. Passing `ciphertext.buffer` would hand
  // over the whole underlying buffer — including the IV prefix this subarray
  // exists to skip — and decrypt the wrong bytes.
  const iv = encrypted.slice(0, IV_LENGTH);
  const ciphertext = encrypted.subarray(IV_LENGTH);

  const plaintext = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: iv as BufferSource },
    familyKey,
    ciphertext as BufferSource
  );

  return new Uint8Array(plaintext);
}
