// Shared CalendarClient singleton (#32 + #34).
//
// Both the sync orchestrator (calendarSyncStore — push) and the read-only clash
// orchestrator (calendarClashStore — free/busy) talk to Google through ONE
// CalendarClient instance, so they share a single per-connection access-token
// cache (the Google TokenProvider). Module-private singleton; lazily minted on
// first use, dropped on teardown.

import { createGoogleCalendarClient, createGoogleTokenProvider } from './googleCalendarClient';
import type { CalendarClient } from './CalendarClient';

let clientImpl: CalendarClient | null = null;

/** The shared client — lazily created (Google REST over the Google TokenProvider). */
export function getCalendarClient(): CalendarClient {
  if (!clientImpl) clientImpl = createGoogleCalendarClient(createGoogleTokenProvider());
  return clientImpl;
}

/** Test seam — inject a fake CalendarClient (pass `null` to clear). */
export function setCalendarClientForTesting(client: CalendarClient | null): void {
  clientImpl = client;
}

/** Drop the singleton on teardown so a new session/family mints a fresh client +
 *  token cache. Called from each store's `stop()`. */
export function resetCalendarClient(): void {
  clientImpl = null;
}
