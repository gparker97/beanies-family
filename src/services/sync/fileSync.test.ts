// @vitest-environment node
/**
 * fileSync V4 format — pure envelope + key helpers.
 *
 * ADR-032: encryption, decryption, and the Automerge doc round-trip moved into
 * the worker (`worker/docOps.ts` decrypt/load/save/merge; `worker/cache.ts`
 * CorruptPayloadError guard) and are covered by the worker suite. fileSync now
 * owns only the main-thread PURE helpers: envelope assembly (`createBeanpodV4`),
 * parse/validate (`parseBeanpodV4`, `detectFileVersion`), and key unwrap
 * (`tryUnwrapFamilyKey`). Those are what this file exercises.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createBeanpodV4, parseBeanpodV4, detectFileVersion, tryUnwrapFamilyKey } from './fileSync';
import {
  generateFamilyKey,
  deriveMemberKey,
  wrapFamilyKey,
} from '@/services/crypto/familyKeyService';
import { bufferToBase64 } from '@/utils/encoding';
import type { BeanpodFileV4 } from '@/types/syncFileV4';

describe('fileSync V4 format', () => {
  let familyKey: CryptoKey;

  beforeEach(async () => {
    familyKey = await generateFamilyKey();
  });

  // ── createBeanpodV4 envelope assembly ────────────────────────────
  //
  // Post-migration this is pure assembly: the worker hands main the base64
  // `encryptedPayload`; main wraps it with the key dicts (which never leave
  // main). It no longer reads the doc singleton or encrypts.

  describe('createBeanpodV4 assembles a parseable envelope', () => {
    it('round-trips through parseBeanpodV4 preserving all fields', () => {
      const wrappedKeys = { 'm-1': { wrapped: 'w', salt: 's' } };
      const json = createBeanpodV4('fam-1', 'Test Family', 'base64-payload==', wrappedKeys);
      const envelope = parseBeanpodV4(json);

      expect(envelope.version).toBe('4.0');
      expect(envelope.familyId).toBe('fam-1');
      expect(envelope.familyName).toBe('Test Family');
      expect(envelope.encryptedPayload).toBe('base64-payload==');
      expect(envelope.wrappedKeys).toEqual(wrappedKeys);
      expect(envelope.keyId).toBeTruthy(); // generated
      // Optional dicts default to empty objects.
      expect(envelope.passkeyWrappedKeys).toEqual({});
      expect(envelope.inviteKeys).toEqual({});
    });

    it('carries passkey + invite key dicts when provided', () => {
      const json = createBeanpodV4(
        'fam-2',
        'Fam',
        'payload',
        { 'm-1': { wrapped: 'w', salt: 's' } },
        { cred1: { wrapped: 'pw', hkdfSalt: 'hs' } },
        { tok1: { wrapped: 'iw', salt: 'is', expiresAt: '2099-01-01' } }
      );
      const envelope = parseBeanpodV4(json);
      expect(envelope.passkeyWrappedKeys.cred1!.wrapped).toBe('pw');
      expect(envelope.inviteKeys.tok1!.wrapped).toBe('iw');
    });
  });

  // ── parseBeanpodV4 rejects invalid input ─────────────────────────

  describe('parseBeanpodV4 rejects invalid input', () => {
    it('throws on invalid JSON', () => {
      expect(() => parseBeanpodV4('not json {')).toThrow('Invalid JSON');
    });

    it('throws on wrong version', () => {
      expect(() =>
        parseBeanpodV4(
          JSON.stringify({
            version: '3.0',
            familyId: 'f',
            familyName: 'n',
            keyId: 'k',
            wrappedKeys: {},
            encryptedPayload: 'x',
          })
        )
      ).toThrow('Unsupported beanpod version');
    });

    it('throws on missing fields', () => {
      expect(() => parseBeanpodV4(JSON.stringify({ version: '4.0' }))).toThrow('missing familyId');

      expect(() => parseBeanpodV4(JSON.stringify({ version: '4.0', familyId: 'f' }))).toThrow(
        'missing familyName'
      );

      expect(() =>
        parseBeanpodV4(JSON.stringify({ version: '4.0', familyId: 'f', familyName: 'n' }))
      ).toThrow('missing keyId');

      expect(() =>
        parseBeanpodV4(
          JSON.stringify({
            version: '4.0',
            familyId: 'f',
            familyName: 'n',
            keyId: 'k',
          })
        )
      ).toThrow('missing encryptedPayload');

      expect(() =>
        parseBeanpodV4(
          JSON.stringify({
            version: '4.0',
            familyId: 'f',
            familyName: 'n',
            keyId: 'k',
            encryptedPayload: 'x',
          })
        )
      ).toThrow('missing wrappedKeys');
    });
  });

  // ── detectFileVersion ────────────────────────────────────────────

  describe('detectFileVersion identifies V4 format', () => {
    it('returns 4.0 for valid V4 envelope', () => {
      expect(detectFileVersion(JSON.stringify({ version: '4.0', familyId: 'f' }))).toBe('4.0');
    });

    it('returns null for invalid JSON', () => {
      expect(detectFileVersion('not json')).toBeNull();
    });

    it('returns null for wrong version', () => {
      expect(detectFileVersion(JSON.stringify({ version: '3.0' }))).toBeNull();
    });

    it('returns null for missing version', () => {
      expect(detectFileVersion(JSON.stringify({ familyId: 'f' }))).toBeNull();
    });
  });

  // ── tryUnwrapFamilyKey password-collision behavior ─────────────────

  describe('tryUnwrapFamilyKey detects same-password collisions', () => {
    async function buildEnvelopeWithMembers(
      members: Array<{ memberId: string; password: string }>
    ): Promise<BeanpodFileV4> {
      const wrappedKeys: Record<string, { wrapped: string; salt: string }> = {};
      for (const m of members) {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const memberKey = await deriveMemberKey(m.password, salt);
        const wrapped = await wrapFamilyKey(familyKey, memberKey);
        wrappedKeys[m.memberId] = { wrapped, salt: bufferToBase64(salt) };
      }
      return {
        version: '4.0',
        familyId: 'fam-test',
        familyName: 'Test',
        encryptedPayload: '',
        wrappedKeys,
      } as BeanpodFileV4;
    }

    it('returns the single matching memberId when only one member uses this password', async () => {
      const envelope = await buildEnvelopeWithMembers([
        { memberId: 'alice', password: 'alice-pw' },
        { memberId: 'bob', password: 'bob-pw' },
      ]);

      const result = await tryUnwrapFamilyKey(envelope, 'alice-pw');
      expect(result.memberIds).toEqual(['alice']);
      expect(result.familyKey).toBeDefined();
    });

    it('returns BOTH memberIds when two members share the same password', async () => {
      const envelope = await buildEnvelopeWithMembers([
        { memberId: 'alice', password: 'shared-pw' },
        { memberId: 'bob', password: 'shared-pw' },
        { memberId: 'carol', password: 'different-pw' },
      ]);

      const result = await tryUnwrapFamilyKey(envelope, 'shared-pw');
      expect(result.memberIds.sort()).toEqual(['alice', 'bob']);
    });

    it('throws Incorrect password when no member uses this password', async () => {
      const envelope = await buildEnvelopeWithMembers([
        { memberId: 'alice', password: 'alice-pw' },
      ]);

      await expect(tryUnwrapFamilyKey(envelope, 'wrong')).rejects.toThrow('Incorrect password');
    });
  });
});
