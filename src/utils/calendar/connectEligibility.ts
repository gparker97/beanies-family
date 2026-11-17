// Which calendars the add step may offer for a role (view-only calendars plan
// 2026-11-17, B). Pure, so the add step and the stores' confirm guards agree.

import type { CalendarSummary } from '@/services/calendar/CalendarClient';
import type { CalendarConnection } from '@/types/models';
import { knownEmail } from './grantGuard';

/** Why a calendar cannot be chosen for syncing, or `null` when it can. */
export type SyncIneligibility = 'already-connected' | 'view-only';

/** Google access roles that cannot take beanies' events. */
const READ_ONLY_ROLES = new Set(['reader', 'freeBusyReader']);

/** Google's alias for "this account's primary calendar". */
const PRIMARY_ALIAS = 'primary';

/** What the destination rule needs to know about a sync connection. */
export type DestinationConnection = Pick<
  CalendarConnection,
  'accountEmail' | 'destinationCalendarId' | 'status'
>;

/**
 * The global Google id of a calendar named by `id` on `accountEmail`'s account, or
 * `null` when it cannot be known.
 *
 * THE ONE RULE for "is it the same calendar": Google calendar ids are global (a
 * primary calendar's id is its owner's email), so two real ids name the same
 * calendar whichever account reaches them. The alias `'primary'` (stored by
 * connections made before the destination was chosen, and the add step's single
 * fallback row when a calendar list cannot be read) names the primary calendar of
 * ITS OWN account, so it resolves to that account's email. Compared lowercased:
 * an email-shaped id is case-insensitive, and Google's other ids are lowercase.
 *
 * `null` (an alias on an account whose email is missing or `'unknown'`) matches
 * nothing. That fails OPEN, exactly as HEAD did (it had no check at all): a wrong
 * "already connected" would block the member's own calendar with no way round it,
 * while a wrong "not connected" costs a second connection that adopts the same
 * deterministic event ids (`createOrResurrect`) instead of doubling them. An
 * `'unknown'` email only happens when Google's userinfo failed at consent.
 */
export function resolveCalendarId(
  id: string | null | undefined,
  accountEmail: string | null | undefined
): string | null {
  const raw = id || PRIMARY_ALIAS;
  return raw === PRIMARY_ALIAS ? knownEmail(accountEmail) : raw.toLowerCase();
}

/** Do two connections write to the same Google calendar (see `resolveCalendarId`)? */
export function isSameDestination(
  a: Pick<CalendarConnection, 'accountEmail' | 'destinationCalendarId'>,
  b: Pick<CalendarConnection, 'accountEmail' | 'destinationCalendarId'>
): boolean {
  const x = resolveCalendarId(a.destinationCalendarId, a.accountEmail);
  return x !== null && x === resolveCalendarId(b.destinationCalendarId, b.accountEmail);
}

/**
 * Is this calendar already a LIVE sync destination?
 *
 * A connection whose status is `disconnecting` is not: its teardown is in progress
 * (or stuck on a dead grant, retried on every reconcile) and it will never push
 * again, so it must not stop the member connecting that calendar afresh. What the
 * new connection and the stuck teardown then do to each other is settled in
 * `finishDisconnect`: the teardown never deletes an event a live connection to the
 * same calendar links (both link the same deterministic event ids).
 */
function isConnectedDestination(
  calendar: CalendarSummary,
  accountEmail: string | null | undefined,
  connections: readonly DestinationConnection[]
): boolean {
  const target = resolveCalendarId(calendar.id, accountEmail);
  if (target === null) return false;
  return connections.some(
    (c) =>
      c.status !== 'disconnecting' &&
      resolveCalendarId(c.destinationCalendarId, c.accountEmail) === target
  );
}

/**
 * Can the member sync family activities to this calendar? `accountEmail` is the
 * account the calendar list came from. An absent `accessRole` is treated as one
 * the account can write, the same fail-open rule the import chooser uses.
 *
 * `viewedCalendarIds` are the Google ids of the family's view-only calendars (any
 * account): a calendar the family already views is "already connected" too.
 */
export function syncIneligibility(
  calendar: CalendarSummary,
  accountEmail: string | null | undefined,
  connections: readonly DestinationConnection[],
  viewedCalendarIds: readonly string[] = []
): SyncIneligibility | null {
  if (
    isConnectedDestination(calendar, accountEmail, connections) ||
    viewedCalendarIds.includes(calendar.id)
  ) {
    return 'already-connected';
  }
  if (calendar.accessRole && READ_ONLY_ROLES.has(calendar.accessRole)) return 'view-only';
  return null;
}

/** Why a calendar cannot be added as view only, or `null` when it can. */
export type ViewIneligibility = 'already-connected';

/**
 * Can the member add this calendar as view only? Every Google access level can be
 * viewed; the one bar is a calendar the family already has, as a sync destination
 * or as a view-only calendar on any account (Google calendar ids are global).
 */
export function viewIneligibility(
  calendar: CalendarSummary,
  accountEmail: string | null | undefined,
  connections: readonly DestinationConnection[],
  viewedCalendarIds: readonly string[]
): ViewIneligibility | null {
  return isConnectedDestination(calendar, accountEmail, connections) ||
    viewedCalendarIds.includes(calendar.id)
    ? 'already-connected'
    : null;
}
