// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  bufferToBase64,
  base64ToBuffer,
  bufferToBase64url,
  base64urlToBuffer,
  utf8ByteLength,
} from '../encoding';

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

  describe('utf8ByteLength', () => {
    const encoderLength = (s: string) => new TextEncoder().encode(s).byteLength;

    it.each([
      ['empty', '', 0],
      ['ASCII (1 byte each)', 'beanies', 7],
      ['2-byte (é, ß)', 'éß', 4],
      ['3-byte (CJK)', '保存', 6],
      ['4-byte (emoji, a surrogate pair)', '🫘', 4],
      ['mixed', 'a é 保 🫘', 1 + 1 + 2 + 1 + 3 + 1 + 4],
    ])('%s', (_label, input, expected) => {
      expect(utf8ByteLength(input)).toBe(expected);
      expect(utf8ByteLength(input)).toBe(encoderLength(input));
    });

    it('counts a lone surrogate as the 3-byte U+FFFD that fetch actually sends', () => {
      const lone = 'a\uD83D';
      expect(utf8ByteLength(lone)).toBe(encoderLength(lone));
      expect(utf8ByteLength(lone)).toBe(4);
    });

    it('differs from string length for non-ASCII text (why it exists)', () => {
      expect('保存'.length).toBe(2);
      expect(utf8ByteLength('保存')).toBe(6);
    });
  });
});
