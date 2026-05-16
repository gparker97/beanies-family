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

const { parseMock, reEncryptMock, decryptMock } = vi.hoisted(() => ({
  parseMock: vi.fn<(text: string) => BeanpodFileV4>(),
  reEncryptMock: vi.fn<(env: BeanpodFileV4, _key: CryptoKey) => Promise<string>>(async (env) =>
    JSON.stringify(env)
  ),
  decryptMock: vi.fn<(env: BeanpodFileV4, _key: CryptoKey) => Promise<unknown>>(async () => ({})),
}));

vi.mock('@/services/sync/fileSync', () => ({
  parseBeanpodV4: parseMock,
  reEncryptEnvelope: reEncryptMock,
  decryptBeanpodPayload: decryptMock,
  detectFileVersion: vi.fn(() => '4.0'),
  tryUnwrapFamilyKey: vi.fn(),
  createBeanpodV4: vi.fn(),
  unwrapWrappedKey: vi.fn(),
}));

vi.mock('@/services/automerge/docService', () => ({
  mergeDoc: vi.fn(),
  onDocPersistNeeded: vi.fn(),
  saveDoc: vi.fn(() => new Uint8Array()),
  replaceDoc: vi.fn(),
}));

vi.mock('@/services/automerge/persistenceService', () => ({
  persistDoc: vi.fn(async () => {}),
  persistEnvelope: vi.fn(async () => {}),
  isCacheReady: vi.fn(() => false),
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
