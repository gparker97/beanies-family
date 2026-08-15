import { describe, it, expect } from 'vitest';
import { recurringToTransactionFields, recurringTemplateFields } from '@/utils/recurringItemFields';
import type { CreateRecurringItemInput } from '@/types/models';

function makeInput(overrides?: Partial<CreateRecurringItemInput>): CreateRecurringItemInput {
  return {
    accountId: 'acct-1',
    type: 'expense',
    amount: 120,
    currency: 'SGD',
    category: 'utilities',
    description: 'Broadband',
    frequency: 'monthly',
    dayOfMonth: 15,
    startDate: '2026-01-15',
    endDate: '2026-12-15',
    lastProcessedDate: '2026-07-15',
    isActive: true,
    ...overrides,
  } as unknown as CreateRecurringItemInput;
}

describe('recurringTemplateFields', () => {
  // Defined as an OMIT, never a keep-list: `splitRecurringItem` does not copy
  // the link fields onto the new item, so this update is the only thing that
  // restores them. A keep-list that forgot one would drop it on every split.
  it('omits the three schedule fields the split owns', () => {
    const out = recurringTemplateFields(makeInput());
    expect('startDate' in out).toBe(false);
    expect('endDate' in out).toBe(false);
    expect('lastProcessedDate' in out).toBe(false);
  });

  it('REGRESSION: cannot overwrite the split start date', () => {
    // Passing the raw form payload here reset the new segment's start to the
    // ORIGINAL series start, overlapping the just-end-dated original.
    const out = recurringTemplateFields(makeInput({ startDate: '2026-01-15' }));
    expect(out).not.toHaveProperty('startDate');
  });

  it('REGRESSION: does not carry lastProcessedDate onto the new segment', () => {
    // Inheriting it suppressed materialisation of the new segment up to that date.
    const out = recurringTemplateFields(makeInput({ lastProcessedDate: '2026-07-15' }));
    expect(out).not.toHaveProperty('lastProcessedDate');
  });

  it('drops an UNCHANGED end date (the split already inherited it)', () => {
    const out = recurringTemplateFields(makeInput({ endDate: '2026-12-15' }), '2026-12-15');
    expect(out).not.toHaveProperty('endDate');
  });

  it('APPLIES a deliberately changed end date', () => {
    // Blanket-stripping silently discarded a user's "ends on" edit made in the
    // same save — the bill ran months longer than they asked, with no error.
    const out = recurringTemplateFields(makeInput({ endDate: '2026-08-01' }), '2026-12-15');
    expect(out).toHaveProperty('endDate', '2026-08-01');
  });

  it('applies an end date newly ADDED to a previously open-ended series', () => {
    const out = recurringTemplateFields(makeInput({ endDate: '2026-08-01' }), '');
    expect(out).toHaveProperty('endDate', '2026-08-01');
  });

  it('strips endDate entirely when no original is supplied', () => {
    const out = recurringTemplateFields(makeInput({ endDate: '2026-08-01' }));
    expect(out).not.toHaveProperty('endDate');
  });

  it('preserves the link fields the split does NOT copy', () => {
    const out = recurringTemplateFields(
      makeInput({
        goalId: 'goal-1',
        goalAllocMode: 'fixed',
        goalAllocValue: 50,
        loanId: 'loan-1',
        activityId: 'act-1',
      } as Partial<CreateRecurringItemInput>)
    );
    expect(out).toMatchObject({
      goalId: 'goal-1',
      goalAllocMode: 'fixed',
      goalAllocValue: 50,
      loanId: 'loan-1',
      activityId: 'act-1',
    });
  });

  it('preserves the editable template fields', () => {
    const out = recurringTemplateFields(makeInput({ amount: 150, description: 'Fibre' }));
    expect(out).toMatchObject({ amount: 150, description: 'Fibre', dayOfMonth: 15 });
  });
});

describe('recurringToTransactionFields', () => {
  it('omits every date field so the caller sets the occurrence date explicitly', () => {
    const out = recurringToTransactionFields(makeInput());
    expect('date' in out).toBe(false);
    expect('startDate' in out).toBe(false);
    expect('dayOfMonth' in out).toBe(false);
  });

  it('translates the transaction-level fields across', () => {
    const out = recurringToTransactionFields(makeInput());
    expect(out).toMatchObject({
      accountId: 'acct-1',
      type: 'expense',
      amount: 120,
      currency: 'SGD',
      category: 'utilities',
      description: 'Broadband',
    });
  });

  it('clears the computed goal allocation so it is recomputed', () => {
    const out = recurringToTransactionFields(makeInput({ goalId: 'goal-1' }));
    expect(out.goalAllocApplied).toBeUndefined();
  });

  it('drops goal allocation settings when there is no goal', () => {
    const out = recurringToTransactionFields(
      makeInput({ goalId: undefined, goalAllocMode: 'fixed', goalAllocValue: 10 })
    );
    expect(out.goalAllocMode).toBeUndefined();
    expect(out.goalAllocValue).toBeUndefined();
  });
});
