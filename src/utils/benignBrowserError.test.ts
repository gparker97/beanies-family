import { describe, it, expect } from 'vitest';
import { isBenignBrowserError } from './benignBrowserError';

describe('isBenignBrowserError', () => {
  it('matches the ResizeObserver "undelivered notifications" signal (string + Error)', () => {
    const msg = 'ResizeObserver loop completed with undelivered notifications';
    expect(isBenignBrowserError(msg)).toBe(true);
    expect(isBenignBrowserError(new Error(msg))).toBe(true);
    // Browsers sometimes prefix "Uncaught " / "Script error." — substring match still hits.
    expect(isBenignBrowserError(`Uncaught ${msg}.`)).toBe(true);
  });

  it('matches the legacy ResizeObserver "loop limit exceeded" signal', () => {
    expect(isBenignBrowserError('ResizeObserver loop limit exceeded')).toBe(true);
    expect(isBenignBrowserError(new Error('ResizeObserver loop limit exceeded'))).toBe(true);
  });

  it('does not match a real error message', () => {
    expect(isBenignBrowserError('TypeError: cannot read property of undefined')).toBe(false);
    expect(isBenignBrowserError(new Error('Google Calendar HTTP 500'))).toBe(false);
  });

  it('returns false for empty / non-string / non-Error inputs', () => {
    expect(isBenignBrowserError('')).toBe(false);
    expect(isBenignBrowserError(null)).toBe(false);
    expect(isBenignBrowserError(undefined)).toBe(false);
    expect(isBenignBrowserError({ message: 'ResizeObserver loop limit exceeded' })).toBe(false);
    expect(isBenignBrowserError(42)).toBe(false);
  });
});
