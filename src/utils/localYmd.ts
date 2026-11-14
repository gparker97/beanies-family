/**
 * Local calendar-day helpers with NO imports, so any pure module can use them (`utils/chores.ts`
 * is imported by stores and constants; reaching `utils/date.ts` from there formed an import
 * cycle through the error reporter). `utils/date.ts` re-exports both, so every other call site
 * imports them from there as before.
 */

/** Format a date for HTML date input (YYYY-MM-DD), in local time. */
export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const monthStr = month < 10 ? `0${month}` : `${month}`;
  const dayStr = day < 10 ? `0${day}` : `${day}`;
  return `${year}-${monthStr}-${dayStr}`;
}

/**
 * The LOCAL `YYYY-MM-DD` an ISO timestamp falls on (a bare `YYYY-MM-DD` passes through), or ''
 * when it does not parse, so a bad value never compares as a real date. The one rule for "which
 * local day was this written on" (the choreboard's day records, the responsibility deck).
 */
export function localYmdOf(iso: string | undefined | null): string {
  if (!iso) return '';
  if (iso.length === 10) return iso;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : toDateInputValue(d);
}
