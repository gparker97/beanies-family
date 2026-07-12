// Calendar sync orchestrator (#32 Layer 5).
//
// MVO Orchestrator: coordinates the CRDT (connections + links) → CalendarClient
// (Google REST) → reconcile. Depends only on the CalendarClient + TokenProvider
// seam, never on Google specifics directly. Family-wide: ALL activities push to
// ALL connected calendars. Convergent + bounded + safe under the shared token.
//
// Reliability invariants (see #32 plan, Layer 5):
//  - navigator.locks single-writer per connection (best-effort; falls through
//    when unavailable). Reconcile is a pure function of (activities, remote state),
//    so re-running converges; idempotent insert(409→patch)/patch(404→insert)/delete.
//  - Bounded concurrency over (activity × connection) work-items.
//  - Cross-device freshness-claim: skip a periodic full scan a peer just did.
//  - Forward window + link GC: an out-of-window / inactive activity's event + link
//    are deleted, so links never grow unbounded.
//  - SHARED-TOKEN invalid_grant: NEVER delete the shared refreshToken. Park
//    `needs_reconnect` only after K device-local consecutive auth failures; any
//    successful mint self-heals to `ok` and resets the device-local counter.

import { defineStore } from 'pinia';
import { computed, watch } from 'vue';
import { docVersion, isDocLoaded } from '@/services/automerge/docService';
import { list as projectionList } from '@/services/automerge/projection';
import { toISODateString, localToday, addDaysYmd } from '@/utils/date';
import { generateUUID } from '@/utils/id';
import { reportError } from '@/utils/errorReporter';
import { isFlagEnabled } from '@/config/flags';
import { useToday } from '@/composables/useToday';
import { useActivityStore } from '@/stores/activityStore';
import { useMemberInfo } from '@/composables/useMemberInfo';
import {
  usePollWhileVisible,
  type PollWhileVisibleHandle,
} from '@/composables/usePollWhileVisible';
import { getAllActivities } from '@/services/automerge/repositories/activityRepository';
import { getGoogleAccountEmail } from '@/services/google/googleAuth';
import {
  getCalendarConnectionById,
  createCalendarConnection,
  updateCalendarConnection,
  removeCalendarConnection,
  getCalendarEventLink,
  createCalendarEventLink,
  updateCalendarEventLink,
  removeCalendarEventLinkById,
  getCalendarEventLinksForConnection,
} from '@/services/automerge/repositories/calendarRepository';
import {
  connectGoogleCalendar,
  startCalendarRedirectAuth,
  completeCalendarRedirectAuth,
  type CalendarConnectResult,
  type CalendarConnectSuccess,
} from '@/services/calendar/calendarAuth';
import { shouldUseRedirectAuth } from '@/services/google/googleAuth';
import { CALENDAR_SYNC_OPEN } from '@/constants/settingsDeepLinks';
import {
  getCalendarClient,
  setCalendarClientForTesting,
  resetCalendarClient,
} from '@/services/calendar/clientInstance';
import {
  CalendarApiError,
  type CalendarClient,
  type CalendarErrorKind,
  type CalendarSummary,
} from '@/services/calendar/CalendarClient';
import { runPooled } from '@/utils/calendar/runPooled';
import {
  activityToGoogleEvent,
  masterOccurrenceBody,
  type ActivityMapContext,
  type GoogleEventResource,
} from '@/utils/calendar/activityToGoogleEvent';
import {
  planReconcile,
  type ReconcileUpsert,
  type ReconcileExceptionUpsert,
} from '@/utils/calendar/reconcilePlan';
import { deterministicEventId } from '@/utils/calendar/deterministicEventId';
import { matchInstanceForDate } from '@/utils/calendar/matchInstanceForDate';
import type { CalendarConnection, CalendarEventLink, FamilyActivity } from '@/types/models';

const FLAG = 'googleCalendarSync';

/**
 * Outcome of a single-connection reconcile, surfaced so a user-initiated
 * "Sync now" can toast the real result instead of an unconditional success.
 * - `ok`        — reconciled cleanly (or a healthy no-op).
 * - `error`     — a non-auth API error; connection parked `error`.
 * - `needs_reconnect` — an auth failure; the token needs re-consent.
 * - `skipped`   — nothing to do (not found / mid-disconnect / within freshness window).
 */
export type SyncOutcome = 'ok' | 'error' | 'needs_reconnect' | 'skipped';

/** Periodic full-scan cadence (5 min). On each tick we verify unchanged events
 *  exist (re-create manual remote-deletes). Edits trigger a faster, no-verify pass. */
const RECONCILE_POLL_MS = 300_000;
const EDIT_DEBOUNCE_MS = 3_000;
/** Skip a periodic full scan if a peer device reconciled this connection this recently. */
const FRESHNESS_WINDOW_MS = 120_000;
/** Bounded concurrency over (activity × connection) work-items. */
const MAX_INFLIGHT = 5;
/** Device-local consecutive `invalid_grant` failures before parking the shared status. */
const INVALID_GRANT_THRESHOLD = 2;

/** Device-local consecutive non-auth reconcile failures before a single Slack
 *  page. A lone transient (e.g. a 403 right after connect) is background noise;
 *  only a connection that STAYS broken is user-impacting (activities silently
 *  not reaching Google Calendar). Mirrors INVALID_GRANT_THRESHOLD. */
const RECONCILE_ERROR_THRESHOLD = 3;

/** Telemetry log-level per CalendarErrorKind (NOT a page-gate). Paging for
 *  non-auth reconcile errors is gated by RECONCILE_ERROR_THRESHOLD below — a
 *  single error never pages regardless of this table. Exhaustive over CalendarErrorKind. */
export const CALENDAR_SYNC_ERRORS = {
  auth: 'warning',
  forbidden: 'error',
  not_found: 'warning',
  conflict: 'warning',
  rate_limited: 'warning',
  transient: 'warning',
  unknown: 'error',
} as const satisfies Record<CalendarErrorKind, 'warning' | 'error'>;

// ── Module-level engine state (per page/device, not in the CRDT) ──────────────

/** Device-local K-counter for invalid_grant (kept out of the CRDT — Pass 4). */
const invalidGrantCounters = new Map<string, number>();

/** Device-local K-counter for consecutive non-auth reconcile errors. Drives the
 *  sustained-only Slack page; reset on clean success + wiped in stop(). */
const reconcileErrorCounters = new Map<string, number>();

// The CalendarClient singleton lives in `clientInstance.ts` (shared with the clash
// store). Re-export the test seam so this store's existing tests keep importing it
// from here.
export { setCalendarClientForTesting };

function nowIso(): string {
  return toISODateString(new Date());
}

function todayYmd(): string {
  return localToday(); // LOCAL date — the push window must reflect the user's day, not UTC (F8)
}

/** A ±1-day UTC window around an occurrence date, for `listInstances` discovery.
 *  Padded so an exact local-midnight→UTC conversion is never needed — the pure
 *  `matchInstanceForDate` picks the exact instance by its original-start date slice. */
function paddedDayWindow(occurrenceYmd: string): [string, string] {
  return [
    `${addDaysYmd(occurrenceYmd, -1)}T00:00:00Z`,
    `${addDaysYmd(occurrenceYmd, 2)}T00:00:00Z`,
  ];
}

function getDeviceId(): string {
  try {
    let id = localStorage.getItem('beanies:device-id');
    if (!id) {
      id = generateUUID();
      localStorage.setItem('beanies:device-id', id);
    }
    return id;
  } catch {
    return 'unknown-device';
  }
}

/**
 * A per-reconcile member-name resolver, memoized so resolving 1–3 ids × N
 * activities never re-scans `familyStore.members` (avoids O(N·M)). Reuses the
 * single-source family resolver (`useMemberInfo`) — preserves `undefined` for
 * unknown ids. Must be called within a store action (Pinia active).
 */
function makeMemberNameResolver(): (id: string) => string | undefined {
  const { getMemberById } = useMemberInfo();
  const cache = new Map<string, string | undefined>();
  return (id) => {
    if (cache.has(id)) return cache.get(id);
    const name = getMemberById(id)?.name;
    cache.set(id, name);
    return name;
  };
}

/** App origin + timezone for the event mapper, with the (shared) member resolver. */
function buildMapContext(memberName: (id: string) => string | undefined): ActivityMapContext {
  return {
    memberName,
    appOrigin:
      typeof window !== 'undefined' ? window.location.origin : 'https://app.beanies.family',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/** Run a per-connection critical section under a best-effort single-writer lock. */
async function withConnectionLock(connectionId: string, fn: () => Promise<void>): Promise<void> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks?.request) return fn();
  await locks.request(`calendar-reconcile-${connectionId}`, { ifAvailable: true }, async (lock) => {
    if (!lock) return; // another context on this device holds it → skip
    await fn();
  });
}

/** Insert an event; if its id already exists, patch instead. The id can already
 *  exist because a peer device created it, OR because the event was deleted and
 *  Google reserves the id as a `cancelled` event — the resource's
 *  `status: 'confirmed'` makes the patch RESURRECT it (otherwise it stays hidden). */
async function createOrResurrect(
  client: CalendarClient,
  connectionId: string,
  calendarId: string,
  eventId: string,
  resource: GoogleEventResource
): Promise<void> {
  try {
    await client.insertEvent(connectionId, calendarId, eventId, resource);
  } catch (e) {
    if (e instanceof CalendarApiError && e.kind === 'conflict') {
      await client.patchEvent(connectionId, calendarId, eventId, resource);
    } else {
      throw e;
    }
  }
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useCalendarSyncStore = defineStore('calendarSync', () => {
  const deviceId = getDeviceId();
  const { isVisible } = useToday();

  /** Reactive projection of connections from the CRDT (re-reads on docVersion bump). */
  const connections = computed<CalendarConnection[]>(() => {
    void docVersion.value;
    if (!isDocLoaded()) return [];
    return projectionList('calendarConnections');
  });

  // ── User-facing reconnect signal (single source of truth) ───────────────────
  // Keyed on `needs_reconnect` ONLY — never `error`. `settleConnectionStatus`
  // writes `error` unconditionally on the first non-auth reconcile failure (only
  // Slack *paging* is sustained-gated), so keying on it would flap a re-consent
  // CTA on a transient network/rate-limit blip — and re-auth can't fix a network
  // error anyway. `needs_reconnect` is the dead-grant state a re-consent DOES
  // fix. This is a pure computed off persisted CRDT status, so it fires once
  // (independent of poll count) and self-heals to null when the status returns
  // to `ok` — no transition-edge bookkeeping, no `settleConnectionStatus` change.
  const reconnectNeededConnection = computed<CalendarConnection | null>(
    () => connections.value.find((c) => c.status === 'needs_reconnect') ?? null
  );
  /** True while any connection needs re-consent. Drives the App-level toast. */
  const showCalendarReconnect = computed(() => reconnectNeededConnection.value !== null);

  let pollHandle: PollWhileVisibleHandle | null = null;
  let stopActivityWatch: (() => void) | null = null;
  let editDebounce: ReturnType<typeof setTimeout> | null = null;
  let started = false;

  // ── Per-connection reconcile ────────────────────────────────────────────────

  function shouldSkipForFreshness(connection: CalendarConnection): boolean {
    if (!connection.lastReconciledAt) return false;
    if (connection.lastReconciledBy === deviceId) return false; // our own claim — don't skip
    const age = Date.now() - new Date(connection.lastReconciledAt).getTime();
    return age >= 0 && age < FRESHNESS_WINDOW_MS;
  }

  /** Upsert (insert/patch) the link record for an activity↔event mapping. `extra`
   *  carries the exception fields (`exceptionOf`/`exceptionOriginalYmd`) for a
   *  per-occurrence exception link; omitted for a normal master link. */
  async function recordLink(
    connectionId: string,
    activityId: string,
    googleEventId: string,
    hash: string,
    extra?: { exceptionOf?: string; exceptionOriginalYmd?: string }
  ): Promise<void> {
    const existing = await getCalendarEventLink(connectionId, activityId);
    const lastPushedAt = nowIso();
    if (existing) {
      await updateCalendarEventLink(existing.id, {
        googleEventId,
        lastPushedHash: hash,
        lastPushedAt,
        ...extra,
      });
    } else {
      await createCalendarEventLink({
        connectionId,
        activityId,
        googleEventId,
        lastPushedHash: hash,
        lastPushedAt,
        ...extra,
      });
    }
  }

  /** Apply one upsert. Returns true iff it actually wrote to Google (used to decide
   *  whether the connection record needs a status write — F1). `verifyExisting`
   *  does a remote-existence probe for unchanged events. Throws on failure. */
  async function applyUpsert(
    client: CalendarClient,
    connectionId: string,
    calendarId: string,
    u: ReconcileUpsert,
    ctx: ActivityMapContext,
    verifyExisting: boolean
  ): Promise<boolean> {
    const resource = activityToGoogleEvent(u.activity, ctx);
    const hasLink = u.existingHash !== undefined;

    if (!hasLink) {
      await createOrResurrect(client, connectionId, calendarId, u.eventId, resource);
      await recordLink(connectionId, u.activity.id, u.eventId, u.hash);
      return true;
    }

    if (u.existingHash !== u.hash) {
      try {
        await client.patchEvent(connectionId, calendarId, u.eventId, resource);
      } catch (e) {
        if (e instanceof CalendarApiError && e.kind === 'not_found') {
          await createOrResurrect(client, connectionId, calendarId, u.eventId, resource);
        } else {
          throw e;
        }
      }
      await recordLink(connectionId, u.activity.id, u.eventId, u.hash);
      return true;
    }

    // Unchanged. On a verify pass, restore the event if it was deleted/cancelled
    // in Google (eventExists treats a cancelled event as missing).
    if (verifyExisting) {
      const exists = await client.eventExists(connectionId, calendarId, u.eventId);
      if (!exists) {
        await createOrResurrect(client, connectionId, calendarId, u.eventId, resource);
        await recordLink(connectionId, u.activity.id, u.eventId, u.hash);
        return true;
      }
    }
    return false;
  }

  /** Apply one per-occurrence override as a Google recurring-instance EXCEPTION.
   *  Discovers the instance id once (via `listInstances`) then reuses the stored id;
   *  patches the instance (modify) or cancels it (delete-one). Returns true iff it
   *  wrote to Google. Exceptions do NOT re-assert on a verify pass (v1 — they self-
   *  heal on the next override change). Throws only on a real API error the caller
   *  should record; benign convergence cases (`not_found`, no instance) return false. */
  async function applyExceptionUpsert(
    client: CalendarClient,
    connectionId: string,
    calendarId: string,
    e: ReconcileExceptionUpsert,
    ctx: ActivityMapContext
  ): Promise<boolean> {
    // Unchanged → no-op (independent of verify pass).
    if (e.existingHash === e.hash) return false;

    // Invariant guard: an override child is always `recurrence:'none'`. A recurring
    // "child" is malformed data — never stamp an RRULE onto a single instance.
    if (e.child.recurrence !== 'none') {
      console.warn(
        `[calendarSync] skipping exception for ${e.child.id}: override child has recurrence ` +
          `'${e.child.recurrence}' (expected 'none') — refusing to write an RRULE onto an instance`
      );
      return false;
    }

    // Discover the instance id ONCE; reuse the stored id thereafter (a moved instance
    // would fall outside an original-date re-window, so we must not re-discover).
    let instanceId = e.existingInstanceId;
    if (!instanceId) {
      const masterEventId = deterministicEventId(e.master.id);
      const [timeMin, timeMax] = paddedDayWindow(e.occurrenceYmd);
      let instances;
      try {
        instances = await client.listInstances(
          connectionId,
          calendarId,
          masterEventId,
          timeMin,
          timeMax
        );
      } catch (err) {
        // Master not on Google yet → converge on the next reconcile (not an error).
        if (err instanceof CalendarApiError && err.kind === 'not_found') {
          console.debug(
            `[calendarSync] exception deferred: master ${e.master.id} not yet on Google`
          );
          return false;
        }
        throw err;
      }
      const inst = matchInstanceForDate(instances, e.occurrenceYmd);
      if (!inst) {
        console.debug(
          `[calendarSync] exception deferred: no Google instance for ${e.occurrenceYmd} ` +
            `of master ${e.master.id}`
        );
        return false;
      }
      instanceId = inst.id;
    }

    if (e.mode === 'cancel') {
      await client.patchEventFields(connectionId, calendarId, instanceId, { status: 'cancelled' });
    } else {
      await client.patchEvent(
        connectionId,
        calendarId,
        instanceId,
        activityToGoogleEvent(e.child, ctx)
      );
    }
    await recordLink(connectionId, e.child.id, instanceId, e.hash, {
      exceptionOf: e.master.id,
      exceptionOriginalYmd: e.occurrenceYmd,
    });
    return true;
  }

  /** Restore or drop an exception link whose override child is gone. If the master is
   *  still pushable, patch the stored instance back to the master's generated value
   *  (un-cancels / moves back). If the master is null (being series-deleted or not
   *  synced), just drop the stale link — never patch an instance of a deleted master.
   *  Returns true iff it changed remote/link state. */
  async function applyExceptionRestore(
    client: CalendarClient,
    connectionId: string,
    calendarId: string,
    link: CalendarEventLink,
    master: FamilyActivity | null,
    ctx: ActivityMapContext
  ): Promise<boolean> {
    if (!master || !link.exceptionOriginalYmd) {
      // No master to restore to (series being deleted / unsynced) or a malformed link
      // with no occurrence date → drop the stale exception link.
      await removeCalendarEventLinkById(connectionId, link.activityId);
      return true;
    }
    const occurrenceYmd = link.exceptionOriginalYmd;
    try {
      await client.patchEventFields(
        connectionId,
        calendarId,
        link.googleEventId,
        masterOccurrenceBody(master, occurrenceYmd, ctx)
      );
    } catch (err) {
      // Instance already gone → already converged; drop the link and move on.
      if (err instanceof CalendarApiError && err.kind === 'not_found') {
        await removeCalendarEventLinkById(connectionId, link.activityId);
        return true;
      }
      throw err;
    }
    await removeCalendarEventLinkById(connectionId, link.activityId);
    return true;
  }

  /**
   * Reconcile one connection. `verifyExisting` toggles the remote-existence probe
   * for unchanged events. `force` bypasses the freshness skip (manual / connect).
   */
  async function reconcileConnection(
    connectionId: string,
    opts: { verifyExisting: boolean; force?: boolean }
  ): Promise<SyncOutcome> {
    const connection = await getCalendarConnectionById(connectionId);
    if (!connection) return 'skipped';

    // A connection mid-disconnect retries its teardown instead of syncing.
    if (connection.status === 'disconnecting') {
      await finishDisconnect(connectionId);
      return 'skipped';
    }
    if (!opts.force && shouldSkipForFreshness(connection)) return 'skipped';

    // Captured inside the lock and returned so a user-initiated sync can report it.
    let outcome: SyncOutcome = 'skipped';
    await withConnectionLock(connectionId, async () => {
      const client = getCalendarClient();
      const calendarId = connection.destinationCalendarId || 'primary';
      const memberName = makeMemberNameResolver(); // one memoized resolver for ctx + hash
      const ctx = buildMapContext(memberName);
      const activities = await getAllActivities();
      const links = await getCalendarEventLinksForConnection(connectionId);
      const plan = planReconcile(activities, links, todayYmd(), memberName);

      const errors: CalendarApiError[] = [];
      // An `auth` error means the connection's refresh token is permanently
      // rejected: every remaining task in this run would fail identically. Stop
      // dispatching them. (The token provider also latches the failure, so the
      // already-dispatched ones fail locally without touching the network.)
      let authAborted = false;
      const record = (e: unknown) => {
        const err = e instanceof CalendarApiError ? e : new CalendarApiError('unknown', String(e));
        if (err.kind === 'auth') authAborted = true;
        errors.push(err);
      };
      // Whether any actual Google write happened — gates the connection status write
      // so a no-op reconcile doesn't churn the CRDT (and re-trigger itself). (F1)
      let changed = false;

      const tasks: Array<() => Promise<void>> = [
        ...plan.upserts.map((u) => async () => {
          try {
            if (await applyUpsert(client, connectionId, calendarId, u, ctx, opts.verifyExisting)) {
              changed = true;
            }
          } catch (e) {
            record(e);
          }
        }),
        ...plan.deletes.map((link) => async () => {
          try {
            await client.deleteEvent(connectionId, calendarId, link.googleEventId);
            await removeCalendarEventLinkById(connectionId, link.activityId);
            changed = true;
          } catch (e) {
            record(e);
          }
        }),
      ];

      await runPooled(tasks, MAX_INFLIGHT, () => authAborted);
      if (authAborted) {
        console.warn(
          `[calendarSync] aborted reconcile for ${connection.id} — refresh token rejected; ` +
            `${errors.length} of ${tasks.length} task(s) attempted before stopping.`
        );
      }

      // Phase B: per-occurrence recurring-instance exceptions (reschedule / edit-one /
      // delete-one) + restores — run AFTER Phase A so every master event exists first.
      // Shares the same record/errors/changed/authAborted accounting + single settle.
      const exceptionTasks: Array<() => Promise<void>> = [
        ...plan.exceptionUpserts.map((e) => async () => {
          try {
            if (await applyExceptionUpsert(client, connectionId, calendarId, e, ctx)) {
              changed = true;
            }
          } catch (err) {
            record(err);
          }
        }),
        ...plan.exceptionRestores.map((r) => async () => {
          try {
            if (
              await applyExceptionRestore(client, connectionId, calendarId, r.link, r.master, ctx)
            ) {
              changed = true;
            }
          } catch (err) {
            record(err);
          }
        }),
      ];
      if (exceptionTasks.length > 0) {
        await runPooled(exceptionTasks, MAX_INFLIGHT, () => authAborted);
      }

      outcome = await settleConnectionStatus(connection, errors, changed);

      // Dev-only diagnostic — surfaces what each connection actually did so a
      // per-account discrepancy is visible while developing. Keyed by connection id
      // (never the account email) and silent in production. (F10)
      if (import.meta.env.DEV) {
        const kinds = errors.length ? [...new Set(errors.map((e) => e.kind))].join(',') : 'none';
        console.debug(
          `[calendarSync] reconciled ${connection.id} (cal=${calendarId}): ` +
            `${plan.upserts.length} activities, ${plan.deletes.length} deletes, ` +
            `${plan.exceptionUpserts.length} exceptions, ${plan.exceptionRestores.length} restores, ` +
            `${errors.length} errors [${kinds}]`
        );
      }
    });
    return outcome;
  }

  /** Translate the batch's errors into the connection's status (shared-token-safe).
   *  Returns the outcome so a user-initiated sync can report success vs. failure. */
  async function settleConnectionStatus(
    connection: CalendarConnection,
    errors: CalendarApiError[],
    changed: boolean
  ): Promise<SyncOutcome> {
    const hasAuth = errors.some((e) => e.kind === 'auth');

    if (hasAuth) {
      // NEVER delete the shared refreshToken. Park needs_reconnect only after K
      // device-local consecutive auth failures.
      const n = (invalidGrantCounters.get(connection.id) ?? 0) + 1;
      invalidGrantCounters.set(connection.id, n);
      if (n >= INVALID_GRANT_THRESHOLD && connection.status !== 'needs_reconnect') {
        await updateCalendarConnection(connection.id, {
          status: 'needs_reconnect',
          lastError: 'auth',
        });
        reportError({
          surface: 'calendar-sync',
          // `connectionId` is not in `ALLOWED_CONTEXT_KEYS` (it was dropped with
          // a console warn on every park). It is device-local and useless in
          // Slack, so it rides in the message rather than widening the allowlist.
          message:
            `[calendarSync] connection parked needs_reconnect after ${n} auth failures ` +
            `(connection ${connection.id})`,
          severity: 'warning',
        });
      }
      // An auth failure interrupts any non-auth error streak, so the
      // "consecutive non-auth reconciles" count must restart — otherwise a stale
      // pre-auth count could cross the threshold on the first error after the
      // auth issue self-heals (a false "sustained"). Auth is handled by the
      // invalidGrant counter above.
      reconcileErrorCounters.delete(connection.id);
      return 'needs_reconnect';
    }

    // Any successful access resets the device-local auth counter + self-heals.
    invalidGrantCounters.delete(connection.id);

    const otherErrors = errors.filter((e) => e.kind !== 'auth');
    if (otherErrors.length > 0) {
      const worst = otherErrors[0];
      await updateCalendarConnection(connection.id, {
        status: 'error',
        lastError: worst.kind,
        lastReconciledAt: nowIso(),
        lastReconciledBy: deviceId,
      });
      // Sustained-only paging: count consecutive non-auth reconcile failures and
      // page Slack exactly ONCE, when we cross the threshold (=== , not >=). A
      // lone transient stays log-only (telemetry still records every reconcile);
      // a connection that stays broken pages. Counter resets on clean success.
      const n = (reconcileErrorCounters.get(connection.id) ?? 0) + 1;
      reconcileErrorCounters.set(connection.id, n);
      reportError({
        surface: 'calendar-sync',
        message: `[calendarSync] reconcile error (${worst.kind}): ${worst.message}${
          n >= RECONCILE_ERROR_THRESHOLD ? ` (sustained ×${n})` : ''
        }`,
        error: worst,
        severity: n === RECONCILE_ERROR_THRESHOLD ? 'critical' : CALENDAR_SYNC_ERRORS[worst.kind],
        context: { connectionId: connection.id, consecutiveFailures: n },
      });
      return 'error';
    }

    // Clean success. If nothing changed AND the connection is already ok AND its
    // freshness claim is still within the window, skip the write entirely — this is
    // what stops a no-op reconcile from churning the CRDT / re-triggering itself (F1).
    if (!changed && connection.status === 'ok') {
      const lastAt = connection.lastReconciledAt
        ? new Date(connection.lastReconciledAt).getTime()
        : 0;
      if (Date.now() - lastAt < FRESHNESS_WINDOW_MS) return 'ok';
    }

    // Clean success — the single point a connection is confirmed healthy, so the
    // single reset site for the reconcile-error counter (no lockstep with the
    // auth counter to drift). The no-op early-return above only fires when the
    // connection is already `ok`, where the counter is already 0 — safe to skip.
    reconcileErrorCounters.delete(connection.id);

    // → ok + refresh the freshness-claim.
    await updateCalendarConnection(connection.id, {
      status: 'ok',
      lastError: undefined,
      lastSyncedAt: nowIso(),
      lastReconciledAt: nowIso(),
      lastReconciledBy: deviceId,
    });
    return 'ok';
  }

  async function reconcileAll(opts: { verifyExisting: boolean; force?: boolean }): Promise<void> {
    if (!isFlagEnabled(FLAG)) return;
    const list = connections.value.filter((c) => c.status !== 'disconnecting');
    for (const c of list) {
      await reconcileConnection(c.id, opts);
    }
    // Always sweep any connection stuck mid-disconnect.
    for (const c of connections.value.filter((c) => c.status === 'disconnecting')) {
      await finishDisconnect(c.id);
    }
  }

  // ── Public actions ──────────────────────────────────────────────────────────

  /**
   * Build the same-origin returnPath a calendar redirect lands on. It reopens the
   * Calendar settings drawer AND carries the resume intent in a `calResume` query
   * (`connect` for a fresh connect, or a connectionId to reconnect) — so no secret
   * and no id ever rides in the OAuth `state`. The App-level resume reads it.
   */
  function buildCalendarReturnPath(intent: 'connect' | string): string {
    const params = new URLSearchParams({ open: CALENDAR_SYNC_OPEN, calResume: intent });
    return `/settings?${params.toString()}`;
  }

  /**
   * Commit a successful consent (create a new connection, or update an existing one
   * in place) + kick a verify reconcile. Shared by the popup path (`connect`/
   * `reconnect`) and the redirect resume so all three converge on one commit.
   * `connectionId` present ⇒ reconnect that connection (falls back to create if it
   * vanished — remotely healed/removed); absent ⇒ fresh connect.
   */
  async function finalizeConnected(
    result: CalendarConnectSuccess,
    connectionId?: string
  ): Promise<void> {
    if (connectionId) {
      const existing = await getCalendarConnectionById(connectionId);
      if (existing) {
        await updateCalendarConnection(connectionId, {
          accountEmail: result.email ?? existing.accountEmail ?? 'unknown',
          refreshToken: result.refreshToken,
          grantedScopes: result.grantedScopes,
          status: 'ok',
          lastError: undefined,
        });
        invalidGrantCounters.delete(connectionId);
        // Clear the token provider's cached access token AND its latched
        // permanent-failure state. Without this the provider keeps fast-failing
        // every request with the pre-reconnect `invalid_grant`, so a user who
        // re-consents sees calendar sync stay dead until they reload the page.
        getCalendarClient().invalidateConnection(connectionId);
        void reconcileConnection(connectionId, { verifyExisting: true, force: true });
        return;
      }
      // connectionId gone (removed or remotely healed) — fall through to a create.
    }
    const connection = await createCalendarConnection({
      provider: 'google',
      accountEmail: result.email ?? 'unknown',
      destinationCalendarId: 'primary',
      refreshToken: result.refreshToken,
      grantedScopes: result.grantedScopes,
      status: 'ok',
    });
    invalidGrantCounters.delete(connection.id);
    // Kick a full verify reconcile for the new connection (don't block the UI).
    void reconcileConnection(connection.id, { verifyExisting: true, force: true });
  }

  /** Run the consent flow + create a family-wide connection. Returns the auth result.
   *  On a redirect surface (PWA/iOS/native) hands off to the redirect transport and
   *  returns `{status:'redirecting'}` — the resume completes it post-redirect. */
  async function connect(): Promise<CalendarConnectResult> {
    if (!isFlagEnabled(FLAG)) {
      return { status: 'failed', code: 'not_configured', message: 'Feature is not enabled.' };
    }
    const loginHint = getGoogleAccountEmail() ?? undefined;
    if (shouldUseRedirectAuth()) {
      await startCalendarRedirectAuth(buildCalendarReturnPath('connect'), loginHint, 'create');
      return { status: 'redirecting' };
    }
    const result = await connectGoogleCalendar({ loginHint });
    if (result.status !== 'connected') return result;
    await finalizeConnected(result);
    return result;
  }

  /** Re-run consent for an EXISTING connection (e.g. after needs_reconnect): updates
   *  its shared refresh token + scopes in place — never creates a duplicate. On a
   *  redirect surface hands off to the redirect transport (resume completes it). */
  async function reconnect(connectionId: string): Promise<CalendarConnectResult> {
    if (!isFlagEnabled(FLAG)) {
      return { status: 'failed', code: 'not_configured', message: 'Feature is not enabled.' };
    }
    const existing = await getCalendarConnectionById(connectionId);
    const loginHint = existing?.accountEmail;
    if (shouldUseRedirectAuth()) {
      await startCalendarRedirectAuth(
        buildCalendarReturnPath(connectionId),
        loginHint,
        'reconnect'
      );
      return { status: 'redirecting' };
    }
    const result = await connectGoogleCalendar({ loginHint });
    if (result.status !== 'connected') return result;
    await finalizeConnected(result, connectionId);
    return result;
  }

  /**
   * Resume a calendar connect/reconnect after a redirect round-trip. Called by the
   * App-level resume when it sees a pending `calResume` intent. Redeems the
   * one-time code (memoized), commits on success, and returns a typed result the
   * caller toasts from. Returns `null` when there was no pending calendar code
   * (a Drive redirect, or the user declined) — the caller shows nothing.
   */
  async function resumeRedirectConnect(intent: string): Promise<CalendarConnectResult | null> {
    if (!isFlagEnabled(FLAG)) return null;
    const result = await completeCalendarRedirectAuth();
    if (!result || result.status !== 'connected') return result;
    const connectionId = intent === 'connect' ? undefined : intent;
    await finalizeConnected(result, connectionId);
    return result;
  }

  /** Remove the connection: delete its events first, then drop its token + record. */
  /** Returns whether teardown fully completed (all remote events removed + record
   *  dropped). `false` means it's parked `disconnecting` and will retry next open. */
  async function disconnect(connectionId: string): Promise<boolean> {
    await updateCalendarConnection(connectionId, { status: 'disconnecting' });
    return finishDisconnect(connectionId);
  }

  /** Partial-failure-safe teardown — drops the record only once all events are gone.
   *  Returns whether every event cleared (record removed); `false` = stays parked. */
  async function finishDisconnect(connectionId: string): Promise<boolean> {
    const connection = await getCalendarConnectionById(connectionId);
    if (!connection) return true; // already gone — teardown is complete
    const client = getCalendarClient();
    const calendarId = connection.destinationCalendarId || 'primary';
    const links = await getCalendarEventLinksForConnection(connectionId);

    let allCleared = true;
    const tasks = links.map((link) => async () => {
      try {
        await client.deleteEvent(connectionId, calendarId, link.googleEventId);
        await removeCalendarEventLinkById(connectionId, link.activityId);
      } catch {
        allCleared = false; // keep the link; stays 'disconnecting', retried next open
      }
    });
    await runPooled(tasks, MAX_INFLIGHT);

    if (allCleared) {
      invalidGrantCounters.delete(connectionId);
      await removeCalendarConnection(connectionId);
    }
    return allCleared;
  }

  /**
   * Change the destination calendar — all-or-nothing (F6). Delete the old-calendar
   * events FIRST; only if every delete succeeds do we drop the links, switch, and
   * re-sync. On any failure we ABORT: `destinationCalendarId` stays on the old
   * calendar and ALL links are kept (the next reconcile resurrects any already-
   * deleted events on the old calendar — self-healing), so nothing is orphaned.
   */
  async function setDestinationCalendar(
    connectionId: string,
    calendarId: string
  ): Promise<{ ok: boolean }> {
    const connection = await getCalendarConnectionById(connectionId);
    if (!connection || connection.destinationCalendarId === calendarId) return { ok: true };
    const client = getCalendarClient();
    const oldCalendarId = connection.destinationCalendarId || 'primary';
    const links = await getCalendarEventLinksForConnection(connectionId);

    // Delete-only pass. Keep ALL links until we know the old calendar is fully cleared.
    let allCleared = true;
    let failures = 0;
    const tasks = links.map((link) => async () => {
      try {
        await client.deleteEvent(connectionId, oldCalendarId, link.googleEventId);
      } catch {
        allCleared = false;
        failures++;
      }
    });
    await runPooled(tasks, MAX_INFLIGHT);

    if (!allCleared) {
      reportError({
        surface: 'calendar-sync',
        message: `[calendarSync] destination switch aborted: ${failures} old-calendar delete(s) failed`,
        severity: 'warning',
        context: { connectionId },
      });
      return { ok: false }; // destination + all links unchanged; reconcile self-heals
    }

    // Cleared → drop links, switch, re-sync onto the new calendar.
    for (const link of links) await removeCalendarEventLinkById(connectionId, link.activityId);
    await updateCalendarConnection(connectionId, { destinationCalendarId: calendarId });
    void reconcileConnection(connectionId, { verifyExisting: true, force: true });
    return { ok: true };
  }

  /** Calendars for the destination picker. Falls back to a primary-only option if the
   *  calendarlist scope was dropped under granular consent (no silent empty list). */
  async function listCalendarsFor(connectionId: string): Promise<CalendarSummary[]> {
    const connection = await getCalendarConnectionById(connectionId);
    if (!connection) return [];
    // Fallback option mirrors the stored id so the picker always shows it selected.
    // Empty summary → the Vue layer renders the localized "Primary calendar" label
    // (i18n stays in the view, not the store). (F9)
    const fallback: CalendarSummary[] = [
      { id: connection.destinationCalendarId || 'primary', summary: '', primary: true },
    ];
    const hasScope = connection.grantedScopes.some((s) => s.includes('calendar.calendarlist'));
    if (!hasScope) return fallback;
    try {
      const calendars = await getCalendarClient().listCalendars(connectionId);
      // CalendarList returns the primary calendar's REAL id (the account email),
      // never the literal alias 'primary' — so a connection still defaulting to
      // 'primary' wouldn't match any option and the picker shows blank. Normalize
      // it to the concrete primary id (same calendar → no event churn) so the
      // default reflects as selected.
      if (connection.destinationCalendarId === 'primary') {
        const primary = calendars.find((c) => c.primary);
        if (primary)
          await updateCalendarConnection(connectionId, { destinationCalendarId: primary.id });
      }
      return calendars;
    } catch (e) {
      reportError({
        surface: 'calendar-sync',
        message: '[calendarSync] listCalendars failed',
        error: e,
        severity: 'warning',
        context: { connectionId },
      });
      return fallback;
    }
  }

  /** Manual "Sync now" — full verify reconcile, bypassing the freshness skip. */
  async function syncNow(connectionId?: string): Promise<SyncOutcome | void> {
    if (connectionId) {
      return reconcileConnection(connectionId, { verifyExisting: true, force: true });
    }
    await reconcileAll({ verifyExisting: true, force: true });
  }

  // ── Triggers (registered only when the flag is on) ──────────────────────────

  function start(): void {
    if (started || !isFlagEnabled(FLAG)) return;
    started = true;

    // Periodic full verify reconcile + a verify pass on every become-visible.
    pollHandle = usePollWhileVisible(
      () => reconcileAll({ verifyExisting: true }),
      RECONCILE_POLL_MS,
      { fireImmediatelyOnVisible: true, surface: 'calendar-sync' }
    );

    // Activity edits → a fast, no-verify push (debounced to coalesce bulk edits).
    // Watch the ACTIVITY store specifically (not the doc-wide `docVersion`): the
    // reconcile's own writes touch `calendarConnections`, not `activities`, so they
    // can't re-trigger this — killing the self-loop and the cross-device ping-pong —
    // and unrelated mutations (photos/transactions/…) no longer wake the engine. (F1)
    const activityStore = useActivityStore();
    stopActivityWatch = watch(
      () => activityStore.activities,
      () => {
        if (editDebounce) clearTimeout(editDebounce);
        editDebounce = setTimeout(() => {
          if (isVisible.value) void reconcileAll({ verifyExisting: false });
        }, EDIT_DEBOUNCE_MS);
      }
    );
  }

  function stop(): void {
    started = false;
    pollHandle?.stop();
    pollHandle = null;
    stopActivityWatch?.();
    stopActivityWatch = null;
    if (editDebounce) clearTimeout(editDebounce);
    editDebounce = null;
    // Reset module-level engine state so a new session/family starts clean (F7).
    resetCalendarClient();
    invalidGrantCounters.clear();
    reconcileErrorCounters.clear();
  }

  return {
    connections,
    reconnectNeededConnection,
    showCalendarReconnect,
    connect,
    reconnect,
    resumeRedirectConnect,
    disconnect,
    setDestinationCalendar,
    listCalendarsFor,
    syncNow,
    start,
    stop,
  };
});
