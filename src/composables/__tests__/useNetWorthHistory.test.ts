/**
 * Integration tests for the useNetWorthHistory composable.
 *
 * Pure-math regression coverage (Bug A, Bug C, Bug 5) lives in
 * `utils/__tests__/netWorthHistory.test.ts`. This file targets the
 * composable's reactive contract: error handling, the chartError
 * channel, and that store snapshots flow into the pure helpers correctly.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Account, Asset, Transaction } from '@/types/models';

const NOW = new Date('2026-04-22T12:00:00Z');

const accountsState = {
  filteredAccounts: [] as Account[],
  filteredCombinedNetWorth: 0,
};
vi.mock('@/stores/accountsStore', () => ({
  useAccountsStore: () => accountsState,
}));

const assetsState = {
  filteredAssets: [] as Asset[],
};
vi.mock('@/stores/assetsStore', () => ({
  useAssetsStore: () => assetsState,
}));

const transactionsState = {
  filteredTransactions: [] as Transaction[],
};
vi.mock('@/stores/transactionsStore', () => ({
  useTransactionsStore: () => transactionsState,
}));

const settingsState = {
  baseCurrency: 'USD',
  exchangeRates: [] as Array<{ from: string; to: string; rate: number }>,
};
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => settingsState,
}));

import { useNetWorthHistory } from '../useNetWorthHistory';

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-1',
    memberId: 'm-1',
    name: 'Checking',
    type: 'checking',
    currency: 'USD',
    balance: 0,
    isActive: true,
    includeInNetWorth: true,
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
    ...overrides,
  };
}

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'as-1',
    memberId: 'm-1',
    type: 'real_estate',
    name: 'House',
    purchaseValue: 500_000,
    currentValue: 500_000,
    currency: 'USD',
    includeInNetWorth: true,
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
    ...overrides,
  };
}

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: `tx-${Math.random().toString(36).slice(2, 8)}`,
    accountId: 'acc-1',
    type: 'expense',
    amount: 50,
    currency: 'USD',
    category: 'food',
    date: '2026-04-21',
    description: '',
    isReconciled: false,
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z',
    ...overrides,
  };
}

describe('useNetWorthHistory', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    accountsState.filteredAccounts = [];
    accountsState.filteredCombinedNetWorth = 0;
    assetsState.filteredAssets = [];
    transactionsState.filteredTransactions = [];
    settingsState.baseCurrency = 'USD';
    settingsState.exchangeRates = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('default period 1M produces 30 chronologically-ordered chart points', () => {
    accountsState.filteredCombinedNetWorth = 10_000;
    accountsState.filteredAccounts = [account({ id: 'acc-1', balance: 10_000 })];

    const { chartData, chartError } = useNetWorthHistory();

    expect(chartError.value).toBeNull();
    expect(chartData.value.length).toBe(30);
    // Chronological order: first point is 29 days ago, last is today.
    const first = chartData.value[0]!.date.getTime();
    const last = chartData.value[chartData.value.length - 1]!.date.getTime();
    expect(first).toBeLessThan(last);
  });

  it('today value matches currentNetWorth (no events to reverse)', () => {
    accountsState.filteredCombinedNetWorth = 25_000;
    accountsState.filteredAccounts = [account({ id: 'acc-1', balance: 25_000 })];

    const { chartData } = useNetWorthHistory();
    const today = chartData.value[chartData.value.length - 1]!;
    expect(today.value).toBe(25_000);
  });

  it('Bug A: balance_adjustment yesterday reflects in chart history', () => {
    // Account holds $1.5M today. Yesterday a +$500k adjustment was made.
    // Pre-adjustment net worth: $1M.
    accountsState.filteredCombinedNetWorth = 1_500_000;
    accountsState.filteredAccounts = [account({ id: 'acc-1', balance: 1_500_000 })];
    transactionsState.filteredTransactions = [
      tx({
        type: 'balance_adjustment',
        amount: 500_000,
        accountId: 'acc-1',
        date: '2026-04-21',
        adjustment: { delta: 500_000, updatedBy: 'm-1' },
      }),
    ];

    const { chartData } = useNetWorthHistory();
    const today = chartData.value[chartData.value.length - 1]!.value;
    const before = chartData.value[chartData.value.length - 3]!.value; // 2 days ago

    expect(today).toBe(1_500_000);
    expect(before).toBe(1_000_000); // pre-adjustment
  });

  it('Bug 5: account created today has no historical contribution', () => {
    // Account exists with $10k as of today (created today), no other accounts.
    accountsState.filteredCombinedNetWorth = 10_000;
    accountsState.filteredAccounts = [
      account({ id: 'acc-new', balance: 10_000, createdAt: '2026-04-22' }),
    ];

    const { chartData } = useNetWorthHistory();
    const today = chartData.value[chartData.value.length - 1]!.value;
    const yesterday = chartData.value[chartData.value.length - 2]!.value;

    expect(today).toBe(10_000);
    expect(yesterday).toBe(0); // didn't exist yet
  });

  it('chartError is null on the happy path', () => {
    accountsState.filteredCombinedNetWorth = 1_000;
    const { chartError } = useNetWorthHistory();
    expect(chartError.value).toBeNull();
  });

  it('chartError surfaces a user-facing message when something throws inside replay', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Force a throw by handing the composable a transaction with a date
    // that constructs to NaN, which will propagate through the date sort.
    // Simpler: corrupt the accounts array to a non-array.
    (accountsState as unknown as { filteredAccounts: unknown }).filteredAccounts = null;

    const { chartData, chartError } = useNetWorthHistory();
    expect(chartError.value).toContain('Could not render');
    expect(chartData.value).toEqual([]);
    expect(err).toHaveBeenCalled();
  });

  it('multi-currency: respects baseCurrency + rates', () => {
    settingsState.baseCurrency = 'USD';
    settingsState.exchangeRates = [{ from: 'EUR', to: 'USD', rate: 1.1 }];
    accountsState.filteredCombinedNetWorth = 11_000;
    accountsState.filteredAccounts = [
      account({ id: 'acc-eur', currency: 'EUR', balance: 10_000, createdAt: '2025-01-01' }),
    ];

    const { chartError } = useNetWorthHistory();
    // The rate path must work without throwing.
    expect(chartError.value).toBeNull();
  });

  it('asset created today does not appear in historical chart', () => {
    accountsState.filteredCombinedNetWorth = 300_000;
    assetsState.filteredAssets = [asset({ currentValue: 300_000, createdAt: '2026-04-22' })];

    const { chartData } = useNetWorthHistory();
    const today = chartData.value[chartData.value.length - 1]!.value;
    const yesterday = chartData.value[chartData.value.length - 2]!.value;

    expect(today).toBe(300_000);
    expect(yesterday).toBe(0);
  });

  it('selectedPeriod is reactive: changing period reshapes chart', () => {
    accountsState.filteredCombinedNetWorth = 1_000;
    const { selectedPeriod, chartData } = useNetWorthHistory();

    expect(chartData.value.length).toBe(30); // 1M default
    selectedPeriod.value = '1W';
    expect(chartData.value.length).toBe(7);
  });
});
