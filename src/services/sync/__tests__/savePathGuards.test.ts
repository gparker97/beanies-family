/**
 * Save-path guards from the 2026-10-03 data-layer audit (C4, C12, C13): the write race
 * check, the captured-state abort, the no-key deferral, the Force Save repair over a torn
 * local file, the load() telemetry, and the pending save a cancelled pick restores.
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
vi.mock('@/services/indexeddb/database', () => ({ getActiveFamilyId: vi.fn(() => 'fam') }));
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

import * as syncService from '../syncService';
import * as docClient from '@/services/automerge/worker/docClient';
import { logEvent } from '@/services/telemetry';
import { CorruptPayloadError, RemoteMergeError } from '@/types/sync';

const KEY = {} as CryptoKey;

function envelope(over: Partial<BeanpodFileV4> = {}): BeanpodFileV4 {
  return {
    version: '4.0',
    familyId: 'fam',
    familyName: 'Fam',
    keyId: 'k',
    wrappedKeys: {},
    passkeyWrappedKeys: {},
    inviteKeys: {},
    encryptedPayload: 'payload',
    ...over,
  };
}

/** A Drive-shaped provider with a scripted revision counter. */
function drive(opts: { probe: string; ack: string }) {
  return {
    type: 'google_drive' as const,
    read: vi.fn(async () => JSON.stringify(envelope())),
    write: vi.fn(async () => ({ revision: opts.ack })),
    getLastModified: vi.fn(async () => null),
    getRemoteMarker: vi.fn(async () => ({ revision: opts.probe, modifiedTime: null })),
    getDisplayName: () => 'pod.beanpod',
    getFileId: () => 'file',
    getAccountEmail: () => null,
    supportsLocalPolling: () => false,
  };
}

const actions = (): unknown[] =>
  vi
    .mocked(logEvent)
    .mock.calls.map((c) => (c[0].context as { action?: unknown } | undefined)?.action);

beforeEach(() => {
  vi.clearAllMocks();
  syncService.reset();
});

describe('write race detection (audit C4)', () => {
  it('a revision that jumped by MORE than one is logged as write-raced and re-merged once', async () => {
    const p = drive({ probe: 'ver:10', ack: 'ver:13' });
    syncService.setProvider(p as never, 'fam');
    syncService.setFamilyKey(KEY, envelope());

    await expect(syncService.save()).resolves.toBe(true); // the write DID land
    expect(actions()).toContain('write-raced');
    // No baseline is certified for a window it cannot vouch for.
    expect(vi.mocked(docClient.noteRemoteBaseline).mock.calls.at(-1)?.[0]).toBe(
      JSON.stringify({ r: null, h: null })
    );

    // The scheduled re-merge reads again (the baseline was dropped, so the probe says
    // "changed") and merges; it publishes only if that read leaves us dirty.
    await vi.waitFor(() => expect(p.read).toHaveBeenCalledTimes(2));
    expect(p.write).toHaveBeenCalledTimes(1);
  });

  it('our OWN write (+1) is not a race, and commits the baseline as before', async () => {
    const p = drive({ probe: 'ver:10', ack: 'ver:11' });
    syncService.setProvider(p as never, 'fam');
    syncService.setFamilyKey(KEY, envelope());

    await expect(syncService.save()).resolves.toBe(true);
    expect(actions()).not.toContain('write-raced');
    expect(vi.mocked(docClient.noteRemoteBaseline).mock.calls.at(-1)?.[0]).toBe(
      JSON.stringify({ r: 'ver:11', h: 'h' })
    );
  });
});

describe('state captured at doSave entry (audit C4/C3)', () => {
  it('ABORTS without writing, latching or counting a failure when the provider changes mid-save', async () => {
    const p = drive({ probe: 'ver:1', ack: 'ver:2' });
    syncService.setProvider(p as never, 'fam');
    syncService.setFamilyKey(KEY, envelope());
    // A sign-out lands while the worker is serialising.
    vi.mocked(docClient.exportEncryptedPayload).mockImplementationOnce(async () => {
      syncService.reset();
      return { payload: 'p==', heads: ['h'], lineage: null } as never;
    });

    await expect(syncService.save()).resolves.toBe(false);
    expect(p.write).not.toHaveBeenCalled();
    expect(syncService.getConsecutiveSaveFailures()).toBe(0);
    expect(syncService.isRemoteBlocked()).toBeNull();
    expect(actions()).toContain('aborted-provider-changed');
  });
});

describe('a save with no family key is deferred, not dropped (audit C12)', () => {
  it('logs save-deferred-no-key once and setFamilyKey re-arms it', async () => {
    vi.useFakeTimers();
    try {
      const p = drive({ probe: 'ver:1', ack: 'ver:2' });
      syncService.setProvider(p as never, 'fam');
      await expect(syncService.saveNow()).resolves.toBe(false);
      await expect(syncService.saveNow()).resolves.toBe(false);
      expect(actions().filter((a) => a === 'save-deferred-no-key')).toHaveLength(1);

      syncService.setFamilyKey(KEY, envelope());
      expect(actions()).toContain('save-deferred-rearmed');
      await vi.advanceTimersByTimeAsync(3_000);
      expect(p.write).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Force Save over a corrupt LOCAL pod (audit C13)', () => {
  function local() {
    return {
      type: 'local' as const,
      read: vi.fn(async () => null),
      write: vi.fn(async () => undefined),
      getLastModified: vi.fn(async () => null),
      getDisplayName: () => 'pod.beanpod',
      getFileId: () => null,
      getAccountEmail: () => null,
      supportsLocalPolling: () => false,
    };
  }
  const corrupt = () => new CorruptPayloadError('torn', 'load', 'fam');

  it('an ordinary save stays refused by the corrupt-payload latch', async () => {
    const p = local();
    syncService.setProvider(p as never, 'fam');
    syncService.setFamilyKey(KEY, envelope());
    syncService.noteRemoteBlocked(corrupt());

    await expect(syncService.save()).resolves.toBe(false);
    expect(p.write).not.toHaveBeenCalled();
  });

  it('the user’s Force Save writes over it and clears the latch', async () => {
    const p = local();
    syncService.setProvider(p as never, 'fam');
    syncService.setFamilyKey(KEY, envelope());
    syncService.noteRemoteBlocked(corrupt());

    await expect(syncService.save({ repairCorruptLocal: true })).resolves.toBe(true);
    expect(p.write).toHaveBeenCalledTimes(1);
    expect(syncService.isRemoteBlocked()).toBeNull();
    expect(actions()).toContain('force-save-over-corrupt-local');
  });

  it('never bypasses a MERGE block, even on Force Save', async () => {
    const p = local();
    syncService.setProvider(p as never, 'fam');
    syncService.setFamilyKey(KEY, envelope());
    const merge = new RemoteMergeError(new Error('duplicate seq 2 found for actor abc'));
    syncService.noteRemoteBlocked(merge);

    await expect(syncService.save({ repairCorruptLocal: true })).resolves.toBe(false);
    expect(p.write).not.toHaveBeenCalled();
  });

  it('never bypasses on Drive', async () => {
    const p = drive({ probe: 'ver:1', ack: 'ver:2' });
    syncService.setProvider(p as never, 'fam');
    syncService.setFamilyKey(KEY, envelope());
    syncService.noteRemoteBlocked(corrupt());

    await expect(syncService.save({ repairCorruptLocal: true })).resolves.toBe(false);
    expect(p.write).not.toHaveBeenCalled();
  });
});

describe('load() telemetry (audit C12)', () => {
  it('a typed NotFoundError is an EMPTY pod (null, no lastError) and is logged', async () => {
    const p = drive({ probe: 'ver:1', ack: 'ver:2' });
    p.read.mockRejectedValueOnce(Object.assign(new Error('gone'), { name: 'NotFoundError' }));
    syncService.setProvider(p as never, 'fam');

    await expect(syncService.load()).resolves.toBeNull();
    expect(syncService.getState().lastError).toBeNull();
    expect(actions()).toContain('read-not-found');
  });

  it('an error that merely MENTIONS JSON is a failure now, not a silent "no file"', async () => {
    const p = drive({ probe: 'ver:1', ack: 'ver:2' });
    p.read.mockRejectedValueOnce(new Error('Unexpected token in JSON from proxy'));
    syncService.setProvider(p as never, 'fam');

    await expect(syncService.load()).resolves.toBeNull();
    expect(syncService.getState().lastError).toContain('JSON');
    expect(actions()).toContain('read-failed');
  });
});

describe('a cancelled pick restores the pending save it cancelled (audit C12)', () => {
  it('openAndLoadFile: Escape on the picker puts the armed save back', async () => {
    vi.useFakeTimers();
    try {
      const p = drive({ probe: 'ver:1', ack: 'ver:2' });
      syncService.setProvider(p as never, 'fam');
      syncService.setFamilyKey(KEY, envelope());
      syncService.triggerDebouncedSave();

      const r = await syncService.openAndLoadFile(); // fallback picker resolves null = cancel
      expect(r.cancelled).toBe(true);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(p.write).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('nothing armed, nothing restored', async () => {
    vi.useFakeTimers();
    try {
      const p = drive({ probe: 'ver:1', ack: 'ver:2' });
      syncService.setProvider(p as never, 'fam');
      syncService.setFamilyKey(KEY, envelope());
      await syncService.openAndLoadFile();
      await vi.advanceTimersByTimeAsync(3_000);
      expect(p.write).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
