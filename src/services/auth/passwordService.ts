/**
 * Password hashing service using Web Crypto API (PBKDF2)
 *
 * Reuses the same PBKDF2 pattern from encryption.ts for consistency.
 * Passwords are hashed with a random salt and stored as "salt:hash" in base64.
 */

const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const HASH_LENGTH = 32; // 256 bits

/**
 * Generate random bytes for salt
 */
function generateRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Convert Uint8Array to base64 string
 */
function bufferToBase64(buffer: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < buffer.byteLength; i++) {
    binary += String.fromCharCode(buffer[i]!);
  }
  return btoa(binary);
}

/**
 * Convert base64 string to Uint8Array
 */
function base64ToBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Derive a key from password + salt using PBKDF2
 */
async function deriveHash(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    HASH_LENGTH * 8
  );

  return new Uint8Array(bits);
}

/**
 * Hash a password with a random salt.
 * Returns a string in the format "base64(salt):base64(hash)"
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = generateRandomBytes(SALT_LENGTH);
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

  const salt = base64ToBuffer(saltBase64);
  const expectedHash = base64ToBuffer(hashBase64);
  const actualHash = await deriveHash(password, salt);

  // Constant-time comparison to prevent timing attacks
  if (expectedHash.length !== actualHash.length) return false;
  let result = 0;
  for (let i = 0; i < expectedHash.length; i++) {
    result |= expectedHash[i]! ^ actualHash[i]!;
  }
  return result === 0;
}
