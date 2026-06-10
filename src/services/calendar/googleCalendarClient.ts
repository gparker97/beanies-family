// Google Calendar REST implementation of the CalendarClient seam (#32 Layer 4).
// Fetch-based, no SDK. Maps HTTP status → classified CalendarApiError. The Google
// TokenProvider mints per-connection access tokens from the shared refresh token
// (in the CRDT), caches them in-memory, and writes back a rotated refresh token.

import {
  getCalendarConnectionById,
  updateCalendarConnection,
} from '@/services/automerge/repositories/calendarRepository';
import { refreshCalendarToken } from './calendarAuth';
import { delay, withTimeout } from '@/utils/timing';
import {
  CalendarApiError,
  type BusyInterval,
  type CalendarClient,
  type CalendarErrorKind,
  type CalendarSummary,
  type TokenProvider,
} from './CalendarClient';

const CAL_API_BASE = 'https://www.googleapis.com/calendar/v3';
const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_BACKOFF_MS = [500, 1500] as const; // → up to 3 attempts on transient/429

/** Access-token expiry skew — refresh a little early so a request never races expiry. */
const TOKEN_EXPIRY_SKEW_MS = 60_000;

function classifyStatus(status: number): CalendarErrorKind {
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404 || status === 410) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'transient';
  return 'unknown';
}

function isPermanentRefreshFailure(message: string): boolean {
  return message.includes('invalid_grant') || message.includes('expired or revoked');
}

/** Map a Google free/busy per-calendar error `reason` to a classified kind. The
 *  free/busy endpoint returns HTTP 200 even when an individual calendar fails, so
 *  this is the only place those failures surface. */
function freeBusyReasonToKind(reason: string | undefined): CalendarErrorKind {
  if (reason === 'notFound') return 'not_found';
  if (reason === 'accessDenied' || reason === 'forbidden') return 'forbidden';
  return 'unknown';
}

// ── Token provider ───────────────────────────────────────────────────────────

interface CachedToken {
  token: string;
  expiresAt: number;
}

/**
 * Google `TokenProvider`. Reads the connection's shared refresh token from the
 * CRDT, mints + caches an access token, and persists a rotated refresh token when
 * Google returns one (no silent discard — #32 Layer 2). A permanent refresh
 * failure (`invalid_grant`) surfaces as `CalendarApiError('auth')`; the reconcile
 * engine handles it WITHOUT clearing the shared token.
 */
export function createGoogleTokenProvider(): TokenProvider {
  const cache = new Map<string, CachedToken>();

  async function getAccessToken(connectionId: string): Promise<string> {
    const cached = cache.get(connectionId);
    if (cached && cached.expiresAt - TOKEN_EXPIRY_SKEW_MS > Date.now()) {
      return cached.token;
    }

    const connection = await getCalendarConnectionById(connectionId);
    if (!connection) {
      throw new CalendarApiError('unknown', `calendar connection ${connectionId} not found`);
    }

    let tokens;
    try {
      tokens = await refreshCalendarToken(connection.refreshToken);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new CalendarApiError(
        isPermanentRefreshFailure(msg) ? 'auth' : 'transient',
        `token refresh failed: ${msg}`
      );
    }

    cache.set(connectionId, {
      token: tokens.access_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    });

    // Rotation write-back (defensive — this client type is normally non-rotating).
    if (tokens.refresh_token && tokens.refresh_token !== connection.refreshToken) {
      await updateCalendarConnection(connectionId, { refreshToken: tokens.refresh_token });
    }

    return tokens.access_token;
  }

  return {
    getAccessToken,
    invalidate: (connectionId: string) => cache.delete(connectionId),
  };
}

// ── REST client ──────────────────────────────────────────────────────────────

interface RawResponse {
  status: number;
  ok: boolean;
  json: () => Promise<unknown>;
}

/**
 * Authenticated fetch with timeout + light transient retry. Maps a non-2xx
 * response to a classified `CalendarApiError`. A 401 invalidates the cached token
 * (the connection's shared refresh token is left untouched — that's the engine's
 * call). `allow` lists statuses the caller handles itself (e.g. 404, 409) so they
 * propagate as the classified error WITHOUT retry.
 */
function createAuthedFetch(tokenProvider: TokenProvider) {
  return async function authedFetch(
    connectionId: string,
    path: string,
    init: RequestInit = {}
  ): Promise<RawResponse> {
    const attempt = async (): Promise<RawResponse> => {
      const token = await tokenProvider.getAccessToken(connectionId);
      const res = await withTimeout(
        fetch(`${CAL_API_BASE}${path}`, {
          ...init,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(init.headers ?? {}),
          },
        }),
        REQUEST_TIMEOUT_MS,
        'Google Calendar request timed out'
      );
      return { status: res.status, ok: res.ok, json: () => res.json() };
    };

    let lastErr: CalendarApiError | null = null;
    let authRetried = false; // one-shot re-mint guard, outside the 429/5xx backoff budget (F4)
    for (let i = 0; i <= RETRY_BACKOFF_MS.length; i++) {
      let res: RawResponse;
      try {
        res = await attempt();
      } catch (e) {
        // Network / timeout — transient; retry within budget.
        lastErr = new CalendarApiError('transient', e instanceof Error ? e.message : String(e));
        if (i < RETRY_BACKOFF_MS.length) {
          await delay(RETRY_BACKOFF_MS[i]);
          continue;
        }
        throw lastErr;
      }

      if (res.ok) return res;

      const kind = classifyStatus(res.status);
      if (kind === 'auth') {
        tokenProvider.invalidate(connectionId);
        // A per-request 401 is usually a just-expired access token, not a dead
        // refresh token. Re-mint and retry ONCE (does not consume a backoff slot).
        // A second 401 — or invalid_grant from the refresh path — falls through and
        // throws 'auth', which parks the connection via the K-threshold. (F4)
        if (!authRetried) {
          authRetried = true;
          i--;
          continue;
        }
      }

      const err = new CalendarApiError(kind, `Google Calendar HTTP ${res.status}`, res.status);
      // Only 429 / 5xx are worth retrying; everything else is the caller's to handle.
      if ((kind === 'rate_limited' || kind === 'transient') && i < RETRY_BACKOFF_MS.length) {
        lastErr = err;
        await delay(RETRY_BACKOFF_MS[i]);
        continue;
      }
      throw err;
    }
    throw lastErr ?? new CalendarApiError('unknown', 'Google Calendar request failed');
  };
}

const enc = encodeURIComponent;

/** Build the Google `CalendarClient` over an injected `TokenProvider`. */
export function createGoogleCalendarClient(tokenProvider: TokenProvider): CalendarClient {
  const authedFetch = createAuthedFetch(tokenProvider);

  return {
    async insertEvent(connectionId, calendarId, eventId, resource) {
      await authedFetch(connectionId, `/calendars/${enc(calendarId)}/events`, {
        method: 'POST',
        body: JSON.stringify({ id: eventId, ...resource }),
      });
    },

    async patchEvent(connectionId, calendarId, eventId, resource) {
      await authedFetch(connectionId, `/calendars/${enc(calendarId)}/events/${enc(eventId)}`, {
        method: 'PATCH',
        body: JSON.stringify(resource),
      });
    },

    async deleteEvent(connectionId, calendarId, eventId) {
      try {
        await authedFetch(connectionId, `/calendars/${enc(calendarId)}/events/${enc(eventId)}`, {
          method: 'DELETE',
        });
      } catch (e) {
        // Already gone → idempotent success.
        if (e instanceof CalendarApiError && e.kind === 'not_found') return;
        throw e;
      }
    },

    async eventExists(connectionId, calendarId, eventId) {
      try {
        const res = await authedFetch(
          connectionId,
          `/calendars/${enc(calendarId)}/events/${enc(eventId)}`,
          { method: 'GET' }
        );
        // A previously-deleted event returns HTTP 200 with status 'cancelled' (Google
        // reserves the id) — treat it as missing so the engine resurrects it.
        const data = (await res.json()) as { status?: string };
        return data.status !== 'cancelled';
      } catch (e) {
        if (e instanceof CalendarApiError && e.kind === 'not_found') return false;
        throw e;
      }
    },

    async listCalendars(connectionId) {
      const res = await authedFetch(connectionId, '/users/me/calendarList', { method: 'GET' });
      const data = (await res.json()) as {
        items?: Array<{ id: string; summary?: string; primary?: boolean }>;
      };
      return (data.items ?? []).map(
        (c): CalendarSummary => ({
          id: c.id,
          summary: c.summary ?? c.id,
          primary: c.primary === true,
        })
      );
    },

    async queryFreeBusy(connectionId, calendarIds, timeMinIso, timeMaxIso) {
      const res = await authedFetch(connectionId, '/freeBusy', {
        method: 'POST',
        body: JSON.stringify({
          timeMin: timeMinIso,
          timeMax: timeMaxIso,
          items: calendarIds.map((id) => ({ id })),
        }),
      });
      const data = (await res.json()) as {
        calendars?: Record<string, { busy?: BusyInterval[]; errors?: Array<{ reason?: string }> }>;
      };
      const out: Record<string, BusyInterval[]> = {};
      for (const [calId, cal] of Object.entries(data.calendars ?? {})) {
        // Per-calendar failure arrives in the 200 body — classify + throw, never drop.
        if (cal.errors && cal.errors.length > 0) {
          const reason = cal.errors[0]?.reason;
          throw new CalendarApiError(
            freeBusyReasonToKind(reason),
            `free/busy failed for calendar ${calId}: ${reason ?? 'unknown'}`
          );
        }
        out[calId] = cal.busy ?? [];
      }
      return out;
    },
  };
}
