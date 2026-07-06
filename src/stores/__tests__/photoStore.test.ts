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
  class DriveFileNotFoundError extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'DriveFileNotFoundError';
      this.status = status;
    }
  }
  return {
    createFile: vi.fn(),
    deleteFile: vi.fn(),
    downloadFileBlob: vi.fn(),
    findOrCreateFolder: vi.fn(),
    getFileMetadata: vi.fn(),
    setPublicLinkPermission: vi.fn(),
    DriveFileNotFoundError,
  };
});

const { DriveFileNotFoundError } = driveMocks;

vi.mock('@/services/google/driveService', () => ({
  createFile: driveMocks.createFile,
  deleteFile: driveMocks.deleteFile,
  downloadFileBlob: driveMocks.downloadFileBlob,
  findOrCreateFolder: driveMocks.findOrCreateFolder,
  getFileMetadata: driveMocks.getFileMetadata,
  setPublicLinkPermission: driveMocks.setPublicLinkPermission,
  DriveFileNotFoundError: driveMocks.DriveFileNotFoundError,
}));

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

vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({ activeFamilyId: 'fam-photostore-test' }),
}));

// --- Imports (after mocks are set up) --------------------------------

import { usePhotoStore, __internals as storeInternals } from '../photoStore';
import { __internals as queueInternals } from '@/services/sync/photoUploadQueue';
import { deletePhotoQueueDatabase } from '@/services/sync/photoUploadQueue';

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

// --- Tests -----------------------------------------------------------

describe('photoStore', () => {
  const FAMILY_ID = 'fam-photostore-test';

  beforeEach(async () => {
    setActivePinia(createPinia());
    await installInlineBackend();
    setOnlineStatus(true);

    // Reset mocks
    driveMocks.createFile.mockReset().mockResolvedValue({ fileId: 'drive-file-1', name: 'x' });
    driveMocks.deleteFile.mockReset().mockResolvedValue(undefined);
    driveMocks.downloadFileBlob.mockReset().mockResolvedValue(new Blob());
    driveMocks.findOrCreateFolder.mockReset().mockResolvedValue('folder-nested');
    driveMocks.getFileMetadata.mockReset().mockResolvedValue({ parents: ['folder-1'] });
    driveMocks.setPublicLinkPermission.mockReset().mockResolvedValue(undefined);

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
    expect(driveMocks.deleteFile).toHaveBeenCalledWith('mock-token', 'drive-original');
  });

  it('markDeleted sets deletedAt (tombstone) without touching Drive', async () => {
    storeInternals.registerPhotoCollection('activities');
    await ensureEntity('activities', 'act-1');
    const store = usePhotoStore();

    const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-1');
    driveMocks.deleteFile.mockClear();
    store.markDeleted(photoId);
    await settleMutations();

    expect(projection.getById('photos', photoId)!.deletedAt).toBeDefined();
    expect(driveMocks.deleteFile).not.toHaveBeenCalled();
  });

  it('gcOrphans removes tombstones older than 24h and deletes the Drive file', async () => {
    storeInternals.registerPhotoCollection('activities');
    await ensureEntity('activities', 'act-1');
    const store = usePhotoStore();

    const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-1');
    // Manually backdate the tombstone so it's past the grace period.
    const longAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    await mutate({
      op: 'patch',
      collection: 'photos',
      id: photoId,
      patch: { deletedAt: longAgo },
    });
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
    store.markDeleted(photoId); // recent tombstone
    await settleMutations();

    const result = await store.gcOrphans();
    expect(result.deleted).toBe(0);
    expect(projection.getById('photos', photoId)).toBeDefined();
  });

  it('gcOrphans cascades photos with zero inbound entity references', async () => {
    storeInternals.registerPhotoCollection('activities');
    await ensureEntity('activities', 'act-1');
    const store = usePhotoStore();
    const { photoId } = await store.addPhoto(makeFile(), 'activities', 'act-1');

    // Manually detach the photo from the entity → zero references.
    await mutate({ op: 'patch', collection: 'activities', id: 'act-1', patch: { photoIds: [] } });

    const result = await store.gcOrphans();
    expect(result.deleted).toBe(1);
    expect(projection.getById('photos', photoId)).toBeUndefined();
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
});
