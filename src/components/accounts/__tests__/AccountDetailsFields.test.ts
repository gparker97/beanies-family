import { mount } from '@vue/test-utils';
import { reactive } from 'vue';
import { describe, it, expect, vi } from 'vitest';
import AccountDetailsFields from '../AccountDetailsFields.vue';
import { emptyAccountDetails } from '@/utils/accountDetails';
import type { AccountDetails, AccountType } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function mountFields(type: AccountType | '', overrides: Partial<AccountDetails> = {}) {
  const details = reactive<AccountDetails>({ ...emptyAccountDetails(), ...overrides });
  return mount(AccountDetailsFields, { props: { details, type, currency: 'USD' } });
}

describe('AccountDetailsFields type gating', () => {
  it('hides the account-number field for crypto and cash, shows it for checking', () => {
    expect(mountFields('checking').text()).toContain('accountDetails.field.accountNumber');
    expect(mountFields('crypto').text()).not.toContain('accountDetails.field.accountNumber');
    expect(mountFields('cash').text()).not.toContain('accountDetails.field.accountNumber');
  });

  it('shows the bank block only for checking/savings and the savings rate only for savings', () => {
    expect(mountFields('checking').text()).toContain('accountDetails.bank.title');
    expect(mountFields('checking').text()).not.toContain('accountDetails.field.interestRate');
    expect(mountFields('savings').text()).toContain('accountDetails.field.interestRate');
    expect(mountFields('credit_card').text()).not.toContain('accountDetails.bank.title');
  });

  it('shows the card block + CVV note only for credit_card', () => {
    const cc = mountFields('credit_card').text();
    expect(cc).toContain('accountDetails.card.title');
    expect(cc).toContain('accountDetails.card.cvvNote');
    expect(mountFields('checking').text()).not.toContain('accountDetails.card.title');
  });

  it('shows the crypto wallet block only for crypto', () => {
    expect(mountFields('crypto').text()).toContain('accountDetails.crypto.publicOnly');
    expect(mountFields('checking').text()).not.toContain('accountDetails.crypto.publicOnly');
  });

  it('renders a validation message for a bad last-4 on a credit card', () => {
    expect(mountFields('credit_card', { cardLast4: '12' }).text()).toContain(
      'accountDetails.err.last4'
    );
  });
});
