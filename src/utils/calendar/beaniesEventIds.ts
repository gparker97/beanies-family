// The Google event ids beanies itself put on a calendar (view-only calendars plan
// 2026-11-17, A4). Pure.
//
// Two sources, because neither alone is complete:
//  - the DETERMINISTIC id of every activity (`deterministicEventId`), which is what
//    a push inserts, so an event is recognised even before its link has synced;
//  - every `calendarEventLinks.googleEventId`, which is where an ADOPTED event (the
//    family's own event, patched in place by the one-time import) or an EXTERNAL
//    imported event really lives. Its id is Google's, not derived, so the first
//    source never matches it.
//
// Used by the clash nudge (so an activity never clashes with its own pushed copy)
// and by the view-only store (so a calendar shown view only never doubles an event
// beanies already shows as an activity). An exception link's id is a Google
// INSTANCE id of a series beanies pushed, which is beanies-origin too.

import { deterministicEventId } from './deterministicEventId';
import type { CalendarEventLink } from '@/types/models';

/**
 * Every Google event id that is beanies-origin for these activities and links.
 *
 * `deterministicEventId` throws on a blank or corrupt activity id. That id is
 * skipped (it cannot match any event) and handed to `onInvalid`, so the caller can
 * report it; this function stays free of any reporter.
 */
export function beaniesEventIds(
  activityIds: Iterable<string>,
  eventLinks: Iterable<Pick<CalendarEventLink, 'googleEventId'>>,
  onInvalid?: (activityId: string, error: unknown) => void
): Set<string> {
  const ids = new Set<string>();
  for (const activityId of activityIds) {
    try {
      ids.add(deterministicEventId(activityId));
    } catch (e) {
      onInvalid?.(activityId, e);
    }
  }
  for (const link of eventLinks) {
    if (link.googleEventId) ids.add(link.googleEventId);
  }
  return ids;
}
