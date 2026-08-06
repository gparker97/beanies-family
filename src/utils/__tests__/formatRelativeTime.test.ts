import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from '@/utils/date';

describe('formatRelativeTime', () => {
  it('returns "" for null / empty / invalid input (never renders a broken label)', () => {
    expect(formatRelativeTime(null)).toBe('');
    expect(formatRelativeTime(undefined)).toBe('');
    expect(formatRelativeTime('')).toBe('');
    expect(formatRelativeTime('not-a-date')).toBe('');
  });

  it('localizes a recent timestamp', () => {
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const out = formatRelativeTime(twoMinAgo, 'en');
    expect(out.length).toBeGreaterThan(0);
    expect(out).toMatch(/min/i);
  });

  it('falls back to the English timeAgo when Intl.RelativeTimeFormat is unavailable', () => {
    const original = Intl.RelativeTimeFormat;
    // Simulate a runtime without Intl.RelativeTimeFormat.
    (Intl as unknown as { RelativeTimeFormat?: unknown }).RelativeTimeFormat = undefined;
    try {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      expect(formatRelativeTime(fiveMinAgo, 'en')).toBe('5m ago');
    } finally {
      (Intl as unknown as { RelativeTimeFormat: unknown }).RelativeTimeFormat = original;
    }
  });
});
