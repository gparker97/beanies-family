/**
 * WHO OWNS a linked Google event, and therefore what beanies may do to it.
 *
 * Before the one-time import (#94) the answer was always "beanies made it", so
 * the question never had to be asked: every `CalendarEventLink` pointed at an
 * event beanies had inserted under a `deterministicEventId`. The import breaks
 * that, because it links activities to events the family already had.
 *
 * These predicates are the ONLY sanctioned way to read `link.origin`. Do not
 * branch on the raw value at a call site: four sites each testing an optional
 * string literal is a rule that decays the first time a fifth is added, and the
 * fifth one here would delete a family's real Google events.
 */

import type { CalendarEventLink } from '@/types/models';
import type { PushHashContext } from './activityToGoogleEvent';

/**
 * May beanies DELETE this event from Google?
 *
 * Only events beanies created. This is the data-loss guard: a link with any
 * `origin` points at an event that existed before beanies touched it, so the
 * most beanies may ever do is forget about it (unlink). Reconcile, disconnect
 * and a destination-calendar switch all go through this.
 */
export function beaniesMayDelete(link: CalendarEventLink): boolean {
  return link.origin === undefined;
}

/**
 * May beanies WRITE to this event (insert, patch, or except an instance)?
 *
 * Everything except an invitee's event. `'adopted'` events ARE written to: that
 * is the whole point of adopting them, and the push patches the original in
 * place rather than inserting a second copy. `'external'` events are someone
 * else's, or live on a calendar this connection does not write to, so beanies
 * never writes them at all.
 */
export function beaniesMayPush(link: CalendarEventLink): boolean {
  return link.origin !== 'external';
}

/**
 * Does this link's push hash fold the family's home time zone?
 *
 * Only for events beanies created (or will create: no link yet). An ADOPTED event
 * gets its full beanies body on any hash change, which replaces the family's own
 * description and RRULE and clears their Google reminders, so a reason-less zone
 * fold would rewrite every imported event the day `homeTimeZone` is persisted. It
 * keeps the zone its author gave it in Google until the activity is next edited in
 * beanies, when the push stamps the home zone. `'external'` events are never pushed,
 * so folding there would only churn a hash nothing reads.
 *
 * For an EXCEPTION, pass the MASTER's link: the instance belongs to the master's
 * event, whoever owns the override child.
 */
export function hashFoldsHomeZone(link?: Pick<CalendarEventLink, 'origin'>): boolean {
  return !link || link.origin === undefined;
}

/** The push-hash context for ONE link (see `hashFoldsHomeZone`). The single rule both
 *  `planReconcile` and the import commit use, so the hash import records always equals
 *  the one the next reconcile computes. */
export function pushHashContextForLink<T extends PushHashContext>(
  ctx: T,
  link?: Pick<CalendarEventLink, 'origin'>
): T {
  return hashFoldsHomeZone(link) ? ctx : { ...ctx, hashZone: '' };
}
