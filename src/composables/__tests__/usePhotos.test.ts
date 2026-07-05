// @vitest-environment node
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- ADR-032 Task #17: pending test rewrite to the inline/docClient path (red in the migration window)
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { initDoc, resetDoc, changeDoc } from '@/services/automerge/docService';

// Minimal window / navigator stubs (same as photoStore.test.ts).
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
    setPublicLinkPermission: vi.fn(async () => undefined),
    DriveFileNotFoundError,
  };
});

vi.mock('@/services/google/driveService', () => ({
  createFile: driveMocks.createFile,
  deleteFile: driveMocks.deleteFile,
  downloadFileBlob: driveMocks.downloadFileBlob,
  findOrCreateFolder: driveMocks.findOrCreateFolder,
  getFileMetadata: driveMocks.getFileMetadata,
  setPublicLinkPermission: driveMocks.setPublicLinkPermission,
  DriveFileNotFoundError: driveMocks.DriveFileNotFoundError,
}));

vi.mock('@/services/photos/photoCompression', () => ({
  compress: vi.fn(async () => ({
    blob: new Blob([new Uint8Array([1])], { type: 'image/jpeg' }),
    width: 800,
    height: 600,
    mime: 'image/jpeg',
  })),
  CompressionError: class extends Error {},
}));

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ driveFileId: 'beanpod-file-1' }),
}));

vi.mock('@/stores/familyContextStore', () => ({
  useFamilyContextStore: () => ({ activeFamilyId: 'fam-usephotos-test' }),
}));

// useToast / useTranslation return trivial stubs so we can count calls.
const toastCalls: Array<{ type: string; title: string }> = [];
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    showToast: (type: string, title: string) => toastCalls.push({ type, title }),
  }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { usePhotos, MAX_PHOTOS_PER_SET, PDF_MAX_BYTES } from '../usePhotos';
import { usePhotoStore } from '@/stores/photoStore';
import {
  __internals as queueInternals,
  deletePhotoQueueDatabase,
} from '@/services/sync/photoUploadQueue';

function setOnlineStatus(online: boolean): void {
  Object.defineProperty(globalThis.navigator, 'onLine', {
    configurable: true,
    get: () => online,
  });
}

function makeFile(name = 'photo.jpg', type = 'image/jpeg'): File {
  return new File([new Uint8Array([0xff])], name, { type });
}

describe('usePhotos', () => {
  const FAMILY_ID = 'fam-usephotos-test';

  beforeEach(async () => {
    toastCalls.length = 0;
    setActivePinia(createPinia());
    resetDoc();
    initDoc();
    setOnlineStatus(true);

    driveMocks.createFile.mockReset().mockResolvedValue({ fileId: 'drive-1', name: 'x' });
    driveMocks.deleteFile.mockReset().mockResolvedValue(undefined);
    driveMocks.downloadFileBlob.mockReset().mockResolvedValue(new Blob());
    driveMocks.findOrCreateFolder.mockReset().mockResolvedValue('folder-nested');
    driveMocks.getFileMetadata.mockReset().mockResolvedValue({ parents: ['folder-1'] });

    // Seed an activity that will own the photos.
    changeDoc((d) => {
      (d as unknown as { activities: Record<string, unknown> }).activities['act-1'] = {
        id: 'act-1',
        photoIds: [],
      };
    });

    const store = usePhotoStore();
    await store.activate(FAMILY_ID);
  });

  afterEach(async () => {
    await queueInternals.reset();
    await deletePhotoQueueDatabase(FAMILY_ID);
  });

  it('add appends online uploads to the entity and returns their IDs', async () => {
    const photoIds = ref<string[]>([]);
    const { add, photos } = usePhotos({
      collection: 'activities',
      entityId: ref('act-1'),
      photoIds,
      updatePhotoIds: (ids) => {
        photoIds.value = ids;
      },
    });

    const ids = await add([makeFile('a.jpg'), makeFile('b.jpg')]);

    expect(ids).toHaveLength(2);
    // Both the Automerge doc AND the caller's photoIds ref should now
    // contain the new ids. Previously the composable only mutated
    // Automerge on add and left callers to re-read from the doc, but
    // form modals hold a local photoIds ref (so Save knows what to
    // persist) and that ref needs to sync — otherwise a just-uploaded
    // photo doesn't render until the drawer is closed + reopened.
    const actual = usePhotoStore().photos;
    expect(Object.keys(actual)).toHaveLength(2);
    expect(photoIds.value).toEqual(ids);
    expect(photos.value).toHaveLength(2);
  });

  it('enforces the 4-photo cap', async () => {
    const photoIds = ref<string[]>(['p1', 'p2', 'p3', 'p4']);
    const { add, atCap, canAdd } = usePhotos({
      collection: 'activities',
      entityId: ref('act-1'),
      photoIds,
      updatePhotoIds: (ids) => {
        photoIds.value = ids;
      },
    });
    expect(atCap.value).toBe(true);
    expect(canAdd.value).toBe(false);
    const ids = await add([makeFile()]);
    expect(ids).toHaveLength(0);
    // Max-reached toast uses the pluralized copy for N > 1. Titles go
    // through the test's `t()` stub as-is (key + interpolation), so we
    // match by prefix to stay tolerant of the {n} substitution.
    expect(toastCalls.some((c) => c.title.startsWith('photos.maxReached'))).toBe(true);
  });

  it('stops adding once remaining slots are filled', async () => {
    const photoIds = ref<string[]>(['p1', 'p2', 'p3']);
    const { add } = usePhotos({
      collection: 'activities',
      entityId: ref('act-1'),
      photoIds,
      updatePhotoIds: (ids) => {
        photoIds.value = ids;
      },
    });
    const ids = await add([makeFile(), makeFile(), makeFile()]);
    expect(ids).toHaveLength(1); // only 1 slot left of 4
  });

  it('rejects non-image files with a toast and does not upload them', async () => {
    const photoIds = ref<string[]>([]);
    const { add } = usePhotos({
      collection: 'activities',
      entityId: ref('act-1'),
      photoIds,
      updatePhotoIds: (ids) => {
        photoIds.value = ids;
      },
    });
    const ids = await add([makeFile('notes.txt', 'text/plain')]);
    expect(ids).toHaveLength(0);
    expect(driveMocks.createFile).not.toHaveBeenCalled();
    expect(toastCalls.some((c) => c.title === 'photos.invalidType')).toBe(true);
  });

  it('accepts HEIC by extension even without MIME type', async () => {
    const photoIds = ref<string[]>([]);
    const { add } = usePhotos({
      collection: 'activities',
      entityId: ref('act-1'),
      photoIds,
      updatePhotoIds: (ids) => {
        photoIds.value = ids;
      },
    });
    const ids = await add([makeFile('vacation.HEIC', '')]);
    expect(ids).toHaveLength(1);
  });

  it('remove calls markDeleted AND updates the caller photoIds', () => {
    const photoIds = ref<string[]>(['p-keep', 'p-delete']);
    const updates: string[][] = [];
    const { remove } = usePhotos({
      collection: 'activities',
      entityId: ref('act-1'),
      photoIds,
      updatePhotoIds: (ids) => {
        updates.push([...ids]);
        photoIds.value = ids;
      },
    });

    // Seed a record so markDeleted has something to tombstone.
    changeDoc((d) => {
      d.photos['p-delete'] = {
        id: 'p-delete',
        driveFileId: 'x',
        mime: 'image/jpeg',
        width: 1,
        height: 1,
        sizeBytes: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    });

    remove('p-delete');
    expect(updates[0]).toEqual(['p-keep']);
  });

  it('MAX_PHOTOS_PER_SET is 4', () => {
    expect(MAX_PHOTOS_PER_SET).toBe(4);
  });

  describe('PDF attachments (accept: imagesAndPdf)', () => {
    function pdfFile(name = 'doc.pdf', size = 100): File {
      const bytes = new Uint8Array(size);
      bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
      return new File([bytes], name, { type: 'application/pdf' });
    }
    function setup(accept?: 'images' | 'imagesAndPdf') {
      const photoIds = ref<string[]>([]);
      const api = usePhotos({
        collection: 'activities',
        entityId: ref('act-1'),
        photoIds,
        updatePhotoIds: (ids) => {
          photoIds.value = ids;
        },
        accept,
      });
      return { api, photoIds };
    }

    it('accepts a valid PDF when opted in', async () => {
      const ids = await setup('imagesAndPdf').api.add([pdfFile()]);
      expect(ids).toHaveLength(1);
      expect(driveMocks.createFile).toHaveBeenCalledTimes(1);
    });

    it('rejects PDFs by default (images only) with the invalid-type toast', async () => {
      const ids = await setup().api.add([pdfFile()]);
      expect(ids).toHaveLength(0);
      expect(driveMocks.createFile).not.toHaveBeenCalled();
      expect(toastCalls.some((c) => c.title === 'photos.invalidType')).toBe(true);
    });

    it('rejects an oversized PDF with the size toast (not invalid-type)', async () => {
      const ids = await setup('imagesAndPdf').api.add([pdfFile('big.pdf', PDF_MAX_BYTES + 1)]);
      expect(ids).toHaveLength(0);
      expect(toastCalls.some((c) => c.title === 'photos.pdfTooLarge')).toBe(true);
    });

    it('rejects a non-PDF masquerading as .pdf (magic-byte check)', async () => {
      const fake = new File([new Uint8Array([0x00, 0x01, 0x02])], 'fake.pdf', {
        type: 'application/pdf',
      });
      const ids = await setup('imagesAndPdf').api.add([fake]);
      expect(ids).toHaveLength(0);
      expect(toastCalls.some((c) => c.title === 'photos.invalidType')).toBe(true);
    });
  });

  describe('queue-fallback awareness (transient online failures)', () => {
    it('shows info toast and does NOT call updatePhotoIds when the upload is queued (transient 503)', async () => {
      const photoIds = ref<string[]>([]);
      const updates: string[][] = [];
      const { add } = usePhotos({
        collection: 'activities',
        entityId: ref('act-1'),
        photoIds,
        updatePhotoIds: (ids) => {
          updates.push([...ids]);
          photoIds.value = ids;
        },
      });

      driveMocks.createFile
        .mockReset()
        .mockRejectedValueOnce(new Error('Drive upload failed: 503 Service Unavailable'));

      const ids = await add([makeFile('flaky.jpg')]);

      expect(ids).toHaveLength(1);
      // updatePhotoIds is the path that emits to the form's local photoIds ref.
      // Queued uploads must NOT trigger this — the pending tile renders via
      // `pending` instead, and the doc record is written when the queue flushes.
      expect(updates).toHaveLength(0);
      // User-facing surface: info toast (queued), not error.
      expect(toastCalls.some((c) => c.type === 'info' && c.title === 'photos.queuedOffline')).toBe(
        true
      );
      expect(toastCalls.every((c) => c.title !== 'photos.uploadFailed')).toBe(true);
      expect(toastCalls.every((c) => c.title !== 'photos.queueFailed')).toBe(true);
    });

    it('shows error toast with photos.queueFailed when the queue write itself fails', async () => {
      const photoIds = ref<string[]>([]);
      const { add } = usePhotos({
        collection: 'activities',
        entityId: ref('act-1'),
        photoIds,
        updatePhotoIds: (ids) => {
          photoIds.value = ids;
        },
      });

      // Transient Drive failure → fallback to queue → queue ALSO fails.
      driveMocks.createFile
        .mockReset()
        .mockRejectedValueOnce(new Error('Drive upload failed: 503'));
      // Force the photo queue to throw on enqueue by stomping its enqueueUpload
      // mid-test. queueInternals.reset() in afterEach cleans up.
      const queueModule = await import('@/services/sync/photoUploadQueue');
      const enqueueSpy = vi
        .spyOn(queueModule, 'enqueueUpload')
        .mockRejectedValueOnce(new Error('IndexedDB quota exceeded'));

      const ids = await add([makeFile('quota.jpg')]);

      enqueueSpy.mockRestore();
      expect(ids).toHaveLength(0); // upload genuinely failed end-to-end
      expect(toastCalls.some((c) => c.type === 'error' && c.title === 'photos.queueFailed')).toBe(
        true
      );
    });

    it('shows error toast with photos.uploadFailed on a non-transient failure (Drive 400)', async () => {
      const photoIds = ref<string[]>([]);
      const { add } = usePhotos({
        collection: 'activities',
        entityId: ref('act-1'),
        photoIds,
        updatePhotoIds: (ids) => {
          photoIds.value = ids;
        },
      });

      driveMocks.createFile
        .mockReset()
        .mockRejectedValueOnce(new Error('Drive upload failed: 400 Bad Request'));

      const ids = await add([makeFile('bad.jpg')]);

      expect(ids).toHaveLength(0);
      expect(toastCalls.some((c) => c.type === 'error' && c.title === 'photos.uploadFailed')).toBe(
        true
      );
      expect(toastCalls.every((c) => c.title !== 'photos.queueFailed')).toBe(true);
    });
  });
});
