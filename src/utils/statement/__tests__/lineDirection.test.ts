import { describe, it, expect } from 'vitest';
import { lineDirection } from '../lineDirection';

describe('lineDirection (#107)', () => {
  it('income is in, expense is out', () => {
    expect(lineDirection({ type: 'income' }, 'card')).toBe('in');
    expect(lineDirection({ type: 'expense' }, 'card')).toBe('out');
  });

  it('a transfer INTO the import account is in; out of it is out', () => {
    expect(lineDirection({ type: 'transfer', toAccountId: 'card' }, 'card')).toBe('in');
    expect(lineDirection({ type: 'transfer', toAccountId: 'savings' }, 'card')).toBe('out');
  });
});
