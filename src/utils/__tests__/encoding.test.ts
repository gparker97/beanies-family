// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { bufferToBase64, base64ToBuffer, bufferToBase64url, base64urlToBuffer } from '../encoding';

describe('encoding', () => {
  describe('bufferToBase64 / base64ToBuffer', () => {
    it('round-trips arbitrary binary data', () => {
      const original = new Uint8Array([0, 1, 127, 128, 255, 42, 99]);
      const b64 = bufferToBase64(original);
      const restored = new Uint8Array(base64ToBuffer(b64));
      expect(restored).toEqual(original);
    });

    it('handles empty buffer', () => {
      const empty = new Uint8Array(0);
      const b64 = bufferToBase64(empty);
      const restored = new Uint8Array(base64ToBuffer(b64));
      expect(restored).toEqual(empty);
    });

    it('accepts ArrayBuffer input', () => {
      const bytes = new Uint8Array([10, 20, 30]);
      const b64 = bufferToBase64(bytes.buffer as ArrayBuffer);
      const restored = new Uint8Array(base64ToBuffer(b64));
      expect(restored).toEqual(bytes);
    });
  });

  describe('bufferToBase64url / base64urlToBuffer', () => {
    it('round-trips arbitrary binary data', () => {
      const original = new Uint8Array([0, 1, 127, 128, 255, 42, 99]);
      const b64url = bufferToBase64url(original);
      const restored = new Uint8Array(base64urlToBuffer(b64url));
      expect(restored).toEqual(original);
    });

    it('produces URL-safe output (no +, /, = chars)', () => {
      // Use bytes that would produce +, /, and = in standard base64
      const data = new Uint8Array(256);
      for (let i = 0; i < 256; i++) data[i] = i;
      const b64url = bufferToBase64url(data);
      expect(b64url).not.toMatch(/[+/=]/);
    });

    it('handles empty buffer', () => {
      const empty = new Uint8Array(0);
      const b64url = bufferToBase64url(empty);
      const restored = new Uint8Array(base64urlToBuffer(b64url));
      expect(restored).toEqual(empty);
    });
  });
});
