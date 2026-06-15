import { describe, it, expect } from 'vitest';
import { isStorageBlockedError } from '../registryDatabase';

describe('isStorageBlockedError', () => {
  it('is true for the IndexedDB-blocked error names (iOS Private Browsing / Firefox private / quota)', () => {
    for (const name of ['InvalidStateError', 'SecurityError', 'QuotaExceededError']) {
      const e = new Error('blocked');
      e.name = name;
      expect(isStorageBlockedError(e)).toBe(true);
    }
  });

  it('is false for a generic error, a non-Error value, and unrelated DOMException names', () => {
    expect(isStorageBlockedError(new Error('boom'))).toBe(false);
    const notFound = new Error('x');
    notFound.name = 'NotFoundError';
    expect(isStorageBlockedError(notFound)).toBe(false);
    expect(isStorageBlockedError('InvalidStateError')).toBe(false);
    expect(isStorageBlockedError(null)).toBe(false);
    expect(isStorageBlockedError(undefined)).toBe(false);
  });
});
