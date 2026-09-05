/**
 * End-to-end test of the envelope-merge in `syncService.save()` →
 * `fetchAndMergeRemote()` → write cycle. Proves the divergence-bug fix:
 * a freshly-rotated LOCAL wrappedKey/inviteKey/passkeyWrappedKey is NOT
 * silently overwritten by a stale REMOTE entry of the same key.
 *
 * Stubs: the provider (controllable read/getLastModified/write), and
 * the parse/decrypt/encrypt helpers (so we don't need a real Automerge
 * doc). The merge logic under test is in `preserveLocalKeyDicts` which
 * has dedicated unit coverage; this file proves the wiring through
 * `save()` and `fetchAndMergeRemote` reaches it correctly.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BeanpodFileV4 } from '@/types/syncFileV4';

const { parseMock, reEncryptMock } = vi.hoisted(() => ({
  parseMock: vi.fn<(text: string) => BeanpodFileV4>(),
  // ADR-032: reEncryptEnvelope now takes the worker-produced base64 payload, not
  // the key. The stub just stringifies the (merged) envelope so the test can read
  // back what was written.
  reEncryptMock: vi.fn<(env: BeanpodFileV4, _payload: string) => string>((env) =>
    JSON.stringify(env)
  ),
}));

vi.mock('@/services/sync/fileSync', () => ({
  parseBeanpodV4: parseMock,
  reEncryptEnvelope: reEncryptMock,
  detectFileVersion: vi.fn(() => '4.0'),
  tryUnwrapFamilyKey: vi.fn(),
  createBeanpodV4: vi.fn(),
  unwrapWrappedKey: vi.fn(),
}));

// ADR-032: the worker owns decrypt/merge + cache persist + payload export. The
// merge under test here is `preserveLocalKeyDicts` (main-side, on the envelope),
// so the worker RPCs are stubbed — a no-op/remote-ahead merge (dirty:false).
vi.mock('@/services/automerge/worker/docClient', () => ({
  setFamilyKey: vi.fn(),
  persistEnvelope: vi.fn(async () => {}),
  exportEncryptedPayload: vi.fn(async () => ({ payload: 'base64-payload==', heads: ['h-export'] })),
  mergeRemoteEnvelope: vi.fn(async () => ({ dirty: false, remoteHeads: ['h-remote'] })),
  setLocalChangeHandler: vi.fn(),
  setCachePersistFailedHandler: vi.fn(),
  noteRemoteBaseline: vi.fn(),
  // #65: the open-guard probes doc heads before the metadata probe. Default to
  // MATCHING the seeded baseline fingerprint so the pre-existing guard cases keep
  // exercising the path they were written for; cases about unpushed changes
  // override this explicitly.
  getHeads: vi.fn(async () => ({ heads: ['h-remote'] })),
}));

vi.mock('@/services/indexeddb/database', () => ({
  getActiveFamilyId: vi.fn(() => null),
}));

vi.mock('@/services/familyContext', () => ({
  createFamilyWithId: vi.fn(),
}));

vi.mock('@/services/sync/fileHandleStore', () => ({
  getFileHandle: vi.fn(),
  verifyPermission: vi.fn(async () => true),
  getProviderConfig: vi.fn(),
}));

vi.mock('@/services/sync/providers/googleDriveProvider', () => ({
  GoogleDriveProvider: class {
    static fromExisting() {
      return null;
    }
  },
}));

vi.mock('@/services/sync/providers/localProvider', () => ({
  LocalStorageProvider: class {
    getHandle() {
      return null;
    }
  },
}));

vi.mock('@/services/sync/capabilities', () => ({
  supportsFileSystemAccess: vi.fn(() => false),
}));

vi.mock('@/services/google/driveService', () => ({
  DriveApiError: class extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.name = 'DriveApiError';
      this.status = status;
    }
  },
}));

vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => k }),
}));

vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));

vi.mock('@/utils/errorReporter', () => ({
  reportError: vi.fn(),
}));

vi.mock('@/utils/beanpodFilename', () => ({
  isConflictFilename: vi.fn(() => false),
}));

import * as syncService from '../syncService';
import { encodeBaselinePayload, headsFingerprint } from '../remoteBaseline';
import * as docClient from '@/services/automerge/worker/docClient';

function buildEnvelope(over: Partial<BeanpodFileV4> = {}): BeanpodFileV4 {
  return {
    version: '4.0',
    familyId: 'fam-1',
    familyName: 'Test',
    keyId: 'k1',
    wrappedKeys: {},
    passkeyWrappedKeys: {},
    inviteKeys: {},
    encryptedPayload: 'payload',
    ...over,
  };
}

function makeProvider(opts: {
  remoteText: string;
  remoteTimestamp: string;
  onWrite: (content: string) => void;
}) {
  return {
    type: 'google_drive' as const,
    read: vi.fn(async () => opts.remoteText),
    write: vi.fn(async (content: string) => {
      opts.onWrite(content);
    }),
    getLastModified: vi.fn(async () => opts.remoteTimestamp),
    getDisplayName: () => 'pod.beanpod',
    getFileId: () => 'mock-file-id',
    getAccountEmail: () => null,
    supportsLocalPolling: () => false,
  };
}

describe('syncService.save → fetchAndMergeRemote — local-wins merge', () => {
  const fakeKey = {} as CryptoKey;

  beforeEach(() => {
    vi.clearAllMocks();
    syncService.reset();
    // Default parse: deserialize the text we wrote (envelope-shaped JSON).
    parseMock.mockImplementation((text) => JSON.parse(text) as BeanpodFileV4);
  });

  it('local-fresh wrappedKey survives a stale-remote merge', async () => {
    const remoteEnv = buildEnvelope({
      wrappedKeys: { m1: { wrapped: 'OLD-w', salt: 'OLD-s' } },
    });
    const localEnv = buildEnvelope({
      wrappedKeys: { m1: { wrapped: 'NEW-w', salt: 'NEW-s' } },
    });

    let written = '';
    const provider = makeProvider({
      remoteText: JSON.stringify(remoteEnv),
      remoteTimestamp: '2026-05-16T10:00:00Z',
      onWrite: (c) => {
        written = c;
      },
    });
    syncService.setProvider(provider as never);
    syncService.setFamilyKey(fakeKey, localEnv);
    // Force fetchAndMergeRemote to see "newer remote" by leaving
    // lastKnownFileTimestamp null (default — `!lastKnownFileTimestamp &&
    // <=` is false → merge path proceeds).

    const ok = await syncService.save();
    expect(ok).toBe(true);

    const writtenEnv = JSON.parse(written) as BeanpodFileV4;
    // The bug being fixed: NEW must survive, not be overwritten by OLD.
    expect(writtenEnv.wrappedKeys.m1).toEqual({ wrapped: 'NEW-w', salt: 'NEW-s' });
  });

  it('remote-only wrappedKey entry is preserved', async () => {
    const remoteEnv = buildEnvelope({
      wrappedKeys: { m2: { wrapped: 'remote-only', salt: 'rs' } },
    });
    const localEnv = buildEnvelope({
      wrappedKeys: { m1: { wrapped: 'local-only', salt: 'ls' } },
    });

    let written = '';
    const provider = makeProvider({
      remoteText: JSON.stringify(remoteEnv),
      remoteTimestamp: '2026-05-16T10:00:00Z',
      onWrite: (c) => {
        written = c;
      },
    });
    syncService.setProvider(provider as never);
    syncService.setFamilyKey(fakeKey, localEnv);

    await syncService.save();
    const writtenEnv = JSON.parse(written) as BeanpodFileV4;
    expect(Object.keys(writtenEnv.wrappedKeys).sort()).toEqual(['m1', 'm2']);
  });

  it('applies the same local-wins merge to inviteKeys and passkeyWrappedKeys', async () => {
    const remoteEnv = buildEnvelope({
      inviteKeys: { tok1: { wrapped: 'OLD', salt: 'OLD', expiresAt: '2099-01-01' } },
      passkeyWrappedKeys: { cred1: { wrapped: 'OLD', hkdfSalt: 'OLD' } },
    });
    const localEnv = buildEnvelope({
      inviteKeys: { tok1: { wrapped: 'NEW', salt: 'NEW', expiresAt: '2099-01-01' } },
      passkeyWrappedKeys: { cred1: { wrapped: 'NEW', hkdfSalt: 'NEW' } },
    });

    let written = '';
    const provider = makeProvider({
      remoteText: JSON.stringify(remoteEnv),
      remoteTimestamp: '2026-05-16T10:00:00Z',
      onWrite: (c) => {
        written = c;
      },
    });
    syncService.setProvider(provider as never);
    syncService.setFamilyKey(fakeKey, localEnv);

    await syncService.save();
    const writtenEnv = JSON.parse(written) as BeanpodFileV4;
    expect(writtenEnv.inviteKeys.tok1.wrapped).toBe('NEW');
    expect(writtenEnv.passkeyWrappedKeys.cred1.wrapped).toBe('NEW');
  });
});

// ─── #61 open-guard I/O shell (remoteChanged / shouldSkipOpenRead) ────────────

function markerProvider(opts: {
  marker?: { revision: string | null; modifiedTime: string | null };
  markerThrows?: unknown;
  lastModified?: string | null;
  hasGetRemoteMarker?: boolean;
}) {
  const getLastModified = vi.fn(async () => opts.lastModified ?? null);
  const base = {
    type: 'google_drive' as const,
    read: vi.fn(async () => null),
    write: vi.fn(async () => undefined),
    getLastModified,
    getDisplayName: () => 'pod.beanpod',
    getFileId: () => 'mock-file-id',
    getAccountEmail: () => null,
    supportsLocalPolling: () => false,
  };
  if (opts.hasGetRemoteMarker === false) return { provider: base, getLastModified };
  const getRemoteMarker = vi.fn(async () => {
    if (opts.markerThrows) throw opts.markerThrows;
    return opts.marker ?? { revision: null, modifiedTime: null };
  });
  return { provider: { ...base, getRemoteMarker }, getLastModified, getRemoteMarker };
}

describe('syncService.remoteChanged / shouldSkipOpenRead (#61 C14)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncService.reset();
  });

  it('falls back to getLastModified ONCE when the provider has no getRemoteMarker', async () => {
    const { provider, getLastModified } = markerProvider({
      hasGetRemoteMarker: false,
      lastModified: '2026-08-13T00:00:00Z',
    });
    syncService.setProvider(provider as never);
    const r = await syncService.remoteChanged();
    expect(getLastModified).toHaveBeenCalledTimes(1);
    expect(r.basis).toBe('mtime');
  });

  it('skips when the revision matches the seeded baseline and is within the trust window', async () => {
    const { provider } = markerProvider({ marker: { revision: 'ver:5', modifiedTime: null } });
    syncService.setProvider(provider as never);
    syncService.seedRemoteBaseline({
      payload: encodeBaselinePayload('ver:5', headsFingerprint(['h-remote'])),
      checkedAt: new Date().toISOString(),
    });
    const { skip } = await syncService.shouldSkipOpenRead();
    expect(skip).toBe(true);
  });

  it('reads (no skip) when the revision advanced', async () => {
    const { provider } = markerProvider({ marker: { revision: 'ver:6', modifiedTime: null } });
    syncService.setProvider(provider as never);
    syncService.seedRemoteBaseline({
      payload: encodeBaselinePayload('ver:5', headsFingerprint(['h-remote'])),
      checkedAt: new Date().toISOString(),
    });
    const { skip, reason } = await syncService.shouldSkipOpenRead();
    expect(skip).toBe(false);
    expect(reason).toBe('changed');
  });

  it('reads (no skip) when the baseline is older than the trust window', async () => {
    const { provider } = markerProvider({ marker: { revision: 'ver:5', modifiedTime: null } });
    syncService.setProvider(provider as never);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    syncService.seedRemoteBaseline({
      payload: encodeBaselinePayload('ver:5', headsFingerprint(['h-remote'])),
      checkedAt: twoHoursAgo,
    });
    const { skip, reason } = await syncService.shouldSkipOpenRead();
    expect(skip).toBe(false);
    expect(reason).toBe('trust-expired');
  });

  it('reads (no skip) on a probe throw, classifying it as unknown/auth and NOT rethrowing', async () => {
    const authErr = Object.assign(new Error('token'), { name: 'TokenExpiredError' });
    const { provider } = markerProvider({ markerThrows: authErr });
    syncService.setProvider(provider as never);
    syncService.seedRemoteBaseline({
      payload: encodeBaselinePayload('ver:5', headsFingerprint(['h-remote'])),
      checkedAt: new Date().toISOString(),
    });
    const r = await syncService.remoteChanged();
    expect(r.status).toBe('unknown');
    const { skip } = await syncService.shouldSkipOpenRead();
    expect(skip).toBe(false);
  });

  it('never skips on an mtime basis (provider with no revision)', async () => {
    const { provider } = markerProvider({ marker: { revision: null, modifiedTime: 'T1' } });
    syncService.setProvider(provider as never);
    syncService.seedRemoteBaseline({
      payload: encodeBaselinePayload('ver:5', headsFingerprint(['h-remote'])),
      checkedAt: new Date().toISOString(),
    });
    const { skip, reason } = await syncService.shouldSkipOpenRead();
    expect(skip).toBe(false);
    expect(reason).toBe('no-revision');
  });

  it('does NOT probe when the baseline is already trust-expired (daily-user perf)', async () => {
    const { provider, getRemoteMarker } = markerProvider({
      marker: { revision: 'ver:5', modifiedTime: null },
    });
    syncService.setProvider(provider as never);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    syncService.seedRemoteBaseline({
      payload: encodeBaselinePayload('ver:5', headsFingerprint(['h-remote'])),
      checkedAt: twoHoursAgo,
    });
    const { skip, reason } = await syncService.shouldSkipOpenRead();
    expect(skip).toBe(false);
    expect(reason).toBe('trust-expired');
    expect(getRemoteMarker).not.toHaveBeenCalled(); // no wasted metadata round-trip
  });

  it('does NOT probe when there is no baseline yet (first sight reads without a probe)', async () => {
    const { provider, getRemoteMarker } = markerProvider({
      marker: { revision: 'ver:5', modifiedTime: null },
    });
    syncService.setProvider(provider as never);
    syncService.seedRemoteBaseline(null);
    const { skip, reason } = await syncService.shouldSkipOpenRead();
    expect(skip).toBe(false);
    expect(reason).toBe('no-baseline');
    expect(getRemoteMarker).not.toHaveBeenCalled();
  });

  it('classifies a Drive 404 as file-not-found (poll path surfaces the missing-file banner)', async () => {
    const { DriveApiError } = await import('@/services/google/driveService');
    const notFound = new DriveApiError('gone', 404);
    const { provider } = markerProvider({ markerThrows: notFound });
    syncService.setProvider(provider as never);
    syncService.seedRemoteBaseline({
      payload: encodeBaselinePayload('ver:5', headsFingerprint(['h-remote'])),
      checkedAt: new Date().toISOString(),
    });
    const r = await syncService.remoteChanged();
    expect(r.status).toBe('unknown');
    expect(r.reason).toBe('file-not-found');
  });
});

// ─── #65: the unpushed-local-changes pre-check ───────────────────────────────

describe('syncService.shouldSkipOpenRead — unpushed local changes (#65)', () => {
  const seedFp = (heads: string[]) =>
    syncService.seedRemoteBaseline({
      payload: encodeBaselinePayload('ver:5', headsFingerprint(heads)),
      checkedAt: new Date().toISOString(),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    syncService.reset();
    vi.mocked(docClient.getHeads).mockResolvedValue({ heads: ['h-remote'] });
  });

  it('DECLINES the skip when the doc holds heads Drive never received', async () => {
    // The crash-window case: an edit reached the local cache, the debounced Drive
    // save never flushed, so our doc has moved past the recorded Drive heads.
    const { provider, getRemoteMarker } = markerProvider({
      marker: { revision: 'ver:5', modifiedTime: null },
    });
    syncService.setProvider(provider as never);
    seedFp(['h-remote']);
    vi.mocked(docClient.getHeads).mockResolvedValue({ heads: ['h-remote', 'h-local-edit'] });

    const { skip, reason } = await syncService.shouldSkipOpenRead();
    expect(skip).toBe(false);
    expect(reason).toBe('unpushed-local-changes');
    // Ordering: the local check runs BEFORE the network probe, so an open that is
    // going to read anyway never pays a metadata round-trip.
    expect(getRemoteMarker).not.toHaveBeenCalled();
  });

  it('still SKIPS when the doc heads match Drive (the #61 win is preserved)', async () => {
    const { provider } = markerProvider({ marker: { revision: 'ver:5', modifiedTime: null } });
    syncService.setProvider(provider as never);
    seedFp(['h-remote']);
    const { skip, reason } = await syncService.shouldSkipOpenRead();
    expect(skip).toBe(true);
    expect(reason).toBe('unchanged-revision-in-window');
  });

  it('declines with baseline-heads-unknown on a LEGACY pre-#65 row', async () => {
    // Distinct from unpushed-local-changes: we do not know what Drive holds, which
    // is genuine uncertainty and must stay classified as a fail-open.
    const { provider, getRemoteMarker } = markerProvider({
      marker: { revision: 'ver:5', modifiedTime: null },
    });
    syncService.setProvider(provider as never);
    syncService.seedRemoteBaseline({ payload: 'ver:5', checkedAt: new Date().toISOString() });
    const { skip, reason } = await syncService.shouldSkipOpenRead();
    expect(skip).toBe(false);
    expect(reason).toBe('baseline-heads-unknown');
    expect(getRemoteMarker).not.toHaveBeenCalled();
  });

  it('declines with heads-probe-failed when the worker RPC rejects — and never throws', async () => {
    const { provider } = markerProvider({ marker: { revision: 'ver:5', modifiedTime: null } });
    syncService.setProvider(provider as never);
    seedFp(['h-remote']);
    vi.mocked(docClient.getHeads).mockRejectedValue(new Error('worker gone'));

    const { skip, reason } = await syncService.shouldSkipOpenRead();
    expect(skip).toBe(false);
    expect(reason).toBe('heads-probe-failed');
  });

  it('probes with { quiet: true, probe: true } — one report, and never tears down a live worker', async () => {
    // quiet: docClient.surface() would otherwise ALSO fire a doc-worker report on
    // top of this function's own classification.
    // probe: without it the call inherits the 45s budget AND the recovery path —
    // a wedged-but-live worker would be torn down, every sibling RPC drained
    // (including a user mutate), and a doc-worker-recovery report fired that quiet
    // does NOT suppress. All to answer a question whose worst answer is "read".
    const { provider } = markerProvider({ marker: { revision: 'ver:5', modifiedTime: null } });
    syncService.setProvider(provider as never);
    seedFp(['h-remote']);
    await syncService.shouldSkipOpenRead();
    expect(docClient.getHeads).toHaveBeenCalledWith({ quiet: true, probe: true });
  });

  it('does NOT spend the worker round-trip when the fingerprint is unknown', async () => {
    // The answer is already decided (cannot prove the doc is on Drive), so probing
    // would compute and discard. This is every device's first open post-upgrade.
    const { provider } = markerProvider({ marker: { revision: 'ver:5', modifiedTime: null } });
    syncService.setProvider(provider as never);
    syncService.seedRemoteBaseline({ payload: 'ver:5', checkedAt: new Date().toISOString() });
    const { reason } = await syncService.shouldSkipOpenRead();
    expect(reason).toBe('baseline-heads-unknown');
    expect(docClient.getHeads).not.toHaveBeenCalled();
  });

  it('does NOT probe doc heads when the trust window has already expired', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { provider } = markerProvider({ marker: { revision: 'ver:5', modifiedTime: null } });
    syncService.setProvider(provider as never);
    syncService.seedRemoteBaseline({
      payload: encodeBaselinePayload('ver:5', headsFingerprint(['h-remote'])),
      checkedAt: twoHoursAgo,
    });
    const { reason } = await syncService.shouldSkipOpenRead();
    expect(reason).toBe('trust-expired');
    expect(docClient.getHeads).not.toHaveBeenCalled();
  });
});

describe('syncService.commitRemoteBaseline — records DRIVE heads only (#65)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncService.reset();
  });

  it('encodes the passed Drive heads into the baseline payload', () => {
    syncService.seedRemoteBaseline({
      payload: encodeBaselinePayload('ver:5', null),
      checkedAt: new Date().toISOString(),
    });
    syncService.commitRemoteBaseline(['h-drive']);
    expect(docClient.noteRemoteBaseline).toHaveBeenCalledWith(
      encodeBaselinePayload('ver:5', headsFingerprint(['h-drive']))
    );
  });

  it('records NO fingerprint when the terminus cannot prove Drive content (null)', () => {
    syncService.seedRemoteBaseline({
      payload: encodeBaselinePayload('ver:5', headsFingerprint(['stale'])),
      checkedAt: new Date().toISOString(),
    });
    syncService.commitRemoteBaseline(null);
    expect(docClient.noteRemoteBaseline).toHaveBeenCalledWith(encodeBaselinePayload('ver:5', null));
  });

  it('writes the fingerprint back in memory so a SECOND open in the same process still skips', async () => {
    // backgroundSyncFromFile re-enters per process (header Refresh, config-heal).
    // Without the write-back every post-save open would report baseline-heads-unknown.
    const { provider } = markerProvider({ marker: { revision: 'ver:5', modifiedTime: null } });
    syncService.setProvider(provider as never);
    syncService.seedRemoteBaseline({
      payload: encodeBaselinePayload('ver:5', null),
      checkedAt: new Date().toISOString(),
    });
    vi.mocked(docClient.getHeads).mockResolvedValue({ heads: ['h-drive'] });

    // Before the commit: unknown => declines.
    expect((await syncService.shouldSkipOpenRead()).reason).toBe('baseline-heads-unknown');
    syncService.commitRemoteBaseline(['h-drive']);
    // After: in-memory baseline knows what Drive holds => skips.
    expect((await syncService.shouldSkipOpenRead()).skip).toBe(true);
  });

  it('does not move checkedAt (never silently extends the trust window)', async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { provider } = markerProvider({ marker: { revision: 'ver:5', modifiedTime: null } });
    syncService.setProvider(provider as never);
    syncService.seedRemoteBaseline({
      payload: encodeBaselinePayload('ver:5', null),
      checkedAt: twoHoursAgo,
    });
    syncService.commitRemoteBaseline(['h-drive']);
    expect((await syncService.shouldSkipOpenRead()).reason).toBe('trust-expired');
  });
});

describe('a merge that refuses AFTER the remote was read', () => {
  const fakeKey = {} as CryptoKey;
  const reportErrorMock = async () =>
    vi.mocked((await import('@/utils/errorReporter')).reportError);

  beforeEach(() => {
    vi.clearAllMocks();
    syncService.reset();
    parseMock.mockImplementation((text) => JSON.parse(text) as BeanpodFileV4);
  });

  it('refuses the save, never writes, and latches the breaker with blockCode "merge"', async () => {
    // Two realms sharing one actor is what Automerge says this about.
    vi.mocked(docClient.mergeRemoteEnvelope).mockRejectedValueOnce(
      new Error('error applying changes: duplicate seq 2 found for actor abc')
    );
    const provider = makeProvider({
      remoteText: JSON.stringify(buildEnvelope()),
      remoteTimestamp: '2026-05-16T10:00:00Z',
      onWrite: () => {},
    });
    syncService.setProvider(provider as never);
    syncService.setFamilyKey(fakeKey, buildEnvelope());

    await expect(syncService.save()).resolves.toBe(false);

    // The whole point: the base that lacks the remote's changes is NOT written.
    expect(provider.write).not.toHaveBeenCalled();
    expect(syncService.isRemoteBlocked()?.blockCode).toBe('merge');
    const reportError = await reportErrorMock();
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'pod-merge', severity: 'critical' })
    );
  });

  it('reports a non-collision refusal at "error", not "critical"', async () => {
    vi.mocked(docClient.mergeRemoteEnvelope).mockRejectedValueOnce(new Error('worker gone'));
    const provider = makeProvider({
      remoteText: JSON.stringify(buildEnvelope()),
      remoteTimestamp: '2026-05-16T10:00:00Z',
      onWrite: () => {},
    });
    syncService.setProvider(provider as never);
    syncService.setFamilyKey(fakeKey, buildEnvelope());

    await expect(syncService.save()).resolves.toBe(false);
    expect(provider.write).not.toHaveBeenCalled();
    const reportError = await reportErrorMock();
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'pod-merge', severity: 'error' })
    );
  });

  it('a TRANSPORT failure before the bytes were read still saves (pinned)', async () => {
    // The branch this fix narrows must keep its original job: the remote is
    // still there, nothing was read, the next save re-merges.
    let written = '';
    const provider = makeProvider({
      remoteText: '',
      remoteTimestamp: '2026-05-16T10:00:00Z',
      onWrite: (c) => {
        written = c;
      },
    });
    provider.read.mockRejectedValueOnce(new Error('network down'));
    syncService.setProvider(provider as never);
    syncService.setFamilyKey(fakeKey, buildEnvelope());

    await expect(syncService.save()).resolves.toBe(true);
    expect(written).not.toBe('');
    expect(syncService.isRemoteBlocked()).toBeNull();
  });
});

describe('a LINEAGE block must refuse the save, not fall through to it', () => {
  const fakeKey = {} as CryptoKey;

  beforeEach(() => {
    vi.clearAllMocks();
    syncService.reset();
    parseMock.mockImplementation((text) => JSON.parse(text) as BeanpodFileV4);
  });

  it('never writes a pre-compaction document over a compacted remote', async () => {
    // The terminus-3 guard throws OUTSIDE `fetchAndMergeRemote`'s own try, so a
    // `PodLineageError` reached `doSave`'s catch, which listed only
    // PayloadLoadError|RemoteMergeError — and the "save local anyway" branch
    // then wrote this device's OLD-lineage doc, plus an envelope with no
    // `podLineage` at all, over the compacted file. Every peer would then adopt
    // the un-compaction.
    //
    // Remote carries a lineage, local does not => `adopt-remote`; no baseline
    // fingerprint => `docPushedAgainst` answers `dirty` => `block`.
    const remoteEnv = buildEnvelope({ podLineage: { id: 'L1', seq: 1 } });
    let written = '';
    const provider = makeProvider({
      remoteText: JSON.stringify(remoteEnv),
      remoteTimestamp: '2026-05-16T10:00:00Z',
      onWrite: (c) => {
        written = c;
      },
    });
    syncService.setProvider(provider as never);
    syncService.setFamilyKey(fakeKey, buildEnvelope()); // local: no lineage

    await expect(syncService.save()).resolves.toBe(false);

    expect(provider.write).not.toHaveBeenCalled();
    expect(written).toBe('');
    // And it latches, so the 10s poller stops re-downloading to fail the same way.
    expect(syncService.isRemoteBlocked()?.blockCode).toBe('adopt-remote');
  });
});

describe('a baseline WITHOUT a revision still records its heads fingerprint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncService.reset();
  });

  it('so a local-file family can be "fully synced" and can compact', () => {
    // Only `GoogleDriveProvider` implements `getRemoteMarker`, so every
    // local-file family hit `commitRemoteBaseline`'s `revision === null` early
    // return and NEVER recorded a fingerprint. `docPushedAgainst(null)` then
    // answered `dirty` forever: `isFullySynced()` could never be true, so
    // compaction refused with "not synced" on a perfectly synced pod, and the
    // lineage context was permanently `dirty`, so those families would BLOCK
    // where they should adopt.
    expect(syncService.getRemoteBaselineHeadsFp()).toBeNull();

    syncService.commitRemoteBaseline(['h-a', 'h-b']);

    const fp = syncService.getRemoteBaselineHeadsFp();
    expect(fp).not.toBeNull();
    // Same heads => same fingerprint => provably nothing unpushed.
    expect(headsFingerprint(['h-a', 'h-b'])).toBe(fp);
  });

  it('records nothing when there are no heads to record', () => {
    // `null` heads means "we cannot prove what Drive holds" and must stay the
    // fail-safe unknown, never a fingerprint of nothing.
    syncService.commitRemoteBaseline(null);
    expect(syncService.getRemoteBaselineHeadsFp()).toBeNull();
  });
});
