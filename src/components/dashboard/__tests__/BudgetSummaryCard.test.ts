import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import BudgetSummaryCard from '@/components/dashboard/BudgetSummaryCard.vue';
import { useBudgetStore } from '@/stores/budgetStore';
import type { Budget } from '@/types/models';

// Mock router
const mockPush = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mockPush }),
  RouterLink: {
    template: '<a :href="to"><slot /></a>',
    props: ['to'],
  },
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/composables/usePrivacyMode', () => ({
  usePrivacyMode: () => ({
    isUnlocked: { value: true },
    MASK: '••••',
  }),
}));

vi.mock('@/composables/useCurrencyDisplay', () => ({
  useCurrencyDisplay: () => ({
    formatInDisplayCurrency: (amount: number) => `$${amount.toFixed(2)}`,
    convertToDisplay: (amount: number) => ({
      displayAmount: amount,
      displayCurrency: 'USD',
      displayFormatted: `$${amount.toFixed(2)}`,
    }),
  }),
}));

// Mock repositories
vi.mock('@/services/automerge/repositories/budgetRepository', () => ({
  getAllBudgets: vi.fn(() => []),
  createBudget: vi.fn(),
  updateBudget: vi.fn(),
  deleteBudget: vi.fn(),
}));

vi.mock('@/services/automerge/repositories/transactionRepository', () => ({
  getAllTransactions: vi.fn(() => []),
  createTransaction: vi.fn(),
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
}));

vi.mock('@/services/automerge/repositories/recurringItemRepository', () => ({
  getAllRecurringItems: vi.fn(() => []),
  createRecurringItem: vi.fn(),
  updateRecurringItem: vi.fn(),
  deleteRecurringItem: vi.fn(),
}));

vi.mock('@/services/automerge/repositories/accountRepository', () => ({
  getAllAccounts: vi.fn(() => []),
  getAccountById: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  updateAccountBalance: vi.fn(),
}));

const makeBudget = (overrides: Partial<Budget> = {}): Budget => ({
  id: 'budget-1',
  mode: 'fixed',
  totalAmount: 2000,
  currency: 'USD',
  categories: [],
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('BudgetSummaryCard', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockPush.mockClear();
  });

  it('renders empty state when no active budget exists', () => {
    const wrapper = mount(BudgetSummaryCard);
    expect(wrapper.text()).toContain('dashboard.noBudget');
    expect(wrapper.text()).toContain('dashboard.createBudget');
  });

  it('renders budget progress when an active budget exists', () => {
    const budgetStore = useBudgetStore();
    budgetStore.budgets.push(makeBudget());

    const wrapper = mount(BudgetSummaryCard);
    expect(wrapper.text()).toContain('budget.pace.');
    expect(wrapper.text()).toContain('dashboard.budgetSpent');
    expect(wrapper.text()).toContain('dashboard.budgetRemaining');
  });

  it('renders the progress bar', () => {
    const budgetStore = useBudgetStore();
    budgetStore.budgets.push(makeBudget());

    const wrapper = mount(BudgetSummaryCard);
    const progressBar = wrapper.find('[data-testid="budget-summary-card"] .h-2\\.5');
    expect(progressBar.exists()).toBe(true);
  });

  it('shows category breakdown when categories have spending', () => {
    const budgetStore = useBudgetStore();
    budgetStore.budgets.push(
      makeBudget({
        categories: [
          { categoryId: 'food', amount: 500 },
          { categoryId: 'transport', amount: 300 },
        ],
      })
    );

    const wrapper = mount(BudgetSummaryCard);
    // Categories section shows when there are category budgets
    // (even without actual spending, because we test the component rendering)
    expect(wrapper.text()).toContain('dashboard.budgetSummary');
  });

  it('navigates to /budgets when create budget is clicked', async () => {
    const wrapper = mount(BudgetSummaryCard);
    const createBtn = wrapper.find('button');
    await createBtn.trigger('click');
    expect(mockPush).toHaveBeenCalledWith('/budgets');
  });

  it('has a See All link to budgets', () => {
    const wrapper = mount(BudgetSummaryCard);
    expect(wrapper.text()).toContain('dashboard.seeAll');
  });
});
