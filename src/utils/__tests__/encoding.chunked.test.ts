/**
 * Chunked base64 must be byte-identical to the unchunked implementation.
 *
 * The trap this pins: encoding chunks the BYTES and concatenates each chunk's
 * `btoa` output, so a chunk size that is not a multiple of 3 makes `btoa` emit
 * `=` padding at every internal boundary. `bufferToBase64url` strips only
 * TRAILING padding, so that corruption would survive all the way into a written
 * `.beanpod`. The obvious "one shared chunk constant" (0x8000, which is 2 mod 3)
 * is exactly the wrong choice.
 *
 * A test that only checked empty and small inputs would pass with the broken
 * constant, so every case below is either multi-chunk or a residue class that
 * lands on a boundary.
 */
import { describe, it, expect } from 'vitest';
import {
  bufferToBase64,
  base64ToBuffer,
  bufferToBase64url,
  base64urlToBuffer,
} from '@/utils/encoding';

/** The pre-chunking implementations, kept verbatim as the oracle. */
function referenceEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}
function referenceDecode(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const bytesOfLength = (n: number) => {
  const a = new Uint8Array(n);
  // Deterministic, full 0-255 range — a zero-filled buffer would hide plenty.
  for (let i = 0; i < n; i++) a[i] = (i * 31 + (i >> 8)) & 0xff;
  return a;
};

const ENCODE_CHUNK = 32_766;

/**
 * Lengths chosen to hit every boundary that matters:
 * every residue mod 3 (the encode trap), sub/exact/over one chunk, and several
 * chunks so an internal boundary is definitely crossed.
 */
const LENGTHS = [
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  ENCODE_CHUNK - 1,
  ENCODE_CHUNK,
  ENCODE_CHUNK + 1,
  ENCODE_CHUNK + 2,
  ENCODE_CHUNK * 2,
  ENCODE_CHUNK * 2 + 1,
  ENCODE_CHUNK * 2 + 2,
  ENCODE_CHUNK * 3 + 7,
  100_000,
];

describe('bufferToBase64 — chunked encode', () => {
  it.each(LENGTHS)('matches the unchunked implementation at %i bytes', (n) => {
    const bytes = bytesOfLength(n);
    expect(bufferToBase64(bytes)).toBe(referenceEncode(bytes));
  });

  it.each([0, 1, 2])('emits no internal padding for length %% 3 === %i', (mod) => {
    // The direct assertion of the trap: `=` may appear ONLY at the very end.
    const bytes = bytesOfLength(ENCODE_CHUNK * 2 + mod);
    const encoded = bufferToBase64(bytes);
    const firstPad = encoded.indexOf('=');
    if (firstPad !== -1) {
      expect(encoded.slice(firstPad)).toMatch(/^={1,2}$/);
    }
  });

  it('accepts an ArrayBuffer as well as a Uint8Array', () => {
    const bytes = bytesOfLength(ENCODE_CHUNK + 5);
    expect(bufferToBase64(bytes.buffer)).toBe(bufferToBase64(bytes));
  });
});

describe('base64ToBuffer — chunked decode', () => {
  it.each(LENGTHS)('round-trips %i bytes exactly', (n) => {
    const bytes = bytesOfLength(n);
    const decoded = new Uint8Array(base64ToBuffer(bufferToBase64(bytes)));
    // Length first: an over-allocated buffer is the failure mode of estimating
    // the output size from the base64 length without trimming for padding.
    expect(decoded.byteLength).toBe(n);
    expect(decoded).toEqual(bytes);
  });

  it.each(LENGTHS)('matches the unchunked decoder at %i bytes', (n) => {
    const b64 = referenceEncode(bytesOfLength(n));
    expect(new Uint8Array(base64ToBuffer(b64))).toEqual(referenceDecode(b64));
  });
});

describe('the url-safe wrappers still round-trip', () => {
  it.each([0, 1, 2, ENCODE_CHUNK + 1, ENCODE_CHUNK * 2 + 2])(
    'round-trips %i bytes through base64url',
    (n) => {
      const bytes = bytesOfLength(n);
      expect(new Uint8Array(base64urlToBuffer(bufferToBase64url(bytes)))).toEqual(bytes);
    }
  );

  it('produces no padding at all in the url-safe form', () => {
    // If an internal `=` ever leaked in, the trailing-only strip would leave it
    // mid-string and this would fail.
    expect(bufferToBase64url(bytesOfLength(ENCODE_CHUNK * 2 + 1))).not.toContain('=');
  });
});
