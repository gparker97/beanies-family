// Pure helpers for the optional account-details tier.
//
// Single source of truth for: which detail fields apply to which account type,
// the form-state <-> Account bridge (extract / build-patch), validation, and
// the display/telemetry formatters. Kept pure so every consumer (the edit
// component, the save-payload builder, and the read-only view) agrees, and so
// the logic is unit-testable without mounting a component.
//
// Validation returns i18n KEYS (resolved via `t()` at the render site) so this
// module stays free of the translation store.

import type { Account, AccountDetails, AccountType, CryptoWallet } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { ACCOUNT_DETAIL_KEYS, CARD_NETWORK_LABELS } from '@/constants/accountDetails';

// ── Type-applicability predicates (the single source of truth) ──────────────

/**
 * Account number applies to institution-backed accounts. Hidden for cash and
 * crypto (crypto uses wallets), and for credit cards (which keep only the
 * last-4, never a full number).
 */
export function showsAccountNumber(type: AccountType | ''): boolean {
  return type !== '' && type !== 'cash' && type !== 'crypto' && type !== 'credit_card';
}

export function bankFieldsApply(type: AccountType | ''): boolean {
  return type === 'checking' || type === 'savings';
}

export function cardFieldsApply(type: AccountType | ''): boolean {
  return type === 'credit_card';
}

export function cryptoFieldsApply(type: AccountType | ''): boolean {
  return type === 'crypto';
}

// Account types where earmarking the account "for" one or more family members is
// common (college funds, ISAs, kids' savings, retirement pots). Not limited to
// kids — a spouse's education/retirement account qualifies too.
const FOR_WHOM_TYPES = new Set<AccountType>([
  'savings',
  'investment',
  'education_529',
  'education_savings',
  'retirement',
  'retirement_401k',
  'retirement_ira',
  'retirement_roth_ira',
  'retirement_bene_ira',
  'retirement_kids_ira',
]);

/** Whether the optional "For" (who the account is for) selector applies. */
export function showsForWhomField(type: AccountType | ''): boolean {
  return type !== '' && FOR_WHOM_TYPES.has(type);
}

// ── Form-state factory + hydration ──────────────────────────────────────────

export function emptyAccountDetails(): AccountDetails {
  return {
    accountNumber: '',
    onlineBankingUrl: '',
    onlineBankingUserId: '',
    notes: '',
    routingNumber: '',
    iban: '',
    swiftBic: '',
    savingsInterestRate: undefined,
    cardNetwork: '',
    cardLast4: '',
    cardExpiry: '',
    creditLimit: undefined,
    statementDay: undefined,
    paymentDueDay: undefined,
    wallets: [],
  };
}

/**
 * Hydrate the form-state object from a persisted account. Deep-clones `wallets`
 * (array + row objects) so editing the form never mutates the live store entity;
 * all other fields are primitives copied by value.
 */
export function extractAccountDetails(account: Account): AccountDetails {
  return {
    accountNumber: account.accountNumber ?? '',
    onlineBankingUrl: account.onlineBankingUrl ?? '',
    onlineBankingUserId: account.onlineBankingUserId ?? '',
    notes: account.notes ?? '',
    routingNumber: account.routingNumber ?? '',
    iban: account.iban ?? '',
    swiftBic: account.swiftBic ?? '',
    savingsInterestRate: account.savingsInterestRate,
    cardNetwork: account.cardNetwork ?? '',
    cardLast4: account.cardLast4 ?? '',
    cardExpiry: account.cardExpiry ?? '',
    creditLimit: account.creditLimit,
    statementDay: account.statementDay,
    paymentDueDay: account.paymentDueDay,
    wallets: (account.wallets ?? []).map((w) => ({ ...w })),
  };
}

/** Trim rows, drop those missing label OR address. Returns a NEW array. */
export function sanitizeWallets(wallets: CryptoWallet[]): CryptoWallet[] {
  return wallets
    .map((w) => ({
      ...w,
      label: w.label.trim(),
      address: w.address.trim(),
      chain: w.chain || undefined,
    }))
    .filter((w) => w.label !== '' && w.address !== '');
}

// ── Save-payload builder ────────────────────────────────────────────────────

/**
 * Assemble the persisted patch. EVERY detail key is always written: to its value
 * when the field applies to this account type and is non-empty, or to `undefined`
 * otherwise. Because the generic repo `update` deletes any key set to `undefined`,
 * this means an in-type cleared field AND an off-type field are both removed — so
 * changing an account's type purges the previous type's detail data instead of
 * orphaning it in the encrypted file.
 *
 * This is SAFE (unlike an earlier version) because no detail key overlaps a
 * loan-owned field: savings uses its own `savingsInterestRate`, never the loan
 * `interestRate`. The only time this touches `interestRate` is to PURGE it from a
 * non-loan account (legacy cleanup, see below); it is never written for a loan,
 * so the AccountModal loan block remains a loan's sole rate writer.
 */
export function buildAccountDetailsPatch(
  details: AccountDetails,
  type: AccountType | ''
): Partial<Account> {
  const patch: Partial<Account> = {};
  const str = (s: string): string | undefined => s.trim() || undefined;
  // Positive-only numbers (day-of-month, credit limit): 0/blank/negative → unset.
  const num = (n: number | undefined): number | undefined =>
    typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;
  // Interest rate may legitimately be negative (negative deposit rates); 0/blank
  // is the "not entered" sentinel from the numeric input.
  const rate = (n: number | undefined): number | undefined =>
    typeof n === 'number' && Number.isFinite(n) && n !== 0 ? n : undefined;

  // Common (shown for all types except where a predicate hides the field).
  patch.onlineBankingUrl = str(details.onlineBankingUrl);
  patch.onlineBankingUserId = str(details.onlineBankingUserId);
  patch.notes = str(details.notes);
  patch.accountNumber = showsAccountNumber(type) ? str(details.accountNumber) : undefined;

  // Bank (checking / savings). Off-type → undefined (purged).
  const bank = bankFieldsApply(type);
  patch.routingNumber = bank ? str(details.routingNumber) : undefined;
  patch.iban = bank ? str(details.iban) : undefined;
  patch.swiftBic = bank ? str(details.swiftBic) : undefined;
  // Savings rate → its OWN field, never the loan `interestRate`.
  patch.savingsInterestRate = type === 'savings' ? rate(details.savingsInterestRate) : undefined;
  // `interestRate` is loan-exclusive. Purge it from EVERY non-loan account so a
  // legacy value (from before savings had its own field, incl. the brief prod
  // window that reused it) can never survive a type change and be misread as a
  // loan rate. For a loan, we don't mention it — the AccountModal loan block is
  // its sole writer, so a loan's rate is never wiped.
  if (type !== 'loan') patch.interestRate = undefined;

  // Card (credit_card). Off-type → undefined (purged).
  const card = cardFieldsApply(type);
  patch.cardNetwork = card ? details.cardNetwork || undefined : undefined;
  patch.cardLast4 = card ? str(details.cardLast4) : undefined;
  patch.cardExpiry = card ? str(details.cardExpiry) : undefined;
  patch.creditLimit = card ? num(details.creditLimit) : undefined;
  patch.statementDay = card ? num(details.statementDay) : undefined;
  patch.paymentDueDay = card ? num(details.paymentDueDay) : undefined;

  // Crypto wallets. Off-type → undefined (purged).
  if (cryptoFieldsApply(type)) {
    const clean = sanitizeWallets(details.wallets);
    patch.wallets = clean.length ? clean : undefined;
  } else {
    patch.wallets = undefined;
  }

  return patch;
}

// ── Validation (returns i18n keys) ──────────────────────────────────────────

export function isValidLast4(v: string): boolean {
  return /^\d{4}$/.test(v);
}

export function isValidExpiry(v: string): boolean {
  return /^(0[1-9]|1[0-2])\/\d{2}$/.test(v);
}

export function isValidDayOfMonth(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 31;
}

/** A wallet row is invalid when exactly ONE of label/address is filled. */
export function walletRowError(w: CryptoWallet): UIStringKey | '' {
  const hasLabel = w.label.trim() !== '';
  const hasAddress = w.address.trim() !== '';
  return hasLabel !== hasAddress ? 'accountDetails.err.walletIncomplete' : '';
}

/**
 * Field → i18n-key map of validation errors (only invalid fields present). Empty
 * strings and `0` are treated as "not entered" (valid). Type-gated by the same
 * predicates the UI + patch use.
 */
export function validateAccountDetails(
  details: AccountDetails,
  type: AccountType | ''
): Record<string, UIStringKey> {
  const errors: Record<string, UIStringKey> = {};

  if (cardFieldsApply(type)) {
    const last4 = details.cardLast4.trim();
    if (last4 && !isValidLast4(last4)) errors.cardLast4 = 'accountDetails.err.last4';
    const expiry = details.cardExpiry.trim();
    if (expiry && !isValidExpiry(expiry)) errors.cardExpiry = 'accountDetails.err.expiry';
    if (details.statementDay && !isValidDayOfMonth(details.statementDay))
      errors.statementDay = 'accountDetails.err.day';
    if (details.paymentDueDay && !isValidDayOfMonth(details.paymentDueDay))
      errors.paymentDueDay = 'accountDetails.err.day';
  }

  if (cryptoFieldsApply(type) && details.wallets.some((w) => walletRowError(w))) {
    errors.wallets = 'accountDetails.err.walletIncomplete';
  }

  return errors;
}

// ── Display + telemetry formatters ──────────────────────────────────────────

/**
 * "Visa ••1234" (both), "Visa" (network only), or "••1234" (last-4 only).
 * Null only when NEITHER a network nor a valid last-4 is present — so a
 * card that carries just a network still renders a chip (no empty section).
 */
export function formatCardChip(
  network?: Account['cardNetwork'] | '',
  last4?: string
): string | null {
  const net = network ? CARD_NETWORK_LABELS[network] : '';
  const digits = last4 && /^\d{4}$/.test(last4) ? `••${last4}` : '';
  if (!net && !digits) return null;
  return [net, digits].filter(Boolean).join(' ');
}

function isSet(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== '';
}

/** True when the account carries any detail field (drives auto-expand + view). */
export function hasAccountDetails(account: Account): boolean {
  return ACCOUNT_DETAIL_KEYS.some((k) => isSet(account[k]));
}

/**
 * Counts/booleans-only telemetry summary for the save event. NEVER includes raw
 * field values (account numbers, card digits, addresses, URLs, notes) — those
 * are sensitive financial data and must not enter the CloudWatch firehose.
 */
export function accountDetailTelemetry(account: Account): Record<string, unknown> {
  return {
    account_type: account.type,
    has_account_number: !!account.accountNumber,
    has_online_banking: !!(account.onlineBankingUrl || account.onlineBankingUserId),
    has_card_details: !!(
      account.cardNetwork ||
      account.cardLast4 ||
      account.cardExpiry ||
      account.creditLimit ||
      account.statementDay ||
      account.paymentDueDay
    ),
    wallet_count: account.wallets?.length ?? 0,
    detail_field_count: ACCOUNT_DETAIL_KEYS.filter((k) => isSet(account[k])).length,
  };
}
