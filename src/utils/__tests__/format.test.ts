import { describe, it, expect } from 'vitest';
import { pluralize, formatBytes } from '../format';

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

describe('formatBytes', () => {
  /**
   * ⚠️ ZERO IS THE ONE BEHAVIOURAL DECISION IN THIS FUNCTION. The sub-KB floor
   * (`Math.max(1, …)`) made a compaction that saved nothing report "1 KB
   * smaller" — a number the person is told to read as evidence the operation was
   * worth doing.
   */
  it('renders exactly nothing as "0 KB", not "1 KB"', () => {
    expect(formatBytes(0)).toBe('0 KB');
  });

  it('still floors a NON-ZERO sub-kilobyte saving to "1 KB"', () => {
    // The opposite mistake: 400 bytes rendering as nothing at all.
    expect(formatBytes(400)).toBe('1 KB');
  });

  it('uses one decimal from a tenth of a megabyte up', () => {
    expect(formatBytes(2_202_009)).toBe('2.1 MB');
    expect(formatBytes(209_715)).toBe('0.2 MB');
  });

  it('uses whole kilobytes below that', () => {
    expect(formatBytes(51_200)).toBe('50 KB');
  });
});
