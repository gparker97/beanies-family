import type { HolidayOccurrence } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

export type TranslateFn = (key: UIStringKey) => string;

/**
 * Festive theme name for the day-of banner — pairs with the CSS theme classes
 * in `HolidayBriefingBanner.vue`. `null` means "no special treatment, fall
 * back to the default Sky Silk palette" (used by non-allowlist holidays).
 *
 * `'birthday'` is special — it isn't a public-holiday match (it can't be,
 * since DOB is per-user data) and so doesn't appear in
 * `HOLIDAY_GREETING_TABLE`. The banner component detects birthdays directly
 * and applies this theme to its own synthetic surface; the theme name is
 * declared here only so every consumer of `HolidayTheme` stays exhaustive.
 */
export type HolidayTheme =
  | 'christmas'
  | 'lunarNewYear'
  | 'newYear'
  | 'diwali'
  | 'eid'
  | 'easter'
  | 'mothersDay'
  | 'fathersDay'
  | 'thanksgiving'
  | 'birthday';

// Ordered list — first match wins. Order matters because "Lunar New Year"
// contains "New Year"; the lunar entry must come first.
const HOLIDAY_GREETING_TABLE: ReadonlyArray<{
  matches: readonly string[];
  greetingKey: UIStringKey;
  emoji: string;
  theme: HolidayTheme;
}> = [
  {
    matches: ['lunar new year', 'chinese new year', 'spring festival'],
    greetingKey: 'nook.holiday.greeting.lunarNewYear',
    emoji: '🌸',
    theme: 'lunarNewYear',
  },
  {
    matches: ['new year'],
    greetingKey: 'nook.holiday.greeting.newYear',
    emoji: '🎆',
    theme: 'newYear',
  },
  {
    matches: ['christmas'],
    greetingKey: 'nook.holiday.greeting.christmas',
    emoji: '🎄',
    theme: 'christmas',
  },
  {
    matches: ['easter'],
    greetingKey: 'nook.holiday.greeting.easter',
    emoji: '🌷',
    theme: 'easter',
  },
  {
    matches: ["mother's day", 'mothers day'],
    greetingKey: 'nook.holiday.greeting.mothersDay',
    emoji: '💐',
    theme: 'mothersDay',
  },
  {
    matches: ["father's day", 'fathers day'],
    greetingKey: 'nook.holiday.greeting.fathersDay',
    emoji: '👔',
    theme: 'fathersDay',
  },
  {
    matches: ['thanksgiving'],
    greetingKey: 'nook.holiday.greeting.thanksgiving',
    emoji: '🦃',
    theme: 'thanksgiving',
  },
  {
    matches: ['diwali', 'deepavali'],
    greetingKey: 'nook.holiday.greeting.diwali',
    emoji: '🪔',
    theme: 'diwali',
  },
  { matches: ['eid'], greetingKey: 'nook.holiday.greeting.eid', emoji: '🌙', theme: 'eid' },
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

/**
 * Festive theme name for allowlisted holidays — pairs with the per-theme
 * palette + decorative motif blocks in `HolidayBriefingBanner.vue`. Returns
 * `null` for non-allowlist holidays, which fall back to the default Sky Silk
 * palette with no decorative motif.
 */
export function getHolidayTheme(holiday: HolidayOccurrence): HolidayTheme | null {
  return findMatch(holiday)?.theme ?? null;
}
