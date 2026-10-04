/**
 * `commitTransactionCascade` (audit C7): one Automerge change per cascade, proved on the
 * two-device harness through the REAL op. What must never regress:
 *  - create/update/delete land the row AND every balance movement together, or nothing;
 *  - an edit touching no money field leaves the goal and the loan untouched;
 *  - a delete reverses from the STORED portions, never from a recomputation;
 *  - an asset loan's linked account mirror moves with the asset, relatively;
 *  - two devices' cascades both land after a merge (writes on).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import type { CollectionName } from '@/types/automerge';
import { applyMutation, materializeCollection, getHeads, getChangesSince } from '../docOps';
import { foldIndex, setCounterWrites } from '../counterFields';
import {
  registerTransactionOps,
  type TransactionCascadeArgs,
  type TransactionCascadeResult,
} from '../transactionOps';
import type { MutationOp } from '../protocol';
import { apply, converge, fork, seeded, type Doc } from './twoDevices';

type AnyRec = Record<string, unknown>;

beforeAll(() => registerTransactionOps());
afterEach(() => setCounterWrites(null));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const set = (collection: CollectionName, entity: AnyRec & { id: string }): MutationOp => ({
  op: 'set',
  collection,
  id: entity.id,
  entity,
});

const CHECKING = { id: 'chk', name: 'Everyday', type: 'checking', currency: 'USD', balance: 1000 };
const SAVINGS = { id: 'sav', name: 'Rainy day', type: 'savings', currency: 'USD', balance: 500 };
const CARD = { id: 'card', name: 'Visa', type: 'credit_card', currency: 'USD', balance: 200 };
const GOAL = {
  id: 'g',
  name: 'Car',
  type: 'savings',
  targetAmount: 1000,
  currentAmount: 100,
  currency: 'USD',
  isCompleted: false,
  manualContributions: [],
};
// An asset loan (12% so the monthly interest is a round 1%) with its linked mirror account.
const HOUSE = {
  id: 'house',
  name: 'House',
  currency: 'USD',
  loan: { hasLoan: true, outstandingBalance: 10000, interestRate: 12, monthlyPayment: 500 },
};
const MIRROR = {
  id: 'house-loan',
  name: 'House Loan',
  type: 'loan',
  currency: 'USD',
  balance: 10000,
  linkedAssetId: 'house',
};
const CAR_LOAN = {
  id: 'car-loan',
  name: 'Car Loan',
  type: 'loan',
  currency: 'USD',
  balance: 2000,
  interestRate: 12,
};

const world = (): Doc =>
  seeded([
    set('accounts', CHECKING),
    set('accounts', SAVINGS),
    set('accounts', CARD),
    set('accounts', MIRROR),
    set('accounts', CAR_LOAN),
    set('goals', GOAL),
    set('assets', HOUSE),
  ]);

const row = (extra: AnyRec = {}): AnyRec => ({
  id: 't1',
  accountId: 'chk',
  type: 'expense',
  amount: 100,
  currency: 'USD',
  category: 'x',
  date: '2026-10-03',
  description: 'one',
  isReconciled: false,
  createdAt: '2026-10-03T00:00:00.000Z',
  updatedAt: '2026-10-03T00:00:00.000Z',
  ...extra,
});

const cascade = (args: TransactionCascadeArgs): MutationOp => ({
  op: 'named',
  name: 'commitTransactionCascade',
  args: args as unknown as Record<string, unknown>,
});

function run(
  doc: Doc,
  args: TransactionCascadeArgs
): { doc: Doc; result: TransactionCascadeResult } {
  const { doc: next, result } = applyMutation(doc, cascade(args));
  return { doc: next, result: result as TransactionCascadeResult };
}

/** What main would show for one entity: the folded projection. */
function shown(doc: Doc, collection: CollectionName, id: string): AnyRec | undefined {
  const found = materializeCollection(doc, collection, foldIndex(doc)).find(([k]) => k === id);
  return found?.[1] as AnyRec | undefined;
}
const balance = (doc: Doc, id: string): number => shown(doc, 'accounts', id)!.balance as number;
const goalAmount = (doc: Doc): number => shown(doc, 'goals', 'g')!.currentAmount as number;
const houseLoan = (doc: Doc): number =>
  (shown(doc, 'assets', 'house')!.loan as { outstandingBalance: number }).outstandingBalance;
const tx = (doc: Doc, id = 't1'): AnyRec | undefined => shown(doc, 'transactions', id);

// ─── Create ──────────────────────────────────────────────────────────────────

describe('create', () => {
  it('a sub-minor-unit delta writes no adjustment and does not stamp the account', () => {
    const before = world();
    const stamp = shown(before, 'accounts', 'chk')!.updatedAt;
    const { doc } = run(before, {
      mode: 'create',
      transaction: row({ amount: 0.001 }) as never,
    });
    expect(balance(doc, 'chk')).toBe(balance(before, 'chk'));
    expect(shown(doc, 'accounts', 'chk')!.updatedAt).toBe(stamp);
  });

  it('writes the row, the source balance, the goal allocation and the loan portions in ONE change', () => {
    const before = world();
    const heads = getHeads(before);
    const { doc, result } = run(before, {
      mode: 'create',
      transaction: row({
        amount: 500,
        goalId: 'g',
        goalAllocMode: 'percentage',
        goalAllocValue: 20,
        loanId: 'car-loan',
      }) as never,
    });
    // One change on top of the seed.
    expect(getChangesSince(doc, heads)).toHaveLength(1);
    expect(getHeads(doc)).not.toEqual(heads);

    expect(balance(doc, 'chk')).toBe(500);
    expect(goalAmount(doc)).toBe(200); // 20% of 500
    // Extra payment (no recurringItemId): the whole 500 to principal.
    expect(balance(doc, 'car-loan')).toBe(1500);
    expect(tx(doc)).toMatchObject({
      goalAllocApplied: 100,
      loanInterestPortion: 0,
      loanPrincipalPortion: 500,
    });
    // The echo carries the row and every entity moved, folded.
    expect(result.found).toBe(true);
    expect(result.transaction).toMatchObject({ id: 't1', goalAllocApplied: 100 });
    expect(result.accounts.map((a) => a.id).sort()).toEqual(['car-loan', 'chk']);
    expect(result.goals.map((g) => g.id)).toEqual(['g']);
    expect(result.skipped).toEqual([]);
  });

  it('a transfer debits the source and credits the destination its stored toAmount; a card is liability-aware', () => {
    const { doc } = run(world(), {
      mode: 'create',
      transaction: row({
        type: 'transfer',
        toAccountId: 'card',
        amount: 100,
        toAmount: 74.4,
      }) as never,
    });
    expect(balance(doc, 'chk')).toBe(900);
    expect(balance(doc, 'card')).toBeCloseTo(125.6, 5); // owed reduced by the converted amount
  });

  it('amortises a recurring payment and caps the goal allocation at what the goal still needs', () => {
    const { doc } = run(world(), {
      mode: 'create',
      transaction: row({
        type: 'income',
        amount: 5000,
        goalId: 'g',
        goalAllocMode: 'percentage',
        goalAllocValue: 50,
        loanId: 'car-loan',
        recurringItemId: 'r1',
      }) as never,
    });
    expect(goalAmount(doc)).toBe(1000); // 2500 requested, 900 remaining
    expect(shown(doc, 'goals', 'g')!.isCompleted).toBe(true);
    expect(tx(doc)!.goalAllocApplied).toBe(900);
    // Recurring: interest 1% of 2000 = 20, principal 2000 (capped at the balance).
    expect(tx(doc)).toMatchObject({ loanInterestPortion: 20, loanPrincipalPortion: 2000 });
    expect(balance(doc, 'car-loan')).toBe(0);
  });

  it('a retry of a committed create applies nothing twice', () => {
    const first = run(world(), { mode: 'create', transaction: row() as never });
    const again = run(first.doc, { mode: 'create', transaction: row() as never });
    expect(balance(again.doc, 'chk')).toBe(900);
    expect(getHeads(again.doc)).toEqual(getHeads(first.doc));
    expect(again.result.found).toBe(true);
  });

  it('a balance adjustment is an audit row: no effects', () => {
    const { doc } = run(world(), {
      mode: 'create',
      transaction: row({
        type: 'balance_adjustment',
        amount: 50,
        adjustment: { delta: 50, updatedBy: 'm' },
      }) as never,
    });
    expect(balance(doc, 'chk')).toBe(1000);
    expect(tx(doc)).toBeDefined();
  });

  it('a missing account or goal is reported in `skipped`; the row still lands', () => {
    const { doc, result } = run(world(), {
      mode: 'create',
      transaction: row({
        accountId: 'gone',
        goalId: 'nope',
        goalAllocMode: 'fixed',
        goalAllocValue: 5,
      }) as never,
    });
    expect(tx(doc)).toBeDefined();
    expect(result.skipped).toEqual([
      { kind: 'account', id: 'gone' },
      { kind: 'goal', id: 'nope' },
    ]);
  });

  it('malformed args throw and commit nothing', () => {
    const before = world();
    expect(() =>
      run(before, { mode: 'create', transaction: row({ amount: Number.NaN }) as never })
    ).toThrow(/amount/);
    expect(() => run(before, { mode: 'nope' } as never)).toThrow(/unknown mode/);
  });
});

// ─── Update ──────────────────────────────────────────────────────────────────

describe('update', () => {
  const seededWithLoanRow = (): Doc =>
    run(world(), {
      mode: 'create',
      transaction: row({
        amount: 500,
        goalId: 'g',
        goalAllocMode: 'fixed',
        goalAllocValue: 50,
        loanId: 'car-loan',
        recurringItemId: 'r1',
      }) as never,
    }).doc;

  it('a description-only edit patches the row and leaves the goal, the loan and the portions untouched', () => {
    const before = seededWithLoanRow();
    const portions = {
      loanInterestPortion: tx(before)!.loanInterestPortion,
      loanPrincipalPortion: tx(before)!.loanPrincipalPortion,
    };
    const { doc, result } = run(before, {
      mode: 'update',
      id: 't1',
      patch: { description: 'renamed', isReconciled: true },
      updatedAt: '2026-10-04T00:00:00.000Z',
    });
    expect(tx(doc)).toMatchObject({ description: 'renamed', isReconciled: true, ...portions });
    expect(tx(doc)!.updatedAt).toBe('2026-10-04T00:00:00.000Z');
    expect(goalAmount(doc)).toBe(goalAmount(before));
    expect(balance(doc, 'car-loan')).toBe(balance(before, 'car-loan'));
    expect(balance(doc, 'chk')).toBe(balance(before, 'chk'));
    expect(result.accounts).toEqual([]);
    expect(result.goals).toEqual([]);
  });

  it('an all-unchanged edit writes nothing (heads untouched)', () => {
    const before = seededWithLoanRow();
    const { doc } = run(before, {
      mode: 'update',
      id: 't1',
      patch: { description: 'one' },
      updatedAt: '2026-10-04T00:00:00.000Z',
    });
    expect(getHeads(doc)).toEqual(getHeads(before));
  });

  it('an amount edit reverses the stored effects and re-applies on the new amount', () => {
    const before = seededWithLoanRow();
    // 500 recurring on 2000 @ 1%/mo: interest 20, principal 480 → 1520.
    expect(balance(before, 'car-loan')).toBe(1520);
    const { doc } = run(before, {
      mode: 'update',
      id: 't1',
      patch: { amount: 300 },
      updatedAt: '2026-10-04T00:00:00.000Z',
    });
    expect(balance(doc, 'chk')).toBe(700);
    // Reversed to 2000, then 300: interest 20, principal 280 → 1720.
    expect(balance(doc, 'car-loan')).toBe(1720);
    expect(tx(doc)).toMatchObject({
      amount: 300,
      loanInterestPortion: 20,
      loanPrincipalPortion: 280,
    });
    expect(goalAmount(doc)).toBe(150); // fixed 50 reversed and re-applied
  });

  it('switching the goal moves the allocation from the old goal to the new one', () => {
    const before = apply(
      seededWithLoanRow(),
      set('goals', { ...GOAL, id: 'g2', currentAmount: 0 })
    );
    const { doc } = run(before, {
      mode: 'update',
      id: 't1',
      patch: { goalId: 'g2' },
      updatedAt: '2026-10-04T00:00:00.000Z',
    });
    expect(goalAmount(doc)).toBe(100);
    expect(shown(doc, 'goals', 'g2')!.currentAmount).toBe(50);
  });

  it('derived fields in the patch are ignored; a clear in deleteKeys lands', () => {
    const before = seededWithLoanRow();
    const { doc } = run(before, {
      mode: 'update',
      id: 't1',
      patch: { goalAllocApplied: 9999, loanPrincipalPortion: 1 },
      deleteKeys: ['goalId', 'goalAllocMode', 'goalAllocValue'],
      updatedAt: '2026-10-04T00:00:00.000Z',
    });
    expect(tx(doc)!.goalId).toBeUndefined();
    expect(tx(doc)!.goalAllocApplied).toBeUndefined();
    expect(goalAmount(doc)).toBe(100); // the old allocation reversed
    expect(tx(doc)!.loanPrincipalPortion).toBe(480); // recomputed, not the patch's 1
  });

  it('a re-apply after reversing is not gated by the completion the reversed allocation caused', () => {
    // Fixed 900 completes the goal (100 + 900 = 1000) and marks it completed.
    const before = run(world(), {
      mode: 'create',
      transaction: row({
        amount: 1000,
        goalId: 'g',
        goalAllocMode: 'fixed',
        goalAllocValue: 900,
      }) as never,
    }).doc;
    expect(goalAmount(before)).toBe(1000);
    expect(shown(before, 'goals', 'g')!.isCompleted).toBe(true);
    const { doc } = run(before, {
      mode: 'update',
      id: 't1',
      patch: { amount: 1200 },
      updatedAt: '2026-10-04T00:00:00.000Z',
    });
    // Reversed to 100, then re-applied: the allocation is NOT dropped.
    expect(goalAmount(doc)).toBe(1000);
    expect(tx(doc)!.goalAllocApplied).toBe(900);
  });

  it('the completed gate still applies on create (a finished goal earns nothing new)', () => {
    const done = apply(world(), set('goals', { ...GOAL, currentAmount: 1000, isCompleted: true }));
    const { doc } = run(done, {
      mode: 'create',
      transaction: row({ goalId: 'g', goalAllocMode: 'fixed', goalAllocValue: 50 }) as never,
    });
    expect(goalAmount(doc)).toBe(1000);
    expect(tx(doc)!.goalAllocApplied).toBeUndefined();
  });

  it('relinking to another recurring item does not reverse or re-amortise', () => {
    const before = seededWithLoanRow();
    const { doc, result } = run(before, {
      mode: 'update',
      id: 't1',
      patch: { recurringItemId: 'r2' },
      updatedAt: '2026-10-04T00:00:00.000Z',
    });
    expect(tx(doc)!.recurringItemId).toBe('r2');
    expect(balance(doc, 'car-loan')).toBe(1520);
    expect(tx(doc)).toMatchObject({ loanInterestPortion: 20, loanPrincipalPortion: 480 });
    expect(result.accounts).toEqual([]);
  });

  it('unlinking the recurring item switches amortisation to an extra payment', () => {
    const before = seededWithLoanRow();
    const { doc } = run(before, {
      mode: 'update',
      id: 't1',
      patch: {},
      deleteKeys: ['recurringItemId'],
      updatedAt: '2026-10-04T00:00:00.000Z',
    });
    // Reversed to 2000, then 500 as an extra payment: all principal → 1500.
    expect(balance(doc, 'car-loan')).toBe(1500);
    expect(tx(doc)).toMatchObject({ loanInterestPortion: 0, loanPrincipalPortion: 500 });
  });

  it('a row deleted meanwhile: found false, nothing written', () => {
    const before = world();
    const { doc, result } = run(before, {
      mode: 'update',
      id: 'missing',
      patch: { description: 'x' },
      updatedAt: '2026-10-04T00:00:00.000Z',
    });
    expect(result.found).toBe(false);
    expect(getHeads(doc)).toEqual(getHeads(before));
  });
});

// ─── Delete ──────────────────────────────────────────────────────────────────

describe('delete', () => {
  it('reverses the balance, the goal and the loan from the STORED portions, then deletes the row', () => {
    const created = run(world(), {
      mode: 'create',
      transaction: row({
        amount: 500,
        goalId: 'g',
        goalAllocMode: 'fixed',
        goalAllocValue: 50,
        loanId: 'car-loan',
        recurringItemId: 'r1',
      }) as never,
    }).doc;
    // The rate changes after the payment: the reversal must still restore the STORED principal.
    const rateChanged = apply(created, {
      op: 'patch',
      collection: 'accounts',
      id: 'car-loan',
      patch: { interestRate: 60 },
    });
    const { doc, result } = run(rateChanged, { mode: 'delete', id: 't1' });
    expect(tx(doc)).toBeUndefined();
    expect(balance(doc, 'chk')).toBe(1000);
    expect(goalAmount(doc)).toBe(100);
    expect(balance(doc, 'car-loan')).toBe(2000);
    expect(result.found).toBe(true);
    expect(result.transaction).toBeUndefined();
  });

  it('a duplicate recurring instance is reversed when swept, not just removed', () => {
    const one = run(world(), {
      mode: 'create',
      transaction: row({ id: 'dup-a', recurringItemId: 'r1' }) as never,
    }).doc;
    const two = run(one, {
      mode: 'create',
      transaction: row({ id: 'dup-b', recurringItemId: 'r1' }) as never,
    }).doc;
    expect(balance(two, 'chk')).toBe(800);
    const { doc } = run(two, { mode: 'delete', id: 'dup-b' });
    expect(balance(doc, 'chk')).toBe(900);
    expect(tx(doc, 'dup-a')).toBeDefined();
  });

  /**
   * A merge-born duplicate pair: the kept twin `dup-a` written on one fork, the swept `dup-b`
   * on the other, each with its own build's switch (a mixed fleet), then merged.
   */
  function mergedPair(survivorCounter: boolean, deletedCounter: boolean): Doc {
    const { a, b } = fork(world());
    setCounterWrites(survivorCounter);
    const onA = run(a, {
      mode: 'create',
      transaction: row({ id: 'dup-a', recurringItemId: 'r1' }) as never,
    }).doc;
    setCounterWrites(deletedCounter);
    const onB = run(b, {
      mode: 'create',
      transaction: row({ id: 'dup-b', recurringItemId: 'r1' }) as never,
    }).doc;
    return converge(onA, onB).a;
  }

  // [survivor, deleted, balance after the merge, reversed]. An increment always adds to what
  // the other fork wrote, so any Counter twin means the balance moved twice; two absolutes
  // collapse to one by last-writer-wins and reversing would undo the survivor.
  it.each([
    ['counter', 'counter', 800, true],
    ['absolute', 'counter', 800, true],
    ['counter', 'absolute', 800, true],
    ['absolute', 'absolute', 900, false],
  ] as const)(
    'dedup decides per pair: survivor %s + deleted %s',
    (survivorKind, deletedKind, mergedBalance, expectReversed) => {
      // The deleting build's own switch decides nothing: run each pair under BOTH (a fresh
      // pair each time; a changed Automerge document cannot be changed again).
      for (const deleterOn of [false, true]) {
        const merged = mergedPair(survivorKind === 'counter', deletedKind === 'counter');
        expect(balance(merged, 'chk')).toBe(mergedBalance);
        setCounterWrites(deleterOn);
        const { doc, result } = run(merged, {
          mode: 'delete',
          id: 'dup-b',
          dedup: { survivorId: 'dup-a' },
        });
        expect(result.reversed).toBe(expectReversed);
        expect(result.skipped).toEqual([]);
        expect(tx(doc, 'dup-b')).toBeUndefined();
        expect(tx(doc, 'dup-a')).toBeDefined();
        expect(balance(doc, 'chk')).toBe(900);
      }
    }
  );

  it('dedup is decided per GROUP: a Counter survivor and TWO absolute twins reverse the absolute movement once (review round 1)', () => {
    // Three devices materialise one instance concurrently: A with writes on (kept), B and C dormant.
    // B and C both set the absolute, which collapses to ONE movement; A's increment is a second.
    const { a: forkA, b: rest } = fork(world());
    const { a: forkB, b: forkC } = fork(rest);
    setCounterWrites(true);
    const onA = run(forkA, {
      mode: 'create',
      transaction: row({ id: 'dup-a', recurringItemId: 'r1' }) as never,
    }).doc;
    setCounterWrites(false);
    const onB = run(forkB, {
      mode: 'create',
      transaction: row({ id: 'dup-b', recurringItemId: 'r1' }) as never,
    }).doc;
    const onC = run(forkC, {
      mode: 'create',
      transaction: row({ id: 'dup-c', recurringItemId: 'r1' }) as never,
    }).doc;
    const merged = converge(converge(onA, onB).a, onC).a;
    expect(balance(merged, 'chk')).toBe(800);
    // The first absolute twin goes without a reversal (another absolute twin still stands for
    // the shared movement); the last one carries the single reversal.
    const first = run(merged, { mode: 'delete', id: 'dup-b', dedup: { survivorId: 'dup-a' } });
    expect(first.result.reversed).toBe(false);
    expect(balance(first.doc, 'chk')).toBe(800);
    const last = run(first.doc, { mode: 'delete', id: 'dup-c', dedup: { survivorId: 'dup-a' } });
    expect(last.result.reversed).toBe(true);
    expect(balance(last.doc, 'chk')).toBe(900);
    expect(tx(last.doc, 'dup-a')).toBeDefined();
  });

  it('dedup whose survivor was deleted meanwhile: reported in `skipped`, the deleted row decides alone', () => {
    for (const deletedCounter of [true, false]) {
      setCounterWrites(deletedCounter);
      const created = run(world(), {
        mode: 'create',
        transaction: row({ id: 'dup-b', recurringItemId: 'r1' }) as never,
      }).doc;
      setCounterWrites(false);
      const { doc, result } = run(created, {
        mode: 'delete',
        id: 'dup-b',
        dedup: { survivorId: 'dup-a' },
      });
      expect(result.skipped).toEqual([{ kind: 'transaction', id: 'dup-a' }]);
      expect(result.reversed).toBe(deletedCounter);
      expect(tx(doc, 'dup-b')).toBeUndefined();
      expect(balance(doc, 'chk')).toBe(deletedCounter ? 1000 : 900);
    }
  });

  it('a malformed dedup throws and commits nothing', () => {
    const before = run(world(), { mode: 'create', transaction: row() as never }).doc;
    const del = (dedup: unknown) => () => run(before, { mode: 'delete', id: 't1', dedup } as never);
    expect(del(true)).toThrow(/survivorId/);
    expect(del({ survivorId: '' })).toThrow(/survivorId/);
    expect(del({ survivorId: 't1' })).toThrow(/OTHER twin/);
    expect(tx(before)).toBeDefined();
  });

  it('deleting a missing row is a no-op (found false)', () => {
    const before = world();
    const { doc, result } = run(before, { mode: 'delete', id: 'missing' });
    expect(result.found).toBe(false);
    expect(getHeads(doc)).toEqual(getHeads(before));
  });
});

// ─── balanceEffect ───────────────────────────────────────────────────────────

describe('balanceEffect (the per-pair dedup stamp)', () => {
  const create = (extra: AnyRec = {}): Doc =>
    run(world(), { mode: 'create', transaction: row(extra) as never }).doc;
  const update = (doc: Doc, patch: AnyRec, deleteKeys?: string[]): Doc =>
    run(doc, {
      mode: 'update',
      id: 't1',
      patch,
      ...(deleteKeys ? { deleteKeys } : {}),
      updatedAt: '2026-10-04T00:00:00.000Z',
    }).doc;

  it('is stamped when the movements land as Counter increments (writes on)', () => {
    setCounterWrites(true);
    expect(tx(create())!.balanceEffect).toBe('counter');
    // A loan payment (balance, loan host) is stamped the same way.
    expect(tx(create({ loanId: 'car-loan' }))!.balanceEffect).toBe('counter');
  });

  it('is absent under writes off, and when nothing was written under writes on', () => {
    setCounterWrites(false);
    expect(tx(create())!).not.toHaveProperty('balanceEffect');
    setCounterWrites(true);
    // A sub-minor-unit amount writes no increment; a balance adjustment has no effects.
    expect(tx(create({ amount: 0.001 }))!).not.toHaveProperty('balanceEffect');
    expect(tx(create({ type: 'balance_adjustment' }))!).not.toHaveProperty('balanceEffect');
  });

  it('is never accepted from main: a create or a patch carrying it is stripped', () => {
    setCounterWrites(false);
    const created = create({ balanceEffect: 'counter' });
    expect(tx(created)!).not.toHaveProperty('balanceEffect');
    setCounterWrites(true);
    const stamped = create();
    expect(tx(update(stamped, { description: 'x' }, ['balanceEffect']))!.balanceEffect).toBe(
      'counter'
    );
  });

  it('is kept across a non-money update, whatever the switch reads now', () => {
    setCounterWrites(true);
    const stamped = create();
    setCounterWrites(false);
    const edited = update(stamped, { description: 'renamed' });
    expect(tx(edited)!.description).toBe('renamed');
    expect(tx(edited)!.balanceEffect).toBe('counter');
  });

  it('is recomputed across a money update from THAT application, never from the reversal', () => {
    setCounterWrites(true);
    const stamped = create();
    setCounterWrites(false);
    expect(tx(update(stamped, { amount: 300 }))!).not.toHaveProperty('balanceEffect');

    setCounterWrites(false);
    const absolute = create();
    const absoluteToo = create();
    setCounterWrites(true);
    expect(tx(update(absolute, { amount: 300 }))!.balanceEffect).toBe('counter');
    // Writes on, but the new amount moves nothing: the reversal's increments do not stamp it.
    expect(tx(update(absoluteToo, { amount: 0.001 }))!).not.toHaveProperty('balanceEffect');
  });
});

// ─── Loan mirror ─────────────────────────────────────────────────────────────

describe('asset loan mirror', () => {
  const payment = (): TransactionCascadeArgs => ({
    mode: 'create',
    transaction: row({ amount: 500, loanId: 'house', recurringItemId: 'r1' }) as never,
  });

  it('a payment moves the asset loan AND its linked account by the same principal, in one change', () => {
    const { doc, result } = run(world(), payment());
    // 500 on 10000 @ 1%/mo: interest 100, principal 400.
    expect(houseLoan(doc)).toBe(9600);
    expect(balance(doc, 'house-loan')).toBe(9600);
    expect(balance(doc, 'chk')).toBe(500);
    expect(tx(doc)).toMatchObject({ loanInterestPortion: 100, loanPrincipalPortion: 400 });
    expect(result.assets.map((a) => a.id)).toEqual(['house']);
    expect(result.accounts.map((a) => a.id).sort()).toEqual(['chk', 'house-loan']);
  });

  it('a delete restores both the asset loan and the mirror', () => {
    const paid = run(world(), payment()).doc;
    const { doc } = run(paid, { mode: 'delete', id: 't1' });
    expect(houseLoan(doc)).toBe(10000);
    expect(balance(doc, 'house-loan')).toBe(10000);
  });

  it('the mirror is relative: a concurrent edit of the mirror balance survives the merge (writes on)', () => {
    setCounterWrites(true);
    const { a, b } = fork(world());
    const paidA = run(a, payment()).doc;
    const editedB = apply(b, {
      op: 'increment',
      collection: 'accounts',
      id: 'house-loan',
      field: 'balance',
      delta: -50,
    });
    const merged = converge(paidA, editedB);
    expect(balance(merged.a, 'house-loan')).toBe(9550);
    expect(houseLoan(merged.a)).toBe(9600);
  });
});

// ─── Two devices ─────────────────────────────────────────────────────────────

describe('two devices (writes on)', () => {
  beforeEach(() => setCounterWrites(true));

  it('two concurrent cascades on one account both land after the merge', () => {
    const { a, b } = fork(world());
    const onA = run(a, {
      mode: 'create',
      transaction: row({ id: 'ta', amount: 100 }) as never,
    }).doc;
    const onB = run(b, {
      mode: 'create',
      transaction: row({ id: 'tb', amount: 30.25 }) as never,
    }).doc;
    const merged = converge(onA, onB);
    expect(balance(merged.a, 'chk')).toBe(869.75);
    expect(balance(merged.b, 'chk')).toBe(869.75);
    expect(tx(merged.a, 'ta')).toBeDefined();
    expect(tx(merged.a, 'tb')).toBeDefined();
  });

  it('a delete on one device and a concurrent payment on the other both land', () => {
    const base = run(world(), {
      mode: 'create',
      transaction: row({ amount: 500, loanId: 'house', recurringItemId: 'r1' }) as never,
    }).doc;
    const { a, b } = fork(base);
    const deletedA = run(a, { mode: 'delete', id: 't1' }).doc;
    const paidB = run(b, {
      mode: 'create',
      transaction: row({ id: 't2', amount: 500, loanId: 'house', recurringItemId: 'r1' }) as never,
    }).doc;
    const merged = converge(deletedA, paidB);
    // B amortised on 9600 (interest 96, principal 404) while A restored 400: 9600 − 404 + 400.
    expect(houseLoan(merged.a)).toBe(9596);
    expect(balance(merged.a, 'house-loan')).toBe(9596);
    expect(balance(merged.a, 'chk')).toBe(500);
  });
});
