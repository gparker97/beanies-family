/**
 * `encryptPayload` / `decryptPayload` must pass VIEWS to Web Crypto, never
 * `.buffer`.
 *
 * `decryptPayload` takes `Uint8Array( IV || ciphertext )` and skips the IV with
 * a subarray. Handing `subarray.buffer` to `crypto.subtle.decrypt` passes the
 * WHOLE underlying buffer — IV prefix included — so it decrypts the wrong
 * bytes. The old code got away with `.slice().buffer` only because slicing
 * copied into a fresh buffer whose offset happened to be 0.
 *
 * Every assertion here uses a NON-ZERO-OFFSET view, because a zero-offset one
 * passes either way and would let the bug back in unnoticed.
 */
import { describe, it, expect } from 'vitest';
import { generateFamilyKey, encryptPayload, decryptPayload } from '../familyKeyService';

/** The same bytes, but living at a non-zero offset inside a larger buffer. */
function viewAtOffset(bytes: Uint8Array, offset = 7): Uint8Array {
  const backing = new Uint8Array(offset + bytes.byteLength + 5);
  backing.fill(0xab); // padding that must NEVER appear in the result
  backing.set(bytes, offset);
  return backing.subarray(offset, offset + bytes.byteLength);
}

const payload = () => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);

describe('familyKeyService — view handling', () => {
  it('round-trips a whole-buffer payload (the ordinary case)', async () => {
    const key = await generateFamilyKey();
    const data = payload();
    expect(await decryptPayload(key, await encryptPayload(key, data))).toEqual(data);
  });

  it('encrypts exactly the VIEW, not its whole backing buffer', async () => {
    const key = await generateFamilyKey();
    const data = payload();

    const fromView = await decryptPayload(key, await encryptPayload(key, viewAtOffset(data)));

    // If `.buffer` were passed, this would be the 25-byte backing array full of
    // 0xab padding rather than the 13 bytes actually handed over.
    expect(fromView.byteLength).toBe(data.byteLength);
    expect(fromView).toEqual(data);
    expect(Array.from(fromView)).not.toContain(0xab);
  });

  it('decrypts when the ciphertext envelope itself sits at a non-zero offset', async () => {
    const key = await generateFamilyKey();
    const data = payload();
    const encrypted = await encryptPayload(key, data);

    // The IV||ciphertext bundle arriving as a view — the shape `decryptPayload`
    // internally produces when it subarrays past the IV.
    expect(await decryptPayload(key, viewAtOffset(encrypted))).toEqual(data);
  });

  it('round-trips a payload large enough to cross the base64 chunk boundary', async () => {
    // Guards the interaction between the chunked encoder and the view handling:
    // a multi-chunk payload is where an off-by-one in either would show up.
    const key = await generateFamilyKey();
    const big = new Uint8Array(100_003);
    for (let i = 0; i < big.length; i++) big[i] = (i * 17) & 0xff;

    expect(await decryptPayload(key, await encryptPayload(key, big))).toEqual(big);
  });

  it('fails to decrypt if the bytes are tampered with (the IV is really in use)', async () => {
    const key = await generateFamilyKey();
    const encrypted = await encryptPayload(key, payload());
    encrypted[0] ^= 0xff; // corrupt the IV

    await expect(decryptPayload(key, encrypted)).rejects.toBeTruthy();
  });
});
