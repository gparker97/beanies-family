// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// node env has no navigator / window — stub minimally so the module under
// test (which reads navigator.onLine and calls window.addEventListener)
// can import and run.
if (typeof globalThis.navigator === 'undefined') {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: true } as unknown as Navigator,
    writable: true,
    configurable: true,
  });
}
if (typeof globalThis.window === 'undefined') {
  Object.defineProperty(globalThis, 'window', {
    value: {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window,
    writable: true,
    configurable: true,
  });
}
import { installInlineBackend } from '@/services/automerge/worker/__tests__/inlineHarness';
import * as projection from '@/services/automerge/projection';
import { mutate } from '@/services/automerge/worker/docClient';
import type { CollectionName } from '@/types/automerge';

// --- Mocks -----------------------------------------------------------
//
// Mock the Drive client, token provider, compressor, and sync store
// surface. photoStore's orchestration logic is what we care about —
// the underlying APIs are exercised in their own test files.

vi.mock('@/services/google/googleAuth', () => ({
  requestAccessToken: vi.fn().mockResolvedValue('mock-token'),
}));

// Partial mock of docClient: keep every real function (so `installInlineBackend`
// wires the REAL inline backend and the store's ops run end-to-end against the
// real doc), but wrap `mutate` as a delegating spy we can override per-test (the
// forced-write-failure rollback case).
vi.mock('@/services/automerge/worker/docClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/automerge/worker/docClient')>();
  return { ...actual, mutate: vi.fn(actual.mutate) };
});

const driveMocks = vi.hoisted(() => {
  class DriveApiError extends Error {
    readonly status: number;
    readonly reason?: string;
    constructor(message: string, status: number, reason?: string) {
      super(message);
      this.name = 'DriveApiError';
      this.status = status;
      this.reason = reason;
    }
  }
  class DriveFileNotFoundError extends DriveApiError {
    constructor(message: string, status: number) {
      super(message, status);
      this.name = 'DriveFileNotFoundError';
    }
  }
  return {
    createFile: vi.fn(),
    deleteFile: vi.fn(),
    deletePermission: vi.fn(),
    downloadFileBlob: vi.fn(),
    findOrCreateFolder: vi.fn(),
    getFileMetadata: vi.fn(),
    listFilePermissions: vi.fn(),
    listFilesInFolder: vi.fn(),
    setPublicLinkPermission: vi.fn(),
    DriveApiError,
    DriveFileNotFoundError,
  };
});

const { DriveFileNotFoundError } = driveMocks;

vi.mock('@/services/google/driveService', () => ({
  createFile: driveMocks.createFile,
  deleteFile: driveMocks.deleteFile,
  deletePermission: driveMocks.deletePermission,
  downloadFileBlob: driveMocks.downloadFileBlob,
  findOrCreateFolder: driveMocks.findOrCreateFolder,
  getFileMetadata: driveMocks.getFileMetadata,
  listFilePermissions: driveMocks.listFilePermissions,
  listFilesInFolder: driveMocks.listFilesInFolder,
  setPublicLinkPermission: driveMocks.setPublicLinkPermission,
  DriveApiError: driveMocks.DriveApiError,
  DriveFileNotFoundError: driveMocks.DriveFileNotFoundError,
}));

// The diagnostic firehose + error reporter: captured so a test can pin the event a path emits.
const telemetryMocks = vi.hoisted(() => ({ logEvent: vi.fn(), reportError: vi.fn() }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: telemetryMocks.logEvent }));
vi.mock('@/utils/errorReporter', () => ({ reportError: telemetryMocks.reportError }));

vi.mock('@/services/photos/photoCompression', async () => {
  const actual = await vi.importActual<typeof import('@/services/photos/photoCompression')>(
    '@/services/photos/photoCompression'
  );
  return {
    ...actual,
    compress: vi.fn(async (file: File) => ({
      blob: new Blob([await file.arrayBuffer()], { type: 'image/jpeg' }),
      width: 800,
      height: 600,
      mime: 'image/jpeg',
    })),
  };
});

// syncStore exposes `driveFileId` — photoStore reads it to resolve the
// canonical folder. Stub with a trivial Pinia-compatible store factory.
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ driveFileId: 'beanpod-file-1' }),
}));

const familyCtx = vi.hoisted(() => ({ activeFamilyId: 'fam-photostore-test' }));
vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => familyCtx,
}));

// --- Imports (after mocks are set up) --------------------------------

import { usePhotoStore, __internals as storeInternals } from '../photoStore';
import {
  __internals as queueInternals,
  deletePhotoQueueDatabase,
  enqueueUpload,
  flushQueue,
} from '@/services/sync/photoUploadQueue';

// --- Helpers ---------------------------------------------------------

function makeFile(name = 'photo.jpg'): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff])], name, { type: 'image/jpeg' });
}

function setOnlineStatus(online: boolean): void {
  // navigator.onLine is a getter in node-under-happy-dom; override via defineProperty.
  Object.defineProperty(globalThis.navigator, 'onLine', {
    configurable: true,
    get: () => online,
  });
}

async function ensureEntity(collection: string, id: string): Promise<void> {
  await mutate({
    op: 'set',
    collection: collection as CollectionName,
    id,
    entity: { id, photoIds: [] },
  });
}

/**
 * Some store methods (`linkPhotoToEntity`, `markDeleted`) issue an un-awaited
 * `void mutate(...)`. In the inline backend the projection is only updated once
 * that mutate resolves, so await the last delegated call before reading it back.
 */
async function settleMutations(): Promise<void> {
  const last = vi.mocked(mutate).mock.results.at(-1);
  if (last?.type === 'return') await last.value;
  // `markDeleted`/`linkPhotoToEntity` now go through `fireAndForgetMutate`, which
  // calls the real module-local `mutate` (not the vi.fn above), so its inline
  // apply chain isn't captured here — flush a macrotask so it settles too.
  await new Promise((r) => setTimeout(r, 0));
}

/** Drop every photoId from a flat activity host. */
async function detach(activityId: string): Promise<void> {
  await mutate({ op: 'patch', collection: 'activities', id: activityId, patch: { photoIds: [] } });
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

/** Rewrite timestamps on a photos record (the sweep's grace windows read them). */
async function backdate(photoId: string, patch: Record<string, string>): Promise<void> {
  await mutate({ op: 'patch', collection: 'photos', id: photoId, patch });
}

function eventsFor(surface: string, action: string): Array<Record<string, unknown>> {
  return telemetryMocks.logEvent.mock.calls
    .map((c) => c[0] as { surface: string; context?: Record<string, unknown> })
    .filter((e) => e.surface === surface && e.context?.action === action)
    .map((e) => e.context ?? {});
}

// --- Tests -----------------------------------------------------------

describe('photoStore', () => {
  const FAMILY_ID = 'fam-photostore-test';

  beforeEach(async () => {
    setActivePinia(createPinia());
    await installInlineBackend();
    setOnlineStatus(true);
    familyCtx.activeFamilyId = 'fam-photostore-test';

    // Reset mocks
    driveMocks.createFile.mockReset().mockResolvedValue({ fileId: 'drive-file-1', name: 'x' });
    driveMocks.deleteFile.mockReset().mockResolvedValue(undefined);
    driveMocks.downloadFileBlob.mockReset().mockResolvedValue(new Blob());
    driveMocks.findOrCreateFolder.mockReset().mockResolvedValue('folder-nested');
    driveMocks.getFileMetadata.mockReset().mockResolvedValue({ parents: ['folder-1'] });
    driveMocks.setPublicLinkPermission.mockReset().mockResolvedValue(undefined);
    driveMocks.listFilePermissions.mockReset().mockResolvedValue([]);
    driveMocks.deletePermission.mockReset().mockResolvedValue(undefined);
    driveMocks.listFilesInFolder.mockReset().mockResolvedValue([]);
    telemetryMocks.logEvent.mockClear();
    telemetryMocks.reportError.mockClear();

    // Photo collections are now statically registered in worker/photoOps.ts
    // (no per-test clear needed). [ADR-032 consolidated test pass pending]
    void storeInternals;

    const store = usePhotoStore();
    await store.activate(FAMILY_ID);
  });

  afterEach(async () => {
    await queueInternals.reset();
    await deletePhotoQueueDatabase(FAMILY_ID);
    // The fail-safe test registers a throwing `boom` collect hook into the
    // shared (module-static) photoCollections map, which the harness resets do
    // NOT clear. Re-register it non-throwing so a leaked hook can't abort a
    // later test's gcOrphans sweep.
    storeInternals.registerPhotoCollection('boom', {
      attach: () => {},
      collect: () => [],
    });
  });

  it('photos does NOT re-materialize on an unrelated (non-photos) mutation (F9)', async () => {
    await ensureEntity('activities', 'act-f9');
    const store = usePhotoStore();
    await store.addPhoto(makeFile(), 'activities', 'act-f9');

    const before = store.photos; // cached computed value
    // A mutation to a DIFFERENT collection bumps docVersion but must NOT
    // invalidate the photos computed (it depends on the photos map ref alone).
    await mutate({ op: 'set', collection: 'todos', id: 'unrelated', entity: { id: 'unrelated' } });
    const after = store.photos;

    expect(after).toBe(before); // same object → the O(n) rebuild did not re-run
  });

  it('addPhoto (online) compresses, uploads, and writes an Automerge record', async () => {
    storeInternals.registerPhotoCollection('activities');
    await ensureEntity('activities', 'act-1');
    const store = usePhotoStore();

    const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-1', 'member-1');

    expect(photoId).toBeTruthy();
    expect(driveMocks.createFile).toHaveBeenCalledTimes(1);
    const [, folderId, filename, blob, mime] = driveMocks.createFile.mock.calls[0]!;
    // Uploads land in the resolved photos subfolder, not the bean-pod root.
    expect(folderId).toBe('folder-nested');
    expect(filename).toBe(`beanies-photo-${photoId}.jpg`);
    expect(blob).toBeInstanceOf(Blob);
    expect(mime).toBe('image/jpeg');

    const record = projection.getById('photos', photoId);
    expect(record).toBeDefined();
    expect(record!.driveFileId).toBe('drive-file-1');
    expect(record!.createdBy).toBe('member-1');
    expect(record!.createdAt).toBe(record!.updatedAt);
    expect(record!.deletedAt).toBeUndefined();

    // Entity got the photoId appended
    const activity = projection.getById('activities', 'act-1');
    expect(activity!.photoIds).toContain(photoId);
  });

  it('linkPhotoToEntity links a stored photoId to another entity without re-uploading', async () => {
    storeInternals.registerPhotoCollection('activities');
    await ensureEntity('activities', 'act-1');
    await ensureEntity('activities', 'act-2');
    const store = usePhotoStore();

    // One document, stored once via addPhoto, then linked to a second entity (#30).
    const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-1', 'member-1');
    store.linkPhotoToEntity('activities', 'act-2', photoId);
    await settleMutations();

    expect(projection.getById('activities', 'act-1')!.photoIds).toContain(photoId);
    expect(projection.getById('activities', 'act-2')!.photoIds).toContain(photoId);
    // Stored exactly once — no second Drive upload for the linked entity.
    expect(driveMocks.createFile).toHaveBeenCalledTimes(1);
  });

  it('addPhoto rolls back the Drive file when Automerge write fails', async () => {
    storeInternals.registerPhotoCollection('activities');
    await ensureEntity('activities', 'act-1');
    const store = usePhotoStore();
    driveMocks.createFile.mockResolvedValue({ fileId: 'drive-rollback', name: 'x' });

    // Force the Automerge write to fail: the entity seed above already ran, so
    // the NEXT mutate is `finalizeUpload`'s batch — reject it so the store must
    // roll back the just-uploaded Drive file.
    vi.mocked(mutate).mockRejectedValueOnce(new Error('forced write failure'));

    await expect(store.addPhoto(makeFile(), 'activities', 'act-1')).rejects.toThrow();
    expect(driveMocks.deleteFile).toHaveBeenCalledWith('mock-token', 'drive-rollback');
  });

  it('addPhoto offline enqueues the upload and does NOT write an Automerge record', async () => {
    setOnlineStatus(false);
    storeInternals.registerPhotoCollection('activities');
    await ensureEntity('activities', 'act-1');
    const store = usePhotoStore();

    const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-1');

    expect(driveMocks.createFile).not.toHaveBeenCalled();
    expect(projection.getById('photos', photoId)).toBeUndefined();
    const pendingForEntity = store.pendingUploadsFor('activities', 'act-1');
    expect(pendingForEntity).toHaveLength(1);
    expect(pendingForEntity[0]!.photoId).toBe(photoId);
  });

  it('addPhoto stores a PDF as-is (no compression, fileName + 0×0 recorded)', async () => {
    storeInternals.registerPhotoCollection('activities');
    await ensureEntity('activities', 'act-pdf');
    const store = usePhotoStore();
    const { compress } = await import('@/services/photos/photoCompression');
    vi.mocked(compress).mockClear();

    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], 'United eticket.pdf', {
      type: 'application/pdf',
    });
    const { photoId, status } = await store.addPhoto(pdf, 'activities', 'act-pdf', 'member-1');

    expect(status).toBe('completed');
    // Passthrough: compression is skipped entirely for PDFs.
    expect(compress).not.toHaveBeenCalled();
    const [, , filename, blob, mime] = driveMocks.createFile.mock.calls[0]!;
    expect(filename).toBe(`beanies-doc-${photoId}.pdf`);
    expect(mime).toBe('application/pdf');
    expect(blob).toBe(pdf); // raw bytes, not recompressed

    const record = projection.getById('photos', photoId);
    expect(record!.mime).toBe('application/pdf');
    expect(record!.width).toBe(0);
    expect(record!.height).toBe(0);
    expect(record!.fileName).toBe('United eticket.pdf');
  });

  it('gcOrphans aborts (deletes nothing) when a collect hook throws — fail-safe', async () => {
    // A throwing collect hook must never widen the delete set: the whole
    // sweep aborts so no referenced photo is mistaken for an orphan.
    storeInternals.registerPhotoCollection('boom', {
      attach: () => {},
      collect: () => {
        throw new Error('hook blew up');
      },
    });
    storeInternals.registerPhotoCollection('activities');
    await ensureEntity('activities', 'act-x');
    const store = usePhotoStore();
    const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-x');
    // Drop the reference so it WOULD look orphaned if the sweep proceeded.
    await mutate({ op: 'patch', collection: 'activities', id: 'act-x', patch: { photoIds: [] } });

    const result = await store.gcOrphans();
    expect(result.deleted).toBe(0);
    expect(projection.getById('photos', photoId)).toBeDefined();
  });

  it('getImageUrl returns a resized thumbnailLink and caches within TTL', async () => {
    storeInternals.registerPhotoCollection('activities');
    await ensureEntity('activities', 'act-1');
    const store = usePhotoStore();
    driveMocks.getFileMetadata
      .mockResolvedValueOnce({ parents: ['folder-1'] }) // resolveCanonicalFolderId
      .mockResolvedValueOnce({
        thumbnailLink: 'https://lh3.googleusercontent.com/abc=s220',
      });

    const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-1');

    const url = await store.getImageUrl(photoId, 'thumb');
    expect(url).toMatch(/=s400$/);

    // Second call returns from in-memory cache (no extra Drive fetch).
    await store.getImageUrl(photoId, 'thumb');
    const thumbnailFetches = driveMocks.getFileMetadata.mock.calls.filter(
      (c) => c[2] === 'thumbnailLink'
    );
    expect(thumbnailFetches).toHaveLength(1);
  });

  it('getImageUrl flags the photo as unresolved on DriveFileNotFoundError', async () => {
    storeInternals.registerPhotoCollection('activities');
    await ensureEntity('activities', 'act-1');
    const store = usePhotoStore();
    driveMocks.getFileMetadata
      .mockResolvedValueOnce({ parents: ['folder-1'] })
      .mockRejectedValueOnce(new DriveFileNotFoundError('not found', 404));

    const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-1');
    const url = await store.getImageUrl(photoId, 'thumb');
    expect(url).toBeNull();
    expect(store.isUnresolved(photoId)).toBe(true);
  });

  it('🔴 getImageUrl does NOT flag the photo unresolved when the Drive is full', async () => {
    // `driveService` raises a full Drive as a plain `DriveApiError`, never a
    // `DriveFileNotFoundError`, so a healthy photo is not flipped to "missing".
    storeInternals.registerPhotoCollection('activities');
    await ensureEntity('activities', 'act-1');
    const store = usePhotoStore();
    driveMocks.getFileMetadata
      .mockResolvedValueOnce({ parents: ['folder-1'] })
      .mockRejectedValueOnce(
        new driveMocks.DriveApiError('storage full', 403, 'storageQuotaExceeded')
      );

    const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-1');
    await expect(store.getImageUrl(photoId, 'thumb')).rejects.toMatchObject({
      status: 403,
      reason: 'storageQuotaExceeded',
    });
    expect(store.isUnresolved(photoId)).toBe(false);
  });

  it('getPublicUrl returns deterministic Drive CDN URLs and honors tombstone/unresolved guards', async () => {
    storeInternals.registerPhotoCollection('activities');
    await ensureEntity('activities', 'act-pub');
    const store = usePhotoStore();
    const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-pub');
    const photo = store.photos[photoId];
    expect(photo).toBeDefined();
    const driveFileId = photo!.driveFileId;

    const thumb = store.getPublicUrl(photoId, 'thumb');
    expect(thumb).toBe(
      `https://lh3.googleusercontent.com/d/${encodeURIComponent(driveFileId)}=w400`
    );

    const full = store.getPublicUrl(photoId, 'full');
    expect(full).toBe(
      `https://lh3.googleusercontent.com/d/${encodeURIComponent(driveFileId)}=w2048`
    );

    store.markUnresolved(photoId);
    expect(store.getPublicUrl(photoId)).toBeNull();
  });

  it('addPhoto sets anyone-with-link permission after creating the Drive file', async () => {
    storeInternals.registerPhotoCollection('activities');
    await ensureEntity('activities', 'act-perm');
    const store = usePhotoStore();
    await store.addPhoto(makeFile(), 'activities', 'act-perm');

    expect(driveMocks.setPublicLinkPermission).toHaveBeenCalled();
    const [token, fileId] = driveMocks.setPublicLinkPermission.mock.calls[0]!;
    expect(token).toBeTruthy();
    expect(typeof fileId).toBe('string');
  });

  it('addPhoto does NOT fail the upload when permission set throws', async () => {
    storeInternals.registerPhotoCollection('activities');
    await ensureEntity('activities', 'act-perm-fail');
    driveMocks.setPublicLinkPermission.mockRejectedValueOnce(
      new DriveFileNotFoundError('forbidden', 403)
    );
    const store = usePhotoStore();
    // Should not throw — permission failure is non-fatal for upload.
    const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-perm-fail');
    expect(store.photos[photoId]).toBeDefined();
  });

  it('replacePhotoFile swaps driveFileId and preserves UUID + createdAt', async () => {
    storeInternals.registerPhotoCollection('activities');
    await ensureEntity('activities', 'act-1');
    const store = usePhotoStore();
    driveMocks.createFile
      .mockResolvedValueOnce({ fileId: 'drive-original', name: 'x' })
      .mockResolvedValueOnce({ fileId: 'drive-replacement', name: 'x' });

    const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-1');
    const originalCreatedAt = projection.getById('photos', photoId)!.createdAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    await store.replacePhotoFile(photoId, makeFile('new.jpg'));

    const record = projection.getById('photos', photoId)!;
    expect(record.id).toBe(photoId);
    expect(record.driveFileId).toBe('drive-replacement');
    expect(record.createdAt).toBe(originalCreatedAt);
    expect(record.updatedAt).not.toBe(originalCreatedAt);
    // C11: the previous file is RETIRED onto the record's grace list, never deleted inline —
    // a peer that has not received the patch still renders it.
    expect(driveMocks.deleteFile).not.toHaveBeenCalledWith('mock-token', 'drive-original');
    expect(record.retiredDriveFileIds).toEqual(['drive-original']);
  });

  it('markDeleted tombstones an unreferenced photo without touching the Drive bytes', async () => {
    storeInternals.registerPhotoCollection('activities');
    await ensureEntity('activities', 'act-1');
    const store = usePhotoStore();

    const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-1');
    await detach('act-1');
    driveMocks.deleteFile.mockClear();
    expect(await store.markDeleted(photoId)).toBe(true);

    expect(projection.getById('photos', photoId)!.deletedAt).toBeDefined();
    expect(driveMocks.deleteFile).not.toHaveBeenCalled();
  });

  it('gcOrphans removes tombstones older than 24h and deletes the Drive file', async () => {
    storeInternals.registerPhotoCollection('activities');
    await ensureEntity('activities', 'act-1');
    const store = usePhotoStore();

    const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-1');
    await detach('act-1');
    // Manually backdate the tombstone so it's past the grace period.
    await backdate(photoId, { deletedAt: hoursAgo(48) });
    driveMocks.deleteFile.mockClear();

    const result = await store.gcOrphans();
    expect(result.deleted).toBe(1);
    expect(projection.getById('photos', photoId)).toBeUndefined();
    expect(driveMocks.deleteFile).toHaveBeenCalledWith('mock-token', 'drive-file-1');
  });

  it('gcOrphans keeps tombstones still within the 24h grace period', async () => {
    storeInternals.registerPhotoCollection('activities');
    await ensureEntity('activities', 'act-1');
    const store = usePhotoStore();

    const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-1');
    await detach('act-1');
    await store.markDeleted(photoId); // recent tombstone

    const result = await store.gcOrphans();
    expect(result.deleted).toBe(0);
    expect(projection.getById('photos', photoId)).toBeDefined();
  });

  it('gcOrphans cascades photos with zero inbound entity references', async () => {
    storeInternals.registerPhotoCollection('activities');
    await ensureEntity('activities', 'act-1');
    const store = usePhotoStore();
    const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-1');

    // Manually detach the photo from the entity → zero references, and age it past the
    // orphan grace (a fresh unreferenced record is an upload whose attach is still landing).
    await detach('act-1');
    await backdate(photoId, { createdAt: hoursAgo(25) });

    const result = await store.gcOrphans();
    expect(result.deleted).toBe(1);
    expect(projection.getById('photos', photoId)).toBeUndefined();
  });

  it('gcOrphans keeps a FRESH unreferenced record (24h orphan grace, C11)', async () => {
    storeInternals.registerPhotoCollection('activities');
    await ensureEntity('activities', 'act-1');
    const store = usePhotoStore();
    const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-1');
    await detach('act-1');

    const result = await store.gcOrphans();
    expect(result.deleted).toBe(0);
    expect(projection.getById('photos', photoId)).toBeDefined();
    expect(driveMocks.deleteFile).not.toHaveBeenCalled();
  });

  it('gcOrphans retains a photo that is still referenced by its entity', async () => {
    // ADR-032: photo collections are now STATICALLY registered in worker/photoOps
    // (no "zero collections registered" foundation state exists). A photo attached
    // to a live entity is referenced by the collect hooks → never swept.
    await ensureEntity('activities', 'act-1');
    const store = usePhotoStore();
    const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-1');

    const result = await store.gcOrphans();
    expect(result.deleted).toBe(0);
    expect(projection.getById('photos', photoId)).toBeDefined();
  });

  describe('addPhoto — transient-failure queue fallback', () => {
    it('returns status:completed on a successful online upload', async () => {
      storeInternals.registerPhotoCollection('activities');
      await ensureEntity('activities', 'act-completed');
      const store = usePhotoStore();
      const result = await store.addPhoto(makeFile(), 'activities', 'act-completed');
      expect(result.status).toBe('completed');
      expect(projection.getById('photos', result.photoId)).toBeDefined();
    });

    it('falls back to the queue on a transient Drive failure (5xx)', async () => {
      storeInternals.registerPhotoCollection('activities');
      await ensureEntity('activities', 'act-503');
      driveMocks.createFile
        .mockReset()
        .mockRejectedValueOnce(new Error('Drive upload failed: 503 Service Unavailable'));
      const store = usePhotoStore();

      const result = await store.addPhoto(makeFile(), 'activities', 'act-503');

      expect(result.status).toBe('queued');
      expect(result.photoId).toBeTruthy();
      // No doc record yet — queue writes it when flushed
      expect(projection.getById('photos', result.photoId)).toBeUndefined();
      // Queue entry exists
      const pending = store.pendingUploadsFor('activities', 'act-503');
      expect(pending).toHaveLength(1);
      expect(pending[0]!.photoId).toBe(result.photoId);
    });

    it('falls back to the queue on AbortError', async () => {
      storeInternals.registerPhotoCollection('activities');
      await ensureEntity('activities', 'act-abort');
      const abortErr = new Error('aborted');
      abortErr.name = 'AbortError';
      driveMocks.createFile.mockReset().mockRejectedValueOnce(abortErr);
      const store = usePhotoStore();

      const result = await store.addPhoto(makeFile(), 'activities', 'act-abort');
      expect(result.status).toBe('queued');
    });

    it('refuses to queue (no entry, reported) when another family opened during the upload', async () => {
      storeInternals.registerPhotoCollection('activities');
      await ensureEntity('activities', 'act-switch');
      driveMocks.createFile.mockReset().mockImplementationOnce(async () => {
        familyCtx.activeFamilyId = 'fam-photostore-other'; // the person switches family
        throw new Error('Drive upload failed: 503 Service Unavailable');
      });
      const store = usePhotoStore();

      await expect(store.addPhoto(makeFile(), 'activities', 'act-switch')).rejects.toThrow(
        /queue photo upload/
      );
      expect(telemetryMocks.reportError).toHaveBeenCalledWith(
        expect.objectContaining({ context: { action: 'queue-family-mismatch' } })
      );
      await store.refreshPending();
      expect(store.pendingUploadsFor('activities', 'act-switch')).toHaveLength(0);
    });

    it('a queued entry carries the family it belongs to', async () => {
      setOnlineStatus(false);
      storeInternals.registerPhotoCollection('activities');
      await ensureEntity('activities', 'act-fam');
      const store = usePhotoStore();
      await store.addPhoto(makeFile(), 'activities', 'act-fam');
      expect(store.pendingUploadsFor('activities', 'act-fam')[0]!.familyId).toBe(FAMILY_ID);
    });

    it('re-throws non-transient errors (Drive 400) without queueing', async () => {
      storeInternals.registerPhotoCollection('activities');
      await ensureEntity('activities', 'act-400');
      driveMocks.createFile
        .mockReset()
        .mockRejectedValueOnce(new Error('Drive upload failed: 400 Bad Request'));
      const store = usePhotoStore();

      await expect(store.addPhoto(makeFile(), 'activities', 'act-400')).rejects.toThrow(/400/);
      // No queue entry — non-transient failures don't get retried.
      expect(store.pendingUploadsFor('activities', 'act-400')).toHaveLength(0);
    });
  });

  describe('C11 — detach is the primitive', () => {
    it('markDeleted refuses while another host still references the photo', async () => {
      storeInternals.registerPhotoCollection('activities');
      await ensureEntity('activities', 'act-1');
      await ensureEntity('activities', 'act-2');
      const store = usePhotoStore();
      const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-1');
      store.linkPhotoToEntity('activities', 'act-2', photoId);
      await settleMutations();

      // Removed from act-1 only: act-2 still shows it, so no tombstone.
      await detach('act-1');
      expect(await store.markDeleted(photoId)).toBe(false);
      expect(projection.getById('photos', photoId)!.deletedAt).toBeUndefined();
      expect(eventsFor('photo-detach', 'kept-referenced')).toHaveLength(1);

      // Removed from the last host: tombstoned.
      await detach('act-2');
      expect(await store.markDeleted(photoId)).toBe(true);
      expect(projection.getById('photos', photoId)!.deletedAt).toBeDefined();
    });

    it('a shared itinerary removed from one booking segment survives on the other', async () => {
      const store = usePhotoStore();
      await ensureEntity('activities', 'act-src');
      const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-src');
      await detach('act-src');
      // One extracted document linked to two legs of the same trip (#30).
      await mutate({
        op: 'set',
        collection: 'vacations',
        id: 'vac-1',
        entity: {
          id: 'vac-1',
          travelSegments: [
            { id: 'seg-a', photoIds: [photoId] },
            { id: 'seg-b', photoIds: [photoId] },
          ],
          accommodations: [],
          transportation: [],
        },
      });

      // TravelPlansPage's order: the segment write first, then the gated tombstone.
      await mutate({
        op: 'patch',
        collection: 'vacations',
        id: 'vac-1',
        patch: {
          travelSegments: [
            { id: 'seg-a', photoIds: [] },
            { id: 'seg-b', photoIds: [photoId] },
          ],
        },
      });
      expect(await store.markDeleted(photoId)).toBe(false);
      expect(projection.getById('photos', photoId)!.deletedAt).toBeUndefined();
    });

    it('markDeleted keeps the photo when the reference check itself fails', async () => {
      storeInternals.registerPhotoCollection('boom', {
        attach: () => {},
        collect: () => {
          throw new Error('hook blew up');
        },
      });
      storeInternals.registerPhotoCollection('activities');
      await ensureEntity('activities', 'act-1');
      const store = usePhotoStore();
      const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-1');
      await detach('act-1');

      expect(await store.markDeleted(photoId)).toBe(false);
      expect(projection.getById('photos', photoId)!.deletedAt).toBeUndefined();
      expect(eventsFor('photo-detach', 'kept-unknown')).toHaveLength(1);
    });

    it('markDeleted with awaitDetachMs tombstones once the host write lands', async () => {
      storeInternals.registerPhotoCollection('activities');
      await ensureEntity('activities', 'act-1');
      const store = usePhotoStore();
      const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-1');

      // The avatar modal's shape: the tombstone is requested BEFORE the parent's save lands.
      const pending = store.markDeleted(photoId, { awaitDetachMs: 2000 });
      await new Promise((r) => setTimeout(r, 5));
      expect(projection.getById('photos', photoId)!.deletedAt).toBeUndefined();
      await detach('act-1');

      expect(await pending).toBe(true);
      expect(projection.getById('photos', photoId)!.deletedAt).toBeDefined();
    });

    it('markDeleted with awaitDetachMs gives up (photo kept) when the save never lands', async () => {
      storeInternals.registerPhotoCollection('activities');
      await ensureEntity('activities', 'act-1');
      const store = usePhotoStore();
      const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-1');

      expect(await store.markDeleted(photoId, { awaitDetachMs: 20 })).toBe(false);
      expect(projection.getById('photos', photoId)!.deletedAt).toBeUndefined();
    });

    it('a re-attach clears the tombstone', async () => {
      storeInternals.registerPhotoCollection('activities');
      await ensureEntity('activities', 'act-1');
      await ensureEntity('activities', 'act-2');
      const store = usePhotoStore();
      const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-1');
      await detach('act-1');
      expect(await store.markDeleted(photoId)).toBe(true);

      store.linkPhotoToEntity('activities', 'act-2', photoId);
      await settleMutations();

      expect(projection.getById('activities', 'act-2')!.photoIds).toContain(photoId);
      expect(projection.getById('photos', photoId)!.deletedAt).toBeUndefined();
    });

    it('tombstoning revokes the anyone-with-link permission immediately', async () => {
      storeInternals.registerPhotoCollection('activities');
      await ensureEntity('activities', 'act-1');
      const store = usePhotoStore();
      const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-1');
      await detach('act-1');
      driveMocks.listFilePermissions.mockResolvedValue([
        { id: 'perm-owner', type: 'user', role: 'owner', emailAddress: 'a@b.c' },
        { id: 'perm-anyone', type: 'anyone', role: 'reader' },
      ]);

      await store.markDeleted(photoId);

      expect(driveMocks.deletePermission).toHaveBeenCalledTimes(1);
      expect(driveMocks.deletePermission).toHaveBeenCalledWith(
        'mock-token',
        'drive-file-1',
        'perm-anyone'
      );
      expect(eventsFor('photo-public-link', 'revoke')).toEqual([
        expect.objectContaining({ file_count: 1 }),
      ]);
    });

    it('a failed revoke is logged on photo-public-link, never thrown', async () => {
      storeInternals.registerPhotoCollection('activities');
      await ensureEntity('activities', 'act-1');
      const store = usePhotoStore();
      const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-1');
      await detach('act-1');
      driveMocks.listFilePermissions.mockRejectedValue(
        new driveMocks.DriveApiError('Drive 500', 500)
      );

      expect(await store.markDeleted(photoId)).toBe(true);
      expect(eventsFor('photo-public-link', 'revoke-failed')).toEqual([
        expect.objectContaining({ http_status: 500 }),
      ]);
    });
  });

  describe('C11 — gcOrphans guards', () => {
    it('never collects a tombstone that a host still references, even past the grace', async () => {
      storeInternals.registerPhotoCollection('activities');
      await ensureEntity('activities', 'act-1');
      const store = usePhotoStore();
      const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-1');
      // A tombstone a concurrent re-attach raced: deletedAt set while act-1 references it.
      await backdate(photoId, { deletedAt: hoursAgo(48) });

      const result = await store.gcOrphans();
      expect(result.deleted).toBe(0);
      expect(projection.getById('photos', photoId)).toBeDefined();
      expect(driveMocks.deleteFile).not.toHaveBeenCalled();
    });

    it('skips the record delete when no token is available', async () => {
      storeInternals.registerPhotoCollection('activities');
      await ensureEntity('activities', 'act-1');
      const store = usePhotoStore();
      const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-1');
      await detach('act-1');
      await backdate(photoId, { deletedAt: hoursAgo(48) });
      const { requestAccessToken } = await import('@/services/google/googleAuth');
      vi.mocked(requestAccessToken).mockRejectedValueOnce(new Error('no session'));

      const result = await store.gcOrphans();
      expect(result.deleted).toBe(0);
      expect(projection.getById('photos', photoId)).toBeDefined();
      expect(eventsFor('photo-gc', 'sweep-no-token')).toHaveLength(1);
    });

    it('reclaims retired Drive files once the record is past the grace window', async () => {
      storeInternals.registerPhotoCollection('activities');
      await ensureEntity('activities', 'act-1');
      const store = usePhotoStore();
      driveMocks.createFile
        .mockResolvedValueOnce({ fileId: 'drive-original', name: 'x' })
        .mockResolvedValueOnce({ fileId: 'drive-replacement', name: 'x' });
      const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-1');
      await store.replacePhotoFile(photoId, makeFile('new.jpg'));

      // Inside the grace: nothing reclaimed, the record is live (still referenced).
      expect((await store.gcOrphans()).reclaimed).toBe(0);
      expect(driveMocks.deleteFile).not.toHaveBeenCalled();

      await backdate(photoId, { updatedAt: hoursAgo(25) });
      const result = await store.gcOrphans();
      expect(result.reclaimed).toBe(1);
      expect(result.deleted).toBe(0);
      expect(driveMocks.deleteFile).toHaveBeenCalledWith('mock-token', 'drive-original');
      const record = projection.getById('photos', photoId)!;
      expect(record.driveFileId).toBe('drive-replacement');
      expect(record.retiredDriveFileIds).toEqual([]);
    });
  });

  describe('C11 — upload idempotency and rollback', () => {
    const queued = (photoId: string, entityId = 'act-1') => ({
      photoId,
      entityCollection: 'activities',
      entityId,
      blob: new Blob([new Uint8Array([1])]),
      filename: `beanies-photo-${photoId}.jpg`,
      mime: 'image/jpeg',
      width: 1,
      height: 1,
      sizeBytes: 1,
    });

    it('a queued retry of an already-finalized photo re-attaches without a second upload', async () => {
      storeInternals.registerPhotoCollection('activities');
      await ensureEntity('activities', 'act-1');
      const store = usePhotoStore();
      const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-1');
      expect(driveMocks.createFile).toHaveBeenCalledTimes(1);
      // The entry a prior session left behind for the SAME photo (its reply was lost).
      await enqueueUpload(queued(photoId));

      await flushQueue();

      expect(driveMocks.createFile).toHaveBeenCalledTimes(1);
      await store.refreshPending();
      expect(store.pendingUploadsFor('activities', 'act-1')).toHaveLength(0);
      expect(projection.getById('photos', photoId)!.driveFileId).toBe('drive-file-1');
      expect(eventsFor('photo-upload', 'finalize-already-done')).toHaveLength(1);
    });

    it('a queued retry reuses the file a crashed attempt already created', async () => {
      storeInternals.registerPhotoCollection('activities');
      await ensureEntity('activities', 'act-1');
      usePhotoStore();
      const photoId = 'photo-crashed';
      const filename = `beanies-photo-${photoId}.jpg`;
      driveMocks.listFilesInFolder.mockResolvedValue([{ id: 'drive-prior', name: filename }]);
      await enqueueUpload(queued(photoId));

      await flushQueue();

      expect(driveMocks.createFile).not.toHaveBeenCalled();
      expect(driveMocks.listFilesInFolder).toHaveBeenCalledWith(
        'mock-token',
        'folder-nested',
        filename
      );
      expect(projection.getById('photos', photoId)!.driveFileId).toBe('drive-prior');
      expect(projection.getById('activities', 'act-1')!.photoIds).toContain(photoId);
    });

    it('rollback keeps the Drive file when the rejected write actually landed', async () => {
      storeInternals.registerPhotoCollection('activities');
      await ensureEntity('activities', 'act-1');
      const store = usePhotoStore();
      driveMocks.createFile.mockResolvedValue({ fileId: 'drive-late', name: 'x' });
      // A late reply (C12): the worker committed the batch, the RPC still rejected.
      const real = vi.mocked(mutate).getMockImplementation()!;
      vi.mocked(mutate).mockImplementationOnce(async (op, opts) => {
        await real(op, opts);
        throw new Error('reply lost');
      });

      await expect(store.addPhoto(makeFile(), 'activities', 'act-1')).rejects.toThrow(/reply lost/);

      expect(driveMocks.deleteFile).not.toHaveBeenCalled();
      expect(eventsFor('photo-upload', 'rollback-skipped-record-present')).toHaveLength(1);
    });

    it('round 3: rollback re-reads the WORKER doc (a skip-on-missing empty patch), not the projection', async () => {
      storeInternals.registerPhotoCollection('activities');
      await ensureEntity('activities', 'act-1');
      const store = usePhotoStore();
      driveMocks.createFile.mockResolvedValue({ fileId: 'drive-late', name: 'x' });
      const real = vi.mocked(mutate).getMockImplementation()!;
      vi.mocked(mutate).mockImplementationOnce(async (op, opts) => {
        await real(op, opts);
        throw new Error('reply lost');
      });

      await expect(store.addPhoto(makeFile(), 'activities', 'act-1')).rejects.toThrow(/reply lost/);

      expect(vi.mocked(mutate)).toHaveBeenCalledWith(
        expect.objectContaining({
          op: 'patch',
          collection: 'photos',
          patch: {},
          onMissing: 'skip',
        }),
        { quiet: true }
      );
      expect(driveMocks.deleteFile).not.toHaveBeenCalled();
    });

    it('round 3: rollback keeps the file (logged) when the worker doc cannot be read', async () => {
      storeInternals.registerPhotoCollection('activities');
      await ensureEntity('activities', 'act-1');
      const store = usePhotoStore();
      vi.mocked(mutate)
        .mockRejectedValueOnce(new Error('forced write failure'))
        .mockRejectedValueOnce(new Error('worker gone'));

      await expect(store.addPhoto(makeFile(), 'activities', 'act-1')).rejects.toThrow(/forced/);

      expect(driveMocks.deleteFile).not.toHaveBeenCalled();
      expect(eventsFor('photo-upload', 'rollback-skipped-unverified')).toHaveLength(1);
    });

    it('round 3: a failed reuse lookup keeps the entry queued and creates no second file', async () => {
      storeInternals.registerPhotoCollection('activities');
      await ensureEntity('activities', 'act-1');
      const store = usePhotoStore();
      driveMocks.listFilesInFolder.mockRejectedValue(new Error('Drive 503'));
      await enqueueUpload(queued('photo-lookup'));

      await flushQueue();

      expect(driveMocks.createFile).not.toHaveBeenCalled();
      await store.refreshPending();
      expect(store.pendingUploadsFor('activities', 'act-1')).toHaveLength(1);
      expect(eventsFor('photo-upload', 'finalize-reuse-lookup-failed')).toHaveLength(1);
    });

    it('round 3: a queue drained for a family that is not open is refused; nothing uploads', async () => {
      storeInternals.registerPhotoCollection('activities');
      await ensureEntity('activities', 'act-1');
      const store = usePhotoStore();
      // The queue is bound to another family than the one open (familyContextStore says
      // 'fam-photostore-test').
      await store.activate('fam-photostore-other');
      await enqueueUpload(queued('photo-wrong-family'));

      await flushQueue();

      expect(driveMocks.createFile).not.toHaveBeenCalled();
      expect(projection.getById('photos', 'photo-wrong-family')).toBeUndefined();
      expect(eventsFor('photo-upload', 'finalize-family-mismatch')).toHaveLength(1);
      await store.refreshPending();
      expect(store.pendingUploadsFor('activities', 'act-1')).toHaveLength(1);
      await queueInternals.reset();
      await deletePhotoQueueDatabase('fam-photostore-other');
    });

    it('round 3: a failed background activation is logged, never an unhandled rejection', async () => {
      const store = usePhotoStore();
      store.deactivate();
      const open = vi.spyOn(globalThis.indexedDB, 'open').mockImplementationOnce(() => {
        throw new Error('quota');
      });

      store.activateInBackground('fam-photostore-broken');
      await vi.waitFor(() =>
        expect(eventsFor('photo-upload-flush', 'activate-failed')).toHaveLength(1)
      );
      open.mockRestore();
    });

    it('replacePhotoFile deletes the NEW file and keeps the record when its write fails', async () => {
      storeInternals.registerPhotoCollection('activities');
      await ensureEntity('activities', 'act-1');
      const store = usePhotoStore();
      driveMocks.createFile
        .mockResolvedValueOnce({ fileId: 'drive-original', name: 'x' })
        .mockResolvedValueOnce({ fileId: 'drive-replacement', name: 'x' });
      const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-1');
      vi.mocked(mutate).mockRejectedValueOnce(new Error('forced write failure'));

      await expect(store.replacePhotoFile(photoId, makeFile('new.jpg'))).rejects.toThrow();

      expect(driveMocks.deleteFile).toHaveBeenCalledWith('mock-token', 'drive-replacement');
      expect(driveMocks.deleteFile).not.toHaveBeenCalledWith('mock-token', 'drive-original');
      const record = projection.getById('photos', photoId)!;
      expect(record.driveFileId).toBe('drive-original');
      expect(record.retiredDriveFileIds).toBeUndefined();
    });

    it('a failed queue write pages as critical on photo-upload', async () => {
      setOnlineStatus(false);
      storeInternals.registerPhotoCollection('activities');
      await ensureEntity('activities', 'act-1');
      const store = usePhotoStore();
      store.deactivate(); // no bound queue → enqueue throws

      await expect(store.addPhoto(makeFile(), 'activities', 'act-1')).rejects.toThrow(
        /queue photo upload/
      );
      expect(telemetryMocks.reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          surface: 'photo-upload',
          severity: 'critical',
          context: { action: 'queue-write-failed' },
        })
      );
    });
  });
});
