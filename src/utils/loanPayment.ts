/**
 * Loan payment utilities — amortization math and loan lookups.
 * Pure functions with no store or repository imports (avoids circular deps).
 */

import type { Asset, Account, CurrencyCode } from '@/types/models';

// ── Amortization ──────────────────────────────────────────────────────────────

export interface AmortizationResult {
  interestPortion: number;
  principalPortion: number;
  newBalance: number;
}

/**
 * Calculate standard amortization for a monthly loan payment.
 * Returns interest/principal split and new outstanding balance.
 */
export function calculateAmortization(
  outstandingBalance: number,
  annualInterestRate: number,
  paymentAmount: number
): AmortizationResult {
  if (outstandingBalance <= 0) {
    return { interestPortion: 0, principalPortion: 0, newBalance: 0 };
  }

  const monthlyRate = annualInterestRate / 100 / 12;
  const interest = round2(outstandingBalance * monthlyRate);

  let principal = round2(paymentAmount - interest);

  // Cap principal at outstanding balance (final payment scenario)
  if (principal > outstandingBalance) {
    principal = round2(outstandingBalance);
  }

  // If payment is less than interest, no principal reduction
  if (principal < 0) {
    principal = 0;
  }

  const newBalance = round2(Math.max(0, outstandingBalance - principal));

  return { interestPortion: interest, principalPortion: principal, newBalance };
}

/**
 * Calculate an extra (one-time) payment on a loan.
 * Full amount goes to principal, capped at the outstanding balance.
 */
export function calculateExtraPayment(
  outstandingBalance: number,
  paymentAmount: number
): AmortizationResult {
  if (outstandingBalance <= 0) {
    return { interestPortion: 0, principalPortion: 0, newBalance: 0 };
  }

  const principal = round2(Math.min(paymentAmount, outstandingBalance));
  const newBalance = round2(Math.max(0, outstandingBalance - principal));

  return { interestPortion: 0, principalPortion: principal, newBalance };
}

// ── Loan lookups ──────────────────────────────────────────────────────────────

export interface LoanDetails {
  type: 'asset' | 'account';
  entityId: string;
  name: string;
  outstandingBalance: number;
  interestRate: number;
  monthlyPayment: number;
  currency: CurrencyCode;
  linkedAccountId?: string; // Auto-created loan account ID (asset loans only)
}

/**
 * Find loan details by loanId, checking assets first then standalone loan accounts.
 *
 * Invariants:
 * - For asset loans: loanId = asset.id
 * - For standalone loan accounts: loanId = account.id (only accounts WITHOUT linkedAssetId)
 * - Auto-linked accounts (with linkedAssetId) are never matched directly
 */
export function findLoanDetails(
  loanId: string,
  assets: Asset[],
  accounts: Account[]
): LoanDetails | null {
  // Check assets first
  const asset = assets.find((a) => a.id === loanId && a.loan?.hasLoan);
  if (asset && asset.loan) {
    const linkedAccount = accounts.find((a) => a.linkedAssetId === loanId);
    return {
      type: 'asset',
      entityId: asset.id,
      name: asset.name,
      outstandingBalance: asset.loan.outstandingBalance ?? 0,
      interestRate: asset.loan.interestRate ?? 0,
      monthlyPayment: asset.loan.monthlyPayment ?? 0,
      currency: asset.currency as CurrencyCode,
      linkedAccountId: linkedAccount?.id,
    };
  }

  // Check standalone loan accounts (exclude auto-linked accounts)
  const account = accounts.find((a) => a.id === loanId && a.type === 'loan' && !a.linkedAssetId);
  if (account) {
    return {
      type: 'account',
      entityId: account.id,
      name: account.name,
      outstandingBalance: account.balance,
      interestRate: account.interestRate ?? 0,
      monthlyPayment: account.monthlyPayment ?? 0,
      currency: account.currency as CurrencyCode,
    };
  }

  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
