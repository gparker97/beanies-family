// @vitest-environment node
/**
 * Round 3 of the #117 Phase 2 audit fixes (worker + cache): one pin per item, against the real
 * worker ops and a real (fake-indexeddb) cache.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { openDB } from 'idb';
import type { FamilyDocument } from '@/types/automerge';
import { CacheInitError } from '@/types/sync';
import { generateFamilyKey, encryptPayload } from '@/services/crypto/familyKeyService';
import { bufferToBase64 } from '@/utils/encoding';
import {
  getHeads,
  getChangesSince,
  frameChanges,
  loadDoc,
  saveDoc,
  docLineage,
  buildRebaseOps,
} from '../docOps';
import * as docOps from '../docOps';
import * as cache from '../cache';
import * as ap from '../applyAndProject';
import { foldDoc } from '../counterFields';
import { seeded, apply, useTestDevices, resetTestDevices } from './twoDevices';

const FAMILY = 'r3-family';
const OTHER = 'r3-other';
const DB_NAME = `beanies-automerge-${FAMILY}`;

type Doc = Automerge.Doc<FamilyDocument>;

let key: CryptoKey;
const persistSignals: Array<{ failed: boolean; errorName?: string }> = [];
const sink = {
  pushChunk() {},
  perf() {},
  cachePersistFailed(failed: boolean, detail?: { errorName?: string }) {
    persistSignals.push({ failed, errorName: detail?.errorName });
  },
  cacheReleased() {},
};

beforeEach(async () => {
  cache.__resetCacheForTesting();
  ap.__resetApplyAndProjectForTesting();
  ap.configure(sink as never);
  persistSignals.length = 0;
  key = await generateFamilyKey();
  await ap.setKey(key, FAMILY);
});
afterEach(async () => {
  vi.restoreAllMocks();
  cache.__resetCacheForTesting();
  await cache.clearCache(FAMILY);
  await cache.clearCache(OTHER);
});

const setTodo = (id: string) =>
  ap.mutate({ op: 'set', collection: 'todos', id, entity: { id, title: id } });

async function allKeys(): Promise<string[]> {
  const raw = await openDB(DB_NAME, 1);
  try {
    return (await raw.getAllKeys('doc')) as string[];
  } finally {
    raw.close();
  }
}

async function putRaw(id: string, payload: string): Promise<void> {
  const raw = await openDB(DB_NAME, 1);
  await raw.put('doc', { id, payload, updatedAt: new Date().toISOString() });
  raw.close();
}

/** A fresh realm (a reload) with `k`: drop all in-memory state, keep the database. */
async function reload(k: CryptoKey = key): Promise<void> {
  await ap.reset();
  ap.__resetApplyAndProjectForTesting();
  ap.configure(sink as never);
  await ap.setKey(k, FAMILY);
}

const liveTodos = () =>
  Object.keys(
    (Automerge.toJS(loadDoc(ap.exportSnapshot().binary)) as { todos: object }).todos
  ).sort();

const BASELINE = { kind: 'baseline', heads: null } as const;

async function envelopeOf(doc: Doc) {
  return {
    version: '4.0' as const,
    familyId: FAMILY,
    familyName: 'F',
    keyId: 'k',
    wrappedKeys: {},
    passkeyWrappedKeys: {},
    inviteKeys: {},
    encryptedPayload: bufferToBase64(await encryptPayload(key, saveDoc(doc))),
  };
}

describe('round 3, item 1/4: the worker never crosses families under a key', () => {
  it("setKey for another family flushes the old family's pending edit under the OLD key first", async () => {
    ap.initDoc();
    await ap.openCache(FAMILY);
    await ap.flush();
    setTodo('pending'); // still inside the debounce
    await ap.setKey(await generateFamilyKey(), OTHER);
    // The edit reached FAMILY's cache under FAMILY's key.
    await reload();
    await ap.initAndLoadCache(FAMILY);
    expect(liveTodos()).toEqual(['pending']);
  });

  it('a persist and an export REFUSE while the key is another family’s, and resume after', async () => {
    ap.initDoc();
    await ap.openCache(FAMILY);
    await ap.flush();
    await ap.setKey(await generateFamilyKey(), OTHER);
    setTodo('refused');
    await ap.flush();
    expect(persistSignals.at(-1)).toEqual({ failed: true, errorName: 'FamilyKeyMismatchError' });
    await expect(ap.exportEncryptedPayload()).rejects.toMatchObject({
      name: 'FamilyKeyMismatchError',
      mismatch: 'key',
    });

    await ap.setKey(key, FAMILY); // restored
    await ap.flush();
    expect(persistSignals.at(-1)).toEqual({ failed: false, errorName: undefined });
    await reload();
    await ap.initAndLoadCache(FAMILY);
    expect(liveTodos()).toEqual(['refused']);
  });

  it("an export refuses when the open cache is another family's", async () => {
    ap.initDoc();
    await ap.openCache(FAMILY);
    await cache.initPersistenceDB(OTHER);
    await expect(ap.exportEncryptedPayload()).rejects.toMatchObject({ mismatch: 'cache' });
  });
});

describe('round 3, item 2: a live document never merges a cache of another lineage', () => {
  it('compacted document + post-compaction edit vs an old-lineage cache: nothing lost', async () => {
    ap.initDoc();
    await ap.openCache(FAMILY);
    setTodo('a');
    await ap.flush(); // the cache holds the OLD lineage
    ap.compactDoc();
    setTodo('post'); // a post-compaction edit
    // The compaction's superseding base never lands (a failed write), so the cache is stale.
    vi.spyOn(cache, 'persistDocBinary').mockRejectedValue(
      Object.assign(new Error('quota'), { name: 'QuotaExceededError' })
    );
    const before = Automerge.getAllChanges(loadDoc(ap.exportSnapshot().binary)).length;

    const res = await ap.initAndLoadCache(FAMILY);
    expect(res.replay).toMatchObject({ lineageStale: true, lineageDirection: 'live-newer' });
    expect(res.remoteBaseline).toBeNull();
    const live = loadDoc(ap.exportSnapshot().binary);
    // The old history was not grafted on, and the live lineage stands.
    expect(Automerge.getAllChanges(live).length).toBe(before);
    expect(docLineage(live)).toMatchObject({ seq: 1 });
    expect(liveTodos()).toEqual(['a', 'post']);

    // Once the write works, the cache is superseded by the live document.
    vi.mocked(cache.persistDocBinary).mockRestore();
    await ap.flush();
    await reload();
    await ap.initAndLoadCache(FAMILY);
    expect(liveTodos()).toEqual(['a', 'post']);
    expect(docLineage(loadDoc(ap.exportSnapshot().binary))).toMatchObject({ seq: 1 });
  });
});

describe('round 3, item 3 (C5a): an unreadable cache is re-seeded, never left forever', () => {
  async function seedCache(): Promise<void> {
    ap.initDoc();
    await ap.openCache(FAMILY);
    setTodo('a');
    await ap.flush();
  }

  it('an unproven base decrypt failure on 3 consecutive opens re-seeds (nothing-to-lose)', async () => {
    await seedCache();
    const wrong = await generateFamilyKey();
    for (let i = 1; i <= 2; i++) {
      await reload(wrong);
      const err = await ap.initAndLoadCache(FAMILY).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CacheInitError);
      expect(err).toMatchObject({ loss: 'something-to-lose' });
    }
    await reload(wrong);
    const third = await ap.initAndLoadCache(FAMILY).catch((e: unknown) => e);
    expect(third).toMatchObject({ loss: 'nothing-to-lose', cause: 'BaseDecryptRepeated' });
    // The cache was deleted and re-opened empty.
    expect(await allKeys()).not.toContain('base');
    expect(cache.isCacheReady()).toBe(true);
  });

  it('a successful open in between resets the run', async () => {
    await seedCache();
    const wrong = await generateFamilyKey();
    for (let i = 0; i < 2; i++) {
      await reload(wrong);
      await ap.initAndLoadCache(FAMILY).catch(() => {});
    }
    await reload(key);
    expect((await ap.initAndLoadCache(FAMILY)).loaded).toBe(true);
    await reload(wrong);
    expect(await ap.initAndLoadCache(FAMILY).catch((e: unknown) => e)).toMatchObject({
      loss: 'something-to-lose',
    });
  });

  it('the person choosing the family file re-seeds the cache from the adopted document', async () => {
    await seedCache();
    const remote = loadDoc(ap.exportSnapshot().binary);
    const remoteNext = Automerge.change(remote, (d) => {
      (d.todos as Record<string, unknown>).remote = { id: 'remote', title: 'remote' };
    });
    await putRaw('base', 'not-a-ciphertext'); // the base no longer decrypts
    await reload();
    await expect(ap.initAndLoadCache(FAMILY)).rejects.toMatchObject({ loss: 'something-to-lose' });
    expect(cache.isCacheReady()).toBe(false); // the cold failure CLOSED the handle

    await ap.mergeRemoteEnvelope(await envelopeOf(remoteNext), FAMILY, {
      kind: 'no-local-document',
    });
    await expect(ap.reseedCacheFromLiveDoc(FAMILY)).resolves.toEqual({ reseeded: true });
    await ap.flush();
    await reload();
    expect((await ap.initAndLoadCache(FAMILY)).loaded).toBe(true);
    expect(liveTodos()).toEqual(['a', 'remote']);
  });
});

/**
 * A cache holding todo `a`, plus an increment row from another tab whose dep never arrived (a
 * missing-deps row). `remote` is an envelope that lacks the dep too: the remote this device
 * keeps reaching. Captured before `d1`, because an Automerge change consumes `d0`'s handle.
 */
async function seedOrphanRow(): Promise<{
  remote: Awaited<ReturnType<typeof envelopeOf>>;
  orphan: string;
}> {
  ap.initDoc();
  await ap.openCache(FAMILY);
  setTodo('a');
  await ap.flush();
  const d0 = loadDoc(ap.exportSnapshot().binary);
  const remote = await envelopeOf(d0);
  const d1 = Automerge.change(d0, (d) => {
    (d.todos as Record<string, unknown>).b = { id: 'b', title: 'b' };
  });
  const d2 = Automerge.change(d1, (d) => {
    (d.todos as Record<string, unknown>).c = { id: 'c', title: 'c' };
  });
  const orphan = 'inc:000000000900:othertab';
  await putRaw(
    orphan,
    bufferToBase64(await encryptPayload(key, frameChanges(getChangesSince(d2, getHeads(d1)))))
  );
  return { remote, orphan };
}

describe('round 3, item 6: damaged replay rows are reported once and leave replay', () => {
  it('a skipped row is quarantined and reported only on the open that found it', async () => {
    ap.initDoc();
    await ap.openCache(FAMILY);
    setTodo('a');
    await ap.flush();
    await putRaw(
      'inc:000000000500:othertab',
      bufferToBase64(await encryptPayload(key, new Uint8Array([9, 9, 9])))
    );
    await reload();
    const first = await ap.initAndLoadCache(FAMILY);
    expect(first.replay).toMatchObject({ droppedIncrements: 1, quarantined: 1, newlyReported: 1 });
    expect(await allKeys()).toContain('qinc:000000000500:othertab');

    await ap.flush();
    await reload();
    const second = await ap.initAndLoadCache(FAMILY);
    expect(second.replay).toMatchObject({ recovered: false, droppedIncrements: 0 });
    expect(second.replay?.newlyReported).toBeUndefined();
  });

  it('a missing-deps row is reported once, fenced twice, and given up on the third open', async () => {
    const { remote, orphan } = await seedOrphanRow();

    const seen: Array<Record<string, unknown> | undefined> = [];
    for (let i = 0; i < 3; i++) {
      await reload();
      seen.push((await ap.initAndLoadCache(FAMILY)).replay as never);
      // Each session reaches the remote, which does not hold the missing deps either.
      if (i < 2) await ap.mergeRemoteEnvelope(remote, FAMILY, BASELINE);
      await ap.flush();
    }
    expect(seen[0]).toMatchObject({ missingDeps: 1, newlyReported: 1 });
    expect(seen[1]).toMatchObject({ missingDeps: 1, newlyReported: 0 });
    expect(seen[2]).toMatchObject({ missingDeps: 1, fenceGaveUp: true });
    expect(await allKeys()).toContain(`q${orphan}`);
    expect(await allKeys()).not.toContain(orphan);

    await reload();
    const after = await ap.initAndLoadCache(FAMILY);
    expect(after.replay).toMatchObject({ recovered: false, missingDeps: 0 });
    expect(liveTodos()).toEqual(['a']);
  });

  it('foreign rows a base write could not delete do not count toward re-compaction', async () => {
    ap.initDoc();
    await ap.openCache(FAMILY);
    setTodo('a');
    await ap.flush();
    for (let i = 0; i < 3; i++) {
      await putRaw(`inc:00000000070${i}:othertab`, 'x');
    }
    await cache.persistDocBinary(key, ap.exportSnapshot().binary); // same document: keeps them
    expect(cache.incrementCount()).toBe(0);
    setTodo('b');
    await ap.flush();
    expect(cache.incrementCount()).toBe(1);
  });
});

describe('round 3, item 7: the export says whether the document holds Counters', () => {
  it('false for an ordinary document, true for one with a fold ledger', async () => {
    ap.initDoc();
    expect((await ap.exportEncryptedPayload()).hasCounters).toBe(false);
    const withLedger = Automerge.change(loadDoc(ap.exportSnapshot().binary), (d) => {
      (d as { foldedCounters?: Record<string, number> }).foldedCounters = { k: 1 };
    });
    ap.loadSnapshot(saveDoc(withLedger));
    expect((await ap.exportEncryptedPayload()).hasCounters).toBe(true);
  });
});

describe('round 3, item 8: compactDoc reports the installed heads', () => {
  it('the heads are the compacted document’s', () => {
    ap.initDoc();
    setTodo('a');
    const res = ap.compactDoc();
    expect(res.heads).toEqual(getHeads(loadDoc(ap.exportSnapshot().binary)));
  });
});

describe('round 3, item 5 (C8 narrowing): only money fields or existence block a transaction', () => {
  const TX = { id: 'T', accountId: 'A', amount: 10, description: 'groceries', type: 'expense' };
  beforeEach(() => useTestDevices());
  afterEach(() => resetTestDevices());
  const origin = () => seeded([{ op: 'set', collection: 'transactions', id: 'T', entity: TX }]);
  const compact = (doc: Doc): Doc =>
    Automerge.from({ ...foldDoc(doc), podLineage: { id: 'L-NEW', seq: 1 } }) as unknown as Doc;
  const patchTx = (patch: Record<string, unknown>) =>
    ({ op: 'patch', collection: 'transactions', id: 'T', patch }) as const;

  it('a description conflict settles target-wins, counted, and does NOT block', () => {
    const o = origin();
    const baseline = Automerge.getHeads(o);
    const peer = apply(Automerge.clone(o), patchTx({ description: 'peer', amount: 25 }));
    const target = apply(compact(o), patchTx({ description: 'target' }));
    const ops = buildRebaseOps(peer, baseline, target);
    expect(ops?.blockedBy).toBeUndefined();
    expect(ops?.conflicts).toBe(1);
    expect(ops?.op).toBeTruthy(); // the amount the target did not touch still crosses
  });

  it('an amount conflict blocks', () => {
    const o = origin();
    const baseline = Automerge.getHeads(o);
    const peer = apply(Automerge.clone(o), patchTx({ amount: 20 }));
    const target = apply(compact(o), patchTx({ amount: 30 }));
    expect(buildRebaseOps(peer, baseline, target)).toMatchObject({ blockedBy: 'transactions' });
  });

  it('recurringItemId blocks only when its truthiness differs', () => {
    const o = origin();
    const baseline = Automerge.getHeads(o);
    const both = buildRebaseOps(
      apply(Automerge.clone(o), patchTx({ recurringItemId: 'r1' })),
      baseline,
      apply(compact(o), patchTx({ recurringItemId: 'r2' }))
    );
    expect(both?.blockedBy).toBeUndefined();
    const o2 = seeded([
      { op: 'set', collection: 'transactions', id: 'T', entity: { ...TX, recurringItemId: 'r0' } },
    ]);
    const flips = buildRebaseOps(
      apply(Automerge.clone(o2), patchTx({ recurringItemId: 'r1' })),
      Automerge.getHeads(o2),
      apply(compact(o2), patchTx({ recurringItemId: null }))
    );
    expect(flips).toMatchObject({ blockedBy: 'transactions' });
  });

  it('an existence conflict (peer edits, target deleted) still blocks', () => {
    const o = origin();
    const baseline = Automerge.getHeads(o);
    const peer = apply(Automerge.clone(o), patchTx({ description: 'peer' }));
    const target = apply(compact(o), { op: 'delete', collection: 'transactions', id: 'T' });
    expect(buildRebaseOps(peer, baseline, target)).toMatchObject({ blockedBy: 'transactions' });
  });
});

describe('final pass, item 2: a flush never crosses a key swap', () => {
  it('A fully flushed, setKey(B), initAndLoadCache(B): no durability failure', async () => {
    ap.initDoc();
    await ap.openCache(FAMILY);
    setTodo('a');
    await ap.flush();
    persistSignals.length = 0;
    await ap.setKey(await generateFamilyKey(), OTHER);
    await ap.flush(); // an empty delta under the other key is not a refusal
    await ap.initAndLoadCache(OTHER); // the re-point does not flush A under B's key
    expect(persistSignals.filter((s) => s.failed)).toEqual([]);
  });
});

describe('final pass, item 4: a stale-lineage cache is superseded only when the live side is newer', () => {
  it('cache-newer: the live document is kept, no base is written over the cache, and adopting lifts the fence', async () => {
    ap.initDoc();
    await ap.openCache(FAMILY);
    setTodo('a');
    await ap.flush();
    // Another tab moved the cache on to a newer lineage.
    const newer = Automerge.change(loadDoc(ap.exportSnapshot().binary), (d) => {
      (d as { podLineage?: unknown }).podLineage = { id: 'other-tab', seq: 1 };
    });
    const newerEnvelope = await envelopeOf(newer);
    await cache.persistDocBinary(key, saveDoc(newer), { supersede: true });
    setTodo('live'); // an edit on the older live document

    const res = await ap.initAndLoadCache(FAMILY);
    expect(res.replay).toMatchObject({ lineageStale: true, lineageDirection: 'cache-newer' });
    expect(liveTodos()).toEqual(['a', 'live']);

    // Past the re-compaction threshold, still no base write: the cache keeps its newer base.
    const writeBase = vi.spyOn(cache, 'persistDocBinary');
    for (let i = 0; i < 51; i++) {
      setTodo(`e${i}`);
      await ap.flush();
    }
    expect(writeBase).not.toHaveBeenCalled();

    // The other tab keeps writing on its (newer) lineage: an edit this realm never sees.
    const tabEdit = Automerge.change(newer, (d) => {
      (d.todos as Record<string, unknown>).tab2 = { id: 'tab2', title: 'tab2' };
    });
    const otherTabRow = 'inc:000000000999:othertab';
    await putRaw(
      otherTabRow,
      bufferToBase64(
        await encryptPayload(key, frameChanges(getChangesSince(tabEdit, getHeads(newer))))
      )
    );

    // Installing the newer lineage (here wholesale; a peer merge adopts or rebases) lifts it.
    await ap.mergeRemoteEnvelope(newerEnvelope, FAMILY, { kind: 'no-local-document' });
    await ap.flush();
    expect(writeBase).toHaveBeenCalled();
    expect(docLineage(loadDoc(ap.exportSnapshot().binary))).toMatchObject({ id: 'other-tab' });
    // The lift's base is non-superseding: the other tab's same-lineage row survives, while this
    // realm's own (contained) increments are gone.
    expect(writeBase.mock.calls.every(([, , opts]) => opts?.supersede !== true)).toBe(true);
    const keys = await allKeys();
    expect(keys.filter((k) => k.startsWith('inc:'))).toEqual([otherTabRow]);
    await reload();
    await ap.initAndLoadCache(FAMILY);
    expect(liveTodos()).toEqual(['a', 'tab2']);
  });

  it('a failed baseline clear rides the replay as bookkeeping', async () => {
    ap.initDoc();
    await ap.openCache(FAMILY);
    setTodo('a');
    await ap.flush();
    ap.compactDoc(); // live-newer, and its superseding base never lands
    vi.spyOn(cache, 'persistDocBinary').mockRejectedValue(
      Object.assign(new Error('quota'), { name: 'QuotaExceededError' })
    );
    vi.spyOn(cache, 'clearRemoteBaseline').mockRejectedValue(
      Object.assign(new Error('gone'), { name: 'InvalidStateError' })
    );
    const res = await ap.initAndLoadCache(FAMILY);
    expect(res.replay).toMatchObject({
      lineageDirection: 'live-newer',
      bookkeepingFailed: ['lineage-baseline-clear:InvalidStateError'],
    });
  });
});

describe('final pass, item 6: only a session that merged and still missed the deps counts', () => {
  it('offline opens (no merge) never give the fence up', async () => {
    const { orphan } = await seedOrphanRow();
    for (let i = 0; i < 4; i++) {
      await reload();
      const res = await ap.initAndLoadCache(FAMILY);
      expect(res.replay).toMatchObject({ missingDeps: 1 });
      expect(res.replay?.fenceGaveUp).toBeUndefined();
      await ap.flush();
    }
    expect(await allKeys()).toContain(orphan);
  });

  it('the quarantined rows are listed, and counted on every later open', async () => {
    const { remote, orphan } = await seedOrphanRow();
    for (let i = 0; i < 3; i++) {
      await reload();
      await ap.initAndLoadCache(FAMILY);
      if (i < 2) await ap.mergeRemoteEnvelope(remote, FAMILY, BASELINE);
      await ap.flush();
    }
    expect(await cache.listQuarantinedRows()).toEqual([`q${orphan}`]);
    await reload();
    expect((await ap.initAndLoadCache(FAMILY)).replay).toMatchObject({ quarantinedTotal: 1 });
  });

  it('a failed quarantine keeps the fence and is reported as bookkeeping', async () => {
    const { remote, orphan } = await seedOrphanRow();
    for (let i = 0; i < 2; i++) {
      await reload();
      await ap.initAndLoadCache(FAMILY);
      await ap.mergeRemoteEnvelope(remote, FAMILY, BASELINE);
      await ap.flush();
    }
    vi.spyOn(cache, 'quarantinePendingRows').mockRejectedValue(
      Object.assign(new Error('tx'), { name: 'AbortError' })
    );
    await reload();
    const res = await ap.initAndLoadCache(FAMILY);
    expect(res.replay?.fenceGaveUp).toBeUndefined();
    expect(res.replay?.bookkeepingFailed).toEqual(['fence-quarantine:AbortError']);
    expect(await allKeys()).toContain(orphan);
  });
});

describe('final pass, item 7: the give-up rebuild runs before the quarantine and never blocks the open', () => {
  it('an allocation failure in the rebuild skips the give-up: the open succeeds, the rows stay inc:*', async () => {
    const { remote, orphan } = await seedOrphanRow();
    for (let i = 0; i < 2; i++) {
      await reload();
      await ap.initAndLoadCache(FAMILY);
      await ap.mergeRemoteEnvelope(remote, FAMILY, BASELINE);
      await ap.flush();
    }
    const real = docOps.applyChanges;
    // Only the rebuild applies onto an EMPTY document; the replay applies onto the base.
    const applySpy = vi.spyOn(docOps, 'applyChanges').mockImplementation((doc, changes) => {
      if (Automerge.getHeads(doc).length === 0) {
        throw new RangeError('Array buffer allocation failed');
      }
      return real(doc, changes);
    });
    await reload();
    const res = await ap.initAndLoadCache(FAMILY);
    expect(res.loaded).toBe(true);
    expect(res.replay).toMatchObject({ missingDeps: 1 });
    expect(res.replay?.fenceGaveUp).toBeUndefined();
    expect(res.replay?.bookkeepingFailed).toEqual(['fence-rebuild:RangeError']);
    expect(liveTodos()).toEqual(['a']);
    await ap.flush();
    const keys = await allKeys();
    expect(keys).toContain(orphan); // nothing was quarantined
    expect(keys.filter((k) => k.startsWith('q'))).toEqual([]);
    // The run is cleared, so the next open does not retry the give-up.
    expect(await cache.readMetaCounter('fence-merges')).toBe(0);
    applySpy.mockRestore();
    await reload();
    const next = await ap.initAndLoadCache(FAMILY);
    expect(next.replay?.fenceGaveUp).toBeUndefined();
    expect(await allKeys()).toContain(orphan);
  });
});

describe('final pass, item 8: an unreadable report marker is bookkeeping, not silence', () => {
  it('replay-reported-unparseable rides the replay', async () => {
    await seedOrphanRow();
    await putRaw('meta:replay-reported', '{not json');
    await reload();
    const res = await ap.initAndLoadCache(FAMILY);
    expect(res.replay?.bookkeepingFailed).toEqual(['replay-reported-unparseable:SyntaxError']);
  });
});
