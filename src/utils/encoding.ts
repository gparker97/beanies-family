/**
 * Shared binary ↔ string encoding utilities.
 *
 * These are used by the family-key and invite crypto services.
 * Existing files (encryption.ts, passkeyCrypto.ts) keep their private copies
 * for now — consolidation is a separate cleanup task.
 */

import { measureSync } from '@/utils/perfTiming';

/** Convert an ArrayBuffer / Uint8Array to a standard base64 string. */
export function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  // Timed: this char-by-char loop is a suspect in the load-path freeze — it
  // runs over the *entire* encrypted doc on every save/persist. Trivial calls
  // (keys, tokens) stay below the console floor and are silent.
  return measureSync(
    'base64.encode',
    () => {
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]!);
      }
      return btoa(binary);
    },
    { perf_doc_bytes: bytes.byteLength }
  );
}

/** Convert a standard base64 string back to an ArrayBuffer. */
export function base64ToBuffer(base64: string): ArrayBuffer {
  return measureSync(
    'base64.decode',
    () => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer as ArrayBuffer;
    },
    // base64 decodes to ~3/4 its length in bytes.
    { perf_doc_bytes: Math.floor((base64.length * 3) / 4) }
  );
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
