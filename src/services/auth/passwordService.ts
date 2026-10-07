/**
 * Password / PIN hashing for the doc-side `passwordHash` and `pinHash` (PBKDF2-SHA256).
 *
 * Hashes are stored as "base64(salt):base64(hash)" inside the ENCRYPTED doc, so an
 * attacker reaches them only after the family key is already lost. That is why they use
 * the `docHash` profile and why the format never changes: an older client meeting an
 * unknown format refuses password sign-in outright (ADR-041).
 */

import { SALT_LENGTH } from '@/services/crypto/familyKeyService';
import { KDF_PROFILES, derivePbkdf2Bits } from '@/services/crypto/kdfParams';
import { bufferToBase64, base64ToBuffer } from '@/utils/encoding';

const HASH_LENGTH = 32; // 256 bits

/** Derive the hash bytes for password + salt (profile `docHash`, count unchanged). */
function deriveHash(password: string, salt: Uint8Array): Promise<Uint8Array> {
  return derivePbkdf2Bits(
    new TextEncoder().encode(password),
    salt,
    { profile: 'docHash', iterations: KDF_PROFILES.docHash },
    HASH_LENGTH * 8
  );
}

/**
 * Hash a password with a random salt.
 * Returns a string in the format "base64(salt):base64(hash)"
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const hash = await deriveHash(password, salt);
  return `${bufferToBase64(salt)}:${bufferToBase64(hash)}`;
}

/**
 * Verify a password against a stored hash.
 * The storedHash must be in the format "base64(salt):base64(hash)"
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const colonIndex = storedHash.indexOf(':');
  if (colonIndex === -1) return false;

  const saltBase64 = storedHash.substring(0, colonIndex);
  const hashBase64 = storedHash.substring(colonIndex + 1);

  const salt = new Uint8Array(base64ToBuffer(saltBase64));
  const expectedHash = new Uint8Array(base64ToBuffer(hashBase64));
  const actualHash = await deriveHash(password, salt);

  // Constant-time comparison to prevent timing attacks
  if (expectedHash.length !== actualHash.length) return false;
  let result = 0;
  for (let i = 0; i < expectedHash.length; i++) {
    result |= expectedHash[i]! ^ actualHash[i]!;
  }
  return result === 0;
}
