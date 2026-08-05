import { mount } from '@vue/test-utils';
import { reactive } from 'vue';
import { describe, it, expect, vi } from 'vitest';
import CryptoWalletList from '../CryptoWalletList.vue';
import type { CryptoWallet } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let seq = 0;
vi.mock('@/utils/id', () => ({ generateUUID: () => `uuid-${++seq}` }));

function mountList(wallets: CryptoWallet[]) {
  const state = reactive({ wallets });
  const wrapper = mount(CryptoWalletList, { props: { modelValue: state.wallets } });
  return { wrapper, wallets: state.wallets };
}

describe('CryptoWalletList', () => {
  it('renders one card per wallet', () => {
    const { wrapper } = mountList([
      { id: '1', label: 'Ledger', address: '0xabc', chain: 'bitcoin' },
      { id: '2', label: 'MetaMask', address: '0xdef', chain: 'ethereum' },
    ]);
    // Two remove buttons = two rows.
    expect(wrapper.findAll('button[title="accountDetails.wallets.remove"]')).toHaveLength(2);
  });

  it('adds a row (with a generated id) by mutating the passed array in place', async () => {
    const { wrapper, wallets } = mountList([]);
    await wrapper.find('button:last-of-type').trigger('click'); // "Add wallet"
    expect(wallets).toHaveLength(1);
    expect(wallets[0]!.id).toMatch(/^uuid-/);
    expect(wallets[0]).toMatchObject({ label: '', address: '' });
  });

  it('removes a row in place', async () => {
    const { wrapper, wallets } = mountList([{ id: '1', label: 'L', address: '0xabc' }]);
    await wrapper.find('button[title="accountDetails.wallets.remove"]').trigger('click');
    expect(wallets).toHaveLength(0);
  });

  it('shows a per-row error when exactly one of label/address is filled', () => {
    const { wrapper } = mountList([{ id: '1', label: 'only label', address: '' }]);
    expect(wrapper.text()).toContain('accountDetails.err.walletIncomplete');
  });
});
