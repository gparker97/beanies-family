import { describe, it, expect } from 'vitest';
import {
  showsAccountNumber,
  bankFieldsApply,
  cardFieldsApply,
  cryptoFieldsApply,
  showsForWhomField,
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
  it('showsAccountNumber hides for cash + crypto + credit_card + empty', () => {
    expect(showsAccountNumber('checking')).toBe(true);
    expect(showsAccountNumber('loan')).toBe(true);
    expect(showsAccountNumber('education_529')).toBe(true);
    expect(showsAccountNumber('cash')).toBe(false);
    expect(showsAccountNumber('crypto')).toBe(false);
    expect(showsAccountNumber('credit_card')).toBe(false);
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
  it('showsForWhomField covers savings/investment/education/retirement, not checking/credit', () => {
    expect(showsForWhomField('savings')).toBe(true);
    expect(showsForWhomField('investment')).toBe(true);
    expect(showsForWhomField('education_529')).toBe(true);
    expect(showsForWhomField('retirement_kids_ira')).toBe(true);
    expect(showsForWhomField('checking')).toBe(false);
    expect(showsForWhomField('credit_card')).toBe(false);
    expect(showsForWhomField('')).toBe(false);
  });
});

describe('extractAccountDetails', () => {
  it('reads the savings rate from its own field, never the loan interestRate', () => {
    expect(
      extractAccountDetails(makeAccount({ type: 'savings', savingsInterestRate: 3.5 }))
        .savingsInterestRate
    ).toBe(3.5);
    // A loan's interestRate must NOT leak into the savings form-state field.
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

describe('buildAccountDetailsPatch — type gating + purge', () => {
  it('never writes the loan interestRate for a loan (loan block is its sole writer)', () => {
    const patch = buildAccountDetailsPatch(details(), 'loan');
    expect('interestRate' in patch).toBe(false);
  });
  it('PURGES the loan interestRate on every non-loan type (undefined = deleted)', () => {
    expect(buildAccountDetailsPatch(details(), 'checking').interestRate).toBeUndefined();
    expect('interestRate' in buildAccountDetailsPatch(details(), 'checking')).toBe(true);
    expect(buildAccountDetailsPatch(details(), 'savings').interestRate).toBeUndefined();
  });
  it('PURGES off-type card fields (present as undefined so the repo deletes them)', () => {
    const patch = buildAccountDetailsPatch(details({ cardLast4: '1234' }), 'checking');
    expect(patch.cardLast4).toBeUndefined();
    expect(patch.cardNetwork).toBeUndefined();
    expect('cardLast4' in patch).toBe(true); // emitted (undefined), not omitted
  });
  it('PURGES off-type wallets on a bank account', () => {
    const patch = buildAccountDetailsPatch(
      details({ wallets: [{ id: '1', label: 'L', address: '0xabc' }] }),
      'checking'
    );
    expect(patch.wallets).toBeUndefined();
  });
  it('clears account number for cash + crypto (undefined); keeps it for checking', () => {
    expect(
      buildAccountDetailsPatch(details({ accountNumber: '123' }), 'cash').accountNumber
    ).toBeUndefined();
    expect(
      buildAccountDetailsPatch(details({ accountNumber: '123' }), 'crypto').accountNumber
    ).toBeUndefined();
    expect(
      buildAccountDetailsPatch(details({ accountNumber: '123' }), 'checking').accountNumber
    ).toBe('123');
  });
  it('savings rate persists to its OWN field; 0 → undefined; negatives allowed', () => {
    expect(
      buildAccountDetailsPatch(details({ savingsInterestRate: 2.5 }), 'savings').savingsInterestRate
    ).toBe(2.5);
    expect(
      buildAccountDetailsPatch(details({ savingsInterestRate: 0 }), 'savings').savingsInterestRate
    ).toBeUndefined();
    // Negative deposit rates are real and must persist (not dropped by the >0 guard).
    expect(
      buildAccountDetailsPatch(details({ savingsInterestRate: -0.5 }), 'savings')
        .savingsInterestRate
    ).toBe(-0.5);
    // Never touches the loan interestRate.
    expect(
      'interestRate' in buildAccountDetailsPatch(details({ savingsInterestRate: 2.5 }), 'savings')
    ).toBe(true);
    expect(
      buildAccountDetailsPatch(details({ savingsInterestRate: 2.5 }), 'savings').interestRate
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
  it('renders network-only, last4-only, or both; null only when neither is present', () => {
    expect(formatCardChip('visa', '1234')).toBe('Visa ••1234');
    expect(formatCardChip('', '1234')).toBe('••1234');
    expect(formatCardChip('visa', '')).toBe('Visa'); // network only → still a chip (no empty section)
    expect(formatCardChip('visa', '12')).toBe('Visa'); // invalid last-4 dropped, network kept
    expect(formatCardChip('', '')).toBeNull();
    expect(formatCardChip(undefined, undefined)).toBeNull();
  });
});

describe('hasAccountDetails + telemetry', () => {
  it('hasAccountDetails ignores the loan interestRate but catches detail fields incl. savings rate', () => {
    expect(hasAccountDetails(makeAccount())).toBe(false);
    expect(hasAccountDetails(makeAccount({ interestRate: 5 }))).toBe(false); // loan rate is not a detail field
    expect(hasAccountDetails(makeAccount({ savingsInterestRate: 3.5 }))).toBe(true);
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
