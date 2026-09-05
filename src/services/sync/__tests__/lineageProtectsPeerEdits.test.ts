// @vitest-environment node
/**
 * The measurement the whole lineage guard exists because of, as a test.
 *
 * `Automerge.from(Automerge.toJS(doc))` is the only way to drop history in
 * Automerge 3.x, and it mints brand-new object ids — so the compacted document
 * shares no ancestry with the original and a merge is a map-level conflict
 * rather than a reconciliation.
 *
 * The first half MEASURES the loss so the figure is reproducible rather than
 * folklore — and the measurement matters, because a careless version of it
 * reports certainty where the truth is a coin flip. The second half shows the
 * guard refusing exactly that merge.
 */
import { describe, it, expect } from 'vitest';
import * as Automerge from '@automerge/automerge';
import { guardLineage, PodLineageError } from '@/services/sync/podLineage';

type Doc = {
  accounts: Record<string, { id: string; balance: number }>;
  /** Optional, and added by a LATER change on purpose — see the probe below. */
  recipes?: Record<string, { id: string; title: string }>;
};

/** A pod, and the compacted copy of it a peer would publish. */
function pod() {
  const original = Automerge.save(
    Automerge.from<Doc>({
      accounts: { a1: { id: 'a1', balance: 100 }, a2: { id: 'a2', balance: 50 } },
    })
  );
  const compacted = Automerge.save(
    Automerge.from<Doc>(Automerge.toJS(Automerge.load<Doc>(original)))
  );
  return { original, compacted };
}

describe('a naive merge across lineages', () => {
  it('destroys the peer’s unsynced changes about HALF the time', () => {
    // ⚠️ A COIN FLIP, not a certainty, and the distinction matters.
    //
    // The root key `accounts` holds two competing maps with no common
    // ancestry, so Automerge resolves it by actor-id ordering — and both
    // actors are random. Whether the peer's work survives is therefore decided
    // by chance, per pod, at compaction time.
    //
    // An earlier probe built the pod and its compaction ONCE at module scope
    // and looped 200 times, so every iteration inherited a single flip; it
    // reported "200/200 lost" and, on the next run, "200/200 kept". Both were
    // one measurement. Rebuild BOTH inside the loop or this test measures
    // nothing.
    //
    // Non-deterministic loss is worse than deterministic loss, because it
    // looks like it works — in testing, in a demo, and for the first few
    // families.
    const N = 200;
    let survived = 0;
    let survivedLate = 0;
    for (let i = 0; i < N; i++) {
      // ⚠️ TWO collections, and the second added by a LATER change — because a
      // SINGLE-collection document can only ever exhibit the TIE case, which is
      // what made both earlier probes ("200/200", then "~50%") measure the
      // wrong thing. Automerge breaks a map-write tie by opId COUNTER first and
      // only falls back to the actor id when the counters are equal. A
      // collection added by a later change (here `recipes`, standing in for
      // every collection a later `migrateDoc` introduced) carries a HIGH
      // counter in the old lineage and a LOW one in the compacted pod, so the
      // old lineage wins DETERMINISTICALLY.
      let base = Automerge.from<Doc>({
        accounts: { a1: { id: 'a1', balance: 100 }, a2: { id: 'a2', balance: 50 } },
      });
      base = Automerge.change(base, (d) => {
        d.recipes = { r1: { id: 'r1', title: 'soup' } };
      });
      const original = Automerge.save(base);
      const compacted = Automerge.save(
        Automerge.from<Doc>(Automerge.toJS(Automerge.load<Doc>(original)))
      );
      let peer = Automerge.load<Doc>(original); // still on the OLD history
      peer = Automerge.change(peer, (d) => {
        d.accounts.a1!.balance = 999; // an edit in the FIRST-change collection
        d.recipes!.r1!.title = 'stew'; // and one in the later-added collection
      });
      const merged = Automerge.toJS(Automerge.merge(peer, Automerge.load<Doc>(compacted)));
      if (merged.accounts.a1?.balance === 999) survived++;
      if (merged.recipes?.r1?.title === 'stew') survivedLate++;
    }
    // The first-change collection is the TIE case: the actor id decides, so it
    // lands somewhere in the middle and neither bound may be tight.
    expect(survived, `${survived}/${N} peers kept a first-change edit`).toBeGreaterThan(N * 0.2);
    expect(survived).toBeLessThan(N * 0.8);
    // The later-added collection is the DETERMINISTIC case, and it is the one
    // that matters: every collection the app added after the first release
    // behaves like this. `survivedLate === N` (the old lineage always wins) is
    // what makes an unguarded merge silently revert a whole compaction rather
    // than corrupt it visibly half the time.
    expect(survivedLate, `${survivedLate}/${N} kept a later-collection edit`).toBe(N);
  });
});

describe('the guard refuses that merge', () => {
  it('BLOCKS when the peer might hold unsynced work', () => {
    expect(() => guardLineage({ id: 'new', seq: 1 }, null, 'dirty')).toThrow(PodLineageError);
  });

  it('but ADOPTS when the peer provably has nothing to lose', () => {
    // Adoption is not the dangerous half — merging is. A clean peer replaces
    // its document wholesale, which is how a compaction propagates at all.
    expect(guardLineage({ id: 'new', seq: 1 }, null, 'clean')).toBe('adopt');
  });

  it('and an ADOPT loses nothing, because there was nothing to lose', () => {
    // The counterpart to the loss measured above: same two documents, but the
    // peer has made no unsynced change, so wholesale replacement is lossless.
    const { original, compacted } = pod();
    const before = Automerge.toJS(Automerge.load<Doc>(original));
    const after = Automerge.toJS(Automerge.load<Doc>(compacted));
    expect(after).toEqual(before);
  });
});
