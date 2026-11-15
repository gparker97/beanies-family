/**
 * Requirement 17 (plan 2026-11-15-instant-open-and-no-needless-reloads): a read
 * does not stamp the baseline until its merge is confirmed.
 *
 * The incident (2026-11-12 12:00 UTC): `load()` learned Drive's revision into the
 * baseline BEFORE its download finished, so a debounced save that fired during
 * the download answered `unchanged`, skipped its own read, and uploaded a stale
 * document without the worker's lineage guard ever running. These cases pin the
 * replacement: the probe waits in a pending marker, a save in that window reads
 * and merges for itself, and only `confirmRemoteMerged` commits the baseline.
 *
 * The decision itself is table-tested in `remoteBaseline.test.ts`
 * (`decideMergeConfirm`); this file proves the wiring through the real module.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BeanpodFileV4 } from '@/types/syncFileV4';

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
  getActiveFamilyId: vi.fn(() => 'fam'),
  clearUnpushedAtSignOutMarker: vi.fn(),
}));
vi.mock('@/services/familyContext', () => ({ createFamilyWithId: vi.fn(async () => {}) }));
vi.mock('@/services/automerge/worker/docClient', () => ({
  setFamilyKey: vi.fn(),
  persistEnvelope: vi.fn(async () => {}),
  exportEncryptedPayload: vi.fn(async () => ({
    payload: 'p==',
    heads: ['h-save-export'],
    lineage: null,
  })),
  mergeRemoteEnvelope: vi.fn(async () => ({
    action: 'merged',
    dirty: false,
    remoteHeads: ['h-save-read'],
  })),
  setLocalChangeHandler: vi.fn(),
  setCachePersistFailedHandler: vi.fn(),
  noteRemoteBaseline: vi.fn(),
  logMergeTerminus: vi.fn(),
  getHeads: vi.fn(async () => ({ heads: ['h-old'] })),
  documentHoldsCacheOf: vi.fn(() => true),
}));
vi.mock('@/services/sync/offlineQueue', () => ({
  enqueueOfflineSave: vi.fn(),
  enqueueSeqNow: vi.fn(() => 0),
  noteSaveLanded: vi.fn(),
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

import * as syncService from '../syncService';
import * as docClient from '@/services/automerge/worker/docClient';
import { logEvent } from '@/services/telemetry';
import { encodeBaselinePayload, headsFingerprint } from '../remoteBaseline';
import { PodLineageError } from '@/services/sync/podLineage';

const KEY = {} as CryptoKey;
const OLD = { revision: 'ver:5', heads: ['h-old'] };

function envelope(): BeanpodFileV4 {
  return {
    version: '4.0',
    familyId: 'fam',
    familyName: 'Fam',
    keyId: 'k',
    wrappedKeys: {},
    passkeyWrappedKeys: {},
    inviteKeys: {},
    encryptedPayload: 'payload',
  };
}

/**
 * A Drive-shaped provider whose FIRST read (the open's download) is held until
 * `releaseLoadRead()`; later reads (the save's own) answer at once.
 */
function drive(opts: { probe: string; ack: string; probeThrows?: boolean }) {
  let releaseLoadRead: () => void = () => {};
  const loadReadGate = new Promise<void>((r) => (releaseLoadRead = r));
  const text = JSON.stringify(envelope());
  const provider = {
    type: 'google_drive' as const,
    read: vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(async () => {
        await loadReadGate;
        return text;
      })
      .mockImplementation(async () => text),
    write: vi.fn(async () => ({ revision: opts.ack })),
    getLastModified: vi.fn(async () => null),
    getRemoteMarker: vi.fn(async () => {
      if (opts.probeThrows) throw new Error('probe down');
      return { revision: opts.probe, modifiedTime: null };
    }),
    getDisplayName: () => 'pod.beanpod',
    getFileId: () => 'file',
    getAccountEmail: () => null,
    supportsLocalPolling: () => false,
  };
  return { provider, releaseLoadRead: () => releaseLoadRead() };
}

function bind(opts: Parameters<typeof drive>[0]) {
  const d = drive(opts);
  syncService.setProvider(d.provider as never);
  syncService.setFamilyKey(KEY, envelope());
  syncService.seedRemoteBaseline({
    payload: encodeBaselinePayload(OLD.revision, headsFingerprint(OLD.heads)),
    checkedAt: new Date().toISOString(),
  });
  vi.mocked(docClient.noteRemoteBaseline).mockClear();
  return d;
}

const actions = (): unknown[] =>
  vi
    .mocked(logEvent)
    .mock.calls.map((c) => (c[0].context as { action?: unknown } | undefined)?.action);

/** The open's download has started (the probe answered and the read is held). */
async function loadIsDownloading(provider: ReturnType<typeof drive>['provider']) {
  await vi.waitFor(() => expect(provider.read).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  vi.clearAllMocks();
  syncService.reset();
});

describe('requirement 17: a read does not stamp the baseline until its merge is confirmed', () => {
  it('the 2026-11-12 ordering: a save mid-download reads and merges for itself before any write', async () => {
    // Drive moved to ver:6 since this (stale) device last knew it at ver:5.
    const { provider, releaseLoadRead } = bind({ probe: 'ver:6', ack: 'ver:7' });

    const loading = syncService.load();
    await loadIsDownloading(provider);
    // Only the load's PENDING marker exists. The baseline is still the old one,
    // so the change check says `changed`, never the old false `unchanged`.
    expect((await syncService.remoteChanged()).status).toBe('changed');

    // The debounced save fires now, while the open is still downloading.
    await expect(syncService.save()).resolves.toBe(true);

    // It did its OWN read and its OWN worker merge (where `guardLineage` runs),
    // and both came before the write.
    expect(provider.read).toHaveBeenCalledTimes(2);
    expect(docClient.mergeRemoteEnvelope).toHaveBeenCalledTimes(1);
    expect(provider.write).toHaveBeenCalledTimes(1);
    const mergeAt = vi.mocked(docClient.mergeRemoteEnvelope).mock.invocationCallOrder[0];
    const writeAt = provider.write.mock.invocationCallOrder[0];
    expect(mergeAt ?? Infinity).toBeLessThan(writeAt ?? -Infinity);
    expect(actions()).toContain('read-overlap');

    releaseLoadRead();
    await expect(loading).resolves.toBeTruthy();
  });

  it('a lineage refusal in that window stops the save: no write at all', async () => {
    // The stale-document case itself. The guard lives in the worker merge, so it
    // arrives as a rejected `mergeRemoteEnvelope`.
    vi.mocked(docClient.mergeRemoteEnvelope).mockRejectedValueOnce(
      new PodLineageError('adopt-remote', 'Pod lineage blocked: test')
    );
    const { provider, releaseLoadRead } = bind({ probe: 'ver:6', ack: 'ver:7' });

    const loading = syncService.load();
    await loadIsDownloading(provider);
    await expect(syncService.save()).resolves.toBe(false);

    expect(docClient.mergeRemoteEnvelope).toHaveBeenCalledTimes(1);
    expect(provider.write).not.toHaveBeenCalled();
    releaseLoadRead();
    await loading;
  });

  it('a confirm superseded by that save commits nothing: revision and heads stay the save’s', async () => {
    const { provider, releaseLoadRead } = bind({ probe: 'ver:6', ack: 'ver:7' });
    const loading = syncService.load();
    await loadIsDownloading(provider);
    await syncService.save();
    releaseLoadRead();
    await loading;
    vi.mocked(docClient.noteRemoteBaseline).mockClear();

    // The open's merge finishes last; its marker (ver:6) is older than the
    // save's acknowledgement (ver:7).
    syncService.confirmRemoteMerged(['h-load-read'], null);

    expect(docClient.noteRemoteBaseline).not.toHaveBeenCalled();
    expect(syncService.getRemoteBaselineHeadsFp()).toBe(headsFingerprint(['h-save-export']));
    provider.getRemoteMarker.mockResolvedValue({ revision: 'ver:7', modifiedTime: null });
    expect((await syncService.remoteChanged()).status).toBe('unchanged');
    expect(actions()).toContain('confirm-superseded');
  });

  it('an unsuperseded confirm learns the pending marker and commits it with the merged heads', async () => {
    const { provider, releaseLoadRead } = bind({ probe: 'ver:6', ack: 'ver:7' });
    const loading = syncService.load();
    releaseLoadRead();
    await loading;
    // Still the old baseline until the confirm.
    expect(syncService.getRemoteBaselineHeadsFp()).toBe(headsFingerprint(OLD.heads));

    syncService.confirmRemoteMerged(['h-load-read'], null);

    expect(docClient.noteRemoteBaseline).toHaveBeenCalledWith(
      encodeBaselinePayload('ver:6', headsFingerprint(['h-load-read']))
    );
    expect((await syncService.remoteChanged()).status).toBe('unchanged');
    expect(provider.getRemoteMarker).toHaveBeenCalled();
  });

  it('a confirm with no pending marker (the probe failed) nulls the revision', async () => {
    const { releaseLoadRead } = bind({ probe: 'ver:6', ack: 'ver:7', probeThrows: true });
    const loading = syncService.load();
    releaseLoadRead();
    await loading;

    syncService.confirmRemoteMerged(['h-load-read'], null);

    // The heads the read proved are kept; the revision nothing vouched for is not.
    expect(docClient.noteRemoteBaseline).toHaveBeenCalledWith(
      encodeBaselinePayload(null, headsFingerprint(['h-load-read']))
    );
    expect((await syncService.shouldSkipOpenRead()).reason).toBe('no-baseline');
  });

  it('a throw after the confirm does not roll the baseline back', async () => {
    const { releaseLoadRead } = bind({ probe: 'ver:6', ack: 'ver:7' });
    const loading = syncService.load();
    releaseLoadRead();
    await loading;
    syncService.confirmRemoteMerged(['h-load-read'], null);

    // `loadFromFile`'s `finally` always rolls back; after a confirm it is a no-op.
    syncService.rollbackRemoteMarker();

    expect(syncService.getRemoteBaselineHeadsFp()).toBe(headsFingerprint(['h-load-read']));
    expect((await syncService.remoteChanged()).status).toBe('unchanged');
  });

  it('rollback clears the pending marker and nulls the baseline, even when the probe failed', async () => {
    for (const probeThrows of [false, true]) {
      syncService.reset();
      const { releaseLoadRead } = bind({ probe: 'ver:6', ack: 'ver:7', probeThrows });
      const loading = syncService.load();
      releaseLoadRead();
      await loading;

      syncService.rollbackRemoteMarker();

      expect(syncService.getRemoteBaselineHeadsFp()).toBeNull();
      expect((await syncService.shouldSkipOpenRead()).reason).toBe('no-baseline');
      // The pending marker is gone: a stray confirm afterwards commits nothing.
      vi.mocked(docClient.noteRemoteBaseline).mockClear();
      syncService.confirmRemoteMerged(['h-load-read'], null);
      expect(docClient.noteRemoteBaseline).not.toHaveBeenCalled();
    }
  });
});
