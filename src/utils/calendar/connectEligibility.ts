// Which calendars the add step may offer for a role (view-only calendars plan
// 2026-11-17, B). Pure, so the add step and the stores' confirm guards agree.

import type { CalendarSummary } from '@/services/calendar/CalendarClient';
import type { CalendarConnection, CalendarViewAccount, ViewedCalendar } from '@/types/models';
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

/**
 * Is a connection's destination its own account's primary calendar? The alias
 * `'primary'` always is (whatever the email); a real id is when it is the account's
 * email (a primary calendar's id is its owner's email).
 */
export function isAccountPrimary(
  connection: Pick<CalendarConnection, 'accountEmail' | 'destinationCalendarId'>
): boolean {
  const destination = connection.destinationCalendarId || PRIMARY_ALIAS;
  if (destination === PRIMARY_ALIAS) return true;
  const email = knownEmail(connection.accountEmail);
  return email !== null && destination.toLowerCase() === email;
}

/** Do two connections write to the same Google calendar (see `resolveCalendarId`)? */
export function isSameDestination(
  a: Pick<CalendarConnection, 'accountEmail' | 'destinationCalendarId'>,
  b: Pick<CalendarConnection, 'accountEmail' | 'destinationCalendarId'>
): boolean {
  const x = resolveCalendarId(a.destinationCalendarId, a.accountEmail);
  return x !== null && x === resolveCalendarId(b.destinationCalendarId, b.accountEmail);
}

/** What the in-use rule needs to know about a viewed calendar: its Google id and the account that views it. */
export interface ViewedCalendarRef {
  calendarId: string;
  accountEmail: string | null | undefined;
}

/** Every calendar the family already uses, as a sync destination or as a view-only calendar. */
export interface CalendarUses {
  connections: readonly DestinationConnection[];
  viewed: readonly ViewedCalendarRef[];
}

/** How a calendar is already used. */
export type CalendarUse = 'sync' | 'view';

/**
 * The viewed calendars as the in-use rule reads them: each record with its view
 * account's email (`undefined` when the account record is gone, which only matters
 * for an alias id, and a viewed calendar's id is always a real one from Google's list).
 */
export function viewedCalendarRefs(
  viewed: readonly Pick<ViewedCalendar, 'calendarId' | 'viewAccountId'>[],
  accounts: readonly Pick<CalendarViewAccount, 'id' | 'accountEmail'>[]
): ViewedCalendarRef[] {
  const emailById = new Map(accounts.map((a) => [a.id, a.accountEmail] as const));
  return viewed.map((c) => ({
    calendarId: c.calendarId,
    accountEmail: emailById.get(c.viewAccountId),
  }));
}

/**
 * THE ONE "already used" RULE: is the calendar `calendarId` on `accountEmail`'s
 * account already a LIVE sync destination (`'sync'`) or a view-only calendar of the
 * family on any account (`'view'`)? `null` when it is neither.
 *
 * Every side goes through `resolveCalendarId`, so the alias `'primary'` (a legacy
 * connection, or the add step's fallback row when a list cannot be read) matches the
 * real id of the same calendar on either side, and an alias on an account whose email
 * is unknown matches nothing (fails OPEN, see `resolveCalendarId`).
 *
 * Used by the add step's rows (through `syncIneligibility` / `viewIneligibility`),
 * by both stores' confirm guards (`confirmConnect`, `addViewedCalendar`) and by the
 * clash store's "is this viewed calendar already a source" check, so they cannot
 * disagree.
 *
 * A connection whose status is `disconnecting` is not a live destination: its
 * teardown is in progress (or stuck on a dead grant, retried on every reconcile) and
 * it will never push again, so it must not stop the member connecting that calendar
 * afresh. What the new connection and the stuck teardown then do to each other is
 * settled in `finishDisconnect`. `countDisconnecting` is for a reader that still
 * treats such a connection as live: the clash store reads EVERY connection as a busy
 * source, a disconnecting one included, so it must count it here too or one calendar
 * becomes two sources.
 */
export function calendarInUse(
  calendarId: string,
  accountEmail: string | null | undefined,
  uses: CalendarUses,
  opts: { countDisconnecting?: boolean } = {}
): CalendarUse | null {
  const target = resolveCalendarId(calendarId, accountEmail);
  if (target === null) return null;
  if (
    uses.connections.some(
      (c) =>
        (opts.countDisconnecting || c.status !== 'disconnecting') &&
        resolveCalendarId(c.destinationCalendarId, c.accountEmail) === target
    )
  ) {
    return 'sync';
  }
  if (uses.viewed.some((v) => resolveCalendarId(v.calendarId, v.accountEmail) === target)) {
    return 'view';
  }
  return null;
}

/**
 * Can the member sync family activities to this calendar? `accountEmail` is the
 * account the calendar list came from. An absent `accessRole` is treated as one
 * the account can write, the same fail-open rule the import chooser uses.
 *
 * Already used in any way (`calendarInUse`) is "already connected".
 */
export function syncIneligibility(
  calendar: CalendarSummary,
  accountEmail: string | null | undefined,
  connections: readonly DestinationConnection[],
  viewed: readonly ViewedCalendarRef[] = []
): SyncIneligibility | null {
  if (calendarInUse(calendar.id, accountEmail, { connections, viewed }) !== null) {
    return 'already-connected';
  }
  if (calendar.accessRole && READ_ONLY_ROLES.has(calendar.accessRole)) return 'view-only';
  return null;
}

/** Why a calendar cannot be added as view only, or `null` when it can. */
export type ViewIneligibility = 'already-connected';

/**
 * Can the member add this calendar as view only? Every Google access level can be
 * viewed; the one bar is a calendar the family already uses (`calendarInUse`).
 */
export function viewIneligibility(
  calendar: CalendarSummary,
  accountEmail: string | null | undefined,
  connections: readonly DestinationConnection[],
  viewed: readonly ViewedCalendarRef[]
): ViewIneligibility | null {
  return calendarInUse(calendar.id, accountEmail, { connections, viewed }) !== null
    ? 'already-connected'
    : null;
}
