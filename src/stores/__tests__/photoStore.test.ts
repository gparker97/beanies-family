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
import { initDoc, getDoc, resetDoc, changeDoc } from '@/services/automerge/docService';

// --- Mocks -----------------------------------------------------------
//
// Mock the Drive client, token provider, compressor, and sync store
// surface. photoStore's orchestration logic is what we care about —
// the underlying APIs are exercised in their own test files.

vi.mock('@/services/google/googleAuth', () => ({
  requestAccessToken: vi.fn().mockResolvedValue('mock-token'),
}));

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

function ensureEntity(collection: string, id: string): void {
  changeDoc((d) => {
    const target = (d as unknown as Record<string, Record<string, unknown>>)[collection];
    if (target && !target[id]) {
      target[id] = { id, photoIds: [] };
    }
  });
}

// --- Tests -----------------------------------------------------------

describe('photoStore', () => {
  const FAMILY_ID = 'fam-photostore-test';

  beforeEach(async () => {
    setActivePinia(createPinia());
    resetDoc();
    initDoc();
    setOnlineStatus(true);

    // Reset mocks
    driveMocks.createFile.mockReset().mockResolvedValue({ fileId: 'drive-file-1', name: 'x' });
    driveMocks.deleteFile.mockReset().mockResolvedValue(undefined);
    driveMocks.downloadFileBlob.mockReset().mockResolvedValue(new Blob());
    driveMocks.findOrCreateFolder.mockReset().mockResolvedValue('folder-nested');
    driveMocks.getFileMetadata.mockReset().mockResolvedValue({ parents: ['folder-1'] });

    // Clear the registered integration collections between tests.
    storeInternals.photoReferringCollections.clear();

    const store = usePhotoStore();
    await store.activate(FAMILY_ID);
  });

  afterEach(async () => {
    await queueInternals.reset();
    await deletePhotoQueueDatabase(FAMILY_ID);
  });

  it('addPhoto (online) compresses, uploads, and writes an Automerge record', async () => {
    storeInternals.registerPhotoCollection('activities');
    ensureEntity('activities', 'act-1');
    const store = usePhotoStore();

    const photoId = await store.addPhoto(makeFile(), 'activities', 'act-1', 'member-1');

    expect(photoId).toBeTruthy();
    expect(driveMocks.createFile).toHaveBeenCalledTimes(1);
    const [, folderId, filename, blob, mime] = driveMocks.createFile.mock.calls[0]!;
    // Uploads land in the resolved photos subfolder, not the bean-pod root.
    expect(folderId).toBe('folder-nested');
    expect(filename).toBe(`beanies-photo-${photoId}.jpg`);
    expect(blob).toBeInstanceOf(Blob);
    expect(mime).toBe('image/jpeg');

    const doc = getDoc();
    const record = doc.photos[photoId];
    expect(record).toBeDefined();
    expect(record!.driveFileId).toBe('drive-file-1');
    expect(record!.createdBy).toBe('member-1');
    expect(record!.createdAt).toBe(record!.updatedAt);
    expect(record!.deletedAt).toBeUndefined();

    // Entity got the photoId appended
    const activity = (
      doc as unknown as {
        activities: Record<string, { photoIds: string[] }>;
      }
    ).activities['act-1'];
    expect(activity.photoIds).toContain(photoId);
  });

  it('addPhoto rolls back the Drive file when Automerge write fails', async () => {
    storeInternals.registerPhotoCollection('activities');
    ensureEntity('activities', 'act-1');
    const store = usePhotoStore();
    driveMocks.createFile.mockResolvedValue({ fileId: 'drive-rollback', name: 'x' });

    // Force changeDoc to throw by resetting the doc mid-call. The simplest
    // reliable trigger: swap photos out for a non-writable (frozen) object.
    const doc = getDoc();
    Object.defineProperty(doc, 'photos', {
      get() {
        throw new Error('forced write failure');
      },
    });

    await expect(store.addPhoto(makeFile(), 'activities', 'act-1')).rejects.toThrow();
    expect(driveMocks.deleteFile).toHaveBeenCalledWith('mock-token', 'drive-rollback');
  });

  it('addPhoto offline enqueues the upload and does NOT write an Automerge record', async () => {
    setOnlineStatus(false);
    storeInternals.registerPhotoCollection('activities');
    ensureEntity('activities', 'act-1');
    const store = usePhotoStore();

    const photoId = await store.addPhoto(makeFile(), 'activities', 'act-1');

    expect(driveMocks.createFile).not.toHaveBeenCalled();
    expect(getDoc().photos[photoId]).toBeUndefined();
    const pendingForEntity = store.pendingUploadsFor('activities', 'act-1');
    expect(pendingForEntity).toHaveLength(1);
    expect(pendingForEntity[0]!.photoId).toBe(photoId);
  });

  it('getImageUrl returns a resized thumbnailLink and caches within TTL', async () => {
    storeInternals.registerPhotoCollection('activities');
    ensureEntity('activities', 'act-1');
    const store = usePhotoStore();
    driveMocks.getFileMetadata
      .mockResolvedValueOnce({ parents: ['folder-1'] }) // resolveCanonicalFolderId
      .mockResolvedValueOnce({
        thumbnailLink: 'https://lh3.googleusercontent.com/abc=s220',
      });

    const photoId = await store.addPhoto(makeFile(), 'activities', 'act-1');

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
    ensureEntity('activities', 'act-1');
    const store = usePhotoStore();
    driveMocks.getFileMetadata
      .mockResolvedValueOnce({ parents: ['folder-1'] })
      .mockRejectedValueOnce(new DriveFileNotFoundError('not found', 404));

    const photoId = await store.addPhoto(makeFile(), 'activities', 'act-1');
    const url = await store.getImageUrl(photoId, 'thumb');
    expect(url).toBeNull();
    expect(store.isUnresolved(photoId)).toBe(true);
  });

  it('hasBrokenPhotos flips true once any photo is flagged unresolved and back to false after clearUnresolved', async () => {
    storeInternals.registerPhotoCollection('activities');
    ensureEntity('activities', 'act-broken');
    const store = usePhotoStore();
    expect(store.hasBrokenPhotos).toBe(false);

    driveMocks.getFileMetadata
      .mockResolvedValueOnce({ parents: ['folder-1'] })
      .mockRejectedValueOnce(new DriveFileNotFoundError('not found', 404));
    const photoId = await store.addPhoto(makeFile(), 'activities', 'act-broken');
    await store.getImageUrl(photoId, 'thumb');

    expect(store.hasBrokenPhotos).toBe(true);
    expect(store.isUnresolved(photoId)).toBe(true);

    store.clearUnresolved();
    expect(store.hasBrokenPhotos).toBe(false);
    expect(store.isUnresolved(photoId)).toBe(false);
  });

  it('replacePhotoFile swaps driveFileId and preserves UUID + createdAt', async () => {
    storeInternals.registerPhotoCollection('activities');
    ensureEntity('activities', 'act-1');
    const store = usePhotoStore();
    driveMocks.createFile
      .mockResolvedValueOnce({ fileId: 'drive-original', name: 'x' })
      .mockResolvedValueOnce({ fileId: 'drive-replacement', name: 'x' });

    const photoId = await store.addPhoto(makeFile(), 'activities', 'act-1');
    const originalCreatedAt = getDoc().photos[photoId]!.createdAt;

    await new Promise((resolve) => setTimeout(resolve, 5));
    await store.replacePhotoFile(photoId, makeFile('new.jpg'));

    const record = getDoc().photos[photoId]!;
    expect(record.id).toBe(photoId);
    expect(record.driveFileId).toBe('drive-replacement');
    expect(record.createdAt).toBe(originalCreatedAt);
    expect(record.updatedAt).not.toBe(originalCreatedAt);
    expect(driveMocks.deleteFile).toHaveBeenCalledWith('mock-token', 'drive-original');
  });

  it('markDeleted sets deletedAt (tombstone) without touching Drive', async () => {
    storeInternals.registerPhotoCollection('activities');
    ensureEntity('activities', 'act-1');
    const store = usePhotoStore();

    const photoId = await store.addPhoto(makeFile(), 'activities', 'act-1');
    driveMocks.deleteFile.mockClear();
    store.markDeleted(photoId);

    expect(getDoc().photos[photoId]!.deletedAt).toBeDefined();
    expect(driveMocks.deleteFile).not.toHaveBeenCalled();
  });

  it('gcOrphans removes tombstones older than 24h and deletes the Drive file', async () => {
    storeInternals.registerPhotoCollection('activities');
    ensureEntity('activities', 'act-1');
    const store = usePhotoStore();

    const photoId = await store.addPhoto(makeFile(), 'activities', 'act-1');
    // Manually backdate the tombstone so it's past the grace period.
    const longAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    changeDoc((d) => {
      d.photos[photoId]!.deletedAt = longAgo;
    });
    driveMocks.deleteFile.mockClear();

    const result = await store.gcOrphans();
    expect(result.deleted).toBe(1);
    expect(getDoc().photos[photoId]).toBeUndefined();
    expect(driveMocks.deleteFile).toHaveBeenCalledWith('mock-token', 'drive-file-1');
  });

  it('gcOrphans keeps tombstones still within the 24h grace period', async () => {
    storeInternals.registerPhotoCollection('activities');
    ensureEntity('activities', 'act-1');
    const store = usePhotoStore();

    const photoId = await store.addPhoto(makeFile(), 'activities', 'act-1');
    store.markDeleted(photoId); // recent tombstone

    const result = await store.gcOrphans();
    expect(result.deleted).toBe(0);
    expect(getDoc().photos[photoId]).toBeDefined();
  });

  it('gcOrphans cascades photos with zero inbound entity references', async () => {
    storeInternals.registerPhotoCollection('activities');
    ensureEntity('activities', 'act-1');
    const store = usePhotoStore();
    const photoId = await store.addPhoto(makeFile(), 'activities', 'act-1');

    // Manually detach the photo from the entity → zero references.
    changeDoc((d) => {
      const activity = (
        d as unknown as {
          activities: Record<string, { photoIds: string[] }>;
        }
      ).activities['act-1'];
      activity.photoIds = [];
    });

    const result = await store.gcOrphans();
    expect(result.deleted).toBe(1);
    expect(getDoc().photos[photoId]).toBeUndefined();
  });

  it('gcOrphans does NOT cascade when no collections are registered (foundation mode)', async () => {
    // No registerPhotoCollection call — zero-ref check is disabled.
    ensureEntity('activities', 'act-1');
    const store = usePhotoStore();
    const photoId = await store.addPhoto(makeFile(), 'activities', 'act-1');

    const result = await store.gcOrphans();
    expect(result.deleted).toBe(0);
    expect(getDoc().photos[photoId]).toBeDefined();
  });
});
