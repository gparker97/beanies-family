/**
 * Live flight checks (#143): the one report of a travel row that had to be skipped (it threw).
 *
 * Shared by the daily briefing (`useCriticalItems`) and the arrival list behind the arrival
 * reminder and bell entry (`useArrivalAnnouncements`), which both run the same arrival
 * decision: a malformed occurrence is reported once per segment and row, not once per surface
 * or per render. It lives here, not in `useCriticalItems.ts`, because that file imports
 * `notificationsStore`, which reads `useArrivalAnnouncements`: importing it from there would
 * close an import loop.
 */
import { reportError } from '@/utils/errorReporter';
import type { TravelSegmentOccurrence } from '@/utils/vacation';
import type { TravelRowKind } from './travelRows';

/**
 * Segments whose travel row has been reported skipped this session. The briefing is a computed
 * that re-runs often (it reads `Date.now()`), so a row that keeps throwing is reported once per
 * segment and row, not once per render. No allowlisted key exists for a segment id, so the id
 * stays in the device console (`buildTravelBriefingRows` and `arrivalAnnouncements` warn with it).
 */
const reportedTravelSkips = new Set<string>();

export function reportTravelRowSkipped(
  o: TravelSegmentOccurrence,
  err: unknown,
  row: TravelRowKind
): void {
  const key = `${o?.segmentId ?? '?'}:${row}`;
  if (reportedTravelSkips.has(key)) return;
  reportedTravelSkips.add(key);
  reportError({
    surface: 'daily-briefing',
    severity: 'warning',
    message: 'travel row skipped',
    error: err,
    context: { action: 'travel_row_skipped', detail: row },
  });
}
