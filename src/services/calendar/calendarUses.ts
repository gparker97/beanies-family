// Every calendar the family already uses, read from the doc (view-only calendars
// plan 2026-11-17, B). The input to `calendarInUse`, gathered in ONE place so the
// add step's rows and both stores' confirm guards read the same records.
//
// Read straight from the projection, never through the other store: the sync store
// and the view store never import each other (the same arrangement as
// `guardedRevoke.ts`). The view collections are read whatever the
// `viewOnlyCalendars` flag says on this device: a calendar another device views is
// still in use, and reading it starts no poll, fetch or write.

import { isDocLoaded } from '@/services/automerge/docService';
import { list as projectionList } from '@/services/automerge/projection';
import { viewedCalendarRefs, type CalendarUses } from '@/utils/calendar/connectEligibility';

/**
 * The family's sync connections and viewed calendars right now. Empty before the doc
 * loads, which fails OPEN (nothing reads as already used), the rule's documented
 * direction for an uncertainty.
 */
export function readCalendarUses(): CalendarUses {
  if (!isDocLoaded()) return { connections: [], viewed: [] };
  return {
    connections: projectionList('calendarConnections'),
    viewed: viewedCalendarRefs(
      projectionList('viewedCalendars'),
      projectionList('calendarViewAccounts')
    ),
  };
}
