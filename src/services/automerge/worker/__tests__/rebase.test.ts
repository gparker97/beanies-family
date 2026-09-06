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
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
const { buildRebaseOps: buildRebaseOpsRaw } = await import('../docOps');
// The composer is typed on `FamilyDocument`; these fixtures are deliberately a
// minimal subset, so the cast is at the boundary rather than inside the tests.
const buildRebaseOps = buildRebaseOpsRaw as unknown as (
  local: Automerge.Doc<Doc>,
  heads: string[],
  target: Automerge.Doc<Doc>
) => { op: unknown; count: number; conflicts: number } | null;

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
 */
function compact(doc: Automerge.Doc<Doc>, id = 'L-NEW'): Automerge.Doc<Doc> {
  return Automerge.from<Doc>({ ...Automerge.toJS(doc), podLineage: { id, seq: 1 } });
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
  ap.configure({ pushChunk() {}, perf() {}, cachePersistFailed() {} });
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
    expect(JSON.stringify(built)).toContain('setSettings');
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
    // which excludes the singletons, and the only op that writes one is
    // `named:setSettings`. Worth a test anyway — an op stamping the OLD lineage
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
    expect(built).toEqual({ op: null, count: 0, conflicts: 0 });
  });
});
