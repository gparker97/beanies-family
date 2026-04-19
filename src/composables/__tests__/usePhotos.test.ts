// @vitest-environment node
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
    DriveFileNotFoundError,
  };
});

vi.mock('@/services/google/driveService', () => ({
  createFile: driveMocks.createFile,
  deleteFile: driveMocks.deleteFile,
  downloadFileBlob: driveMocks.downloadFileBlob,
  findOrCreateFolder: driveMocks.findOrCreateFolder,
  getFileMetadata: driveMocks.getFileMetadata,
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

import { usePhotos, MAX_PHOTOS_PER_SET } from '../usePhotos';
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
    expect(toastCalls.some((c) => c.title === 'photos.maxReached')).toBe(true);
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
});
