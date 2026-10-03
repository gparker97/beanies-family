/**
 * Editing an asset's loan against the REAL inline doc backend (round 3): the modal's payload
 * goes through `assetsStore.updateAsset` and the stored asset is read back. `loan` is a merge
 * field whose base is the whole live loan, so a partial loan would delete every omitted
 * sub-key; and a payment that lands while the modal is open must keep its balance.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import { installInlineBackend } from '@/services/automerge/worker/__tests__/inlineHarness';
import { mutate } from '@/services/automerge/worker/docClient';
import { getById as projectionGetById } from '@/services/automerge/projection';
import AssetModal from '@/components/assets/AssetModal.vue';
import { useAssetsStore } from '../assetsStore';
import { useAccountsStore } from '../accountsStore';
import type { Account, Asset, UpdateAssetInput } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/composables/useConfirm', () => ({ confirm: vi.fn().mockResolvedValue(true) }));
vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

const house: Asset = {
  id: 'house',
  memberId: 'm-1',
  type: 'real_estate',
  name: 'House',
  purchaseValue: 500000,
  currentValue: 600000,
  currency: 'USD',
  includeInNetWorth: true,
  loan: {
    hasLoan: true,
    loanAmount: 20000,
    outstandingBalance: 10000,
    interestRate: 4,
    lender: 'Bank',
    loanStartDate: '2024-01-01',
  },
  createdAt: 'x',
  updatedAt: 'x',
};
const mirror: Account = {
  id: 'house-loan',
  memberId: 'm-1',
  name: 'House Loan',
  type: 'loan',
  currency: 'USD',
  balance: 10000,
  institution: 'Bank',
  isActive: true,
  includeInNetWorth: true,
  linkedAssetId: 'house',
  createdAt: 'x',
  updatedAt: 'x',
};

const stored = () => projectionGetById('assets', 'house') as Asset;

describe('assetsStore.updateAsset: loan edit through the modal (inline backend)', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    await installInlineBackend();
    await mutate({
      op: 'batch',
      ops: [
        { op: 'set', collection: 'assets', id: 'house', entity: house },
        { op: 'set', collection: 'accounts', id: 'house-loan', entity: mirror },
      ],
    });
    await useAccountsStore().loadAccounts();
    await useAssetsStore().loadAssets();
  });

  it('an interest-rate edit keeps every other loan sub-key and a payment that landed meanwhile', async () => {
    const store = useAssetsStore();
    // The page opens the modal with a SNAPSHOT of the asset.
    const snapshot = JSON.parse(JSON.stringify(store.getAssetById('house'))) as Asset;
    const wrapper = mount(AssetModal, {
      props: { open: false, asset: snapshot },
      global: {
        stubs: {
          BeanieFormModal: {
            emits: ['save'],
            template: '<div><slot /><button class="save" @click="$emit(\'save\')" /></div>',
          },
        },
      },
    });
    await wrapper.setProps({ open: true });
    await nextTick();
    await nextTick();

    // A payment lands while the modal is open (another device, or the recurring processor).
    await mutate({
      op: 'patch',
      collection: 'assets',
      id: 'house',
      patch: { loan: { ...house.loan!, outstandingBalance: 9600 } },
    });
    await store.loadAssets();

    (wrapper.vm as unknown as { interestRate: number }).interestRate = 5;
    await nextTick();
    await wrapper.find('button.save').trigger('click');
    // `handleSave` awaits the custom-institution persist (the lender) before it emits.
    await vi.waitFor(async () => {
      await flushPromises();
      expect(wrapper.emitted('save')).toBeTruthy();
    });
    const evs = wrapper.emitted('save')!;
    const { id, data } = evs[evs.length - 1]![0] as { id: string; data: UpdateAssetInput };

    await store.updateAsset(id, data);

    expect(stored().loan).toEqual({
      hasLoan: true,
      loanAmount: 20000,
      outstandingBalance: 9600,
      interestRate: 5,
      lender: 'Bank',
      loanStartDate: '2024-01-01',
    });
    // The mirror follows the live balance, not the stale open-time one.
    expect((projectionGetById('accounts', 'house-loan') as Account).balance).toBe(9600);
  });

  it('a cascade payment that moved the projection but not the store survives an interest-rate edit', async () => {
    const store = useAssetsStore();
    const snapshot = JSON.parse(JSON.stringify(store.getAssetById('house'))) as Asset;
    const wrapper = mount(AssetModal, {
      props: { open: false, asset: snapshot },
      global: {
        stubs: {
          BeanieFormModal: {
            emits: ['save'],
            template: '<div><slot /><button class="save" @click="$emit(\'save\')" /></div>',
          },
        },
      },
    });
    await wrapper.setProps({ open: true });
    await nextTick();
    await nextTick();

    // The payment cascade lands in the doc (and so the projection) but the store is NOT
    // reloaded: `getAssetById` still reports the open-time 10000.
    await mutate({
      op: 'patch',
      collection: 'assets',
      id: 'house',
      patch: { loan: { ...house.loan!, outstandingBalance: 9200 } },
    });
    expect(store.getAssetById('house')!.loan!.outstandingBalance).toBe(10000);

    (wrapper.vm as unknown as { interestRate: number }).interestRate = 5;
    await nextTick();
    await wrapper.find('button.save').trigger('click');
    await vi.waitFor(async () => {
      await flushPromises();
      expect(wrapper.emitted('save')).toBeTruthy();
    });
    const evs = wrapper.emitted('save')!;
    const { id, data } = evs[evs.length - 1]![0] as { id: string; data: UpdateAssetInput };
    await store.updateAsset(id, data);

    expect(stored().loan!.outstandingBalance).toBe(9200);
    expect(stored().loan!.interestRate).toBe(5);
  });
});
