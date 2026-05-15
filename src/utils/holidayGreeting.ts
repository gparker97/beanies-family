import type { HolidayOccurrence } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

export type TranslateFn = (key: UIStringKey) => string;

// Ordered list — first match wins. Order matters because "Lunar New Year"
// contains "New Year"; the lunar entry must come first.
const HOLIDAY_GREETING_TABLE: ReadonlyArray<{
  matches: readonly string[];
  greetingKey: UIStringKey;
  emoji: string;
}> = [
  {
    matches: ['lunar new year', 'chinese new year', 'spring festival'],
    greetingKey: 'nook.holiday.greeting.lunarNewYear',
    emoji: '🌸',
  },
  { matches: ['new year'], greetingKey: 'nook.holiday.greeting.newYear', emoji: '🎆' },
  {
    matches: ['christmas'],
    greetingKey: 'nook.holiday.greeting.christmas',
    emoji: '🎄',
  },
  { matches: ['easter'], greetingKey: 'nook.holiday.greeting.easter', emoji: '🌷' },
  {
    matches: ["mother's day", 'mothers day'],
    greetingKey: 'nook.holiday.greeting.mothersDay',
    emoji: '💐',
  },
  {
    matches: ["father's day", 'fathers day'],
    greetingKey: 'nook.holiday.greeting.fathersDay',
    emoji: '👔',
  },
  {
    matches: ['thanksgiving'],
    greetingKey: 'nook.holiday.greeting.thanksgiving',
    emoji: '🦃',
  },
  {
    matches: ['diwali', 'deepavali'],
    greetingKey: 'nook.holiday.greeting.diwali',
    emoji: '🪔',
  },
  { matches: ['eid'], greetingKey: 'nook.holiday.greeting.eid', emoji: '🌙' },
];

const FALLBACK_EMOJI = '🗓️';

function findMatch(
  holiday: HolidayOccurrence
): (typeof HOLIDAY_GREETING_TABLE)[number] | undefined {
  const name = holiday.name?.toLowerCase().trim();
  if (!name) return undefined;
  return HOLIDAY_GREETING_TABLE.find((row) => row.matches.some((m) => name.includes(m)));
}

/**
 * Compose the day-of greeting line for the holiday banner. Returns the
 * allowlisted warm greeting when the holiday matches a global pattern;
 * otherwise falls through to `"Today is {holidayName}"` with the dataset
 * name interpolated.
 */
export function getHolidayGreeting(holiday: HolidayOccurrence, t: TranslateFn): string {
  const match = findMatch(holiday);
  if (match) return t(match.greetingKey);
  return t('nook.holiday.greeting.default').replace('{holidayName}', holiday.name);
}

/**
 * Emoji for the day-of banner. Allowlisted holidays get a themed glyph;
 * everything else falls back to a neutral calendar icon.
 */
export function getHolidayEmoji(holiday: HolidayOccurrence): string {
  return findMatch(holiday)?.emoji ?? FALLBACK_EMOJI;
}
