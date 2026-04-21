/**
 * Smoke tests for AccountViewModal — filter bucket rule, empty state,
 * row-click routing, and the reactive auto-close on a missing account.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import AccountViewModal from '@/components/accounts/AccountViewModal.vue';
import type { Account, Transaction } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const pushMock = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const showToastMock = vi.fn();
vi.mock('@/composables/useToast', () => ({
  showToast: (...args: unknown[]) => showToastMock(...args),
}));

vi.mock('@/composables/useMemberInfo', () => ({
  useMemberInfo: () => ({
    getMemberName: (id?: string | null) => (id ? `Member-${id}` : 'Unknown'),
    getMemberColor: () => '#AED6F1',
  }),
}));

// Store mocks
const accountsState = { accounts: [] as Account[] };
vi.mock('@/stores/accountsStore', () => ({
  useAccountsStore: () => accountsState,
}));

const familyState = { currentMember: { id: 'member-current' } as { id: string } | undefined };
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => familyState,
}));

const transactionsState = {
  transactionsForAccount: vi.fn<(id: string) => Transaction[]>(),
};
vi.mock('@/stores/transactionsStore', () => ({
  useTransactionsStore: () => transactionsState,
}));

vi.mock('@/stores/recurringStore', () => ({
  useRecurringStore: () => ({
    getRecurringItemById: (id: string) => ({ id, description: `RI-${id}` }),
  }),
}));

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

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: `tx-${Math.random().toString(36).slice(2, 8)}`,
    accountId: 'acc-1',
    type: 'expense',
    amount: 10,
    currency: 'USD',
    category: 'groceries',
    date: '2026-04-21',
    description: 'Groceries',
    isReconciled: false,
    createdAt: '2026-04-21T00:00:00.000Z',
    updatedAt: '2026-04-21T00:00:00.000Z',
    ...overrides,
  };
}

function mountModal(opts: { open: boolean; account: Account | null; transactions: Transaction[] }) {
  setActivePinia(createPinia());
  transactionsState.transactionsForAccount.mockReturnValue(opts.transactions);
  accountsState.accounts = [account(), account({ id: 'acc-2', name: 'Savings' })];
  return mount(AccountViewModal, {
    props: { open: opts.open, account: opts.account },
    global: {
      stubs: {
        BeanieFormModal: {
          template: '<div><slot /><div class="_footer"><slot name="footer-start" /></div></div>',
          props: ['open', 'title', 'saveLabel', 'variant', 'icon', 'size', 'saveGradient'],
          emits: ['save', 'close'],
        },
        CurrencyAmount: true,
      },
    },
  });
}

describe('AccountViewModal', () => {
  beforeEach(() => {
    pushMock.mockClear();
    showToastMock.mockClear();
    transactionsState.transactionsForAccount.mockReset();
    familyState.currentMember = { id: 'member-current' };
  });

  it('renders empty state when account has no transactions', () => {
    const wrapper = mountModal({ open: true, account: account(), transactions: [] });
    expect(wrapper.text()).toContain('accountView.noActivity');
  });

  it('renders all transactions in the default All filter', () => {
    const wrapper = mountModal({
      open: true,
      account: account(),
      transactions: [
        tx({ id: 't1', description: 'Groceries' }),
        tx({ id: 't2', description: 'Salary', type: 'income' }),
      ],
    });
    expect(wrapper.text()).toContain('Groceries');
    expect(wrapper.text()).toContain('Salary');
  });

  it('filters to Manual chip and shows only balance_adjustment rows', async () => {
    const wrapper = mountModal({
      open: true,
      account: account(),
      transactions: [
        tx({ id: 't1', description: 'Groceries' }),
        tx({
          id: 'adj1',
          description: 'Balance adjusted',
          type: 'balance_adjustment',
          category: '',
          isReconciled: true,
          adjustment: { delta: 50, updatedBy: 'member-current' },
        }),
      ],
    });

    // Find the Manual filter chip by its label text and click it
    const chipButtons = wrapper.findAll('button').filter((b) => b.text().includes('filter.manual'));
    expect(chipButtons.length).toBeGreaterThan(0);
    await chipButtons[0]!.trigger('click');

    expect(wrapper.text()).not.toContain('Groceries');
    expect(wrapper.text()).toContain('Balance adjusted');
  });

  it('tapping a row pushes /transactions?view=<id> and emits close', async () => {
    const wrapper = mountModal({
      open: true,
      account: account(),
      transactions: [tx({ id: 'tx-42', description: 'Lunch' })],
    });

    // First button that contains transaction description is the row
    const rowButton = wrapper.findAll('button').find((b) => b.text().includes('Lunch'));
    expect(rowButton).toBeTruthy();
    await rowButton!.trigger('click');

    expect(pushMock).toHaveBeenCalledWith({
      path: '/transactions',
      query: { view: 'tx-42' },
    });
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('toasts + closes when account prop becomes null while open', async () => {
    const wrapper = mountModal({ open: true, account: account(), transactions: [] });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await wrapper.setProps({ account: null });

    expect(showToastMock).toHaveBeenCalledWith('error', 'accountView.notFound');
    expect(wrapper.emitted('close')).toBeTruthy();
    warnSpy.mockRestore();
  });

  it('View all link appears when transactions exceed the visible cap', () => {
    // Cap is 20 — produce 25 transactions.
    const many = Array.from({ length: 25 }, (_, i) =>
      tx({
        id: `t${i}`,
        description: `Item ${i}`,
        date: `2026-04-${String((i % 28) + 1).padStart(2, '0')}`,
      })
    );
    const wrapper = mountModal({ open: true, account: account(), transactions: many });
    expect(wrapper.text()).toContain('accountView.viewAll');
  });
});
