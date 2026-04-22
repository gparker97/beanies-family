/**
 * Tests for the pure historical-replay helpers.
 *
 * Covers:
 *   - replayNetWorthHistory math (the backward walk)
 *   - transactionToChange for all 4 TransactionType variants
 *   - accountToCreationChange / assetToCreationChange happy and anomaly paths
 *   - deriveAccountInitialBalances correctness
 *   - buildNetWorthChanges end-to-end assembly
 *   - Bug A regression (balance_adjustment included in replay)
 *   - Bug C regression (loan-payment principal portion)
 *   - Bug 5 regression (createdAt clamping; new account/asset doesn't appear in past)
 *
 * Composable-level integration (Pinia + reactivity) lives in
 * `composables/__tests__/useNetWorthHistory.test.ts`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Account, Asset, ExchangeRate, Transaction } from '@/types/models';
import {
  replayNetWorthHistory,
  transactionToChange,
  accountToCreationChange,
  assetToCreationChange,
  deriveAccountInitialBalances,
  buildNetWorthChanges,
} from '../netWorthHistory';

const USD_RATES: ExchangeRate[] = [];

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
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
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
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
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
    date: '2026-04-01',
    description: '',
    isReconciled: false,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

function d(s: string): Date {
  return new Date(s + 'T00:00:00');
}

// ─────────────────────────────────────────────────────────────────────────────
describe('replayNetWorthHistory', () => {
  it('returns flat line at currentNetWorth when no changes', () => {
    const values = replayNetWorthHistory({
      currentNetWorth: 10_000,
      chartPointsNewestFirst: [d('2026-04-22'), d('2026-04-21'), d('2026-04-20')],
      changesNewestFirst: [],
    });
    expect(values).toEqual([10_000, 10_000, 10_000]);
  });

  it('subtracts a single change as the walk crosses its date', () => {
    const values = replayNetWorthHistory({
      currentNetWorth: 10_000,
      chartPointsNewestFirst: [d('2026-04-22'), d('2026-04-21'), d('2026-04-20')],
      changesNewestFirst: [{ date: d('2026-04-21'), delta: 1_000 }],
    });
    // Today: still 10000 (change is on 04-21, not strictly > 04-22)
    // 04-21: still 10000 (change is not strictly > 04-21)
    // 04-20: 10000 - 1000 = 9000 (change date 04-21 > 04-20)
    expect(values).toEqual([10_000, 10_000, 9_000]);
  });

  it('subtracts multiple changes as the walk crosses each one', () => {
    const values = replayNetWorthHistory({
      currentNetWorth: 10_000,
      chartPointsNewestFirst: [d('2026-04-22'), d('2026-04-15'), d('2026-04-01')],
      changesNewestFirst: [
        { date: d('2026-04-20'), delta: 500 }, // crossed before 04-15
        { date: d('2026-04-10'), delta: 300 }, // crossed before 04-01
      ],
    });
    expect(values).toEqual([10_000, 10_000 - 500, 10_000 - 500 - 300]);
  });

  it('handles negative deltas (income/asset events) correctly when walking back', () => {
    // A delta of -200 means net worth fell by 200 at that event. Walking
    // back across it: running += 200.
    const values = replayNetWorthHistory({
      currentNetWorth: 5_000,
      chartPointsNewestFirst: [d('2026-04-22'), d('2026-04-20')],
      changesNewestFirst: [{ date: d('2026-04-21'), delta: -200 }],
    });
    expect(values).toEqual([5_000, 5_200]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('transactionToChange', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const accountById = new Map<string, Account>([
    ['acc-1', account({ id: 'acc-1', type: 'checking' })],
    ['acc-cc', account({ id: 'acc-cc', type: 'credit_card' })],
  ]);

  it('income → +amount delta', () => {
    const change = transactionToChange(
      tx({ type: 'income', amount: 200, date: '2026-04-10' }),
      accountById,
      'USD',
      USD_RATES
    );
    expect(change).toEqual({ date: d('2026-04-10'), delta: 200 });
  });

  it('expense (regular) → -amount delta', () => {
    const change = transactionToChange(
      tx({ type: 'expense', amount: 75, date: '2026-04-10' }),
      accountById,
      'USD',
      USD_RATES
    );
    expect(change).toEqual({ date: d('2026-04-10'), delta: -75 });
  });

  it('expense with loanPrincipalPortion → -amount + principalPortion (Bug C)', () => {
    // $50 payment, $40 principal, $10 interest. Net worth fell by only $10.
    const change = transactionToChange(
      tx({
        type: 'expense',
        amount: 50,
        date: '2026-04-10',
        loanPrincipalPortion: 40,
        loanInterestPortion: 10,
      }),
      accountById,
      'USD',
      USD_RATES
    );
    expect(change).toEqual({ date: d('2026-04-10'), delta: -10 });
  });

  it('transfer → null (net-zero)', () => {
    const change = transactionToChange(
      tx({ type: 'transfer', amount: 100, date: '2026-04-10', toAccountId: 'acc-2' }),
      accountById,
      'USD',
      USD_RATES
    );
    expect(change).toBeNull();
  });

  it('balance_adjustment on asset account → +delta', () => {
    const change = transactionToChange(
      tx({
        type: 'balance_adjustment',
        amount: 500,
        date: '2026-04-21',
        accountId: 'acc-1',
        adjustment: { delta: 500, updatedBy: 'm-1' },
      }),
      accountById,
      'USD',
      USD_RATES
    );
    expect(change).toEqual({ date: d('2026-04-21'), delta: 500 });
  });

  it('balance_adjustment on credit_card → -delta (sign flipped by liability multiplier)', () => {
    const change = transactionToChange(
      tx({
        type: 'balance_adjustment',
        amount: 200,
        date: '2026-04-21',
        accountId: 'acc-cc',
        adjustment: { delta: 200, updatedBy: 'm-1' },
      }),
      accountById,
      'USD',
      USD_RATES
    );
    // Credit card balance up 200 → debt up 200 → net worth down 200.
    expect(change).toEqual({ date: d('2026-04-21'), delta: -200 });
  });

  it('balance_adjustment with negative delta on asset account → -|delta|', () => {
    const change = transactionToChange(
      tx({
        type: 'balance_adjustment',
        amount: 300,
        date: '2026-04-21',
        accountId: 'acc-1',
        adjustment: { delta: -300, updatedBy: 'm-1' },
      }),
      accountById,
      'USD',
      USD_RATES
    );
    expect(change).toEqual({ date: d('2026-04-21'), delta: -300 });
  });

  it('balance_adjustment missing adjustment → null + warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const change = transactionToChange(
      tx({ type: 'balance_adjustment', accountId: 'acc-1' }),
      accountById,
      'USD',
      USD_RATES
    );
    expect(change).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('balance_adjustment on unknown account → null + warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const change = transactionToChange(
      tx({
        type: 'balance_adjustment',
        accountId: 'acc-deleted',
        adjustment: { delta: 100, updatedBy: 'm-1' },
      }),
      accountById,
      'USD',
      USD_RATES
    );
    expect(change).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('zero-delta change → null (skipped, no-op)', () => {
    const change = transactionToChange(
      tx({
        type: 'balance_adjustment',
        accountId: 'acc-1',
        adjustment: { delta: 0, updatedBy: 'm-1' },
      }),
      accountById,
      'USD',
      USD_RATES
    );
    expect(change).toBeNull();
  });

  it('multi-currency converts via rates', () => {
    const rates: ExchangeRate[] = [{ from: 'EUR', to: 'USD', rate: 1.1, updatedAt: '2026-01-01' }];
    const change = transactionToChange(
      tx({ type: 'income', amount: 100, currency: 'EUR', date: '2026-04-10' }),
      accountById,
      'USD',
      rates
    );
    expect(change?.delta).toBeCloseTo(110, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('accountToCreationChange', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asset account creation → positive delta', () => {
    const a = account({ type: 'checking', createdAt: '2026-04-01' });
    const change = accountToCreationChange(a, 5_000, 'USD', USD_RATES);
    expect(change).toEqual({ date: d('2026-04-01'), delta: 5_000 });
  });

  it('liability account creation → negative delta', () => {
    const a = account({ type: 'credit_card', createdAt: '2026-04-01' });
    const change = accountToCreationChange(a, 1_000, 'USD', USD_RATES);
    expect(change).toEqual({ date: d('2026-04-01'), delta: -1_000 });
  });

  it('zero initial balance → null', () => {
    const a = account({ type: 'checking', createdAt: '2026-04-01' });
    expect(accountToCreationChange(a, 0, 'USD', USD_RATES)).toBeNull();
  });

  it('missing createdAt → null + warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = account({ createdAt: '' as unknown as string });
    expect(accountToCreationChange(a, 5_000, 'USD', USD_RATES)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('assetToCreationChange', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asset creation → positive delta of currentValue', () => {
    const a = asset({ currentValue: 300_000, createdAt: '2026-04-01' });
    const change = assetToCreationChange(a, 'USD', USD_RATES);
    expect(change).toEqual({ date: d('2026-04-01'), delta: 300_000 });
  });

  it('zero currentValue → null', () => {
    const a = asset({ currentValue: 0, createdAt: '2026-04-01' });
    expect(assetToCreationChange(a, 'USD', USD_RATES)).toBeNull();
  });

  it('missing createdAt → null + warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = asset({ createdAt: '' as unknown as string });
    expect(assetToCreationChange(a, 'USD', USD_RATES)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('deriveAccountInitialBalances', () => {
  it('account with no transactions → initial = current', () => {
    const accs = [account({ id: 'acc-1', balance: 5_000 })];
    const initial = deriveAccountInitialBalances(accs, []);
    expect(initial.get('acc-1')).toBe(5_000);
  });

  it('account with $200 income + $50 expense → initial = current - 150', () => {
    const accs = [account({ id: 'acc-1', balance: 5_150 })];
    const txs = [
      tx({ type: 'income', amount: 200, accountId: 'acc-1' }),
      tx({ type: 'expense', amount: 50, accountId: 'acc-1' }),
    ];
    const initial = deriveAccountInitialBalances(accs, txs);
    expect(initial.get('acc-1')).toBe(5_000);
  });

  it('balance_adjustment included in derivation', () => {
    // Current balance 1_500 reflects a +500 adjustment; initial was 1_000.
    const accs = [account({ id: 'acc-1', balance: 1_500 })];
    const txs = [
      tx({
        type: 'balance_adjustment',
        amount: 500,
        accountId: 'acc-1',
        adjustment: { delta: 500, updatedBy: 'm-1' },
      }),
    ];
    const initial = deriveAccountInitialBalances(accs, txs);
    expect(initial.get('acc-1')).toBe(1_000);
  });

  it('transfer affects both source and destination accounts', () => {
    const accs = [
      account({ id: 'acc-1', balance: 800 }), // source: -200
      account({ id: 'acc-2', balance: 1_200 }), // destination: +200
    ];
    const txs = [tx({ type: 'transfer', amount: 200, accountId: 'acc-1', toAccountId: 'acc-2' })];
    const initial = deriveAccountInitialBalances(accs, txs);
    expect(initial.get('acc-1')).toBe(1_000);
    expect(initial.get('acc-2')).toBe(1_000);
  });

  it('transactions referencing accounts not in the input are ignored', () => {
    const accs = [account({ id: 'acc-1', balance: 1_000 })];
    const txs = [tx({ type: 'income', amount: 999, accountId: 'acc-deleted' })];
    const initial = deriveAccountInitialBalances(accs, txs);
    expect(initial.get('acc-1')).toBe(1_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('buildNetWorthChanges', () => {
  it('combines transactions, accounts, and assets into a single sorted stream', () => {
    const accs = [account({ id: 'acc-1', balance: 1_500, createdAt: '2026-03-01' })];
    const assets = [asset({ id: 'as-1', currentValue: 50_000, createdAt: '2026-02-15' })];
    const txs = [
      tx({ id: 'tx-i', type: 'income', amount: 500, accountId: 'acc-1', date: '2026-04-10' }),
    ];

    const changes = buildNetWorthChanges({
      accounts: accs,
      assets,
      transactions: txs,
      baseCurrency: 'USD',
      rates: USD_RATES,
    });

    // Three changes total: 1 transaction, 1 account creation, 1 asset creation.
    expect(changes).toHaveLength(3);
    // Sorted newest-first by date.
    expect(changes[0]!.date).toEqual(d('2026-04-10'));
    expect(changes[1]!.date).toEqual(d('2026-03-01'));
    expect(changes[2]!.date).toEqual(d('2026-02-15'));
  });

  it('skips transfers and zero-delta events', () => {
    // Two accounts both starting at $1_000; transfer of $100 between them.
    // After transfer: acc-1 = 900, acc-2 = 1_100. Both account-creation
    // changes are non-zero (deltas +1_000 each), but the transfer itself
    // contributes no NetWorthChange.
    const accs = [
      account({ id: 'acc-1', balance: 900, createdAt: '2026-03-01' }),
      account({ id: 'acc-2', balance: 1_100, createdAt: '2026-03-01' }),
    ];
    const txs = [
      tx({
        type: 'transfer',
        amount: 100,
        accountId: 'acc-1',
        toAccountId: 'acc-2',
        date: '2026-04-01',
      }),
    ];

    const changes = buildNetWorthChanges({
      accounts: accs,
      assets: [],
      transactions: txs,
      baseCurrency: 'USD',
      rates: USD_RATES,
    });
    // Two creation changes (+1_000 each); transfer not present.
    expect(changes).toHaveLength(2);
    expect(changes.every((c) => c.delta === 1_000)).toBe(true);
  });

  it('Bug A regression: balance_adjustment is included in the change stream', () => {
    const accs = [account({ id: 'acc-1', balance: 1_500_000, createdAt: '2026-01-01' })];
    const txs = [
      tx({
        type: 'balance_adjustment',
        amount: 500_000,
        accountId: 'acc-1',
        date: '2026-04-21',
        adjustment: { delta: 500_000, updatedBy: 'm-1' },
      }),
    ];

    const changes = buildNetWorthChanges({
      accounts: accs,
      assets: [],
      transactions: txs,
      baseCurrency: 'USD',
      rates: USD_RATES,
    });
    const adjustmentChange = changes.find((c) => c.delta === 500_000);
    expect(adjustmentChange).toBeDefined();
    expect(adjustmentChange?.date).toEqual(d('2026-04-21'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('end-to-end Bug 5 regression: createdAt clamping', () => {
  it('asset account created today does not contribute to past chart points', () => {
    const today = d('2026-04-22');
    const yesterday = d('2026-04-21');
    const lastWeek = d('2026-04-15');

    const accs = [account({ id: 'acc-new', balance: 10_000, createdAt: '2026-04-22' })];
    const changes = buildNetWorthChanges({
      accounts: accs,
      assets: [],
      transactions: [],
      baseCurrency: 'USD',
      rates: USD_RATES,
    });

    const values = replayNetWorthHistory({
      currentNetWorth: 10_000, // assume this is the only contribution
      chartPointsNewestFirst: [today, yesterday, lastWeek],
      changesNewestFirst: changes,
    });

    // Today: 10_000 (account exists)
    // Yesterday: 10_000 - 10_000 = 0 (creation event crossed)
    // Last week: 0 (still nothing)
    expect(values).toEqual([10_000, 0, 0]);
  });

  it('asset (e.g. house) created today does not contribute to past', () => {
    const today = d('2026-04-22');
    const lastYear = d('2025-04-22');
    const assets = [asset({ currentValue: 300_000, createdAt: '2026-04-22' })];

    const changes = buildNetWorthChanges({
      accounts: [],
      assets,
      transactions: [],
      baseCurrency: 'USD',
      rates: USD_RATES,
    });

    const values = replayNetWorthHistory({
      currentNetWorth: 300_000,
      chartPointsNewestFirst: [today, lastYear],
      changesNewestFirst: changes,
    });

    expect(values).toEqual([300_000, 0]);
  });

  it('asset + linked loan created same day = net retroactive contribution of 0', () => {
    // Simulates buying a $500k house with a $200k loan: net contribution
    // today is +300_000 ($500k asset minus $200k debt).
    const today = d('2026-04-22');
    const lastYear = d('2025-04-22');

    const assets = [asset({ currentValue: 500_000, createdAt: '2026-04-22' })];
    const accs = [
      account({
        id: 'acc-loan',
        type: 'loan',
        balance: 200_000,
        createdAt: '2026-04-22',
      }),
    ];

    const changes = buildNetWorthChanges({
      accounts: accs,
      assets,
      transactions: [],
      baseCurrency: 'USD',
      rates: USD_RATES,
    });

    const values = replayNetWorthHistory({
      currentNetWorth: 300_000, // 500k asset - 200k loan
      chartPointsNewestFirst: [today, lastYear],
      changesNewestFirst: changes,
    });

    // Today: +300k (both exist).
    // Last year: 0 (creation events for both crossed: -500k then +200k).
    expect(values).toEqual([300_000, 0]);
  });

  it('account created mid-period with intervening income — historical replay correct', () => {
    // Account created 2026-04-10 with $5_000. Earned $200 income on 2026-04-15.
    // Current balance: $5_200.
    // Chart points: today (04-22), 04-12 (after creation, before income), 04-05 (before creation).
    const today = d('2026-04-22');
    const between = d('2026-04-12');
    const before = d('2026-04-05');

    const accs = [account({ id: 'acc-1', balance: 5_200, createdAt: '2026-04-10' })];
    const txs = [tx({ type: 'income', amount: 200, accountId: 'acc-1', date: '2026-04-15' })];

    const changes = buildNetWorthChanges({
      accounts: accs,
      assets: [],
      transactions: txs,
      baseCurrency: 'USD',
      rates: USD_RATES,
    });

    const values = replayNetWorthHistory({
      currentNetWorth: 5_200,
      chartPointsNewestFirst: [today, between, before],
      changesNewestFirst: changes,
    });

    // Today: 5_200.
    // 04-12: income event (04-15) crossed; running = 5_200 - 200 = 5_000.
    // 04-05: creation event (04-10) crossed; running = 5_000 - 5_000 = 0.
    expect(values).toEqual([5_200, 5_000, 0]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('end-to-end Bug C regression: loan-payment principal handling', () => {
  it('chart matches "interest only" not "full payment" for a loan-payment expense', () => {
    // Loan payment: $500 expense with $400 principal + $100 interest.
    // Real net worth fell by $100 (interest only) at the moment of payment.
    const today = d('2026-04-22');
    const beforePayment = d('2026-04-19');

    const accs = [
      account({ id: 'acc-checking', balance: 4_500, createdAt: '2026-01-01' }),
      account({
        id: 'acc-loan',
        type: 'loan',
        balance: 9_600, // started at 10_000, reduced by 400 principal
        createdAt: '2026-01-01',
      }),
    ];
    // Net worth today = 4_500 (asset) - 9_600 (liability) = -5_100
    // Net worth before payment = 5_000 (asset) - 10_000 (liability) = -5_000
    // Difference: -100 (the interest)
    const txs = [
      tx({
        type: 'expense',
        amount: 500,
        accountId: 'acc-checking',
        date: '2026-04-20',
        loanPrincipalPortion: 400,
        loanInterestPortion: 100,
      }),
    ];

    const changes = buildNetWorthChanges({
      accounts: accs,
      assets: [],
      transactions: txs,
      baseCurrency: 'USD',
      rates: USD_RATES,
    });

    const values = replayNetWorthHistory({
      currentNetWorth: -5_100,
      chartPointsNewestFirst: [today, beforePayment],
      changesNewestFirst: changes,
    });

    // Today: -5_100 (post-payment).
    // Before payment: -5_100 - (-100) = -5_000 (interest reversed only).
    expect(values[0]).toBe(-5_100);
    expect(values[1]).toBe(-5_000);
  });
});
