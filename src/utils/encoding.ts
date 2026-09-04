/**
 * Shared binary ↔ string encoding utilities.
 *
 * These are used by the family-key and invite crypto services.
 * Existing files (encryption.ts, passkeyCrypto.ts) keep their private copies
 * for now — consolidation is a separate cleanup task.
 */

import { measureSync } from '@/utils/perfTiming';

/**
 * ⚠️ THE TWO CHUNK SIZES ARE DIFFERENT ON PURPOSE. DO NOT UNIFY THEM.
 *
 * Encoding chunks the BYTES and concatenates each chunk's `btoa` output, so a
 * chunk that is not a multiple of 3 makes `btoa` emit `=` padding at every
 * internal boundary. The result is invalid base64 — and `bufferToBase64url`
 * strips only TRAILING padding, so the corruption survives all the way into the
 * file. `0x8000 % 3 === 2`, so the obvious shared constant is exactly wrong
 * here.
 *
 * Decoding chunks the base64 STRING, so its chunk must be a multiple of 4 to
 * land on a group boundary.
 */
const B64_ENCODE_CHUNK_BYTES = 32_766; // multiple of 3 — btoa must not pad mid-string
const B64_DECODE_CHUNK_CHARS = 0x8000; // 32768, multiple of 4 — one base64 group

/** Convert an ArrayBuffer / Uint8Array to a standard base64 string. */
export function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  // Timed: this runs over the *entire* encrypted doc on every save/persist.
  // Trivial calls (keys, tokens) stay below the console floor and are silent.
  //
  // Chunked because the old `binary += String.fromCharCode(...)` loop held the
  // source bytes, a multi-megabyte rope AND the base64 result simultaneously.
  return measureSync(
    'base64.encode',
    () => {
      let out = '';
      for (let i = 0; i < bytes.byteLength; i += B64_ENCODE_CHUNK_BYTES) {
        // `apply` over a bounded subarray: 32,766 args is far below the engine's
        // argument limit, and it avoids materialising a per-byte rope.
        out += btoa(
          String.fromCharCode.apply(
            null,
            bytes.subarray(i, i + B64_ENCODE_CHUNK_BYTES) as unknown as number[]
          )
        );
      }
      return out;
    },
    { perf_doc_bytes: bytes.byteLength }
  );
}

/** Convert a standard base64 string back to an ArrayBuffer. */
export function base64ToBuffer(base64: string): ArrayBuffer {
  // ⚠️ WHITESPACE IS NOT HANDLED, ON PURPOSE. `atob` tolerates it and chunking
  // does not (a newline inside a chunk shifts every following group boundary),
  // but no producer here can emit it: `bufferToBase64` concatenates `btoa`
  // output, and the `.beanpod` is `JSON.stringify(env, null, 2)` — pretty-print
  // indentation goes BETWEEN tokens, never inside a string value, and a
  // hand-wrapped file fails at `JSON.parse` long before this. A normalising
  // pass would therefore be dead code that still charges an O(n) scan of a
  // multi-megabyte string on every decode (base, every increment, twice on the
  // recovery path), allocate a second full copy of it if it ever did fire, and
  // — because `/\s/` matches ten characters `atob` rejects, NBSP and BOM among
  // them — silently launder genuinely corrupt input into an opaque AES-GCM
  // failure instead of a loud, correctly-classified one.
  const src = base64;
  return measureSync(
    'base64.decode',
    () => {
      // The EXACT output length, so the buffer can be handed back without a
      // copy. An over-allocation plus `bytes.buffer.slice(0, written)` would
      // duplicate the whole payload at peak — precisely what chunking the
      // decode was meant to avoid, and it would leave the saving at nil.
      //
      // A base64 group of 4 chars is 3 bytes. A final group may be short:
      // 2 chars → 1 byte, 3 chars → 2 bytes, whether that shortness is spelled
      // with `=` padding or by simply stopping early (unpadded base64url).
      const rem = src.length % 4;
      const padding = rem === 0 ? (src.endsWith('==') ? 2 : src.endsWith('=') ? 1 : 0) : 0;
      const size = Math.floor(src.length / 4) * 3 - padding + (rem === 0 ? 0 : rem - 1);

      const bytes = new Uint8Array(size);
      let written = 0;
      // Decode in chunks so only one chunk-sized binary string is alive at a
      // time, instead of the whole `atob` output coexisting with the array.
      for (let i = 0; i < src.length; i += B64_DECODE_CHUNK_CHARS) {
        const binary = atob(src.slice(i, i + B64_DECODE_CHUNK_CHARS));
        for (let j = 0; j < binary.length; j++) bytes[written++] = binary.charCodeAt(j);
      }
      // The arithmetic above is exact for well-formed input. Rather than trust
      // it blindly on data that came off disk, fall back to the copying trim if
      // it ever disagrees: correct-and-slower beats a buffer with stray zeros.
      return written === bytes.byteLength
        ? bytes.buffer
        : (bytes.buffer.slice(0, written) as ArrayBuffer);
    },
    // base64 decodes to ~3/4 its length in bytes. Reported as DECODED bytes so
    // it is directly comparable with `base64.encode`, which reports the same.
    { perf_doc_bytes: Math.floor((src.length * 3) / 4) }
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

// ─── SHA-256 digests ─────────────────────────────────────────────────────────
//
// Shared because more than one gate needs "hash this string and compare it to a
// configured digest" (the invite-token gate and the store-review demo gate both
// route through `hashedCodeGate.ts`). Inputs here are short strings — tokens and
// codes, never document bytes — so unlike the base64 helpers above they are not
// wrapped in `measureSync`: they would sit permanently below the telemetry floor
// and only add noise.
//
// These THROW if `crypto.subtle` is unavailable (a non-secure context). That is
// deliberate: callers must decide how to surface it, and every current caller
// catches and reports rather than failing closed in silence.

/** SHA-256 a UTF-8 string. Throws when `crypto.subtle` is unavailable. */
export async function sha256(input: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
}

/** SHA-256 a UTF-8 string, returning lowercase hex. */
export async function sha256Hex(input: string): Promise<string> {
  const hash = await sha256(input);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
