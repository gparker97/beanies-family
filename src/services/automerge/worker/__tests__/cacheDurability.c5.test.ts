// @vitest-environment node
/**
 * C5 (data-layer audit 2026-10-03): the local cache must never be deleted, replaced or
 * truncated without cause. One pin per defect the audit found, against the real worker ops and
 * a real (fake-indexeddb) cache.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { openDB } from 'idb';
import type { FamilyDocument } from '@/types/automerge';
import { generateFamilyKey, encryptPayload } from '@/services/crypto/familyKeyService';
import { bufferToBase64 } from '@/utils/encoding';
import { getHeads, getChangesSince, frameChanges, unframeChanges, loadDoc } from '../docOps';
import * as cache from '../cache';
import {
  configure,
  setKey,
  initDoc,
  initAndLoadCache,
  openCache,
  mutate,
  flush,
  reset,
  exportSnapshot,
  __resetApplyAndProjectForTesting,
  __hasDocForTesting,
} from '../applyAndProject';

const FAMILY = 'c5-family';
const DB_NAME = `beanies-automerge-${FAMILY}`;

type Doc = Automerge.Doc<FamilyDocument>;

let key: CryptoKey;
beforeEach(async () => {
  cache.__resetCacheForTesting();
  __resetApplyAndProjectForTesting();
  configure({ pushChunk() {}, perf() {}, cachePersistFailed() {}, cacheReleased() {} });
  key = await generateFamilyKey();
  await setKey(key);
});
afterEach(async () => {
  vi.restoreAllMocks();
  cache.__resetCacheForTesting();
  await cache.clearCache(FAMILY);
});

const setTodo = (id: string) =>
  mutate({ op: 'set', collection: 'todos', id, entity: { id, title: id } });

/** Every `inc:*` row key on disk, read through a separate connection. */
async function incKeys(): Promise<string[]> {
  const raw = await openDB(DB_NAME, 1);
  try {
    return ((await raw.getAllKeys('doc')) as string[]).filter((k) => k.startsWith('inc:'));
  } finally {
    raw.close();
  }
}

/** Write a row as ANOTHER TAB would: its own realm suffix, a change made on its own fork. */
async function writeForeignRow(seq: number, fork: Doc, since: string[]): Promise<string> {
  const id = `inc:${String(seq).padStart(12, '0')}:othertab`;
  const enc = await encryptPayload(key, frameChanges(getChangesSince(fork, since)));
  const raw = await openDB(DB_NAME, 1);
  await raw.put('doc', { id, payload: bufferToBase64(enc), updatedAt: new Date().toISOString() });
  raw.close();
  return id;
}

/** A fresh realm (a reload): drop all in-memory state, keep the database. */
async function reload(): Promise<void> {
  await reset();
  __resetApplyAndProjectForTesting();
  configure({ pushChunk() {}, perf() {}, cachePersistFailed() {}, cacheReleased() {} });
  await setKey(key);
}

const todoIds = (binary: Uint8Array) =>
  Object.keys((Automerge.toJS(loadDoc(binary)) as { todos: object }).todos).sort();

describe('C5b: the handle is installed only after every open read succeeds', () => {
  it('a failing increment scan leaves NO handle and closes the database', async () => {
    const spy = vi.spyOn(IDBObjectStore.prototype, 'getAllKeys').mockImplementationOnce(() => {
      throw Object.assign(new Error('scan failed'), { name: 'UnknownError' });
    });
    await expect(cache.initPersistenceDB(FAMILY)).rejects.toThrow(/scan failed/);
    expect(spy).toHaveBeenCalled();
    expect(cache.isCacheReady()).toBe(false);
    // And the connection it opened was closed, or this delete would be blocked.
    await expect(cache.clearCache(FAMILY)).resolves.toEqual({ deleted: true });
  });
});

describe('C5c: replay continues past a bad row and never rewrites the base over missing deps', () => {
  it('a row whose deps are missing is reported, KEPT, and survives every later persist', async () => {
    initDoc();
    await openCache(FAMILY);
    setTodo('a');
    await flush(); // base {a}
    const d0 = loadDoc(exportSnapshot().binary);
    // Another tab made TWO changes; only the second row reached this database.
    const d1 = Automerge.change(d0, (d) => {
      (d.todos as Record<string, unknown>).b = { id: 'b', title: 'b' };
    });
    const d2 = Automerge.change(d1, (d) => {
      (d.todos as Record<string, unknown>).c = { id: 'c', title: 'c' };
    });
    const orphan = await writeForeignRow(900, d2, getHeads(d1));

    await reload();
    const res = await initAndLoadCache(FAMILY);
    expect(res.loaded).toBe(true);
    expect(res.replay).toMatchObject({ recovered: true, droppedIncrements: 0, missingDeps: 1 });

    // Edit past the re-compaction threshold: the base must never be rewritten (it would make
    // the orphan unreachable), and the orphan row must still be there afterwards.
    for (let i = 0; i < 55; i++) {
      setTodo(`x${i}`);
      await flush();
    }
    expect(await incKeys()).toContain(orphan);
  });

  it('a corrupt row is skipped, the rows after it still replay, and the corrupt row is kept', async () => {
    initDoc();
    await openCache(FAMILY);
    setTodo('a');
    await flush(); // base
    setTodo('b');
    await flush(); // inc (ours)
    const raw = await openDB(DB_NAME, 1);
    await raw.put('doc', {
      id: 'inc:000000000500:othertab',
      payload: bufferToBase64(await encryptPayload(key, new Uint8Array([9, 9, 9, 9]))),
      updatedAt: new Date().toISOString(),
    });
    raw.close();

    await reload();
    const res = await initAndLoadCache(FAMILY);
    expect(res.replay).toMatchObject({ recovered: true, droppedIncrements: 1, missingDeps: 0 });
    expect(todoIds(exportSnapshot().binary)).toEqual(['a', 'b']);
    await flush(); // the recovery base write
    // Our own row is folded into the new base; the unreadable one is kept for a build or key
    // that can read it.
    expect(await incKeys()).toEqual(['inc:000000000500:othertab']);
  });
});

describe('C5d: an edit landing mid-persist still advances the cursor', () => {
  it('the next increment carries only the new change, not the previous one again', async () => {
    initDoc();
    await openCache(FAMILY);
    await flush(); // base
    const original = cache.persistIncrement;
    const spy = vi.spyOn(cache, 'persistIncrement');
    spy.mockImplementationOnce(async (k, framed) => {
      setTodo('b'); // lands while the first increment is being written
      return original(k, framed);
    });
    setTodo('a');
    await flush();
    await flush();
    const sizes = spy.mock.calls.map(([, framed]) => unframeChanges(framed).length);
    // Before the fix the second increment re-wrote `a` beside `b` (the cursor never moved,
    // because `currentDoc === doc` was false the moment `b` landed).
    expect(sizes).toEqual([1, 1]);
  });
});

describe('C5e: initAndLoadCache over a same-family live document merges, never replaces', () => {
  it("keeps the live document's unpersisted edit AND another tab's increment", async () => {
    initDoc();
    await openCache(FAMILY);
    setTodo('a');
    await flush(); // base {a}
    const fork = loadDoc(exportSnapshot().binary);
    const forked = Automerge.change(fork, (d) => {
      (d.todos as Record<string, unknown>).tab = { id: 'tab', title: 'other tab' };
    });
    await writeForeignRow(700, forked, getHeads(fork));
    setTodo('live'); // still in the debounce when the reload starts

    const res = await initAndLoadCache(FAMILY);
    expect(res.loaded).toBe(true);
    expect(todoIds(exportSnapshot().binary)).toEqual(['a', 'live', 'tab']);

    // And the cache now holds all three.
    await flush();
    await reload();
    await initAndLoadCache(FAMILY);
    expect(todoIds(exportSnapshot().binary)).toEqual(['a', 'live', 'tab']);
  });

  it('an EMPTY cache under a live document answers loaded:true (main must not install over it)', async () => {
    initDoc();
    await openCache(FAMILY);
    setTodo('a'); // never persisted
    const res = await initAndLoadCache(FAMILY);
    expect(res.loaded).toBe(true);
    expect(__hasDocForTesting()).toBe(true);
    expect(todoIds(exportSnapshot().binary)).toEqual(['a']);
  });
});

describe('C5f: reset flushes before it closes, unless clearing', () => {
  it('a keep-data sign-out within the debounce still persists the last edit', async () => {
    initDoc();
    await openCache(FAMILY);
    await flush();
    setTodo('last'); // inside the 120 ms debounce
    await reset();
    await reload();
    await initAndLoadCache(FAMILY);
    expect(todoIds(exportSnapshot().binary)).toEqual(['last']);
  });
});

describe('C5g: a write abandons when the handle changes under it', () => {
  it('persistIncrement rejects with CacheHandleChangedError and writes nothing', async () => {
    await cache.initPersistenceDB(FAMILY);
    const writing = cache.persistIncrement(key, new Uint8Array([1, 2, 3]));
    cache.closeCacheDB(); // a sign-out / family switch while the payload is encrypting
    await expect(writing).rejects.toMatchObject({ name: 'CacheHandleChangedError' });
    expect(await incKeys()).toEqual([]);
  });
});

describe('C5h: realm-unique increment keys and a base write that keeps what it lacks', () => {
  it('increments are keyed per realm and written with add()', async () => {
    await cache.initPersistenceDB(FAMILY);
    await cache.persistIncrement(key, new Uint8Array([1]));
    const [k] = await incKeys();
    expect(k).toMatch(/^inc:000000000000:[0-9a-f]{12}$/);
  });

  it("a re-compaction keeps another tab's row; a supersede deletes it", async () => {
    initDoc();
    await openCache(FAMILY);
    setTodo('a');
    await flush();
    const fork = loadDoc(exportSnapshot().binary);
    const forked = Automerge.change(fork, (d) => {
      (d.todos as Record<string, unknown>).tab = { id: 'tab', title: 'x' };
    });
    const foreign = await writeForeignRow(800, forked, getHeads(fork));
    setTodo('b');
    await flush(); // our own increment
    // A same-document base rewrite: ours folds in, theirs stays.
    await cache.persistDocBinary(key, exportSnapshot().binary);
    expect(await incKeys()).toEqual([foreign]);
    // A new generation (adopt / compaction): everything goes.
    await cache.persistDocBinary(key, exportSnapshot().binary, { supersede: true });
    expect(await incKeys()).toEqual([]);
  });
});
