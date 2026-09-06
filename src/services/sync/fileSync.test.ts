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
import {
  createBeanpodV4,
  parseBeanpodV4,
  tryUnwrapFamilyKey,
  reEncryptEnvelope,
  beanpodVersionFor,
} from './fileSync';
import {
  PayloadLoadError,
  CorruptPayloadError,
  UnsupportedBeanpodVersionError,
} from '@/types/sync';
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
      const json = createBeanpodV4('fam-1', 'Test Family', 'base64-payload==', null, wrappedKeys);
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
        null,
        { 'm-1': { wrapped: 'w', salt: 's' } },
        { cred1: { wrapped: 'pw', hkdfSalt: 'hs' } },
        { tok1: { wrapped: 'iw', salt: 'is', expiresAt: '2099-01-01' } }
      );
      const envelope = parseBeanpodV4(json);
      expect(envelope.passkeyWrappedKeys.cred1!.wrapped).toBe('pw');
      expect(envelope.inviteKeys.tok1!.wrapped).toBe('iw');
    });
  });

  // ── the version: derived from the document, accepted at both values ──

  describe('beanpodVersionFor is the ONE place a version is chosen', () => {
    const lineage = { id: 'L', seq: 1 };
    it('derives 4.0 for a never-compacted document and 5.0 for a compacted one', () => {
      expect(beanpodVersionFor(null)).toBe('4.0');
      expect(beanpodVersionFor(lineage)).toBe('5.0');
    });
    it('raises the pre-compaction backup to 5.0, and cannot lower a compacted one', () => {
      // The one deliberate exception, stated as an intent rather than a
      // version, so it cannot express a downgrade at the next bump.
      expect(beanpodVersionFor(null, { compactionBackup: true })).toBe('5.0');
      expect(beanpodVersionFor(lineage, { compactionBackup: true })).toBe('5.0');
    });
  });

  describe('the writers derive the version; they never carry it', () => {
    const base = {
      version: '4.0' as const,
      familyId: 'f',
      familyName: 'n',
      keyId: 'k',
      wrappedKeys: {},
      passkeyWrappedKeys: {},
      inviteKeys: {},
      encryptedPayload: 'x',
    };
    it('reEncryptEnvelope writes 5.0 for a compacted document even when the envelope says 4.0', () => {
      // ⚠️ THE TRAP 1 PIN, at the unit level. The four kept-local termini adopt
      // the REMOTE envelope (version and all) and republish the LOCAL compacted
      // document under it. If this reads `envelope.version` the protection
      // lasts one round trip.
      const out = JSON.parse(reEncryptEnvelope(base, 'p', { id: 'L', seq: 1 }));
      expect(out.version).toBe('5.0');
    });
    it('reEncryptEnvelope writes 4.0 for a never-compacted document even when the envelope says 5.0', () => {
      // The restore direction: after a user-file adopt of the pre-compaction
      // copy the document has no lineage, whatever label the envelope carried.
      const out = JSON.parse(reEncryptEnvelope({ ...base, version: '5.0' }, 'p', null));
      expect(out.version).toBe('4.0');
    });
    it('createBeanpodV4 writes 4.0 for a lineage-less document and 5.0 for a compacted one', () => {
      expect(parseBeanpodV4(createBeanpodV4('f', 'n', 'p', null, {})).version).toBe('4.0');
      expect(parseBeanpodV4(createBeanpodV4('f', 'n', 'p', { id: 'L', seq: 2 }, {})).version).toBe(
        '5.0'
      );
    });
  });

  describe('parseBeanpodV4 accepts 5.0 and types anything newer', () => {
    const fields = {
      familyId: 'f',
      familyName: 'n',
      keyId: 'k',
      wrappedKeys: {},
      encryptedPayload: 'x',
    };
    it('accepts a 5.0 envelope with the same field checks as 4.0', () => {
      expect(parseBeanpodV4(JSON.stringify({ version: '5.0', ...fields })).version).toBe('5.0');
      expect(() => parseBeanpodV4(JSON.stringify({ version: '5.0', familyId: 'f' }))).toThrow(
        'missing familyName'
      );
    });
    it('throws a typed, non-latching, non-corruption error for a version it does not know', () => {
      // ⚠️ NEVER a CorruptPayloadError: that is the class the worker's cache
      // self-heal deletes the cache on, and "update beanies" deletes nothing.
      let err: unknown;
      try {
        parseBeanpodV4(JSON.stringify({ version: '6.0', ...fields }));
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(UnsupportedBeanpodVersionError);
      expect(err).toBeInstanceOf(PayloadLoadError);
      expect(err).not.toBeInstanceOf(CorruptPayloadError);
      const e = err as UnsupportedBeanpodVersionError;
      expect(e.step).toBe('parse');
      expect(e.latches).toBe(false);
      expect(e.keyMayBeWrong).toBe(false);
      expect(e.deviceCannotOpen).toBe(false);
      expect(e.needsAppUpdate).toBe(true);
      expect(e.fileVersion).toBe('6.0');
      expect(e.blockDetail).toBe('version=6.0');
      expect(e.name).toBe('UnsupportedBeanpodVersionError');
    });
    it('clamps a hostile version string before it can reach telemetry', () => {
      // ⚠️ `fileVersion` COMES OFF A FILE THIS BUILD DID NOT WRITE and reaches
      // the allowlisted `detail` key through `blockDetail`. A version is a short
      // token; anything else is a malformed file trying to put its own content
      // in our firehose. Clamped at the constructor, so no consumer has to.
      const hostile = 'x'.repeat(500) + ' <script>';
      let err: unknown;
      try {
        parseBeanpodV4(JSON.stringify({ version: hostile, ...fields }));
      } catch (e) {
        err = e;
      }
      const e = err as UnsupportedBeanpodVersionError;
      expect(e.fileVersion).toBe('unrecognised');
      expect(e.blockDetail).toBe('version=unrecognised');
      expect(e.message).not.toContain('script');
      // A real version is untouched.
      try {
        parseBeanpodV4(JSON.stringify({ version: '6.0.1', ...fields }));
      } catch (e2) {
        expect((e2 as UnsupportedBeanpodVersionError).blockDetail).toBe('version=6.0.1');
      }
    });

    it('still treats a missing version as not-a-beanpod, not as newer', () => {
      expect(() => parseBeanpodV4(JSON.stringify({ ...fields }))).toThrow('missing version');
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
