/**
 * Encryption service using Web Crypto API
 * Uses AES-GCM for symmetric encryption with PBKDF2 key derivation
 */

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const PBKDF2_ITERATIONS = 100000;
export const SALT_LENGTH = 16;
export const IV_LENGTH = 12;

// Magic header to identify encrypted files
export const ENCRYPTED_HEADER = 'GP_ENCRYPTED_V1';

/**
 * Derive an encryption key from a password
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
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
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Generate random bytes for salt or IV
 */
function generateRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Convert ArrayBuffer to base64 string
 */
function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/**
 * Convert base64 string to ArrayBuffer
 */
function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}

/**
 * Encrypt data with a password
 * Returns a base64-encoded string with header, salt, iv, and ciphertext
 */
export async function encryptData(data: string, password: string): Promise<string> {
  const salt = generateRandomBytes(SALT_LENGTH);
  const iv = generateRandomBytes(IV_LENGTH);
  const key = await deriveKey(password, salt);

  const encoder = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv: iv.buffer as ArrayBuffer },
    key,
    encoder.encode(data)
  );

  // Combine: header + salt + iv + ciphertext
  const combined = new Uint8Array(
    ENCRYPTED_HEADER.length + SALT_LENGTH + IV_LENGTH + encrypted.byteLength
  );

  const headerBytes = encoder.encode(ENCRYPTED_HEADER);
  combined.set(headerBytes, 0);
  combined.set(salt, ENCRYPTED_HEADER.length);
  combined.set(iv, ENCRYPTED_HEADER.length + SALT_LENGTH);
  combined.set(new Uint8Array(encrypted), ENCRYPTED_HEADER.length + SALT_LENGTH + IV_LENGTH);

  return bufferToBase64(combined.buffer as ArrayBuffer);
}

/**
 * Decrypt data with a password
 * Expects the format produced by encryptData
 */
export async function decryptData(encryptedBase64: string, password: string): Promise<string> {
  const combined = new Uint8Array(base64ToBuffer(encryptedBase64));

  // Extract header
  const decoder = new TextDecoder();
  const header = decoder.decode(combined.slice(0, ENCRYPTED_HEADER.length));
  if (header !== ENCRYPTED_HEADER) {
    throw new Error('Invalid encrypted file format');
  }

  // Extract salt, iv, and ciphertext
  const salt = combined.slice(ENCRYPTED_HEADER.length, ENCRYPTED_HEADER.length + SALT_LENGTH);
  const iv = combined.slice(
    ENCRYPTED_HEADER.length + SALT_LENGTH,
    ENCRYPTED_HEADER.length + SALT_LENGTH + IV_LENGTH
  );
  const ciphertext = combined.slice(ENCRYPTED_HEADER.length + SALT_LENGTH + IV_LENGTH);

  const key = await deriveKey(password, salt);

  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv: iv.buffer as ArrayBuffer },
      key,
      ciphertext
    );
    return decoder.decode(decrypted);
  } catch {
    throw new Error('Incorrect password or corrupted data');
  }
}

/**
 * Check if a string looks like encrypted data
 */
export function isEncrypted(data: string): boolean {
  try {
    const decoded = atob(data);
    return decoded.startsWith(ENCRYPTED_HEADER);
  } catch {
    return false;
  }
}

/**
 * Derive an extractable AES-GCM key from a password.
 * Used during passkey registration to capture the DEK for wrapping.
 */
export async function deriveExtractableKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
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
    { name: ALGORITHM, length: KEY_LENGTH },
    true, // extractable — needed for AES-KW wrapping
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt data using a pre-derived CryptoKey (skips PBKDF2).
 * Returns the same format as encryptData: base64(header + salt + iv + ciphertext).
 * The salt parameter is embedded so decryptDataWithKey can extract it if needed.
 */
export async function encryptDataWithKey(
  data: string,
  key: CryptoKey,
  salt: Uint8Array
): Promise<string> {
  const iv = generateRandomBytes(IV_LENGTH);
  const encoder = new TextEncoder();

  const encrypted = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv: iv.buffer as ArrayBuffer },
    key,
    encoder.encode(data)
  );

  // Same format: header + salt + iv + ciphertext
  const combined = new Uint8Array(
    ENCRYPTED_HEADER.length + SALT_LENGTH + IV_LENGTH + encrypted.byteLength
  );

  const headerBytes = encoder.encode(ENCRYPTED_HEADER);
  combined.set(headerBytes, 0);
  combined.set(salt, ENCRYPTED_HEADER.length);
  combined.set(iv, ENCRYPTED_HEADER.length + SALT_LENGTH);
  combined.set(new Uint8Array(encrypted), ENCRYPTED_HEADER.length + SALT_LENGTH + IV_LENGTH);

  return bufferToBase64(combined.buffer as ArrayBuffer);
}

/**
 * Decrypt data using a pre-derived CryptoKey (skips PBKDF2).
 * Expects the format produced by encryptData / encryptDataWithKey.
 */
export async function decryptDataWithKey(encryptedBase64: string, key: CryptoKey): Promise<string> {
  const combined = new Uint8Array(base64ToBuffer(encryptedBase64));

  const decoder = new TextDecoder();
  const header = decoder.decode(combined.slice(0, ENCRYPTED_HEADER.length));
  if (header !== ENCRYPTED_HEADER) {
    throw new Error('Invalid encrypted file format');
  }

  // Skip salt (PBKDF2 salt not needed — we already have the key)
  const iv = combined.slice(
    ENCRYPTED_HEADER.length + SALT_LENGTH,
    ENCRYPTED_HEADER.length + SALT_LENGTH + IV_LENGTH
  );
  const ciphertext = combined.slice(ENCRYPTED_HEADER.length + SALT_LENGTH + IV_LENGTH);

  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv: iv.buffer as ArrayBuffer },
      key,
      ciphertext
    );
    return decoder.decode(decrypted);
  } catch {
    throw new Error('Incorrect key or corrupted data');
  }
}

/**
 * Extract the PBKDF2 salt from an encrypted blob.
 * Used during passkey registration to derive the same key for wrapping.
 */
export function extractSaltFromEncrypted(encryptedBase64: string): Uint8Array {
  const combined = new Uint8Array(base64ToBuffer(encryptedBase64));

  const decoder = new TextDecoder();
  const header = decoder.decode(combined.slice(0, ENCRYPTED_HEADER.length));
  if (header !== ENCRYPTED_HEADER) {
    throw new Error('Invalid encrypted file format');
  }

  return combined.slice(ENCRYPTED_HEADER.length, ENCRYPTED_HEADER.length + SALT_LENGTH);
}

/**
 * Encrypt a sync file's data section
 */
export async function encryptSyncData(jsonData: string, password: string): Promise<string> {
  return encryptData(jsonData, password);
}

/**
 * Decrypt a sync file's data section
 */
export async function decryptSyncData(encryptedData: string, password: string): Promise<string> {
  return decryptData(encryptedData, password);
}
