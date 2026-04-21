/**
 * Group an ordered list of items by a date key, preserving the caller's
 * order within each group. Returns each group once the item's date differs
 * from the previous item's date — so the caller is responsible for sorting
 * the input by date first (ascending or descending both work).
 *
 * Used by surfaces that render chronological lists with date headers
 * (activity log, upcoming activities, day agenda, schedule cards).
 */
export function groupByDate<T>(
  items: T[],
  getDate: (item: T) => string,
  formatLabel: (dateStr: string) => string
): Array<{ date: string; label: string; items: T[] }> {
  const groups: Array<{ date: string; label: string; items: T[] }> = [];
  let currentDate = '';
  for (const item of items) {
    const d = getDate(item);
    if (d !== currentDate) {
      currentDate = d;
      groups.push({ date: d, label: formatLabel(d), items: [] });
    }
    groups[groups.length - 1]!.items.push(item);
  }
  return groups;
}
