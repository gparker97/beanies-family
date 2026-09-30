import { describe, expect, it } from 'vitest';
import { formatUiDate, uiLocale } from '../uiLocale';

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
