// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const logEvent = vi.hoisted(() => vi.fn());
vi.mock('@/services/telemetry', () => ({ logEvent }));
import {
  setActiveFamily,
  clearActiveFamily,
  setFlushHandler,
  enqueueUpload,
  getPending,
  removeFromQueue,
  flushQueue,
  deletePhotoQueueDatabase,
  QUEUE_SOFT_CAP,
  __internals,
  type QueuedPhotoUpload,
} from '../photoUploadQueue';

function makeEntry(overrides: Partial<Omit<QueuedPhotoUpload, 'id' | 'createdAt'>> = {}) {
  return {
    photoId: overrides.photoId ?? crypto.randomUUID(),
    entityCollection: overrides.entityCollection ?? 'activities',
    entityId: overrides.entityId ?? 'activity-1',
    blob: overrides.blob ?? new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
    filename: overrides.filename ?? 'beanies-photo-x.jpg',
    mime: overrides.mime ?? 'image/jpeg',
    width: overrides.width ?? 800,
    height: overrides.height ?? 600,
    sizeBytes: overrides.sizeBytes ?? 3,
    createdBy: overrides.createdBy,
    ...(overrides.familyId ? { familyId: overrides.familyId } : {}),
  };
}

const actions = () =>
  logEvent.mock.calls.map((c) => (c[0] as { context?: { action?: string } }).context?.action);

/** Write an entry straight into a family's queue database, bypassing `enqueueUpload`'s guard. */
async function putRaw(familyId: string, entry: QueuedPhotoUpload): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('beanies-photo-queue-' + familyId, 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('uploads', 'readwrite');
    tx.objectStore('uploads').put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

describe('photoUploadQueue', () => {
  const FAMILY_ID = 'fam-queue-test';

  beforeEach(() => {
    // Stub window/navigator for node env.
    (globalThis as unknown as { window: object }).window ??= {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    (globalThis as unknown as { navigator: { onLine: boolean } }).navigator ??= { onLine: true };
    setActiveFamily(FAMILY_ID);
  });

  afterEach(async () => {
    await __internals.reset();
    await deletePhotoQueueDatabase(FAMILY_ID);
  });

  it('enqueue + getPending round-trip', async () => {
    const id = await enqueueUpload(makeEntry());
    const pending = await getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).toBe(id);
    expect(pending[0]!.entityId).toBe('activity-1');
  });

  it('getPending can filter by entity', async () => {
    await enqueueUpload(makeEntry({ entityCollection: 'activities', entityId: 'a1' }));
    await enqueueUpload(makeEntry({ entityCollection: 'activities', entityId: 'a2' }));
    await enqueueUpload(makeEntry({ entityCollection: 'familyMembers', entityId: 'm1' }));
    const onlyA1 = await getPending('activities', 'a1');
    expect(onlyA1).toHaveLength(1);
    expect(onlyA1[0]!.entityId).toBe('a1');
  });

  it('flushQueue invokes handler for each entry and removes on success', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    setFlushHandler(handler);

    await enqueueUpload(makeEntry({ photoId: 'p1' }));
    await enqueueUpload(makeEntry({ photoId: 'p2' }));

    await flushQueue();

    expect(handler).toHaveBeenCalledTimes(2);
    expect(await getPending()).toHaveLength(0);
  });

  it('flushQueue is single-flight: overlapping triggers hand each entry to the handler once', async () => {
    // Two drains in the same tick used to each read the same pending set and upload the same
    // photo twice (C11). The second call must join the first's promise, not start another.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const handler = vi.fn(async () => {
      await gate;
    });
    setFlushHandler(handler);
    await enqueueUpload(makeEntry({ photoId: 'p1' }));
    await enqueueUpload(makeEntry({ photoId: 'p2' }));

    const first = flushQueue();
    const second = flushQueue();
    expect(second).toBe(first);
    release();
    await Promise.all([first, second]);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(await getPending()).toHaveLength(0);
    // A later call starts a fresh drain (nothing left, so the handler is not called again).
    await flushQueue();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('flushQueue keeps failed entries for retry', async () => {
    // Handler fails only for the 'p-fail' entry. IDB iteration order is
    // key-sorted (UUIDs), not insertion order, so key the behavior on
    // the entry's photoId for a deterministic outcome.
    const handler = vi.fn(async (entry: QueuedPhotoUpload) => {
      if (entry.photoId === 'p-fail') throw new Error('network');
    });
    setFlushHandler(handler);

    await enqueueUpload(makeEntry({ photoId: 'p-fail' }));
    await enqueueUpload(makeEntry({ photoId: 'p-ok' }));

    await flushQueue();

    const remaining = await getPending();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.photoId).toBe('p-fail');
  });

  it('removeFromQueue removes a specific entry', async () => {
    const id1 = await enqueueUpload(makeEntry());
    await enqueueUpload(makeEntry());
    await removeFromQueue(id1);
    const pending = await getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).not.toBe(id1);
  });

  it('flushQueue is a no-op when no handler is registered', async () => {
    await enqueueUpload(makeEntry());
    await flushQueue();
    const pending = await getPending();
    expect(pending).toHaveLength(1); // still there
  });

  it('exposes a soft cap constant photoStore can check', () => {
    expect(QUEUE_SOFT_CAP).toBeGreaterThan(0);
  });

  it('clearActiveFamily does not delete data', async () => {
    await enqueueUpload(makeEntry());
    clearActiveFamily();
    // Re-attach the same family — pending entry should still be there.
    setActiveFamily(FAMILY_ID);
    expect(await getPending()).toHaveLength(1);
  });

  // Round 3: a drain belongs to ONE family, from start to finish.
  describe('family safety', () => {
    const OTHER = 'fam-queue-other';
    afterEach(async () => {
      await deletePhotoQueueDatabase(OTHER);
    });

    it('hands each entry the family the drain started for', async () => {
      await enqueueUpload(makeEntry());
      const handler = vi.fn(async () => {});
      setFlushHandler(handler);
      await flushQueue();
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({}), FAMILY_ID);
    });

    it('stops before the next entry when the active family changed mid-drain', async () => {
      await enqueueUpload(makeEntry({ entityId: 'a1' }));
      await enqueueUpload(makeEntry({ entityId: 'a2' }));
      const handler = vi.fn(async () => {
        // The person switches family while the first upload is running.
        setActiveFamily(OTHER);
      });
      setFlushHandler(handler);
      await flushQueue();
      expect(handler).toHaveBeenCalledTimes(1);
      // The finished entry was removed from the CAPTURED family's queue; the other stays there.
      setActiveFamily(FAMILY_ID);
      expect(await getPending()).toHaveLength(1);
      // Nothing leaked into the other family's queue.
      setActiveFamily(OTHER);
      expect(await getPending()).toHaveLength(0);
    });

    it('single-flight is per family: a flush for a new family is not joined to the old drain', async () => {
      await enqueueUpload(makeEntry());
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const seen: string[] = [];
      let started!: () => void;
      const handlerStarted = new Promise<void>((r) => (started = r));
      setFlushHandler(async (_e, familyId) => {
        seen.push(familyId);
        if (familyId === FAMILY_ID) {
          started();
          await gate;
        }
      });
      const first = flushQueue();
      await handlerStarted; // the old family's drain is mid-entry
      setActiveFamily(OTHER);
      await enqueueUpload(makeEntry());
      const second = flushQueue();
      expect(second).not.toBe(first);
      await second;
      release();
      await first;
      expect(seen.sort()).toEqual([FAMILY_ID, OTHER].sort());
    });

    it('enqueue refuses an entry stamped with a family the queue is not bound to', async () => {
      await expect(enqueueUpload(makeEntry({ familyId: OTHER }))).rejects.toThrow(/not bound/);
      expect(await getPending()).toHaveLength(0);
    });

    it('a drain skips (keeps, logs) an entry stamped with another family', async () => {
      await getPending(); // the bound handle has opened, so the raw write below is not racing it
      await putRaw(FAMILY_ID, {
        ...makeEntry({ photoId: 'foreign', familyId: OTHER }),
        id: 'foreign-entry',
        createdAt: 1,
      });
      await enqueueUpload(makeEntry({ photoId: 'mine', familyId: FAMILY_ID }));
      const handler = vi.fn(async () => {});
      setFlushHandler(handler);
      await flushQueue();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ photoId: 'mine' }), FAMILY_ID);
      const left = await getPending();
      expect(left.map((e) => e.photoId)).toEqual(['foreign']);
      expect(actions()).toContain('drain-skipped-foreign-entry');
    });
  });

  it('a failed open is logged, never rejects a flush, and is retried on the next activation', async () => {
    await __internals.reset();
    logEvent.mockClear();
    const open = vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => {
      throw new Error('quota');
    });
    setFlushHandler(vi.fn(async () => {}));
    setActiveFamily(FAMILY_ID); // fires a background flush against the failed handle
    await expect(flushQueue()).resolves.toBeUndefined();
    await vi.waitFor(() => expect(actions()).toContain('open-failed'));
    expect(actions()).toContain('drain-failed');
    open.mockRestore();

    // The dead handle was forgotten: the same family re-binds with a fresh open.
    setActiveFamily(FAMILY_ID);
    await enqueueUpload(makeEntry());
    expect(await getPending()).toHaveLength(1);
  });

  it('after a failed open, the next flush for the same family reopens without a new setActiveFamily', async () => {
    await __internals.reset();
    logEvent.mockClear();
    const handler = vi.fn(async () => {});
    setFlushHandler(handler);
    const open = vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => {
      throw new Error('quota');
    });
    setActiveFamily(FAMILY_ID);
    await vi.waitFor(() => expect(actions()).toContain('open-failed'));
    open.mockRestore();
    await putRaw(FAMILY_ID, { ...makeEntry({ familyId: FAMILY_ID }), id: 'q1', createdAt: 1 });

    // No re-activation: the flush itself rebinds the handle and drains.
    await flushQueue();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('after a failed open, the next enqueue names the failure and the one after reopens', async () => {
    await __internals.reset();
    logEvent.mockClear();
    const open = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new Error('quota');
    });
    setActiveFamily(FAMILY_ID);
    await vi.waitFor(() => expect(actions()).toContain('open-failed'));
    // Still failing: the enqueue retried the open and says so (not "no family bound").
    await expect(enqueueUpload(makeEntry())).rejects.toThrow(/could not be opened/);
    open.mockRestore();
    await enqueueUpload(makeEntry());
    expect(await getPending()).toHaveLength(1);
  });

  it('enqueue names an unbound queue apart from a failed open', async () => {
    await __internals.reset();
    clearActiveFamily();
    await expect(enqueueUpload(makeEntry())).rejects.toThrow(/no family bound/);
  });

  it('deleting the bound family queue unbinds it, so a later flush cannot recreate it', async () => {
    setFlushHandler(vi.fn(async () => {}));
    await deletePhotoQueueDatabase(FAMILY_ID);
    const open = vi.spyOn(indexedDB, 'open');
    await flushQueue();
    await expect(enqueueUpload(makeEntry())).rejects.toThrow(/no family bound/);
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });
});
