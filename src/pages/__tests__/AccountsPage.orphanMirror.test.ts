/**
 * A loan account mirroring an asset is owned by the Assets page (edit, view and delete
 * redirect there) ONLY while that asset exists. An orphan mirror, whose asset is gone, must be
 * deletable here like any account (round 3): the redirect used to make it undeletable.
 */
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import AccountsPage from '@/pages/AccountsPage.vue';
import { useAssetsStore } from '@/stores/assetsStore';
import type { Asset } from '@/types/models';

const routerPush = vi.hoisted(() => vi.fn());
const deleteAccountMock = vi.hoisted(() => vi.fn());
const confirmMock = vi.hoisted(() => vi.fn());

const mirror = {
  id: 'house-loan',
  memberId: 'member-1',
  name: 'House Loan',
  type: 'loan',
  currency: 'USD',
  balance: 9000,
  isActive: true,
  includeInNetWorth: true,
  linkedAssetId: 'house',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

vi.mock('@/stores/accountsStore', () => ({
  useAccountsStore: vi.fn(() => ({
    accounts: [mirror],
    filteredAccounts: [mirror],
    filteredTotalAssets: 0,
    filteredTotalLiabilities: 9000,
    filteredTotalBalance: -9000,
    totalAssets: 0,
    totalLiabilities: 9000,
    totalBalance: -9000,
    getAccountById: (id: string) => (id === mirror.id ? mirror : undefined),
    createAccount: vi.fn(),
    updateAccount: vi.fn(),
    deleteAccount: deleteAccountMock,
  })),
}));

vi.mock('@/stores/familyStore', () => {
  const members = [{ id: 'member-1', name: 'John', role: 'owner', color: '#3b82f6' }];
  return {
    useFamilyStore: vi.fn(() => ({
      currentMemberId: 'member-1',
      members,
      humans: members,
      sortedMembers: members,
      sortedHumans: members,
      hasPets: false,
    })),
  };
});

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

vi.mock('@/composables/useConfirm', () => ({ confirm: confirmMock }));
vi.mock('@/composables/useToast', () => ({ showToast: vi.fn() }));

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: routerPush }),
}));

const stubs = {
  BaseCard: { template: '<div><slot /></div>' },
  BaseButton: { template: '<button><slot /></button>' },
  AccountModal: { template: '<div />', props: ['open', 'account'] },
  AccountViewModal: { template: '<div />', props: ['open', 'account'] },
  CurrencyAmount: { template: '<span />' },
  SummaryStatCard: { template: '<div />' },
  EmptyStateIllustration: { template: '<div />' },
  BeanieIcon: { template: '<span />' },
};

type PageVm = { deleteAccount: (id: string) => Promise<void> };

describe('AccountsPage: deleting a linked loan account', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    confirmMock.mockResolvedValue(true);
  });

  it('an ORPHAN mirror (asset gone) deletes here, after the usual confirm', async () => {
    const wrapper = mount(AccountsPage, { global: { stubs } });
    await (wrapper.vm as unknown as PageVm).deleteAccount('house-loan');
    expect(routerPush).not.toHaveBeenCalled();
    expect(confirmMock).toHaveBeenCalled();
    expect(deleteAccountMock).toHaveBeenCalledWith('house-loan');
  });

  it('a mirror whose asset exists still redirects to Assets and deletes nothing', async () => {
    useAssetsStore().assets = [{ id: 'house', name: 'House' } as Asset];
    const wrapper = mount(AccountsPage, { global: { stubs } });
    await (wrapper.vm as unknown as PageVm).deleteAccount('house-loan');
    expect(routerPush).toHaveBeenCalledWith('/assets');
    expect(deleteAccountMock).not.toHaveBeenCalled();
  });
});
