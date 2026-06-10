// Provider-agnostic calendar client seam (#32 Layer 4).
//
// The reconcile engine (Layer 5) depends ONLY on these interfaces — never on the
// Google REST impl or its types — so it's unit-testable with a fake and Outlook /
// Apple remain a real future seam. Token acquisition sits behind `TokenProvider`,
// so the engine never mints tokens or imports Google auth specifics.

import type { GoogleEventResource } from '@/utils/calendar/activityToGoogleEvent';

/** Classified failure kind — each drives a distinct reconcile path (#32 Layer 4). */
export type CalendarErrorKind =
  | 'auth' // 401 / invalid_grant → needs_reconnect (NEVER auto-clears the shared token)
  | 'forbidden' // 403 → permission / dropped granular scope
  | 'not_found' // 404 / 410 → missing remote event → re-create path
  | 'conflict' // 409 → event already exists → patch path
  | 'rate_limited' // 429 → transient, back off
  | 'transient' // 5xx / network → transient, back off
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
  /** Delete an event. A missing event (404/410) resolves silently (idempotent). */
  deleteEvent(connectionId: string, calendarId: string, eventId: string): Promise<void>;
  /** Whether the event still exists remotely (404/410 → false) — remote-delete detection. */
  eventExists(connectionId: string, calendarId: string, eventId: string): Promise<boolean>;
  /** List the account's calendars for the destination picker. */
  listCalendars(connectionId: string): Promise<CalendarSummary[]>;
}
