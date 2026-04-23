/**
 * Pure-function tests for `parseIntentFromQuery`. No router, no
 * component harness — just a function of (LocationQuery).
 */
import { describe, it, expect } from 'vitest';
import type { LocationQuery } from 'vue-router';
import { parseIntentFromQuery } from '../useQuickAddIntent';

describe('parseIntentFromQuery', () => {
  it('returns null when query is empty', () => {
    expect(parseIntentFromQuery({} as LocationQuery)).toBeNull();
  });

  it('returns null when action is absent', () => {
    expect(parseIntentFromQuery({ foo: 'bar' } as LocationQuery)).toBeNull();
  });

  it('returns null when action is empty string', () => {
    expect(parseIntentFromQuery({ action: '' } as LocationQuery)).toBeNull();
  });

  it('returns null when action is an array (repeated param)', () => {
    expect(parseIntentFromQuery({ action: ['a', 'b'] } as unknown as LocationQuery)).toBeNull();
  });

  it('returns { action, context: {} } when only action is present', () => {
    expect(parseIntentFromQuery({ action: 'add-activity' } as LocationQuery)).toEqual({
      action: 'add-activity',
      context: {},
    });
  });

  it('populates every known context key when present', () => {
    const query: LocationQuery = {
      action: 'add-saying',
      memberId: 'm1',
      recipeId: 'r1',
      vacationId: 'v1',
      medicationId: 'mx1',
    };
    expect(parseIntentFromQuery(query)).toEqual({
      action: 'add-saying',
      context: {
        memberId: 'm1',
        recipeId: 'r1',
        vacationId: 'v1',
        medicationId: 'mx1',
      },
    });
  });

  it('ignores unknown query keys', () => {
    const query: LocationQuery = {
      action: 'add-activity',
      goal: 'g1', // pre-existing goal filter — NOT a quick-add context key
      memberId: 'm1',
    };
    expect(parseIntentFromQuery(query)).toEqual({
      action: 'add-activity',
      context: { memberId: 'm1' },
    });
  });

  it('skips context keys whose value is an array', () => {
    const query: LocationQuery = {
      action: 'add-saying',
      memberId: ['m1', 'm2'],
    } as unknown as LocationQuery;
    expect(parseIntentFromQuery(query)).toEqual({
      action: 'add-saying',
      context: {},
    });
  });

  it('skips context keys whose value is an empty string', () => {
    const query: LocationQuery = { action: 'add-saying', memberId: '' };
    expect(parseIntentFromQuery(query)).toEqual({
      action: 'add-saying',
      context: {},
    });
  });
});
