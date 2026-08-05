import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import AccountDetailsView from '../AccountDetailsView.vue';
import type { Account } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'a1',
    memberId: 'm1',
    name: 'Test',
    type: 'checking',
    currency: 'USD',
    balance: 0,
    isActive: true,
    includeInNetWorth: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('AccountDetailsView', () => {
  it('renders the online-banking URL as a hostname link', () => {
    const w = mount(AccountDetailsView, {
      props: { account: makeAccount({ onlineBankingUrl: 'https://secure.chase.com/login' }) },
    });
    const link = w.get('a');
    expect(link.text()).toContain('secure.chase.com');
    expect(link.attributes('href')).toBe('https://secure.chase.com/login');
    expect(link.attributes('rel')).toContain('noopener');
  });

  it('renders a card chip and ordinal statement/due for a credit card', () => {
    const w = mount(AccountDetailsView, {
      props: {
        account: makeAccount({
          type: 'credit_card',
          cardNetwork: 'visa',
          cardLast4: '1234',
          statementDay: 14,
          paymentDueDay: 2,
        }),
      },
    });
    expect(w.text()).toContain('Visa ••1234');
    expect(w.text()).toContain('14th / 2nd');
  });

  it('renders wallet rows with a copy button for crypto', () => {
    const w = mount(AccountDetailsView, {
      props: {
        account: makeAccount({
          type: 'crypto',
          wallets: [{ id: '1', label: 'Ledger', address: '0xabc', chain: 'bitcoin' }],
        }),
      },
    });
    expect(w.text()).toContain('Ledger');
    expect(w.text()).toContain('0xabc');
    expect(w.text()).toContain('Bitcoin');
    expect(w.find('button[title="accountDetails.copyAddress"]').exists()).toBe(true);
  });

  it('does not render card rows for a non-card account', () => {
    const w = mount(AccountDetailsView, {
      props: { account: makeAccount({ accountNumber: '123' }) },
    });
    expect(w.text()).not.toContain('accountDetails.view.card');
    expect(w.text()).toContain('123');
  });
});
