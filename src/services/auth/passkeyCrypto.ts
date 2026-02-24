/**
 * Passkey crypto helpers for WebAuthn PRF-based key wrapping.
 *
 * Two paths:
 * 1. PRF path: PRF output → HKDF → AES-KW wrapping key → wrap/unwrap the file DEK
 * 2. Non-PRF path: passkey authenticates the member, cached password decrypts
 *
 * All key material stays in Web Crypto (non-extractable where possible).
 */

const HKDF_HASH = 'SHA-256';
const WRAPPING_ALGO = 'AES-KW';
const WRAPPING_KEY_LENGTH = 256;
const HKDF_SALT_LENGTH = 32;

/**
 * Check whether the PRF extension was evaluated during a credential operation.
 * Returns true if the authenticator returned PRF results.
 */
export function isPRFSupported(
  extensionResults: AuthenticationExtensionsClientOutputs | undefined
): boolean {
  if (!extensionResults) return false;
  const prf = (extensionResults as Record<string, unknown>).prf as
    | { results?: { first?: ArrayBuffer } }
    | undefined;
  return !!(prf?.results?.first && prf.results.first.byteLength > 0);
}

/**
 * Extract the PRF first output from extension results.
 */
export function getPRFOutput(
  extensionResults: AuthenticationExtensionsClientOutputs
): ArrayBuffer | null {
  const prf = (extensionResults as Record<string, unknown>).prf as
    | { results?: { first?: ArrayBuffer } }
    | undefined;
  return prf?.results?.first ?? null;
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
 * Build the PRF extension input for WebAuthn create/get operations.
 * Uses a fixed eval salt derived from the app domain.
 */
export function buildPRFExtension(): { prf: { eval: { first: BufferSource } } } {
  // Fixed salt for PRF evaluation — derived from app identifier
  const salt = new TextEncoder().encode('beanies.family-prf-salt-v1');
  // PRF salt must be exactly 32 bytes
  const padded = new Uint8Array(32);
  padded.set(salt.slice(0, 32));
  return {
    prf: {
      eval: {
        first: padded,
      },
    },
  };
}

// --- Utility functions ---

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}
