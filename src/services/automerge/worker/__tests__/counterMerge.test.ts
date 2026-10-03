/**
 * #117 Phase 2: concurrent adjustments survive the merge, proved on the two-device harness
 * through the REAL ops (`increment`, `applyGoalContribution`, `applyLoanPayment`,
 * `reverseLoanPayment`) with Counter writes ON. Plan `docs/plans/2026-10-03-crdt-counters-117-
 * phase-2.md`, Requirements 1, 2, 5 and 10, and the residuals it pins.
 *
 * Every converge also asserts `counterStats(...).conflicts === 0`: no key is ever written by two
 * actors (probe e' shows why a shared key would be unrecoverable).
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as Automerge from '@automerge/automerge';
import type { CollectionName } from '@/types/automerge';
import { materializeCollection, getHeads } from '../docOps';
import {
  COUNTER_WRITES_ENABLED,
  __setCounterWritesForTesting,
  counterStats,
  foldIndex,
} from '../counterFields';
import type { MutationOp } from '../protocol';
import {
  apply,
  converge as convergeRaw,
  fork,
  resetTestDevices,
  seeded,
  useTestDevices,
  type Doc,
} from './twoDevices';

type AnyRec = Record<string, unknown>;

beforeEach(() => useTestDevices());
afterEach(() => {
  __setCounterWritesForTesting(COUNTER_WRITES_ENABLED);
  resetTestDevices();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Converge, then assert neither side holds a shared or malformed Counter key. */
function converge(a: Doc, b: Doc): { a: Doc; b: Doc } {
  const out = convergeRaw(a, b);
  for (const doc of [out.a, out.b]) {
    expect(counterStats(doc)).toMatchObject({ conflicts: 0, malformed: 0 });
  }
  return out;
}

/** What main would show for one entity: the folded projection. */
function shown(doc: Doc, collection: CollectionName, id: string): AnyRec {
  const found = materializeCollection(doc, collection, foldIndex(doc)).find(([k]) => k === id);
  return found![1] as AnyRec;
}

const balanceOf = (doc: Doc) => shown(doc, 'accounts', 'A').balance;
const goalAmountOf = (doc: Doc) => shown(doc, 'goals', 'G').currentAmount;
const loanOf = (doc: Doc) =>
  (shown(doc, 'assets', 'L').loan as { outstandingBalance: number }).outstandingBalance;

const set = (collection: CollectionName, entity: AnyRec & { id: string }): MutationOp => ({
  op: 'set',
  collection,
  id: entity.id,
  entity,
});

const ACCOUNT = { id: 'A', name: 'Everyday', type: 'checking', balance: 100 };
// `manualContributions: []` present, as after a goal's first contribution: the FIRST creation
// of the array on two devices is the plan's unchanged residual, pinned separately below.
const GOAL = {
  id: 'G',
  name: 'Trip',
  currentAmount: 100,
  targetAmount: 500,
  isCompleted: false,
  manualContributions: [],
};
const ASSET = {
  id: 'L',
  name: 'House',
  currency: 'USD',
  loan: { hasLoan: true, outstandingBalance: 100, interestRate: 0, monthlyPayment: 10 },
};

const origin = (): Doc =>
  seeded([set('accounts', ACCOUNT), set('goals', GOAL), set('assets', ASSET)]);

const increment = (delta: number): MutationOp => ({
  op: 'increment',
  collection: 'accounts',
  id: 'A',
  field: 'balance',
  delta,
});

const contribute = (delta: number, more: AnyRec = {}): MutationOp => ({
  op: 'named',
  name: 'applyGoalContribution',
  args: { id: 'G', delta, ...more },
});

const extraPayment = (amount: number): MutationOp => ({
  op: 'named',
  name: 'applyLoanPayment',
  args: { loanId: 'L', paymentAmount: amount, isRecurring: false },
});

const reversePayment = (amount: number): MutationOp => ({
  op: 'named',
  name: 'reverseLoanPayment',
  args: { loanId: 'L', principalToRestore: amount },
});

/** All three adjustments of `-amount`, through the real ops. */
const adjustAll = (doc: Doc, amount: number): Doc =>
  apply(doc, increment(-amount), contribute(-amount), extraPayment(amount));

/** A history entry as `goalsStore.contributionEntry` builds it. */
const entry = (id: string, amount: number) => ({
  id,
  amount,
  at: '2026-10-03T10:00:00.000Z',
  updatedBy: 'member-1',
});

const historyOf = (doc: Doc) =>
  ((shown(doc, 'goals', 'G').manualContributions ?? []) as Array<{ id: string; amount: number }>)
    .map((c) => `${c.id}:${c.amount}`)
    .sort();

// ─── Requirement 1: both adjustments land, to the cent ───────────────────────

describe('concurrent adjustments merge to their sum (writes on)', () => {
  it('-20.25 and -30.50 on 100 give 49.25 on all three fields; a later -5.05 reads 44.20 on both', () => {
    __setCounterWritesForTesting(true);
    const { a, b } = fork(origin());
    const merged = converge(adjustAll(a, 20.25), adjustAll(b, 30.5));
    for (const doc of [merged.a, merged.b]) {
      expect(balanceOf(doc)).toBe(49.25);
      expect(goalAmountOf(doc)).toBe(49.25);
      expect(loanOf(doc)).toBe(49.25);
    }
    // The baselines are untouched: every adjustment is a Counter, one key per writer.
    expect((merged.a.accounts as unknown as AnyRec).A).toMatchObject({ balance: 100 });
    expect(counterStats(merged.a).keys).toBe(6);

    // A later adjustment on the merged document applies to this writer's key only (probe e':
    // a shared key would have applied it to both and read -60, not -55).
    const later = converge(adjustAll(merged.a, 5.05), merged.b);
    for (const doc of [later.a, later.b]) {
      expect(balanceOf(doc)).toBe(44.2);
      expect(goalAmountOf(doc)).toBe(44.2);
      expect(loanOf(doc)).toBe(44.2);
    }
    expect(counterStats(later.a).keys).toBe(6);
  });

  it('merges in both orders to the same value, and a reversed loan payment lands too', () => {
    __setCounterWritesForTesting(true);
    const { a, b } = fork(origin());
    const a1 = apply(a, extraPayment(10.1), reversePayment(4.04));
    const b1 = apply(b, extraPayment(0.01));
    const ab = converge(a1, b1);
    const ba = converge(Automerge.clone(b1), Automerge.clone(a1));
    expect(loanOf(ab.a)).toBe(93.93);
    expect(loanOf(ba.a)).toBe(93.93);
  });

  it('a loan payment on a loan ACCOUNT adjusts its balance on both devices', () => {
    __setCounterWritesForTesting(true);
    const loanAccount = { id: 'LA', type: 'loan', balance: 1000, interestRate: 12 };
    const { a, b } = fork(seeded([set('accounts', loanAccount)]));
    const pay: MutationOp = {
      op: 'named',
      name: 'applyLoanPayment',
      args: { loanId: 'LA', paymentAmount: 100, isRecurring: true },
    };
    // Each device: interest 10 on 1000, principal 90. Merged: 1000 − 90 − 90.
    const merged = converge(apply(a, pay), apply(b, pay));
    expect(shown(merged.a, 'accounts', 'LA').balance).toBe(820);
  });
});

// ─── Quick contributions: amount and history, both devices ───────────────────

describe('quick contributions with history (writes on)', () => {
  function bothContributed() {
    const { a, b } = fork(origin());
    return converge(
      apply(a, contribute(30, { contribution: entry('ca', 30) })),
      apply(b, contribute(50, { contribution: entry('cb', 50) }))
    );
  }

  it('30 on A and 50 on B merge to the sum with both history entries', () => {
    __setCounterWritesForTesting(true);
    const merged = bothContributed();
    for (const doc of [merged.a, merged.b]) {
      expect(goalAmountOf(doc)).toBe(180);
      expect(historyOf(doc)).toEqual(['ca:30', 'cb:50']);
    }
  });

  it.each([
    ['A undoes its own entry', 'a', 'ca', 30, 150, ['cb:50']],
    ['B undoes its own entry', 'b', 'cb', 50, 130, ['ca:30']],
    ['A undoes the entry B made', 'a', 'cb', 50, 130, ['ca:30']],
  ] as const)('%s: exactly that entry and amount go', (_n, side, id, amount, want, history) => {
    __setCounterWritesForTesting(true);
    const merged = bothContributed();
    const undone = apply(merged[side], contribute(-amount, { undoContributionId: id }));
    const other = side === 'a' ? merged.b : merged.a;
    const after = converge(undone, other);
    for (const doc of [after.a, after.b]) {
      expect(goalAmountOf(doc)).toBe(want);
      expect(historyOf(doc)).toEqual(history);
    }
  });

  it("an undo after a concurrent contribution merged removes the ENTRY's amount, not main's delta", () => {
    // Main sent a delta computed from a view the merge made stale (here -80: "back to before
    // both"). The entry being spliced recorded 30, so exactly 30 goes: total − entry.amount.
    __setCounterWritesForTesting(true);
    const merged = bothContributed();
    expect(goalAmountOf(merged.a)).toBe(180);
    const undone = apply(merged.a, contribute(-80, { undoContributionId: 'ca' }));
    expect(goalAmountOf(undone)).toBe(150);
    expect(historyOf(undone)).toEqual(['cb:50']);
    const after = converge(undone, merged.b);
    for (const doc of [after.a, after.b]) expect(goalAmountOf(doc)).toBe(150);
  });

  it('a second undo of the same entry, on either device after the merge, changes nothing', () => {
    __setCounterWritesForTesting(true);
    const merged = bothContributed();
    const undone = converge(
      apply(merged.a, contribute(-30, { undoContributionId: 'ca' })),
      merged.b
    );
    for (const side of ['a', 'b'] as const) {
      const heads = getHeads(undone[side]);
      const again = apply(undone[side], contribute(-30, { undoContributionId: 'ca' }));
      expect(getHeads(again)).toEqual(heads);
      expect(goalAmountOf(again)).toBe(150);
      expect(historyOf(again)).toEqual(['cb:50']);
    }
  });

  it('a retried contribution id appends nothing and adds nothing, on either device', () => {
    __setCounterWritesForTesting(true);
    const merged = bothContributed();
    const heads = getHeads(merged.b);
    const retried = apply(merged.b, contribute(30, { contribution: entry('ca', 30) }));
    expect(getHeads(retried)).toEqual(heads);
    const after = converge(merged.a, retried);
    expect(goalAmountOf(after.a)).toBe(180);
    expect(historyOf(after.a)).toEqual(['ca:30', 'cb:50']);
  });
});

// ─── Absolute writes meet adjustments ────────────────────────────────────────

describe('absolute writes and adjustments', () => {
  it('set-vs-increment: a "set balance to 500" on A and -20.25 on B merge to 479.75', () => {
    __setCounterWritesForTesting(true);
    const { a, b } = fork(origin());
    // The modal save: a based patch in folded space.
    const setTo = (v: number): MutationOp => ({
      op: 'patch',
      collection: 'accounts',
      id: 'A',
      patch: { balance: v },
      base: { balance: 100 },
    });
    const merged = converge(apply(a, setTo(500)), apply(b, increment(-20.25)));
    expect(balanceOf(merged.a)).toBe(479.75);
    expect(balanceOf(merged.b)).toBe(479.75);
  });

  it('merge-safety proof: increment and absolute set on either device, merged either way, lose nothing', () => {
    // The roles swapped AND the merge direction swapped: four runs, one answer. The rebase twin
    // (across a compaction) is in `rebase.test.ts`.
    __setCounterWritesForTesting(true);
    const setTo = (v: number): MutationOp => ({
      op: 'patch',
      collection: 'accounts',
      id: 'A',
      patch: { balance: v },
      base: { balance: 100 },
    });
    for (const incrementOnA of [true, false]) {
      const { a, b } = fork(origin());
      const a1 = apply(a, incrementOnA ? increment(-20.25) : setTo(500));
      const b1 = apply(b, incrementOnA ? setTo(500) : increment(-20.25));
      const ab = converge(Automerge.clone(a1), Automerge.clone(b1));
      const ba = converge(b1, a1);
      for (const doc of [ab.a, ab.b, ba.a, ba.b]) expect(balanceOf(doc)).toBe(479.75);
    }
  });

  it('mixed fleet: a writes-off device and a writes-on device converge to the right fold', () => {
    const { a, b } = fork(origin());
    __setCounterWritesForTesting(false);
    const off = adjustAll(a, 20.25); // today's absolutes: 79.75 written into the baseline
    __setCounterWritesForTesting(true);
    const on = adjustAll(b, 30.5); // Counters on top of the untouched baseline
    expect(Object.keys(off.counterDeltas)).toEqual([]);
    const merged = converge(off, on);
    for (const doc of [merged.a, merged.b]) {
      expect(balanceOf(doc)).toBe(49.25);
      expect(goalAmountOf(doc)).toBe(49.25);
      expect(loanOf(doc)).toBe(49.25);
    }
    // And a later adjustment from the writes-on device stays exact.
    const later = converge(merged.a, adjustAll(merged.b, 5.05));
    expect(balanceOf(later.a)).toBe(44.2);
  });

  it('residual: two absolute GoalModal amount edits keep one, plus every adjustment on top', () => {
    __setCounterWritesForTesting(true);
    const { a, b } = fork(origin());
    const edit = (v: number): MutationOp => ({
      op: 'patch',
      collection: 'goals',
      id: 'G',
      patch: { currentAmount: v },
      base: { currentAmount: 100 },
    });
    const merged = converge(
      apply(a, edit(170)),
      apply(b, edit(190), contribute(5, { contribution: entry('cb', 5) }))
    );
    // One absolute wins (Automerge's last-writer rule); B's quick contribution rides on top.
    expect([175, 195]).toContain(goalAmountOf(merged.a));
  });

  it('residual: the first history entry created on both devices keeps one entry, but both amounts', () => {
    __setCounterWritesForTesting(true);
    const { manualContributions: _none, ...noHistory } = GOAL;
    const { a, b } = fork(seeded([set('goals', noHistory)]));
    const merged = converge(
      apply(a, contribute(30, { contribution: entry('ca', 30) })),
      apply(b, contribute(50, { contribution: entry('cb', 50) }))
    );
    expect(goalAmountOf(merged.a)).toBe(180);
    expect(historyOf(merged.a)).toHaveLength(1);
  });

  it('residual: a merge that crosses the target leaves isCompleted false until the next contribution', () => {
    __setCounterWritesForTesting(true);
    const { a, b } = fork(
      seeded([set('goals', { ...GOAL, currentAmount: 50, targetAmount: 100 })])
    );
    // Each device: 50 + 30 = 80 < 100, so neither completes. Merged: 110.
    const merged = converge(apply(a, contribute(30)), apply(b, contribute(30)));
    expect(shown(merged.a, 'goals', 'G')).toMatchObject({ currentAmount: 110, isCompleted: false });
    const next = apply(merged.a, contribute(0.01));
    expect(shown(next, 'goals', 'G')).toMatchObject({ currentAmount: 110.01, isCompleted: true });
  });
});
