import { describe, it, expect } from 'vitest';
import {
  showsAccountNumber,
  bankFieldsApply,
  cardFieldsApply,
  cryptoFieldsApply,
  emptyAccountDetails,
  extractAccountDetails,
  sanitizeWallets,
  buildAccountDetailsPatch,
  validateAccountDetails,
  walletRowError,
  isValidLast4,
  isValidExpiry,
  isValidDayOfMonth,
  formatCardChip,
  hasAccountDetails,
  accountDetailTelemetry,
} from '@/utils/accountDetails';
import type { Account, AccountDetails, AccountType, CryptoWallet } from '@/types/models';

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

function details(overrides: Partial<AccountDetails> = {}): AccountDetails {
  return { ...emptyAccountDetails(), ...overrides };
}

describe('type predicates', () => {
  it('showsAccountNumber hides for cash + crypto + empty', () => {
    expect(showsAccountNumber('checking')).toBe(true);
    expect(showsAccountNumber('loan')).toBe(true);
    expect(showsAccountNumber('cash')).toBe(false);
    expect(showsAccountNumber('crypto')).toBe(false);
    expect(showsAccountNumber('')).toBe(false);
  });
  it('group predicates', () => {
    expect(bankFieldsApply('savings')).toBe(true);
    expect(bankFieldsApply('checking')).toBe(true);
    expect(bankFieldsApply('credit_card')).toBe(false);
    expect(cardFieldsApply('credit_card')).toBe(true);
    expect(cardFieldsApply('checking')).toBe(false);
    expect(cryptoFieldsApply('crypto')).toBe(true);
    expect(cryptoFieldsApply('cash')).toBe(false);
  });
});

describe('extractAccountDetails', () => {
  it('maps savings interestRate → savingsInterestRate only for savings', () => {
    expect(
      extractAccountDetails(makeAccount({ type: 'savings', interestRate: 3.5 })).savingsInterestRate
    ).toBe(3.5);
    expect(
      extractAccountDetails(makeAccount({ type: 'loan', interestRate: 3.5 })).savingsInterestRate
    ).toBeUndefined();
  });
  it('deep-clones wallets (no shared references with the account)', () => {
    const wallets: CryptoWallet[] = [{ id: 'w1', label: 'A', address: '0xabc', chain: 'ethereum' }];
    const account = makeAccount({ type: 'crypto', wallets });
    const d = extractAccountDetails(account);
    expect(d.wallets).toEqual(wallets);
    expect(d.wallets).not.toBe(wallets);
    expect(d.wallets[0]).not.toBe(wallets[0]);
    // Mutating the form copy must not touch the account.
    d.wallets[0]!.label = 'CHANGED';
    expect(account.wallets![0]!.label).toBe('A');
  });
});

describe('sanitizeWallets', () => {
  it('trims and drops rows missing label OR address; returns a new array without mutating input', () => {
    const input: CryptoWallet[] = [
      { id: '1', label: '  Ledger  ', address: '  0xabc  ', chain: 'bitcoin' },
      { id: '2', label: 'no address', address: '   ' },
      { id: '3', label: '', address: '0xdef' },
    ];
    const out = sanitizeWallets(input);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: '1', label: 'Ledger', address: '0xabc', chain: 'bitcoin' });
    expect(out).not.toBe(input);
    expect(input[0]!.label).toBe('  Ledger  '); // input untouched
  });
});

describe('buildAccountDetailsPatch — type gating (Pass-4 correctness)', () => {
  it('OMITS interestRate for a loan (never wipes the rate)', () => {
    const patch = buildAccountDetailsPatch(details(), 'loan');
    expect('interestRate' in patch).toBe(false);
  });
  it('OMITS card fields for a bank account', () => {
    const patch = buildAccountDetailsPatch(details({ cardLast4: '1234' }), 'checking');
    expect('cardLast4' in patch).toBe(false);
    expect('cardNetwork' in patch).toBe(false);
  });
  it('OMITS account number for cash + crypto', () => {
    expect(
      'accountNumber' in buildAccountDetailsPatch(details({ accountNumber: '123' }), 'cash')
    ).toBe(false);
    expect(
      'accountNumber' in buildAccountDetailsPatch(details({ accountNumber: '123' }), 'crypto')
    ).toBe(false);
    expect(
      buildAccountDetailsPatch(details({ accountNumber: '123' }), 'checking').accountNumber
    ).toBe('123');
  });
  it('maps savingsInterestRate → interestRate for savings; 0/empty → undefined', () => {
    expect(
      buildAccountDetailsPatch(details({ savingsInterestRate: 2.5 }), 'savings').interestRate
    ).toBe(2.5);
    expect(
      buildAccountDetailsPatch(details({ savingsInterestRate: 0 }), 'savings').interestRate
    ).toBeUndefined();
  });
  it('in-type cleared string → undefined (so the repo deletes it)', () => {
    const patch = buildAccountDetailsPatch(details({ onlineBankingUrl: '' }), 'checking');
    expect('onlineBankingUrl' in patch).toBe(true);
    expect(patch.onlineBankingUrl).toBeUndefined();
  });
  it('numeric 0 treated as unset for day/limit', () => {
    const patch = buildAccountDetailsPatch(
      details({ statementDay: 0, creditLimit: 0 }),
      'credit_card'
    );
    expect(patch.statementDay).toBeUndefined();
    expect(patch.creditLimit).toBeUndefined();
  });
  it('wallets sanitized; empty → undefined', () => {
    const good = buildAccountDetailsPatch(
      details({ wallets: [{ id: '1', label: 'L', address: '0xabc' }] }),
      'crypto'
    );
    expect(good.wallets).toHaveLength(1);
    const empty = buildAccountDetailsPatch(details({ wallets: [] }), 'crypto');
    expect(empty.wallets).toBeUndefined();
  });
});

describe('validation', () => {
  it('validators', () => {
    expect(isValidLast4('1234')).toBe(true);
    expect(isValidLast4('12a4')).toBe(false);
    expect(isValidLast4('123')).toBe(false);
    expect(isValidExpiry('08/27')).toBe(true);
    expect(isValidExpiry('13/27')).toBe(false);
    expect(isValidExpiry('8/27')).toBe(false);
    expect(isValidDayOfMonth(1)).toBe(true);
    expect(isValidDayOfMonth(31)).toBe(true);
    expect(isValidDayOfMonth(0)).toBe(false);
    expect(isValidDayOfMonth(32)).toBe(false);
  });
  it('walletRowError flags exactly-one-filled rows', () => {
    expect(walletRowError({ id: '1', label: 'x', address: '' })).toBe(
      'accountDetails.err.walletIncomplete'
    );
    expect(walletRowError({ id: '1', label: '', address: 'y' })).toBe(
      'accountDetails.err.walletIncomplete'
    );
    expect(walletRowError({ id: '1', label: 'x', address: 'y' })).toBe('');
    expect(walletRowError({ id: '1', label: '', address: '' })).toBe('');
  });
  it('validateAccountDetails is type-gated and 0-as-unset', () => {
    expect(validateAccountDetails(details({ cardLast4: '12' }), 'credit_card').cardLast4).toBe(
      'accountDetails.err.last4'
    );
    // Same bad value on a non-card type → no error (gated out).
    expect(
      validateAccountDetails(details({ cardLast4: '12' }), 'checking').cardLast4
    ).toBeUndefined();
    expect(
      validateAccountDetails(details({ statementDay: 0 }), 'credit_card').statementDay
    ).toBeUndefined();
    expect(validateAccountDetails(details({ statementDay: 45 }), 'credit_card').statementDay).toBe(
      'accountDetails.err.day'
    );
    expect(
      validateAccountDetails(details({ wallets: [{ id: '1', label: 'x', address: '' }] }), 'crypto')
        .wallets
    ).toBe('accountDetails.err.walletIncomplete');
  });
});

describe('formatCardChip', () => {
  it('formats with/without network; null when last-4 absent/invalid', () => {
    expect(formatCardChip('visa', '1234')).toBe('Visa ••1234');
    expect(formatCardChip('', '1234')).toBe('••1234');
    expect(formatCardChip('visa', '')).toBeNull();
    expect(formatCardChip('visa', '12')).toBeNull();
  });
});

describe('hasAccountDetails + telemetry', () => {
  it('hasAccountDetails ignores interestRate (shared with loans) but catches detail fields', () => {
    expect(hasAccountDetails(makeAccount())).toBe(false);
    expect(hasAccountDetails(makeAccount({ interestRate: 5 }))).toBe(false);
    expect(hasAccountDetails(makeAccount({ accountNumber: '123' }))).toBe(true);
    expect(hasAccountDetails(makeAccount({ wallets: [] }))).toBe(false);
    expect(
      hasAccountDetails(makeAccount({ wallets: [{ id: '1', label: 'a', address: 'b' }] }))
    ).toBe(true);
  });
  it('accountDetailTelemetry is counts/booleans only — never raw values', () => {
    const account = makeAccount({
      type: 'credit_card',
      accountNumber: '999',
      onlineBankingUrl: 'https://x.com',
      cardLast4: '1234',
      wallets: [{ id: '1', label: 'a', address: 'b' }],
    });
    const ctx = accountDetailTelemetry(account);
    expect(ctx).toEqual({
      account_type: 'credit_card',
      has_account_number: true,
      has_online_banking: true,
      has_card_details: true,
      wallet_count: 1,
      detail_field_count: expect.any(Number),
    });
    // No raw value leaked into telemetry.
    expect(JSON.stringify(ctx)).not.toContain('999');
    expect(JSON.stringify(ctx)).not.toContain('1234');
  });
});

// Guard the public type surface stays stable for the future secrets migration.
const _typeGuard: AccountType = 'crypto';
void _typeGuard;
