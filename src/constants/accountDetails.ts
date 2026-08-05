// Account-details reference data — card networks + crypto chains.
//
// These option VALUES are proper nouns (Visa, Ethereum, …), rendered from
// code-keyed label maps and NEVER translated — same policy as airlines /
// airports / currencies. The maps are keyed by the code (not by a `label`
// render key) so `beanies-i18n/no-bare-render-strings` does not flag the
// literals; `<select>` options are built as
// `CARD_NETWORKS.map(n => ({ value: n, label: CARD_NETWORK_LABELS[n] }))`.
// NEVER write inline `{ label: 'Visa' }`.

import type { Account, CardNetwork, CryptoChain } from '@/types/models';

export const CARD_NETWORKS: CardNetwork[] = [
  'visa',
  'mastercard',
  'amex',
  'discover',
  'unionpay',
  'jcb',
  'other',
];

export const CARD_NETWORK_LABELS: Record<CardNetwork, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'Amex',
  discover: 'Discover',
  unionpay: 'UnionPay',
  jcb: 'JCB',
  other: 'Other',
};

export const CRYPTO_CHAINS: CryptoChain[] = ['ethereum', 'bitcoin', 'solana', 'polygon', 'other'];

export const CRYPTO_CHAIN_LABELS: Record<CryptoChain, string> = {
  ethereum: 'Ethereum',
  bitcoin: 'Bitcoin',
  solana: 'Solana',
  polygon: 'Polygon',
  other: 'Other',
};

// The single canonical list of the flat account-detail fields on `Account`.
// Drives `hasAccountDetails`, the `detail_field_count` telemetry counter, and
// is the seam a future secrets module migrates from ("move these keys").
// NOTE: `interestRate` is intentionally EXCLUDED — it is shared with loans, so
// it is not a detail-only field and must not flip `hasAccountDetails` for a loan.
export const ACCOUNT_DETAIL_KEYS: (keyof Account)[] = [
  'accountNumber',
  'onlineBankingUrl',
  'onlineBankingUserId',
  'notes',
  'routingNumber',
  'iban',
  'swiftBic',
  'cardNetwork',
  'cardLast4',
  'cardExpiry',
  'creditLimit',
  'statementDay',
  'paymentDueDay',
  'wallets',
];
