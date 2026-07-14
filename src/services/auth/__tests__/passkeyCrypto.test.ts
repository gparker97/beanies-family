import { describe, it, expect, vi, beforeEach } from 'vitest';

// Native seam — flip per test to exercise the platform-aware salt encoding.
const { isNativeMock } = vi.hoisted(() => ({ isNativeMock: vi.fn(() => false) }));
vi.mock('@/services/sync/capabilities', () => ({ isNative: isNativeMock }));

import {
  buildPRFEnableExtension,
  buildPRFEvalExtension,
  getPRFOutput,
  generateHKDFSalt,
  deriveWrappingKey,
  wrapDEK,
  unwrapDEK,
} from '../passkeyCrypto';
import { base64urlToBuffer } from '@/utils/encoding';

beforeEach(() => isNativeMock.mockReturnValue(false));

describe('buildPRFEnableExtension', () => {
  it('returns an enable-only PRF input ({ prf: {} }) with no eval', () => {
    expect(buildPRFEnableExtension()).toEqual({ prf: {} });
  });
});

describe('buildPRFEvalExtension — platform-aware salt encoding', () => {
  it('web: eval salt is a 32-byte Uint8Array (BufferSource for the real WebAuthn API)', () => {
    isNativeMock.mockReturnValue(false);
    const ext = buildPRFEvalExtension();
    const first = ext.prf.eval.first;
    expect(first).toBeInstanceOf(Uint8Array);
    expect((first as Uint8Array).byteLength).toBe(32);
  });

  it('native: eval salt is a base64url STRING (survives the shim JSON serialization)', () => {
    isNativeMock.mockReturnValue(true);
    const first = buildPRFEvalExtension().prf.eval.first;
    expect(typeof first).toBe('string');
    // URL-safe, unpadded
    expect(first as string).not.toMatch(/[+/=]/);
  });

  it('the native string decodes to the SAME 32 fixed bytes as the web Uint8Array', () => {
    isNativeMock.mockReturnValue(false);
    const webSalt = new Uint8Array(buildPRFEvalExtension().prf.eval.first as Uint8Array);
    isNativeMock.mockReturnValue(true);
    const nativeSalt = new Uint8Array(
      base64urlToBuffer(buildPRFEvalExtension().prf.eval.first as string)
    );
    expect(nativeSalt).toEqual(webSalt);
    expect(nativeSalt.byteLength).toBe(32);
  });

  it('the salt is stable across calls (fixed, deterministic)', () => {
    isNativeMock.mockReturnValue(true);
    expect(buildPRFEvalExtension().prf.eval.first).toBe(buildPRFEvalExtension().prf.eval.first);
  });
});

describe('getPRFOutput — normalize native string vs web buffer', () => {
  it('web ArrayBuffer results.first passes through unchanged', () => {
    const buf = crypto.getRandomValues(new Uint8Array(32)).buffer;
    const ext = {
      prf: { results: { first: buf } },
    } as unknown as AuthenticationExtensionsClientOutputs;
    const out = getPRFOutput(ext);
    expect(out).not.toBeNull();
    expect(new Uint8Array(out!)).toEqual(new Uint8Array(buf));
  });

  it('native base64url-string results.first decodes to the same bytes', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const b64url = Buffer.from(bytes).toString('base64url');
    const ext = {
      prf: { results: { first: b64url } },
    } as unknown as AuthenticationExtensionsClientOutputs;
    const out = getPRFOutput(ext);
    expect(out).not.toBeNull();
    expect(new Uint8Array(out!)).toEqual(bytes);
  });

  it('absent / empty PRF → null (the "PRF unusable" signal)', () => {
    expect(getPRFOutput({} as AuthenticationExtensionsClientOutputs)).toBeNull();
    const emptyString = {
      prf: { results: { first: '' } },
    } as unknown as AuthenticationExtensionsClientOutputs;
    expect(getPRFOutput(emptyString)).toBeNull();
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
