import { describe, it, expect } from 'vitest';
import { pluralize } from '../format';

describe('pluralize', () => {
  it('returns singular form when count is 1', () => {
    expect(pluralize(1, 'dose', 'doses')).toBe('dose');
  });

  it('returns plural form when count is 0', () => {
    expect(pluralize(0, 'dose', 'doses')).toBe('doses');
  });

  it('returns plural form when count is greater than 1', () => {
    expect(pluralize(2, 'dose', 'doses')).toBe('doses');
    expect(pluralize(42, 'dose', 'doses')).toBe('doses');
  });

  it('returns plural form for negative counts (defined behavior)', () => {
    expect(pluralize(-1, 'dose', 'doses')).toBe('doses');
  });

  it('supports irregular forms (not just -s)', () => {
    expect(pluralize(1, 'child', 'children')).toBe('child');
    expect(pluralize(3, 'child', 'children')).toBe('children');
  });
});
