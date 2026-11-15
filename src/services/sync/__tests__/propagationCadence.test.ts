/**
 * Propagation is not slower (plan 2026-11-15, requirement 18): the work that made opens instant
 * and removed needless reloads must not buy that by waiting longer to publish or to notice a
 * change. These pin the two `syncService` cadences; the 10 s Drive poll and its immediate probe
 * on becoming visible are pinned in `syncStore.drivePoll.test.ts`.
 *
 *  - The save debounce is 2 s: a local edit reaches Drive 2 s after the last keystroke.
 *  - The local-file poll is 15 s while visible, and probes at once on becoming visible.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BeanpodFileV4 } from '@/types/syncFileV4';

const poll = vi.hoisted(() => ({
  calls: [] as { intervalMs: number; options: Record<string, unknown> | undefined }[],
}));
vi.mock('@/composables/usePollWhileVisible', () => ({
  usePollWhileVisible: (_cb: unknown, intervalMs: number, options?: Record<string, unknown>) => {
    poll.calls.push({ intervalMs, options });
    return { stop: () => {} };
  },
}));
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
  reEncryptEnvelope: vi.fn((env: BeanpodFileV4, payload: string) =>
    JSON.stringify({ ...env, encryptedPayload: payload })
  ),
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
  exportEncryptedPayload: vi.fn(async () => ({ payload: 'p==', heads: ['h'], lineage: null })),
  mergeRemoteEnvelope: vi.fn(async () => ({ action: 'merged', dirty: false, remoteHeads: ['h'] })),
  setLocalChangeHandler: vi.fn(),
  setCachePersistFailedHandler: vi.fn(),
  noteRemoteBaseline: vi.fn(),
  logMergeTerminus: vi.fn(),
  getHeads: vi.fn(async () => ({ heads: ['h'] })),
  documentHoldsCacheOf: vi.fn(() => true),
}));
vi.mock('@/services/sync/offlineQueue', () => ({
  enqueueOfflineSave: vi.fn(),
  enqueueSeqNow: vi.fn(() => 0),
  hasPendingSave: vi.fn(() => false),
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

const KEY = {} as CryptoKey;

const envelope = (): BeanpodFileV4 => ({
  version: '4.0',
  familyId: 'fam',
  familyName: 'Fam',
  keyId: 'k',
  wrappedKeys: { m1: { wrapped: 'w1' } } as never,
  passkeyWrappedKeys: {},
  inviteKeys: {},
  encryptedPayload: 'payload',
});

function provider(supportsLocalPolling: boolean) {
  let version = 10;
  return {
    type: supportsLocalPolling ? ('local' as const) : ('google_drive' as const),
    read: vi.fn(async () => JSON.stringify(envelope())),
    write: vi.fn(async () => {
      version++;
      return { revision: `ver:${version}`, contentId: null };
    }),
    getLastModified: vi.fn(async () => null),
    getRemoteMarker: vi.fn(async () => ({
      revision: `ver:${version}`,
      modifiedTime: null,
      contentId: null,
    })),
    getDisplayName: () => 'pod.beanpod',
    getFileId: () => 'file',
    getAccountEmail: () => null,
    supportsLocalPolling: () => supportsLocalPolling,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  poll.calls = [];
  syncService.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the save debounce is 2 s (requirement 18)', () => {
  it('a debounced save uploads 2 s after the last trigger, not before', async () => {
    const p = provider(false);
    syncService.setProvider(p as never, 'fam');
    syncService.setFamilyKey(KEY, envelope());
    await expect(syncService.save()).resolves.toBe(true); // a baseline to save against
    expect(p.write).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    syncService.triggerDebouncedSave();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(p.write).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await syncService.whenIdle();
    expect(p.write).toHaveBeenCalledTimes(2);
  });
});

describe('the local-file poll is 15 s and probes on becoming visible (requirement 18)', () => {
  it('a provider that opts into local polling gets a 15 s visible-only poll that fires on return', () => {
    syncService.setProvider(provider(true) as never, 'fam');
    expect(poll.calls).toEqual([
      {
        intervalMs: 15_000,
        options: { fireImmediatelyOnVisible: true, surface: 'local-file-polling' },
      },
    ]);
  });

  it('a provider that does not opt in (Drive: the store polls it) gets no local poll', () => {
    syncService.setProvider(provider(false) as never, 'fam');
    expect(poll.calls).toEqual([]);
  });
});
