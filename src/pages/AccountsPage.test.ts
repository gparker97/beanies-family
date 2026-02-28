import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import AccountsPage from './AccountsPage.vue';

// Mock the stores
vi.mock('@/stores/accountsStore', () => ({
  useAccountsStore: vi.fn(() => {
    const mockAccounts = [
      {
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
      },
    ];
    return {
      accounts: mockAccounts,
      filteredAccounts: mockAccounts,
      filteredTotalAssets: 1000,
      filteredTotalLiabilities: 0,
      filteredTotalBalance: 1000,
      totalAssets: 1000,
      totalLiabilities: 0,
      totalBalance: 1000,
      createAccount: vi.fn(),
      updateAccount: vi.fn(),
      deleteAccount: vi.fn(),
    };
  }),
}));

vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: vi.fn(() => ({
    currentMemberId: 'member-1',
    members: [
      {
        id: 'member-1',
        name: 'John Doe',
        email: 'john@example.com',
        gender: 'other',
        ageGroup: 'adult',
        role: 'owner',
        color: '#3b82f6',
        requiresPassword: false,
      },
      {
        id: 'member-2',
        name: 'Jane Doe',
        email: 'jane@example.com',
        gender: 'other',
        ageGroup: 'adult',
        role: 'member',
        color: '#10b981',
        requiresPassword: false,
      },
    ],
  })),
}));

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: vi.fn(() => ({
    baseCurrency: 'USD',
    displayCurrency: 'USD',
    settings: { exchangeRates: [] },
    customInstitutions: [],
    addCustomInstitution: vi.fn(),
  })),
}));

vi.mock('@/composables/useCurrencyDisplay', () => ({
  useCurrencyDisplay: vi.fn(() => ({
    formatInDisplayCurrency: (amount: number) => `$${(amount || 0).toFixed(2)}`,
    convertToDisplay: (amount: number, currency: string) => ({
      displayAmount: amount || 0,
      originalAmount: amount || 0,
      displayCurrency: 'USD',
      originalCurrency: currency,
      isConverted: false,
      conversionFailed: false,
    }),
    hasRate: () => true,
  })),
}));

// Mock formatCurrency
vi.mock('@/constants/currencies', () => ({
  formatCurrency: (amount: number, currency: string) => `${currency} ${amount.toFixed(2)}`,
  getCurrencyInfo: (code: string) => {
    const currencies: Record<
      string,
      { code: string; name: string; symbol: string; decimals: number }
    > = {
      USD: { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2 },
      SGD: { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', decimals: 2 },
    };
    return currencies[code];
  },
  CURRENCIES: [
    { code: 'USD', name: 'US Dollar', symbol: '$' },
    { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
  ],
}));

const defaultStubs = {
  BaseCard: { template: '<div><slot /></div>' },
  BaseButton: { template: '<button @click="$emit(\'click\')"><slot /></button>' },
  AccountModal: {
    template: '<div v-if="open" data-testid="account-modal"><slot /></div>',
    props: ['open', 'account'],
    emits: ['close', 'save', 'delete'],
  },
  CurrencyAmount: { template: '<span>$0.00</span>' },
  SummaryStatCard: { template: '<div><slot /></div>', props: ['title', 'icon', 'iconBg'] },
  EmptyStateIllustration: { template: '<div />' },
  BeanieIcon: { template: '<span />' },
};

describe('AccountsPage - Edit Account Modal', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('should display an edit button for each account', () => {
    const wrapper = mount(AccountsPage, {
      global: { stubs: defaultStubs },
    });

    const editButtons = wrapper.findAll('[data-testid="edit-account-btn"]');
    expect(editButtons.length).toBeGreaterThan(0);
  });

  it('should open account modal when clicking edit button', async () => {
    const wrapper = mount(AccountsPage, {
      global: { stubs: defaultStubs },
    });

    // Click edit button
    const editButton = wrapper.find('[data-testid="edit-account-btn"]');
    await editButton.trigger('click');

    // AccountModal should be visible (open prop becomes true)
    const modal = wrapper.find('[data-testid="account-modal"]');
    expect(modal.exists()).toBe(true);
  });

  it('should set editingAccount when clicking edit button', async () => {
    const wrapper = mount(AccountsPage, {
      global: { stubs: defaultStubs },
    });

    // Click edit button
    const editButton = wrapper.find('[data-testid="edit-account-btn"]');
    await editButton.trigger('click');

    // The edit modal should now be visible (open prop = true)
    const modal = wrapper.find('[data-testid="account-modal"]');
    expect(modal.exists()).toBe(true);

    // Verify the page's internal state changed
    expect(wrapper.vm.showEditModal).toBe(true);
    expect(wrapper.vm.editingAccount).not.toBeNull();
    expect(wrapper.vm.editingAccount?.id).toBe('test-account-1');
  });
});

describe('AccountsPage - Display', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('should display accounts page with account name', () => {
    const wrapper = mount(AccountsPage, {
      global: { stubs: defaultStubs },
    });

    expect(wrapper.html()).toContain('Test Checking');
  });

  it('should use CurrencyAmount component for displaying balances', () => {
    const wrapper = mount(AccountsPage, {
      global: { stubs: defaultStubs },
    });

    const currencyAmounts = wrapper.findAll('span');
    // Should have some currency amount displays
    expect(currencyAmounts.length).toBeGreaterThan(0);
  });
});
