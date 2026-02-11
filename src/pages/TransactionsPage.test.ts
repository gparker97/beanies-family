import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import TransactionsPage from './TransactionsPage.vue';
import { useAccountsStore } from '@/stores/accountsStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useRecurringStore } from '@/stores/recurringStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTransactionsStore } from '@/stores/transactionsStore';
import type { Transaction, Account, FamilyMember, RecurringItem } from '@/types/models';
import { toISODateString, addMonths } from '@/utils/date';

// Mock repositories
vi.mock('@/services/indexeddb/repositories/transactionRepository', () => ({
  getAllTransactions: vi.fn(),
  getTransactionById: vi.fn(),
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
}));

vi.mock('@/services/indexeddb/repositories/accountRepository', () => ({
  getAllAccounts: vi.fn(),
  getAccountById: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  updateAccountBalance: vi.fn(),
}));

vi.mock('@/services/indexeddb/repositories/familyMemberRepository', () => ({
  getAllFamilyMembers: vi.fn(),
  getFamilyMemberById: vi.fn(),
  createFamilyMember: vi.fn(),
  updateFamilyMember: vi.fn(),
  deleteFamilyMember: vi.fn(),
}));

vi.mock('@/services/indexeddb/repositories/recurringItemRepository', () => ({
  getAllRecurringItems: vi.fn(),
  getRecurringItemById: vi.fn(),
  createRecurringItem: vi.fn(),
  updateRecurringItem: vi.fn(),
  deleteRecurringItem: vi.fn(),
}));

vi.mock('@/services/indexeddb/repositories/settingsRepository', () => ({
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
vi.mock('@/services/recurring/recurringProcessor', () => ({
  formatFrequency: vi.fn((item) => item.frequency),
  getNextDueDateForItem: vi.fn(() => new Date('2024-02-01T00:00:00.000Z')),
}));

describe('TransactionsPage - Date Filter', () => {
  let wrapper: any;
  let transactionsStore: any;
  let accountsStore: any;
  let settingsStore: any;
  let recurringStore: any;
  let familyStore: any;

  // Helper to create a test family member
  const createMember = (overrides: Partial<FamilyMember> = {}): FamilyMember => ({
    id: 'member-1',
    name: 'Test User',
    email: 'test@example.com',
    role: 'owner',
    color: '#3b82f6',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  });

  // Helper to create a test account
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

  // Helper to create a transaction with a specific date
  const createTransaction = (date: Date, overrides: Partial<Transaction> = {}): Transaction => ({
    id: `txn-${Math.random().toString(36).slice(2)}`,
    accountId: 'account-1',
    type: 'expense',
    amount: 100,
    currency: 'USD',
    category: 'food',
    date: toISODateString(date),
    description: 'Test transaction',
    isReconciled: false,
    createdAt: toISODateString(date),
    updatedAt: toISODateString(date),
    ...overrides,
  });

  // Helper to create a recurring item
  const createRecurringItem = (overrides: Partial<RecurringItem> = {}): RecurringItem => ({
    id: `recurring-${Math.random().toString(36).slice(2)}`,
    accountId: 'account-1',
    type: 'expense',
    amount: 100,
    currency: 'USD',
    category: 'utilities',
    description: 'Monthly bill',
    frequency: 'monthly',
    startDate: '2024-01-01T00:00:00.000Z',
    isActive: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  });

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    // Initialize stores
    transactionsStore = useTransactionsStore();
    accountsStore = useAccountsStore();
    settingsStore = useSettingsStore();
    recurringStore = useRecurringStore();
    familyStore = useFamilyStore();

    // Set up test data
    familyStore.members.push(createMember());
    accountsStore.accounts.push(createAccount());

    // Settings are initialized from mock with USD as default
  });

  describe('Current Month Filter', () => {
    it('should filter transactions to current month only', () => {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);
      const lastMonth = addMonths(thisMonth, -1);
      const nextMonth = addMonths(thisMonth, 1);

      // Add transactions across different months
      transactionsStore.transactions.push(
        createTransaction(thisMonth, { id: 'txn-1', amount: 100, type: 'expense' }),
        createTransaction(lastMonth, { id: 'txn-2', amount: 200, type: 'expense' }),
        createTransaction(nextMonth, { id: 'txn-3', amount: 300, type: 'expense' })
      );

      wrapper = mount(TransactionsPage);

      // Should only show current month transaction
      const filteredTransactions = wrapper.vm.transactions;
      expect(filteredTransactions).toHaveLength(1);
      expect(filteredTransactions[0].id).toBe('txn-1');
    });

    it('should calculate correct income total for current month', () => {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);
      const lastMonth = addMonths(thisMonth, -1);

      transactionsStore.transactions.push(
        createTransaction(thisMonth, { id: 'txn-1', amount: 500, type: 'income' }),
        createTransaction(thisMonth, { id: 'txn-2', amount: 300, type: 'income' }),
        createTransaction(lastMonth, { id: 'txn-3', amount: 1000, type: 'income' }) // Should not be counted
      );

      wrapper = mount(TransactionsPage);

      // Current month income should be 500 + 300 = 800
      expect(wrapper.vm.dateFilteredIncome).toBe(800);
    });

    it('should calculate correct expenses total for current month', () => {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);
      const lastMonth = addMonths(thisMonth, -1);

      transactionsStore.transactions.push(
        createTransaction(thisMonth, { id: 'txn-1', amount: 100, type: 'expense' }),
        createTransaction(thisMonth, { id: 'txn-2', amount: 200, type: 'expense' }),
        createTransaction(lastMonth, { id: 'txn-3', amount: 500, type: 'expense' }) // Should not be counted
      );

      wrapper = mount(TransactionsPage);

      // Current month expenses should be 100 + 200 = 300
      expect(wrapper.vm.dateFilteredExpenses).toBe(300);
    });

    it('should include recurring transactions in current month totals', () => {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);

      // Add one-time transactions
      transactionsStore.transactions.push(
        createTransaction(thisMonth, { id: 'txn-1', amount: 200, type: 'income' }),
        createTransaction(thisMonth, { id: 'txn-2', amount: 50, type: 'expense' })
      );

      // Add recurring items
      recurringStore.recurringItems.push(
        createRecurringItem({ id: 'r1', type: 'income', amount: 5000 }),
        createRecurringItem({ id: 'r2', type: 'expense', amount: 2000 })
      );

      wrapper = mount(TransactionsPage);

      // When on current month filter, recurring should be included
      expect(wrapper.vm.dateFilterType).toBe('current_month');

      // Total income: 200 (one-time) + 5000 (recurring) = 5200
      const totalIncome =
        wrapper.vm.dateFilteredIncome + recurringStore.filteredTotalMonthlyRecurringIncome;
      expect(totalIncome).toBe(5200);

      // Total expenses: 50 (one-time) + 2000 (recurring) = 2050
      const totalExpenses =
        wrapper.vm.dateFilteredExpenses + recurringStore.filteredTotalMonthlyRecurringExpenses;
      expect(totalExpenses).toBe(2050);
    });

    it('should exclude transactions with recurringItemId from one-time totals', () => {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);

      transactionsStore.transactions.push(
        createTransaction(thisMonth, { id: 'txn-1', amount: 100, type: 'income' }), // One-time
        createTransaction(thisMonth, {
          id: 'txn-2',
          amount: 5000,
          type: 'income',
          recurringItemId: 'r1',
        }) // Generated from recurring
      );

      wrapper = mount(TransactionsPage);

      // Should only count the one-time transaction
      expect(wrapper.vm.dateFilteredIncome).toBe(100);
    });
  });

  describe('Last Month Filter', () => {
    it('should filter transactions to last month only', async () => {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);
      const lastMonth = addMonths(thisMonth, -1);
      const twoMonthsAgo = addMonths(thisMonth, -2);

      transactionsStore.transactions.push(
        createTransaction(thisMonth, { id: 'txn-1', amount: 100, type: 'expense' }),
        createTransaction(lastMonth, { id: 'txn-2', amount: 200, type: 'expense' }),
        createTransaction(twoMonthsAgo, { id: 'txn-3', amount: 300, type: 'expense' })
      );

      wrapper = mount(TransactionsPage);

      // Switch to last month filter
      wrapper.vm.setDateFilter('last_month');
      await wrapper.vm.$nextTick();

      const filteredTransactions = wrapper.vm.transactions;
      expect(filteredTransactions).toHaveLength(1);
      expect(filteredTransactions[0].id).toBe('txn-2');
    });

    it('should calculate correct totals for last month', async () => {
      const now = new Date();
      const lastMonth = addMonths(now, -1);
      const lastMonthDate = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 15);

      transactionsStore.transactions.push(
        createTransaction(lastMonthDate, { id: 'txn-1', amount: 800, type: 'income' }),
        createTransaction(lastMonthDate, { id: 'txn-2', amount: 400, type: 'expense' })
      );

      wrapper = mount(TransactionsPage);
      wrapper.vm.setDateFilter('last_month');
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.dateFilteredIncome).toBe(800);
      expect(wrapper.vm.dateFilteredExpenses).toBe(400);
    });

    it('should NOT include recurring items in last month totals', async () => {
      const now = new Date();
      const lastMonth = addMonths(now, -1);
      const lastMonthDate = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 15);

      transactionsStore.transactions.push(
        createTransaction(lastMonthDate, { id: 'txn-1', amount: 200, type: 'income' })
      );

      recurringStore.recurringItems.push(
        createRecurringItem({ id: 'r1', type: 'income', amount: 5000 })
      );

      wrapper = mount(TransactionsPage);
      wrapper.vm.setDateFilter('last_month');
      await wrapper.vm.$nextTick();

      // Recurring items should NOT be included for last month
      expect(wrapper.vm.dateFilterType).toBe('last_month');
      expect(wrapper.vm.dateFilteredIncome).toBe(200); // Only one-time transactions
    });
  });

  describe('Last 3 Months Filter', () => {
    it('should filter transactions to last 3 months', async () => {
      const now = new Date();
      const month1 = new Date(now.getFullYear(), now.getMonth(), 15); // This month
      const month2 = addMonths(month1, -1); // 1 month ago
      const month3 = addMonths(month1, -2); // 2 months ago
      const month4 = addMonths(month1, -3); // 3 months ago (should be excluded)

      transactionsStore.transactions.push(
        createTransaction(month1, { id: 'txn-1', amount: 100, type: 'expense' }),
        createTransaction(month2, { id: 'txn-2', amount: 200, type: 'expense' }),
        createTransaction(month3, { id: 'txn-3', amount: 300, type: 'expense' }),
        createTransaction(month4, { id: 'txn-4', amount: 400, type: 'expense' })
      );

      wrapper = mount(TransactionsPage);
      wrapper.vm.setDateFilter('last_3_months');
      await wrapper.vm.$nextTick();

      const filteredTransactions = wrapper.vm.transactions;
      expect(filteredTransactions).toHaveLength(3);
      expect(filteredTransactions.map((t: Transaction) => t.id)).toEqual([
        'txn-1',
        'txn-2',
        'txn-3',
      ]);
    });

    it('should calculate correct totals for last 3 months', async () => {
      const now = new Date();
      const month1 = new Date(now.getFullYear(), now.getMonth(), 15);
      const month2 = addMonths(month1, -1);
      const month3 = addMonths(month1, -2);

      transactionsStore.transactions.push(
        createTransaction(month1, { id: 'txn-1', amount: 1000, type: 'income' }),
        createTransaction(month2, { id: 'txn-2', amount: 1200, type: 'income' }),
        createTransaction(month3, { id: 'txn-3', amount: 800, type: 'income' }),
        createTransaction(month1, { id: 'txn-4', amount: 100, type: 'expense' }),
        createTransaction(month2, { id: 'txn-5', amount: 200, type: 'expense' }),
        createTransaction(month3, { id: 'txn-6', amount: 150, type: 'expense' })
      );

      wrapper = mount(TransactionsPage);
      wrapper.vm.setDateFilter('last_3_months');
      await wrapper.vm.$nextTick();

      // Income: 1000 + 1200 + 800 = 3000
      expect(wrapper.vm.dateFilteredIncome).toBe(3000);

      // Expenses: 100 + 200 + 150 = 450
      expect(wrapper.vm.dateFilteredExpenses).toBe(450);
    });
  });

  describe('Custom Date Range Filter', () => {
    it('should filter transactions by custom date range', async () => {
      const date1 = new Date('2024-01-15');
      const date2 = new Date('2024-02-15');
      const date3 = new Date('2024-03-15');

      transactionsStore.transactions.push(
        createTransaction(date1, { id: 'txn-1', amount: 100, type: 'expense' }),
        createTransaction(date2, { id: 'txn-2', amount: 200, type: 'expense' }),
        createTransaction(date3, { id: 'txn-3', amount: 300, type: 'expense' })
      );

      wrapper = mount(TransactionsPage);

      // Set custom date range (Jan 1 - Feb 28)
      wrapper.vm.customStartDate = '2024-01-01';
      wrapper.vm.customEndDate = '2024-02-28';
      wrapper.vm.setDateFilter('custom');
      await wrapper.vm.$nextTick();

      const filteredTransactions = wrapper.vm.transactions;
      expect(filteredTransactions).toHaveLength(2);
      // Transactions are sorted by date (newest first), so txn-2 comes before txn-1
      expect(filteredTransactions.map((t: Transaction) => t.id)).toContain('txn-1');
      expect(filteredTransactions.map((t: Transaction) => t.id)).toContain('txn-2');
    });

    it('should calculate correct totals for custom date range', async () => {
      const date1 = new Date('2024-01-15');
      const date2 = new Date('2024-02-15');
      const date3 = new Date('2024-03-15');

      transactionsStore.transactions.push(
        createTransaction(date1, { id: 'txn-1', amount: 500, type: 'income' }),
        createTransaction(date2, { id: 'txn-2', amount: 700, type: 'income' }),
        createTransaction(date3, { id: 'txn-3', amount: 900, type: 'income' }),
        createTransaction(date1, { id: 'txn-4', amount: 100, type: 'expense' }),
        createTransaction(date2, { id: 'txn-5', amount: 150, type: 'expense' })
      );

      wrapper = mount(TransactionsPage);

      wrapper.vm.customStartDate = '2024-01-01';
      wrapper.vm.customEndDate = '2024-02-28';
      wrapper.vm.setDateFilter('custom');
      await wrapper.vm.$nextTick();

      // Income: 500 + 700 = 1200 (txn-3 excluded)
      expect(wrapper.vm.dateFilteredIncome).toBe(1200);

      // Expenses: 100 + 150 = 250 (only Jan-Feb)
      expect(wrapper.vm.dateFilteredExpenses).toBe(250);
    });

    it('should show correct date filter label for custom range', async () => {
      wrapper = mount(TransactionsPage);

      wrapper.vm.customStartDate = '2024-01-15';
      wrapper.vm.customEndDate = '2024-03-20';
      wrapper.vm.setDateFilter('custom');
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.dateFilterLabel).toBe('2024-01-15 to 2024-03-20');
    });
  });

  describe('Date Filter UI', () => {
    it('should default to current_month filter', () => {
      wrapper = mount(TransactionsPage);
      expect(wrapper.vm.dateFilterType).toBe('current_month');
    });

    it('should update dateFilterType when setDateFilter is called', async () => {
      wrapper = mount(TransactionsPage);

      expect(wrapper.vm.dateFilterType).toBe('current_month');

      wrapper.vm.setDateFilter('last_month');
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.dateFilterType).toBe('last_month');

      wrapper.vm.setDateFilter('last_3_months');
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.dateFilterType).toBe('last_3_months');
    });

    it('should show custom date picker when custom filter is selected', async () => {
      wrapper = mount(TransactionsPage);

      expect(wrapper.vm.showCustomDatePicker).toBe(false);

      wrapper.vm.setDateFilter('custom');
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showCustomDatePicker).toBe(true);
    });

    it('should hide custom date picker when other filters are selected', async () => {
      wrapper = mount(TransactionsPage);

      wrapper.vm.setDateFilter('custom');
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.showCustomDatePicker).toBe(true);

      wrapper.vm.setDateFilter('current_month');
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.showCustomDatePicker).toBe(false);
    });
  });

  describe('Empty State', () => {
    it('should show empty state when no transactions match filter', () => {
      const now = new Date();
      const lastMonth = addMonths(now, -1);
      const lastMonthDate = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 15);

      // Add transactions only for last month
      transactionsStore.transactions.push(
        createTransaction(lastMonthDate, { id: 'txn-1', amount: 100, type: 'expense' })
      );

      wrapper = mount(TransactionsPage);

      // Current month should have no transactions
      expect(wrapper.vm.transactions).toHaveLength(0);
      expect(wrapper.vm.dateFilteredIncome).toBe(0);
      expect(wrapper.vm.dateFilteredExpenses).toBe(0);
    });
  });

  describe('Multi-Currency Support', () => {
    it('should convert transactions to base currency for totals', () => {
      const now = new Date();
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);

      // Set up exchange rate
      settingsStore.exchangeRates.push({
        from: 'EUR',
        to: 'USD',
        rate: 1.1,
        updatedAt: toISODateString(new Date()),
      });

      transactionsStore.transactions.push(
        createTransaction(thisMonth, { id: 'txn-1', amount: 100, currency: 'USD', type: 'income' }),
        createTransaction(thisMonth, { id: 'txn-2', amount: 100, currency: 'EUR', type: 'income' }) // 100 EUR = 110 USD
      );

      wrapper = mount(TransactionsPage);

      // Should convert EUR to USD: 100 + (100 * 1.1) = 210
      expect(wrapper.vm.dateFilteredIncome).toBe(210);
    });
  });
});
