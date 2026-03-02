// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  generateFamilyKey,
  exportFamilyKey,
  importFamilyKey,
  deriveMemberKey,
  wrapFamilyKey,
  unwrapFamilyKey,
  encryptPayload,
  decryptPayload,
  SALT_LENGTH,
} from '../familyKeyService';

describe('familyKeyService', () => {
  // ── Key generation ──────────────────────────────────────────────

  describe('generateFamilyKey', () => {
    it('generates an AES-GCM key', async () => {
      const key = await generateFamilyKey();
      expect(key.type).toBe('secret');
      expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    });

    it('generates an extractable key', async () => {
      const key = await generateFamilyKey();
      expect(key.extractable).toBe(true);
    });

    it('has encrypt and decrypt usages', async () => {
      const key = await generateFamilyKey();
      expect(key.usages).toContain('encrypt');
      expect(key.usages).toContain('decrypt');
    });

    it('generates unique keys', async () => {
      const key1 = await generateFamilyKey();
      const key2 = await generateFamilyKey();
      const raw1 = await exportFamilyKey(key1);
      const raw2 = await exportFamilyKey(key2);
      expect(raw1).not.toEqual(raw2);
    });
  });

  // ── Export / import round-trip ──────────────────────────────────

  describe('exportFamilyKey / importFamilyKey', () => {
    it('round-trips through export and import', async () => {
      const original = await generateFamilyKey();
      const raw = await exportFamilyKey(original);
      expect(raw).toBeInstanceOf(Uint8Array);
      expect(raw.byteLength).toBe(32); // 256 bits

      const imported = await importFamilyKey(raw);
      expect(imported.extractable).toBe(true);

      // Prove functional equivalence: encrypt with original, decrypt with imported
      const plaintext = new TextEncoder().encode('hello family');
      const encrypted = await encryptPayload(original, plaintext);
      const decrypted = await decryptPayload(imported, encrypted);
      expect(decrypted).toEqual(plaintext);
    });
  });

  // ── deriveMemberKey ─────────────────────────────────────────────

  describe('deriveMemberKey', () => {
    it('produces deterministic keys for same password + salt', async () => {
      const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
      const key1 = await deriveMemberKey('password123', salt);
      const key2 = await deriveMemberKey('password123', salt);
      // Cannot compare CryptoKeys directly, but wrapping the same FK should produce
      // identical output
      const fk = await generateFamilyKey();
      const wrapped1 = await wrapFamilyKey(fk, key1);
      const wrapped2 = await wrapFamilyKey(fk, key2);
      expect(wrapped1).toBe(wrapped2);
    });

    it('produces different keys for different passwords', async () => {
      const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
      const fk = await generateFamilyKey();
      const key1 = await deriveMemberKey('password-A', salt);
      const key2 = await deriveMemberKey('password-B', salt);
      const wrapped1 = await wrapFamilyKey(fk, key1);
      const wrapped2 = await wrapFamilyKey(fk, key2);
      expect(wrapped1).not.toBe(wrapped2);
    });

    it('produces an AES-KW key', async () => {
      const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
      const key = await deriveMemberKey('test', salt);
      expect(key.algorithm).toMatchObject({ name: 'AES-KW', length: 256 });
      expect(key.usages).toContain('wrapKey');
      expect(key.usages).toContain('unwrapKey');
    });
  });

  // ── Wrap / unwrap round-trip ────────────────────────────────────

  describe('wrapFamilyKey / unwrapFamilyKey', () => {
    it('round-trips the family key', async () => {
      const fk = await generateFamilyKey();
      const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
      const wrappingKey = await deriveMemberKey('my-password', salt);

      const wrapped = await wrapFamilyKey(fk, wrappingKey);
      expect(typeof wrapped).toBe('string');
      expect(wrapped.length).toBeGreaterThan(0);

      const unwrapped = await unwrapFamilyKey(wrapped, wrappingKey);
      expect(unwrapped.extractable).toBe(true);

      // Functional equivalence
      const rawOriginal = await exportFamilyKey(fk);
      const rawUnwrapped = await exportFamilyKey(unwrapped);
      expect(rawUnwrapped).toEqual(rawOriginal);
    });

    it('rejects wrong wrapping key', async () => {
      const fk = await generateFamilyKey();
      const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
      const correctKey = await deriveMemberKey('correct-password', salt);
      const wrongKey = await deriveMemberKey('wrong-password', salt);

      const wrapped = await wrapFamilyKey(fk, correctKey);

      await expect(unwrapFamilyKey(wrapped, wrongKey)).rejects.toThrow();
    });
  });

  // ── Payload encryption ──────────────────────────────────────────

  describe('encryptPayload / decryptPayload', () => {
    it('round-trips binary data', async () => {
      const fk = await generateFamilyKey();
      const plaintext = new Uint8Array([1, 2, 3, 4, 5, 100, 200, 255]);

      const encrypted = await encryptPayload(fk, plaintext);
      expect(encrypted).toBeInstanceOf(Uint8Array);
      // Encrypted should be larger than plaintext (IV + ciphertext + auth tag)
      expect(encrypted.byteLength).toBeGreaterThan(plaintext.byteLength);

      const decrypted = await decryptPayload(fk, encrypted);
      expect(decrypted).toEqual(plaintext);
    });

    it('handles empty payload', async () => {
      const fk = await generateFamilyKey();
      const empty = new Uint8Array(0);

      const encrypted = await encryptPayload(fk, empty);
      const decrypted = await decryptPayload(fk, encrypted);
      expect(decrypted).toEqual(empty);
    });

    it('handles large payload', async () => {
      const fk = await generateFamilyKey();
      const large = new Uint8Array(100_000);
      // getRandomValues has a 65536 byte limit, so fill in chunks
      for (let i = 0; i < large.length; i += 65536) {
        const chunk = large.subarray(i, Math.min(i + 65536, large.length));
        crypto.getRandomValues(chunk);
      }

      const encrypted = await encryptPayload(fk, large);
      const decrypted = await decryptPayload(fk, encrypted);
      expect(decrypted).toEqual(large);
    });

    it('rejects wrong key', async () => {
      const fk1 = await generateFamilyKey();
      const fk2 = await generateFamilyKey();
      const plaintext = new TextEncoder().encode('secret data');

      const encrypted = await encryptPayload(fk1, plaintext);

      await expect(decryptPayload(fk2, encrypted)).rejects.toThrow();
    });

    it('produces different ciphertexts for same plaintext (random IV)', async () => {
      const fk = await generateFamilyKey();
      const plaintext = new TextEncoder().encode('same input');

      const encrypted1 = await encryptPayload(fk, plaintext);
      const encrypted2 = await encryptPayload(fk, plaintext);
      expect(encrypted1).not.toEqual(encrypted2);
    });
  });
});
