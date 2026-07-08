import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Account, CurrencyCode } from '@/types/models';

// Shared mutable mock state (hoisted so the vi.mock factories can read it).
const h = vi.hoisted(() => {
  const state = {
    accounts: [] as Account[],
    exchangeRates: [] as { from: string; to: string; rate: number; updatedAt: string }[],
  };
  const incrementBalance = vi.fn(async (id: string, delta: number) => {
    const a = state.accounts.find((x) => x.id === id);
    if (a) a.balance += delta;
  });
  return { state, incrementBalance };
});

vi.mock('@/stores/accountsStore', () => ({
  useAccountsStore: () => ({ accounts: h.state.accounts, incrementBalance: h.incrementBalance }),
}));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({ exchangeRates: h.state.exchangeRates, baseCurrency: 'USD' }),
}));
vi.mock('@/stores/assetsStore', () => ({
  useAssetsStore: () => ({ assets: [], applyEchoed: vi.fn() }),
}));
vi.mock('@/stores/goalsStore', () => ({
  useGoalsStore: () => ({ goals: [], applyContribution: vi.fn() }),
}));
vi.mock('@/stores/memberFilterStore', () => ({
  useMemberFilterStore: () => ({
    getSelectedMemberAccountIds: () => new Set<string>(),
    isAllSelected: true,
  }),
}));
vi.mock('@/composables/useCelebration', () => ({ celebrate: vi.fn() }));
vi.mock('@/services/automerge/worker/docClient', () => ({ mutate: vi.fn() }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

// Persistence: a simple in-memory registry so update/delete merge correctly.
const persisted = new Map<string, Record<string, unknown>>();
let idSeq = 0;
vi.mock('@/services/automerge/repositories/transactionRepository', () => ({
  getAllTransactions: vi.fn().mockResolvedValue([]),
  createTransaction: vi.fn(async (input: Record<string, unknown>) => {
    const t = { ...input, id: `tx-${++idSeq}`, createdAt: 'x', updatedAt: 'x' };
    persisted.set(t.id as string, t);
    return t;
  }),
  updateTransaction: vi.fn(async (id: string, input: Record<string, unknown>) => {
    const merged = { ...persisted.get(id), ...input, updatedAt: 'y' };
    persisted.set(id, merged);
    return merged;
  }),
  deleteTransaction: vi.fn(async () => true),
}));

import { useTransactionsStore } from '../transactionsStore';
import { reportError } from '@/utils/errorReporter';

function acc(overrides: Partial<Account>): Account {
  return {
    id: 'acc',
    memberId: 'm-1',
    name: 'Acc',
    type: 'checking',
    currency: 'SGD',
    balance: 0,
    isActive: true,
    includeInNetWorth: true,
    createdAt: 'x',
    updatedAt: 'x',
    ...overrides,
  };
}
const bal = (id: string) => h.state.accounts.find((a) => a.id === id)!.balance;

describe('transactionsStore — balance cascade (transfers + liability signs)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    persisted.clear();
    idSeq = 0;
    h.state.accounts = [
      acc({ id: 'chk', type: 'checking', currency: 'SGD', balance: 1000 }),
      acc({ id: 'sav', type: 'savings', currency: 'SGD', balance: 0 }),
      acc({ id: 'card', type: 'credit_card', currency: 'USD', balance: 500 }), // owed
      acc({ id: 'yen', type: 'savings', currency: 'JPY', balance: 0 }),
    ];
    h.state.exchangeRates = [
      { from: 'SGD', to: 'USD', rate: 0.744, updatedAt: 'x' },
      // deliberately NO SGD→JPY rate
    ];
  });

  const base = {
    currency: 'SGD' as CurrencyCode,
    category: '',
    date: '2026-07-08',
    description: '',
    isReconciled: false,
  };

  it('same-currency transfer moves both balances', async () => {
    const store = useTransactionsStore();
    await store.createTransaction({
      ...base,
      type: 'transfer',
      accountId: 'chk',
      toAccountId: 'sav',
      amount: 100,
    });
    expect(bal('chk')).toBe(900);
    expect(bal('sav')).toBe(100);
  });

  it('cross-currency card payoff: source debited raw, card owed reduced by the converted amount', async () => {
    const store = useTransactionsStore();
    await store.createTransaction({
      ...base,
      type: 'transfer',
      accountId: 'chk',
      toAccountId: 'card',
      amount: 100,
    });
    expect(bal('chk')).toBe(900); // -100 SGD
    expect(bal('card')).toBeCloseTo(425.6, 5); // 500 - (100 * 0.744) owed
    // toAmount persisted for drift-free reversal
    const created = persisted.get('tx-1')!;
    expect(created.toAmount).toBeCloseTo(74.4, 5);
  });

  it('expense on a credit card (purchase) increases what is owed', async () => {
    const store = useTransactionsStore();
    await store.createTransaction({
      ...base,
      currency: 'USD',
      type: 'expense',
      accountId: 'card',
      amount: 50,
    });
    expect(bal('card')).toBe(550); // owed up
  });

  it('income on a credit card (refund) decreases what is owed', async () => {
    const store = useTransactionsStore();
    await store.createTransaction({
      ...base,
      currency: 'USD',
      type: 'income',
      accountId: 'card',
      amount: 50,
    });
    expect(bal('card')).toBe(450); // owed down
  });

  it('blocks a transfer with no exchange rate: nothing persisted, no balance moved, error reported', async () => {
    const store = useTransactionsStore();
    const result = await store.createTransaction({
      ...base,
      type: 'transfer',
      accountId: 'chk',
      toAccountId: 'yen',
      amount: 100,
    });
    expect(result).toBeNull();
    expect(bal('chk')).toBe(1000); // untouched
    expect(bal('yen')).toBe(0);
    expect(persisted.size).toBe(0);
    expect(vi.mocked(reportError)).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'transactions.transfer-missing-rate' })
    );
  });

  it('editing an unrelated field (description) does not drift a cross-currency transfer', async () => {
    const store = useTransactionsStore();
    const created = await store.createTransaction({
      ...base,
      type: 'transfer',
      accountId: 'chk',
      toAccountId: 'card',
      amount: 100,
    });
    const chkAfter = bal('chk');
    const cardAfter = bal('card');
    await store.updateTransaction(created!.id, { description: 'renamed' });
    expect(bal('chk')).toBeCloseTo(chkAfter, 5); // reverse+reapply nets zero
    expect(bal('card')).toBeCloseTo(cardAfter, 5);
  });

  it('editing the amount re-converts and rebalances by the delta', async () => {
    const store = useTransactionsStore();
    const created = await store.createTransaction({
      ...base,
      type: 'transfer',
      accountId: 'chk',
      toAccountId: 'card',
      amount: 100,
    });
    await store.updateTransaction(created!.id, { amount: 200 });
    expect(bal('chk')).toBe(800); // 1000 - 200
    expect(bal('card')).toBeCloseTo(500 - 200 * 0.744, 5); // owed reduced by converted 200
  });

  it('deleting a transfer reverses both legs', async () => {
    const store = useTransactionsStore();
    const created = await store.createTransaction({
      ...base,
      type: 'transfer',
      accountId: 'chk',
      toAccountId: 'card',
      amount: 100,
    });
    await store.deleteTransaction(created!.id);
    expect(bal('chk')).toBe(1000);
    expect(bal('card')).toBeCloseTo(500, 5);
  });
});
