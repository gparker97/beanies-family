// The calendar redirect's resume intent, carried in the return path's `calResume`
// query and deliberately never in the OAuth `state` (no id or secret rides there).
//
// One encoder and one parser, so the store that starts a redirect and the App-level
// resume that finishes it cannot disagree about what came back.
//
// Wire format. The sync values are unchanged since redirect auth shipped, so a
// redirect started on an older build still resumes:
//  - `connect`           a fresh sync connect;
//  - `<connectionId>`    a sync reconnect (any value that is not one of the others);
//  - `view`              a fresh view-only consent (plan 2026-11-17, A2);
//  - `view:<accountId>`  a view-only account reconnect.
// A connection id is a UUID, so it can never be `view` or start with `view:`.

import { CALENDAR_SYNC_OPEN } from '@/constants/settingsDeepLinks';

export type CalendarResumeIntent =
  | { kind: 'connect' }
  | { kind: 'reconnect'; connectionId: string }
  | { kind: 'view-connect' }
  | { kind: 'view-reconnect'; accountId: string };

const CONNECT = 'connect';
const VIEW = 'view';
const VIEW_PREFIX = 'view:';

export function encodeCalendarResumeIntent(intent: CalendarResumeIntent): string {
  switch (intent.kind) {
    case 'connect':
      return CONNECT;
    case 'reconnect':
      return intent.connectionId;
    case 'view-connect':
      return VIEW;
    case 'view-reconnect':
      return `${VIEW_PREFIX}${intent.accountId}`;
  }
}

export function parseCalendarResumeIntent(raw: string): CalendarResumeIntent {
  if (raw === CONNECT) return { kind: 'connect' };
  if (raw === VIEW) return { kind: 'view-connect' };
  if (raw.startsWith(VIEW_PREFIX) && raw.length > VIEW_PREFIX.length) {
    return { kind: 'view-reconnect', accountId: raw.slice(VIEW_PREFIX.length) };
  }
  return { kind: 'reconnect', connectionId: raw };
}

/** Is this intent a view-only consent (the view store's to finish, never the sync store's)? */
export function isViewResumeIntent(
  intent: CalendarResumeIntent
): intent is Extract<CalendarResumeIntent, { kind: 'view-connect' | 'view-reconnect' }> {
  return intent.kind === 'view-connect' || intent.kind === 'view-reconnect';
}

/**
 * The same-origin returnPath a calendar redirect lands on: it reopens the Calendar
 * settings drawer and carries the intent in `calResume`. Shared by the sync and
 * view-only stores so both build it one way.
 */
export function calendarReturnPath(intent: CalendarResumeIntent): string {
  const params = new URLSearchParams({
    open: CALENDAR_SYNC_OPEN,
    calResume: encodeCalendarResumeIntent(intent),
  });
  return `/settings?${params.toString()}`;
}
