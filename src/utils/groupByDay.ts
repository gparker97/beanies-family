/**
 * Groups rows into runs of the same day, in input order.
 *
 * The grouping is CONSECUTIVE, not global: a new group starts whenever a row's day
 * differs from the previous row's, so rows are never reordered. Callers pass rows
 * already sorted by date (the calendar and statement import stores both do), which
 * makes this equivalent to a per-day bucket; unsorted input yields one group per
 * run, so the same day can appear twice.
 */
export function groupByDay<T>(
  rows: readonly T[],
  getYmd: (r: T) => string
): { ymd: string; rows: T[] }[] {
  const groups: { ymd: string; rows: T[] }[] = [];
  for (const row of rows) {
    const ymd = getYmd(row);
    const last = groups[groups.length - 1];
    if (last && last.ymd === ymd) last.rows.push(row);
    else groups.push({ ymd, rows: [row] });
  }
  return groups;
}
