import { describe, it, expect } from 'vitest';
import { calculateMonthlyFee, computeGoalAllocRaw, calculateBalanceAdjustment } from '../finance';

describe('calculateMonthlyFee', () => {
  it('per_session: $30/session, 2 sessions/week → $260.00/mo', () => {
    const result = calculateMonthlyFee({
      feeSchedule: 'per_session',
      feeAmount: 30,
      sessionsPerWeek: 2,
    });
    expect(result).toBe(260);
  });

  it('per_session: $50/session, 1 session/week (default) → $216.67/mo', () => {
    const result = calculateMonthlyFee({
      feeSchedule: 'per_session',
      feeAmount: 50,
    });
    expect(result).toBe(216.67);
  });

  it('per_session: $0 amount → $0', () => {
    const result = calculateMonthlyFee({
      feeSchedule: 'per_session',
      feeAmount: 0,
      sessionsPerWeek: 2,
    });
    expect(result).toBe(0);
  });

  it('weekly: $50/week → $216.67/mo', () => {
    const result = calculateMonthlyFee({
      feeSchedule: 'weekly',
      feeAmount: 50,
    });
    expect(result).toBe(216.67);
  });

  it('monthly: $200/mo → $200.00 (identity)', () => {
    const result = calculateMonthlyFee({
      feeSchedule: 'monthly',
      feeAmount: 200,
    });
    expect(result).toBe(200);
  });

  it('quarterly: $300/quarter → $100.00/mo', () => {
    const result = calculateMonthlyFee({
      feeSchedule: 'quarterly',
      feeAmount: 300,
    });
    expect(result).toBe(100);
  });

  it('yearly: $1200/year → $100.00/mo', () => {
    const result = calculateMonthlyFee({
      feeSchedule: 'yearly',
      feeAmount: 1200,
    });
    expect(result).toBe(100);
  });

  it('custom weeks: $500 every 6 weeks → $361.11/mo', () => {
    const result = calculateMonthlyFee({
      feeSchedule: 'custom',
      feeAmount: 500,
      feeCustomPeriod: 6,
      feeCustomPeriodUnit: 'weeks',
    });
    expect(result).toBe(361.11);
  });

  it('custom months: $900 every 3 months → $300.00/mo', () => {
    const result = calculateMonthlyFee({
      feeSchedule: 'custom',
      feeAmount: 900,
      feeCustomPeriod: 3,
      feeCustomPeriodUnit: 'months',
    });
    expect(result).toBe(300);
  });

  it('custom with missing period → fallback to feeAmount', () => {
    const result = calculateMonthlyFee({
      feeSchedule: 'custom',
      feeAmount: 250,
    });
    expect(result).toBe(250);
  });

  it('legacy termly → passthrough (identity)', () => {
    const result = calculateMonthlyFee({
      feeSchedule: 'termly',
      feeAmount: 450,
    });
    expect(result).toBe(450);
  });

  it('unknown schedule → passthrough (identity)', () => {
    const result = calculateMonthlyFee({
      feeSchedule: 'biannual',
      feeAmount: 600,
    });
    expect(result).toBe(600);
  });

  it('all outputs have exactly 2 decimal places (no floating point drift)', () => {
    // per_session with values that produce repeating decimals
    const r1 = calculateMonthlyFee({ feeSchedule: 'per_session', feeAmount: 50 });
    expect(Number.isFinite(r1)).toBe(true);
    expect(r1).toBe(Math.round(r1 * 100) / 100);

    const r2 = calculateMonthlyFee({
      feeSchedule: 'custom',
      feeAmount: 500,
      feeCustomPeriod: 6,
      feeCustomPeriodUnit: 'weeks',
    });
    expect(Number.isFinite(r2)).toBe(true);
    expect(r2).toBe(Math.round(r2 * 100) / 100);

    const r3 = calculateMonthlyFee({ feeSchedule: 'quarterly', feeAmount: 100 });
    expect(Number.isFinite(r3)).toBe(true);
    expect(r3).toBe(Math.round(r3 * 100) / 100);
  });

  it('negative amount → $0', () => {
    const result = calculateMonthlyFee({
      feeSchedule: 'monthly',
      feeAmount: -50,
    });
    expect(result).toBe(0);
  });
});

describe('computeGoalAllocRaw', () => {
  it('returns percentage of transaction amount', () => {
    expect(computeGoalAllocRaw('percentage', 10, 500)).toBe(50);
  });

  it('returns fixed amount regardless of transaction', () => {
    expect(computeGoalAllocRaw('fixed', 75, 500)).toBe(75);
  });
});

describe('calculateBalanceAdjustment', () => {
  it('income adds to balance', () => {
    expect(calculateBalanceAdjustment('income', 100)).toBe(100);
  });

  it('expense subtracts from balance', () => {
    expect(calculateBalanceAdjustment('expense', 100)).toBe(-100);
  });

  it('transfer debits source account', () => {
    expect(calculateBalanceAdjustment('transfer', 100, true)).toBe(-100);
  });

  it('transfer credits destination account', () => {
    expect(calculateBalanceAdjustment('transfer', 100, false)).toBe(100);
  });
});
