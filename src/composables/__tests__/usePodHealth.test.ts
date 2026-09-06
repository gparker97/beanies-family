import { describe, it, expect } from 'vitest';
import { decodedSizeOf, DUE_BYTES } from '../usePodHealth';

describe('decodedSizeOf', () => {
  it('measures a base64 payload without decoding it', () => {
    // ⚠️ Decoding a multi-megabyte payload to measure it would allocate the
    // very thing this tier exists to avoid.
    const bytes = new Uint8Array(3000).fill(7);
    const b64 = Buffer.from(bytes).toString('base64');
    expect(decodedSizeOf(b64)).toBe(3000);
  });

  it('handles both padding lengths exactly', () => {
    for (const n of [1, 2, 3, 4, 5, 999, 1000]) {
      const b64 = Buffer.from(new Uint8Array(n)).toString('base64');
      expect(decodedSizeOf(b64)).toBe(n);
    }
  });

  it('is zero for an absent payload rather than NaN', () => {
    expect(decodedSizeOf('')).toBe(0);
  });

  it('puts the threshold where an old tablet starts to struggle', () => {
    expect(DUE_BYTES).toBe(1_000_000);
  });
});
