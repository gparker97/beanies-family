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
import { describe, it, expect, beforeEach, vi } from 'vitest';

const logEvent = vi.hoisted(() => vi.fn());
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent }));

import {
  createBeanpodV4,
  parseBeanpodV4,
  tryUnwrapFamilyKey,
  unwrapWrappedKey,
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
  exportFamilyKey,
  deriveMemberKey,
  wrapFamilyKey,
} from '@/services/crypto/familyKeyService';
import { LEGACY_ITERATIONS } from '@/services/crypto/kdfParams';
import { bufferToBase64 } from '@/utils/encoding';
import type { BeanpodFileV4, WrappedMemberKey } from '@/types/syncFileV4';

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

  describe('round 3, item 7: a document holding Counters is a 6.0 file', () => {
    const lineage = { id: 'L', seq: 1 };
    it('derives 6.0 from hasCounters, outranking a lineage or a backup', () => {
      expect(beanpodVersionFor(null, { hasCounters: true })).toBe('6.0');
      expect(beanpodVersionFor(lineage, { hasCounters: true })).toBe('6.0');
      expect(beanpodVersionFor(null, { compactionBackup: true, hasCounters: true })).toBe('6.0');
      expect(beanpodVersionFor(lineage, { hasCounters: false })).toBe('5.0');
      expect(beanpodVersionFor(null, { hasCounters: false })).toBe('4.0');
    });
    it('reEncryptEnvelope writes 6.0, and this build reads it back', () => {
      const env = JSON.parse(
        reEncryptEnvelope(
          {
            version: '5.0',
            familyId: 'f',
            familyName: 'F',
            keyId: 'k',
            wrappedKeys: {},
            passkeyWrappedKeys: {},
            inviteKeys: {},
            encryptedPayload: 'old',
          },
          'p',
          lineage,
          { hasCounters: true }
        )
      );
      expect(env.version).toBe('6.0');
      expect(parseBeanpodV4(JSON.stringify(env)).version).toBe('6.0');
    });
  });

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
        parseBeanpodV4(JSON.stringify({ version: '7.0', ...fields }));
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
      expect(e.fileVersion).toBe('7.0');
      expect(e.blockDetail).toBe('version=7.0');
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

    it('READS a 6.0 envelope (the reader half of the #117 flip gate) but never derives one', () => {
      // Shipped a release ahead of any writer (ADR-036 pattern). The writer derivation
      // must stay 4.0/5.0 until the flip itself — a 6.0 written now would lock every
      // build older than this one out of the family.
      expect(parseBeanpodV4(JSON.stringify({ version: '6.0', ...fields })).version).toBe('6.0');
      expect(beanpodVersionFor(null)).toBe('4.0');
      expect(beanpodVersionFor({ seq: 1 } as never)).toBe('5.0');
      expect(beanpodVersionFor(null, { compactionBackup: true })).toBe('5.0');
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

  /**
   * A member wrap. With no `iterations` it is written exactly as a pre-ADR-041 build did
   * (legacy 100k, no field); with one it records the count it was made at.
   */
  async function makeWrap(password: string, iterations?: number): Promise<WrappedMemberKey> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const memberKey = await deriveMemberKey(password, salt, {
      profile: 'secret',
      iterations: iterations ?? LEGACY_ITERATIONS,
    });
    const wrapped = await wrapFamilyKey(familyKey, memberKey);
    return {
      wrapped,
      salt: bufferToBase64(salt),
      ...(iterations !== undefined ? { iterations } : {}),
    };
  }

  async function buildEnvelopeWithMembers(
    members: Array<{ memberId: string; password: string; iterations?: number }>,
    extra: Partial<BeanpodFileV4> = {}
  ): Promise<BeanpodFileV4> {
    const wrappedKeys: Record<string, WrappedMemberKey> = {};
    for (const m of members) {
      wrappedKeys[m.memberId] = await makeWrap(m.password, m.iterations);
    }
    return {
      version: '4.0',
      familyId: 'fam-test',
      familyName: 'Test',
      encryptedPayload: '',
      wrappedKeys,
      ...extra,
    } as BeanpodFileV4;
  }

  // ── unwrapWrappedKey: read-both + loud on a broken entry (ADR-041) ──

  describe('unwrapWrappedKey reads the recorded count', () => {
    beforeEach(() => logEvent.mockClear());

    it('a legacy entry with no iterations still unwraps', async () => {
      const entry = await makeWrap('pw');
      expect(entry).not.toHaveProperty('iterations');
      const fk = await unwrapWrappedKey(entry, 'pw');
      expect(fk).not.toBeNull();
      expect(await exportFamilyKey(fk!)).toEqual(await exportFamilyKey(familyKey));
    });

    it('an entry derives at the count it records, not a constant', async () => {
      const entry = await makeWrap('pw', 2_000);
      expect(await unwrapWrappedKey(entry, 'pw')).not.toBeNull();
      // The same wrap read as legacy (field dropped) does not open: the count is honoured.
      const { iterations: _dropped, ...asLegacy } = entry;
      expect(await unwrapWrappedKey(asLegacy, 'pw')).toBeNull();
    });

    it('a wrong password is a quiet null (no telemetry: it is the expected miss)', async () => {
      const entry = await makeWrap('pw');
      expect(await unwrapWrappedKey(entry, 'nope')).toBeNull();
      expect(logEvent).not.toHaveBeenCalled();
    });

    it('the passphrase wrap is attributed as kind passphrase, never member', async () => {
      logEvent.mockClear();
      const r = await unwrapWrappedKey(
        {
          wrapped: 'AAAA',
          salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
          iterations: 'abc' as unknown as number,
        },
        'pw',
        'passphrase'
      );
      expect(r).toBeNull();
      expect(logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({ action: 'wrap_entry_unusable', kind: 'passphrase' }),
        })
      );
    });

    it('a corrupt iterations is null for the caller but logged wrap_entry_unusable', async () => {
      const entry = { ...(await makeWrap('pw')), iterations: 'lots' as unknown as number };
      expect(await unwrapWrappedKey(entry, 'pw')).toBeNull();
      expect(logEvent).toHaveBeenCalledTimes(1);
      expect(logEvent.mock.calls[0]![0]).toMatchObject({
        level: 'warn',
        surface: 'login-flow',
        context: { action: 'wrap_entry_unusable', error_code: 'KdfParamsError', kind: 'member' },
      });
    });

    it('a count over the DoS bound is refused before any derivation', async () => {
      const entry = { ...(await makeWrap('pw')), iterations: 50_000_000 };
      const spy = vi.spyOn(crypto.subtle, 'deriveKey');
      try {
        expect(await unwrapWrappedKey(entry, 'pw')).toBeNull();
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
      expect(logEvent.mock.calls[0]![0]).toMatchObject({
        context: { action: 'wrap_entry_unusable', error_code: 'KdfParamsError' },
      });
    });
  });

  describe('tryUnwrapFamilyKey detects same-password collisions', () => {
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

    it('throws a typed UnlockFailedError carrying a translatable key, not a raw message', async () => {
      const envelope = await buildEnvelopeWithMembers([
        { memberId: 'alice', password: 'alice-pw' },
      ]);

      // The MESSAGE is deliberately no longer the user-facing sentence: it used to be
      // returned up the stack and rendered verbatim, putting untranslated English crypto
      // internals on the login gate. Callers render `messageKey` instead.
      await expect(tryUnwrapFamilyKey(envelope, 'wrong')).rejects.toMatchObject({
        name: 'UnlockFailedError',
        reason: 'incorrect-secret',
        messageKey: 'password.decryptionError',
      });
    });

    it('throws no-candidates, not "incorrect", when the envelope has nothing to try', async () => {
      // Distinct reasons because they mean different things to the user: one is "try
      // again", the other is "this file cannot be opened with a password at all".
      const envelope = await buildEnvelopeWithMembers([]);

      await expect(tryUnwrapFamilyKey(envelope, 'anything')).rejects.toMatchObject({
        name: 'UnlockFailedError',
        reason: 'no-candidates',
      });
    });
  });

  // ── tryUnwrapFamilyKey runs member tries concurrently, semantics unchanged ──

  describe('tryUnwrapFamilyKey tries member wraps in parallel', () => {
    it('starts every member derivation before any finishes', async () => {
      const envelope = await buildEnvelopeWithMembers([
        { memberId: 'alice', password: 'a' },
        { memberId: 'bob', password: 'b' },
        { memberId: 'carol', password: 'c' },
      ]);
      const real = crypto.subtle.deriveKey.bind(crypto.subtle);
      let inFlight = 0;
      let peak = 0;
      const spy = vi
        .spyOn(crypto.subtle, 'deriveKey')
        .mockImplementation(async (...args: Parameters<SubtleCrypto['deriveKey']>) => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          try {
            return await real(...args);
          } finally {
            inFlight -= 1;
          }
        });
      try {
        const result = await tryUnwrapFamilyKey(envelope, 'b');
        expect(result.memberIds).toEqual(['bob']);
      } finally {
        spy.mockRestore();
      }
      expect(peak).toBe(3);
    });

    it('reports collisions in envelope order (not completion order)', async () => {
      const envelope = await buildEnvelopeWithMembers([
        { memberId: 'zed', password: 'shared', iterations: 20_000 },
        { memberId: 'amy', password: 'shared' },
        { memberId: 'bob', password: 'other' },
        { memberId: 'cat', password: 'shared', iterations: 1_000 },
      ]);
      const result = await tryUnwrapFamilyKey(envelope, 'shared');
      expect(result.memberIds).toEqual(['zed', 'amy', 'cat']);
      expect(result.viaRecoveryPassphrase).toBeUndefined();
    });

    it('opens a mix of legacy and recorded-count wraps', async () => {
      const envelope = await buildEnvelopeWithMembers([
        { memberId: 'old', password: 'old-pw' },
        { memberId: 'new', password: 'new-pw', iterations: 3_000 },
      ]);
      expect((await tryUnwrapFamilyKey(envelope, 'old-pw')).memberIds).toEqual(['old']);
      expect((await tryUnwrapFamilyKey(envelope, 'new-pw')).memberIds).toEqual(['new']);
    });

    it('one corrupt member entry does not block the others', async () => {
      const envelope = await buildEnvelopeWithMembers([
        { memberId: 'broken', password: 'pw' },
        { memberId: 'fine', password: 'pw' },
      ]);
      envelope.wrappedKeys.broken!.iterations = -1;
      expect((await tryUnwrapFamilyKey(envelope, 'pw')).memberIds).toEqual(['fine']);
    });

    it('a member wrap still shadows an identical recovery passphrase', async () => {
      const envelope = await buildEnvelopeWithMembers([{ memberId: 'alice', password: 'same' }], {
        recoveryPassphrase: await makeWrap('same', 2_000),
      });
      const result = await tryUnwrapFamilyKey(envelope, 'same');
      expect(result).toMatchObject({ memberIds: ['alice'] });
      expect(result.viaRecoveryPassphrase).toBeUndefined();
    });

    it('falls through to the passphrase (at its recorded count) when no member matches', async () => {
      const envelope = await buildEnvelopeWithMembers([{ memberId: 'alice', password: 'a' }], {
        recoveryPassphrase: await makeWrap('family-phrase', 2_000),
      });
      const result = await tryUnwrapFamilyKey(envelope, 'family-phrase');
      expect(result).toMatchObject({ memberIds: [], viaRecoveryPassphrase: true });
    });
  });
});
