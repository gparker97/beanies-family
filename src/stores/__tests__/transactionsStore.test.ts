import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Transaction, CreateTransactionInput } from '@/types/models';

vi.mock('@/services/automerge/repositories/transactionRepository', () => ({
  getAllTransactions: vi.fn().mockResolvedValue([]),
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
}));

vi.mock('@/stores/accountsStore', () => ({
  useAccountsStore: () => ({
    accounts: [],
    updateAccount: vi.fn(),
  }),
}));

vi.mock('@/stores/assetsStore', () => ({
  useAssetsStore: () => ({ assets: [] }),
}));

vi.mock('@/stores/goalsStore', () => ({
  useGoalsStore: () => ({ goals: [], updateGoal: vi.fn() }),
}));

vi.mock('@/stores/memberFilterStore', () => ({
  useMemberFilterStore: () => ({
    getSelectedMemberAccountIds: () => new Set<string>(),
    isAllSelected: true,
  }),
}));

import { useTransactionsStore } from '../transactionsStore';
import * as transactionRepo from '@/services/automerge/repositories/transactionRepository';

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: `tx-${Math.random().toString(36).slice(2, 8)}`,
    accountId: 'acc-1',
    type: 'expense',
    amount: 10,
    currency: 'USD',
    category: 'groceries',
    date: '2026-04-21',
    description: 'Test',
    isReconciled: false,
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z',
    ...overrides,
  };
}

describe('transactionsStore — transactionsForAccount', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('returns transactions where the account is the source', () => {
    const store = useTransactionsStore();
    store.transactions.push(
      tx({ id: 't1', accountId: 'acc-1' }),
      tx({ id: 't2', accountId: 'acc-2' }),
      tx({ id: 't3', accountId: 'acc-1' })
    );

    const result = store.transactionsForAccount('acc-1');
    expect(result.map((t) => t.id).sort()).toEqual(['t1', 't3']);
  });

  it('includes transfers where the account is the destination', () => {
    const store = useTransactionsStore();
    store.transactions.push(
      tx({ id: 't1', accountId: 'acc-2', toAccountId: 'acc-1', type: 'transfer' }),
      tx({ id: 't2', accountId: 'acc-1' })
    );

    const result = store.transactionsForAccount('acc-1');
    expect(result.map((t) => t.id).sort()).toEqual(['t1', 't2']);
  });

  it('sorts descending by date, breaking ties by createdAt', () => {
    const store = useTransactionsStore();
    store.transactions.push(
      tx({
        id: 'old',
        accountId: 'acc-1',
        date: '2026-04-18',
        createdAt: '2026-04-18T10:00:00.000Z',
      }),
      tx({
        id: 'newA',
        accountId: 'acc-1',
        date: '2026-04-21',
        createdAt: '2026-04-21T09:00:00.000Z',
      }),
      tx({
        id: 'newB',
        accountId: 'acc-1',
        date: '2026-04-21',
        createdAt: '2026-04-21T11:00:00.000Z',
      })
    );

    const result = store.transactionsForAccount('acc-1');
    expect(result.map((t) => t.id)).toEqual(['newB', 'newA', 'old']);
  });

  it('includes balance_adjustment rows', () => {
    const store = useTransactionsStore();
    store.transactions.push(
      tx({
        id: 'adj1',
        accountId: 'acc-1',
        type: 'balance_adjustment',
        amount: 100,
        category: '',
        isReconciled: true,
        adjustment: { delta: 100, updatedBy: 'member-1' },
      })
    );

    const result = store.transactionsForAccount('acc-1');
    expect(result.map((t) => t.id)).toEqual(['adj1']);
  });

  it('returns empty when the account has no transactions', () => {
    const store = useTransactionsStore();
    store.transactions.push(tx({ accountId: 'acc-other' }));
    expect(store.transactionsForAccount('acc-1')).toEqual([]);
  });
});

describe('transactionsStore — createTransaction balance_adjustment invariants', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('forces isReconciled: true for balance_adjustment type', async () => {
    const store = useTransactionsStore();
    vi.mocked(transactionRepo.createTransaction).mockImplementation(async (input) => ({
      ...input,
      id: 'adj-new',
      createdAt: '2026-04-21T00:00:00.000Z',
      updatedAt: '2026-04-21T00:00:00.000Z',
    }));

    const input: CreateTransactionInput = {
      accountId: 'acc-1',
      type: 'balance_adjustment',
      amount: 50,
      currency: 'USD',
      category: '',
      date: '2026-04-21',
      description: 'Balance adjusted',
      isReconciled: false, // caller tries to set false; invariant must flip it
      adjustment: { delta: 50, updatedBy: 'member-1' },
    };

    await store.createTransaction(input);

    expect(transactionRepo.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ isReconciled: true })
    );
  });

  it('preserves caller isReconciled for income/expense transactions', async () => {
    const store = useTransactionsStore();
    vi.mocked(transactionRepo.createTransaction).mockImplementation(async (input) => ({
      ...input,
      id: 'tx-new',
      createdAt: '2026-04-21T00:00:00.000Z',
      updatedAt: '2026-04-21T00:00:00.000Z',
    }));

    await store.createTransaction({
      accountId: 'acc-1',
      type: 'expense',
      amount: 20,
      currency: 'USD',
      category: 'food',
      date: '2026-04-21',
      description: 'Lunch',
      isReconciled: false,
    });

    expect(transactionRepo.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ isReconciled: false })
    );
  });
});

describe('transactionsStore — aggregates exclude balance_adjustment', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('thisMonthIncome / thisMonthExpenses ignore balance_adjustment rows', () => {
    const store = useTransactionsStore();
    const thisMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    store.transactions.push(
      tx({ type: 'income', amount: 100, date: `${thisMonth}-10`, currency: 'USD' }),
      tx({ type: 'expense', amount: 30, date: `${thisMonth}-11`, currency: 'USD' }),
      tx({
        type: 'balance_adjustment',
        amount: 999,
        date: `${thisMonth}-12`,
        currency: 'USD',
        category: '',
        adjustment: { delta: 999, updatedBy: 'm1' },
      })
    );

    expect(store.thisMonthIncome).toBe(100);
    expect(store.thisMonthExpenses).toBe(30);
    expect(store.thisMonthNetCashFlow).toBe(70);
  });
});
