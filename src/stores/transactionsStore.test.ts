/**
 * `transactionsStore` cascades against the REAL inline doc backend (audit C7): every create,
 * update and delete goes through the worker `commitTransactionCascade` op, so these tests
 * read the balances the document actually holds (projection) and the echoes the store absorbed
 * (its sibling stores' arrays), never a simulated cascade.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installInlineBackend } from '@/services/automerge/worker/__tests__/inlineHarness';
import { registerTransactionOps } from '@/services/automerge/worker/transactionOps';
import { mutate } from '@/services/automerge/worker/docClient';
import { getById as projectionGetById } from '@/services/automerge/projection';
import type { CollectionName } from '@/types/automerge';
import { useAccountsStore } from './accountsStore';
import { useAssetsStore } from './assetsStore';
import { useGoalsStore } from './goalsStore';
import { useSettingsStore } from './settingsStore';
import { useTransactionsStore } from './transactionsStore';
import type { Transaction, Account, Asset, Goal, CreateTransactionInput } from '@/types/models';

vi.mock('@/composables/useCelebration', () => ({ celebrate: vi.fn() }));

const reportErrorMock = vi.hoisted(() => vi.fn());
vi.mock('@/utils/errorReporter', () => ({ reportError: reportErrorMock }));

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockAccount: Account = {
  id: 'test-account-1',
  memberId: 'member-1',
  name: 'Test Checking',
  type: 'checking',
  currency: 'USD',
  balance: 1000,
  institution: 'Test Bank',
  isActive: true,
  includeInNetWorth: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const mockDestAccount: Account = {
  ...mockAccount,
  id: 'test-account-2',
  name: 'Test Savings',
  type: 'savings',
  balance: 5000,
};

const mockGoal: Goal = {
  id: 'goal-1',
  name: 'Buy a Car',
  type: 'savings',
  targetAmount: 10000,
  currentAmount: 0,
  currency: 'USD',
  priority: 'high',
  isCompleted: false,
  manualContributions: [],
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const mockAssetWithLoan: Asset = {
  id: 'asset-loan-1',
  memberId: 'member-1',
  type: 'real_estate',
  name: 'Test House',
  purchaseValue: 300000,
  currentValue: 320000,
  currency: 'USD',
  includeInNetWorth: true,
  loan: {
    hasLoan: true,
    loanAmount: 250000,
    outstandingBalance: 200000,
    interestRate: 6,
    monthlyPayment: 1500,
    loanTermMonths: 360,
    lender: 'Test Bank',
  },
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

/** The mirror of `mockAssetWithLoan`'s loan (what `syncLinkedLoanAccount` creates). */
const mockLinkedLoanAccount: Account = {
  ...mockAccount,
  id: 'linked-loan-1',
  name: 'Test House Loan',
  type: 'loan',
  balance: 200000,
  linkedAssetId: 'asset-loan-1',
};

const mockLoanAccount: Account = {
  ...mockAccount,
  id: 'loan-account-1',
  name: 'Car Loan',
  type: 'loan',
  balance: 15000, // outstanding balance for standalone loan accounts
  institution: 'Test Credit Union',
  interestRate: 5,
  monthlyPayment: 400,
  loanTermMonths: 48,
};

const baseInput: CreateTransactionInput = {
  accountId: 'test-account-1',
  type: 'expense',
  amount: 100,
  currency: 'USD',
  category: 'groceries',
  date: '2024-01-15',
  description: 'Grocery shopping',
  isReconciled: false,
};

// ─── Harness ─────────────────────────────────────────────────────────────────

/** Seed entities straight into the document, then load the stores from the projection. */
async function seed(opts: { accounts?: Account[]; goals?: Goal[]; assets?: Asset[] }) {
  const ops = [
    ...(opts.accounts ?? []).map((e) => ({
      op: 'set' as const,
      collection: 'accounts' as const,
      id: e.id,
      entity: e,
    })),
    ...(opts.goals ?? []).map((e) => ({
      op: 'set' as const,
      collection: 'goals' as const,
      id: e.id,
      entity: e,
    })),
    ...(opts.assets ?? []).map((e) => ({
      op: 'set' as const,
      collection: 'assets' as const,
      id: e.id,
      entity: e,
    })),
  ];
  if (ops.length) await mutate({ op: 'batch', ops });
  await useAccountsStore().loadAccounts();
  await useGoalsStore().loadGoals();
  await useAssetsStore().loadAssets();
}

/** The document's own view of an entity (the projection), beside the store's echo. */
const stored = <T>(collection: CollectionName, id: string): T =>
  projectionGetById(collection, id) as unknown as T;
const storedBalance = (id: string) => stored<Account>('accounts', id).balance;
const storeBalance = (id: string) => useAccountsStore().getAccountById(id)!.balance;

async function freshWorld() {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  await installInlineBackend();
  registerTransactionOps();
  const settings = useSettingsStore();
  settings.settings.baseCurrency = 'USD';
  settings.globalSettings.exchangeRates = [];
}

// ─── Account balance sync ────────────────────────────────────────────────────

describe('transactionsStore - Account Balance Sync', () => {
  beforeEach(async () => {
    await freshWorld();
    await seed({ accounts: [mockAccount, mockDestAccount] });
  });

  describe('createTransaction - balance updates', () => {
    it('should decrease account balance when creating an expense', async () => {
      const result = await useTransactionsStore().createTransaction(baseInput);
      expect(result).not.toBeNull();
      expect(storeBalance('test-account-1')).toBe(900);
      expect(storedBalance('test-account-1')).toBe(900);
      expect(stored<Transaction>('transactions', result!.id)).toMatchObject({ amount: 100 });
    });

    it('should increase account balance when creating an income', async () => {
      await useTransactionsStore().createTransaction({ ...baseInput, type: 'income', amount: 500 });
      expect(storeBalance('test-account-1')).toBe(1500);
    });

    it('should update both accounts when creating a transfer', async () => {
      const result = await useTransactionsStore().createTransaction({
        ...baseInput,
        type: 'transfer',
        toAccountId: 'test-account-2',
        amount: 200,
      });
      expect(result).not.toBeNull();
      expect(storeBalance('test-account-1')).toBe(800);
      expect(storeBalance('test-account-2')).toBe(5200);
      expect(storedBalance('test-account-2')).toBe(5200);
    });

    it('a cascade that fails lands NOTHING: no row, no balance movement', async () => {
      const store = useTransactionsStore();
      const result = await store.createTransaction({ ...baseInput, amount: Number.NaN });
      expect(result).toBeNull();
      expect(store.transactions).toHaveLength(0);
      expect(storedBalance('test-account-1')).toBe(1000);
      expect(storeBalance('test-account-1')).toBe(1000);
    });
  });

  describe('deleteTransaction - balance reversal', () => {
    it('should restore account balance when deleting an expense', async () => {
      const store = useTransactionsStore();
      const created = await store.createTransaction(baseInput);
      expect(storeBalance('test-account-1')).toBe(900);
      expect(await store.deleteTransaction(created!.id)).toBe(true);
      expect(storeBalance('test-account-1')).toBe(1000);
      expect(stored('transactions', created!.id)).toBeUndefined();
    });

    it('should restore account balance when deleting an income', async () => {
      const store = useTransactionsStore();
      const created = await store.createTransaction({ ...baseInput, type: 'income', amount: 500 });
      await store.deleteTransaction(created!.id);
      expect(storeBalance('test-account-1')).toBe(1000);
    });

    it('should restore both account balances when deleting a transfer', async () => {
      const store = useTransactionsStore();
      const created = await store.createTransaction({
        ...baseInput,
        type: 'transfer',
        toAccountId: 'test-account-2',
        amount: 200,
      });
      await store.deleteTransaction(created!.id);
      expect(storeBalance('test-account-1')).toBe(1000);
      expect(storeBalance('test-account-2')).toBe(5000);
    });

    it('deleting a row that is already gone reports false and moves nothing', async () => {
      expect(await useTransactionsStore().deleteTransaction('missing')).toBe(false);
      expect(storeBalance('test-account-1')).toBe(1000);
    });
  });

  describe('updateTransaction - balance adjustments', () => {
    it('should adjust balance when transaction amount changes', async () => {
      const store = useTransactionsStore();
      const created = await store.createTransaction(baseInput);
      const result = await store.updateTransaction(created!.id, { amount: 150 });
      expect(result).not.toBeNull();
      expect(result!.amount).toBe(150);
      expect(storeBalance('test-account-1')).toBe(850);
    });

    it('should adjust balance when transaction type changes from expense to income', async () => {
      const store = useTransactionsStore();
      const created = await store.createTransaction(baseInput);
      await store.updateTransaction(created!.id, { type: 'income' });
      expect(storeBalance('test-account-1')).toBe(1100);
    });

    it('a description edit leaves every balance exactly where it was', async () => {
      const store = useTransactionsStore();
      const created = await store.createTransaction({
        ...baseInput,
        type: 'transfer',
        toAccountId: 'test-account-2',
        amount: 200,
      });
      const updated = await store.updateTransaction(created!.id, { description: 'renamed' });
      expect(updated!.description).toBe('renamed');
      expect(storeBalance('test-account-1')).toBe(800);
      expect(storeBalance('test-account-2')).toBe(5200);
    });

    it('a row deleted meanwhile drops out of the store and returns null', async () => {
      const store = useTransactionsStore();
      const created = await store.createTransaction(baseInput);
      await mutate({ op: 'delete', collection: 'transactions', id: created!.id });
      expect(await store.updateTransaction(created!.id, { description: 'x' })).toBeNull();
      expect(store.transactions).toHaveLength(0);
    });
  });

  describe('deleteTransactionsByRecurringItemId', () => {
    it('should delete all transactions with the given recurringItemId', async () => {
      const store = useTransactionsStore();
      await store.createTransaction({ ...baseInput, amount: 100, recurringItemId: 'recurring-1' });
      await store.createTransaction({ ...baseInput, amount: 200, recurringItemId: 'recurring-1' });
      const oneTime = await store.createTransaction({ ...baseInput, amount: 50 });

      const count = await store.deleteTransactionsByRecurringItemId('recurring-1');

      expect(count).toBe(2);
      expect(store.transactions).toHaveLength(1);
      expect(store.transactions[0]!.id).toBe(oneTime!.id);
    });

    it('should not affect transactions from other recurring items', async () => {
      const store = useTransactionsStore();
      await store.createTransaction({ ...baseInput, recurringItemId: 'recurring-1' });
      await store.createTransaction({ ...baseInput, recurringItemId: 'recurring-2' });
      await store.deleteTransactionsByRecurringItemId('recurring-1');
      expect(store.transactions).toHaveLength(1);
      expect(store.transactions[0]!.recurringItemId).toBe('recurring-2');
    });

    it('should return 0 when no transactions match', async () => {
      const store = useTransactionsStore();
      await store.createTransaction(baseInput);
      expect(await store.deleteTransactionsByRecurringItemId('nonexistent')).toBe(0);
      expect(store.transactions).toHaveLength(1);
    });

    it('should reverse account balances for deleted transactions', async () => {
      const store = useTransactionsStore();
      await store.createTransaction({ ...baseInput, amount: 500, recurringItemId: 'recurring-1' });
      expect(storeBalance('test-account-1')).toBe(500);
      await store.deleteTransactionsByRecurringItemId('recurring-1');
      expect(storeBalance('test-account-1')).toBe(1000);
      expect(storedBalance('test-account-1')).toBe(1000);
    });
  });
});

// ─── Goal allocation ─────────────────────────────────────────────────────────

describe('transactionsStore - Goal Allocation Sync', () => {
  beforeEach(async () => {
    await freshWorld();
    await seed({ accounts: [mockAccount], goals: [mockGoal] });
  });

  const salary = (extra: Partial<CreateTransactionInput> = {}): CreateTransactionInput => ({
    ...baseInput,
    type: 'income',
    amount: 1000,
    category: 'salary',
    goalId: 'goal-1',
    goalAllocMode: 'percentage',
    goalAllocValue: 20,
    ...extra,
  });

  it('should update goal progress with percentage allocation on create', async () => {
    const created = await useTransactionsStore().createTransaction(salary());
    expect(created!.goalAllocApplied).toBe(200);
    expect(stored<Transaction>('transactions', created!.id).goalAllocApplied).toBe(200);
    expect(useGoalsStore().goals[0]!.currentAmount).toBe(200);
  });

  it('should update goal progress with fixed allocation on create', async () => {
    const created = await useTransactionsStore().createTransaction(
      salary({ goalAllocMode: 'fixed', goalAllocValue: 300 })
    );
    expect(created!.goalAllocApplied).toBe(300);
    expect(useGoalsStore().goals[0]!.currentAmount).toBe(300);
  });

  it('should cap allocation to remaining goal amount', async () => {
    await mutate({
      op: 'set',
      collection: 'goals',
      id: 'goal-1',
      entity: { ...mockGoal, currentAmount: 9900 },
    });
    await useGoalsStore().loadGoals();
    const created = await useTransactionsStore().createTransaction(salary({ goalAllocValue: 50 }));
    expect(created!.goalAllocApplied).toBe(100);
    expect(useGoalsStore().goals[0]).toMatchObject({ currentAmount: 10000, isCompleted: true });
  });

  it('should reverse goal progress on delete', async () => {
    const store = useTransactionsStore();
    const created = await store.createTransaction(salary());
    expect(useGoalsStore().goals[0]!.currentAmount).toBe(200);
    await store.deleteTransaction(created!.id);
    expect(useGoalsStore().goals[0]!.currentAmount).toBe(0);
    expect(stored<Goal>('goals', 'goal-1').currentAmount).toBe(0);
  });

  it('should reverse old and apply new allocation on update', async () => {
    const store = useTransactionsStore();
    const created = await store.createTransaction(salary());
    const updated = await store.updateTransaction(created!.id, { goalAllocValue: 50 });
    // Old allocation reversed (200 → 0), new allocation applied (50% of 1000 = 500)
    expect(updated!.goalAllocApplied).toBe(500);
    expect(useGoalsStore().goals[0]!.currentAmount).toBe(500);
  });

  it('a description edit keeps the allocation and the goal untouched', async () => {
    const store = useTransactionsStore();
    const created = await store.createTransaction(salary());
    const updated = await store.updateTransaction(created!.id, { description: 'bonus' });
    expect(updated!.goalAllocApplied).toBe(200);
    expect(useGoalsStore().goals[0]!.currentAmount).toBe(200);
  });

  it('should reverse goal progress for each tx in bulk recurring delete', async () => {
    const store = useTransactionsStore();
    await store.createTransaction(salary({ recurringItemId: 'recurring-1' }));
    await store.createTransaction(salary({ recurringItemId: 'recurring-1' }));
    expect(useGoalsStore().goals[0]!.currentAmount).toBe(400);
    await store.deleteTransactionsByRecurringItemId('recurring-1');
    expect(useGoalsStore().goals[0]!.currentAmount).toBe(0);
  });
});

// ─── Loan balance reduction ──────────────────────────────────────────────────

describe('transactionsStore - Loan Balance Reduction', () => {
  beforeEach(async () => {
    await freshWorld();
    await seed({
      accounts: [mockAccount, mockLinkedLoanAccount, mockLoanAccount],
      assets: [mockAssetWithLoan],
    });
  });

  const payment = (extra: Partial<CreateTransactionInput> = {}): CreateTransactionInput => ({
    ...baseInput,
    category: 'loan_payment',
    amount: 1500,
    loanId: 'asset-loan-1',
    recurringItemId: 'recurring-loan-1', // recurring → standard amortization
    ...extra,
  });

  it('should apply amortization and reduce asset loan balance when creating expense with loanId', async () => {
    const created = await useTransactionsStore().createTransaction(payment());
    // 6%/yr on 200000: interest 1000, principal 500.
    expect(created).toMatchObject({ loanInterestPortion: 1000, loanPrincipalPortion: 500 });
    expect(useAssetsStore().getAssetById('asset-loan-1')!.loan!.outstandingBalance).toBe(199500);
    expect(stored<Asset>('assets', 'asset-loan-1').loan!.outstandingBalance).toBe(199500);
    // The linked loan account mirrors the asset loan, in the same change.
    expect(storeBalance('linked-loan-1')).toBe(199500);
    expect(storedBalance('linked-loan-1')).toBe(199500);
    expect(storeBalance('test-account-1')).toBe(-500);
  });

  it('should reduce standalone loan account balance when creating expense with loanId', async () => {
    const created = await useTransactionsStore().createTransaction(
      payment({ amount: 400, loanId: 'loan-account-1', recurringItemId: 'recurring-car-loan' })
    );
    // 5%/yr on 15000: interest 62.5, principal 337.5.
    expect(created).toMatchObject({ loanInterestPortion: 62.5, loanPrincipalPortion: 337.5 });
    expect(storeBalance('loan-account-1')).toBe(14662.5);
    expect(storedBalance('loan-account-1')).toBe(14662.5);
  });

  it('should restore loan balance when deleting a loan-linked transaction', async () => {
    const store = useTransactionsStore();
    const created = await store.createTransaction(
      payment({ amount: 400, loanId: 'loan-account-1', recurringItemId: 'recurring-car-loan' })
    );
    expect(storeBalance('loan-account-1')).toBe(14662.5);
    expect(await store.deleteTransaction(created!.id)).toBe(true);
    expect(storeBalance('loan-account-1')).toBe(15000);
    expect(storeBalance('test-account-1')).toBe(1000);
  });

  it('deleting an asset-loan payment restores the asset loan AND its mirror', async () => {
    const store = useTransactionsStore();
    const created = await store.createTransaction(payment());
    await store.deleteTransaction(created!.id);
    expect(useAssetsStore().getAssetById('asset-loan-1')!.loan!.outstandingBalance).toBe(200000);
    expect(storeBalance('linked-loan-1')).toBe(200000);
  });

  it('should use extra payment calculation for one-time payment (no recurringItemId)', async () => {
    const created = await useTransactionsStore().createTransaction(
      payment({ amount: 1000, loanId: 'loan-account-1', recurringItemId: undefined })
    );
    expect(created).toMatchObject({ loanInterestPortion: 0, loanPrincipalPortion: 1000 });
    expect(storeBalance('loan-account-1')).toBe(14000);
  });

  it('should not attempt balance reduction when loan has zero outstanding balance', async () => {
    await mutate({
      op: 'set',
      collection: 'accounts',
      id: 'loan-account-1',
      entity: { ...mockLoanAccount, balance: 0 },
    });
    await useAccountsStore().loadAccounts();
    const created = await useTransactionsStore().createTransaction(
      payment({ amount: 400, loanId: 'loan-account-1', recurringItemId: 'recurring-car-loan' })
    );
    expect(created!.loanInterestPortion).toBeUndefined();
    expect(created!.loanPrincipalPortion).toBeUndefined();
    expect(storeBalance('loan-account-1')).toBe(0);
  });

  it('a description edit keeps the stored portions and does not re-amortise', async () => {
    const store = useTransactionsStore();
    const created = await store.createTransaction(payment());
    const updated = await store.updateTransaction(created!.id, { description: 'March' });
    expect(updated).toMatchObject({ loanInterestPortion: 1000, loanPrincipalPortion: 500 });
    expect(useAssetsStore().getAssetById('asset-loan-1')!.loan!.outstandingBalance).toBe(199500);
    expect(storeBalance('linked-loan-1')).toBe(199500);
  });
});

// ─── Activity linking ────────────────────────────────────────────────────────

describe('transactionsStore - Activity Linking', () => {
  beforeEach(async () => {
    await freshWorld();
    await seed({ accounts: [mockAccount, mockLoanAccount] });
  });

  it('should store activityId when creating a transaction with activityId', async () => {
    const created = await useTransactionsStore().createTransaction({
      ...baseInput,
      category: 'lesson_fees',
      activityId: 'activity-swim-1',
    });
    expect(created!.activityId).toBe('activity-swim-1');
    expect(stored<Transaction>('transactions', created!.id).activityId).toBe('activity-swim-1');
  });

  it('should store activityId when updating a transaction to add activityId', async () => {
    const store = useTransactionsStore();
    const created = await store.createTransaction(baseInput);
    const updated = await store.updateTransaction(created!.id, { activityId: 'activity-piano-1' });
    expect(updated!.activityId).toBe('activity-piano-1');
    expect(storeBalance('test-account-1')).toBe(900);
  });

  it('should handle updating loanId: restore old loan balance and reduce new loan balance', async () => {
    await mutate({
      op: 'set',
      collection: 'accounts',
      id: 'new-loan-1',
      entity: {
        ...mockLoanAccount,
        id: 'new-loan-1',
        name: 'New Loan',
        balance: 20000,
        interestRate: 4,
      },
    });
    await useAccountsStore().loadAccounts();
    const store = useTransactionsStore();
    const created = await store.createTransaction({
      ...baseInput,
      amount: 400,
      category: 'loan_payment',
      loanId: 'loan-account-1',
      recurringItemId: 'recurring-old-loan',
    });
    expect(storeBalance('loan-account-1')).toBe(14662.5);

    const updated = await store.updateTransaction(created!.id, { loanId: 'new-loan-1' });

    expect(updated!.loanId).toBe('new-loan-1');
    expect(storeBalance('loan-account-1')).toBe(15000);
    // 4%/yr on 20000: interest 66.67, principal 333.33.
    expect(updated).toMatchObject({ loanInterestPortion: 66.67, loanPrincipalPortion: 333.33 });
    expect(storeBalance('new-loan-1')).toBeCloseTo(19666.67, 2);
  });

  it('should not change loan balances when deleting a transaction with only activityId', async () => {
    const store = useTransactionsStore();
    const created = await store.createTransaction({
      ...baseInput,
      amount: 150,
      category: 'lesson_fees',
      activityId: 'activity-dance-1',
    });
    expect(await store.deleteTransaction(created!.id)).toBe(true);
    expect(storeBalance('test-account-1')).toBe(1000);
    expect(storeBalance('loan-account-1')).toBe(15000);
  });
});

describe('transactionsStore - Summary Card Calculations', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  // Helper to create a transaction for current month
  const createThisMonthTransaction = (overrides: Partial<Transaction> = {}): Transaction => {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
    return {
      id: `txn-${Math.random().toString(36).slice(2)}`,
      accountId: 'test-account-1',
      type: 'expense',
      amount: 100,
      currency: 'USD',
      category: 'food',
      date: thisMonth,
      description: 'Test transaction',
      isReconciled: false,
      createdAt: thisMonth,
      updatedAt: thisMonth,
      ...overrides,
    };
  };

  describe('thisMonthIncome - includes both one-time and recurring transactions', () => {
    it('should sum ALL income transactions (one-time + recurring)', () => {
      const store = useTransactionsStore();

      // Add one-time income transactions
      store.transactions.push(
        createThisMonthTransaction({
          id: 'txn-1',
          type: 'income',
          amount: 500,
          description: 'Freelance',
        }),
        createThisMonthTransaction({
          id: 'txn-2',
          type: 'income',
          amount: 300,
          description: 'Side gig',
        })
      );

      // Add recurring-generated income (should be included)
      store.transactions.push(
        createThisMonthTransaction({
          id: 'txn-3',
          type: 'income',
          amount: 5000,
          description: 'Salary',
          recurringItemId: 'recurring-salary-1',
        })
      );

      // thisMonthIncome should include ALL: 500 + 300 + 5000 = 5800
      expect(store.thisMonthIncome).toBe(5800);
    });

    it('should include income from recurring items only', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({
          id: 'txn-1',
          type: 'income',
          amount: 5000,
          recurringItemId: 'recurring-1',
        })
      );

      expect(store.thisMonthIncome).toBe(5000);
    });

    it('should not include expenses in income calculation', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({ id: 'txn-1', type: 'income', amount: 1000 }),
        createThisMonthTransaction({ id: 'txn-2', type: 'expense', amount: 500 })
      );

      expect(store.thisMonthIncome).toBe(1000);
    });
  });

  describe('thisMonthExpenses - includes both one-time and recurring transactions', () => {
    it('should sum ALL expense transactions (one-time + recurring)', () => {
      const store = useTransactionsStore();

      // Add one-time expenses
      store.transactions.push(
        createThisMonthTransaction({
          id: 'txn-1',
          type: 'expense',
          amount: 50,
          description: 'Coffee',
        }),
        createThisMonthTransaction({
          id: 'txn-2',
          type: 'expense',
          amount: 100,
          description: 'Groceries',
        })
      );

      // Add recurring-generated expense (should be included)
      store.transactions.push(
        createThisMonthTransaction({
          id: 'txn-3',
          type: 'expense',
          amount: 2000,
          description: 'Rent',
          recurringItemId: 'recurring-rent-1',
        })
      );

      // thisMonthExpenses should include ALL: 50 + 100 + 2000 = 2150
      expect(store.thisMonthExpenses).toBe(2150);
    });

    it('should include expenses from recurring items only', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({
          id: 'txn-1',
          type: 'expense',
          amount: 2000,
          recurringItemId: 'recurring-1',
        })
      );

      expect(store.thisMonthExpenses).toBe(2000);
    });
  });

  describe('thisMonthOneTimeIncome - excludes recurring transactions', () => {
    it('should sum only one-time income transactions', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({ id: 'txn-1', type: 'income', amount: 500 }),
        createThisMonthTransaction({ id: 'txn-2', type: 'income', amount: 300 }),
        createThisMonthTransaction({
          id: 'txn-3',
          type: 'income',
          amount: 5000,
          recurringItemId: 'r1',
        })
      );

      // Should only include one-time: 500 + 300 = 800
      expect(store.thisMonthOneTimeIncome).toBe(800);
    });

    it('should return 0 when all income is from recurring items', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({
          id: 'txn-1',
          type: 'income',
          amount: 5000,
          recurringItemId: 'r1',
        })
      );

      expect(store.thisMonthOneTimeIncome).toBe(0);
    });
  });

  describe('thisMonthOneTimeExpenses - excludes recurring transactions', () => {
    it('should sum only one-time expense transactions', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({ id: 'txn-1', type: 'expense', amount: 50 }),
        createThisMonthTransaction({ id: 'txn-2', type: 'expense', amount: 100 }),
        createThisMonthTransaction({
          id: 'txn-3',
          type: 'expense',
          amount: 2000,
          recurringItemId: 'r1',
        })
      );

      // Should only include one-time: 50 + 100 = 150
      expect(store.thisMonthOneTimeExpenses).toBe(150);
    });

    it('should return 0 when all expenses are from recurring items', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({
          id: 'txn-1',
          type: 'expense',
          amount: 2000,
          recurringItemId: 'r1',
        })
      );

      expect(store.thisMonthOneTimeExpenses).toBe(0);
    });
  });

  describe('thisMonthRecurringIncome - only recurring transactions', () => {
    it('should sum only recurring income transactions', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({ id: 'txn-1', type: 'income', amount: 500 }),
        createThisMonthTransaction({
          id: 'txn-2',
          type: 'income',
          amount: 5000,
          recurringItemId: 'salary',
        }),
        createThisMonthTransaction({
          id: 'txn-3',
          type: 'income',
          amount: 1000,
          recurringItemId: 'rental',
        })
      );

      // Should only include recurring: 5000 + 1000 = 6000
      expect(store.thisMonthRecurringIncome).toBe(6000);
    });

    it('should return 0 when no recurring income exists', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({ id: 'txn-1', type: 'income', amount: 500 })
      );

      expect(store.thisMonthRecurringIncome).toBe(0);
    });
  });

  describe('thisMonthRecurringExpenses - only recurring transactions', () => {
    it('should sum only recurring expense transactions', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({ id: 'txn-1', type: 'expense', amount: 50 }),
        createThisMonthTransaction({
          id: 'txn-2',
          type: 'expense',
          amount: 2000,
          recurringItemId: 'rent',
        }),
        createThisMonthTransaction({
          id: 'txn-3',
          type: 'expense',
          amount: 100,
          recurringItemId: 'netflix',
        })
      );

      // Should only include recurring: 2000 + 100 = 2100
      expect(store.thisMonthRecurringExpenses).toBe(2100);
    });

    it('should return 0 when no recurring expenses exist', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({ id: 'txn-1', type: 'expense', amount: 50 })
      );

      expect(store.thisMonthRecurringExpenses).toBe(0);
    });
  });

  describe('thisMonthNetCashFlow', () => {
    it('should be the difference between ALL income and ALL expenses (one-time + recurring)', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        // One-time income
        createThisMonthTransaction({ id: 'txn-1', type: 'income', amount: 1000 }),
        // One-time expense
        createThisMonthTransaction({ id: 'txn-2', type: 'expense', amount: 300 }),
        // Recurring income
        createThisMonthTransaction({
          id: 'txn-3',
          type: 'income',
          amount: 5000,
          recurringItemId: 'r1',
        }),
        // Recurring expense
        createThisMonthTransaction({
          id: 'txn-4',
          type: 'expense',
          amount: 2000,
          recurringItemId: 'r2',
        })
      );

      // Net = (1000 + 5000) - (300 + 2000) = 6000 - 2300 = 3700
      expect(store.thisMonthNetCashFlow).toBe(3700);
    });

    it('should be negative when total expenses exceed total income', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({ id: 'txn-1', type: 'income', amount: 500 }),
        createThisMonthTransaction({ id: 'txn-2', type: 'expense', amount: 800 })
      );

      expect(store.thisMonthNetCashFlow).toBe(-300);
    });
  });

  describe('breakdown verification', () => {
    it('should have one-time + recurring equal to total for income', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({ id: 'txn-1', type: 'income', amount: 500 }),
        createThisMonthTransaction({ id: 'txn-2', type: 'income', amount: 300 }),
        createThisMonthTransaction({
          id: 'txn-3',
          type: 'income',
          amount: 5000,
          recurringItemId: 'salary',
        })
      );

      expect(store.thisMonthOneTimeIncome + store.thisMonthRecurringIncome).toBe(
        store.thisMonthIncome
      );
    });

    it('should have one-time + recurring equal to total for expenses', () => {
      const store = useTransactionsStore();

      store.transactions.push(
        createThisMonthTransaction({ id: 'txn-1', type: 'expense', amount: 50 }),
        createThisMonthTransaction({ id: 'txn-2', type: 'expense', amount: 100 }),
        createThisMonthTransaction({
          id: 'txn-3',
          type: 'expense',
          amount: 2000,
          recurringItemId: 'rent',
        })
      );

      expect(store.thisMonthOneTimeExpenses + store.thisMonthRecurringExpenses).toBe(
        store.thisMonthExpenses
      );
    });
  });
});
