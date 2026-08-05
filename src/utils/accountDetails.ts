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
    savingsInterestRate: account.type === 'savings' ? account.interestRate : undefined,
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
 * Assemble the persisted patch by CONDITIONAL SPREAD.
 *
 * A field appears in the patch ONLY when its type group applies. An
 * applicable-but-cleared field is emitted as `undefined` (so the repo deletes
 * the key and the clear round-trips). A non-applicable group is OMITTED
 * entirely — NEVER emitted as `undefined`. This is load-bearing: because the
 * generic repo `update` deletes any key whose value is `undefined`, a patch
 * that emitted `interestRate: undefined` while editing a LOAN would wipe the
 * loan's rate. `savingsInterestRate` therefore maps to `interestRate` only for
 * savings; for every other type the key is never mentioned (the loan block in
 * AccountModal remains its sole writer).
 */
export function buildAccountDetailsPatch(
  details: AccountDetails,
  type: AccountType | ''
): Partial<Account> {
  const patch: Partial<Account> = {};
  const str = (s: string): string | undefined => s.trim() || undefined;
  const num = (n: number | undefined): number | undefined =>
    typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;

  // Common (all types) — always in-type, so empty → undefined (deletes on update).
  patch.onlineBankingUrl = str(details.onlineBankingUrl);
  patch.onlineBankingUserId = str(details.onlineBankingUserId);
  patch.notes = str(details.notes);

  // Account number — hidden for cash + crypto.
  if (showsAccountNumber(type)) patch.accountNumber = str(details.accountNumber);

  // Bank (checking / savings).
  if (bankFieldsApply(type)) {
    patch.routingNumber = str(details.routingNumber);
    patch.iban = str(details.iban);
    patch.swiftBic = str(details.swiftBic);
  }
  // Savings interest rate → Account.interestRate. ONLY savings — never mention
  // `interestRate` for any other type (protects a loan's rate).
  if (type === 'savings') patch.interestRate = num(details.savingsInterestRate);

  // Card (credit_card).
  if (cardFieldsApply(type)) {
    patch.cardNetwork = details.cardNetwork || undefined;
    patch.cardLast4 = str(details.cardLast4);
    patch.cardExpiry = str(details.cardExpiry);
    patch.creditLimit = num(details.creditLimit);
    patch.statementDay = num(details.statementDay);
    patch.paymentDueDay = num(details.paymentDueDay);
  }

  // Crypto wallets.
  if (cryptoFieldsApply(type)) {
    const clean = sanitizeWallets(details.wallets);
    patch.wallets = clean.length ? clean : undefined;
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

/** "Visa ••1234" (or "••1234" with no network). Null when last-4 is absent/invalid. */
export function formatCardChip(
  network?: Account['cardNetwork'] | '',
  last4?: string
): string | null {
  if (!last4 || !/^\d{4}$/.test(last4)) return null;
  const net = network ? CARD_NETWORK_LABELS[network] : '';
  return net ? `${net} ••${last4}` : `••${last4}`;
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
