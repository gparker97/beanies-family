/**
 * The lineage comparator and the policy table.
 *
 * Both halves are table-tested, because both halves were got wrong in a draft
 * in ways that would have shipped a broken feature: a bare counter cannot tell
 * two concurrent compactions apart, and a wall-clock "open vs mid-session" axis
 * blocks the ordinary sync path (so a compaction could never reach a peer) AND
 * the rollback file (so the mandated recovery is refused by the guard that
 * mandates it).
 */
import { describe, it, expect } from 'vitest';
import {
  compareLineage,
  lineageAction,
  guardLineage,
  PodLineageError,
  type LineageVerdict,
  type LineageContext,
  type LineageAction,
} from '@/services/sync/podLineage';

const L = (id: string, seq: number) => ({ id, seq });

describe('compareLineage', () => {
  it('calls two absent lineages the same — that is the whole fleet today', () => {
    expect(compareLineage(null, null)).toBe('same');
  });

  it('calls equal ids the same regardless of seq', () => {
    // The id IS the identity. A seq that disagrees is a bug elsewhere, not a
    // reason to treat one document as a different lineage.
    expect(compareLineage(L('a', 3), L('a', 3))).toBe('same');
  });

  it('adopts when the remote has been compacted and we have not', () => {
    expect(compareLineage(L('a', 1), null)).toBe('adopt-remote');
    expect(compareLineage(L('a', 2), L('b', 1))).toBe('adopt-remote');
  });

  it('is ours-newer when we hold a compaction the remote has not got', () => {
    expect(compareLineage(null, L('a', 1))).toBe('ours-newer');
    expect(compareLineage(L('b', 1), L('a', 2))).toBe('ours-newer');
  });

  it('CONFLICTS on the same generation with different identities', () => {
    // The reason `seq` alone is not enough, and the reason `id` exists: two
    // devices that both compacted from generation 0 both produce seq 1 on
    // genuinely incompatible lineages. A counter reads those as equal and
    // merges them, which is the 200/200 data loss this guard exists to stop.
    expect(compareLineage(L('a', 1), L('b', 1))).toBe('conflict');
  });
});

describe('lineageAction — the policy table', () => {
  const CONTEXTS: LineageContext[] = ['clean', 'dirty', 'user-file'];

  it('MERGES on every context when the lineage is the same', () => {
    // The property that discharges "nothing changes for a pod that has never
    // been compacted" by the shape of the table rather than by inspection.
    for (const ctx of CONTEXTS) expect(lineageAction('same', ctx)).toBe('merge');
  });

  it('adopts a newer remote on the ordinary sync path — the propagation route', () => {
    // If this is `block`, a published compaction can never reach any other
    // device: a peer's FIRST post-compaction sync arrives exactly here.
    expect(lineageAction('adopt-remote', 'clean')).toBe('adopt');
  });

  it('REBASES rather than discarding unsynced work', () => {
    // ⚠️ Stage 3 flipped this one cell from `block`. A peer that was offline
    // while the family compacted now has its work replayed onto the new
    // lineage instead of being asked to give it up. Every way that replay can
    // fail falls back to the block this replaced, so it can only lose less.
    expect(lineageAction('adopt-remote', 'dirty')).toBe('rebase');
  });

  it('never blocks a file the user explicitly chose', () => {
    // Without this the guard refuses the pre-compaction `.beanpod` that is the
    // only rollback route — the guard would make its own mandated recovery
    // impossible. A user picking a file IS the human decision it demands.
    for (const v of ['adopt-remote', 'ours-newer', 'conflict'] as LineageVerdict[]) {
      expect(lineageAction(v, 'user-file')).not.toBe('block');
    }
  });

  it('is total: all 12 pairs answer with a real action', () => {
    const verdicts: LineageVerdict[] = ['same', 'adopt-remote', 'ours-newer', 'conflict'];
    // All five actions, since Stage 3 made `rebase` reachable. Listing them
    // explicitly is the point: a new action must be considered here, not
    // silently accepted.
    const valid: LineageAction[] = ['merge', 'adopt', 'publish-local', 'block', 'rebase'];
    const seen = verdicts.flatMap((v) => CONTEXTS.map((c) => lineageAction(v, c)));
    expect(seen).toHaveLength(12);
    for (const a of seen) expect(valid).toContain(a);
  });
});

describe('guardLineage', () => {
  it('returns the action for every non-blocking case', () => {
    expect(guardLineage(null, null, 'clean').action).toBe('merge');
    expect(guardLineage(L('a', 1), null, 'clean').action).toBe('adopt');
    expect(guardLineage(null, L('a', 1), 'clean').action).toBe('publish-local');
  });

  it('returns the VERDICT beside the action, so the caller never recomputes it', () => {
    // `POLICY` maps `ours-newer x user-file` and `conflict x user-file` both
    // to `adopt`; only the verdict tells a restore from a resolved conflict.
    expect(guardLineage(null, L('a', 1), 'user-file')).toEqual({
      action: 'adopt',
      verdict: 'ours-newer',
    });
    expect(guardLineage(L('a', 1), L('b', 1), 'user-file')).toEqual({
      action: 'adopt',
      verdict: 'conflict',
    });
  });

  it('THROWS a typed error carrying the verdict', () => {
    // The type is what the latch and the reporter branch on, and `blockCode`
    // is what reaches CloudWatch as `error_code`.
    const err = (() => {
      try {
        guardLineage(L('a', 1), L('b', 1), 'clean');
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(PodLineageError);
    expect((err as PodLineageError).verdict).toBe('conflict');
    expect((err as PodLineageError).blockCode).toBe('conflict');
    expect((err as PodLineageError).name).toBe('PodLineageError');
  });

  it('never throws for a pod that has never been compacted', () => {
    for (const ctx of ['clean', 'dirty', 'user-file'] as LineageContext[]) {
      expect(() => guardLineage(null, null, ctx)).not.toThrow();
    }
  });
});
