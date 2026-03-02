/**
 * Shared binary ↔ string encoding utilities.
 *
 * These are used by the family-key and invite crypto services.
 * Existing files (encryption.ts, passkeyCrypto.ts) keep their private copies
 * for now — consolidation is a separate cleanup task.
 */

/** Convert an ArrayBuffer / Uint8Array to a standard base64 string. */
export function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/** Convert a standard base64 string back to an ArrayBuffer. */
export function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}

/** Convert an ArrayBuffer / Uint8Array to a URL-safe base64 string (no padding). */
export function bufferToBase64url(buffer: ArrayBuffer | Uint8Array): string {
  return bufferToBase64(buffer).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Convert a URL-safe base64 string back to an ArrayBuffer. */
export function base64urlToBuffer(base64url: string): ArrayBuffer {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  // Restore padding
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  return base64ToBuffer(base64);
}
