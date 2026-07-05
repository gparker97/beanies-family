import { describe, it, expect, beforeEach } from 'vitest';
import * as Automerge from '@automerge/automerge';
import type { FamilyDocument } from '@/types/automerge';
import {
  migrateDoc,
  loadDoc,
  saveDoc,
  mergeDocs,
  applyMutation,
  materializeCollection,
  buildFullProjection,
  registerNamedOp,
  __resetNamedOpsForTesting,
} from '../docOps';
import type { ProjectionDelta } from '../protocol';

type Doc = Automerge.Doc<FamilyDocument>;
const base = (): Doc => migrateDoc(Automerge.init<FamilyDocument>());
const txn = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  amount: 10,
  updatedAt: '2026-01-01',
  ...extra,
});

describe('docOps — lifecycle', () => {
  it('migrate adds all missing collections; load/save round-trips', () => {
    const d = base();
    expect(d.transactions).toEqual({});
    expect(d.settings ?? null).toBeNull();
    const withOne = applyMutation(d, {
      op: 'set',
      collection: 'transactions',
      id: 't1',
      entity: txn('t1'),
    }).doc;
    const reloaded = loadDoc(saveDoc(withOne));
    expect(materializeCollection(reloaded, 'transactions')).toEqual([['t1', txn('t1')]]);
  });
});

describe('docOps — mutations', () => {
  it('set → upsert delta + entity result', () => {
    const { delta, result } = applyMutation(base(), {
      op: 'set',
      collection: 'accounts',
      id: 'a1',
      entity: { id: 'a1', balance: 100 },
    });
    expect(delta).toEqual({
      kind: 'upsert',
      collection: 'accounts',
      id: 'a1',
      entity: { id: 'a1', balance: 100 },
    });
    expect(result).toEqual({ id: 'a1', balance: 100 });
  });

  it('patch merges fields, honours deleteKeys + updatedAt', () => {
    let d = applyMutation(base(), {
      op: 'set',
      collection: 'todos',
      id: 'x',
      entity: { id: 'x', title: 'old', stale: 1 },
    }).doc;
    const { doc, delta } = applyMutation(d, {
      op: 'patch',
      collection: 'todos',
      id: 'x',
      patch: { title: 'new' },
      deleteKeys: ['stale'],
      updatedAt: '2026-02-02',
    });
    d = doc;
    expect(materializeCollection(d, 'todos')[0]![1]).toEqual({
      id: 'x',
      title: 'new',
      updatedAt: '2026-02-02',
    });
    expect((delta as { entity: unknown }).entity).toEqual({
      id: 'x',
      title: 'new',
      updatedAt: '2026-02-02',
    });
  });

  it('delete → remove delta', () => {
    const d = applyMutation(base(), {
      op: 'set',
      collection: 'goals',
      id: 'g',
      entity: { id: 'g' },
    }).doc;
    const { doc, delta } = applyMutation(d, { op: 'delete', collection: 'goals', id: 'g' });
    expect(materializeCollection(doc, 'goals')).toEqual([]);
    expect(delta).toEqual({ kind: 'remove', collection: 'goals', id: 'g' });
  });

  it('increment is an atomic read-modify-write (reads the CURRENT value each time)', () => {
    let d = applyMutation(base(), {
      op: 'set',
      collection: 'accounts',
      id: 'a',
      entity: { id: 'a', balance: 100 },
    }).doc;
    d = applyMutation(d, {
      op: 'increment',
      collection: 'accounts',
      id: 'a',
      field: 'balance',
      delta: -10,
    }).doc;
    const { doc, result } = applyMutation(d, {
      op: 'increment',
      collection: 'accounts',
      id: 'a',
      field: 'balance',
      delta: -10,
    });
    // 100 → 90 → 80 (each increment reads the current balance, not a stale absolute)
    expect((materializeCollection(doc, 'accounts')[0]![1] as { balance: number }).balance).toBe(80);
    expect((result as { balance: number }).balance).toBe(80);
  });

  it('batch is one atomic change → multi delta', () => {
    const d = applyMutation(base(), {
      op: 'set',
      collection: 'accounts',
      id: 'a',
      entity: { id: 'a', balance: 50 },
    }).doc;
    const { doc, delta } = applyMutation(d, {
      op: 'batch',
      ops: [
        { op: 'set', collection: 'transactions', id: 't', entity: txn('t') },
        { op: 'increment', collection: 'accounts', id: 'a', field: 'balance', delta: 10 },
      ],
    });
    expect(materializeCollection(doc, 'transactions')).toHaveLength(1);
    expect((materializeCollection(doc, 'accounts')[0]![1] as { balance: number }).balance).toBe(60);
    expect(delta.kind).toBe('multi');
    expect((delta as { deltas: ProjectionDelta[] }).deltas).toHaveLength(2);
  });

  it('a mid-batch failure commits NOTHING (atomicity)', () => {
    const d = base();
    expect(() =>
      applyMutation(d, {
        op: 'batch',
        ops: [
          { op: 'set', collection: 'transactions', id: 't', entity: txn('t') },
          { op: 'patch', collection: 'transactions', id: 'missing', patch: { x: 1 } }, // throws
        ],
      })
    ).toThrow(/not found/);
    // The original doc is untouched — the valid `set` did not leak through.
    expect(materializeCollection(d, 'transactions')).toEqual([]);
  });
});

describe('docOps — merge dirty (heads-derived)', () => {
  it('remote-ahead + local-clean → dirty false', () => {
    const b = base();
    const local = Automerge.clone(b);
    const remote = applyMutation(Automerge.clone(b), {
      op: 'set',
      collection: 'todos',
      id: 'r',
      entity: { id: 'r' },
    }).doc;
    const { dirty } = mergeDocs(local, remote);
    expect(dirty).toBe(false);
  });

  it('local carries an unsynced change → dirty true', () => {
    const b = base();
    const local = applyMutation(Automerge.clone(b), {
      op: 'set',
      collection: 'todos',
      id: 'l',
      entity: { id: 'l' },
    }).doc;
    const remote = Automerge.clone(b);
    const { dirty } = mergeDocs(local, remote);
    expect(dirty).toBe(true);
  });
});

describe('docOps — projection + named ops', () => {
  beforeEach(() => __resetNamedOpsForTesting());

  it('buildFullProjection emits a bulk-reset per collection + settings', () => {
    const d = applyMutation(base(), {
      op: 'set',
      collection: 'transactions',
      id: 't',
      entity: txn('t'),
    }).doc;
    const deltas = buildFullProjection(d);
    const txnDelta = deltas.find((x) => x.kind === 'bulk' && x.collection === 'transactions');
    expect(txnDelta).toMatchObject({ kind: 'bulk', reset: true, entities: [['t', txn('t')]] });
    expect(deltas.some((x) => x.kind === 'settings')).toBe(true);
  });

  it('patch createIfMissing inits an absent two-level slice (notificationReads)', () => {
    // Without the flag, patching an absent target throws.
    expect(() =>
      applyMutation(base(), {
        op: 'patch',
        collection: 'notificationReads',
        id: 'm1',
        patch: { n1: '2026-01-01' },
      })
    ).toThrow(/not found/);
    // With it, the member sub-map is created then the keys applied.
    const { doc } = applyMutation(base(), {
      op: 'patch',
      collection: 'notificationReads',
      id: 'm1',
      patch: { n1: '2026-01-01' },
      createIfMissing: true,
    });
    expect(materializeCollection(doc, 'notificationReads')).toEqual([['m1', { n1: '2026-01-01' }]]);
  });

  it('named op runs its registered handler and contributes its delta', () => {
    registerNamedOp('tagTodo', (draft, args) => {
      const id = args.id as string;
      (draft.todos as unknown as Record<string, Record<string, unknown>>)[id]!.tagged = true;
      return {
        deltas: [{ kind: 'upsert', collection: 'todos', id, entity: { id, tagged: true } }],
      };
    });
    const d = applyMutation(base(), {
      op: 'set',
      collection: 'todos',
      id: 'x',
      entity: { id: 'x' },
    }).doc;
    const { doc, delta } = applyMutation(d, { op: 'named', name: 'tagTodo', args: { id: 'x' } });
    expect((materializeCollection(doc, 'todos')[0]![1] as { tagged: boolean }).tagged).toBe(true);
    expect(delta).toEqual({
      kind: 'upsert',
      collection: 'todos',
      id: 'x',
      entity: { id: 'x', tagged: true },
    });
  });
});

describe('docOps — core domain named ops (financial atomic RMW)', () => {
  const goal = (extra: Record<string, unknown> = {}) => ({
    id: 'g',
    currentAmount: 50,
    targetAmount: 100,
    isCompleted: false,
    updatedAt: '2026-01-01',
    ...extra,
  });

  it('applyGoalContribution adds, and a top-level named op returns the echoed entity', () => {
    const d = applyMutation(base(), {
      op: 'set',
      collection: 'goals',
      id: 'g',
      entity: goal(),
    }).doc;
    const { doc, result, delta } = applyMutation(d, {
      op: 'named',
      name: 'applyGoalContribution',
      args: { id: 'g', delta: 30 },
    });
    expect((result as { currentAmount: number }).currentAmount).toBe(80);
    expect((result as { isCompleted: boolean }).isCompleted).toBe(false);
    expect(delta).toMatchObject({ kind: 'upsert', collection: 'goals', id: 'g' });
    expect(
      (materializeCollection(doc, 'goals')[0]![1] as { currentAmount: number }).currentAmount
    ).toBe(80);
  });

  it('applyGoalContribution auto-completes at target and floors at 0', () => {
    // Auto-complete: 50 → 110 ≥ target 100.
    const d0 = applyMutation(base(), {
      op: 'set',
      collection: 'goals',
      id: 'g',
      entity: goal(),
    }).doc;
    const completed = applyMutation(d0, {
      op: 'named',
      name: 'applyGoalContribution',
      args: { id: 'g', delta: 60 },
    });
    expect(completed.result as { currentAmount: number; isCompleted: boolean }).toMatchObject({
      currentAmount: 110,
      isCompleted: true,
    });
    // Floor (fresh doc — Automerge freezes a doc once changed): a big reversal
    // cannot drive the amount negative.
    const d1 = applyMutation(base(), {
      op: 'set',
      collection: 'goals',
      id: 'g',
      entity: goal(),
    }).doc;
    const floored = applyMutation(d1, {
      op: 'named',
      name: 'applyGoalContribution',
      args: { id: 'g', delta: -500 },
    }).doc;
    expect(
      (materializeCollection(floored, 'goals')[0]![1] as { currentAmount: number }).currentAmount
    ).toBe(0);
  });

  it('applyLoanPayment amortizes an account-backed loan and reverse restores it', () => {
    const acct = { id: 'acc', type: 'loan', balance: 1000, interestRate: 12, currency: 'USD' };
    let d = applyMutation(base(), {
      op: 'set',
      collection: 'accounts',
      id: 'acc',
      entity: acct,
    }).doc;
    const pay = applyMutation(d, {
      op: 'named',
      name: 'applyLoanPayment',
      args: { loanId: 'acc', paymentAmount: 100, isRecurring: true },
    });
    // monthlyRate 0.01 → interest 10, principal 90, newBalance 910
    expect(pay.result).toMatchObject({
      applied: true,
      hostCollection: 'accounts',
      interestPortion: 10,
      principalPortion: 90,
    });
    d = pay.doc;
    expect((materializeCollection(d, 'accounts')[0]![1] as { balance: number }).balance).toBe(910);

    const rev = applyMutation(d, {
      op: 'named',
      name: 'reverseLoanPayment',
      args: { loanId: 'acc', principalToRestore: 90 },
    });
    expect((materializeCollection(rev.doc, 'accounts')[0]![1] as { balance: number }).balance).toBe(
      1000
    );
  });

  it('applyLoanPayment writes the NESTED asset-loan balance (extra payment)', () => {
    const asset = {
      id: 'ast',
      name: 'Car',
      currency: 'USD',
      loan: { hasLoan: true, outstandingBalance: 5000, interestRate: 6, monthlyPayment: 200 },
    };
    const d = applyMutation(base(), {
      op: 'set',
      collection: 'assets',
      id: 'ast',
      entity: asset,
    }).doc;
    const { doc, result } = applyMutation(d, {
      op: 'named',
      name: 'applyLoanPayment',
      args: { loanId: 'ast', paymentAmount: 200, isRecurring: false },
    });
    expect((result as { principalPortion: number }).principalPortion).toBe(200);
    const host = materializeCollection(doc, 'assets')[0]![1] as {
      loan: { outstandingBalance: number };
    };
    expect(host.loan.outstandingBalance).toBe(4800);
  });

  it('applyLoanPayment on an unknown/paid-off loan is a no-op (applied:false)', () => {
    const { result, delta } = applyMutation(base(), {
      op: 'named',
      name: 'applyLoanPayment',
      args: { loanId: 'missing', paymentAmount: 100, isRecurring: true },
    });
    expect(result).toEqual({ applied: false });
    expect(delta).toEqual({ kind: 'multi', deltas: [] });
  });
});
