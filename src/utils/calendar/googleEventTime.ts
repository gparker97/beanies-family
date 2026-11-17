// Google event start/end to absolute ms (#34). Pure, no imports beyond the date
// parser, so both the REST client and the pure view-only normalizer
// (`externalEvents.ts`) share ONE conversion rule.

import { parseLocalDate } from '@/utils/date';

/** The start/end shapes Google returns: `dateTime` for timed events, `date` for all-day. */
export interface GoogleEventTimeShape {
  /** Every Google item carries one; not read here. */
  id?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

/**
 * Map one `events.list` item to an absolute-ms `[startMs, endMs)`. Timed events use
 * the offset-bearing `dateTime`; all-day events use the zoneless `date` (Google's
 * `end.date` is exclusive) resolved to the local-midnight span. Returns `null` ONLY
 * for a structurally-malformed item (neither shape present); the caller decides how
 * to report it (never a silent drop).
 */
export function eventItemToMs(
  item: GoogleEventTimeShape
): { startMs: number; endMs: number } | null {
  const s = item.start;
  const e = item.end;
  if (s?.dateTime && e?.dateTime) {
    return { startMs: new Date(s.dateTime).getTime(), endMs: new Date(e.dateTime).getTime() };
  }
  if (s?.date && e?.date) {
    return { startMs: parseLocalDate(s.date).getTime(), endMs: parseLocalDate(e.date).getTime() };
  }
  return null;
}
