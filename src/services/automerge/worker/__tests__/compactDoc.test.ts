// @vitest-environment node
/**
 * The compaction, against the real worker ops.
 *
 * Two properties matter more than the size saving, and both are silent when
 * broken: the rebuilt document must be VERIFIED before it replaces anything,
 * and installing it must reset the persist cursors — the compacted document
 * shares no ancestry with the cached one, so a persist that wrote an INCREMENT
 * against it would produce an unreadable cache.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { PayloadTooLargeError } from '@/types/sync';

const diffHook = vi.hoisted(() => ({ path: null as string | null }));
// An ESM namespace property is not configurable, so `vi.spyOn(Automerge, 'from')`
// throws. Mock the module and drive `from` through a hook the tests set.
const fromHook = vi.hoisted(() => ({ throws: null as Error | null }));
const statsHook = vi.hoisted(() => ({ throwsOnCompacted: null as Error | null, seen: 0 }));
vi.mock('@automerge/automerge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@automerge/automerge')>();
  return {
    ...actual,
    from: (...args: unknown[]) => {
      if (fromHook.throws) throw fromHook.throws;
      return (actual.from as (...a: unknown[]) => unknown)(...args);
    },
    // `stats` runs in compactDoc's TAIL, after the rebuild succeeded. That tail
    // is where an OOM is most likely (the compacted doc is being serialised
    // while both copies are resident), and it used to sit outside the try AND
    // after the install.
    stats: (...args: unknown[]) => {
      if (statsHook.throwsOnCompacted && statsHook.seen++ > 0) throw statsHook.throwsOnCompacted;
      return (actual.stats as (...a: unknown[]) => unknown)(...args);
    },
  };
});
vi.mock('@/utils/firstJsonDifference', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/firstJsonDifference')>();
  return {
    firstJsonDifference: (a: unknown, b: unknown) =>
      diffHook.path ?? actual.firstJsonDifference(a, b),
  };
});

const cache = await import('../cache');
const { setDocActor, resetDocActor } = await import('../docActor');
const {
  configure,
  compactDoc,
  setKey,
  flush,
  __resetApplyAndProjectForTesting,
  initDoc,
  mutate,
  getHeads,
  exportSnapshot,
} = await import('../applyAndProject');

/** A document with real history: many changes, one entity per change. */
function seedHistory(n: number) {
  initDoc();
  for (let i = 0; i < n; i++) {
    mutate({ op: 'set', collection: 'accounts', id: `a${i}`, entity: { id: `a${i}`, bal: i } });
  }
}

beforeEach(() => {
  diffHook.path = null;
  fromHook.throws = null;
  statsHook.throwsOnCompacted = null;
  statsHook.seen = 0;
  resetDocActor();
  __resetApplyAndProjectForTesting();
  configure({ pushChunk: () => {}, perf: () => {}, cachePersistFailed: () => {} });
});

describe('compactDoc', () => {
  it('drops the history and keeps the data', () => {
    seedHistory(30);
    const before = compactDoc();

    expect(before.changesBefore).toBeGreaterThan(30);
    expect(before.changesAfter).toBe(1);
    expect(before.afterBytes).toBeLessThan(before.beforeBytes);
  });

  /**
   * ⚠️ THE STAMP IS THE WHOLE POINT OF STAGE 1, AND NOTHING ELSE PINNED IT.
   *
   * A compaction that ships without a lineage in the DOCUMENT is
   * indistinguishable from a pod that was never compacted, so every peer merges
   * across the lineage boundary — and in that merge the OLD lineage wins
   * deterministically for any collection a later migration added. This file
   * tested the size saving and the verify gate and said nothing about the stamp.
   */
  it('stamps a fresh lineage into the compacted document', () => {
    seedHistory(5);
    compactDoc();
    const doc = Automerge.toJS(Automerge.load(exportSnapshot().binary)) as {
      podLineage: { id: string; seq: number };
    };
    expect(typeof doc.podLineage?.id).toBe('string');
    expect(doc.podLineage.id.length).toBeGreaterThan(0);
    // First compaction of a pod that never had one.
    expect(doc.podLineage.seq).toBe(1);
  });

  it('increments the generation on a re-compaction, with a NEW identity', () => {
    // `seq` orders the two, `id` distinguishes concurrent compactions on two
    // devices — a bumped `seq` that reused the id would make `compareLineage`
    // answer `same` and permit the very merge the stamp exists to refuse.
    seedHistory(5);
    compactDoc();
    const first = (
      Automerge.toJS(Automerge.load(exportSnapshot().binary)) as {
        podLineage: { id: string; seq: number };
      }
    ).podLineage;

    mutate({ op: 'set', collection: 'accounts', id: 'z', entity: { id: 'z', bal: 1 } });
    compactDoc();
    const second = (
      Automerge.toJS(Automerge.load(exportSnapshot().binary)) as {
        podLineage: { id: string; seq: number };
      }
    ).podLineage;

    expect(second.seq).toBe(first.seq + 1);
    expect(second.id).not.toBe(first.id);
  });

  it('REFUSES and keeps the old document when the rebuild differs', () => {
    // The gate. `toJS -> from` is type-safe by construction for a pure-JSON
    // document, but "by construction" is not good enough when the output
    // replaces a family's pod.
    seedHistory(5);
    const headsBefore = getHeads().heads;
    diffHook.path = 'accounts.a3.bal';

    // The id is masked — see `maskEntityIds`. The collection and the leaf are
    // what triage needs; the id in between can be a Google account email.
    expect(() => compactDoc()).toThrow(/accounts\.<id>\.bal/);
    // The old document is still installed and unchanged.
    expect(getHeads().heads).toEqual(headsBefore);
  });

  it('names the PATH of the difference, never the value', () => {
    // The message reaches the firehose, and the firehose is PII-free.
    seedHistory(3);
    diffHook.path = 'accounts.a1.bal';
    expect(() => compactDoc()).toThrow(/compaction changed the document at accounts\.<id>\.bal/);
  });

  it('MASKS the entity id, which can be a Google account email', () => {
    // ⚠️ `driveConnections` is keyed by the account email
    // (`driveConnectionId`), and this message becomes the error's stack — which
    // `logEvent` writes outside the allowlisted context and `reportError`
    // pastes into Slack. The path promise held; the id in it did not.
    seedHistory(2);
    diffHook.path = 'driveConnections.someone@example.com.refreshToken';
    // One call: a second would run against the state the first left behind.
    let message = '';
    try {
      compactDoc();
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('driveConnections.<id>.refreshToken');
    expect(message).not.toContain('someone@example.com');
  });

  it('classifies an out-of-memory rebuild as a device problem, not damaged data', () => {
    // A compaction holds three copies at once, so it costs MORE than an open —
    // a real possibility on the devices that most want it. The honest copy for
    // that already exists; it just has to be reachable.
    seedHistory(3);
    fromHook.throws = new Error('error inflating document chunk ops: out of memory');
    expect(() => compactDoc()).toThrow(PayloadTooLargeError);
  });

  it('does NOT install a document it could not finish measuring', () => {
    // ⚠️ THE WORST OUTCOME IN THE WHOLE FEATURE, and it was reachable.
    // `saveDoc(compacted)` and `Automerge.stats(compacted)` ran AFTER
    // `currentDoc = compacted` and outside the try. An OOM there rejected the
    // RPC, so `usePodCompaction` reported "rebuild-failed" and told the user
    // nothing had moved — while the worker held the COMPACTED document with
    // its cursors reset and its lineage never stamped. The next persist wrote
    // that compacted base to cache and the next save uploaded it under the OLD
    // lineage, where every peer reads `same` and merges across lineages.
    seedHistory(3);
    const before = exportSnapshot().binary;
    statsHook.throwsOnCompacted = new Error('out of memory');

    expect(() => compactDoc()).toThrow(PayloadTooLargeError);

    // The OLD document is still the current one, history and all.
    const after = exportSnapshot().binary;
    expect(Automerge.getAllChanges(Automerge.load(after)).length).toBe(
      Automerge.getAllChanges(Automerge.load(before)).length
    );
    expect(Automerge.getAllChanges(Automerge.load(after)).length).toBeGreaterThan(1);
  });

  it('uses the pinned actor, so it does not re-introduce the churn', () => {
    // The compacted document is ONE change. If it were minted with a random
    // actor, Phase C would add a fresh lane to the very document it just
    // stripped of its history.
    const ACTOR = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    setDocActor(ACTOR);
    seedHistory(4);
    compactDoc();
    // `exportSnapshot` is the only doc accessor the worker exposes; loading its
    // bytes back gives the change log, and a compacted doc has exactly one.
    const doc = Automerge.load(exportSnapshot().binary);
    const actors = new Set(
      Automerge.getAllChanges(doc).map((c) => Automerge.decodeChange(c).actor)
    );
    expect([...actors]).toEqual([ACTOR]);
  });
});

describe('installing the compacted document resets the persist cursors', () => {
  it('makes the NEXT persist write a base, never an increment', async () => {
    // ⚠️ The silent one. The compacted document shares NO ancestry with the
    // cached one, so an increment written against it would produce a cache that
    // cannot be reconstructed — and nothing about that is visible until a
    // device tries to open it. Removing the `resetDocCursors()` line leaves
    // every other assertion in this file green, which is why this asserts on
    // the REAL cache rows rather than on a mock.
    const { generateFamilyKey } = await import('@/services/crypto/familyKeyService');
    cache.__resetCacheForTesting();
    await cache.initPersistenceDB('compact-cursor-test');
    setKey(await generateFamilyKey());

    seedHistory(4);
    await flush(); // the first persist after initDoc writes the BASE
    expect(cache.incrementCount()).toBe(0);

    // Control: an ordinary edit persists as an INCREMENT, so the assertion
    // below is a comparison rather than a claim.
    mutate({ op: 'set', collection: 'accounts', id: 'zz', entity: { id: 'zz', bal: 1 } });
    await flush();
    expect(cache.incrementCount(), 'control: an ordinary edit is an increment').toBeGreaterThan(0);

    compactDoc();
    await flush();
    // A base write clears every increment in the same transaction, so a count
    // of zero IS the proof that this persisted as a base.
    expect(cache.incrementCount(), 'a compaction must persist as a BASE').toBe(0);

    await cache.clearCache('compact-cursor-test');
  });
});
