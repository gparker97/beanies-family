import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import AccountsPage from './AccountsPage.vue';

// Mock the stores
vi.mock('@/stores/accountsStore', () => ({
  useAccountsStore: vi.fn(() => ({
    accounts: [
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
    ],
    totalAssets: 1000,
    totalLiabilities: 0,
    totalBalance: 1000,
    createAccount: vi.fn(),
    updateAccount: vi.fn(),
    deleteAccount: vi.fn(),
  })),
}));

vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: vi.fn(() => ({
    currentMemberId: 'member-1',
    members: [
      { id: 'member-1', name: 'John Doe', email: 'john@example.com', role: 'owner', color: '#3b82f6' },
      { id: 'member-2', name: 'Jane Doe', email: 'jane@example.com', role: 'member', color: '#10b981' },
    ],
  })),
}));

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: vi.fn(() => ({
    baseCurrency: 'USD',
  })),
}));

// Mock formatCurrency
vi.mock('@/constants/currencies', () => ({
  formatCurrency: (amount: number, currency: string) => `${currency} ${amount.toFixed(2)}`,
  getCurrencyInfo: (code: string) => {
    const currencies: Record<string, { code: string; name: string; symbol: string; decimals: number }> = {
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

describe('AccountsPage - Edit Account Modal', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('should display an edit button for each account', () => {
    const wrapper = mount(AccountsPage, {
      global: {
        stubs: {
          BaseCard: { template: '<div><slot /></div>' },
          BaseButton: { template: '<button><slot /></button>' },
          BaseInput: { template: '<input />' },
          BaseSelect: { template: '<select />' },
          BaseModal: { template: '<div v-if="open"><slot /><slot name="footer" /></div>', props: ['open', 'title'] },
        },
      },
    });

    // Find edit buttons (should have one for each account)
    const editButtons = wrapper.findAll('[data-testid="edit-account-btn"]');
    expect(editButtons.length).toBeGreaterThan(0);
  });

  it('should open edit modal when clicking edit button', async () => {
    const wrapper = mount(AccountsPage, {
      global: {
        stubs: {
          BaseCard: { template: '<div><slot /></div>' },
          BaseButton: { template: '<button @click="$emit(\'click\')"><slot /></button>' },
          BaseInput: { template: '<input />' },
          BaseSelect: { template: '<select />' },
          BaseModal: { template: '<div v-if="open" data-testid="edit-modal"><slot /><slot name="footer" /></div>', props: ['open', 'title'] },
        },
      },
    });

    // Click edit button
    const editButton = wrapper.find('[data-testid="edit-account-btn"]');
    await editButton.trigger('click');

    // Edit modal should be visible
    const editModal = wrapper.find('[data-testid="edit-modal"]');
    expect(editModal.exists()).toBe(true);
  });

  it('should populate edit modal with current account values', async () => {
    const wrapper = mount(AccountsPage, {
      global: {
        stubs: {
          BaseCard: { template: '<div><slot /></div>' },
          BaseButton: { template: '<button @click="$emit(\'click\')"><slot /></button>' },
          BaseInput: {
            template: '<input :value="modelValue" data-testid="input" />',
            props: ['modelValue', 'label'],
          },
          BaseSelect: {
            template: '<select :value="modelValue" data-testid="select" />',
            props: ['modelValue', 'options', 'label'],
          },
          BaseModal: {
            template: '<div v-if="open" data-testid="edit-modal"><slot /><slot name="footer" /></div>',
            props: ['open', 'title'],
          },
        },
      },
    });

    // Click edit button
    const editButton = wrapper.find('[data-testid="edit-account-btn"]');
    await editButton.trigger('click');

    // The edit account data should be populated
    // We check that the component's internal state has the account data
    expect(wrapper.vm.editingAccount).toBeDefined();
    expect(wrapper.vm.editingAccount.name).toBe('Test Checking');
    expect(wrapper.vm.editingAccount.balance).toBe(1000);
  });

  it('should have a family member selector in edit modal', async () => {
    const wrapper = mount(AccountsPage, {
      global: {
        stubs: {
          BaseCard: { template: '<div><slot /></div>' },
          BaseButton: { template: '<button @click="$emit(\'click\')"><slot /></button>' },
          BaseInput: { template: '<input />' },
          BaseSelect: {
            template: '<select :data-label="label" />',
            props: ['modelValue', 'options', 'label'],
          },
          BaseModal: {
            template: '<div v-if="open" data-testid="edit-modal"><slot /><slot name="footer" /></div>',
            props: ['open', 'title'],
          },
        },
      },
    });

    // Click edit button
    const editButton = wrapper.find('[data-testid="edit-account-btn"]');
    await editButton.trigger('click');

    // Find family member selector (should have label "Owner" or "Family Member")
    const selects = wrapper.findAll('select');
    const memberSelect = selects.find(
      s => s.attributes('data-label')?.toLowerCase().includes('owner') ||
           s.attributes('data-label')?.toLowerCase().includes('member')
    );
    expect(memberSelect).toBeDefined();
  });

  it('should call updateAccount when saving changes', async () => {
    const mockUpdateAccount = vi.fn().mockResolvedValue({
      id: 'test-account-1',
      name: 'Updated Name',
      balance: 2000,
      memberId: 'member-2',
    });

    vi.mocked(await import('@/stores/accountsStore')).useAccountsStore.mockReturnValue({
      accounts: [
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
      ],
      totalAssets: 1000,
      totalLiabilities: 0,
      totalBalance: 1000,
      createAccount: vi.fn(),
      updateAccount: mockUpdateAccount,
      deleteAccount: vi.fn(),
    } as any);

    const wrapper = mount(AccountsPage, {
      global: {
        stubs: {
          BaseCard: { template: '<div><slot /></div>' },
          BaseButton: { template: '<button @click="$emit(\'click\')"><slot /></button>' },
          BaseInput: { template: '<input />' },
          BaseSelect: { template: '<select />' },
          BaseModal: {
            template: '<div v-if="open" data-testid="edit-modal"><slot /><slot name="footer" /></div>',
            props: ['open', 'title'],
          },
        },
      },
    });

    // Click edit button
    const editButton = wrapper.find('[data-testid="edit-account-btn"]');
    await editButton.trigger('click');

    // Click save button
    const saveButton = wrapper.find('[data-testid="save-edit-btn"]');
    await saveButton.trigger('click');

    // updateAccount should be called
    expect(mockUpdateAccount).toHaveBeenCalled();
  });
});

describe('AccountsPage - Currency Selector', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('should display a currency selector at the top of the page', () => {
    const wrapper = mount(AccountsPage, {
      global: {
        stubs: {
          BaseCard: { template: '<div><slot /></div>' },
          BaseButton: { template: '<button><slot /></button>' },
          BaseInput: { template: '<input />' },
          BaseSelect: {
            template: '<select :data-testid="$attrs[\'data-testid\']"><slot /></select>',
            props: ['modelValue', 'options', 'label'],
          },
          BaseModal: { template: '<div v-if="open"><slot /><slot name="footer" /></div>', props: ['open', 'title'] },
        },
      },
    });

    const currencySelector = wrapper.find('[data-testid="currency-selector"]');
    expect(currencySelector.exists()).toBe(true);
  });

  it('should show USD and SGD as currency options', () => {
    const wrapper = mount(AccountsPage, {
      global: {
        stubs: {
          BaseCard: { template: '<div><slot /></div>' },
          BaseButton: { template: '<button><slot /></button>' },
          BaseInput: { template: '<input />' },
          BaseSelect: {
            template: '<select :data-testid="$attrs[\'data-testid\']" :data-options="JSON.stringify(options)"><slot /></select>',
            props: ['modelValue', 'options', 'label'],
          },
          BaseModal: { template: '<div v-if="open"><slot /><slot name="footer" /></div>', props: ['open', 'title'] },
        },
      },
    });

    const currencySelector = wrapper.find('[data-testid="currency-selector"]');
    const options = JSON.parse(currencySelector.attributes('data-options') || '[]');

    expect(options.some((o: { value: string }) => o.value === 'USD')).toBe(true);
    expect(options.some((o: { value: string }) => o.value === 'SGD')).toBe(true);
  });

  it('should display currency label for amounts not in selected display currency', async () => {
    // Mock accounts with different currencies
    vi.mocked(await import('@/stores/accountsStore')).useAccountsStore.mockReturnValue({
      accounts: [
        {
          id: 'usd-account',
          memberId: 'member-1',
          name: 'USD Account',
          type: 'checking',
          currency: 'USD',
          balance: 1000,
          institution: 'Bank',
          isActive: true,
          includeInNetWorth: true,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        {
          id: 'sgd-account',
          memberId: 'member-1',
          name: 'SGD Account',
          type: 'savings',
          currency: 'SGD',
          balance: 5000,
          institution: 'SG Bank',
          isActive: true,
          includeInNetWorth: true,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
      ],
      totalAssets: 6000,
      totalLiabilities: 0,
      totalBalance: 6000,
      createAccount: vi.fn(),
      updateAccount: vi.fn(),
      deleteAccount: vi.fn(),
    } as any);

    const wrapper = mount(AccountsPage, {
      global: {
        stubs: {
          BaseCard: { template: '<div><slot /></div>' },
          BaseButton: { template: '<button><slot /></button>' },
          BaseInput: { template: '<input />' },
          BaseSelect: {
            template: '<select :data-testid="$attrs[\'data-testid\']"><slot /></select>',
            props: ['modelValue', 'options', 'label'],
          },
          BaseModal: { template: '<div v-if="open"><slot /><slot name="footer" /></div>', props: ['open', 'title'] },
        },
      },
    });

    // By default display currency is USD, so SGD account should show "SGD" label
    const html = wrapper.html();
    // SGD account balance should include currency label since it's not the display currency
    expect(html).toContain('SGD');
  });
});
