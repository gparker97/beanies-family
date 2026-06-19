import { describe, it, expect } from 'vitest';
import { isNetworkError } from '../isNetworkError';

describe('isNetworkError', () => {
  it('matches Chrome/Edge/Firefox "Failed to fetch"', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('matches Safari/iOS WebKit "Load failed" (the finding-6 gap)', () => {
    expect(isNetworkError(new TypeError('Load failed'))).toBe(true);
  });

  it('matches generic "NetworkError"', () => {
    expect(isNetworkError(new TypeError('NetworkError when attempting to fetch resource'))).toBe(
      true
    );
  });

  it('does not match unrelated errors', () => {
    expect(isNetworkError(new Error('Unauthorized'))).toBe(false);
    expect(isNetworkError(new Error('Out of bounds table access'))).toBe(false);
  });

  it('handles non-Error values', () => {
    expect(isNetworkError('Load failed')).toBe(true);
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
  });
});
