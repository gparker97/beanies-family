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
  exportEncryptedPayload: vi.fn(async () => ({ payload: 'base64-payload==' })),
  mergeRemoteEnvelope: vi.fn(async () => ({ dirty: false })),
  setLocalChangeHandler: vi.fn(),
  setCachePersistFailedHandler: vi.fn(),
  noteRemoteBaseline: vi.fn(),
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
  DriveApiError: class extends Error {},
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
    syncService.seedRemoteBaseline({ revision: 'ver:5', checkedAt: new Date().toISOString() });
    const { skip } = await syncService.shouldSkipOpenRead();
    expect(skip).toBe(true);
  });

  it('reads (no skip) when the revision advanced', async () => {
    const { provider } = markerProvider({ marker: { revision: 'ver:6', modifiedTime: null } });
    syncService.setProvider(provider as never);
    syncService.seedRemoteBaseline({ revision: 'ver:5', checkedAt: new Date().toISOString() });
    const { skip, reason } = await syncService.shouldSkipOpenRead();
    expect(skip).toBe(false);
    expect(reason).toBe('changed');
  });

  it('reads (no skip) when the baseline is older than the trust window', async () => {
    const { provider } = markerProvider({ marker: { revision: 'ver:5', modifiedTime: null } });
    syncService.setProvider(provider as never);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    syncService.seedRemoteBaseline({ revision: 'ver:5', checkedAt: twoHoursAgo });
    const { skip, reason } = await syncService.shouldSkipOpenRead();
    expect(skip).toBe(false);
    expect(reason).toBe('trust-expired');
  });

  it('reads (no skip) on a probe throw, classifying it as unknown/auth and NOT rethrowing', async () => {
    const authErr = Object.assign(new Error('token'), { name: 'TokenExpiredError' });
    const { provider } = markerProvider({ markerThrows: authErr });
    syncService.setProvider(provider as never);
    syncService.seedRemoteBaseline({ revision: 'ver:5', checkedAt: new Date().toISOString() });
    const r = await syncService.remoteChanged();
    expect(r.status).toBe('unknown');
    const { skip } = await syncService.shouldSkipOpenRead();
    expect(skip).toBe(false);
  });

  it('never skips on an mtime basis (provider with no revision)', async () => {
    const { provider } = markerProvider({ marker: { revision: null, modifiedTime: 'T1' } });
    syncService.setProvider(provider as never);
    syncService.seedRemoteBaseline({ revision: 'ver:5', checkedAt: new Date().toISOString() });
    const { skip, reason } = await syncService.shouldSkipOpenRead();
    expect(skip).toBe(false);
    expect(reason).toBe('no-revision');
  });
});
