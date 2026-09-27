import { diffPayload } from '@/utils/diffPayload';

type RescheduleFields = Record<string, string | undefined>;

/**
 * What a reschedule actually changes: the diff of the pane's fields against the
 * occurrence it started from, with one rule on top.
 *
 * The pane SHOWS the end date of an all-day event. When the start moves, the end
 * on screen is the intent even if the person left it alone; dropping it as
 * "unchanged" would let the store's span rule shift it (a Fri-Sun weekend moved
 * to Saturday would become Sat-Mon, not the Sat-Sun shown).
 */
export function rescheduleDelta(
  base: RescheduleFields,
  next: RescheduleFields,
  allDay: boolean
): RescheduleFields {
  const delta = diffPayload(base, next) as RescheduleFields;
  if (allDay && 'date' in delta) delta.endDate = next.endDate;
  return delta;
}
