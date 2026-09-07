/**
 * The local-file readers against the REAL `fileSync`: a file from a newer
 * beanies must come out as a classified `payloadError` with a translated
 * `lastError`, never as a raw exception string and never as nothing.
 *
 * Mocks EXACTLY ONE thing from `@/services/sync/fileSync`: `openFilePicker`,
 * which is a DOM affordance (an `<input type=file>` and a user gesture) that
 * cannot run here. `parseBeanpodV4`, `beanpodVersionFor` and everything else
 * are the real implementations, which is the point: the readers used to carry
 * their own hand-rolled "Unsupported file version" string, and mocking the
 * validator would hide whether the typed throw reaches the caller.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const pickerHook = vi.hoisted(() => ({ file: null as File | null }));
vi.mock('@/services/sync/fileSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/sync/fileSync')>()),
  openFilePicker: vi.fn(async () => pickerHook.file),
}));
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

  it("carries a NEWER file out as a payloadError and leaves the POD's channel alone", async () => {
    // ⚠️ THE TWO CHANNELS MUST NOW DISAGREE, and this test used to pin the
    // opposite. `lastError` is the POD's error channel: it is mirrored into
    // `syncStore.error` and rendered by the sync-failure slab, which carries
    // Reconnect Drive and Force Save. Putting a refused PICK there, over a
    // family that is still open and unchanged, offered to force-save your way
    // out of a file that was never loaded — and it is exactly what made a
    // refusal read as a successful load.
    //
    // The contract that replaces it: `payloadError` is the sole channel for a
    // blocker, so every reader must test it BEFORE `syncStore.error`.
    const r = await syncService.loadDroppedFile(fileOf(envelope('6.0')));
    expect(r.success).toBe(false);
    expect(r.needsPassword).toBeUndefined();
    expect(r.payloadError).toBeInstanceOf(UnsupportedBeanpodVersionError);
    expect(r.payloadError?.inlineMessageKey).toBe('podNewerVersion.inline');
    expect(syncService.getState().lastError).toBeNull();
    expect(r).not.toHaveProperty('rawText');
  });

  it('treats a version written as a JSON NUMBER as a newer file, not a broken one', async () => {
    // ⚠️ HOW A HAND-EDITED FILE ACTUALLY LOOKS. Typing `"version": 6.0` into an
    // exported beanpod produces a JSON number, and the guard used to demand a
    // string before it would even consider the known set — so this fell through
    // to a generic "missing version", with worse copy and nothing in CloudWatch.
    const raw = JSON.parse(envelope('4.0')) as Record<string, unknown>;
    raw.version = 6.0;
    const r = await syncService.loadDroppedFile(fileOf(JSON.stringify(raw)));
    expect(r.payloadError).toBeInstanceOf(UnsupportedBeanpodVersionError);
    expect(r.payloadError?.inlineMessageKey).toBe('podNewerVersion.inline');
    // `String(6.0)` is `'6'`: a JSON `6.0` and a `6` are the same value once
    // parsed. Unavoidable, and pinned so nobody later "fixes" it into a lie.
    expect((r.payloadError as UnsupportedBeanpodVersionError).blockDetail).toBe('version=6');
  });

  it('still calls a file with NO version simply not a beanpod', async () => {
    const raw = JSON.parse(envelope('4.0')) as Record<string, unknown>;
    delete raw.version;
    const r = await syncService.loadDroppedFile(fileOf(JSON.stringify(raw)));
    expect(r.payloadError).toBeUndefined();
    expect(syncService.getState().lastError).toMatch(/missing version/);
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

    // Drive the File System Access branch and have the OS picker reject the way
    // a dismissal does. The sibling test below covers the FALLBACK branch, which
    // is the one iOS, Android and Safari actually take.
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

  it('reports `cancelled` from the FALLBACK picker too, which is the path every shipping platform takes', async () => {
    // ⚠️ THE FIRST FIX COVERED CHROMIUM DESKTOP ONLY. `supportsFileSystemAccess`
    // needs `showOpenFilePicker`; iOS, Android and Safari all fall through to
    // `openAndLoadFileFallback`, whose cancel arm returned a bare
    // `{ success: false }`. So the red "import failed" on Escape was fixed for
    // developers and nobody else. This suite's default mock IS the fallback.
    await syncService.loadDroppedFile({
      name: 'x.beanpod',
      text: async () => 'not json {',
    } as never);
    expect(syncService.getState().lastError).toBeTruthy();

    // `openFilePicker` resolves `null` when the person dismisses the sheet.
    pickerHook.file = null;
    const r = await syncService.openAndLoadFile();

    expect(r.cancelled).toBe(true);
    expect(r.payloadError).toBeUndefined();
    expect(syncService.getState().lastError).toBeNull();
  });
});
