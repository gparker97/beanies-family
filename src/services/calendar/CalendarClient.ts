// Provider-agnostic calendar client seam (#32 Layer 4).
//
// The reconcile engine (Layer 5) depends ONLY on these interfaces — never on the
// Google REST impl or its types — so it's unit-testable with a fake and Outlook /
// Apple remain a real future seam. Token acquisition sits behind `TokenProvider`,
// so the engine never mints tokens or imports Google auth specifics.

import type { GoogleEventResource } from '@/utils/calendar/activityToGoogleEvent';

/**
 * A partial-field patch for a single event/instance. Widens `GoogleEventResource`'s
 * `status` (a `'confirmed'` literal) so a per-occurrence exception can `cancel` an
 * instance (`{status:'cancelled'}`) without casting. All fields optional — send only
 * what changes.
 */
export type GoogleEventPatch = Partial<Omit<GoogleEventResource, 'status'>> & {
  status?: 'confirmed' | 'cancelled';
};

/**
 * One expanded instance of a Google recurring event (from `events.instances`).
 * `originalStartTime` anchors the instance to the master's generated slot (it does
 * NOT move when the instance is rescheduled) — the reconcile matches on it to find
 * the instance for a beanies override's occurrence date. `id` is the instance id
 * (an event id in its own right — patchable/cancellable via `patchEventFields`).
 */
export interface CalendarInstance {
  id: string;
  status?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  originalStartTime?: { date?: string; dateTime?: string };
}

/** Classified failure kind — each drives a distinct reconcile path (#32 Layer 4). */
export type CalendarErrorKind =
  | 'auth' // 401 / invalid_grant → needs_reconnect (NEVER auto-clears the shared token)
  | 'forbidden' // 403 → permission / dropped granular scope
  | 'not_found' // 404 / 410 → missing remote event → re-create path
  | 'conflict' // 409 → event already exists → patch path
  | 'rate_limited' // 429 → transient, back off
  | 'transient' // 5xx / network → transient, back off
  | 'invalid' // 400 → Google rejected the request body/params — deterministic, never retryable
  | 'unknown';

/** A classified calendar API error. Carries the kind the engine branches on. */
export class CalendarApiError extends Error {
  readonly kind: CalendarErrorKind;
  readonly status?: number;
  constructor(kind: CalendarErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'CalendarApiError';
    this.kind = kind;
    this.status = status;
  }
}

/** Minimal calendar metadata for the destination picker. */
export interface CalendarSummary {
  id: string;
  summary: string;
  primary: boolean;
}

/**
 * A single external event's time window — TIMES ONLY. The `events.list` read uses
 * a `fields` mask that omits summary/description/location/attendees, so event
 * content never crosses the wire. `transparent` reflects `transparency: 'transparent'`
 * (the owner marked the event "free", not busy). The `id` / `recurringEventId` are
 * opaque identifiers used solely to exclude beanies' OWN synced events from clash
 * detection — never displayed, persisted, or sent anywhere. (#34) */
export interface EventTime {
  /** Per-instance id (an expanded recurring instance has its own id). */
  id: string;
  /** For an expanded recurring instance, the master event id; else undefined. */
  recurringEventId?: string;
  /** Absolute start/end in ms (timed: from `dateTime`; all-day: local-midnight span). */
  startMs: number;
  endMs: number;
  /** `transparency === 'transparent'` → owner marked it "free", not busy. */
  transparent: boolean;
}

/**
 * Mints short-lived access tokens per connection. The Google impl reads the
 * connection's refresh token from the CRDT, refreshes via the OAuth proxy, caches
 * the access token, and writes back a rotated refresh token (never silent). A
 * permanent refresh failure (`invalid_grant`) surfaces as `CalendarApiError('auth')`.
 */
export interface TokenProvider {
  getAccessToken(connectionId: string): Promise<string>;
  /** Drop any cached access token for a connection (e.g. after disconnect / reconnect). */
  invalidate(connectionId: string): void;
}

/**
 * The operations the reconcile engine performs. All take a `connectionId` and
 * resolve a token internally via the injected `TokenProvider`. Errors are thrown
 * as `CalendarApiError` (classified); `deleteEvent` and `eventExists` treat a
 * missing remote event idempotently rather than throwing.
 */
export interface CalendarClient {
  /**
   * Drop every cached token decision for a connection: the access token, any
   * in-flight refresh, and — critically — the latched permanent-failure state.
   *
   * MUST be called after a successful reconnect. The Google provider latches an
   * `invalid_grant` so a dead grant stops hammering the OAuth proxy; that latch
   * survives for the session and only this clears it. Skip the call and calendar
   * sync stays dead until a page reload, even after the user re-consents.
   */
  invalidateConnection(connectionId: string): void;

  /** Insert with a caller-supplied event id. Throws `conflict` if the id already exists. */
  insertEvent(
    connectionId: string,
    calendarId: string,
    eventId: string,
    resource: GoogleEventResource
  ): Promise<void>;
  /** Patch an existing event (also restores manual edits). */
  patchEvent(
    connectionId: string,
    calendarId: string,
    eventId: string,
    resource: GoogleEventResource
  ): Promise<void>;
  /**
   * Patch selected fields of an event/instance. Same wire call as `patchEvent`, but
   * accepts a partial body with a widened `status` — used to CANCEL a single
   * recurring instance (`{status:'cancelled'}`) or RESTORE it (`{status:'confirmed',
   * …master body}`). `eventId` may be a Google instance id. Throws classified
   * `CalendarApiError` (a caller treats `not_found` on a cancel/restore as already-gone).
   */
  patchEventFields(
    connectionId: string,
    calendarId: string,
    eventId: string,
    patch: GoogleEventPatch
  ): Promise<void>;
  /**
   * List the concrete instances of a recurring MASTER event over `[timeMinIso,
   * timeMaxIso)` (`events.instances`). Used to DISCOVER the instance id for a
   * beanies override's occurrence (once — the id is then stored + reused). Throws
   * `not_found` if the master isn't on Google yet (caller treats as benign-skip).
   */
  listInstances(
    connectionId: string,
    calendarId: string,
    masterEventId: string,
    timeMinIso: string,
    timeMaxIso: string
  ): Promise<CalendarInstance[]>;
  /** Delete an event. A missing event (404/410) resolves silently (idempotent). */
  deleteEvent(connectionId: string, calendarId: string, eventId: string): Promise<void>;
  /** Whether the event still exists remotely (404/410 → false) — remote-delete detection. */
  eventExists(connectionId: string, calendarId: string, eventId: string): Promise<boolean>;
  /** List the account's calendars for the destination picker. */
  listCalendars(connectionId: string): Promise<CalendarSummary[]>;
  /**
   * List event TIMES on one calendar over `[timeMinIso, timeMaxIso)`. Read-only,
   * times only — the impl uses a `fields` mask so event content (title/notes/
   * location/attendees) never returns. Recurring events are expanded into concrete
   * instances (`singleEvents=true`), cancelled events excluded. Errors are thrown as
   * classified `CalendarApiError` via the shared `authedFetch`. (#34)
   */
  listEventTimes(
    connectionId: string,
    calendarId: string,
    timeMinIso: string,
    timeMaxIso: string
  ): Promise<EventTime[]>;
}
