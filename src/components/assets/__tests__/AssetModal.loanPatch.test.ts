/**
 * AssetModal sends the WHOLE loan built from the LIVE asset (the projection row the repository
 * reconciles against; the store only when the projection has none) with only
 * the sub-keys changed since open overlaid: `loan` is a merge field whose base is the whole
 * live loan, so a partial loan would clear every omitted sub-key, and the stale open-time
 * balance must never revert a payment that landed while the modal was open.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import AssetModal from '@/components/assets/AssetModal.vue';
import { useAssetsStore } from '@/stores/assetsStore';
import { applyDelta, resetProjection } from '@/services/automerge/projection';
import type { Asset } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/composables/useConfirm', () => ({ confirm: vi.fn().mockResolvedValue(true) }));

const base = {
  id: 'a1',
  memberId: 'm1',
  type: 'real_estate',
  name: 'House',
  purchaseValue: 500000,
  currentValue: 600000,
  currency: 'USD',
  includeInNetWorth: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
} as unknown as Asset;

const withLoan = {
  ...base,
  loan: { hasLoan: true, loanAmount: 20000, outstandingBalance: 10000, interestRate: 4 },
} as Asset;

async function open(asset: Asset | null) {
  setActivePinia(createPinia());
  const wrapper = mount(AssetModal, {
    props: { open: false, asset },
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
  return wrapper;
}

async function save(wrapper: Awaited<ReturnType<typeof open>>) {
  await wrapper.find('button.save').trigger('click');
  await nextTick();
  const evs = wrapper.emitted('save');
  return (evs![evs!.length - 1]![0] as { data: Record<string, unknown> }).data;
}

describe('AssetModal loan payload', () => {
  afterEach(() => resetProjection());

  it('builds on the PROJECTION row over a stale store: a cascade payment is kept', async () => {
    const wrapper = await open(withLoan);
    // The cascade moved the projection (the repository's base); the store has not reloaded.
    useAssetsStore().assets = [withLoan];
    applyDelta({
      kind: 'upsert',
      collection: 'assets',
      id: 'a1',
      entity: { ...withLoan, loan: { ...withLoan.loan!, outstandingBalance: 6000 } },
    });
    (wrapper.vm as unknown as { interestRate: number }).interestRate = 5;
    await nextTick();
    expect((await save(wrapper)).loan).toEqual({
      hasLoan: true,
      loanAmount: 20000,
      outstandingBalance: 6000,
      interestRate: 5,
    });
  });

  it('editing only interestRate sends the whole loan, never a partial one', async () => {
    const wrapper = await open(withLoan);
    (wrapper.vm as unknown as { interestRate: number }).interestRate = 5;
    await nextTick();
    expect(await save(wrapper)).toEqual({
      loan: { hasLoan: true, loanAmount: 20000, outstandingBalance: 10000, interestRate: 5 },
    });
  });

  it('builds on the LIVE asset in the store: a payment that landed while open is kept', async () => {
    const wrapper = await open(withLoan);
    // The page handed in an open-time snapshot; the store now holds the paid-down loan plus a
    // sub-key the form does not even show.
    useAssetsStore().assets = [
      {
        ...withLoan,
        loan: { ...withLoan.loan!, outstandingBalance: 7000, linkedRecurringItemId: 'rec-1' },
      },
    ];
    (wrapper.vm as unknown as { interestRate: number }).interestRate = 5;
    await nextTick();
    expect((await save(wrapper)).loan).toEqual({
      hasLoan: true,
      loanAmount: 20000,
      outstandingBalance: 7000,
      interestRate: 5,
      linkedRecurringItemId: 'rec-1',
    });
  });

  it('an untouched loan sends no loan key at all', async () => {
    const wrapper = await open(withLoan);
    expect((await save(wrapper)).loan).toBeUndefined();
  });

  it('creating a loan sends the whole object', async () => {
    const wrapper = await open(base);
    const vm = wrapper.vm as unknown as Record<string, unknown>;
    vm.hasLoan = true;
    vm.outstandingBalance = 900;
    vm.interestRate = 3;
    await nextTick();
    expect((await save(wrapper)).loan).toEqual({
      hasLoan: true,
      outstandingBalance: 900,
      interestRate: 3,
    });
  });

  it('removing the loan sends { hasLoan: false }', async () => {
    const wrapper = await open(withLoan);
    (wrapper.vm as unknown as { hasLoan: boolean }).hasLoan = false;
    await nextTick();
    expect((await save(wrapper)).loan).toEqual({ hasLoan: false });
  });

  it('clearing a sub-key sends the whole loan with the LIVE balance, not the stale one', async () => {
    const wrapper = await open(withLoan);
    // A payment lands while the modal is open: the live asset now owes 7000.
    await wrapper.setProps({
      asset: { ...withLoan, loan: { ...withLoan.loan!, outstandingBalance: 7000 } },
    });
    (wrapper.vm as unknown as { interestRate: undefined }).interestRate = undefined;
    await nextTick();
    const loan = (await save(wrapper)).loan as Record<string, unknown>;
    expect(loan.outstandingBalance).toBe(7000);
    expect(loan.interestRate).toBeUndefined();
  });
});
