/**
 * The local-file readers against the REAL `fileSync`: a file from a newer
 * beanies must come out as a classified `payloadError` with a translated
 * `lastError`, never as a raw exception string and never as nothing.
 *
 * Does not mock `@/services/sync/fileSync`, for the same reason
 * `savePathVersion.test.ts` does not: the readers used to carry their own
 * hand-rolled "Unsupported file version" string, and a mock here would hide
 * whether the typed throw from `parseBeanpodV4` actually reaches the caller.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { BeanpodFileV4 } from '@/types/syncFileV4';

vi.mock('@/services/automerge/worker/docClient', () => ({
  setFamilyKey: vi.fn(),
  persistEnvelope: vi.fn(async () => {}),
  exportEncryptedPayload: vi.fn(),
  mergeRemoteEnvelope: vi.fn(),
  setLocalChangeHandler: vi.fn(),
  setCachePersistFailedHandler: vi.fn(),
  logMergeTerminus: vi.fn(),
  noteRemoteBaseline: vi.fn(),
  getHeads: vi.fn(async () => ({ heads: [] })),
}));
vi.mock('@/services/indexeddb/database', () => ({ getActiveFamilyId: vi.fn(() => null) }));
vi.mock('@/services/familyContext', () => ({ createFamilyWithId: vi.fn() }));
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
    static fromHandle() {
      return { type: 'local' };
    }
    getHandle() {
      return null;
    }
  },
}));
vi.mock('@/services/sync/capabilities', () => ({ supportsFileSystemAccess: vi.fn(() => false) }));
vi.mock('@/services/google/driveService', () => ({ DriveApiError: class extends Error {} }));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => `T(${k})` }),
}));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));
vi.mock('@/utils/beanpodFilename', () => ({ isConflictFilename: vi.fn(() => false) }));
vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));

import * as syncService from '../syncService';
import { UnsupportedBeanpodVersionError } from '@/types/sync';

function envelope(version: BeanpodFileV4['version'] | '6.0'): string {
  return JSON.stringify({
    version,
    familyId: 'fam-1',
    familyName: 'Test',
    keyId: 'k1',
    wrappedKeys: { m1: { wrapped: 'w', salt: 's' } },
    passkeyWrappedKeys: {},
    inviteKeys: {},
    encryptedPayload: 'payload',
  });
}

function fileOf(text: string): File {
  return { name: 'family.beanpod', text: async () => text } as unknown as File;
}

describe('loadDroppedFile and the envelope version', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncService.reset();
  });

  it('accepts a 4.0 file and a 5.0 file alike, handing back the envelope for the password step', async () => {
    for (const v of ['4.0', '5.0'] as const) {
      const r = await syncService.loadDroppedFile(fileOf(envelope(v)));
      expect(r.needsPassword).toBe(true);
      expect(r.envelope?.version).toBe(v);
      expect(r.payloadError).toBeUndefined();
      expect(syncService.getState().lastError).toBeNull();
    }
  });

  it('carries a NEWER file out as a typed payloadError, with the same sentence in lastError', async () => {
    // Two channels reach the user: the result's `payloadError` (rendered via
    // `inlineMessageKey`) and `syncStore.error`, which mirrors `lastError`.
    // They must carry the same translated sentence, or whichever arm a page
    // tests first wins with a different message.
    const r = await syncService.loadDroppedFile(fileOf(envelope('6.0')));
    expect(r.success).toBe(false);
    expect(r.needsPassword).toBeUndefined();
    expect(r.payloadError).toBeInstanceOf(UnsupportedBeanpodVersionError);
    expect(r.payloadError?.inlineMessageKey).toBe('podNewerVersion.inline');
    expect(syncService.getState().lastError).toBe('T(podNewerVersion.inline)');
    expect(r).not.toHaveProperty('rawText');
  });

  it('still reports a non-beanpod file through lastError, with no payloadError', async () => {
    const r = await syncService.loadDroppedFile(fileOf('not json {'));
    expect(r.success).toBe(false);
    expect(r.payloadError).toBeUndefined();
    expect(syncService.getState().lastError).toMatch(/Invalid JSON/);
  });
});

describe('a cancelled picker is not a failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncService.reset();
  });

  it('reports `cancelled` with nothing to render, and clears any stale error', async () => {
    // ⚠️ WITHOUT THIS, EVERY CALLER'S ELSE-ARM FIRES ON ESCAPE. The abort arm
    // returned a bare `{ success: false }`, indistinguishable from a real
    // failure, so dismissing the OS picker showed a red error — and if a prior
    // attempt had left `lastError` set, it rendered that raw exception string.
    // Seed a stale error the way a previous failed attempt would.
    await syncService.loadDroppedFile({
      name: 'x.beanpod',
      text: async () => 'not json {',
    } as never);
    expect(syncService.getState().lastError).toBeTruthy();

    // Drive the File System Access branch, whose abort arm is the one that
    // changed, and have the OS picker reject the way a dismissal does.
    const { supportsFileSystemAccess } = await import('../capabilities');
    vi.mocked(supportsFileSystemAccess).mockReturnValueOnce(true);
    (globalThis as { window?: unknown }).window ??= globalThis;
    (globalThis as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker = vi.fn(
      async () => {
        const e = new Error('The user aborted a request.');
        e.name = 'AbortError';
        throw e;
      }
    );
    const r = await syncService.openAndLoadFile();

    expect(r.cancelled).toBe(true);
    expect(r.payloadError).toBeUndefined();
    expect(syncService.getState().lastError).toBeNull();
  });
});
