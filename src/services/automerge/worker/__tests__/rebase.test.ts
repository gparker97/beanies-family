// @vitest-environment node
/**
 * Stage 3 — replaying a peer's unsynced work onto a compacted lineage.
 *
 * This is the change that removes the dead end: a device that was offline while
 * the family compacted no longer has to give its work up. It is also the most
 * dangerous code in the tier, because it writes a peer's edits into a document
 * that shares no ancestry with theirs.
 *
 * The invariant every test here defends: THE REBASE MUST NEVER LOSE MORE THAN
 * THE BLOCK IT REPLACED. Every way it can fail leaves the document untouched
 * and raises the same block as before.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { PodLineageError } from '@/services/sync/podLineage';

// An ESM namespace property is not configurable, so `vi.spyOn(Automerge, …)`
// throws. Mock the module and drive it through a hook — the same shape
// `compactDoc.test.ts` uses for the same reason.
const changeHook = vi.hoisted(() => ({ throws: null as Error | null }));
vi.mock('@automerge/automerge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@automerge/automerge')>();
  return {
    ...actual,
    change: (...args: unknown[]) => {
      if (changeHook.throws) throw changeHook.throws;
      return (actual.change as (...a: unknown[]) => unknown)(...args);
    },
  };
});

const { generateFamilyKey, encryptPayload } = await import('@/services/crypto/familyKeyService');
const { bufferToBase64 } = await import('@/utils/encoding');
const ap = await import('../applyAndProject');
const {
  buildRebaseOps: buildRebaseOpsRaw,
  applyMutation: applyMutationOp,
  materializeCollection,
  nextLineage,
  docLineage,
} = await import('../docOps');
const { setCounterWrites, counterStats, foldDoc, foldIndex, LEDGER_WINDOW } =
  await import('../counterFields');
const { seeded } = await import('./twoDevices');
// The composer is typed on `FamilyDocument`; these fixtures are deliberately a
// minimal subset, so the cast is at the boundary rather than inside the tests.
const buildRebaseOps = buildRebaseOpsRaw as unknown as (
  local: Automerge.Doc<Doc>,
  heads: string[],
  target: Automerge.Doc<Doc>
) => { op: unknown; count: number; conflicts: number; counterCarries: number } | null;

type Doc = Record<string, unknown>;
type Coll = Record<string, Record<string, unknown>>;

function base(): Automerge.Doc<Doc> {
  return Automerge.from<Doc>({
    familyMembers: {},
    todos: {},
    accounts: {},
    settings: { baseCurrency: 'GBP', theme: 'light' },
  });
}

/**
 * The compacted document: same data, brand-new history and object ids, and the
 * lineage stamp `compactDoc` writes into the rebuild. Without the stamp both
 * sides read `null`, the verdict is `same`, and the guard merges — so a fixture
 * that omits it silently tests nothing about the rebase.
 *
 * The source is `foldDoc`, exactly as `compactDoc` builds it (#117 Phase 2): Counters folded into
 * their absolutes, the map emptied, the bounded ledger rebuilt at the NEXT generation
 * (`nextLineage` of the document's own, so `restoreSeq` is carried as in production; #117
 * writer flip). A bare `toJS` here would be the old-build compaction shape, which one test
 * below builds on purpose. `fromHeads: true` stamps the source heads exactly as `compactDoc`
 * does, so a peer holding them is FRESH; omitted, every peer is "behind" (positives only).
 */
function compact<T>(
  doc: Automerge.Doc<T>,
  id = 'L-NEW',
  opts: { fromHeads?: boolean } = {}
): Automerge.Doc<T> {
  const d = doc as unknown as Parameters<typeof foldDoc>[0];
  const lineage = { ...nextLineage(docLineage(d)), id };
  const folded = foldDoc(d, lineage.seq);
  return Automerge.from({
    ...folded,
    podLineage: { ...lineage, ...(opts.fromHeads ? { fromHeads: Automerge.getHeads(doc) } : {}) },
  }) as unknown as Automerge.Doc<T>;
}

async function envelopeFor(doc: Automerge.Doc<Doc>, key: CryptoKey) {
  return {
    version: '4.0' as const,
    familyId: 'fam',
    familyName: 'F',
    keyId: 'k',
    wrappedKeys: {},
    passkeyWrappedKeys: {},
    inviteKeys: {},
    encryptedPayload: bufferToBase64(await encryptPayload(key, Automerge.save(doc))),
  };
}

let key: CryptoKey;
beforeEach(async () => {
  changeHook.throws = null;
  key = await generateFamilyKey();
  ap.reset();
  ap.configure({ pushChunk() {}, perf() {}, cachePersistFailed() {}, cacheReleased() {} });
  ap.setKey(key);
});

describe('the peer keeps its offline work', () => {
  it('replays an add, an edit and a delete onto the compacted lineage', async () => {
    // The shared starting point both sides agree on.
    let shared = base();
    shared = Automerge.change(shared, (d) => {
      (d.todos as Coll).keep = { id: 'keep', title: 'shared' };
      (d.todos as Coll).doomed = { id: 'doomed', title: 'to be deleted' };
    });
    const baselineHeads = Automerge.getHeads(shared);

    // The peer, offline, does three different things.
    let peer = Automerge.load<Doc>(Automerge.save(shared));
    peer = Automerge.change(peer, (d) => {
      (d.todos as Coll).added = { id: 'added', title: 'made while offline' };
      (d.todos as Coll).keep!.title = 'edited while offline';
      delete (d.todos as Coll).doomed;
    });

    // Meanwhile the family compacted, and someone added a todo after.
    let remote = compact(shared);
    remote = Automerge.change(remote, (d) => {
      (d.todos as Coll).theirs = { id: 'theirs', title: 'added after compacting' };
    });

    ap.loadSnapshot(Automerge.save(peer));
    const res = await ap.mergeRemoteEnvelope(await envelopeFor(remote, key), 'fam', {
      kind: 'baseline',
      heads: baselineHeads,
    });

    expect(res.action).toBe('rebased');
    const out = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as { todos: Coll };
    // The peer's work survived...
    expect(out.todos.added?.title).toBe('made while offline');
    expect(out.todos.keep?.title).toBe('edited while offline');
    expect(out.todos.doomed).toBeUndefined();
    // ...and so did the compactor's.
    expect(out.todos.theirs?.title).toBe('added after compacting');
    // And it is published, because the replay moved us past Drive.
    expect(res.dirty).toBe(true);
  });

  it('MERGES settings field by field, never replacing the whole object', async () => {
    // ⚠️ `setSettings` replaces the singleton. Emitting the peer's entire
    // settings object would silently revert a currency or theme the compactor
    // changed — a whole-object write dressed as a merge.
    const shared = base();
    const baselineHeads = Automerge.getHeads(shared);

    let peer = Automerge.load<Doc>(Automerge.save(shared));
    peer = Automerge.change(peer, (d) => {
      (d.settings as Record<string, unknown>).theme = 'dark';
    });

    let remote = compact(shared);
    remote = Automerge.change(remote, (d) => {
      (d.settings as Record<string, unknown>).baseCurrency = 'EUR';
    });

    ap.loadSnapshot(Automerge.save(peer));
    await ap.mergeRemoteEnvelope(await envelopeFor(remote, key), 'fam', {
      kind: 'baseline',
      heads: baselineHeads,
    });

    const out = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as {
      settings: Record<string, unknown>;
    };
    expect(out.settings.theme).toBe('dark'); // the peer's change
    expect(out.settings.baseCurrency).toBe('EUR'); // the compactor's, NOT reverted
  });

  it('emits patchSettings (never setSettings), and carries a peer-removed rate (#117)', () => {
    // ⚠️ Sent WITHOUT a `base`, so the worker takes the target as the base and applies the
    // composer's three-way value exactly. An additive (base-less-means-nothing-known) write
    // would silently keep the rate the peer removed.
    const gbp = { from: 'USD', to: 'GBP', rate: 0.8 };
    const eur = { from: 'USD', to: 'EUR', rate: 0.9 };
    let shared = base();
    shared = Automerge.change(shared, (d) => {
      (d.settings as Record<string, unknown>).exchangeRates = [gbp, eur];
    });
    const baselineHeads = Automerge.getHeads(shared);
    let peer = Automerge.load<Doc>(Automerge.save(shared));
    peer = Automerge.change(peer, (d) => {
      (d.settings as { exchangeRates: unknown[] }).exchangeRates.splice(1, 1);
    });
    const target = compact(shared);

    const built = buildRebaseOps(peer, baselineHeads, target);

    expect(built?.op).toEqual({
      op: 'named',
      name: 'patchSettings',
      args: { patch: { exchangeRates: [gbp] }, deleteKeys: [] },
    });
    const applied = applyMutationOp(
      target as unknown as Parameters<typeof applyMutationOp>[0],
      built!.op as Parameters<typeof applyMutationOp>[1]
    ).doc;
    expect((applied.settings as unknown as { exchangeRates: unknown[] }).exchangeRates).toEqual([
      gbp,
    ]);
  });

  it('takes the compacted lineage, not the peer own', async () => {
    // The whole point: after a rebase this device is ON the new lineage, so the
    // next sync is an ordinary same-lineage merge rather than another block.
    const shared = base();
    const baselineHeads = Automerge.getHeads(shared);
    let peer = Automerge.load<Doc>(Automerge.save(shared));
    peer = Automerge.change(peer, (d) => {
      (d.todos as Coll).mine = { id: 'mine', title: 'offline' };
    });
    const remote = compact(shared);

    ap.loadSnapshot(Automerge.save(peer));
    await ap.mergeRemoteEnvelope(await envelopeFor(remote, key), 'fam', {
      kind: 'baseline',
      heads: baselineHeads,
    });

    const out = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as {
      podLineage: { id: string };
      todos: Coll;
    };
    expect(out.podLineage.id).toBe('L-NEW');
    expect(out.todos.mine?.title).toBe('offline');
  });
});

describe('an explicit choice keeps the work too', () => {
  /**
   * ⚠️ THIS BRANCH HAD ZERO WORKER-LEVEL COVERAGE, and that is how a fix that
   * changed nothing shipped. The POLICY cell was moved to `rebase`, but the
   * `user-file` basis carried NO HEADS, so the rebase was structurally
   * unreachable and every explicit choice fell through to a wholesale adopt —
   * the exact behaviour the change was written to replace. The table asserted
   * one thing and the worker did another, and only a test at THIS level can
   * tell the two apart.
   */
  it('rebases a user-chosen file instead of discarding the offline work', async () => {
    let shared = base();
    shared = Automerge.change(shared, (d) => {
      (d.todos as Coll).shared = { id: 'shared', title: 'from before' };
    });
    const baselineHeads = Automerge.getHeads(shared);
    let peer = Automerge.load<Doc>(Automerge.save(shared));
    peer = Automerge.change(peer, (d) => {
      (d.todos as Coll).mine = { id: 'mine', title: 'made while offline' };
    });

    ap.loadSnapshot(Automerge.save(peer));
    const res = await ap.mergeRemoteEnvelope(await envelopeFor(compact(shared), key), 'fam', {
      kind: 'user-file',
      heads: baselineHeads,
    });

    expect(res.action).toBe('rebased');
    const out = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as { todos: Coll };
    expect(out.todos.mine?.title).toBe('made while offline');
  });

  it('still adopts when the rebase cannot run, because the human said replace', async () => {
    // The one path that must never dead end: they already confirmed "replace
    // what is on this device", so a block would refuse an instruction they gave.
    const shared = base();
    let peer = Automerge.load<Doc>(Automerge.save(shared));
    peer = Automerge.change(peer, (d) => {
      (d.todos as Coll).mine = { id: 'mine', title: 'offline' };
    });

    ap.loadSnapshot(Automerge.save(peer));
    const res = await ap.mergeRemoteEnvelope(await envelopeFor(compact(shared), key), 'fam', {
      kind: 'user-file',
      heads: null, // we cannot prove what Drive held
    });

    expect(res.action).toBe('adopted');
    // ⚠️ AND IT MINTS NOTHING. This adopt lands in the SAME install branch as a
    // restore, so a stamp condition keyed on the branch rather than the verdict
    // would mint here and force the whole fleet to `adopt-remote`. Verified by
    // mutation: minting on the fallback alone survives every other test.
    const doc = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as {
      podLineage?: { id: string; seq: number };
    };
    expect(doc.podLineage).toEqual({ id: 'L-NEW', seq: 1 });
    // ⚠️ AND IT SAYS THE REBASE COULD NOT RUN. Without this the soak cannot tell
    // "the machinery is broken" from "the guard correctly refused"; deleting the
    // flag from the adopted return survived the whole suite.
    expect(res.rebaseUnavailable).toBe(true);
  });
});

describe('every failure loses no more than the block did', () => {
  async function peerAndRemote() {
    const shared = base();
    const baselineHeads = Automerge.getHeads(shared);
    let peer = Automerge.load<Doc>(Automerge.save(shared));
    peer = Automerge.change(peer, (d) => {
      (d.todos as Coll).mine = { id: 'mine', title: 'offline work' };
    });
    return { peer, remote: compact(shared), baselineHeads };
  }

  it('blocks, keeping the document, when the baseline is unknown', async () => {
    const { peer, remote } = await peerAndRemote();
    ap.loadSnapshot(Automerge.save(peer));
    const before = ap.getHeads().heads;

    await expect(
      ap.mergeRemoteEnvelope(await envelopeFor(remote, key), 'fam', {
        kind: 'baseline',
        heads: null, // "we cannot prove what Drive held"
      })
    ).rejects.toBeInstanceOf(PodLineageError);

    // ⚠️ UNTOUCHED. The peer's work is still here, which is the entire promise.
    expect(ap.getHeads().heads).toEqual(before);
    const out = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as { todos: Coll };
    expect(out.todos.mine?.title).toBe('offline work');
  });

  it('blocks when the baseline is not in this document history', async () => {
    const { peer, remote } = await peerAndRemote();
    ap.loadSnapshot(Automerge.save(peer));
    const before = ap.getHeads().heads;

    await expect(
      ap.mergeRemoteEnvelope(await envelopeFor(remote, key), 'fam', {
        kind: 'baseline',
        heads: ['0'.repeat(64)], // a hash this history never saw
      })
    ).rejects.toBeInstanceOf(PodLineageError);

    expect(ap.getHeads().heads).toEqual(before);
  });

  it('blocks when anything in the replay throws, leaving nothing half-applied', async () => {
    // ⚠️ THE ORDERING TEST, and the most important one in this file. The rebase
    // composes and applies BEFORE it installs, so a throw anywhere inside it —
    // the migrate, the compose, the apply — cannot leave the worker holding an
    // adopted-but-un-rebased document with the peer's work silently gone.
    // Getting that order wrong is a defect this tier has committed twice
    // already, and it is invisible without this assertion.
    const { peer, remote, baselineHeads } = await peerAndRemote();
    const envelope = await envelopeFor(remote, key);
    ap.loadSnapshot(Automerge.save(peer));
    const before = ap.getHeads().heads;
    changeHook.throws = new Error('replay exploded');

    await expect(
      ap.mergeRemoteEnvelope(envelope, 'fam', { kind: 'baseline', heads: baselineHeads })
    ).rejects.toBeInstanceOf(PodLineageError);

    changeHook.throws = null;
    expect(ap.getHeads().heads).toEqual(before);
    const out = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as { todos: Coll };
    expect(out.todos.mine?.title).toBe('offline work');
  });
});

describe('a three-way merge, not a two-way diff', () => {
  /**
   * ⚠️ THE COMPACTOR'S CHANGES ARE ALREADY SAVED; THE PEER'S ARE NOT. Reverting
   * saved data to replay unsaved data, silently, is the worst trade this code
   * can make — and a two-way diff does exactly that for any field holding an
   * object or an array.
   */
  function scenario(mutatePeer: (d: Doc) => void, mutateRemote: (d: Doc) => void) {
    let shared = base();
    shared = Automerge.change(shared, (d) => {
      (d.accounts as Coll).a1 = {
        id: 'a1',
        loan: { rate: 1, term: 20 },
        tags: ['home'],
      };
    });
    const baselineHeads = Automerge.getHeads(shared);
    let peer = Automerge.load<Doc>(Automerge.save(shared));
    peer = Automerge.change(peer, mutatePeer as never);
    let remote = compact(shared);
    remote = Automerge.change(remote, mutateRemote as never);
    return { peer, remote, baselineHeads };
  }

  it('does not revert a sibling field the compactor changed', async () => {
    // Peer edits `loan.rate`; compactor edits `loan.term`. A two-way diff
    // replays `{rate, term}` and puts `term` back to 20.
    const { peer, remote, baselineHeads } = scenario(
      (d) => {
        ((d.accounts as Coll).a1!.loan as Record<string, unknown>).rate = 2;
      },
      (d) => {
        ((d.accounts as Coll).a1!.loan as Record<string, unknown>).term = 10;
      }
    );

    ap.loadSnapshot(Automerge.save(peer));
    await ap.mergeRemoteEnvelope(await envelopeFor(remote, key), 'fam', {
      kind: 'baseline',
      heads: baselineHeads,
    });

    const out = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as { accounts: Coll };
    const loan = out.accounts.a1!.loan as Record<string, unknown>;
    expect(loan.rate).toBe(2); // the peer's edit carried across
    expect(loan.term).toBe(10); // the compactor's SAVED edit survived
  });

  it('keeps the saved value when both wrote an array, and counts it', async () => {
    // A list has no mergeable op — the union has no splice — so one whole array
    // wins. It must be the one already in the family file, and the loss must be
    // countable rather than silent.
    const { peer, remote, baselineHeads } = scenario(
      (d) => {
        (d.accounts as Coll).a1!.tags = ['home', 'peer'];
      },
      (d) => {
        (d.accounts as Coll).a1!.tags = ['home', 'compactor'];
      }
    );

    ap.loadSnapshot(Automerge.save(peer));
    const res = await ap.mergeRemoteEnvelope(await envelopeFor(remote, key), 'fam', {
      kind: 'baseline',
      heads: baselineHeads,
    });

    const out = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as { accounts: Coll };
    expect(out.accounts.a1!.tags).toEqual(['home', 'compactor']);
    expect(res.conflicts).toBe(1);
  });

  it('takes the peer value when the compactor left the field alone', async () => {
    const { peer, remote, baselineHeads } = scenario(
      (d) => {
        (d.accounts as Coll).a1!.tags = ['home', 'peer'];
      },
      (d) => {
        (d.accounts as Coll).other = { id: 'other' };
      }
    );

    ap.loadSnapshot(Automerge.save(peer));
    await ap.mergeRemoteEnvelope(await envelopeFor(remote, key), 'fam', {
      kind: 'baseline',
      heads: baselineHeads,
    });

    const out = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as { accounts: Coll };
    expect(out.accounts.a1!.tags).toEqual(['home', 'peer']);
  });
});

describe('an entity with no shared baseline', () => {
  /**
   * ⚠️ THE CASE WITH NO BASELINE TO ATTRIBUTE CHANGES TO. The peer holds an
   * entity its baseline never had, and the compacted target holds one under the
   * SAME id — the peer received it from a third device after its last sync,
   * while the compactor edited its own copy. Nothing can say who changed what.
   *
   * The conservative reading is the only safe one: carry the fields the target
   * does not have, and treat every disagreement as a conflict, because the
   * target's values are already saved to the family file and the peer's are
   * not. Reverting saved data to replay unsaved data is the worst trade this
   * code can make, and it must never be silent.
   *
   * Reachable wherever ids are deterministic rather than minted — the same
   * property that makes `driveConnections` (keyed by email) and
   * `notificationReads` (keyed by member id) collide without shared ancestry.
   */
  function noBaselineScenario() {
    const shared = base();
    const baselineHeads = Automerge.getHeads(shared);

    // The peer learned about `a1` after its baseline, with older values.
    let peer = Automerge.load<Doc>(Automerge.save(shared));
    peer = Automerge.change(peer, (d) => {
      (d.accounts as Coll).a1 = { id: 'a1', nickname: 'PEER-OLD', balance: 10, note: 'peer-only' };
    });

    // The compactor's copy: different values, plus a field only it has.
    let remote = compact(shared);
    remote = Automerge.change(remote, (d) => {
      (d.accounts as Coll).a1 = {
        id: 'a1',
        nickname: 'COMPACTOR-SAVED',
        balance: 99,
        extra: 'saved-only',
      };
    });
    return { peer, remote, baselineHeads };
  }

  it('never overwrites a saved field, and never deletes one', async () => {
    const { peer, remote, baselineHeads } = noBaselineScenario();

    ap.loadSnapshot(Automerge.save(peer));
    const res = await ap.mergeRemoteEnvelope(await envelopeFor(remote, key), 'fam', {
      kind: 'baseline',
      heads: baselineHeads,
    });

    const out = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as { accounts: Coll };
    const a1 = out.accounts.a1!;
    // Both already in the family file — the peer's older copies must not win.
    expect(a1.nickname).toBe('COMPACTOR-SAVED');
    expect(a1.balance).toBe(99);
    // A field only the target has is NOT a peer deletion. There is no baseline
    // in which the peer ever held it, so its absence says nothing.
    expect(a1.extra).toBe('saved-only');
    // A field only the PEER has is safe to carry: nothing saved is at risk.
    expect(a1.note).toBe('peer-only');
    // ⚠️ AND THE LOSS IS COUNTED. Two saved fields disagreed, and a conflict
    // count of 0 here is exactly how this went unnoticed: the telemetry said a
    // clean rebase while the peer's values had overwritten the family's.
    expect(res.conflicts).toBe(2);
  });
});

describe('the guards that only show up in the edge cases', () => {
  it('does not honour a peer delete of a field the compactor changed', async () => {
    // A delete is a write like any other. If the compactor gave the field a new
    // value after compacting, the peer removing it is a two-way conflict, and
    // the saved value has to stand for the same reason as everywhere else.
    let shared = base();
    shared = Automerge.change(shared, (d) => {
      (d.accounts as Coll).a1 = { id: 'a1', nickname: 'old' };
    });
    const baselineHeads = Automerge.getHeads(shared);
    let peer = Automerge.load<Doc>(Automerge.save(shared));
    peer = Automerge.change(peer, (d) => {
      delete (d.accounts as Coll).a1!.nickname;
    });
    let remote = compact(shared);
    remote = Automerge.change(remote, (d) => {
      (d.accounts as Coll).a1!.nickname = 'renamed by the compactor';
    });

    ap.loadSnapshot(Automerge.save(peer));
    await ap.mergeRemoteEnvelope(await envelopeFor(remote, key), 'fam', {
      kind: 'baseline',
      heads: baselineHeads,
    });

    const out = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as { accounts: Coll };
    expect(out.accounts.a1!.nickname).toBe('renamed by the compactor');
  });

  it('refuses an EMPTY baseline rather than treating it as the beginning of time', () => {
    // ⚠️ `decodeHeadsFingerprint('')` legitimately answers `[]`, and
    // `hasHeads(doc, [])` is TRUE. Without the guard the composer would diff
    // from the empty document, call every entity new, and emit a `set` for the
    // peer's WHOLE document over the compacted target — discarding everything
    // the compactor did. It failed safe only by accident before, via a
    // `toPlain` throw on the empty view's absent settings.
    let shared = base();
    shared = Automerge.change(shared, (d) => {
      (d.todos as Coll).t = { id: 't', title: 'x' };
    });
    expect(buildRebaseOps(shared, [], compact(shared))).toBeNull();
  });

  it('survives a document with no settings at all', () => {
    // A pod created before `settings` shipped has the key ABSENT, and
    // `JSON.parse(JSON.stringify(undefined))` throws — which used to escape the
    // composer and cost the peer its entire offline session, not just settings.
    const noSettings = Automerge.from<Doc>({ familyMembers: {}, todos: {}, accounts: {} });
    const baselineHeads = Automerge.getHeads(noSettings);
    let peer = Automerge.load<Doc>(Automerge.save(noSettings));
    peer = Automerge.change(peer, (d) => {
      (d.todos as Coll).mine = { id: 'mine', title: 'offline' };
      // ⚠️ The peer must CHANGE SETTINGS, or the settings path is never reached
      // and this test passes without exercising the throw at all. My first
      // version made exactly that mistake.
      d.settings = { baseCurrency: 'GBP' };
    });

    const built = buildRebaseOps(peer, baselineHeads, compact(noSettings));

    expect(built).not.toBeNull();
    expect(built!.count).toBeGreaterThan(0);
    // Both the todo and the settings survived the absent-singleton path.
    expect(JSON.stringify(built)).toContain('patchSettings');
  });
});

describe('an entity delete is a write like any other', () => {
  /**
   * ⚠️ THE FIELD RULE WAS APPLIED ONE LEVEL TOO LOW. Everything below went
   * wrong in BOTH directions and was counted in neither: a peer deleting an
   * account the compactor had renamed destroyed that saved rename, and a peer
   * editing an account the compactor had deleted brought it back.
   */
  function withAccount(mutatePeer: (d: Doc) => void, mutateRemote: (d: Doc) => void) {
    let shared = base();
    shared = Automerge.change(shared, (d) => {
      (d.accounts as Coll).a1 = { id: 'a1', name: 'original' };
    });
    const baselineHeads = Automerge.getHeads(shared);
    let peer = Automerge.load<Doc>(Automerge.save(shared));
    peer = Automerge.change(peer, mutatePeer as never);
    let remote = compact(shared);
    remote = Automerge.change(remote, mutateRemote as never);
    return { peer, remote, baselineHeads };
  }

  it('does not delete an entity the compactor changed after compacting', async () => {
    const { peer, remote, baselineHeads } = withAccount(
      (d) => {
        delete (d.accounts as Coll).a1;
      },
      (d) => {
        (d.accounts as Coll).a1!.name = 'renamed by the compactor';
      }
    );

    ap.loadSnapshot(Automerge.save(peer));
    const res = await ap.mergeRemoteEnvelope(await envelopeFor(remote, key), 'fam', {
      kind: 'baseline',
      heads: baselineHeads,
    });

    const out = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as { accounts: Coll };
    expect(out.accounts.a1?.name).toBe('renamed by the compactor');
    expect(res.conflicts).toBe(1);
  });

  it('honours a delete the compactor did not contest', async () => {
    const { peer, remote, baselineHeads } = withAccount(
      (d) => {
        delete (d.accounts as Coll).a1;
      },
      (d) => {
        (d.accounts as Coll).other = { id: 'other' };
      }
    );

    ap.loadSnapshot(Automerge.save(peer));
    await ap.mergeRemoteEnvelope(await envelopeFor(remote, key), 'fam', {
      kind: 'baseline',
      heads: baselineHeads,
    });

    const out = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as { accounts: Coll };
    expect(out.accounts.a1).toBeUndefined();
  });

  it('does not resurrect an entity the compactor deleted', async () => {
    const { peer, remote, baselineHeads } = withAccount(
      (d) => {
        (d.accounts as Coll).a1!.name = 'edited offline';
      },
      (d) => {
        delete (d.accounts as Coll).a1;
      }
    );

    ap.loadSnapshot(Automerge.save(peer));
    const res = await ap.mergeRemoteEnvelope(await envelopeFor(remote, key), 'fam', {
      kind: 'baseline',
      heads: baselineHeads,
    });

    const out = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as { accounts: Coll };
    expect(out.accounts.a1).toBeUndefined();
    expect(res.conflicts).toBe(1);
  });

  it('carries a genuinely new entity across', async () => {
    const shared = base();
    const baselineHeads = Automerge.getHeads(shared);
    let peer = Automerge.load<Doc>(Automerge.save(shared));
    peer = Automerge.change(peer, (d) => {
      (d.accounts as Coll).fresh = { id: 'fresh', name: 'made offline' };
    });

    ap.loadSnapshot(Automerge.save(peer));
    await ap.mergeRemoteEnvelope(await envelopeFor(compact(shared), key), 'fam', {
      kind: 'baseline',
      heads: baselineHeads,
    });

    const out = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as { accounts: Coll };
    expect(out.accounts.fresh?.name).toBe('made offline');
  });
});

describe('the conflict count means what it says', () => {
  function fields(mutatePeer: (d: Doc) => void, mutateRemote: (d: Doc) => void) {
    let shared = base();
    shared = Automerge.change(shared, (d) => {
      (d.accounts as Coll).a1 = { id: 'a1', nickname: 'old', tags: ['x'] };
    });
    const baselineHeads = Automerge.getHeads(shared);
    let peer = Automerge.load<Doc>(Automerge.save(shared));
    peer = Automerge.change(peer, mutatePeer as never);
    let remote = compact(shared);
    remote = Automerge.change(remote, mutateRemote as never);
    return buildRebaseOps(peer, baselineHeads, remote);
  }

  it('does not count agreement as a conflict', () => {
    // ⚠️ Two devices writing the SAME value lost nothing. Counting it made
    // `conflicts` measure "fields where the two sides agreed".
    const built = fields(
      (d) => {
        (d.accounts as Coll).a1!.nickname = 'same';
      },
      (d) => {
        (d.accounts as Coll).a1!.nickname = 'same';
      }
    );
    expect(built?.conflicts).toBe(0);
  });

  it('counts a peer delete that lost to a compactor write', () => {
    const built = fields(
      (d) => {
        delete (d.accounts as Coll).a1!.nickname;
      },
      (d) => {
        (d.accounts as Coll).a1!.nickname = 'kept';
      }
    );
    expect(built?.conflicts).toBe(1);
  });

  it('replays a peer field-delete the compactor did not contest', () => {
    // The POSITIVE half of the delete rule, which had no test anywhere — so a
    // regression that silently stopped replaying peer deletes would ship green.
    const built = fields(
      (d) => {
        delete (d.accounts as Coll).a1!.nickname;
      },
      (d) => {
        (d.accounts as Coll).other = { id: 'other' };
      }
    );
    expect(JSON.stringify(built)).toContain('deleteKeys');
    expect(JSON.stringify(built)).toContain('nickname');
  });

  it('emits nothing when a nested conflict is all there is', () => {
    // A conflicts-only recursion used to write the sub-object back to exactly
    // what the target held — inflating the replayed count and moving the heads,
    // which flips `dirty` into a full pod re-encrypt and upload for nothing.
    let shared = base();
    shared = Automerge.change(shared, (d) => {
      (d.accounts as Coll).a1 = { id: 'a1', loan: { schedule: [1] } };
    });
    const baselineHeads = Automerge.getHeads(shared);
    let peer = Automerge.load<Doc>(Automerge.save(shared));
    peer = Automerge.change(peer, (d) => {
      ((d.accounts as Coll).a1!.loan as Record<string, unknown>).schedule = [2];
    });
    let remote = compact(shared);
    remote = Automerge.change(remote, (d) => {
      ((d.accounts as Coll).a1!.loan as Record<string, unknown>).schedule = [3];
    });

    const built = buildRebaseOps(peer, baselineHeads, remote);

    expect(built?.op).toBeNull();
    expect(built?.count).toBe(0);
    expect(built?.conflicts).toBe(1);
  });
});

describe('the composer cannot corrupt the lineage it lands on', () => {
  it('never emits an op that writes podLineage', async () => {
    // ⚠️ Structural: `MutationOp`'s `collection` is typed `CollectionName`,
    // which excludes the singletons, and the only op it emits that writes one is
    // `named:patchSettings`, which writes `settings` and nothing else. Worth a test anyway — an op stamping the OLD lineage
    // onto the NEW document is self-inflicted corruption with no external cause.
    const shared = base();
    const baselineHeads = Automerge.getHeads(shared);
    let peer = Automerge.load<Doc>(Automerge.save(shared));
    peer = Automerge.change(peer, (d) => {
      d.podLineage = { id: 'L-OLD', seq: 1 };
      (d.todos as Coll).mine = { id: 'mine', title: 'work' };
    });

    const built = buildRebaseOps(peer, baselineHeads, compact(shared));

    expect(built).not.toBeNull();
    expect(JSON.stringify(built)).not.toContain('podLineage');
    expect(JSON.stringify(built)).not.toContain('L-OLD');
  });

  it('refuses outright when the baseline is not in this history', () => {
    // ⚠️ THE COMPOSER'S OWN GUARD. "What changed since the baseline" has no
    // meaning if this document never contained that baseline, and the answer
    // must be "cannot compose" rather than a diff against something arbitrary.
    // Covered here at the unit level because the worker-level test passes
    // either way — `Automerge.view` happens to throw, so the outer try catches
    // it — which would let the guard be deleted silently.
    const shared = base();
    expect(buildRebaseOps(shared, ['0'.repeat(64)], compact(shared))).toBeNull();
  });

  it('emits PLAIN payloads, never Automerge proxies', () => {
    // ⚠️ Reading out of a document yields a PROXY. Assigning one into another
    // document's draft is not supported, and the op also crosses a
    // `postMessage` boundary on some paths, where a proxy is not cloneable.
    const shared = base();
    const baselineHeads = Automerge.getHeads(shared);
    let peer = Automerge.load<Doc>(Automerge.save(shared));
    peer = Automerge.change(peer, (d) => {
      (d.todos as Coll).mine = { id: 'mine', title: 'work', tags: ['a', 'b'] };
    });

    const built = buildRebaseOps(peer, baselineHeads, compact(shared));

    expect(built?.op).toBeTruthy();
    // A proxy throws here; a plain object does not.
    expect(() => structuredClone(built!.op)).not.toThrow();
  });

  it('reports nothing to replay when the peer is level with its baseline', async () => {
    const shared = base();
    const built = buildRebaseOps(shared, Automerge.getHeads(shared), compact(shared));
    expect(built).toEqual({
      op: null,
      count: 0,
      conflicts: 0,
      counterCarries: 0,
      carrySkipped: 0,
      rebaseMode: 'ledger',
      fresh: false,
    });
  });
});

describe('a restore is a lineage event', () => {
  /**
   * The pre-compaction safety copy has NO lineage; the device restoring it
   * holds the compacted one (seq 1). Adopting it as-is would leave the device
   * on the old lineage, and every peer still on seq 1 would read `ours-newer`
   * and republish over the restore within one poll.
   */
  function lineageOf() {
    return (Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as { podLineage?: unknown })
      .podLineage as { id: string; seq: number; restoreSeq?: number } | undefined;
  }

  it('mints a NEW generation on a user-file adopt of an OLDER lineage, and marks it dirty to publish', async () => {
    const original = base();
    const compacted = compact(original, 'L-1');
    ap.loadSnapshot(Automerge.save(compacted));
    const res = await ap.mergeRemoteEnvelope(await envelopeFor(original, key), 'fam', {
      kind: 'user-file',
      heads: Automerge.getHeads(compacted),
    });
    expect(res.action).toBe('adopted');
    const after = lineageOf();
    expect(after?.seq).toBe(2);
    expect(after?.id).not.toBe('L-1');
    // #117 writer flip: the restore generation records itself, so a pre-restore peer takes the
    // baseline rule for its Counter growth.
    expect(after?.restoreSeq).toBe(2);
    // The stamp moved the heads past the file's, so the caller publishes it.
    expect(res.dirty).toBe(true);
    // And every later compaction carries it forward.
    ap.compactDoc();
    expect(lineageOf()).toMatchObject({ seq: 3, restoreSeq: 2 });
  });

  it('is what makes a peer ADOPT the restore instead of reverting it', async () => {
    // Device A restored (above): its document is the original data at seq 2.
    const original = base();
    const restored = Automerge.change(compact(original, 'L-1'), (d) => {
      (d as { podLineage: unknown }).podLineage = { id: 'L-2', seq: 2 };
    });
    // Device B still holds the compacted seq-1 document, clean.
    const b = compact(original, 'L-1');
    ap.loadSnapshot(Automerge.save(b));
    const res = await ap.mergeRemoteEnvelope(await envelopeFor(restored, key), 'fam', {
      kind: 'baseline',
      heads: Automerge.getHeads(b),
    });
    // `adopted` when B is clean, `rebased` when the fixture's migration made
    // it read as dirty; either way B lands on the restore's generation. The
    // failure this pins is `kept-local`: B keeping seq 1 and republishing it.
    expect(res.action).not.toBe('kept-local');
    expect(lineageOf()).toEqual({ id: 'L-2', seq: 2 });
  });

  it('mints NOTHING when a user-file choice takes a NEWER file over a stale local document', async () => {
    // `adopt-remote x user-file` is the rebase (or its adopt fallback), not a
    // restore: the file already carries the newest generation.
    const original = base();
    ap.loadSnapshot(Automerge.save(original));
    const res = await ap.mergeRemoteEnvelope(
      await envelopeFor(compact(original, 'L-1'), key),
      'fam',
      {
        kind: 'user-file',
        heads: Automerge.getHeads(original),
      }
    );
    expect(['adopted', 'rebased']).toContain(res.action);
    expect(lineageOf()).toEqual({ id: 'L-1', seq: 1 });
    // The `user-file` rebase FALLBACK is the sibling case, and it is pinned
    // where it belongs: "still adopts when the rebase cannot run" above, which
    // now also asserts the lineage is untouched. Both share the `adopt-remote`
    // verdict, which is what `stampNewGeneration` keys on.
  });

  it('mints NOTHING when a human resolves a CONFLICT by choosing one of two compactions', async () => {
    const original = base();
    ap.loadSnapshot(Automerge.save(compact(original, 'L-mine')));
    const res = await ap.mergeRemoteEnvelope(
      await envelopeFor(compact(original, 'L-theirs'), key),
      'fam',
      {
        kind: 'user-file',
        heads: Automerge.getHeads(compact(original, 'L-mine')),
      }
    );
    expect(res.action).toBe('adopted');
    expect(lineageOf()).toEqual({ id: 'L-theirs', seq: 1 });
  });

  it('mints NOTHING on a first-load adopt with no local document', async () => {
    // A fresh device joining must not churn the fleet.
    const original = base();
    ap.reset();
    ap.configure({ pushChunk() {}, perf() {}, cachePersistFailed() {}, cacheReleased() {} });
    ap.setKey(key);
    const res = await ap.mergeRemoteEnvelope(await envelopeFor(original, key), 'fam', {
      kind: 'no-local-document',
    });
    expect(res.action).toBe('adopted');
    expect(lineageOf()).toBeUndefined();
  });
});

describe('the rollback route must never dead-end', () => {
  it('adopts a legacy remote when the rebase cannot compose, instead of throwing', async () => {
    // ⚠️ THIS THREW `RangeError: Attempting to change an outdated document` and
    // rejected the whole merge. `rebaseOntoRemote` migrated `remote` itself; on a
    // remote that predates a collection that migrate emits a real
    // `Automerge.change`, marking the handle outdated. When `buildRebaseOps` then
    // answered `null` (here: an EMPTY baseline, which means "unknown", not "the
    // beginning of time"), the wholesale-install branch migrated the SAME handle
    // again and threw. `doSave` classified it as a blocker and refused, so a human
    // who had just hand-picked their pre-compaction .beanpod had no way forward —
    // on the one path the policy calls "the only exit there is".
    //
    // The migrate is now memoised per merge, so both sites share one call.
    ap.loadSnapshot(Automerge.save(base()));
    // A compacted remote MISSING collections, so `migrateDoc` genuinely changes it.
    const remote = Automerge.from<Doc>({ todos: {}, podLineage: { id: 'L-NEW', seq: 1 } });

    const res = await ap.mergeRemoteEnvelope(await envelopeFor(remote, key), 'fam', {
      kind: 'user-file',
      heads: [],
    });

    expect(res.action).toBe('adopted');
    expect(res.rebaseUnavailable).toBe(true);
    // The human's chosen file landed, and the migration ran exactly once.
    const doc = Automerge.toJS(Automerge.load(ap.exportSnapshot().binary)) as Doc;
    expect(doc.podLineage).toEqual({ id: 'L-NEW', seq: 1 });
    expect(doc.accounts).toEqual({});
  });
});

// ─── #117 Phase 2: Counters cross the lineage through the fold ledger ─────────

describe('Counter adjustments ride the fold ledger, not the baseline (#117 Phase 2)', () => {
  type FDoc = Parameters<typeof foldDoc>[0];
  type Op = Parameters<typeof applyMutationOp>[1];

  const ACCOUNT = { id: 'A', name: 'Everyday', type: 'checking', balance: 100 };
  const setAccount = (entity: Record<string, unknown> & { id: string }): Op => ({
    op: 'set',
    collection: 'accounts',
    id: entity.id,
    entity,
  });
  /** As production sends it (`transactionRepository`, `accountsStore`): stamped. Every
   *  adjustment moves `updatedAt`, which is exactly what made it a false conflict (C9d). */
  let stampSeq = 0;
  const inc = (delta: number, id = 'A'): Op => ({
    op: 'increment',
    collection: 'accounts',
    id,
    field: 'balance',
    delta,
    updatedAt: `2026-10-03T00:00:${String(stampSeq++ % 60).padStart(2, '0')}.000Z`,
  });
  /** The modal's "set balance to X": a based patch in folded space. */
  const setBalanceTo = (value: number, base: number): Op => ({
    op: 'patch',
    collection: 'accounts',
    id: 'A',
    patch: { balance: value },
    base: { balance: base },
  });
  const apply = (doc: FDoc, ...ops: Op[]): FDoc =>
    ops.reduce((d, op) => applyMutationOp(d, op).doc, doc);
  /** What main shows: the folded projection. */
  const balanceOf = (doc: FDoc, id = 'A') =>
    (
      materializeCollection(doc, 'accounts', foldIndex(doc)).find(([k]) => k === id)![1] as {
        balance: number;
      }
    ).balance;
  const shared = () => seeded([setAccount(ACCOUNT)]);
  /** The ledger's values (minor units), whichever entry shape holds them. */
  const ledgerOf = (doc: FDoc) =>
    Object.fromEntries(
      Object.entries(Automerge.toJS(doc).foldedCounters ?? {}).map(([k, e]) => [
        k,
        typeof e === 'number' ? e : e.v,
      ])
    );
  const actorOf = (doc: FDoc) => Automerge.getActorId(doc);
  /** A carry register's name for writer `writer` put on generation `seq`. */
  const carryName = (writer: string, seq: number, id = 'A') =>
    `accounts/${id}/balance@2/carry.${writer}.${seq}`;
  /** The carry registers a document holds live (plain integers). */
  const registers = (doc: FDoc) =>
    Object.fromEntries(
      Object.entries(Automerge.toJS(doc).counterDeltas as Record<string, unknown>).filter(([k]) =>
        k.includes('/carry.')
      )
    );
  const withLineage = (doc: FDoc, lineage: Record<string, unknown>): FDoc =>
    Automerge.change(doc, (d) => {
      (d as unknown as { podLineage: unknown }).podLineage = lineage;
    });
  const opsOf = (op: Op | null | undefined): Op[] =>
    op == null ? [] : op.op === 'batch' ? op.ops : [op];

  // Every handle is its own writer (the actor alone, #117 writer flip): no device registry.
  beforeEach(() => setCounterWrites(true));
  afterEach(() => setCounterWrites(null));

  it('carries an unsynced adjustment as ONE exact carry register, and the touched entity as nothing else', () => {
    const origin = shared();
    const baseline = Automerge.getHeads(origin);
    const peer = apply(Automerge.clone(origin), inc(-20.25));
    const target = compact(origin);

    const built = buildRebaseOpsRaw(peer, baseline, target)!;
    // ⚠️ ONE op: the account is touched only through its Counter key, so the entity loop finds
    // no field difference and emits no patch. The adjustment is the Counter pass's alone, as a
    // put-only register named for the key's actor and the TARGET's generation.
    expect(built.op).toEqual({
      op: 'carry',
      collection: 'accounts',
      id: 'A',
      name: carryName(actorOf(peer), 1),
      minor: -2025,
      exact: true,
    });
    expect(built).toMatchObject({
      count: 1,
      conflicts: 0,
      counterCarries: 1,
      carrySkipped: 0,
      rebaseMode: 'ledger',
    });
    const out = applyMutationOp(target, built.op as Op).doc;
    expect(balanceOf(out)).toBe(79.75);
    expect(registers(out)).toEqual({ [carryName(actorOf(peer), 1)]: -2025 });
  });

  it('carries NOTHING for an adjustment the compaction already folded, even from a stale baseline', () => {
    // The baseline predates the adjustment, but Drive got it and the compactor folded it. A
    // baseline view would call it unsynced and double-count; the ledger knows better.
    const origin = shared();
    const staleBaseline = Automerge.getHeads(origin);
    const peer = apply(Automerge.clone(origin), inc(-20.25));
    const target = compact(Automerge.clone(peer));
    expect(Object.values(ledgerOf(target))).toEqual([-2025]);
    expect(balanceOf(target)).toBe(79.75);

    expect(buildRebaseOpsRaw(peer, staleBaseline, target)).toEqual({
      op: null,
      count: 0,
      conflicts: 0,
      counterCarries: 0,
      carrySkipped: 0,
      rebaseMode: 'ledger',
      fresh: false,
    });

    // And only the growth since the fold, once the peer adjusts again on its own key.
    const later = apply(peer, inc(-5));
    const built = buildRebaseOpsRaw(later, staleBaseline, target)!;
    expect(built.op).toMatchObject({ op: 'carry', minor: -500, exact: true });
    expect(balanceOf(applyMutationOp(target, built.op as Op).doc)).toBe(74.75);
  });

  it('a peer TWO compactions behind carries only the growth since the compaction that folded its key', () => {
    const origin = shared();
    const synced = apply(Automerge.clone(origin), inc(-10)); // the peer's -10 reached Drive
    const baseline = Automerge.getHeads(synced);
    // Generation 1 folds the peer's key; the family adjusts on it; generation 2 folds that too.
    const gen1 = apply(compact(Automerge.clone(synced), 'L-1'), inc(-1));
    const gen2 = compact(gen1, 'L-2');
    // Within the window, generation 2's ledger still holds generation 1's fold. Dropped, the
    // peer below would carry its whole -15 (reading 74).
    expect(Object.values(ledgerOf(gen2)).sort((x, y) => x - y)).toEqual([-1000, -100]);

    const peer = apply(synced, inc(-5)); // still on generation 0, offline
    const built = buildRebaseOpsRaw(peer, baseline, gen2)!;
    expect(built.op).toMatchObject({ op: 'carry', minor: -500, name: carryName(actorOf(peer), 2) });
    expect(built.counterCarries).toBe(1);
    expect(balanceOf(applyMutationOp(gen2, built.op as Op).doc)).toBe(84);
  });

  it('carries a new entity by its RAW set, then its register on top', () => {
    const origin = shared();
    const baseline = Automerge.getHeads(origin);
    const peer = apply(
      Automerge.clone(origin),
      setAccount({ id: 'B', name: 'New', type: 'savings', balance: 50 }),
      inc(-20, 'B')
    );
    const target = compact(origin);

    const built = buildRebaseOpsRaw(peer, baseline, target)!;
    const ops = opsOf(built.op);
    // Raw space: the `set` carries the stored absolute (50), never the folded 30, or the
    // register after it would count the -20 twice. Ordered set-then-carry, so the carry finds
    // the entity.
    expect(ops.map((o) => o.op)).toEqual(['set', 'carry']);
    expect((ops[0] as { entity: { balance: number } }).entity.balance).toBe(50);
    expect(ops[1]).toMatchObject({ id: 'B', minor: -2000 });
    expect(built).toMatchObject({ count: 2, counterCarries: 1 });
    expect(balanceOf(applyMutationOp(target, built.op as Op).doc, 'B')).toBe(30);
  });

  it('reads the LIVE key when the target still holds it (an old-build compaction: toJS/from, no fold)', () => {
    const origin = shared();
    const synced = apply(Automerge.clone(origin), inc(-10));
    const baseline = Automerge.getHeads(synced);
    // The pre-fold build's compaction carries the map through as live Counters, no ledger.
    const oldBuild = Automerge.from({
      ...Automerge.toJS(Automerge.clone(synced)),
      podLineage: { id: 'L-OLD', seq: 1 },
    }) as FDoc;
    expect(Object.keys(oldBuild.counterDeltas)).toHaveLength(1);
    expect(oldBuild.foldedCounters).toBeUndefined();

    const peer = apply(synced, inc(-5));
    const built = buildRebaseOpsRaw(peer, baseline, oldBuild)!;
    expect(built.op).toMatchObject({ op: 'carry', minor: -500 });
    // The live -10 plus the register for the -5.
    expect(balanceOf(applyMutationOp(oldBuild, built.op as Op).doc)).toBe(85);
  });

  describe('a foreign key: carried with its sign decided by freshness, never by ownership', () => {
    /**
     * B's key reaches L at 8 through a merge L's baseline covers. B adds +2 and saves; C
     * compacts (ledger K_B = 10). L, still holding K_B = 8 plus one unsynced edit, rebases.
     * `8 − 10` is -2: a foreign NEGATIVE from a peer that does not hold the compactor's view,
     * so it may be a stale copy (here it is): skipped and counted, never carried.
     */
    function scenario() {
      const origin = shared();
      const b = apply(Automerge.clone(origin), inc(8)); // K_B = 800
      const l = Automerge.merge(Automerge.clone(origin), Automerge.clone(b));
      const baseline = Automerge.getHeads(l);
      const b2 = apply(b, inc(2)); // K_B = 1000, saved to Drive
      return { l, baseline, b2 };
    }
    const folded = (b2: FDoc) => compact(Automerge.clone(b2), 'L-NEW', { fromHeads: true });
    /** An old-build compaction: toJS/from, so the target still holds K_B LIVE at 1000. */
    const oldBuild = (b2: FDoc) =>
      Automerge.from({
        ...Automerge.toJS(Automerge.clone(b2)),
        podLineage: { id: 'L-OLD', seq: 1 },
      }) as FDoc;

    it.each([
      ['a folded target (ledger K_B = 1000)', folded],
      ['an old-build target (live K_B = 1000)', oldBuild],
    ] as const)('%s: the stale -2 on K_B is skipped and counted', (_name, shape) => {
      const { l, baseline, b2 } = scenario();
      const target = shape(b2);
      expect(balanceOf(target)).toBe(110);

      // The unsynced edit is not an adjustment; K_B's stale negative is counted, not carried.
      const edited = apply(
        Automerge.clone(l),
        setAccount({ id: 'C', name: 'New', type: 'savings', balance: 5 })
      );
      const built = buildRebaseOpsRaw(edited, baseline, target)!;
      expect(built).toMatchObject({ count: 1, counterCarries: 0, carrySkipped: 1, fresh: false });
      expect(built.op).toMatchObject({ op: 'set', id: 'C' });
      expect(balanceOf(applyMutationOp(Automerge.clone(target), built.op as Op).doc)).toBe(110);

      // An own unsynced adjustment still crosses, and ONLY it: -5, never -5 + (-2).
      const adjusted = apply(Automerge.clone(l), inc(-5));
      const own = buildRebaseOpsRaw(adjusted, baseline, target)!;
      expect(own.op).toEqual({
        op: 'carry',
        collection: 'accounts',
        id: 'A',
        name: carryName(actorOf(adjusted), 1),
        minor: -500,
        exact: true,
      });
      expect(own).toMatchObject({ counterCarries: 1, carrySkipped: 1 });
      expect(balanceOf(applyMutationOp(target, own.op as Op).doc)).toBe(105);
    });

    it('a foreign key changed since a STALE baseline is never carried as a negative while behind', () => {
      const origin = shared();
      const staleBaseline = Automerge.getHeads(origin);
      const b = apply(Automerge.clone(origin), inc(8));
      const l = Automerge.merge(Automerge.clone(origin), Automerge.clone(b));
      const target = compact(Automerge.clone(apply(b, inc(2)))); // ledger K_B = 1000
      expect(balanceOf(target)).toBe(110);

      expect(buildRebaseOpsRaw(l, staleBaseline, target)).toEqual({
        op: null,
        count: 0,
        conflicts: 0,
        counterCarries: 0,
        carrySkipped: 1,
        rebaseMode: 'ledger',
        fresh: false,
      });
    });

    it('a FRESH peer (holds every fromHeads change) carries a foreign reversal exactly; a behind one skips it; an own negative crosses either way', () => {
      const origin = shared();
      const baseline = Automerge.getHeads(origin);
      const b1 = apply(Automerge.clone(origin), inc(10)); // K_B = 1000
      const c = Automerge.merge(Automerge.clone(origin), Automerge.clone(b1)); // the compactor
      const withProof = compact(c, 'L-NEW', { fromHeads: true }); // ledger K_B = 1000
      const noProof = compact(c);
      const b2 = apply(b1, inc(-3)); // B reverses 3 after the compactor's snapshot
      const l = Automerge.merge(Automerge.clone(origin), Automerge.clone(b2)); // holds all c had

      const fresh = buildRebaseOpsRaw(l, baseline, withProof)!;
      expect(fresh).toMatchObject({ fresh: true, counterCarries: 1, carrySkipped: 0 });
      expect(fresh.op).toEqual({
        op: 'carry',
        collection: 'accounts',
        id: 'A',
        name: carryName(actorOf(b1), 1),
        minor: -300,
        exact: false,
      });
      expect(balanceOf(applyMutationOp(Automerge.clone(withProof), fresh.op as Op).doc)).toBe(107);

      // Without the proof the same negative may be a stale copy: positives only, counted.
      expect(buildRebaseOpsRaw(l, baseline, noProof)).toMatchObject({
        op: null,
        fresh: false,
        carrySkipped: 1,
      });

      // An OWN negative is exact whether or not the peer is fresh.
      const own = apply(Automerge.clone(l), inc(-1));
      for (const t of [withProof, noProof]) {
        expect(opsOf(buildRebaseOpsRaw(own, baseline, t)!.op)).toContainEqual({
          op: 'carry',
          collection: 'accounts',
          id: 'A',
          name: carryName(actorOf(own), 1),
          minor: -100,
          exact: true,
        });
      }
    });
  });

  it('an OWN key that nets back to its baseline value after an intermediate sync still carries (mine - ledger)', () => {
    // Own K = -10 at the baseline; +5 reached Drive and C folded it (ledger -5); then -5
    // offline brings K back to -10, its value AT the baseline. The old "unchanged since the
    // baseline" skip dropped that -5; growth against the ledger reads -10 - (-5) = -5.
    const origin = shared();
    const l = apply(Automerge.clone(origin), inc(-10));
    const baseline = Automerge.getHeads(l);
    const synced = apply(l, inc(5));
    const target = compact(Automerge.clone(synced));
    expect(Object.values(ledgerOf(target))).toEqual([-500]);
    expect(balanceOf(target)).toBe(95);

    const offline = apply(synced, inc(-5));
    const built = buildRebaseOpsRaw(offline, baseline, target)!;
    expect(built.op).toEqual({
      op: 'carry',
      collection: 'accounts',
      id: 'A',
      name: carryName(actorOf(offline), 1),
      minor: -500,
      exact: true,
    });
    expect(balanceOf(applyMutationOp(target, built.op as Op).doc)).toBe(90);
  });

  describe('two tabs of one device: one register per key, own overwrites, foreign fills', () => {
    /**
     * Tab 1 (actor X1) adjusts +1, tab 2 merges it (its K1 copy stays at +1) and adjusts +2 on
     * its own K2; tab 1 then adjusts +4 more (K1 = +5) and never sees K2. Both are dirty on the
     * old lineage when one compaction lands. Today's ownership model double-counted here.
     */
    function tabs() {
      const origin = shared();
      const baseline = Automerge.getHeads(origin);
      const tab1a = apply(Automerge.clone(origin), inc(1));
      const tab2 = apply(Automerge.merge(Automerge.clone(origin), Automerge.clone(tab1a)), inc(2));
      const tab1 = apply(tab1a, inc(4));
      return { baseline, tab1, tab2, target: compact(origin) };
    }
    const rebaseOnto = (local: FDoc, baseline: string[], target: FDoc) => {
      const built = buildRebaseOpsRaw(local, baseline, target)!;
      const applied = applyMutationOp(Automerge.clone(target), built.op as Op);
      return { built, doc: applied.doc, superseded: applied.carrySuperseded };
    };

    it('tab 1 then tab 2 (tab 2 merged tab 1 first): the foreign copy is superseded, the fold is each own view', () => {
      const { baseline, tab1, tab2, target } = tabs();
      const [x1, x2] = [actorOf(tab1), actorOf(tab2)];
      const first = rebaseOnto(tab1, baseline, target);
      expect(first.built.op).toMatchObject({ name: carryName(x1, 1), minor: 500, exact: true });
      const second = rebaseOnto(tab2, baseline, first.doc);
      expect(second.built.counterCarries).toBe(2);
      expect(second.superseded).toBe(1); // tab 2's stale K1 copy met tab 1's register
      expect(registers(second.doc)).toEqual({ [carryName(x1, 1)]: 500, [carryName(x2, 1)]: 200 });
      expect(balanceOf(second.doc)).toBe(107);
      expect(counterStats(second.doc)).toMatchObject({ conflicts: 0, carryConflicts: 0 });
    });

    it('tab 2 then tab 1: the stale foreign copy fills first, then the own actor overwrites it', () => {
      const { baseline, tab1, tab2, target } = tabs();
      const [x1, x2] = [actorOf(tab1), actorOf(tab2)];
      const first = rebaseOnto(tab2, baseline, target);
      expect(registers(first.doc)).toEqual({ [carryName(x1, 1)]: 100, [carryName(x2, 1)]: 200 });
      const second = rebaseOnto(tab1, baseline, first.doc);
      expect(second.superseded).toBe(0);
      expect(registers(second.doc)).toEqual({ [carryName(x1, 1)]: 500, [carryName(x2, 1)]: 200 });
      expect(balanceOf(second.doc)).toBe(107);
    });

    it('CONCURRENT (neither merged the other): one register, never two, counted as a carry conflict', () => {
      const { baseline, tab1, tab2, target } = tabs();
      const a = rebaseOnto(tab1, baseline, target).doc;
      const b = rebaseOnto(tab2, baseline, target).doc;
      const ab = Automerge.merge(Automerge.clone(a), Automerge.clone(b));
      const ba = Automerge.merge(Automerge.clone(b), Automerge.clone(a));
      expect(Object.keys(registers(ab))).toHaveLength(2); // one name per key
      expect(counterStats(ab)).toMatchObject({ conflicts: 0, carryConflicts: 1 });
      // Automerge's deterministic pick: one of the two views (own +5 or tab 2's stale +1),
      // the same on both sides, and never their sum.
      expect([107, 103]).toContain(balanceOf(ab));
      expect(balanceOf(ba)).toBe(balanceOf(ab));
    });
  });

  it("a reload (new actor) carries the old actor's positive growth; its negative only when fresh", () => {
    const origin = shared();
    const baseline = Automerge.getHeads(origin);
    const wrote = apply(Automerge.clone(origin), inc(3));
    const reloaded = Automerge.load(Automerge.save(wrote)) as FDoc;
    expect(actorOf(reloaded)).not.toBe(actorOf(wrote));
    expect(buildRebaseOpsRaw(reloaded, baseline, compact(origin))!.op).toEqual({
      op: 'carry',
      collection: 'accounts',
      id: 'A',
      name: carryName(actorOf(wrote), 1),
      minor: 300,
      exact: false, // foreign to the reloaded session, carried anyway: nobody owns a key
    });

    const reversed = Automerge.load(
      Automerge.save(apply(Automerge.clone(origin), inc(-3)))
    ) as FDoc;
    expect(buildRebaseOpsRaw(reversed, baseline, compact(origin))).toMatchObject({
      op: null,
      counterCarries: 0,
      carrySkipped: 1,
      fresh: false,
    });
    const fresh = buildRebaseOpsRaw(
      reversed,
      baseline,
      compact(origin, 'L-NEW', { fromHeads: true })
    )!;
    expect(fresh).toMatchObject({ counterCarries: 1, carrySkipped: 0, fresh: true });
    expect(fresh.op).toMatchObject({ op: 'carry', minor: -300, exact: false });
  });

  it('three generations: a carry folded at T+1 is subtracted from its own session (fold = its view); one folded before a peer generation is not', () => {
    const origin = shared();
    const baseline = Automerge.getHeads(origin);
    const s8 = apply(Automerge.clone(origin), inc(8)); // session S (actor X): K = 800
    const x = actorOf(s8);
    const d = Automerge.clone(s8); // compactor D holds 8
    const s9 = apply(s8, inc(1));
    const b = Automerge.merge(Automerge.clone(origin), Automerge.clone(s9)); // B holds X's K at 9
    const s10 = apply(s9, inc(1)); // S's own view: 10

    const t1 = compact(d, 'L-1', { fromHeads: true }); // ledger K = 800
    const fromB = buildRebaseOpsRaw(b, baseline, t1)!;
    expect(fromB.op).toEqual({
      op: 'carry',
      collection: 'accounts',
      id: 'A',
      name: carryName(x, 1),
      minor: 100,
      exact: false,
    });
    const t2 = compact(applyMutationOp(t1, fromB.op as Op).doc, 'L-2');
    expect(Automerge.toJS(t2).foldedCounters).toEqual({
      [`accounts/A/balance@2/${x}`]: { v: 800, s: 1 },
      [carryName(x, 1)]: { v: 100, s: 2 },
    });

    // Per canonical key S knows 800 + 100 = 900 of its 1000: it carries 100, never 200.
    const fromS = buildRebaseOpsRaw(s10, baseline, t2)!;
    expect(fromS.op).toEqual({
      op: 'carry',
      collection: 'accounts',
      id: 'A',
      name: carryName(x, 2),
      minor: 100,
      exact: true,
    });
    const t2s = applyMutationOp(t2, fromS.op as Op).doc;
    expect(balanceOf(t2s)).toBe(110); // S's own view, never 111

    // Two generations' registers never collide in the ledger: distinct names, both kept.
    const next = foldDoc(t2s, 3);
    expect(next.ledger.collisions).toBe(0);
    expect(Object.keys(next.foldedCounters!)).toEqual(
      expect.arrayContaining([carryName(x, 1), carryName(x, 2)])
    );

    // A peer on T+1 holding the T+1 register live, fresh against T+2: `carry.X.1` was folded
    // BEFORE its generation, so it is not subtracted (it would read a phantom -100).
    const q = Automerge.clone(t2s);
    const t3 = compact(Automerge.clone(t2s), 'L-3', { fromHeads: true });
    expect(buildRebaseOpsRaw(q, Automerge.getHeads(t2s), t3)).toMatchObject({
      op: null,
      counterCarries: 0,
      carrySkipped: 0,
      fresh: true,
    });
  });

  describe('restore-aware growth (plan Requirement 6)', () => {
    /**
     * S (actor X) adjusts +6 (the file later restored), then +4 (synced: E's baseline sees 10),
     * then +2, which E merged but never synced. The user restores the +6 file: generation 2,
     * `restoreSeq: 2`, with X's K LIVE at 600. E is on generation 1.
     */
    function restoreScenario() {
      const origin = shared();
      const s6 = apply(Automerge.clone(origin), inc(6));
      const x = actorOf(s6);
      const file = Automerge.clone(s6);
      const s10 = apply(s6, inc(4));
      const e0 = withLineage(Automerge.merge(Automerge.clone(origin), Automerge.clone(s10)), {
        id: 'L-1',
        seq: 1,
      });
      const eBaseline = Automerge.getHeads(e0);
      const s12 = apply(s10, inc(2));
      const e = Automerge.merge(Automerge.clone(e0), Automerge.clone(s12));
      const restored = withLineage(file, { id: 'L-R', seq: 2, restoreSeq: 2 });
      return { x, e, eBaseline, restored };
    }

    it('a peer from before the restore carries only local − baseline (rolled-back amounts stay rolled back)', () => {
      const { x, e, eBaseline, restored } = restoreScenario();
      const built = buildRebaseOpsRaw(e, eBaseline, restored)!;
      expect(built).toMatchObject({ rebaseMode: 'baseline', counterCarries: 1 });
      // The ledger rule would read 1200 − 600 and re-apply the restore's rolled-back +4.
      expect(built.op).toEqual({
        op: 'carry',
        collection: 'accounts',
        id: 'A',
        name: carryName(x, 2),
        minor: 200,
        exact: false,
      });
      expect(balanceOf(applyMutationOp(restored, built.op as Op).doc)).toBe(108);
    });

    it('a later compaction keeps restoreSeq, and that peer still takes the baseline rule', () => {
      const { x, e, eBaseline, restored } = restoreScenario();
      const t3 = compact(restored, 'L-3');
      expect(Automerge.toJS(t3).podLineage).toMatchObject({ seq: 3, restoreSeq: 2 });
      const built = buildRebaseOpsRaw(e, eBaseline, t3)!;
      expect(built.rebaseMode).toBe('baseline');
      expect(built.op).toMatchObject({ name: carryName(x, 3), minor: 200 });
      expect(balanceOf(applyMutationOp(t3, built.op as Op).doc)).toBe(108);
    });

    it('two live names on the restore generation: a fresh peer holding both computes ZERO growth at R+1', () => {
      const { e, eBaseline, restored } = restoreScenario();
      const built = buildRebaseOpsRaw(e, eBaseline, restored)!;
      const f = applyMutationOp(restored, built.op as Op).doc; // K = 600 live beside carry.X.2 = 200
      expect(Object.keys(f.counterDeltas)).toHaveLength(2);
      const peer = Automerge.clone(f);
      const next = compact(Automerge.clone(f), 'L-3', { fromHeads: true });
      expect(balanceOf(next)).toBe(108);
      expect(buildRebaseOpsRaw(peer, Automerge.getHeads(f), next)).toMatchObject({
        op: null,
        counterCarries: 0,
        carrySkipped: 0,
        rebaseMode: 'ledger',
        fresh: true,
      });
    });

    it('baseline mode is never window-blocked', () => {
      const { e, eBaseline, restored } = restoreScenario();
      const far = withLineage(compact(restored, 'L-far'), {
        id: 'L-far',
        seq: 1 + LEDGER_WINDOW + 5,
        restoreSeq: 1 + LEDGER_WINDOW + 5,
      });
      const built = buildRebaseOpsRaw(e, eBaseline, far)!;
      expect(built.blockedBy).toBeUndefined();
      expect(built).toMatchObject({ rebaseMode: 'baseline', counterCarries: 1 });
    });
  });

  describe('the ledger window (plan Requirement 7)', () => {
    const at = (doc: FDoc, seq: number) => withLineage(compact(doc), { id: `L-${seq}`, seq });

    it('blocks a peer more than LEDGER_WINDOW generations behind that holds Counter keys; one exactly at the window rebases', () => {
      const origin = shared();
      const baseline = Automerge.getHeads(origin);
      const peer = apply(Automerge.clone(origin), inc(-1));
      expect(buildRebaseOpsRaw(peer, baseline, at(origin, LEDGER_WINDOW + 1))).toMatchObject({
        op: null,
        counterCarries: 0,
        blockedBy: 'ledger-window',
      });
      const edge = buildRebaseOpsRaw(peer, baseline, at(origin, LEDGER_WINDOW))!;
      expect(edge.blockedBy).toBeUndefined();
      expect(edge.counterCarries).toBe(1);

      // A peer with no Counter keys has nothing the ledger decides: never blocked.
      const plain = apply(
        Automerge.clone(origin),
        setAccount({ id: 'B', name: 'New', type: 'savings', balance: 5 })
      );
      const far = buildRebaseOpsRaw(plain, baseline, at(origin, LEDGER_WINDOW + 5))!;
      expect(far.blockedBy).toBeUndefined();
      expect(far.count).toBe(1);
    });

    it('the merge takes the rebase-unavailable path with conflictKind ledger-window', async () => {
      const origin = shared();
      const baseline = Automerge.getHeads(origin);
      const peer = apply(Automerge.clone(origin), inc(-1));
      const remote = at(origin, LEDGER_WINDOW + 1);

      ap.loadSnapshot(Automerge.save(peer));
      await expect(
        ap.mergeRemoteEnvelope(
          await envelopeFor(remote as unknown as Automerge.Doc<Doc>, key),
          'fam',
          { kind: 'baseline', heads: baseline }
        )
      ).rejects.toMatchObject({ conflictKind: 'ledger-window' });

      // A human's file choice still never dead-ends: it adopts, and says why.
      ap.loadSnapshot(Automerge.save(peer));
      const res = await ap.mergeRemoteEnvelope(
        await envelopeFor(remote as unknown as Automerge.Doc<Doc>, key),
        'fam',
        { kind: 'user-file', heads: baseline }
      );
      expect(res).toMatchObject({
        action: 'adopted',
        rebaseUnavailable: true,
        rebaseConflictKind: 'ledger-window',
      });
    });
  });

  it('nextLineage carries restoreSeq forward unchanged, and adds none when there was none', () => {
    expect(nextLineage({ id: 'a', seq: 3, restoreSeq: 2 })).toEqual({
      id: expect.any(String),
      seq: 4,
      restoreSeq: 2,
    });
    expect(nextLineage({ id: 'a', seq: 3 })).toEqual({ id: expect.any(String), seq: 4 });
    expect(nextLineage(null)).toEqual({ id: expect.any(String), seq: 1 });
  });

  describe('end to end: the real compactDoc, then mergeRemoteEnvelope', () => {
    /** Compact `doc` exactly as the app does, and return the compacted document. */
    function compactForReal(doc: FDoc): FDoc {
      ap.loadSnapshot(Automerge.save(doc));
      ap.compactDoc();
      return Automerge.load(ap.exportSnapshot().binary) as FDoc;
    }

    async function rebase(peer: FDoc, baseline: string[], remote: FDoc) {
      ap.loadSnapshot(Automerge.save(peer));
      const res = await ap.mergeRemoteEnvelope(
        await envelopeFor(remote as unknown as Automerge.Doc<Doc>, key),
        'fam',
        { kind: 'baseline', heads: baseline }
      );
      return { res, out: Automerge.load(ap.exportSnapshot().binary) as FDoc };
    }

    it('a peer with unsynced increments keeps them on the compacted pod, exactly once', async () => {
      const origin = shared();
      const synced = apply(Automerge.clone(origin), inc(-1.11));
      const baseline = Automerge.getHeads(synced);
      const compacted = compactForReal(synced);
      expect(Object.keys(compacted.counterDeltas)).toEqual([]);
      expect(Object.values(ledgerOf(compacted))).toEqual([-111]);
      // The family adjusts on the new lineage too.
      const remote = apply(Automerge.clone(compacted), inc(-2.22));
      const peer = apply(synced, inc(-3.33));

      const { res, out } = await rebase(peer, baseline, remote);
      expect(res.action).toBe('rebased');
      expect(res.counterRebase).toEqual({
        carries: 1,
        skipped: 0,
        superseded: 0,
        mode: 'ledger',
        fresh: true,
      });
      expect(res.counterStats).toMatchObject({ conflicts: 0, malformed: 0, ledgerKeys: 1 });
      // -1.11 once (folded), -2.22 (the family's live key), -3.33 once (the carried growth).
      expect(balanceOf(out)).toBe(93.34);
      expect(counterStats(out)).toMatchObject({ keys: 2, conflicts: 0 });
    });

    // ⚠️ THE MERGE-SAFETY PROOF ON THE REBASE PATH. An increment on one side and an absolute
    // "set balance to X" on the other, across a compaction, in BOTH orders: nothing is lost.
    it('peer increments, family sets after compacting: X + delta', async () => {
      const origin = shared();
      const baseline = Automerge.getHeads(origin);
      const remote = apply(compactForReal(origin), setBalanceTo(500, 100));
      const peer = apply(Automerge.clone(origin), inc(-20.25));

      const { res, out } = await rebase(peer, baseline, remote);
      expect(res).toMatchObject({
        action: 'rebased',
        conflicts: 0,
        counterRebase: expect.objectContaining({ carries: 1 }),
      });
      expect(balanceOf(out)).toBe(479.75);
    });

    it('peer sets, family increments after compacting: X + delta', async () => {
      const origin = shared();
      const baseline = Automerge.getHeads(origin);
      const remote = apply(compactForReal(origin), inc(-20.25));
      const peer = apply(Automerge.clone(origin), setBalanceTo(500, 100));

      const { res, out } = await rebase(peer, baseline, remote);
      // The peer's absolute crosses as a raw base-less patch; the family's Counter sits on top.
      expect(res).toMatchObject({
        action: 'rebased',
        conflicts: 0,
        counterRebase: expect.objectContaining({ carries: 0 }),
      });
      expect(balanceOf(out)).toBe(479.75);
    });

    it('C9g: an adjustment the compaction FOLDED vs a peer absolute set: the set crosses as a shift', async () => {
      // ⚠️ BEHAVIOUR CHANGED (data-layer audit 2026-10-03). The fold moved the target's
      // absolute, so the three-way rule saw both sides change `balance`, kept the saved value
      // and counted a conflict: the peer's offline "set balance to 500" was simply lost. The
      // peer's own change (+400) now lands on the target's value, so both survive.
      const origin = shared();
      const baseline = Automerge.getHeads(origin);
      const remote = compactForReal(apply(Automerge.clone(origin), inc(-20.25)));
      const peer = apply(Automerge.clone(origin), setBalanceTo(500, 100));

      const { res, out } = await rebase(peer, baseline, remote);
      expect(res).toMatchObject({
        action: 'rebased',
        conflicts: 0,
        counterRebase: expect.objectContaining({ carries: 0 }),
      });
      expect(balanceOf(out)).toBe(479.75);
    });
  });
});
