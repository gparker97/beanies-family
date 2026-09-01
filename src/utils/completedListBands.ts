/**
 * Group filed lists into recency bands for the completed shelf.
 *
 * A recurring chore list files a copy every cycle, so "completed" is the shelf that grows
 * without limit while every other one stays roughly the same size. A flat, sorted wall of
 * near-identical tiles is unreadable at ten entries and useless at two hundred: the parent
 * looking back at last week's chores needs to land on last week, not scroll to it.
 *
 * Bands are relative to today and coarsen with age — this week, last week, then whole
 * months — because recent history is read by day and old history by month.
 *
 * Pure: takes the lists and today's date, returns bands. No store, no clock, so the
 * boundaries are testable rather than only observable in December.
 */
import type { FamilyList } from '@/types/models';
import { extractDatePart } from '@/utils/date';

export interface Band<T> {
  /** Stable key for `v-for`. */
  key: string;
  /**
   * Either a translation key (the two relative bands) or a ready-made month label.
   * `isLabelKey` says which, so the caller knows whether to run it through `t()`.
   */
  label: string;
  isLabelKey: boolean;
  items: T[];
}

/**
 * When a list was filed. Falls back to `updatedAt`, matching the store's own sort.
 *
 * `extractDatePart`, not `.slice(0, 10)`: both timestamps are UTC ISO strings while every
 * band boundary below is derived from the LOCAL `todayYmd`. Slicing would file a list
 * completed at 20:00 on a Sunday in New York under the following Monday, i.e. one band too
 * recent, for every family west of UTC.
 */
function filedAt(list: FamilyList): string {
  return extractDatePart(list.completedAt ?? list.updatedAt ?? '');
}

/** Monday-anchored start of the week containing `ymd`, as a ymd string. */
function startOfWeek(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00`);
  // getDay(): 0 = Sunday. Shift so Monday is the anchor.
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return toYmd(d);
}

function toYmd(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toYmd(d);
}

/**
 * `locale` is passed in, not left to the browser. The relative bands beside these ones are
 * rendered through `t()`, so a Chinese-language family reading a shelf headed 「本周」
 * followed by "August 2026" would be seeing two languages in one column of labels. The
 * browser's own locale is the fallback, which is what an omitted argument means.
 */
function monthLabel(ymd: string, locale?: string): string {
  return new Date(`${ymd}T00:00:00`).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Bands, newest first. Lists keep the order they arrive in, so the caller's sort (the
 * store already sorts by completion, newest first) is preserved inside each band.
 *
 * Anything with no usable date lands in a final "earlier" band rather than being dropped —
 * losing a list because a timestamp is missing would be worse than filing it vaguely.
 */
export function groupByRecency<T>(
  items: readonly T[],
  todayYmd: string,
  whenOf: (item: T) => string,
  locale?: string
): Band<T>[] {
  const thisWeekStart = startOfWeek(todayYmd);
  const lastWeekStart = addDays(thisWeekStart, -7);

  const bands: Band<T>[] = [];
  const byKey = new Map<string, Band<T>>();

  const push = (key: string, label: string, isLabelKey: boolean, item: T) => {
    let band = byKey.get(key);
    if (!band) {
      band = { key, label, isLabelKey, items: [] };
      byKey.set(key, band);
      bands.push(band);
    }
    band.items.push(item);
  };

  for (const item of items) {
    const when = whenOf(item);
    if (!when) {
      push('undated', 'lists.completed.earlier', true, item);
      continue;
    }
    if (when >= thisWeekStart) {
      push('this-week', 'lists.completed.thisWeek', true, item);
    } else if (when >= lastWeekStart) {
      push('last-week', 'lists.completed.lastWeek', true, item);
    } else {
      // Month granularity from here down: older history is browsed by month, not by day.
      push(when.slice(0, 7), monthLabel(when, locale), false, item);
    }
  }

  // The undated band is a catch-all, so it belongs last however the input was ordered.
  const undated = bands.findIndex((b) => b.key === 'undated');
  if (undated !== -1) bands.push(...bands.splice(undated, 1));
  return bands;
}

/**
 * The completed-lists shelf, unchanged. A one-line alias over the generic form so
 * `ListShelf`, `BeanieListsPage` and their tests keep working exactly as before.
 */
export function groupCompletedByRecency(
  lists: readonly FamilyList[],
  todayYmd: string,
  locale?: string
): Band<FamilyList>[] {
  return groupByRecency(lists, todayYmd, filedAt, locale);
}
