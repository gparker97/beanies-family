import { describe, it, expect } from 'vitest';
import { calculateAmortization, calculateExtraPayment, findLoanDetails } from '../loanPayment';
import type { Asset, Account } from '@/types/models';

describe('calculateAmortization', () => {
  it('should calculate standard monthly payment correctly', () => {
    // $200,000 balance, 6% annual rate, $1,199.10 payment
    const result = calculateAmortization(200000, 6, 1199.1);
    // Monthly rate = 6/100/12 = 0.005
    // Interest = 200000 * 0.005 = 1000
    // Principal = 1199.10 - 1000 = 199.10
    expect(result.interestPortion).toBe(1000);
    expect(result.principalPortion).toBe(199.1);
    expect(result.newBalance).toBe(199800.9);
  });

  it('should cap principal at balance for final payment', () => {
    // $500 balance, 5% rate, $1,200 payment
    const result = calculateAmortization(500, 5, 1200);
    // Interest = 500 * (5/100/12) = 500 * 0.004167 = 2.08
    // Principal would be 1197.92 but capped at 500
    expect(result.interestPortion).toBe(2.08);
    expect(result.principalPortion).toBe(500);
    expect(result.newBalance).toBe(0);
  });

  it('should handle zero interest rate', () => {
    const result = calculateAmortization(10000, 0, 500);
    expect(result.interestPortion).toBe(0);
    expect(result.principalPortion).toBe(500);
    expect(result.newBalance).toBe(9500);
  });

  it('should return zeros for zero balance', () => {
    const result = calculateAmortization(0, 5, 1200);
    expect(result.interestPortion).toBe(0);
    expect(result.principalPortion).toBe(0);
    expect(result.newBalance).toBe(0);
  });

  it('should return zeros for negative balance', () => {
    const result = calculateAmortization(-100, 5, 1200);
    expect(result.interestPortion).toBe(0);
    expect(result.principalPortion).toBe(0);
    expect(result.newBalance).toBe(0);
  });

  it('should round all outputs to 2 decimal places', () => {
    // $100,000 at 7.5% → interest = 100000 * 0.00625 = 625
    // Payment of $699.21 → principal = 74.21
    const result = calculateAmortization(100000, 7.5, 699.21);
    expect(result.interestPortion).toBe(625);
    expect(result.principalPortion).toBe(74.21);
    expect(result.newBalance).toBe(99925.79);
    // Verify no floating point artifacts
    expect(String(result.interestPortion).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
    expect(String(result.principalPortion).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
    expect(String(result.newBalance).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
  });

  it('should handle very small balance without negatives', () => {
    const result = calculateAmortization(0.01, 5, 500);
    expect(result.principalPortion).toBe(0.01);
    expect(result.newBalance).toBe(0);
    expect(result.newBalance).toBeGreaterThanOrEqual(0);
  });

  it('should handle payment less than interest', () => {
    // $500,000 at 12% → monthly interest = 5000, payment = 3000
    const result = calculateAmortization(500000, 12, 3000);
    expect(result.interestPortion).toBe(5000);
    expect(result.principalPortion).toBe(0); // Can't reduce principal
    expect(result.newBalance).toBe(500000);
  });
});

describe('calculateExtraPayment', () => {
  it('should apply full amount to principal', () => {
    const result = calculateExtraPayment(50000, 5000);
    expect(result.interestPortion).toBe(0);
    expect(result.principalPortion).toBe(5000);
    expect(result.newBalance).toBe(45000);
  });

  it('should cap at outstanding balance', () => {
    const result = calculateExtraPayment(1000, 5000);
    expect(result.interestPortion).toBe(0);
    expect(result.principalPortion).toBe(1000);
    expect(result.newBalance).toBe(0);
  });

  it('should return zeros for zero balance', () => {
    const result = calculateExtraPayment(0, 5000);
    expect(result.interestPortion).toBe(0);
    expect(result.principalPortion).toBe(0);
    expect(result.newBalance).toBe(0);
  });
});

describe('findLoanDetails', () => {
  const mockAssetWithLoan: Asset = {
    id: 'asset-1',
    memberId: 'member-1',
    type: 'real_estate',
    name: 'My House',
    purchaseValue: 300000,
    currentValue: 350000,
    currency: 'USD',
    includeInNetWorth: true,
    loan: {
      hasLoan: true,
      loanAmount: 250000,
      outstandingBalance: 200000,
      interestRate: 5,
      monthlyPayment: 1500,
      loanTermMonths: 360,
      loanStartDate: '2020-01-01',
    },
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
  };

  const mockAssetWithoutLoan: Asset = {
    id: 'asset-2',
    memberId: 'member-1',
    type: 'vehicle',
    name: 'My Car',
    purchaseValue: 30000,
    currentValue: 25000,
    currency: 'USD',
    includeInNetWorth: true,
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
  };

  const mockLinkedLoanAccount: Account = {
    id: 'linked-account-1',
    memberId: 'member-1',
    name: 'My House Loan',
    type: 'loan',
    currency: 'USD',
    balance: 200000,
    isActive: true,
    includeInNetWorth: true,
    linkedAssetId: 'asset-1', // ← auto-linked
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
  };

  const mockStandaloneLoanAccount: Account = {
    id: 'loan-account-1',
    memberId: 'member-1',
    name: 'Car Loan',
    type: 'loan',
    currency: 'USD',
    balance: 15000,
    interestRate: 4.5,
    monthlyPayment: 400,
    isActive: true,
    includeInNetWorth: true,
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
  };

  const assets = [mockAssetWithLoan, mockAssetWithoutLoan];
  const accounts = [mockLinkedLoanAccount, mockStandaloneLoanAccount];

  it('should find asset loan by asset ID', () => {
    const result = findLoanDetails('asset-1', assets, accounts);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('asset');
    expect(result!.entityId).toBe('asset-1');
    expect(result!.name).toBe('My House');
    expect(result!.outstandingBalance).toBe(200000);
    expect(result!.interestRate).toBe(5);
    expect(result!.monthlyPayment).toBe(1500);
    expect(result!.linkedAccountId).toBe('linked-account-1');
  });

  it('should find standalone loan account by account ID', () => {
    const result = findLoanDetails('loan-account-1', assets, accounts);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('account');
    expect(result!.entityId).toBe('loan-account-1');
    expect(result!.name).toBe('Car Loan');
    expect(result!.outstandingBalance).toBe(15000);
    expect(result!.interestRate).toBe(4.5);
    expect(result!.monthlyPayment).toBe(400);
    expect(result!.linkedAccountId).toBeUndefined();
  });

  it('should NOT find auto-linked account directly', () => {
    // The linked account should not be found by its own ID
    const result = findLoanDetails('linked-account-1', assets, accounts);
    expect(result).toBeNull();
  });

  it('should return null when no match', () => {
    const result = findLoanDetails('nonexistent-id', assets, accounts);
    expect(result).toBeNull();
  });
});
