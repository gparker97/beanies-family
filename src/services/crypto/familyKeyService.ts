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
 * - deriveMemberKey outputs AES-KW (for wrapping), unlike encryption.ts
 *   deriveKey which outputs AES-GCM (for direct encryption).
 * - Wrong-password errors propagate as native DOMException.
 */

import { SALT_LENGTH, IV_LENGTH } from './encryption';
import { bufferToBase64, base64ToBuffer } from '@/utils/encoding';

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const WRAPPING_ALGO = 'AES-KW';
const PBKDF2_ITERATIONS = 100_000;

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

/** Derive an AES-KW wrapping key from a member's password + salt. */
export async function deriveMemberKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: WRAPPING_ALGO, length: KEY_LENGTH },
    false,
    ['wrapKey', 'unwrapKey']
  );
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

// ── Payload encryption (AES-GCM) ───────────────────────────────────

/**
 * Encrypt an Automerge binary payload with the family key.
 * Returns `Uint8Array( IV || ciphertext )`.
 */
export async function encryptPayload(familyKey: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv: iv.buffer as ArrayBuffer },
    familyKey,
    data.buffer as ArrayBuffer
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
  const iv = encrypted.slice(0, IV_LENGTH);
  const ciphertext = encrypted.slice(IV_LENGTH);

  const plaintext = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: iv.buffer as ArrayBuffer },
    familyKey,
    ciphertext.buffer as ArrayBuffer
  );

  return new Uint8Array(plaintext);
}

// Re-export for convenience
export { SALT_LENGTH, IV_LENGTH };
