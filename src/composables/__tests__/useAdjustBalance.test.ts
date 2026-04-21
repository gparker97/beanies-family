import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { Account, Transaction } from '@/types/models';

// Toast is a side effect we assert on.
const showToastMock = vi.fn();
vi.mock('@/composables/useToast', () => ({
  showToast: (...args: unknown[]) => showToastMock(...args),
}));

// Translation — return the key back so assertions can check which string fired.
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// Plain objects mirror the shape Pinia's store proxy would expose
// (refs auto-unwrapped to their raw arrays/values).
const accountsState = {
  accounts: [] as Account[],
  updateAccount: vi.fn<(id: string, input: Partial<Account>) => Promise<Account | null>>(),
};
vi.mock('@/stores/accountsStore', () => ({
  useAccountsStore: () => accountsState,
}));

const transactionsState = {
  createTransaction: vi.fn<(input: Partial<Transaction>) => Promise<Transaction | null>>(),
};
vi.mock('@/stores/transactionsStore', () => ({
  useTransactionsStore: () => transactionsState,
}));

const familyState = {
  currentMember: { id: 'member-current' } as { id: string } | undefined,
  owner: { id: 'member-owner' } as { id: string } | undefined,
};
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => familyState,
}));

import { useAdjustBalance } from '../useAdjustBalance';

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-1',
    memberId: 'member-current',
    name: 'Main Checking',
    type: 'checking',
    currency: 'USD',
    balance: 1000,
    isActive: true,
    includeInNetWorth: true,
    createdAt: '2026-04-01',
    updatedAt: '2026-04-01',
    ...overrides,
  };
}

describe('useAdjustBalance.saveWithAdjustment', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    showToastMock.mockClear();
    accountsState.accounts = [account()];
    accountsState.updateAccount.mockReset();
    transactionsState.createTransaction.mockReset();
    // Default: currentMember present, owner present
    familyState.currentMember = { id: 'member-current' };
    familyState.owner = { id: 'member-owner' };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits a positive-delta adjustment row when balance increases', async () => {
    accountsState.updateAccount.mockResolvedValue(account({ balance: 1200 }));
    transactionsState.createTransaction.mockResolvedValue({ id: 'adj-new' } as Transaction);

    const { saveWithAdjustment } = useAdjustBalance();
    const result = await saveWithAdjustment('acc-1', { balance: 1200 });

    expect(result.success).toBe(true);
    expect(result.adjustmentTxId).toBe('adj-new');
    expect(transactionsState.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'balance_adjustment',
        amount: 200,
        adjustment: { delta: 200, updatedBy: 'member-current' },
        currency: 'USD',
        isReconciled: true,
      })
    );
  });

  it('emits a negative-delta adjustment row when balance decreases', async () => {
    accountsState.updateAccount.mockResolvedValue(account({ balance: 800 }));
    transactionsState.createTransaction.mockResolvedValue({ id: 'adj-new' } as Transaction);

    const { saveWithAdjustment } = useAdjustBalance();
    await saveWithAdjustment('acc-1', { balance: 800 });

    expect(transactionsState.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 200,
        adjustment: { delta: -200, updatedBy: 'member-current' },
      })
    );
  });

  it('does NOT emit an adjustment row when balance is unchanged', async () => {
    accountsState.updateAccount.mockResolvedValue(account({ balance: 1000, name: 'Renamed' }));

    const { saveWithAdjustment } = useAdjustBalance();
    const result = await saveWithAdjustment('acc-1', { name: 'Renamed' });

    expect(result.success).toBe(true);
    expect(result.adjustmentTxId).toBeUndefined();
    expect(transactionsState.createTransaction).not.toHaveBeenCalled();
  });

  it('returns success:false + toast when the account does not exist', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { saveWithAdjustment } = useAdjustBalance();
    const result = await saveWithAdjustment('acc-missing', { balance: 500 });

    expect(result.success).toBe(false);
    expect(accountsState.updateAccount).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith('error', 'accountView.notFound');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('returns success:false when accountsStore.updateAccount fails', async () => {
    accountsState.updateAccount.mockResolvedValue(null);

    const { saveWithAdjustment } = useAdjustBalance();
    const result = await saveWithAdjustment('acc-1', { balance: 1200 });

    expect(result.success).toBe(false);
    expect(transactionsState.createTransaction).not.toHaveBeenCalled();
  });

  it('falls back to owner when currentMember is undefined', async () => {
    familyState.currentMember = undefined;
    accountsState.updateAccount.mockResolvedValue(account({ balance: 1200 }));
    transactionsState.createTransaction.mockResolvedValue({ id: 'adj-new' } as Transaction);

    const { saveWithAdjustment } = useAdjustBalance();
    await saveWithAdjustment('acc-1', { balance: 1200 });

    expect(transactionsState.createTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        adjustment: { delta: 200, updatedBy: 'member-owner' },
      })
    );
  });

  it('toasts + logs + returns success:true (no adjustmentTxId) when neither currentMember nor owner exist', async () => {
    familyState.currentMember = undefined;
    familyState.owner = undefined;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    accountsState.updateAccount.mockResolvedValue(account({ balance: 1200 }));

    const { saveWithAdjustment } = useAdjustBalance();
    const result = await saveWithAdjustment('acc-1', { balance: 1200 });

    expect(result.success).toBe(true);
    expect(result.account?.balance).toBe(1200);
    expect(result.adjustmentTxId).toBeUndefined();
    expect(transactionsState.createTransaction).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledWith(
      'error',
      'accountView.adjustError.noAuthor',
      'accountView.adjustError.noAuthorHelp'
    );
    expect(errorSpy).toHaveBeenCalled();
  });

  it('warns + returns success:true (no adjustmentTxId) when createTransaction fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    accountsState.updateAccount.mockResolvedValue(account({ balance: 1200 }));
    transactionsState.createTransaction.mockResolvedValue(null);

    const { saveWithAdjustment } = useAdjustBalance();
    const result = await saveWithAdjustment('acc-1', { balance: 1200 });

    expect(result.success).toBe(true);
    expect(result.account?.balance).toBe(1200);
    expect(result.adjustmentTxId).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});
