/**
 * The family timeline: scrapbook entries newest first, grouped by month.
 *
 * Pure, so the two rules that are easy to get quietly wrong are pinned in
 * `scrapbookTimeline.test.ts` without mounting anything:
 *
 *  - **Local time, one key.** Favorites, sayings and notes carry a UTC
 *    `createdAt`; milestones carry a date-only `occurredOn`. Every entry is
 *    reduced to ONE local `YYYY-MM-DDTHH:mm` key that drives both the sort and
 *    the month. Sorting the raw strings instead would put `2026-10-31T23:00Z`
 *    (1 Nov in Singapore) below a date-only `2026-11-01` and split November in
 *    two; slicing the raw timestamp would file it under October.
 *  - **Empty `types` means nothing.** The feed treats an empty set as "all",
 *    which is right for the spreads and wrong for a wall whose four switches are
 *    all off. This function owns the type filter and returns `[]` for an empty set.
 */
import { isRealYmd, toDateInputValue, toTimeInputValue } from '@/utils/date';
import { reportError } from '@/utils/errorReporter';
import type { ScrapbookEntry, ScrapType } from '@/composables/useScrapbookFeed';
import type { SayingItem, UUID } from '@/types/models';

export interface TimelineMonth {
  /** `YYYY-MM`, local time. Unique within one timeline. */
  key: string;
  year: number;
  /** 0-based, ready for `new Date(year, monthIndex)` and `formatMonthYear`. */
  monthIndex: number;
  /** Newest first. */
  entries: ScrapbookEntry[];
}

export interface ScrapbookTimelineOptions {
  /** `null` keeps everyone; a bean id keeps that bean's entries plus whole-family ones. */
  memberId: UUID | null;
  /** The enabled types. Empty returns `[]`, NOT everything (see the file comment). */
  types: ReadonlySet<ScrapType>;
}

// One report per entry id: the timeline is a computed that re-runs on every
// store reload, and a wall stays open for weeks. Module-scoped for the same
// reason as `ScrapbookEntryCard`'s unknown-type set.
const reportedUnparseable = new Set<string>();

/** A stored date or timestamp as a local `YYYY-MM-DDTHH:mm`, or `null`. */
function localKey(value: string): string | null {
  // Date-only values are already local days. `new Date('2026-11-01')` reads them
  // as UTC midnight, which west of UTC is the previous evening.
  if (value.length === 10) return isRealYmd(value) ? `${value}T00:00` : null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // Outside four digits the fixed-width slicing of the key breaks; no real memory lives there.
  const year = d.getFullYear();
  if (year < 1000 || year > 9999) return null;
  return `${toDateInputValue(d)}T${toTimeInputValue(d)}`;
}

function sourceDate(entry: ScrapbookEntry): string {
  switch (entry.type) {
    case 'milestone':
      // The feed already ran `safeOccurredOn` for this one, and that reports on
      // every call, so it is not run again here.
      return entry.effectiveDate;
    case 'saying': {
      const saidOn = (entry.payload as SayingItem).saidOn;
      // A missing or malformed `saidOn` falls back to when the saying was written
      // down. `safeOccurredOn` is deliberately not used: it reports on every call,
      // and this runs on every recompute for the weeks a wall stays open.
      return saidOn && isRealYmd(saidOn) ? saidOn : entry.createdAt;
    }
    default:
      return entry.createdAt;
  }
}

/**
 * The entry's local sort key, `YYYY-MM-DDTHH:mm` (a date-only value gets
 * `T00:00`), or `null` when its date cannot be read. A `null` entry is left out
 * of the timeline rather than bucketed as `NaN-NaN`, and reported once.
 */
export function timelineKeyOf(entry: ScrapbookEntry): string | null {
  const key = localKey(sourceDate(entry));
  if (key === null && !reportedUnparseable.has(entry.id)) {
    reportedUnparseable.add(entry.id);
    console.warn('[scrapbookTimeline] skipping entry with unparseable date', entry.id);
    reportError({
      surface: 'scrapbook',
      message: 'scrapbook timeline entry has an unparseable date',
      severity: 'warning',
      context: { kind: entry.type, stage: 'timeline-key' },
    });
  }
  return key;
}

/** The family timeline, newest month first. */
export function buildScrapbookTimeline(
  entries: readonly ScrapbookEntry[],
  { memberId, types }: ScrapbookTimelineOptions
): TimelineMonth[] {
  if (types.size === 0) return [];

  const keyed: { entry: ScrapbookEntry; key: string }[] = [];
  for (const entry of entries) {
    if (!types.has(entry.type)) continue;
    // `== null` on purpose: a whole-family moment may carry `null` or no field at all.
    if (memberId !== null && entry.memberId != null && entry.memberId !== memberId) continue;
    const key = timelineKeyOf(entry);
    if (key !== null) keyed.push({ entry, key });
  }

  // Newest first; `id` breaks ties so two entries on the same minute never swap
  // places between recomputes.
  keyed.sort((a, b) => {
    if (a.key !== b.key) return a.key < b.key ? 1 : -1;
    if (a.entry.id === b.entry.id) return 0;
    return a.entry.id < b.entry.id ? -1 : 1;
  });

  // Insertion order of the Map follows the sort, so the months come out newest first too.
  const months = new Map<string, TimelineMonth>();
  for (const { entry, key } of keyed) {
    const monthKey = key.slice(0, 7);
    let month = months.get(monthKey);
    if (!month) {
      month = {
        key: monthKey,
        year: Number(monthKey.slice(0, 4)),
        monthIndex: Number(monthKey.slice(5, 7)) - 1,
        entries: [],
      };
      months.set(monthKey, month);
    }
    month.entries.push(entry);
  }
  return [...months.values()];
}
