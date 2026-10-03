/**
 * The transfer and liability-sign cascade (audit C7) against the REAL inline doc backend: a
 * transfer's destination is credited its converted `toAmount`, a card's balance is "owed", and
 * a missing exchange rate refuses the whole cascade before anything is written.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installInlineBackend } from '@/services/automerge/worker/__tests__/inlineHarness';
import { registerTransactionOps } from '@/services/automerge/worker/transactionOps';
import { mutate } from '@/services/automerge/worker/docClient';
import { getById as projectionGetById } from '@/services/automerge/projection';
import { useAccountsStore } from '../accountsStore';
import { useSettingsStore } from '../settingsStore';
import { useTransactionsStore } from '../transactionsStore';
import type { Account, CurrencyCode, Transaction } from '@/types/models';

vi.mock('@/composables/useCelebration', () => ({ celebrate: vi.fn() }));
const reportErrorMock = vi.hoisted(() => vi.fn());
vi.mock('@/utils/errorReporter', () => ({ reportError: reportErrorMock }));

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
const bal = (id: string) => useAccountsStore().getAccountById(id)!.balance;
const storedBal = (id: string) => (projectionGetById('accounts', id) as Account).balance;
const storedTx = (id: string) => projectionGetById('transactions', id) as Transaction | undefined;

describe('transactionsStore — balance cascade (transfers + liability signs)', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    await installInlineBackend();
    registerTransactionOps();
    const accounts = [
      acc({ id: 'chk', type: 'checking', currency: 'SGD', balance: 1000 }),
      acc({ id: 'sav', type: 'savings', currency: 'SGD', balance: 0 }),
      acc({ id: 'card', type: 'credit_card', currency: 'USD', balance: 500 }), // owed
      acc({ id: 'yen', type: 'savings', currency: 'JPY', balance: 0 }),
    ];
    await mutate({
      op: 'batch',
      ops: accounts.map((a) => ({ op: 'set', collection: 'accounts', id: a.id, entity: a })),
    });
    await useAccountsStore().loadAccounts();
    const settings = useSettingsStore();
    settings.settings.baseCurrency = 'USD';
    settings.globalSettings.exchangeRates = [
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
    expect(storedBal('sav')).toBe(100);
  });

  it('cross-currency card payoff: source debited raw, card owed reduced by the converted amount', async () => {
    const store = useTransactionsStore();
    const created = await store.createTransaction({
      ...base,
      type: 'transfer',
      accountId: 'chk',
      toAccountId: 'card',
      amount: 100,
    });
    expect(bal('chk')).toBe(900); // -100 SGD
    expect(bal('card')).toBeCloseTo(425.6, 5); // 500 - (100 * 0.744) owed
    // toAmount persisted for drift-free reversal
    expect(storedTx(created!.id)!.toAmount).toBeCloseTo(74.4, 5);
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
    expect(store.transactions).toHaveLength(0);
    expect(reportErrorMock).toHaveBeenCalledWith(
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
    expect(bal('chk')).toBe(chkAfter); // no reverse+reapply at all: nothing moved
    expect(bal('card')).toBe(cardAfter);
    expect(storedTx(created!.id)!.toAmount).toBeCloseTo(74.4, 5);
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
    expect(storedTx(created!.id)!.toAmount).toBeCloseTo(148.8, 5);
  });

  it('turning a transfer into an expense clears toAmount and releases the destination', async () => {
    const store = useTransactionsStore();
    const created = await store.createTransaction({
      ...base,
      type: 'transfer',
      accountId: 'chk',
      toAccountId: 'card',
      amount: 100,
    });
    await store.updateTransaction(created!.id, { type: 'expense', toAccountId: undefined });
    expect(bal('chk')).toBe(900);
    expect(bal('card')).toBeCloseTo(500, 5);
    expect(storedTx(created!.id)!.toAmount).toBeUndefined();
    expect(storedTx(created!.id)!.toAccountId).toBeUndefined();
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
    expect(storedBal('card')).toBeCloseTo(500, 5);
  });
});
