import { describe, it, expect } from 'vitest';
import type { LocationQuery } from 'vue-router';
import { stripIntentKeys } from '../useQuickAddIntent';

describe('stripIntentKeys', () => {
  it('removes `action` + all four context keys', () => {
    const input: LocationQuery = {
      action: 'add-saying',
      memberId: 'm',
      recipeId: 'r',
      vacationId: 'v',
      medicationId: 'mx',
    };
    expect(stripIntentKeys(input)).toEqual({});
  });

  it('preserves unrelated query keys', () => {
    const input: LocationQuery = {
      action: 'add-transaction',
      goal: 'g-123',
      account: 'a-456',
      tab: 'recurring',
    };
    expect(stripIntentKeys(input)).toEqual({
      goal: 'g-123',
      account: 'a-456',
      tab: 'recurring',
    });
  });

  it('is idempotent — stripping a stripped query is a no-op', () => {
    const input: LocationQuery = { action: 'add-activity', memberId: 'm' };
    const once = stripIntentKeys(input);
    const twice = stripIntentKeys(once);
    expect(twice).toEqual(once);
  });

  it('does not mutate the input', () => {
    const input: LocationQuery = { action: 'add-activity', memberId: 'm' };
    stripIntentKeys(input);
    expect(input).toEqual({ action: 'add-activity', memberId: 'm' });
  });

  it('handles an empty query', () => {
    expect(stripIntentKeys({} as LocationQuery)).toEqual({});
  });
});
