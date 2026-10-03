/**
 * Multi-family (multi-tenant) isolation tests.
 *
 * The cross-family SAVE and ENVELOPE paths are real tests (audit C3, 2026-10-03): loading
 * family B's file while signed into A used to union A's keys into B's envelope, and a save
 * landing mid-switch could write one household's pod through the other's provider.
 *
 * The rest are still TODO: they validated isolation via direct IndexedDB access
 * (`getDatabase()`), which the Automerge data layer no longer exposes; they need rewriting
 * against the per-family Automerge persistence layer.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BeanpodFileV4 } from '@/types/syncFileV4';
import { mergeEnvelopes } from '@/services/sync/envelopeMerge';

vi.mock('@/services/sync/capabilities', () => ({
  supportsFileSystemAccess: vi.fn(() => false),
  isNative: vi.fn(() => false),
}));
vi.mock('@/services/sync/fileHandleStore', () => ({
  getFileHandle: vi.fn(async () => null),
  verifyPermission: vi.fn(async () => true),
  getProviderConfig: vi.fn(async () => null),
}));
vi.mock('@/services/sync/fileSync', async (importOriginal) => ({
  beanpodVersionFor: (await importOriginal<typeof import('@/services/sync/fileSync')>())
    .beanpodVersionFor,
  reEncryptEnvelope: vi.fn((env: BeanpodFileV4) => JSON.stringify(env)),
  parseBeanpodV4: vi.fn((text: string) => JSON.parse(text) as BeanpodFileV4),
  openFilePicker: vi.fn(async () => null),
}));
vi.mock('@/services/indexeddb/database', () => ({
  // The registry's active family; the provider binds to the id passed to setProvider.
  getActiveFamilyId: vi.fn(() => 'fam-A'),
}));
vi.mock('@/services/familyContext', () => ({ createFamilyWithId: vi.fn(async () => {}) }));
vi.mock('@/services/automerge/worker/docClient', () => ({
  setFamilyKey: vi.fn(),
  persistEnvelope: vi.fn(async () => {}),
  exportEncryptedPayload: vi.fn(async () => ({ payload: 'p==', heads: ['h'], lineage: null })),
  mergeRemoteEnvelope: vi.fn(async () => ({ action: 'merged', dirty: false, remoteHeads: ['h'] })),
  setLocalChangeHandler: vi.fn(),
  setCachePersistFailedHandler: vi.fn(),
  noteRemoteBaseline: vi.fn(),
  logMergeTerminus: vi.fn(),
  getHeads: vi.fn(async () => ({ heads: ['h'] })),
}));
vi.mock('@/services/sync/offlineQueue', () => ({
  enqueueOfflineSave: vi.fn(),
  setFlushProvider: vi.fn(),
  setResaveHandler: vi.fn(),
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/utils/beanpodFilename', () => ({ isConflictFilename: vi.fn(() => false) }));

import * as syncService from '@/services/sync/syncService';
import * as docClient from '@/services/automerge/worker/docClient';
import { logEvent } from '@/services/telemetry';

function envelopeOf(familyId: string, over: Partial<BeanpodFileV4> = {}): BeanpodFileV4 {
  return {
    version: '4.0',
    familyId,
    familyName: familyId,
    keyId: `k-${familyId}`,
    wrappedKeys: { [`${familyId}-member`]: { wrapped: `${familyId}-wrap`, salt: 's' } },
    passkeyWrappedKeys: {},
    inviteKeys: {},
    encryptedPayload: 'payload',
    ...over,
  };
}

function driveProvider(remote: BeanpodFileV4) {
  return {
    type: 'google_drive' as const,
    read: vi.fn(async () => JSON.stringify(remote)),
    write: vi.fn(async () => ({ revision: null })),
    getLastModified: vi.fn(async () => '2026-10-03T00:00:00Z'),
    getDisplayName: () => 'pod.beanpod',
    getFileId: () => 'file',
    getAccountEmail: () => null,
    supportsLocalPolling: () => false,
  };
}

const KEY = {} as CryptoKey;

describe('Multi-Family Database Isolation', () => {
  it.todo('should create separate Automerge documents for different families');

  describe('switching families does not leak one household into another (audit C3)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      syncService.reset();
    });

    it("family A's wraps, invites and recovery passphrase never enter family B's envelope", () => {
      const a = envelopeOf('fam-A', {
        inviteKeys: { inv: { salt: 's', wrapped: 'A-inv', expiresAt: '2026-11-01T00:00:00Z' } },
        recoveryPassphrase: { wrapped: 'A-pp', salt: 's', createdAt: '2026-10-01T00:00:00Z' },
      });
      const { envelope, needsPublish } = mergeEnvelopes(envelopeOf('fam-B'), a);
      expect(Object.keys(envelope.wrappedKeys)).toEqual(['fam-B-member']);
      expect(envelope.inviteKeys).toEqual({});
      expect(envelope.recoveryPassphrase).toBeUndefined();
      expect(needsPublish).toBe(false);
    });

    it("a save holding B's envelope is REFUSED through A's provider, and nothing is written", async () => {
      const provider = driveProvider(envelopeOf('fam-A'));
      syncService.setProvider(provider as never, 'fam-A');
      syncService.setFamilyKey(KEY, envelopeOf('fam-B'));

      await expect(syncService.save()).resolves.toBe(false);
      expect(provider.write).not.toHaveBeenCalled();
      expect(provider.read).not.toHaveBeenCalled();
      expect(syncService.getConsecutiveSaveFailures()).toBe(1);
      expect(vi.mocked(logEvent)).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: 'sync-save',
          context: expect.objectContaining({ action: 'family-mismatch' }),
        })
      );
    });

    it('a remote file of ANOTHER family behind this provider is refused before any merge', async () => {
      // The envelope and the provider binding agree (fam-A), but the bytes behind the
      // provider are family B's pod.
      const provider = driveProvider(envelopeOf('fam-B'));
      syncService.setProvider(provider as never, 'fam-A');
      syncService.setFamilyKey(KEY, envelopeOf('fam-A'));

      await expect(syncService.save()).resolves.toBe(false);
      expect(docClient.mergeRemoteEnvelope).not.toHaveBeenCalled();
      expect(provider.write).not.toHaveBeenCalled();
      // And A's session envelope was not replaced by B's.
      expect(syncService.getEnvelope()?.familyId).toBe('fam-A');
    });

    it('a save asked for during a cross-family HOLD does not run, and re-arms on release', async () => {
      vi.useFakeTimers();
      try {
        const provider = driveProvider(envelopeOf('fam-A'));
        syncService.setProvider(provider as never, 'fam-A');
        syncService.setFamilyKey(KEY, envelopeOf('fam-A'));

        const release = syncService.holdSaves('cross-family-decrypt');
        syncService.triggerDebouncedSave();
        await vi.advanceTimersByTimeAsync(5_000);
        expect(provider.write).not.toHaveBeenCalled();
        // A direct save is refused too, without counting as a failure.
        await expect(syncService.save()).resolves.toBe(false);
        expect(syncService.getConsecutiveSaveFailures()).toBe(0);

        release();
        release(); // idempotent
        await vi.advanceTimersByTimeAsync(5_000);
        expect(provider.write).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('reset() drops every hold, so a stale release cannot re-arm into the next family', async () => {
      vi.useFakeTimers();
      try {
        const provider = driveProvider(envelopeOf('fam-A'));
        syncService.setProvider(provider as never, 'fam-A');
        syncService.setFamilyKey(KEY, envelopeOf('fam-A'));
        const release = syncService.holdSaves('cross-family-decrypt');
        syncService.triggerDebouncedSave();
        syncService.reset();
        release();
        await vi.advanceTimersByTimeAsync(5_000);
        expect(provider.write).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe('Family Context and Registry', () => {
  it.todo('should create a family in the registry and activate it');
  it.todo('should set lastActiveFamilyId when activating a family');
  it.todo('should resolve the last active family');
});

describe('Multi-User Family Isolation (simulated sign-in/sign-out)', () => {
  it.todo('User A should only see User A family data');
  it.todo('User B should only see User B family data');
  it.todo('switching users should change visible data');
});

describe('Sync File Handle Isolation', () => {
  it.todo('getSyncFileKey should return family-scoped key');
  it.todo('should not return a handle for a different family');
});

describe('UserFamilyMapping Lookup', () => {
  it.todo('should find family by email in UserFamilyMapping');
  it.todo('should not find mapping for unknown email');
});
