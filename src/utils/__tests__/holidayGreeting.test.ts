import { describe, it, expect } from 'vitest';
import { getHolidayGreeting, getHolidayEmoji, getHolidayTheme } from '@/utils/holidayGreeting';
import type { HolidayOccurrence } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

function makeHoliday(name: string): HolidayOccurrence {
  return { date: '2026-12-25', name, countryCode: 'US' };
}

// Test translator: returns the key itself plus a literal copy of any
// {placeholder} unreplaced — gives us back the i18n key on hit, and a
// distinctive "Today is {holidayName}" template on the fallback path.
const tEcho = (key: UIStringKey): string => key;

// Translator with manual interpolation simulating the real `t()` + `.replace()` pipeline.
function tWithDefault(key: UIStringKey): string {
  if (key === 'nook.holiday.greeting.default') return 'Today is {holidayName}';
  return key;
}

describe('getHolidayGreeting', () => {
  it('returns the Christmas greeting key for "Christmas Day"', () => {
    expect(getHolidayGreeting(makeHoliday('Christmas Day'), tEcho)).toBe(
      'nook.holiday.greeting.christmas'
    );
  });

  it('matches case-insensitively', () => {
    expect(getHolidayGreeting(makeHoliday('CHRISTMAS DAY'), tEcho)).toBe(
      'nook.holiday.greeting.christmas'
    );
    expect(getHolidayGreeting(makeHoliday('christmas eve'), tEcho)).toBe(
      'nook.holiday.greeting.christmas'
    );
  });

  it('prefers Lunar New Year over plain New Year (order matters)', () => {
    expect(getHolidayGreeting(makeHoliday('Lunar New Year'), tEcho)).toBe(
      'nook.holiday.greeting.lunarNewYear'
    );
    expect(getHolidayGreeting(makeHoliday('Chinese New Year'), tEcho)).toBe(
      'nook.holiday.greeting.lunarNewYear'
    );
    expect(getHolidayGreeting(makeHoliday("New Year's Day"), tEcho)).toBe(
      'nook.holiday.greeting.newYear'
    );
  });

  it('matches Eid variants via partial-name prefix', () => {
    expect(getHolidayGreeting(makeHoliday('Eid al-Fitr'), tEcho)).toBe('nook.holiday.greeting.eid');
    expect(getHolidayGreeting(makeHoliday('Eid al-Adha'), tEcho)).toBe('nook.holiday.greeting.eid');
  });

  it('matches Diwali / Deepavali interchangeably', () => {
    expect(getHolidayGreeting(makeHoliday('Diwali'), tEcho)).toBe('nook.holiday.greeting.diwali');
    expect(getHolidayGreeting(makeHoliday('Deepavali'), tEcho)).toBe(
      'nook.holiday.greeting.diwali'
    );
  });

  it("matches Mother's Day with or without apostrophe", () => {
    expect(getHolidayGreeting(makeHoliday("Mother's Day"), tEcho)).toBe(
      'nook.holiday.greeting.mothersDay'
    );
    expect(getHolidayGreeting(makeHoliday('Mothers Day'), tEcho)).toBe(
      'nook.holiday.greeting.mothersDay'
    );
  });

  it('falls back to default with holiday name interpolated for unmatched holidays', () => {
    expect(getHolidayGreeting(makeHoliday('Vesak Day'), tWithDefault)).toBe('Today is Vesak Day');
    expect(getHolidayGreeting(makeHoliday('National Day'), tWithDefault)).toBe(
      'Today is National Day'
    );
  });

  it('returns the default fallback when the name is empty', () => {
    expect(getHolidayGreeting(makeHoliday(''), tWithDefault)).toBe('Today is ');
  });
});

describe('getHolidayEmoji', () => {
  it('returns the themed emoji for allowlisted holidays', () => {
    expect(getHolidayEmoji(makeHoliday('Christmas Day'))).toBe('🎄');
    expect(getHolidayEmoji(makeHoliday('Lunar New Year'))).toBe('🌸');
    expect(getHolidayEmoji(makeHoliday("New Year's Day"))).toBe('🎆');
    expect(getHolidayEmoji(makeHoliday('Diwali'))).toBe('🪔');
    expect(getHolidayEmoji(makeHoliday('Eid al-Fitr'))).toBe('🌙');
    expect(getHolidayEmoji(makeHoliday('Thanksgiving Day'))).toBe('🦃');
    expect(getHolidayEmoji(makeHoliday('Easter Sunday'))).toBe('🌷');
  });

  it('falls back to the neutral calendar emoji for unmatched holidays', () => {
    expect(getHolidayEmoji(makeHoliday('Vesak Day'))).toBe('🗓️');
    expect(getHolidayEmoji(makeHoliday(''))).toBe('🗓️');
  });
});

describe('getHolidayTheme', () => {
  it('returns the matching theme name for allowlisted holidays', () => {
    expect(getHolidayTheme(makeHoliday('Christmas Day'))).toBe('christmas');
    expect(getHolidayTheme(makeHoliday('Lunar New Year'))).toBe('lunarNewYear');
    expect(getHolidayTheme(makeHoliday("New Year's Day"))).toBe('newYear');
    expect(getHolidayTheme(makeHoliday('Diwali'))).toBe('diwali');
    expect(getHolidayTheme(makeHoliday('Eid al-Fitr'))).toBe('eid');
    expect(getHolidayTheme(makeHoliday("Mother's Day"))).toBe('mothersDay');
    expect(getHolidayTheme(makeHoliday("Father's Day"))).toBe('fathersDay');
    expect(getHolidayTheme(makeHoliday('Thanksgiving Day'))).toBe('thanksgiving');
    expect(getHolidayTheme(makeHoliday('Easter Sunday'))).toBe('easter');
  });

  it('returns null for non-allowlist holidays', () => {
    expect(getHolidayTheme(makeHoliday('Vesak Day'))).toBeNull();
    expect(getHolidayTheme(makeHoliday('Labour Day'))).toBeNull();
    expect(getHolidayTheme(makeHoliday(''))).toBeNull();
  });
});
