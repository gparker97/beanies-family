// Google Calendar REST implementation of the CalendarClient seam (#32 Layer 4).
// Fetch-based, no SDK. Maps HTTP status → classified CalendarApiError. The Google
// TokenProvider mints per-connection access tokens from the shared refresh token
// (in the CRDT), caches them in-memory, and writes back a rotated refresh token.

import {
  getCalendarConnectionById,
  updateCalendarConnection,
} from '@/services/automerge/repositories/calendarRepository';
import { refreshCalendarToken } from './calendarAuth';
import { isPermanentRefreshFailure } from '@/services/google/refreshFailure';
import { delay, withTimeout } from '@/utils/timing';
import { parseLocalDate } from '@/utils/date';
import {
  CalendarApiError,
  type CalendarClient,
  type CalendarErrorKind,
  type CalendarInstance,
  type CalendarSummary,
  type EventTime,
  type GoogleEventPatch,
  type TokenProvider,
} from './CalendarClient';

const CAL_API_BASE = 'https://www.googleapis.com/calendar/v3';
const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_BACKOFF_MS = [500, 1500] as const; // → up to 3 attempts on transient/429
/** Safety cap on event-list paging: 20 × 250 = 5000 events >> any ≤42-day window.
 *  Structural guard against a non-terminating nextPageToken — never fires in practice. */
const MAX_EVENT_PAGES = 20;

/** Access-token expiry skew — refresh a little early so a request never races expiry. */
const TOKEN_EXPIRY_SKEW_MS = 60_000;

function classifyStatus(status: number): CalendarErrorKind {
  if (status === 400) return 'invalid';
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404 || status === 410) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'transient';
  return 'unknown';
}

/** Kinds worth retrying within the backoff budget; every other kind is terminal
 *  and must propagate with its true kind (notably 'auth' → parks needs_reconnect). */
function isRetryableKind(kind: CalendarErrorKind): boolean {
  return kind === 'rate_limited' || kind === 'transient';
}

/** One `events.list` item, restricted to the masked fields (times-only read). */
interface GoogleEventTimeItem {
  id: string;
  recurringEventId?: string;
  status?: string;
  transparency?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

/**
 * Map one masked `events.list` item to an absolute-ms `[startMs, endMs)`. Timed
 * events use the offset-bearing `dateTime`; all-day events use the zoneless `date`
 * (Google's `end.date` is exclusive) resolved to the local-midnight span. Returns
 * `null` ONLY for a structurally-malformed item (neither shape present) — the
 * caller turns that into a `console.warn` (never a silent drop). Pure. (#34)
 */
export function eventItemToMs(
  item: GoogleEventTimeItem
): { startMs: number; endMs: number } | null {
  const s = item.start;
  const e = item.end;
  if (s?.dateTime && e?.dateTime) {
    return { startMs: new Date(s.dateTime).getTime(), endMs: new Date(e.dateTime).getTime() };
  }
  if (s?.date && e?.date) {
    return { startMs: parseLocalDate(s.date).getTime(), endMs: parseLocalDate(e.date).getTime() };
  }
  return null;
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
 *
 * Three per-connection maps guard the OAuth proxy, all keyed on `connectionId`,
 * all cleared together by `invalidate()`, and all discarded wholesale when
 * `resetCalendarClient()` drops this closure:
 *
 *  - `cache`    — a live access token (the happy path).
 *  - `inflight` — one shared refresh promise, so N concurrent callers make ONE
 *                 network call instead of N.
 *  - `dead`     — a latched permanent failure, so once Google says the refresh
 *                 token is revoked we stop asking. Transient failures are never
 *                 latched; they must stay retryable.
 *
 * Without `inflight` + `dead`, a single dead grant produced HUNDREDS of
 * `POST /oauth/google/refresh` 400s per page load — every queued calendar op
 * (`eventExists`, `insertEvent`, `deleteEvent`) independently re-asked Google
 * about the same dead token (observed in prod, 2026-07-09). `googleAuth` has
 * had the equivalent protection (`pendingSilentRefresh` + permanent
 * short-circuit) all along; this brings the calendar client up to parity.
 */
export function createGoogleTokenProvider(): TokenProvider {
  const cache = new Map<string, CachedToken>();
  const inflight = new Map<string, Promise<string>>();
  const dead = new Map<string, CalendarApiError>();

  /** Mint a fresh access token. One caller at a time per connection. */
  async function mintAccessToken(connectionId: string): Promise<string> {
    const connection = await getCalendarConnectionById(connectionId);
    if (!connection) {
      throw new CalendarApiError('unknown', `calendar connection ${connectionId} not found`);
    }

    let tokens;
    try {
      tokens = await refreshCalendarToken(connection.refreshToken);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const permanent = isPermanentRefreshFailure(msg);
      const classified = new CalendarApiError(
        permanent ? 'auth' : 'transient',
        `token refresh failed: ${msg}`
      );
      // Latch ONLY permanent failures. A transient (network, 5xx, timeout) must
      // remain retryable on the next poll, or a brief outage would look like a
      // revocation and strand the connection until reconnect.
      if (permanent) dead.set(connectionId, classified);
      throw classified;
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

  async function getAccessToken(connectionId: string): Promise<string> {
    const cached = cache.get(connectionId);
    if (cached && cached.expiresAt - TOKEN_EXPIRY_SKEW_MS > Date.now()) {
      return cached.token;
    }

    // Fast-fail a known-dead grant without touching the network. Never silent:
    // the original classified error is re-thrown (so the reconcile engine still
    // routes `auth` → `needs_reconnect`) and the short-circuit is logged.
    const latched = dead.get(connectionId);
    if (latched) {
      console.warn(
        `[googleCalendarClient] skipping token refresh for ${connectionId} — ` +
          `refresh token permanently rejected this session (${latched.message}). ` +
          `Reconnect the calendar connection to clear this.`
      );
      throw latched;
    }

    // Coalesce concurrent callers onto one refresh.
    const pending = inflight.get(connectionId);
    if (pending) return pending;

    const promise = mintAccessToken(connectionId).finally(() => {
      inflight.delete(connectionId);
    });
    inflight.set(connectionId, promise);
    return promise;
  }

  return {
    getAccessToken,
    /**
     * Drop every cached decision for a connection. Called on a 401 (stale access
     * token) and — critically — after a successful reconnect, which is the ONLY
     * thing that can clear the `dead` latch. Forgetting that call would brick
     * calendar sync for the rest of the session.
     */
    invalidate: (connectionId: string) => {
      cache.delete(connectionId);
      inflight.delete(connectionId);
      dead.delete(connectionId);
    },
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
        // `attempt()` throws from one of two places: the token mint
        // (`tokenProvider.getAccessToken` → a *classified* CalendarApiError —
        // notably 'auth' when the shared refresh token is dead), or fetch/timeout
        // (a raw Error = network transient). Preserve a classified kind: blindly
        // re-wrapping as 'transient' hid dead-refresh 'auth' errors from the
        // reconcile engine, so the connection never parked needs_reconnect and
        // paged Slack as a sustained transient on every poll. Same retry policy as
        // the response path below — only retryable kinds back off; every other
        // kind (auth/forbidden/not_found/conflict/unknown) propagates immediately.
        const classified =
          e instanceof CalendarApiError
            ? e
            : new CalendarApiError('transient', e instanceof Error ? e.message : String(e));
        lastErr = classified;
        if (isRetryableKind(classified.kind) && i < RETRY_BACKOFF_MS.length) {
          await delay(RETRY_BACKOFF_MS[i]);
          continue;
        }
        throw classified;
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

      // Google's error body names the rejected field/value ("Invalid value for:
      // recurrence"). Without it a 400 in CloudWatch says nothing actionable —
      // this loop ran blind for a day in prod for exactly that reason.
      let detail = '';
      try {
        const body = (await res.json()) as {
          error?: { message?: string; errors?: Array<{ reason?: string }> };
        };
        detail = [body?.error?.errors?.[0]?.reason, body?.error?.message]
          .filter(Boolean)
          .join(': ');
      } catch {
        // Body absent or not JSON — the status alone will have to do.
      }
      const err = new CalendarApiError(
        kind,
        `Google Calendar HTTP ${res.status}${detail ? ` (${detail})` : ''}`,
        res.status
      );
      // Only 429 / 5xx are worth retrying; everything else is the caller's to handle.
      if (isRetryableKind(kind) && i < RETRY_BACKOFF_MS.length) {
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
    invalidateConnection(connectionId) {
      tokenProvider.invalidate(connectionId);
    },

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

    async patchEventFields(connectionId, calendarId, eventId, patch: GoogleEventPatch) {
      // Same wire call as patchEvent — a partial body with a widened `status`
      // (cancel/restore a single recurring instance). `eventId` may be an instance id.
      await authedFetch(connectionId, `/calendars/${enc(calendarId)}/events/${enc(eventId)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
    },

    async listInstances(connectionId, calendarId, masterEventId, timeMinIso, timeMaxIso) {
      const out: CalendarInstance[] = [];
      let pageToken: string | undefined;
      let pages = 0;
      do {
        const params = new URLSearchParams({
          timeMin: timeMinIso,
          timeMax: timeMaxIso,
          // Belt-and-suspenders — discovery always runs while the instance is still
          // confirmed, so cancelled instances are never load-bearing here.
          showDeleted: 'true',
          maxResults: '250',
          fields: 'nextPageToken,items(id,status,start,end,originalStartTime)',
        });
        if (pageToken) params.set('pageToken', pageToken);
        const res = await authedFetch(
          connectionId,
          `/calendars/${enc(calendarId)}/events/${enc(masterEventId)}/instances?${params.toString()}`,
          { method: 'GET' }
        );
        const data = (await res.json()) as { nextPageToken?: string; items?: CalendarInstance[] };
        for (const it of data.items ?? []) out.push(it);
        pageToken = data.nextPageToken;
        pages += 1;
        if (pageToken && pages >= MAX_EVENT_PAGES) {
          console.warn('[calendarSync] events.instances exceeded MAX_EVENT_PAGES; truncating', {
            calendarId,
            masterEventId,
            pages,
          });
          break;
        }
      } while (pageToken);
      return out;
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
      return (data.items ?? []).map((c): CalendarSummary => ({
        id: c.id,
        summary: c.summary ?? c.id,
        primary: c.primary === true,
      }));
    },

    async listEventTimes(connectionId, calendarId, timeMinIso, timeMaxIso) {
      const out: EventTime[] = [];
      let pageToken: string | undefined;
      let pages = 0;
      do {
        const params = new URLSearchParams({
          timeMin: timeMinIso,
          timeMax: timeMaxIso,
          singleEvents: 'true', // expand recurring → instances (gives times + recurringEventId)
          showDeleted: 'false', // exclude cancelled
          maxResults: '250',
          // Field mask = the privacy guarantee: only times + the structural fields we
          // filter on. Event content (summary/description/location/attendees) is never
          // requested. `nextPageToken` MUST be included or paging stops after page 1.
          fields: 'nextPageToken,items(id,recurringEventId,start,end,status,transparency)',
        });
        if (pageToken) params.set('pageToken', pageToken);
        const res = await authedFetch(
          connectionId,
          `/calendars/${enc(calendarId)}/events?${params.toString()}`,
          { method: 'GET' }
        );
        const data = (await res.json()) as {
          nextPageToken?: string;
          items?: GoogleEventTimeItem[];
        };
        for (const it of data.items ?? []) {
          if (it.status === 'cancelled') continue; // backstop; showDeleted handles most
          const range = eventItemToMs(it);
          if (!range) {
            // Never a silent drop. A malformed item is a data anomaly, so a console.warn
            // here is the right altitude — the REST client holds no errorReporter
            // dependency, and genuine fetch failures still bubble as CalendarApiError to
            // the store's reportError. Should never fire (Google returns one shape).
            console.warn('[calendarClash] events.list item has no usable start/end; skipping', {
              calendarId,
              eventId: it.id,
            });
            continue;
          }
          out.push({
            id: it.id,
            recurringEventId: it.recurringEventId,
            startMs: range.startMs,
            endMs: range.endMs,
            transparent: it.transparency === 'transparent',
          });
        }
        pageToken = data.nextPageToken;
        pages += 1;
        if (pageToken && pages >= MAX_EVENT_PAGES) {
          // Enforced invariant: a non-terminating token can never spin the loop.
          console.warn('[calendarClash] events.list exceeded MAX_EVENT_PAGES; truncating', {
            calendarId,
            pages,
          });
          break;
        }
      } while (pageToken);
      return out;
    },
  };
}
