/**
 * The two policy questions every consumer asks, answered in ONE place.
 *
 * They were being re-derived ad hoc at eleven sites, and got it wrong twice in
 * ways that destroyed a working credential: once from the CLASS alone (which
 * misses that `loadAndVerify` runs outside `decryptToDoc`'s try, so a
 * `load`/`materialize` failure proves the AES-GCM tag verified), and once from
 * the STEP alone (which misses that an allocation failure at the decrypt step
 * never reached the tag check at all).
 */
import { describe, it, expect } from 'vitest';
import { CorruptPayloadError, PayloadTooLargeError } from '@/types/sync';

describe('keyMayBeWrong', () => {
  it('is true ONLY for a corrupt-class failure at the decrypt step', () => {
    expect(new CorruptPayloadError('m', 'decrypt', 'f').keyMayBeWrong).toBe(true);
  });

  it('is false once the payload has decrypted, so a valid key is never deleted', () => {
    // The tag verified. Whatever is wrong, it is not the key.
    expect(new CorruptPayloadError('m', 'load', 'f').keyMayBeWrong).toBe(false);
    expect(new CorruptPayloadError('m', 'materialize', 'f').keyMayBeWrong).toBe(false);
  });

  it('is false for an out-of-memory failure AT the decrypt step', () => {
    // The trap a step-only check falls into: the allocation failed before the
    // tag was ever checked, so it says nothing about the key. Deleting it costs
    // the user trusted-device auto-open over a memory limit.
    expect(new PayloadTooLargeError('oom', 'decrypt', 'f').keyMayBeWrong).toBe(false);
    expect(new PayloadTooLargeError('oom', 'load', 'f').keyMayBeWrong).toBe(false);
  });
});

describe('deviceCannotOpen', () => {
  it('separates "this device could not" from "the data is bad"', () => {
    expect(new PayloadTooLargeError('oom', 'materialize', 'f').deviceCannotOpen).toBe(true);
    expect(new CorruptPayloadError('m', 'materialize', 'f').deviceCannotOpen).toBe(false);
  });
});
