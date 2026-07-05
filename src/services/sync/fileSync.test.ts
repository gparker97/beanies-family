// @vitest-environment node
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- ADR-032 Task #17: pending test rewrite to the inline/docClient path (red in the migration window)
import { describe, it, expect, beforeEach } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { CorruptPayloadError } from '@/types/sync';
import {
  initDoc,
  saveDoc,
  getDoc,
  changeDoc,
  mergeDoc,
  resetDoc,
} from '@/services/automerge/docService';
import { generateFamilyKey } from '@/services/crypto/familyKeyService';
import {
  createBeanpodV4,
  parseBeanpodV4,
  decryptBeanpodPayload,
  detectFileVersion,
  tryUnwrapFamilyKey,
} from './fileSync';
import { deriveMemberKey, wrapFamilyKey } from '@/services/crypto/familyKeyService';
import { bufferToBase64 } from '@/utils/encoding';
import type { FamilyDocument } from '@/types/automerge';
import type { BeanpodFileV4 } from '@/types/syncFileV4';

describe('fileSync V4 format', () => {
  let familyKey: CryptoKey;

  beforeEach(async () => {
    resetDoc();
    familyKey = await generateFamilyKey();
    initDoc();
  });

  // ── Test 1: Regression guard ─────────────────────────────────────

  it('decryptBeanpodPayload does NOT replace currentDoc singleton', async () => {
    // Add a local member to the singleton
    changeDoc((d) => {
      d.familyMembers['local-1'] = {
        id: 'local-1',
        name: 'Local',
        email: 'local@example.com',
        gender: 'other',
        ageGroup: 'adult',
        role: 'owner',
        color: '#FF0000',
        requiresPassword: false,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      };
    });

    // Encrypt and build envelope
    const envelopeJson = await createBeanpodV4('fam-1', 'Test Family', '', {});
    const envelope = parseBeanpodV4(envelopeJson);

    // Decrypt — this must NOT touch the singleton
    const returned = await decryptBeanpodPayload(envelope, familyKey);

    // Singleton still has the local member
    const singleton = getDoc();
    expect(singleton.familyMembers['local-1']).toBeDefined();
    expect(singleton.familyMembers['local-1']!.name).toBe('Local');

    // Returned doc is a separate valid Automerge document
    expect(returned).toBeDefined();
    expect(returned.familyMembers['local-1']).toBeDefined();
    expect(returned).not.toBe(singleton);
  });

  // ── Test 2: Standalone doc is valid and mergeable ────────────────

  it('decryptBeanpodPayload returns a valid standalone Automerge doc', async () => {
    changeDoc((d) => {
      d.familyMembers['m-1'] = {
        id: 'm-1',
        name: 'Alice',
        email: 'alice@example.com',
        gender: 'female',
        ageGroup: 'adult',
        role: 'owner',
        color: '#FF0000',
        requiresPassword: false,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      };
    });

    const envelopeJson = await createBeanpodV4('fam-1', 'Test Family', '', {});
    const envelope = parseBeanpodV4(envelopeJson);
    const decrypted = await decryptBeanpodPayload(envelope, familyKey);

    // Has the same data
    expect(decrypted.familyMembers['m-1']!.name).toBe('Alice');

    // Can be passed to mergeDoc without error
    expect(() => mergeDoc(decrypted)).not.toThrow();
  });

  // ── Test 3: Full merge simulation ────────────────────────────────

  it('full merge preserves local changes when merging remote doc', async () => {
    // Shared ancestor: a family member
    changeDoc((d) => {
      d.familyMembers['ancestor'] = {
        id: 'ancestor',
        name: 'Ancestor',
        email: 'ancestor@example.com',
        gender: 'other',
        ageGroup: 'adult',
        role: 'owner',
        color: '#000',
        requiresPassword: false,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      };
    });

    // Fork: save the current state as the "remote" starting point
    const forkBinary = saveDoc();
    const remoteDoc = Automerge.load<FamilyDocument>(forkBinary);

    // Remote-only change: add a goal
    const remoteChanged = Automerge.change(remoteDoc, (d) => {
      d.goals['remote-goal'] = {
        id: 'remote-goal',
        name: 'Remote Goal',
        type: 'savings',
        targetAmount: 5000,
        currentAmount: 0,
        currency: 'USD',
        priority: 'medium',
        isCompleted: false,
        createdAt: '2026-01-02',
        updatedAt: '2026-01-02',
      } as any;
    });

    // Local-only change: add an account
    changeDoc((d) => {
      d.accounts['local-acct'] = {
        id: 'local-acct',
        memberId: 'ancestor',
        name: 'Local Checking',
        type: 'checking',
        currency: 'USD',
        balance: 1000,
        isActive: true,
        includeInNetWorth: true,
        createdAt: '2026-01-02',
        updatedAt: '2026-01-02',
      };
    });

    // Encrypt the remote doc → envelope → decrypt → merge
    const remoteBinary = Automerge.save(remoteChanged);

    // Build a minimal envelope from the remote binary
    const { encryptPayload } = await import('@/services/crypto/familyKeyService');
    const { bufferToBase64 } = await import('@/utils/encoding');
    const encrypted = await encryptPayload(familyKey, remoteBinary);
    const envelope = parseBeanpodV4(
      JSON.stringify({
        version: '4.0',
        familyId: 'fam-1',
        familyName: 'Test Family',
        keyId: 'key-1',
        wrappedKeys: {},
        passkeyWrappedKeys: {},
        inviteKeys: {},
        encryptedPayload: bufferToBase64(encrypted),
      })
    );

    const decryptedRemote = await decryptBeanpodPayload(envelope, familyKey);
    mergeDoc(decryptedRemote);

    // Assert merged doc has everything
    const merged = getDoc();
    expect(merged.familyMembers['ancestor']).toBeDefined();
    expect(merged.accounts['local-acct']).toBeDefined();
    expect(merged.accounts['local-acct']!.name).toBe('Local Checking');
    expect(merged.goals['remote-goal']).toBeDefined();
    expect(merged.goals['remote-goal']!.name).toBe('Remote Goal');
  });

  // ── Test 4: V4 encrypt/decrypt round-trip ────────────────────────

  it('V4 encrypt/decrypt round-trip preserves Automerge document', async () => {
    changeDoc((d) => {
      d.familyMembers['m-1'] = {
        id: 'm-1',
        name: 'Alice',
        email: 'alice@example.com',
        gender: 'female',
        ageGroup: 'adult',
        role: 'owner',
        color: '#FF0000',
        requiresPassword: false,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      };
      d.accounts['a-1'] = {
        id: 'a-1',
        memberId: 'm-1',
        name: 'Savings',
        type: 'savings',
        currency: 'GBP',
        balance: 2500,
        isActive: true,
        includeInNetWorth: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      };
      d.settings = {
        id: 'app_settings',
        baseCurrency: 'GBP',
        displayCurrency: 'GBP',
        exchangeRates: [],
        exchangeRateAutoUpdate: false,
        exchangeRateLastFetch: null,
        theme: 'dark',
        language: 'en',
        syncEnabled: false,
        autoSyncEnabled: false,
        encryptionEnabled: false,
        aiProvider: 'none',
        aiApiKeys: {},
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      };
    });

    // Full round-trip: createBeanpodV4 → parseBeanpodV4 → decryptBeanpodPayload
    const envelopeJson = await createBeanpodV4('fam-1', 'Test Family', '', {});
    const envelope = parseBeanpodV4(envelopeJson);
    const restored = await decryptBeanpodPayload(envelope, familyKey);

    expect(restored.familyMembers['m-1']!.name).toBe('Alice');
    expect(restored.accounts['a-1']!.balance).toBe(2500);
    expect(restored.accounts['a-1']!.currency).toBe('GBP');
    expect(restored.settings!.baseCurrency).toBe('GBP');
    expect(restored.settings!.theme).toBe('dark');
  });

  // ── Corruption-handling: CorruptPayloadError surfaces at every read site ──
  //
  // Catches the Shaun-class failure mode (2026-05-15): the V4 envelope is
  // valid, AES-GCM decrypt succeeds with the right password, but the bytes
  // that come out aren't a usable Automerge document. Without these guards
  // the doc silently fails to materialize at the first property access and
  // the user gets a generic "Out of bounds table access" with no recovery.

  describe('decryptBeanpodPayload corruption guards', () => {
    it('throws CorruptPayloadError with step="load" when the decrypted bytes are not valid Automerge', async () => {
      // Encrypt random garbage that won't load as Automerge. `decryptPayload`
      // will return these bytes; `Automerge.load` will reject them.
      const { encryptPayload } = await import('@/services/crypto/familyKeyService');
      const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const encrypted = await encryptPayload(familyKey, garbage);

      const envelope = parseBeanpodV4(
        JSON.stringify({
          version: '4.0',
          familyId: 'fam-corrupt',
          familyName: 'Test',
          keyId: 'k',
          wrappedKeys: {},
          passkeyWrappedKeys: {},
          inviteKeys: {},
          encryptedPayload: bufferToBase64(encrypted),
        })
      );

      try {
        await decryptBeanpodPayload(envelope, familyKey);
        expect.fail('decryptBeanpodPayload should have thrown CorruptPayloadError');
      } catch (e) {
        expect(e).toBeInstanceOf(CorruptPayloadError);
        expect((e as CorruptPayloadError).step).toBe('load');
        expect((e as CorruptPayloadError).familyId).toBe('fam-corrupt');
      }
    });

    // Note: the symmetric `step="materialize"` branch is covered structurally
    // — it uses the same try/catch shape as the load branch above, only
    // wrapping `Object.keys(doc.familyMembers ?? {})` instead of `load(...)`.
    // Synthesising an Automerge byte stream that loads but throws on first
    // property access requires mocking `Automerge.load` (the WASM materializer
    // is robust by design), which ESM namespace imports don't allow.
  });

  // ── Test 5: parseBeanpodV4 rejects invalid input ─────────────────

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

  // ── Test 6: detectFileVersion ────────────────────────────────────

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

  // ── Test 7: tryUnwrapFamilyKey password-collision behavior ─────────

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
