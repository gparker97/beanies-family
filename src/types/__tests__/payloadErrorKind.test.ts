/**
 * `payloadErrorKind`: the ONE discriminator every payload-failure decision
 * reads. Two hand-written ladders (the inline key here, the boot-overlay key
 * in `payloadFailureSurface.ts`) had already drifted apart under comments
 * claiming they matched; these pins are what stops a third.
 */
import { describe, it, expect } from 'vitest';
import {
  PayloadLoadError,
  CorruptPayloadError,
  PayloadTooLargeError,
  UnsupportedBeanpodVersionError,
  payloadErrorKind,
  payloadErrorMessageKey,
  PAYLOAD_INLINE_KEY,
  type PayloadErrorKind,
} from '../sync';

const ALL_KINDS: readonly PayloadErrorKind[] = [
  'credential-stale',
  'needs-update',
  'unreadable',
  'too-large',
  'corrupt',
];

describe('payloadErrorKind', () => {
  it('classifies a newer-version file as needs-update, NOT unreadable (the arm-order pin)', () => {
    // ⚠️ `UnsupportedBeanpodVersionError` is BOTH `step === 'parse'` and
    // `needsAppUpdate`. If the parse arm is tested first, every 6.0 file
    // resolves to `unreadable` and the "update beanies" copy is dead code.
    expect(payloadErrorKind(new UnsupportedBeanpodVersionError('6.0'))).toBe('needs-update');
  });

  it('still classifies a torn read as unreadable', () => {
    expect(payloadErrorKind(new CorruptPayloadError('torn', 'parse', null))).toBe('unreadable');
  });

  it('classifies a decrypt failure as credential-stale, and an allocation failure as too-large', () => {
    expect(payloadErrorKind(new CorruptPayloadError('tag', 'decrypt', null))).toBe(
      'credential-stale'
    );
    expect(payloadErrorKind(new PayloadTooLargeError('oom', 'load', null, 1))).toBe('too-large');
    expect(payloadErrorKind(new CorruptPayloadError('bad', 'materialize', null))).toBe('corrupt');
  });

  it('gives the SAME inline key through the resolver and the getter (the divergence pin)', () => {
    // Five sites call `payloadErrorMessageKey(e)` directly and a dozen read
    // `e.inlineMessageKey`. A subclass override of the getter would show two
    // different messages for one error, split across those groups.
    const err: PayloadLoadError = new UnsupportedBeanpodVersionError('6.0');
    expect(payloadErrorMessageKey(err)).toBe('podNewerVersion.inline');
    expect(err.inlineMessageKey).toBe(payloadErrorMessageKey(err));
    expect(
      Object.getOwnPropertyDescriptor(UnsupportedBeanpodVersionError.prototype, 'inlineMessageKey')
    ).toBeUndefined();
  });

  it('has an inline key for every kind (table exhaustiveness)', () => {
    for (const kind of ALL_KINDS) expect(typeof PAYLOAD_INLINE_KEY[kind]).toBe('string');
    expect(Object.keys(PAYLOAD_INLINE_KEY).sort()).toEqual([...ALL_KINDS].sort());
  });
});
