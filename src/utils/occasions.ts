/**
 * Occasions (#137): birthdays, anniversaries and days to remember, kept as yearly all-day
 * activities for people outside the pod (a pod member's own birthday is derived from their
 * profile instead, see `birthdays.ts`).
 *
 * THE one home for every per-type occasion rule. The hint engine, the activity drawer, the
 * celebration detector, the AI import and the calendar render sites all read this table and
 * apply their own policy on top, so a rule never has to be restated.
 *
 * A pure LEAF module: no stores, no `Date.now()`, no hint types, and nothing that reaches
 * telemetry. `listTemplates.ts` (imported by `listStore`) and `activityCelebration.ts` both
 * import it, so an import of the recurrence engine here (which logs through `logEvent`, whose
 * diagnostic context imports `syncStore`) closed a module cycle and left
 * `CELEBRATORY_OCCASIONS` uninitialised. The yearly anchor rule that needs the engine lives
 * beside this file in `occasionAnchor.ts`. Everything that formats takes `t` from the caller,
 * the same way `birthdayLabel` does.
 */
import type { ActivityCategory, FamilyActivity } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { fillTemplate } from '@/utils/fillTemplate';
import { getOrdinalSuffix, type TranslateFn } from '@/utils/format';
import { containsPhrase } from '@/utils/textSimilarity';

/** The Occasions-group category ids. A subtype of `ActivityCategory`, so a renamed id fails
 *  to compile everywhere this is used. */
export type OccasionCategory = Extract<
  ActivityCategory,
  'occasion_birthday' | 'anniversary' | 'remembrance' | 'other_occasion'
>;

export interface OccasionType {
  /** Label of the optional year field ("Born in", "Married in", ...). */
  yearLabelKey: UIStringKey;
  /** Milestone wording for a count of one and for any other count. */
  milestoneKeys: { one: UIStringKey; other: UIStringKey };
  /** Does this occasion get the celebration styling? False only for remembrance. */
  celebrates: boolean;
  /** Is this count a "big one" worth a month's notice? */
  isRound: (n: number) => boolean;
  /** Title keywords (en + zh) that file a new activity under this type. */
  keywords: readonly string[];
  /** Phrases that veto the keywords ("birthday party" is a party, not an occasion). */
  excludeIf?: readonly string[];
}

const ROUND_ANNIVERSARIES: ReadonlySet<number> = new Set([10, 25, 40, 50, 60, 70, 75]);

const YEARS: OccasionType['milestoneKeys'] = {
  one: 'planner.occasion.milestone.years.one',
  other: 'planner.occasion.milestone.years.other',
};

/**
 * Every per-type rule. The key order IS the keyword match precedence, and it is deliberate:
 * remembrance first, because misfiling a remembrance as a birthday shows confetti on a sad
 * day, while the reverse only loses the styling. "Grandma's birthday memorial" is a
 * remembrance; "Our anniversary" an anniversary.
 *
 * A test asserts the keys equal the `Occasions` group in `ACTIVITY_CATEGORIES`.
 */
/**
 * Words that stop a title from filing itself as a celebratory occasion. A party is a one-off
 * event to attend (the Party group covers it); a sad word means the title may be about a
 * passing. Either way the matcher picks nothing rather than guess: misfiling a remembrance as
 * a birthday would show confetti on a sad day.
 */
const CELEBRATION_VETO: readonly string[] = ['party', '派对', '聚会', 'memorial', 'funeral'];

export const OCCASION_TYPES: Record<OccasionCategory, OccasionType> = {
  remembrance: {
    yearLabelKey: 'planner.occasion.year.yearOfPassing',
    milestoneKeys: YEARS,
    celebrates: false,
    isRound: () => false,
    // Only phrases that mean somebody's passing. Not a bare "memorial": that word also names
    // places (Memorial Hospital), a holiday (Memorial Day) and one-off services to attend, and
    // a guessed category is worse than none (the person picks it instead).
    keywords: ['in memory', 'remembrance', 'death anniversary', '忌日', '祭日', '追思', '逝世'],
  },
  anniversary: {
    yearLabelKey: 'planner.occasion.year.marriedIn',
    milestoneKeys: {
      one: 'planner.occasion.milestone.anniversary',
      other: 'planner.occasion.milestone.anniversary',
    },
    celebrates: true,
    isRound: (n) => ROUND_ANNIVERSARIES.has(n),
    keywords: ['anniversary', '周年'],
    excludeIf: CELEBRATION_VETO,
  },
  occasion_birthday: {
    yearLabelKey: 'planner.occasion.year.bornIn',
    milestoneKeys: {
      one: 'planner.occasion.milestone.turns',
      other: 'planner.occasion.milestone.turns',
    },
    celebrates: true,
    isRound: (n) => n >= 30 && n % 10 === 0,
    keywords: ['birthday', 'bday', '生日'],
    excludeIf: CELEBRATION_VETO,
  },
  other_occasion: {
    yearLabelKey: 'planner.occasion.year.since',
    milestoneKeys: YEARS,
    celebrates: true,
    isRound: () => false,
    // Nothing files itself here automatically: "other" is always a deliberate pick.
    keywords: [],
  },
};

/** Is this category id an occasion? `Object.hasOwn`, never a bare index: synced data could
 *  carry a prototype key ("constructor") as its category. */
export function isOccasionCategory(id: unknown): id is OccasionCategory {
  return typeof id === 'string' && Object.hasOwn(OCCASION_TYPES, id);
}

/** The occasion types that celebrate (everything except remembrance). */
export const CELEBRATORY_OCCASIONS: OccasionCategory[] = (
  Object.keys(OCCASION_TYPES) as OccasionCategory[]
).filter((id) => OCCASION_TYPES[id].celebrates);

type OccasionFields = Pick<FamilyActivity, 'category' | 'occasionYear'>;

/** The `YYYY` of a `YYYY-MM-DD...` string, or NaN when it is not one. */
export function yearOf(ymd: unknown): number {
  if (typeof ymd !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return Number.NaN;
  return Number(ymd.slice(0, 4));
}

/**
 * How many years this occurrence marks ("turns 60" is 60), or `undefined` when there is no
 * count to show: not an occasion, no (or a malformed) year, or a count below 1.
 */
export function occasionCount(
  activity: OccasionFields | null | undefined,
  occurrenceYmd: string
): number | undefined {
  if (!activity || !isOccasionCategory(activity.category)) return undefined;
  const start = activity.occasionYear;
  if (typeof start !== 'number' || !Number.isInteger(start)) return undefined;
  const year = yearOf(occurrenceYmd);
  if (!Number.isInteger(year)) return undefined;
  const n = year - start;
  return n >= 1 ? n : undefined;
}

/**
 * The milestone words for this occurrence ("turns 60", "40th anniversary", "10 years"), or
 * `undefined` when there is no count. TOTAL: never throws, so it is safe in a render computed.
 */
export function occasionMilestone(
  activity: OccasionFields | null | undefined,
  occurrenceYmd: string,
  t: TranslateFn
): string | undefined {
  const n = occasionCount(activity, occurrenceYmd);
  if (n === undefined || !activity || !isOccasionCategory(activity.category)) return undefined;
  const keys = OCCASION_TYPES[activity.category].milestoneKeys;
  return fillTemplate(t(n === 1 ? keys.one : keys.other), {
    n,
    ordinal: getOrdinalSuffix(n),
  });
}

/**
 * The title a calendar surface shows for this occurrence: "{title} ({milestone})" for an
 * occasion with a year, the plain title otherwise. The family's own title is never reworded.
 *
 * TOTAL: a malformed year, an unknown category or a bad date returns the plain title. Not
 * used for the Google push (one series, so a year-specific age would be wrong every other
 * year) or the Nook, wall and widgets.
 */
export function activityDisplayTitle(
  activity: (OccasionFields & Pick<FamilyActivity, 'title'>) | null | undefined,
  occurrenceYmd: string,
  t: TranslateFn
): string {
  const title = typeof activity?.title === 'string' ? activity.title : '';
  const milestone = occasionMilestone(activity, occurrenceYmd, t);
  if (!milestone) return title;
  return fillTemplate(t('planner.occasion.displayTitle'), { title, milestone });
}

export type OccasionYearIssue = 'ok' | 'future' | 'too-early' | 'format';

/** The earliest year the year field accepts. */
export const OCCASION_YEAR_MIN = 1900;

/** Is a typed year usable? Four digits, not after this year, not before 1900. */
export function validateOccasionYear(year: unknown, todayYmd: string): OccasionYearIssue {
  if (typeof year !== 'number' || !Number.isInteger(year) || year < 1000 || year > 9999) {
    return 'format';
  }
  const thisYear = yearOf(todayYmd);
  if (Number.isInteger(thisYear) && year > thisYear) return 'future';
  if (year < OCCASION_YEAR_MIN) return 'too-early';
  return 'ok';
}

/**
 * The occasion type a title names, or `null`. Whole-word, case-insensitive, in
 * `OCCASION_TYPES` key order, honouring each type's `excludeIf`.
 */
export function matchOccasionCategory(text: string | null | undefined): OccasionCategory | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  for (const [id, type] of Object.entries(OCCASION_TYPES) as [OccasionCategory, OccasionType][]) {
    if (type.excludeIf?.some((phrase) => containsPhrase(text, phrase))) continue;
    if (type.keywords.some((phrase) => containsPhrase(text, phrase))) return id;
  }
  return null;
}
