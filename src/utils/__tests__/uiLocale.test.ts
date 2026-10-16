import { describe, expect, it } from 'vitest';
import { formatUiDate, formatUiTime, uiLocale } from '../uiLocale';

describe('uiLocale', () => {
  it('maps the UI language to a BCP-47 locale, American English by default', () => {
    expect(uiLocale('en')).toBe('en-US');
    expect(uiLocale('zh')).toBe('zh-CN');
    expect(uiLocale(undefined)).toBe('en-US');
  });
});

describe('formatUiDate', () => {
  it('formats a local date in the UI language (month first in English)', () => {
    expect(formatUiDate('2026-09-28', 'en', { month: 'short', day: 'numeric' })).toBe('Sep 28');
    expect(formatUiDate('2026-09-29', 'en', { weekday: 'short' })).toBe('Tue');
    expect(formatUiDate('2026-09-29', 'zh', { weekday: 'short' })).toBe('周二');
  });
});

describe('formatUiTime', () => {
  // A local wall-clock instant, so the expectation holds in any host time zone. `Intl` may put
  // a narrow no-break space before AM/PM, so compare on plain spaces.
  const at1810 = new Date(2026, 9, 15, 18, 10).getTime();
  const at0405 = new Date(2026, 9, 15, 4, 5).getTime();
  const norm = (s: string) => s.replace(/\s/g, ' ');

  it('formats a time in American English, 12-hour with minutes', () => {
    expect(norm(formatUiTime(at1810, 'en'))).toBe('6:10 PM');
    expect(norm(formatUiTime(at0405, 'en'))).toBe('4:05 AM');
    expect(norm(formatUiTime(at1810, undefined))).toBe('6:10 PM');
  });

  it('formats a time in Chinese', () => {
    expect(formatUiTime(at1810, 'zh')).toBe('18:10');
    expect(formatUiTime(at0405, 'zh')).toBe('4:05');
  });
});
