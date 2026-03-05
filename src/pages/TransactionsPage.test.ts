import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import TransactionsPage from './TransactionsPage.vue';
import { useAccountsStore } from '@/stores/accountsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import type { Transaction, Account, FamilyMember, RecurringItem } from '@/types/models';
import { toISODateString, addMonths, toDateInputValue } from '@/utils/date';

// Import mocked repos for setting up mockImplementation in save-flow tests
import * as transactionRepo from '@/services/automerge/repositories/transactionRepository';
import * as recurringItemRepo from '@/services/automerge/repositories/recurringItemRepository';

// Mock repositories
vi.mock('@/services/automerge/repositories/transactionRepository', () => ({
  getAllTransactions: vi.fn().mockResolvedValue([]),
  getTransactionById: vi.fn(),
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
}));

vi.mock('@/services/automerge/repositories/accountRepository', () => ({
  getAllAccounts: vi.fn(),
  getAccountById: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  updateAccountBalance: vi.fn(),
}));

vi.mock('@/services/automerge/repositories/familyMemberRepository', () => ({
  getAllFamilyMembers: vi.fn(),
  getFamilyMemberById: vi.fn(),
  createFamilyMember: vi.fn(),
  updateFamilyMember: vi.fn(),
  deleteFamilyMember: vi.fn(),
}));

vi.mock('@/services/automerge/repositories/recurringItemRepository', () => ({
  getAllRecurringItems: vi.fn().mockResolvedValue([]),
  getRecurringItemById: vi.fn(),
  createRecurringItem: vi.fn().mockImplementation((input: any) => ({
    id: `recurring-${Date.now()}`,
    ...input,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })),
  updateRecurringItem: vi.fn(),
  deleteRecurringItem: vi.fn(),
}));

vi.mock('@/services/automerge/repositories/settingsRepository', () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getDefaultSettings: vi.fn(() => ({
    id: 'app_settings',
    baseCurrency: 'USD',
    displayCurrency: 'USD',
    exchangeRates: [],
    theme: 'system',
    syncEnabled: false,
    aiProvider: 'none',
    aiApiKeys: {},
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  })),
}));

// Mock translation composable
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Mock currency display composable
vi.mock('@/composables/useCurrencyDisplay', () => ({
  useCurrencyDisplay: () => ({
    formatInDisplayCurrency: (amount: number, _currency: string) => `$${amount.toFixed(2)}`,
    convertToDisplay: (amount: number, _currency: string) => ({
      displayAmount: amount,
      displayCurrency: 'USD',
    }),
  }),
}));

// Mock recurring processor
const mockProcessRecurringItems = vi.fn().mockResolvedValue({ processed: 0, errors: [] });
const mockGetDueDatesInRange = vi.fn(
  (item: { dayOfMonth?: number }, rangeStart: Date, rangeEnd: Date) => {
    const day = item.dayOfMonth || 1;
    const d = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), day);
    return d >= rangeStart && d <= rangeEnd ? [d] : [];
  }
);
vi.mock('@/services/recurring/recurringProcessor', () => ({
  formatFrequency: vi.fn((item: any) => item.frequency),
  getNextDueDateForItem: vi.fn(() => new Date('2024-02-01T00:00:00.000Z')),
  processRecurringItems: (...args: unknown[]) => mockProcessRecurringItems(...(args as [any])),
  getDueDatesInRange: (...args: unknown[]) => mockGetDueDatesInRange(...(args as [any, any, any])),
}));

describe('TransactionsPage — Unified Ledger', () => {
  let wrapper: any;
  let transactionsStore: any;
  let accountsStore: any;
  let settingsStore: any;
  let recurringStore: any;
  let familyStore: any;

  const createMember = (overrides: Partial<FamilyMember> = {}): FamilyMember => ({
    id: 'member-1',
    name: 'Test User',
    email: 'test@example.com',
    gender: 'other',
    ageGroup: 'adult',
    role: 'owner',
    color: '#3b82f6',
    requiresPassword: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  });

  const createAccount = (overrides: Partial<Account> = {}): Account => ({
    id: 'account-1',
    memberId: 'member-1',
    name: 'Test Account',
    type: 'checking',
    currency: 'USD',
    balance: 1000,
    isActive: true,
    includeInNetWorth: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  });

  const createTransaction = (date: Date, overrides: Partial<Transaction> = {}): Transaction => ({
    id: `txn-${Math.random().toString(36).slice(2)}`,
    accountId: 'account-1',
    type: 'expense',
    amount: 100,
    currency: 'USD',
    category: 'food',
    date: toDateInputValue(date),
    description: 'Test transaction',
    isReconciled: false,
    createdAt: toISODateString(date),
    updatedAt: toISODateString(date),
    ...overrides,
  });

  const createRecurringItem = (overrides: Partial<RecurringItem> = {}): RecurringItem => ({
    id: `recurring-${Math.random().toString(36).slice(2)}`,
    accountId: 'account-1',
    type: 'expense',
    amount: 100,
    currency: 'USD',
    category: 'utilities',
    description: 'Monthly bill',
    frequency: 'monthly',
    dayOfMonth: 1,
    startDate: '2024-01-01T00:00:00.000Z',
    isActive: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  });

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    transactionsStore = useTransactionsStore();
    accountsStore = useAccountsStore();
    settingsStore = useSettingsStore();
    recurringStore = useRecurringStore();
    familyStore = useFamilyStore();

    familyStore.members.push(createMember());
    accountsStore.accounts.push(createAccount());
  });

  describe('Month Navigation', () => {
    it('should default to current month', () => {
      wrapper = mount(TransactionsPage);
      const now = new Date();
      expect(wrapper.vm.selectedMonth.getMonth()).toBe(now.getMonth());
      expect(wrapper.vm.selectedMonth.getFullYear()).toBe(now.getFullYear());
    });

    it('should filter transactions to selected month', () => {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);
      const lastMonth = addMonths(thisMonth, -1);

      transactionsStore.transactions.push(
        createTransaction(thisMonth, { id: 'txn-1', amount: 100, type: 'expense' }),
        createTransaction(lastMonth, { id: 'txn-2', amount: 200, type: 'expense' })
      );

      wrapper = mount(TransactionsPage);

      // Default: current month — should only show txn-1
      expect(wrapper.vm.monthTransactions).toHaveLength(1);
      expect(wrapper.vm.monthTransactions[0].id).toBe('txn-1');
    });

    it('should show previous month transactions after navigating back', async () => {
      const now = new Date();
      const lastMonth = addMonths(now, -1);
      const lastMonthDate = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 15);

      transactionsStore.transactions.push(
        createTransaction(lastMonthDate, { id: 'txn-1', amount: 200, type: 'expense' })
      );

      wrapper = mount(TransactionsPage);
      expect(wrapper.vm.monthTransactions).toHaveLength(0);

      // Navigate to previous month
      wrapper.vm.selectedMonth = addMonths(wrapper.vm.selectedMonth, -1);
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.monthTransactions).toHaveLength(1);
      expect(wrapper.vm.monthTransactions[0].id).toBe('txn-1');
    });
  });

  describe('Filter Pills', () => {
    it('should default to "all" filter', () => {
      wrapper = mount(TransactionsPage);
      expect(wrapper.vm.activeFilter).toBe('all');
    });

    it('should filter to recurring transactions only', async () => {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);

      transactionsStore.transactions.push(
        createTransaction(thisMonth, { id: 'txn-1', recurringItemId: 'r1' }),
        createTransaction(thisMonth, { id: 'txn-2' }) // one-time
      );

      wrapper = mount(TransactionsPage);
      wrapper.vm.activeFilter = 'recurring';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.displayTransactions).toHaveLength(1);
      expect(wrapper.vm.displayTransactions[0].id).toBe('txn-1');
    });

    it('should filter to one-time transactions only', async () => {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);

      transactionsStore.transactions.push(
        createTransaction(thisMonth, { id: 'txn-1', recurringItemId: 'r1' }),
        createTransaction(thisMonth, { id: 'txn-2' }) // one-time
      );

      wrapper = mount(TransactionsPage);
      wrapper.vm.activeFilter = 'one-time';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.displayTransactions).toHaveLength(1);
      expect(wrapper.vm.displayTransactions[0].id).toBe('txn-2');
    });
  });

  describe('Search', () => {
    it('should filter by description', async () => {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);

      transactionsStore.transactions.push(
        createTransaction(thisMonth, { id: 'txn-1', description: 'Grocery shopping' }),
        createTransaction(thisMonth, { id: 'txn-2', description: 'Rent payment' })
      );

      wrapper = mount(TransactionsPage);
      wrapper.vm.searchQuery = 'grocery';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.displayTransactions).toHaveLength(1);
      expect(wrapper.vm.displayTransactions[0].id).toBe('txn-1');
    });

    it('should be case-insensitive', async () => {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);

      transactionsStore.transactions.push(
        createTransaction(thisMonth, { id: 'txn-1', description: 'RENT Payment' })
      );

      wrapper = mount(TransactionsPage);
      wrapper.vm.searchQuery = 'rent';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.displayTransactions).toHaveLength(1);
    });
  });

  describe('Date Grouping', () => {
    it('should group transactions by date', () => {
      const now = new Date();
      const day1 = new Date(now.getFullYear(), now.getMonth(), 15);
      const day2 = new Date(now.getFullYear(), now.getMonth(), 10);

      transactionsStore.transactions.push(
        createTransaction(day1, { id: 'txn-1' }),
        createTransaction(day1, { id: 'txn-2' }),
        createTransaction(day2, { id: 'txn-3' })
      );

      wrapper = mount(TransactionsPage);

      const groups = wrapper.vm.groupedTransactions;
      expect(groups.size).toBe(2);

      const key1 = toDateInputValue(day1);
      const key2 = toDateInputValue(day2);
      expect(groups.get(key1)).toHaveLength(2);
      expect(groups.get(key2)).toHaveLength(1);
    });
  });

  describe('Summary Calculations', () => {
    it('should calculate income total for current month', () => {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);

      transactionsStore.transactions.push(
        createTransaction(thisMonth, { id: 'txn-1', amount: 500, type: 'income' }),
        createTransaction(thisMonth, { id: 'txn-2', amount: 300, type: 'income' })
      );

      wrapper = mount(TransactionsPage);
      expect(wrapper.vm.monthIncome).toBe(800);
    });

    it('should calculate expenses total for current month', () => {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);

      transactionsStore.transactions.push(
        createTransaction(thisMonth, { id: 'txn-1', amount: 100, type: 'expense' }),
        createTransaction(thisMonth, { id: 'txn-2', amount: 200, type: 'expense' })
      );

      wrapper = mount(TransactionsPage);
      expect(wrapper.vm.monthExpenses).toBe(300);
    });

    it('should calculate net correctly', () => {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);

      transactionsStore.transactions.push(
        createTransaction(thisMonth, { id: 'txn-1', amount: 1000, type: 'income' }),
        createTransaction(thisMonth, { id: 'txn-2', amount: 300, type: 'expense' })
      );

      wrapper = mount(TransactionsPage);
      expect(wrapper.vm.monthNet).toBe(700);
    });

    it('should count recurring and one-time transactions', () => {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);

      transactionsStore.transactions.push(
        createTransaction(thisMonth, { id: 'txn-1', recurringItemId: 'r1' }),
        createTransaction(thisMonth, { id: 'txn-2', recurringItemId: 'r2' }),
        createTransaction(thisMonth, { id: 'txn-3' }) // one-time
      );

      wrapper = mount(TransactionsPage);
      expect(wrapper.vm.totalCount).toBe(3);
    });
  });

  describe('Multi-Currency Support', () => {
    it('should convert transactions to base currency for totals', () => {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);

      settingsStore.exchangeRates.push({
        from: 'EUR',
        to: 'USD',
        rate: 1.1,
        updatedAt: toISODateString(new Date()),
      });

      transactionsStore.transactions.push(
        createTransaction(thisMonth, {
          id: 'txn-1',
          amount: 100,
          currency: 'USD',
          type: 'income',
        }),
        createTransaction(thisMonth, {
          id: 'txn-2',
          amount: 100,
          currency: 'EUR',
          type: 'income',
        })
      );

      wrapper = mount(TransactionsPage);

      // 100 USD + (100 EUR * 1.1) = 210
      expect(wrapper.vm.monthIncome).toBe(210);
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no transactions match', () => {
      const now = new Date();
      const lastMonth = addMonths(now, -1);
      const lastMonthDate = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 15);

      transactionsStore.transactions.push(
        createTransaction(lastMonthDate, { id: 'txn-1', amount: 100, type: 'expense' })
      );

      wrapper = mount(TransactionsPage);

      expect(wrapper.vm.displayTransactions).toHaveLength(0);
      expect(wrapper.vm.monthIncome).toBe(0);
      expect(wrapper.vm.monthExpenses).toBe(0);
    });
  });

  describe('One-time Transaction CRUD', () => {
    it('should show a newly added one-time transaction in the current month', () => {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 10);

      wrapper = mount(TransactionsPage);
      expect(wrapper.vm.displayTransactions).toHaveLength(0);

      // Simulate adding a transaction directly to the store (as handleTransactionSave does)
      transactionsStore.transactions.push(
        createTransaction(thisMonth, {
          id: 'txn-new',
          amount: 250,
          type: 'expense',
          description: 'New grocery trip',
        })
      );

      expect(wrapper.vm.displayTransactions).toHaveLength(1);
      expect(wrapper.vm.displayTransactions[0].description).toBe('New grocery trip');
      expect(wrapper.vm.monthExpenses).toBe(250);
    });

    it('should reflect updated transaction amount in summary', async () => {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);

      transactionsStore.transactions.push(
        createTransaction(thisMonth, { id: 'txn-1', amount: 100, type: 'expense' })
      );

      wrapper = mount(TransactionsPage);
      expect(wrapper.vm.monthExpenses).toBe(100);

      // Simulate an edit by updating the store directly
      transactionsStore.transactions[0] = {
        ...transactionsStore.transactions[0],
        amount: 300,
      };
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.monthExpenses).toBe(300);
    });

    it('should remove deleted transaction from the list', async () => {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);

      transactionsStore.transactions.push(
        createTransaction(thisMonth, { id: 'txn-1', amount: 100, type: 'expense' }),
        createTransaction(thisMonth, { id: 'txn-2', amount: 200, type: 'expense' })
      );

      wrapper = mount(TransactionsPage);
      expect(wrapper.vm.displayTransactions).toHaveLength(2);
      expect(wrapper.vm.monthExpenses).toBe(300);

      // Simulate deletion
      transactionsStore.transactions = transactionsStore.transactions.filter(
        (t: Transaction) => t.id !== 'txn-1'
      );
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.displayTransactions).toHaveLength(1);
      expect(wrapper.vm.monthExpenses).toBe(200);
    });
  });

  describe('Recurring Transaction CRUD', () => {
    it('should call processRecurringItems when saving a recurring item', async () => {
      wrapper = mount(TransactionsPage);

      mockProcessRecurringItems.mockResolvedValueOnce({ processed: 1, errors: [] });

      await wrapper.vm.handleSaveRecurring({
        accountId: 'account-1',
        type: 'expense',
        amount: 500,
        currency: 'USD',
        category: 'housing',
        description: 'Monthly rent',
        frequency: 'monthly',
        dayOfMonth: 1,
        startDate: '2026-01-01',
        isActive: true,
      });

      // processRecurringItems should have been called
      expect(mockProcessRecurringItems).toHaveBeenCalledTimes(1);
    });

    it('should display recurring-generated transactions with recurringItemId', () => {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      // Add a recurring item to the recurring store
      const ri = createRecurringItem({ id: 'r1', description: 'Monthly rent', amount: 2000 });
      recurringStore.recurringItems.push(ri);

      // Add the transaction generated from the recurring item
      transactionsStore.transactions.push(
        createTransaction(thisMonth, {
          id: 'txn-gen',
          amount: 2000,
          type: 'expense',
          description: 'Monthly rent',
          recurringItemId: 'r1',
        })
      );

      wrapper = mount(TransactionsPage);

      expect(wrapper.vm.displayTransactions).toHaveLength(1);
      expect(wrapper.vm.displayTransactions[0].recurringItemId).toBe('r1');
    });

    it('should show recurring transactions under "recurring" filter', async () => {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);

      transactionsStore.transactions.push(
        createTransaction(thisMonth, {
          id: 'txn-1',
          description: 'Salary',
          type: 'income',
          recurringItemId: 'r1',
        }),
        createTransaction(thisMonth, {
          id: 'txn-2',
          description: 'Coffee',
          type: 'expense',
        })
      );

      wrapper = mount(TransactionsPage);

      // "all" shows both
      expect(wrapper.vm.displayTransactions).toHaveLength(2);

      // "recurring" shows only the recurring one
      wrapper.vm.activeFilter = 'recurring';
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.displayTransactions).toHaveLength(1);
      expect(wrapper.vm.displayTransactions[0].id).toBe('txn-1');

      // "one-time" shows only the one-time one
      wrapper.vm.activeFilter = 'one-time';
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.displayTransactions).toHaveLength(1);
      expect(wrapper.vm.displayTransactions[0].id).toBe('txn-2');
    });

    it('should include recurring transactions in summary totals', () => {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);

      transactionsStore.transactions.push(
        createTransaction(thisMonth, {
          id: 'txn-1',
          amount: 5000,
          type: 'income',
          recurringItemId: 'r1',
        }),
        createTransaction(thisMonth, {
          id: 'txn-2',
          amount: 200,
          type: 'income',
        }),
        createTransaction(thisMonth, {
          id: 'txn-3',
          amount: 1500,
          type: 'expense',
          recurringItemId: 'r2',
        }),
        createTransaction(thisMonth, {
          id: 'txn-4',
          amount: 50,
          type: 'expense',
        })
      );

      wrapper = mount(TransactionsPage);

      // Income: 5000 + 200 = 5200 (both one-time and recurring)
      expect(wrapper.vm.monthIncome).toBe(5200);
      // Expenses: 1500 + 50 = 1550
      expect(wrapper.vm.monthExpenses).toBe(1550);
      // Net: 5200 - 1550 = 3650
      expect(wrapper.vm.monthNet).toBe(3650);
    });

    it('should remove recurring transaction when deleted from store', async () => {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);

      transactionsStore.transactions.push(
        createTransaction(thisMonth, {
          id: 'txn-1',
          recurringItemId: 'r1',
          amount: 500,
          type: 'expense',
        }),
        createTransaction(thisMonth, {
          id: 'txn-2',
          amount: 100,
          type: 'expense',
        })
      );

      wrapper = mount(TransactionsPage);
      expect(wrapper.vm.monthExpenses).toBe(600);

      // Simulate deletion of recurring-generated transaction
      transactionsStore.transactions = transactionsStore.transactions.filter(
        (t: Transaction) => t.id !== 'txn-1'
      );
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.monthExpenses).toBe(100);
    });
  });

  describe('Projected Transactions (Future Months)', () => {
    it('should show projected transactions for future months', async () => {
      const nextMonth = addMonths(new Date(), 1);

      recurringStore.recurringItems = [
        createRecurringItem({
          id: 'r1',
          description: 'Monthly rent',
          amount: 2000,
          type: 'expense',
          dayOfMonth: 15,
          isActive: true,
        }),
      ];

      wrapper = mount(TransactionsPage);
      wrapper.vm.selectedMonth = nextMonth;
      await wrapper.vm.$nextTick();

      // Should have projected transaction from the recurring item
      expect(wrapper.vm.monthTransactions.length).toBeGreaterThan(0);
      const projected = wrapper.vm.monthTransactions.find(
        (tx: { isProjected?: boolean }) => tx.isProjected
      );
      expect(projected).toBeTruthy();
      expect(projected.amount).toBe(2000);
      expect(projected.description).toBe('Monthly rent');
      expect(projected.recurringItemId).toBe('r1');
    });

    it('should dedup projected transactions against real ones', async () => {
      const nextMonth = addMonths(new Date(), 1);
      const nextMonthDate = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 15);

      recurringStore.recurringItems = [
        createRecurringItem({
          id: 'r1',
          description: 'Monthly rent',
          amount: 2000,
          dayOfMonth: 15,
          isActive: true,
        }),
      ];

      // Add a real transaction for the same date in the future month
      transactionsStore.transactions = [
        createTransaction(nextMonthDate, {
          id: 'txn-real',
          description: 'Monthly rent',
          amount: 2000,
          recurringItemId: 'r1',
        }),
      ];

      wrapper = mount(TransactionsPage);
      wrapper.vm.selectedMonth = nextMonth;
      await wrapper.vm.$nextTick();

      // Should show only the real transaction, not the projected one
      const rentTxns = wrapper.vm.monthTransactions.filter(
        (tx: { recurringItemId?: string }) => tx.recurringItemId === 'r1'
      );
      expect(rentTxns).toHaveLength(1);
      expect(rentTxns[0].isProjected).toBeFalsy();
    });

    it('should sort monthTransactions by date ascending', () => {
      const now = new Date();
      const thisMonth20 = new Date(now.getFullYear(), now.getMonth(), 20);
      const thisMonth5 = new Date(now.getFullYear(), now.getMonth(), 5);
      const thisMonth10 = new Date(now.getFullYear(), now.getMonth(), 10);

      transactionsStore.transactions = [
        createTransaction(thisMonth20, { id: 'txn-20' }),
        createTransaction(thisMonth5, { id: 'txn-5' }),
        createTransaction(thisMonth10, { id: 'txn-10' }),
      ];

      wrapper = mount(TransactionsPage);

      const dates = wrapper.vm.monthTransactions.map((tx: { date: string }) => tx.date);
      for (let i = 1; i < dates.length; i++) {
        expect(dates[i] >= dates[i - 1]).toBe(true);
      }
    });

    it('should include projected transactions in summary totals', async () => {
      const nextMonth = addMonths(new Date(), 1);

      recurringStore.recurringItems = [
        createRecurringItem({
          id: 'r-income',
          type: 'income',
          amount: 5000,
          dayOfMonth: 1,
          isActive: true,
        }),
        createRecurringItem({
          id: 'r-expense',
          type: 'expense',
          amount: 2000,
          dayOfMonth: 15,
          isActive: true,
        }),
      ];

      wrapper = mount(TransactionsPage);
      wrapper.vm.selectedMonth = nextMonth;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.monthIncome).toBe(5000);
      expect(wrapper.vm.monthExpenses).toBe(2000);
      expect(wrapper.vm.monthNet).toBe(3000);
    });

    it('should show projected transactions for current month', () => {
      recurringStore.recurringItems = [
        createRecurringItem({
          id: 'r1',
          amount: 500,
          dayOfMonth: 15,
          isActive: true,
        }),
      ];

      wrapper = mount(TransactionsPage);

      // Current month should show projected transactions for unmaterialized dates
      const projected = wrapper.vm.monthTransactions.filter(
        (tx: { isProjected?: boolean }) => tx.isProjected
      );
      expect(projected).toHaveLength(1);
      expect(projected[0].amount).toBe(500);
    });

    it('should not show projected transactions for past months', async () => {
      const lastMonth = addMonths(new Date(), -1);

      recurringStore.recurringItems = [
        createRecurringItem({
          id: 'r1',
          amount: 500,
          dayOfMonth: 15,
          isActive: true,
        }),
      ];

      wrapper = mount(TransactionsPage);
      wrapper.vm.selectedMonth = lastMonth;
      await wrapper.vm.$nextTick();

      const projected = wrapper.vm.monthTransactions.filter(
        (tx: { isProjected?: boolean }) => tx.isProjected
      );
      expect(projected).toHaveLength(0);
    });

    it('should exclude inactive recurring items from projections', async () => {
      const nextMonth = addMonths(new Date(), 1);

      recurringStore.recurringItems = [
        createRecurringItem({
          id: 'r-active',
          amount: 100,
          dayOfMonth: 10,
          isActive: true,
        }),
        createRecurringItem({
          id: 'r-inactive',
          amount: 200,
          dayOfMonth: 15,
          isActive: false,
        }),
      ];

      wrapper = mount(TransactionsPage);
      wrapper.vm.selectedMonth = nextMonth;
      await wrapper.vm.$nextTick();

      // Only active item should project
      const projected = wrapper.vm.monthTransactions.filter(
        (tx: { isProjected?: boolean }) => tx.isProjected
      );
      expect(projected).toHaveLength(1);
      expect(projected[0].recurringItemId).toBe('r-active');
    });
  });

  describe('Recurring Item Edit Reactivity', () => {
    it('should reflect updated amount in current month after store update', async () => {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);

      recurringStore.recurringItems = [
        createRecurringItem({ id: 'r1', amount: 100, description: 'Old amount', dayOfMonth: 15 }),
      ];
      transactionsStore.transactions = [
        createTransaction(thisMonth, {
          id: 'txn-1',
          amount: 100,
          description: 'Old amount',
          recurringItemId: 'r1',
        }),
      ];

      wrapper = mount(TransactionsPage);
      expect(wrapper.vm.monthExpenses).toBe(100);

      // Simulate updating the materialized transaction (as syncLinkedTransactions does)
      transactionsStore.transactions = transactionsStore.transactions.map((t: Transaction) =>
        t.id === 'txn-1' ? { ...t, amount: 200, description: 'Updated amount' } : t
      );
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.monthExpenses).toBe(200);
      expect(wrapper.vm.displayTransactions[0].description).toBe('Updated amount');
    });

    it('should reflect updated recurring item in projected future transactions', async () => {
      const nextMonth = addMonths(new Date(), 1);

      recurringStore.recurringItems = [
        createRecurringItem({
          id: 'r1',
          amount: 100,
          description: 'Original bill',
          dayOfMonth: 10,
          isActive: true,
        }),
      ];

      wrapper = mount(TransactionsPage);
      wrapper.vm.selectedMonth = nextMonth;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.monthTransactions).toHaveLength(1);
      expect(wrapper.vm.monthTransactions[0].amount).toBe(100);
      expect(wrapper.vm.monthTransactions[0].description).toBe('Original bill');

      // Update the recurring item in the store (immutable update)
      recurringStore.recurringItems = recurringStore.recurringItems.map((item: RecurringItem) =>
        item.id === 'r1' ? { ...item, amount: 250, description: 'Updated bill' } : item
      );
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.monthTransactions).toHaveLength(1);
      expect(wrapper.vm.monthTransactions[0].amount).toBe(250);
      expect(wrapper.vm.monthTransactions[0].description).toBe('Updated bill');
    });

    it('should update projected date when dayOfMonth changes', async () => {
      const nextMonth = addMonths(new Date(), 1);

      recurringStore.recurringItems = [
        createRecurringItem({
          id: 'r1',
          amount: 100,
          dayOfMonth: 5,
          isActive: true,
        }),
      ];

      wrapper = mount(TransactionsPage);
      wrapper.vm.selectedMonth = nextMonth;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.monthTransactions[0].date).toContain('-05');

      // Change dayOfMonth from 5 to 20
      recurringStore.recurringItems = recurringStore.recurringItems.map((item: RecurringItem) =>
        item.id === 'r1' ? { ...item, dayOfMonth: 20 } : item
      );
      // Reset mock to return date with new dayOfMonth
      mockGetDueDatesInRange.mockImplementation(
        (item: { dayOfMonth?: number }, rangeStart: Date, rangeEnd: Date) => {
          const day = item.dayOfMonth || 1;
          const d = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), day);
          return d >= rangeStart && d <= rangeEnd ? [d] : [];
        }
      );
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.monthTransactions[0].date).toContain('-20');
    });
  });

  describe('Deferred Projected Transaction Editing', () => {
    it('should start with no pending state or initial values', () => {
      wrapper = mount(TransactionsPage);

      expect(wrapper.vm.addModalInitialValues).toBeNull();
      expect(wrapper.vm.showAddModal).toBe(false);
    });

    it('should clear pending state when add modal is closed', async () => {
      wrapper = mount(TransactionsPage);

      // Simulate opening add modal with initial values
      wrapper.vm.addModalInitialValues = { amount: 100 } as any;
      wrapper.vm.showAddModal = true;
      await wrapper.vm.$nextTick();

      wrapper.vm.closeAddModal();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showAddModal).toBe(false);
      expect(wrapper.vm.addModalInitialValues).toBeNull();
    });

    it('should clear pending state when edit modal is closed', async () => {
      wrapper = mount(TransactionsPage);

      wrapper.vm.showEditModal = true;
      await wrapper.vm.$nextTick();

      wrapper.vm.closeEditModal();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showEditModal).toBe(false);
      expect(wrapper.vm.editingTransaction).toBeNull();
      expect(wrapper.vm.editingRecurringItem).toBeNull();
    });

    it('should pass initialValues to add modal', async () => {
      wrapper = mount(TransactionsPage);

      const initialValues = {
        accountId: 'account-1',
        type: 'expense' as const,
        amount: 500,
        description: 'Projected bill',
      };
      wrapper.vm.addModalInitialValues = initialValues;
      wrapper.vm.showAddModal = true;
      await wrapper.vm.$nextTick();

      // Verify the add modal receives the initial values prop
      expect(wrapper.vm.addModalInitialValues).toEqual(initialValues);
    });
  });

  describe('Save Flow — Recurring Edit via handleSaveRecurring', () => {
    // Set up repo mocks that simulate real DB behavior (merge input over existing)
    function setupRepoMocks() {
      vi.mocked(recurringItemRepo.updateRecurringItem).mockImplementation(
        async (id: string, input: any) => {
          const existing = recurringStore.recurringItems.find((r: RecurringItem) => r.id === id);
          if (!existing) return undefined as any;
          return { ...existing, ...input, updatedAt: new Date().toISOString() };
        }
      );

      vi.mocked(transactionRepo.updateTransaction).mockImplementation(
        async (id: string, input: any) => {
          const existing = transactionsStore.transactions.find((t: Transaction) => t.id === id);
          if (!existing) return undefined as any;
          return { ...existing, ...input, updatedAt: new Date().toISOString() };
        }
      );
    }

    afterEach(() => {
      // Reset implementations to avoid bleeding into other test blocks
      vi.mocked(recurringItemRepo.updateRecurringItem).mockReset();
      vi.mocked(transactionRepo.updateTransaction).mockReset();
    });

    it('should update transaction date in UI when dayOfMonth changes', async () => {
      const now = new Date();
      const thisMonth15 = new Date(now.getFullYear(), now.getMonth(), 15);

      const ri = createRecurringItem({
        id: 'r1',
        accountId: 'account-1',
        description: 'Monthly bill',
        amount: 100,
        dayOfMonth: 15,
      });

      transactionsStore.transactions = [
        createTransaction(thisMonth15, {
          id: 'txn-1',
          amount: 100,
          description: 'Monthly bill',
          recurringItemId: 'r1',
        }),
      ];
      recurringStore.recurringItems = [ri];
      setupRepoMocks();

      wrapper = mount(TransactionsPage);

      // Verify initial state
      expect(wrapper.vm.monthTransactions).toHaveLength(1);
      expect(wrapper.vm.monthTransactions[0].date).toContain('-15');

      // Simulate: user opens recurring editor and changes dayOfMonth to 25
      wrapper.vm.editingRecurringItem = ri;
      await wrapper.vm.handleSaveRecurring({
        accountId: 'account-1',
        type: 'expense',
        amount: 100,
        currency: 'USD',
        category: 'utilities',
        description: 'Monthly bill',
        frequency: 'monthly',
        dayOfMonth: 25,
        startDate: '2024-01-01',
        isActive: true,
      });
      await wrapper.vm.$nextTick();

      // Assert: transaction date should now show day 25
      expect(wrapper.vm.monthTransactions).toHaveLength(1);
      expect(wrapper.vm.monthTransactions[0].date).toContain('-25');
    });

    it('should update transaction amount and summary when amount changes', async () => {
      const now = new Date();
      const thisMonth15 = new Date(now.getFullYear(), now.getMonth(), 15);

      const ri = createRecurringItem({
        id: 'r1',
        accountId: 'account-1',
        description: 'Monthly bill',
        amount: 100,
        dayOfMonth: 15,
      });

      transactionsStore.transactions = [
        createTransaction(thisMonth15, {
          id: 'txn-1',
          amount: 100,
          type: 'expense',
          description: 'Monthly bill',
          recurringItemId: 'r1',
        }),
      ];
      recurringStore.recurringItems = [ri];
      setupRepoMocks();

      wrapper = mount(TransactionsPage);
      expect(wrapper.vm.monthExpenses).toBe(100);

      wrapper.vm.editingRecurringItem = ri;
      await wrapper.vm.handleSaveRecurring({
        accountId: 'account-1',
        type: 'expense',
        amount: 350,
        currency: 'USD',
        category: 'utilities',
        description: 'Monthly bill',
        frequency: 'monthly',
        dayOfMonth: 15,
        startDate: '2024-01-01',
        isActive: true,
      });
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.monthExpenses).toBe(350);
      expect(wrapper.vm.monthTransactions[0].amount).toBe(350);
    });

    it('should update transaction description in UI when description changes', async () => {
      const now = new Date();
      const thisMonth15 = new Date(now.getFullYear(), now.getMonth(), 15);

      const ri = createRecurringItem({
        id: 'r1',
        accountId: 'account-1',
        description: 'Old name',
        amount: 100,
        dayOfMonth: 15,
      });

      transactionsStore.transactions = [
        createTransaction(thisMonth15, {
          id: 'txn-1',
          amount: 100,
          type: 'expense',
          description: 'Old name',
          recurringItemId: 'r1',
        }),
      ];
      recurringStore.recurringItems = [ri];
      setupRepoMocks();

      wrapper = mount(TransactionsPage);
      expect(wrapper.vm.monthTransactions[0].description).toBe('Old name');

      wrapper.vm.editingRecurringItem = ri;
      await wrapper.vm.handleSaveRecurring({
        accountId: 'account-1',
        type: 'expense',
        amount: 100,
        currency: 'USD',
        category: 'utilities',
        description: 'New name',
        frequency: 'monthly',
        dayOfMonth: 15,
        startDate: '2024-01-01',
        isActive: true,
      });
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.monthTransactions[0].description).toBe('New name');
    });

    it('should propagate all field changes through to UI after save', async () => {
      const now = new Date();
      const thisMonth15 = new Date(now.getFullYear(), now.getMonth(), 15);

      const ri = createRecurringItem({
        id: 'r1',
        accountId: 'account-1',
        type: 'expense',
        description: 'Original',
        amount: 100,
        currency: 'USD',
        category: 'utilities',
        dayOfMonth: 15,
      });

      transactionsStore.transactions = [
        createTransaction(thisMonth15, {
          id: 'txn-1',
          accountId: 'account-1',
          amount: 100,
          type: 'expense',
          currency: 'USD',
          category: 'utilities',
          description: 'Original',
          recurringItemId: 'r1',
        }),
      ];
      recurringStore.recurringItems = [ri];
      setupRepoMocks();

      wrapper = mount(TransactionsPage);

      wrapper.vm.editingRecurringItem = ri;
      await wrapper.vm.handleSaveRecurring({
        accountId: 'account-1',
        type: 'expense',
        amount: 500,
        currency: 'USD',
        category: 'housing',
        description: 'Updated',
        frequency: 'monthly',
        dayOfMonth: 20,
        startDate: '2024-01-01',
        isActive: true,
      });
      await wrapper.vm.$nextTick();

      const updatedTx = wrapper.vm.monthTransactions[0];
      expect(updatedTx.amount).toBe(500);
      expect(updatedTx.description).toBe('Updated');
      expect(updatedTx.category).toBe('housing');
      expect(updatedTx.date).toContain('-20');
      expect(wrapper.vm.monthExpenses).toBe(500);
    });
  });
});
