// Google Calendar REST implementation of the CalendarClient seam (#32 Layer 4).
// Fetch-based, no SDK. Maps HTTP status → classified CalendarApiError. The Google
// TokenProvider mints per-connection access tokens from the shared refresh token
// (in the CRDT), caches them in-memory, and writes back a rotated refresh token.

import {
  getCalendarConnectionById,
  updateCalendarConnection,
} from '@/services/automerge/repositories/calendarRepository';
import {
  getAllViewedCalendars,
  getCalendarViewAccountById,
  updateCalendarViewAccount,
} from '@/services/automerge/repositories/calendarViewRepository';
import { refreshCalendarToken } from './calendarAuth';
import { pendingCredential } from './pendingCredential';
import { isPermanentRefreshFailure } from '@/services/google/refreshFailure';
import { delay, withTimeout } from '@/utils/timing';
import {
  extractGoogleError,
  isGoogleRetryableThrottleReason,
  isGoogleThrottleReason,
} from '@/utils/googleApiError';
import { eventItemToMs } from '@/utils/calendar/googleEventTime';
import {
  CalendarApiError,
  type CalendarClient,
  type CalendarErrorKind,
  type CalendarInstance,
  type CalendarSummary,
  type CalendarEventFull,
  type CalendarViewEvent,
  type EventTime,
  type GoogleEventPatch,
  type TokenProvider,
} from './CalendarClient';

const CAL_API_BASE = 'https://www.googleapis.com/calendar/v3';
const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_BACKOFF_MS = [500, 1500] as const; // → up to 3 attempts on transient/429
/** Safety cap on event-list paging: 20 × 250 = 5000 events >> any ≤42-day window.
 *  Structural guard against a non-terminating nextPageToken — never fires in practice. */
/** The Google event types a view-only read asks for. Focus time, working location and
 *  birthdays are left out on purpose. */
const VIEW_EVENT_TYPES = ['default', 'outOfOffice', 'fromGmail'] as const;

const MAX_EVENT_PAGES = 20;

/** Access-token expiry skew — refresh a little early so a request never races expiry. */
const TOKEN_EXPIRY_SKEW_MS = 60_000;

/**
 * ⚠️ Google Calendar answers THROTTLING with **403**, not 429 — the status alone
 * cannot tell a dropped scope from a rate limit, and only the `reason` string
 * separates them. The sets live in `@/utils/googleApiError` because Drive hits the
 * identical trap from the other direction (there a throttle read as "file not
 * found"). See that module for the full argument.
 */
function classifyStatus(status: number, reason?: string): CalendarErrorKind {
  if (status === 400) return 'invalid';
  if (status === 401) return 'auth';
  // See RATE_LIMIT_403_REASONS — a 403 is only 'forbidden' when the reason is not
  // a throttle. An absent/unparseable reason keeps the conservative old answer.
  if (status === 403) return isGoogleThrottleReason(reason) ? 'rate_limited' : 'forbidden';
  if (status === 404 || status === 410) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'transient';
  return 'unknown';
}

/** Kinds worth retrying within the backoff budget; every other kind is terminal
 *  and must propagate with its true kind (notably 'auth' → parks needs_reconnect).
 *
 *  ⚠️ Kind alone is not sufficient for a 403 throttle — see `isRetryable`, which
 *  this delegates to for the response path. Kept for the THROW path (token mint /
 *  network), where there is no response body and so no reason to consult. */
function isRetryableKind(kind: CalendarErrorKind): boolean {
  return kind === 'rate_limited' || kind === 'transient';
}

/**
 * Retry decision for a classified RESPONSE, where Google's reason is available.
 *
 * Identical to `isRetryableKind` except that a project-level quota throttle is
 * terminal: see PROJECT_QUOTA_403_REASONS. A 429 carries no reason and stays
 * retryable, as before.
 */
function isRetryable(kind: CalendarErrorKind, reason?: string): boolean {
  if (!isRetryableKind(kind)) return false;
  // ⚠️ The reason only ever narrows a THROTTLE. Applying it to every retryable
  // kind silently killed the backoff for all 5xx: Google's 5xx bodies carry
  // `reason: 'backendError'`, which is not in the throttle set, so a routine
  // backend blip failed the whole reconcile on the first attempt instead of
  // retrying — and then parked the connection and paged Slack on the third poll.
  // Worse, it split on whether the load balancer answered with HTML (no reason →
  // retried) or the API with JSON (reason → not retried).
  if (kind !== 'rate_limited') return true;
  // A 429 carries no reason and stays retryable; a 403 must name a PER-USER
  // throttle. Project-level quota is a throttle but not a retryable one.
  return reason === undefined || isGoogleRetryableThrottleReason(reason);
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

// The one start/end → ms rule lives in a pure module so the view-only normalizer
// shares it; re-exported here for existing importers. (#34)
export { eventItemToMs };

// ── Token provider ───────────────────────────────────────────────────────────

interface CachedToken {
  token: string;
  expiresAt: number;
  /** The refresh token this access token was minted from (see the provider's keying note). */
  refreshToken: string;
}

/** A latched permanent refresh failure, for the refresh token Google rejected. */
interface DeadLatch {
  refreshToken: string;
  error: CalendarApiError;
}

/**
 * A refresh token the provider can mint from, plus where a rotated one goes.
 * `saveRotated` is how a rotation reaches its owner without the provider knowing
 * which collection (or memory slot) that is.
 */
export interface CalendarCredential {
  refreshToken: string;
  saveRotated(token: string): Promise<void> | void;
}

/** Look up the credential for an id the provider is asked about; `null` when unknown. */
export type CalendarCredentialResolver = (
  id: string
) => CalendarCredential | null | Promise<CalendarCredential | null>;

/** A sync connection in the doc's `calendarConnections`, rotation written back there (as before). */
async function credentialFromConnections(id: string): Promise<CalendarCredential | null> {
  const connection = await getCalendarConnectionById(id);
  if (!connection) return null;
  return {
    refreshToken: connection.refreshToken,
    saveRotated: async (token) => {
      await updateCalendarConnection(id, { refreshToken: token });
    },
  };
}

/**
 * A view-only account in the doc's `calendarViewAccounts` (plan 2026-11-17, A1/A3), rotation
 * written back to that record. The account is a credential only, so this is the one automatic
 * write the feature makes, exactly as for a sync connection.
 */
async function credentialFromViewAccounts(id: string): Promise<CalendarCredential | null> {
  const account = await getCalendarViewAccountById(id);
  if (!account) return null;
  return {
    refreshToken: account.refreshToken,
    saveRotated: async (token) => {
      await updateCalendarViewAccount(id, { refreshToken: token });
    },
  };
}

/** The in-memory pending credential (a consent whose calendar is not chosen yet). */
function credentialFromPending(id: string): CalendarCredential | null {
  const held = pendingCredential.peek();
  if (!held || held.id !== id) return null;
  return {
    refreshToken: held.refreshToken,
    // A rotation is kept with the slot, and only while the slot still holds this
    // credential: one taken or replaced in the meantime is not resurrected.
    saveRotated: (token) => {
      const current = pendingCredential.peek();
      if (current?.id === id) pendingCredential.set({ ...current, refreshToken: token });
    },
  };
}

/**
 * Where the default resolver looks, in order. The first hit wins: sync
 * connections, then view-only accounts, then the pending slot. Ids are UUIDs per
 * collection, so order only matters for speed, never for which record answers.
 */
export const DEFAULT_CREDENTIAL_SOURCES: readonly CalendarCredentialResolver[] = [
  credentialFromConnections,
  credentialFromViewAccounts,
  credentialFromPending,
];

/** Compose resolvers: the first source that knows the id answers. */
export function createCredentialResolver(
  sources: readonly CalendarCredentialResolver[] = DEFAULT_CREDENTIAL_SOURCES
): CalendarCredentialResolver {
  return async (id) => {
    for (const source of sources) {
      const hit = await source(id);
      if (hit) return hit;
    }
    return null;
  };
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
 *
 * WHERE the refresh token lives is the injected `resolveCredential`'s business
 * (default: sync connections, then view accounts, then the pending credential).
 * The three maps are keyed on the id and shared by every credential kind.
 *
 * ⚠️ Every decision is also pinned to the REFRESH TOKEN it was made for. The
 * stored token is resolved on each call, and a cached access token, an in-flight
 * refresh or a dead latch that belongs to a different refresh token is ignored
 * (the latch is dropped). This is how a device that did NOT perform a reconnect
 * recovers: the reconnecting device clears its own maps with `invalidate()`, but
 * every other device (the wall tablet, a kiosk open for days) only receives the
 * new refresh token by sync, and keying on the id alone left it latched dead
 * until a reload (and re-parked a just-reconnected sync connection).
 */
export function createGoogleTokenProvider(
  resolveCredential: CalendarCredentialResolver = createCredentialResolver()
): TokenProvider {
  const cache = new Map<string, CachedToken>();
  const inflight = new Map<string, { refreshToken: string; promise: Promise<string> }>();
  const dead = new Map<string, DeadLatch>();
  /**
   * A rotated refresh token held in memory until the store holds it: `from` is the
   * token the store still has, `to` the one Google issued in its place. While held,
   * every decision (cache, in-flight, latch) is made for `to`, so a failed write-back
   * can never send the old token to Google again (it may be invalidated by the
   * rotation) and latch a live grant dead. Not cleared by `invalidate()` (a 401 must
   * not lose the only copy); retired when the stored token changes.
   */
  const rotations = new Map<string, { from: string; to: string; saving?: boolean }>();

  /** Mint a fresh access token from `credential`. One caller at a time per connection + token. */
  async function mintAccessToken(
    connectionId: string,
    credential: CalendarCredential
  ): Promise<string> {
    let tokens;
    try {
      tokens = await refreshCalendarToken(credential.refreshToken);
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
      if (permanent) {
        dead.set(connectionId, { refreshToken: credential.refreshToken, error: classified });
      }
      throw classified;
    }

    // Rotation (defensive: this client type is normally non-rotating). The rotated
    // token is the live one from now on, whether or not the write-back below lands:
    // it is recorded first, so `effectiveCredential` maps the still-stored old token
    // onto it until the store catches up (see `rotations`).
    const rotated =
      tokens.refresh_token && tokens.refresh_token !== credential.refreshToken
        ? tokens.refresh_token
        : null;
    if (rotated) {
      // Keyed on the token the STORE holds: when this mint already used a held
      // rotation, the store still holds that rotation's `from`.
      const held = rotations.get(connectionId);
      const from =
        held && held.to === credential.refreshToken ? held.from : credential.refreshToken;
      rotations.set(connectionId, { from, to: rotated });
    }
    cache.set(connectionId, {
      token: tokens.access_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      refreshToken: rotated ?? credential.refreshToken,
    });
    if (rotated) await writeBackRotation(connectionId, credential);

    return tokens.access_token;
  }

  /**
   * Persist a held rotation. A failure never fails the caller (the access token in
   * hand is good) and never drops the rotated token: it stays in `rotations` and the
   * write-back is retried on the next call that resolves the old stored token.
   */
  async function writeBackRotation(
    connectionId: string,
    credential: CalendarCredential
  ): Promise<void> {
    const held = rotations.get(connectionId);
    if (!held || held.saving) return;
    held.saving = true;
    try {
      await credential.saveRotated(held.to);
    } catch (e) {
      console.warn(
        `[googleCalendarClient] could not store the rotated refresh token for ${connectionId}; ` +
          `keeping it in memory and retrying on the next call.`,
        e
      );
    } finally {
      held.saving = false;
    }
  }

  /**
   * The credential to act on: the stored one, unless this provider holds a rotation
   * of exactly that stored token whose write-back has not landed (then the rotated
   * token, which Google may have invalidated the old one for). The stored token
   * reaching the rotated value (the write-back landed, here or by sync) or moving to
   * anything else (a reconnect) retires the rotation.
   */
  function effectiveCredential(
    connectionId: string,
    stored: CalendarCredential
  ): CalendarCredential {
    const held = rotations.get(connectionId);
    if (!held) return stored;
    if (held.from === stored.refreshToken) return { ...stored, refreshToken: held.to };
    rotations.delete(connectionId);
    return stored;
  }

  /** The refresh token a stored token stands for right now (see `effectiveCredential`). */
  function effectiveToken(connectionId: string, storedToken: string): string {
    const held = rotations.get(connectionId);
    return held && held.from === storedToken ? held.to : storedToken;
  }

  async function getAccessToken(connectionId: string): Promise<string> {
    // The stored refresh token decides which cached decisions still apply. A
    // projection read (in memory), so the hot path stays cheap.
    const stored = await resolveCredential(connectionId);
    if (!stored) {
      throw new CalendarApiError('unknown', `calendar connection ${connectionId} not found`);
    }
    const credential = effectiveCredential(connectionId, stored);
    // A rotation still unsaved: try the write-back again, in the background (it never
    // throws, and one attempt at a time).
    if (credential !== stored) void writeBackRotation(connectionId, stored);

    const cached = cache.get(connectionId);
    if (
      cached &&
      cached.refreshToken === credential.refreshToken &&
      cached.expiresAt - TOKEN_EXPIRY_SKEW_MS > Date.now()
    ) {
      return cached.token;
    }

    // Fast-fail a known-dead grant without touching the network. Never silent:
    // the original classified error is re-thrown (so the reconcile engine still
    // routes `auth` → `needs_reconnect`) and the short-circuit is logged.
    const latched = dead.get(connectionId);
    if (latched && latched.refreshToken === credential.refreshToken) {
      console.warn(
        `[googleCalendarClient] skipping token refresh for ${connectionId} — ` +
          `refresh token permanently rejected this session (${latched.error.message}). ` +
          `Reconnect the calendar connection to clear this.`
      );
      throw latched.error;
    }
    if (latched) {
      // The stored refresh token changed since Google rejected the old one (a
      // reconnect, possibly on another device): the latch no longer applies.
      dead.delete(connectionId);
      console.warn(
        `[googleCalendarClient] refresh token for ${connectionId} changed since it was ` +
          `rejected; clearing the permanent-failure latch and retrying.`
      );
    }

    // Coalesce concurrent callers onto one refresh of the SAME token.
    const pending = inflight.get(connectionId);
    if (pending && pending.refreshToken === credential.refreshToken) return pending.promise;

    const promise = mintAccessToken(connectionId, credential).finally(() => {
      if (inflight.get(connectionId)?.promise === promise) inflight.delete(connectionId);
    });
    inflight.set(connectionId, { refreshToken: credential.refreshToken, promise });
    return promise;
  }

  return {
    getAccessToken,
    // Read-only view of the `dead` latch: only a permanent refresh failure of THIS
    // refresh token sets it, so a token replaced by a reconnect reads as not failed.
    isPermanentlyFailed: (connectionId: string, refreshToken: string) =>
      dead.get(connectionId)?.refreshToken === effectiveToken(connectionId, refreshToken),
    /**
     * Drop every cached decision for a connection. Called on a 401 (stale access
     * token) and after a successful reconnect on this device. Other devices recover
     * without it: every decision is pinned to the refresh token it was made for.
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

      // Google's error body names the rejected field/value ("Invalid value for:
      // recurrence"). Without it a 400 in CloudWatch says nothing actionable —
      // this loop ran blind for a day in prod for exactly that reason.
      //
      // ⚠️ Read BEFORE classifying, not after: `reason` is what separates a
      // rate-limit 403 from a permission 403 (see RATE_LIMIT_403_REASONS), so
      // classification cannot happen until the body has been parsed.
      let detail = '';
      let reason: string | undefined;
      try {
        // ⚠️ Its OWN timeout. `withTimeout` in `attempt()` covers only the fetch;
        // `json()` is a deferred closure over a body that may never finish
        // arriving. This read now sits IN FRONT of the 401 one-shot re-mint, so a
        // response whose headers land but whose body stalls would otherwise hang
        // the re-mint, the authedFetch promise, and — reconcile awaiting
        // connections in turn — the whole poll, indefinitely.
        const body = await withTimeout(
          res.json(),
          REQUEST_TIMEOUT_MS,
          'Google Calendar error body timed out'
        );
        ({ reason, detail } = extractGoogleError(body));
      } catch {
        // Body absent or not JSON — the status alone will have to do.
      }

      const kind = classifyStatus(res.status, reason);
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

      const err = new CalendarApiError(
        kind,
        `Google Calendar HTTP ${res.status}${detail ? ` (${detail})` : ''}`,
        res.status
      );
      // Only per-user rate limits (429 AND throttling 403s) and 5xx are worth
      // retrying; a project-level quota and every other kind is the caller's.
      if (isRetryable(kind, reason) && i < RETRY_BACKOFF_MS.length) {
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

  /**
   * GET every page of a Google list endpoint, following `nextPageToken`, and say
   * whether the page cap stopped it early. The one paging loop for every event
   * read (instances, times, import, view).
   *
   * `pageToken &&` in the cap test matters: without it a read that ENDED exactly
   * on the cap would report truncating a complete result.
   *
   * ⚠️ Logs a COUNT only, never the calendar id: a shared calendar's id is its
   * owner's email address. `label` is a fixed string naming the read.
   */
  async function pageAll<T>(
    connectionId: string,
    path: string,
    params: URLSearchParams,
    label: string
  ): Promise<{ items: T[]; truncated: boolean }> {
    const items: T[] = [];
    let pageToken: string | undefined;
    let pages = 0;
    do {
      const pageParams = new URLSearchParams(params);
      if (pageToken) pageParams.set('pageToken', pageToken);
      const res = await authedFetch(connectionId, `${path}?${pageParams.toString()}`, {
        method: 'GET',
      });
      const data = (await res.json()) as { nextPageToken?: string; items?: T[] };
      for (const it of data.items ?? []) items.push(it);
      pageToken = data.nextPageToken;
      pages += 1;
      if (pageToken && pages >= MAX_EVENT_PAGES) {
        // Enforced invariant: a non-terminating token can never spin the loop.
        console.warn(`[googleCalendarClient] ${label} page cap reached; truncating`, {
          pages,
          count: items.length,
        });
        return { items, truncated: true };
      }
    } while (pageToken);
    return { items, truncated: false };
  }

  return {
    invalidateConnection(connectionId) {
      tokenProvider.invalidate(connectionId);
    },

    hasPermanentAuthFailure(credentialId, refreshToken) {
      return tokenProvider.isPermanentlyFailed?.(credentialId, refreshToken) ?? false;
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

    async listInstances(connectionId, calendarId, masterEventId, timeMinIso, timeMaxIso, timeZone) {
      const params = new URLSearchParams({
        timeMin: timeMinIso,
        timeMax: timeMaxIso,
        // Render instance times in the family's HOME zone, not the calendar's
        // (see `CalendarClient.listInstances`).
        timeZone,
        // Belt-and-suspenders — discovery always runs while the instance is still
        // confirmed, so cancelled instances are never load-bearing here.
        showDeleted: 'true',
        maxResults: '250',
        fields: 'nextPageToken,items(id,status,start,end,originalStartTime)',
      });
      const { items } = await pageAll<CalendarInstance>(
        connectionId,
        `/calendars/${enc(calendarId)}/events/${enc(masterEventId)}/instances`,
        params,
        'events.instances'
      );
      return items;
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
        items?: Array<{ id: string; summary?: string; primary?: boolean; accessRole?: string }>;
      };
      return (data.items ?? []).map((c): CalendarSummary => ({
        id: c.id,
        summary: c.summary ?? c.id,
        primary: c.primary === true,
        // Already in the response; the import chooser uses it to grey out feeds
        // the granted scope cannot read. Undefined is treated as 'owner'.
        accessRole: c.accessRole,
      }));
    },

    async listEventTimes(connectionId, calendarId, timeMinIso, timeMaxIso) {
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
      const { items } = await pageAll<GoogleEventTimeItem>(
        connectionId,
        `/calendars/${enc(calendarId)}/events`,
        params,
        'events.list (times)'
      );
      const out: EventTime[] = [];
      for (const it of items) {
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
      return out;
    },

    async listEventsForImport(connectionId, calendarId, timeMinIso, timeMaxIso) {
      const params = new URLSearchParams({
        timeMin: timeMinIso,
        timeMax: timeMaxIso,
        // FALSE, unlike listEventTimes. A recurring series must come back as ONE
        // master carrying its RRULE, or the import would create N copies of a
        // weekly swim lesson instead of one repeating activity. Google returns a
        // master whose DTSTART is in the past when any instance falls in the
        // window, which is how a long-running series is importable at all.
        singleEvents: 'false',
        // TRUE, deliberately, and NOT a copy-paste slip from listEventTimes.
        // Deleting one occurrence in Google's own UI does NOT add an EXDATE to
        // the master: Google writes a separate event carrying `recurringEventId`
        // and `status:'cancelled'`. With showDeleted=false those never arrive,
        // so the EXDATE refusal in `parseRrule` would almost never fire for a
        // series authored in Google, and beanies would adopt a series showing
        // occurrences the family deliberately removed. The planner uses these
        // cancelled instances to detect exactly that; they are never imported.
        showDeleted: 'true',
        // Google returns Working Location, Out-of-office and Focus-time events
        // by default. Those are synthetic, the signed-in user is their creator,
        // and they recur daily, so without this filter a review list fills with
        // "Home"/"Office" rows, ticked, ahead of the family's real events.
        eventTypes: 'default',
        maxResults: '250',
        // The import's mask, deliberately WIDER than the clash-nudge read's. It
        // requests what an activity needs and nothing more. `attendees` is absent
        // on purpose: not requesting the guest list is what keeps other people's
        // email addresses out of the family's .beanpod. `organizer(self)` and
        // `creator(self)` are booleans about the signed-in user, not identities.
        // `nextPageToken` MUST be included or paging stops after page 1.
        fields:
          'nextPageToken,items(id,summary,description,location,start,end,recurrence,status,recurringEventId,organizer(self),creator(self))',
      });
      const { items } = await pageAll<
        Omit<CalendarEventFull, 'isOrganizer'> & {
          organizer?: { self?: boolean };
          creator?: { self?: boolean };
        }
      >(connectionId, `/calendars/${enc(calendarId)}/events`, params, 'events.list (import)');
      const out: CalendarEventFull[] = [];
      for (const it of items) {
        // A cancelled INSTANCE (it carries `recurringEventId`) is meaningful: it
        // is how Google records a removed occurrence, and the planner refuses to
        // adopt a master that has any. A cancelled MASTER is genuinely gone.
        if (it.status === 'cancelled' && !it.recurringEventId) continue;
        // A cancelled instance carries no `start` — it is a tombstone, not an
        // event. It is not a data anomaly and must not be warned about or
        // dropped: the planner reads only its `recurringEventId`.
        if (it.status === 'cancelled' && it.recurringEventId) {
          out.push({ ...it, isOrganizer: false });
          continue;
        }
        if (!it.start) {
          // Never a silent drop. An item with no start cannot become an activity.
          // Same altitude as listEventTimes: the REST client holds no
          // errorReporter dependency, and real fetch failures still bubble as
          // CalendarApiError to the store's reportError.
          console.warn('[calendarImport] events.list item has no start; skipping', {
            calendarId,
            eventId: it.id,
          });
          continue;
        }
        out.push({
          id: it.id,
          summary: it.summary,
          description: it.description,
          location: it.location,
          start: it.start,
          end: it.end,
          recurrence: it.recurrence,
          status: it.status,
          recurringEventId: it.recurringEventId,
          isOrganizer: it.organizer?.self === true || it.creator?.self === true,
        });
      }
      return out;
    },

    async listEventsForView(credentialId, calendarId, timeMinIso, timeMaxIso) {
      // The read guard (plan A3). A view grant can read EVERY calendar on the signed-in
      // account; beanies only ever reads one the family added, through the account it
      // was added from. Enforced here, at the one place the request is made, so no
      // caller can read past it. The message names neither id (a shared calendar's id
      // is its owner's email address).
      const viewed = await getAllViewedCalendars();
      if (!viewed.some((c) => c.viewAccountId === credentialId && c.calendarId === calendarId)) {
        throw new CalendarApiError(
          'invalid',
          'view read refused: the calendar is not a viewed calendar of this account'
        );
      }
      const params = new URLSearchParams({
        timeMin: timeMinIso,
        timeMax: timeMaxIso,
        // Occurrences, not masters: a view shows what happens on each day, and
        // each instance carries `recurringEventId` for the beanies-origin dedupe.
        singleEvents: 'true',
        showDeleted: 'false',
        maxResults: '250',
        // The view-only mask: what a calendar block shows and nothing more. No
        // `description` (an owner's private notes) and no `attendees` (other
        // people's addresses). `nextPageToken` MUST be included or paging stops
        // after page 1.
        fields:
          'nextPageToken,items(id,recurringEventId,status,eventType,summary,location,start,end,transparency,visibility,htmlLink)',
      });
      // `eventTypes` is a repeated parameter. Out-of-office is the most useful
      // work-calendar signal; focus time and working location are left out.
      // `fromGmail` is what Google makes from an email (a dinner booking, a flight):
      // on the calendar it looks like any other event, so leaving it out reads as a
      // missing event (found in testing, 2026-11-17).
      for (const type of VIEW_EVENT_TYPES) params.append('eventTypes', type);
      const { items, truncated } = await pageAll<CalendarViewEvent>(
        credentialId,
        `/calendars/${enc(calendarId)}/events`,
        params,
        'events.list (view)'
      );
      // Pick the masked fields explicitly, so nothing Google adds to a response
      // can ride along into memory.
      const events = items.map((it): CalendarViewEvent => ({
        id: it.id,
        recurringEventId: it.recurringEventId,
        status: it.status,
        eventType: it.eventType,
        summary: it.summary,
        location: it.location,
        start: it.start,
        end: it.end,
        transparency: it.transparency,
        visibility: it.visibility,
        htmlLink: it.htmlLink,
      }));
      return { events, truncated };
    },
  };
}
