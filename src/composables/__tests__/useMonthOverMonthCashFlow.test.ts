import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Transaction } from '@/types/models';

// Stable test "now" — first day of April 2026, so "last month" is March 2026.
const NOW = new Date('2026-04-15T12:00:00Z');

const transactionsState = {
  filteredTransactions: [] as Transaction[],
  filteredThisMonthOneTimeIncome: 0,
  filteredThisMonthOneTimeExpenses: 0,
};
vi.mock('@/stores/transactionsStore', () => ({
  useTransactionsStore: () => transactionsState,
}));

const recurringState = {
  filteredTotalMonthlyRecurringIncome: 0,
  filteredTotalMonthlyRecurringExpenses: 0,
};
vi.mock('@/stores/recurringStore', () => ({
  useRecurringStore: () => recurringState,
}));

const settingsState = {
  baseCurrency: 'USD',
  exchangeRates: [] as Array<{ from: string; to: string; rate: number }>,
};
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => settingsState,
}));

import { useMonthOverMonthCashFlow } from '../useMonthOverMonthCashFlow';

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: `tx-${Math.random().toString(36).slice(2, 8)}`,
    accountId: 'acc-1',
    type: 'expense',
    amount: 100,
    currency: 'USD',
    category: 'food',
    date: '2026-03-15',
    description: '',
    isReconciled: false,
    createdAt: '2026-03-15T00:00:00.000Z',
    updatedAt: '2026-03-15T00:00:00.000Z',
    ...overrides,
  };
}

describe('useMonthOverMonthCashFlow', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    transactionsState.filteredTransactions = [];
    transactionsState.filteredThisMonthOneTimeIncome = 0;
    transactionsState.filteredThisMonthOneTimeExpenses = 0;
    recurringState.filteredTotalMonthlyRecurringIncome = 0;
    recurringState.filteredTotalMonthlyRecurringExpenses = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lastMonthIncome sums one-time income from previous calendar month plus recurring monthly', () => {
    transactionsState.filteredTransactions = [
      tx({ type: 'income', amount: 500, date: '2026-03-10' }),
      tx({ type: 'income', amount: 200, date: '2026-03-25' }),
      tx({ type: 'income', amount: 999, date: '2026-04-01' }), // current month — excluded
    ];
    recurringState.filteredTotalMonthlyRecurringIncome = 1000;

    const { lastMonthIncome } = useMonthOverMonthCashFlow();
    expect(lastMonthIncome.value).toBe(500 + 200 + 1000);
  });

  it('lastMonthExpenses excludes recurring-derived transactions to avoid double-counting', () => {
    transactionsState.filteredTransactions = [
      tx({ type: 'expense', amount: 100, date: '2026-03-10' }),
      tx({ type: 'expense', amount: 50, date: '2026-03-15', recurringItemId: 'r-1' }),
    ];
    recurringState.filteredTotalMonthlyRecurringExpenses = 800;

    const { lastMonthExpenses } = useMonthOverMonthCashFlow();
    // Recurring-tagged tx (50) excluded; recurring monthly (800) added.
    expect(lastMonthExpenses.value).toBe(100 + 800);
  });

  it('lastMonthCashFlow = income − expenses', () => {
    transactionsState.filteredTransactions = [
      tx({ type: 'income', amount: 1000, date: '2026-03-10' }),
      tx({ type: 'expense', amount: 600, date: '2026-03-12' }),
    ];

    const { lastMonthCashFlow } = useMonthOverMonthCashFlow();
    expect(lastMonthCashFlow.value).toBe(400);
  });

  it('incomeChange = thisMonth income − lastMonth income', () => {
    transactionsState.filteredTransactions = [
      tx({ type: 'income', amount: 700, date: '2026-03-10' }),
    ];
    transactionsState.filteredThisMonthOneTimeIncome = 1200;

    const { incomeChange } = useMonthOverMonthCashFlow();
    expect(incomeChange.value).toBe(1200 - 700);
  });

  it('expenseChange = thisMonth expenses − lastMonth expenses', () => {
    transactionsState.filteredTransactions = [
      tx({ type: 'expense', amount: 300, date: '2026-03-10' }),
    ];
    transactionsState.filteredThisMonthOneTimeExpenses = 250;

    const { expenseChange } = useMonthOverMonthCashFlow();
    expect(expenseChange.value).toBe(250 - 300);
  });

  it('cashFlowChange = (this income − this expenses) − (last income − last expenses)', () => {
    transactionsState.filteredTransactions = [
      tx({ type: 'income', amount: 1000, date: '2026-03-10' }),
      tx({ type: 'expense', amount: 600, date: '2026-03-12' }),
    ];
    transactionsState.filteredThisMonthOneTimeIncome = 1500;
    transactionsState.filteredThisMonthOneTimeExpenses = 700;

    const { cashFlowChange } = useMonthOverMonthCashFlow();
    // last cash flow: 400; this cash flow: 800; change: +400
    expect(cashFlowChange.value).toBe(400);
  });

  it('balance_adjustment + transfer in last month do NOT count toward income or expenses', () => {
    transactionsState.filteredTransactions = [
      tx({
        type: 'balance_adjustment',
        amount: 500,
        date: '2026-03-10',
        adjustment: { delta: 500, updatedBy: 'm-1' },
      }),
      tx({ type: 'transfer', amount: 300, date: '2026-03-12', toAccountId: 'acc-2' }),
      tx({ type: 'expense', amount: 50, date: '2026-03-13' }),
    ];

    const { lastMonthExpenses, lastMonthIncome } = useMonthOverMonthCashFlow();
    expect(lastMonthIncome.value).toBe(0);
    expect(lastMonthExpenses.value).toBe(50);
  });

  it('multi-currency converts via exchange rates', () => {
    settingsState.baseCurrency = 'USD';
    settingsState.exchangeRates = [{ from: 'EUR', to: 'USD', rate: 1.1 }];
    transactionsState.filteredTransactions = [
      tx({ type: 'income', amount: 100, currency: 'EUR', date: '2026-03-10' }),
    ];

    const { lastMonthIncome } = useMonthOverMonthCashFlow();
    expect(lastMonthIncome.value).toBeCloseTo(110, 5);
  });
});
