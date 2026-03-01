import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick } from 'vue';
import TransactionModal from './TransactionModal.vue';
import { useAccountsStore } from '@/stores/accountsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type {
  Transaction,
  RecurringItem,
  CreateTransactionInput,
  CreateRecurringItemInput,
} from '@/types/models';

// Mock repositories
vi.mock('@/services/indexeddb/repositories/accountRepository', () => ({
  getAllAccounts: vi.fn().mockResolvedValue([]),
  getAccountById: vi.fn(),
  createAccount: vi.fn(),
  updateAccount: vi.fn(),
  deleteAccount: vi.fn(),
  updateAccountBalance: vi.fn(),
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

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/composables/useCurrencyDisplay', () => ({
  useCurrencyDisplay: () => ({
    formatInDisplayCurrency: (amount: number) => `$${amount.toFixed(2)}`,
    convertToDisplay: (amount: number) => ({
      displayAmount: amount,
      displayCurrency: 'USD',
    }),
  }),
}));

// Mock activity store (used by ActivityLinkDropdown)
vi.mock('@/stores/activityStore', () => ({
  useActivityStore: () => ({
    activities: [],
    loadActivities: vi.fn(),
  }),
}));

describe('TransactionModal — Save Flow', () => {
  let accountsStore: ReturnType<typeof useAccountsStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    localStorage.clear();

    accountsStore = useAccountsStore();
    accountsStore.accounts.push({
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
    });

    useSettingsStore();
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function mountModal(props: Record<string, unknown> = {}): any {
    return mount(TransactionModal, {
      props: { open: true, ...props },
    });
  }

  /** Mount closed, then open — triggers useFormModal's watch so onEdit/onNew runs */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function mountAndOpen(props: Record<string, unknown> = {}): Promise<any> {
    const wrapper: any = mount(TransactionModal, {
      props: { open: false, ...props },
    });
    await wrapper.setProps({ open: true });
    await nextTick();
    return wrapper;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function fillRequiredFields(wrapper: any) {
    wrapper.vm.description = 'Test expense';
    wrapper.vm.amount = 42.5;
    wrapper.vm.category = 'food';
    wrapper.vm.accountId = 'account-1';
  }

  describe('New one-time transaction', () => {
    it('should default recurrenceMode to recurring', () => {
      const wrapper = mountModal();
      expect(wrapper.vm.recurrenceMode).toBe('recurring');
    });

    it('should emit save with CreateTransactionInput when saving one-time', async () => {
      const wrapper = mountModal();
      fillRequiredFields(wrapper);
      wrapper.vm.recurrenceMode = 'one-time';
      await nextTick();

      wrapper.vm.handleSave();
      await nextTick();

      const saveEvents = wrapper.emitted('save');
      expect(saveEvents).toBeTruthy();
      expect(saveEvents).toHaveLength(1);

      const payload = saveEvents![0][0] as CreateTransactionInput;
      expect(payload.accountId).toBe('account-1');
      expect(payload.description).toBe('Test expense');
      expect(payload.amount).toBe(42.5);
      expect(payload.type).toBe('expense');
      expect(payload.category).toBe('food');
      expect(payload.isReconciled).toBe(false);

      // Must NOT emit save-recurring
      expect(wrapper.emitted('save-recurring')).toBeFalsy();
    });

    it('should emit save with income type when direction is in', async () => {
      const wrapper = mountModal();
      fillRequiredFields(wrapper);
      wrapper.vm.direction = 'in';
      wrapper.vm.recurrenceMode = 'one-time';
      await nextTick();

      wrapper.vm.handleSave();

      const payload = wrapper.emitted('save')![0][0] as CreateTransactionInput;
      expect(payload.type).toBe('income');
    });
  });

  describe('New recurring transaction', () => {
    it('should emit save-recurring when recurrenceMode is recurring', async () => {
      const wrapper = mountModal();
      fillRequiredFields(wrapper);
      wrapper.vm.recurrenceMode = 'recurring';
      wrapper.vm.recurrenceFrequency = 'monthly';
      wrapper.vm.dayOfMonth = 15;
      await nextTick();

      wrapper.vm.handleSave();
      await nextTick();

      const recurringEvents = wrapper.emitted('save-recurring');
      expect(recurringEvents).toBeTruthy();
      expect(recurringEvents).toHaveLength(1);

      const payload = recurringEvents![0][0] as CreateRecurringItemInput;
      expect(payload.accountId).toBe('account-1');
      expect(payload.description).toBe('Test expense');
      expect(payload.amount).toBe(42.5);
      expect(payload.type).toBe('expense');
      expect(payload.frequency).toBe('monthly');
      expect(payload.dayOfMonth).toBe(15);
      expect(payload.isActive).toBe(true);

      // Must NOT emit save
      expect(wrapper.emitted('save')).toBeFalsy();
    });

    it('should include monthOfYear for yearly frequency', async () => {
      const wrapper = mountModal();
      fillRequiredFields(wrapper);
      wrapper.vm.recurrenceMode = 'recurring';
      wrapper.vm.recurrenceFrequency = 'yearly';
      wrapper.vm.monthOfYear = 6;
      wrapper.vm.dayOfMonth = 10;
      await nextTick();

      wrapper.vm.handleSave();

      const payload = wrapper.emitted('save-recurring')![0][0] as CreateRecurringItemInput;
      expect(payload.frequency).toBe('yearly');
      expect(payload.monthOfYear).toBe(6);
      expect(payload.dayOfMonth).toBe(10);
    });

    it('should omit monthOfYear for non-yearly frequency', async () => {
      const wrapper = mountModal();
      fillRequiredFields(wrapper);
      wrapper.vm.recurrenceMode = 'recurring';
      wrapper.vm.recurrenceFrequency = 'monthly';
      await nextTick();

      wrapper.vm.handleSave();

      const payload = wrapper.emitted('save-recurring')![0][0] as CreateRecurringItemInput;
      expect(payload.monthOfYear).toBeUndefined();
    });
  });

  describe('Edit existing transaction', () => {
    const existingTransaction: Transaction = {
      id: 'txn-existing',
      accountId: 'account-1',
      type: 'expense',
      amount: 100,
      currency: 'USD',
      category: 'food',
      date: '2026-03-01',
      description: 'Groceries',
      isReconciled: false,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
    };

    it('should emit save with id and UpdateTransactionInput', async () => {
      const wrapper = await mountAndOpen({ transaction: existingTransaction });

      // Modify description
      wrapper.vm.description = 'Updated groceries';
      wrapper.vm.handleSave();

      const saveEvents = wrapper.emitted('save');
      expect(saveEvents).toBeTruthy();

      const payload = saveEvents![0][0] as { id: string; data: Record<string, unknown> };
      expect(payload.id).toBe('txn-existing');
      expect(payload.data.description).toBe('Updated groceries');

      expect(wrapper.emitted('save-recurring')).toBeFalsy();
    });

    it('should populate form fields from existing transaction', async () => {
      const wrapper = await mountAndOpen({ transaction: existingTransaction });

      expect(wrapper.vm.description).toBe('Groceries');
      expect(wrapper.vm.amount).toBe(100);
      expect(wrapper.vm.direction).toBe('out');
      expect(wrapper.vm.category).toBe('food');
      expect(wrapper.vm.accountId).toBe('account-1');
    });

    it('should emit delete with transaction id', async () => {
      const wrapper = await mountAndOpen({ transaction: existingTransaction });

      wrapper.vm.handleDelete();

      const deleteEvents = wrapper.emitted('delete');
      expect(deleteEvents).toBeTruthy();
      expect(deleteEvents![0][0]).toBe('txn-existing');
    });
  });

  describe('Edit existing recurring item', () => {
    const existingRecurringItem: RecurringItem = {
      id: 'ri-existing',
      accountId: 'account-1',
      type: 'expense',
      amount: 500,
      currency: 'USD',
      category: 'housing',
      description: 'Monthly rent',
      frequency: 'monthly',
      dayOfMonth: 1,
      startDate: '2026-01-01T00:00:00.000Z',
      isActive: true,
      lastProcessedDate: '2026-02-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    it('should populate form fields from recurring item', async () => {
      const wrapper = await mountAndOpen({ recurringItem: existingRecurringItem });

      expect(wrapper.vm.description).toBe('Monthly rent');
      expect(wrapper.vm.amount).toBe(500);
      expect(wrapper.vm.direction).toBe('out');
      expect(wrapper.vm.category).toBe('housing');
      expect(wrapper.vm.recurrenceFrequency).toBe('monthly');
      expect(wrapper.vm.dayOfMonth).toBe(1);
      expect(wrapper.vm.isActive).toBe(true);
      expect(wrapper.vm.accountId).toBe('account-1');
    });

    it('should emit save-recurring with updated data when editing recurring item', async () => {
      const wrapper = await mountAndOpen({ recurringItem: existingRecurringItem });

      wrapper.vm.amount = 600;
      wrapper.vm.description = 'Updated rent';
      wrapper.vm.handleSave();

      const recurringEvents = wrapper.emitted('save-recurring');
      expect(recurringEvents).toBeTruthy();
      expect(recurringEvents).toHaveLength(1);

      const payload = recurringEvents![0][0] as CreateRecurringItemInput;
      expect(payload.amount).toBe(600);
      expect(payload.description).toBe('Updated rent');
      expect(payload.frequency).toBe('monthly');
      expect(payload.isActive).toBe(true);
      expect(payload.lastProcessedDate).toBe('2026-02-01T00:00:00.000Z');

      // Must NOT emit save (transaction save)
      expect(wrapper.emitted('save')).toBeFalsy();
    });

    it('should preserve lastProcessedDate from original item', async () => {
      const wrapper = await mountAndOpen({ recurringItem: existingRecurringItem });

      wrapper.vm.handleSave();

      const payload = wrapper.emitted('save-recurring')![0][0] as CreateRecurringItemInput;
      expect(payload.lastProcessedDate).toBe('2026-02-01T00:00:00.000Z');
    });

    it('should pass isActive toggle value through', async () => {
      const wrapper = await mountAndOpen({ recurringItem: existingRecurringItem });

      wrapper.vm.isActive = false;
      wrapper.vm.handleSave();

      const payload = wrapper.emitted('save-recurring')![0][0] as CreateRecurringItemInput;
      expect(payload.isActive).toBe(false);
    });

    it('should emit delete with recurring item id', async () => {
      const wrapper = await mountAndOpen({ recurringItem: existingRecurringItem });

      wrapper.vm.handleDelete();

      const deleteEvents = wrapper.emitted('delete');
      expect(deleteEvents).toBeTruthy();
      expect(deleteEvents![0][0]).toBe('ri-existing');
    });

    it('should set isEditingRecurring to true', async () => {
      const wrapper = await mountAndOpen({ recurringItem: existingRecurringItem });

      expect(wrapper.vm.isEditingRecurring).toBe(true);
    });

    it('should set isEditingRecurring to false when no recurring item', () => {
      const wrapper = mountModal();
      expect(wrapper.vm.isEditingRecurring).toBe(false);
    });
  });

  describe('Validation', () => {
    it('should not emit save when description is empty', () => {
      const wrapper = mountModal();
      wrapper.vm.amount = 10;
      wrapper.vm.description = '';

      wrapper.vm.handleSave();

      expect(wrapper.emitted('save')).toBeFalsy();
      expect(wrapper.emitted('save-recurring')).toBeFalsy();
    });

    it('should not emit save when amount is zero', () => {
      const wrapper = mountModal();
      wrapper.vm.description = 'Test';
      wrapper.vm.amount = 0;

      wrapper.vm.handleSave();

      expect(wrapper.emitted('save')).toBeFalsy();
      expect(wrapper.emitted('save-recurring')).toBeFalsy();
    });

    it('should not emit save when amount is undefined', () => {
      const wrapper = mountModal();
      wrapper.vm.description = 'Test';
      wrapper.vm.amount = undefined;

      wrapper.vm.handleSave();

      expect(wrapper.emitted('save')).toBeFalsy();
      expect(wrapper.emitted('save-recurring')).toBeFalsy();
    });
  });
});
