/**
 * C6: the database-layer half of "never delete unsaved work silently".
 *   - a keep-data sign-out keeps the offline photo queue (`keepPhotoQueue`);
 *   - the per-family `unpushed-at-signout` marker survives until the cache is really gone;
 *   - queued photos are COUNTED without creating a queue that did not exist;
 *   - the name sweep finds families the registry forgot.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { repoFile } from '@/test/repoFile';

const h = vi.hoisted(() => ({
  clearCache: vi.fn(async (_id: string) => ({ deleted: true })),
  deletePhotoQueueDatabase: vi.fn(async (_id: string) => {}),
}));
vi.mock('@/services/automerge/worker/docClient', () => ({
  clearCache: h.clearCache,
  reset: vi.fn(async () => {}),
}));
vi.mock('@/services/sync/photoUploadQueue', () => ({
  deletePhotoQueueDatabase: h.deletePhotoQueueDatabase,
}));
vi.mock('@/services/telemetry', () => ({ logEvent: vi.fn() }));

import {
  clearUnpushedAtSignOutMarker,
  countQueuedPhotoUploads,
  deleteFamilyDatabase,
  hasUnpushedAtSignOutMarker,
  listLocalFamilyDatabaseIds,
  setUnpushedAtSignOutMarker,
} from '@/services/indexeddb/database';

function openQueue(familyId: string, rows: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(`beanies-photo-queue-${familyId}`, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('uploads', { keyPath: 'id' });
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('uploads', 'readwrite');
      for (let i = 0; i < rows; i++) tx.objectStore('uploads').put({ id: `u${i}` });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.clearCache.mockResolvedValue({ deleted: true });
  localStorage.clear();
});

describe('deleteFamilyDatabase', () => {
  it('keeps the offline photo queue when asked (keep-data sign-out)', async () => {
    await deleteFamilyDatabase('fam-1', { keepPhotoQueue: true });
    expect(h.deletePhotoQueueDatabase).not.toHaveBeenCalled();
  });

  it('drops the photo queue by default (a confirmed clear)', async () => {
    await deleteFamilyDatabase('fam-1');
    expect(h.deletePhotoQueueDatabase).toHaveBeenCalledWith('fam-1');
  });

  it('clears the unpushed marker only when the cache is really gone', async () => {
    setUnpushedAtSignOutMarker('fam-1');
    h.clearCache.mockResolvedValueOnce({ deleted: false });
    await deleteFamilyDatabase('fam-1');
    expect(hasUnpushedAtSignOutMarker('fam-1')).toBe(true);
    await deleteFamilyDatabase('fam-1');
    expect(hasUnpushedAtSignOutMarker('fam-1')).toBe(false);
  });
});

describe('unpushed-at-signout marker', () => {
  it('is per family', () => {
    setUnpushedAtSignOutMarker('fam-a');
    expect(hasUnpushedAtSignOutMarker('fam-a')).toBe(true);
    expect(hasUnpushedAtSignOutMarker('fam-b')).toBe(false);
    clearUnpushedAtSignOutMarker('fam-a');
    expect(hasUnpushedAtSignOutMarker('fam-a')).toBe(false);
  });
});

describe('countQueuedPhotoUploads', () => {
  it('counts what is queued for that family', async () => {
    await openQueue('fam-photos', 3);
    expect(await countQueuedPhotoUploads('fam-photos')).toBe(3);
  });

  it('is 0 for a family with no queue, and does not create one', async () => {
    expect(await countQueuedPhotoUploads('fam-none')).toBe(0);
    const names = (await indexedDB.databases()).map((d) => d.name);
    expect(names).not.toContain('beanies-photo-queue-fam-none');
  });

  it('reads the database the queue module writes (prefix + store name drift tripwire)', () => {
    const src = repoFile('src/services/sync/photoUploadQueue.ts');
    expect(src).toContain("const DB_PREFIX = 'beanies-photo-queue-';");
    expect(src).toContain("const STORE_NAME = 'uploads';");
  });
});

describe('listLocalFamilyDatabaseIds', () => {
  it('finds every family with a cache or a photo queue, by database name', async () => {
    await new Promise<void>((resolve) => {
      const req = indexedDB.open('beanies-automerge-fam-orphan', 1);
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
    });
    await openQueue('fam-q', 1);
    const ids = await listLocalFamilyDatabaseIds();
    expect(ids).toEqual(expect.arrayContaining(['fam-orphan', 'fam-q']));
  });
});
