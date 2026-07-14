import { describe, it, expect } from 'vitest';

// passkeyCrypto is WEB/PWA ONLY since the native-biometric Keystore pivot (ADR-029,
// 2026-07-14) — no `isNative()` branch remains, so no capabilities mock is needed.

import {
  buildPRFEvalExtension,
  getPRFOutput,
  generateHKDFSalt,
  deriveWrappingKey,
  wrapDEK,
  unwrapDEK,
} from '../passkeyCrypto';

describe('buildPRFEvalExtension — web BufferSource salt', () => {
  it('eval salt is a 32-byte Uint8Array (BufferSource for the real WebAuthn API)', () => {
    const first = buildPRFEvalExtension().prf.eval.first;
    expect(first).toBeInstanceOf(Uint8Array);
    expect((first as Uint8Array).byteLength).toBe(32);
  });

  it('the salt is fixed/deterministic across calls', () => {
    const a = new Uint8Array(buildPRFEvalExtension().prf.eval.first as Uint8Array);
    const b = new Uint8Array(buildPRFEvalExtension().prf.eval.first as Uint8Array);
    expect(a).toEqual(b);
  });
});

describe('getPRFOutput — normalize the WebAuthn ArrayBuffer', () => {
  it('ArrayBuffer results.first passes through unchanged', () => {
    const buf = crypto.getRandomValues(new Uint8Array(32)).buffer;
    const ext = {
      prf: { results: { first: buf } },
    } as unknown as AuthenticationExtensionsClientOutputs;
    const out = getPRFOutput(ext);
    expect(out).not.toBeNull();
    expect(new Uint8Array(out!)).toEqual(new Uint8Array(buf));
  });

  it('a typed-array view is normalized to its bytes', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const ext = {
      prf: { results: { first: bytes } },
    } as unknown as AuthenticationExtensionsClientOutputs;
    expect(new Uint8Array(getPRFOutput(ext)!)).toEqual(bytes);
  });

  it('absent / empty PRF → null (the "PRF unusable" signal)', () => {
    expect(getPRFOutput({} as AuthenticationExtensionsClientOutputs)).toBeNull();
    const emptyBuf = {
      prf: { results: { first: new ArrayBuffer(0) } },
    } as unknown as AuthenticationExtensionsClientOutputs;
    expect(getPRFOutput(emptyBuf)).toBeNull();
  });
});

describe('wrap → unwrap round-trip yields a usable family key', () => {
  it('a DEK wrapped from a PRF output unwraps to a key that decrypts what the original encrypted', async () => {
    const familyKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ]);
    const prfOutput = crypto.getRandomValues(new Uint8Array(32)).buffer;
    const hkdfSalt = generateHKDFSalt();

    // Wrap with a key derived at "enable" time…
    const wrappingKeyA = await deriveWrappingKey(prfOutput, hkdfSalt);
    const wrapped = await wrapDEK(familyKey, wrappingKeyA);

    // …unwrap with a key re-derived at "unlock" time from the same PRF output + salt.
    const wrappingKeyB = await deriveWrappingKey(prfOutput, hkdfSalt);
    const unwrapped = await unwrapDEK(wrapped, wrappingKeyB);

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      familyKey,
      new TextEncoder().encode('every bean counts')
    );
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, unwrapped, ciphertext);
    expect(new TextDecoder().decode(plaintext)).toBe('every bean counts');
  });
});
