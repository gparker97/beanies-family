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
import { docVersion, getDoc, isDocLoaded } from '@/services/automerge/docService';
import { toISODateString } from '@/utils/date';
import { generateUUID } from '@/utils/id';
import { reportError } from '@/utils/errorReporter';
import { isFlagEnabled } from '@/config/flags';
import { useToday } from '@/composables/useToday';
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
  isCalendarConnectSupported,
  type CalendarConnectResult,
} from '@/services/calendar/calendarAuth';
import {
  createGoogleCalendarClient,
  createGoogleTokenProvider,
} from '@/services/calendar/googleCalendarClient';
import {
  CalendarApiError,
  type CalendarClient,
  type CalendarErrorKind,
  type CalendarSummary,
} from '@/services/calendar/CalendarClient';
import {
  activityToGoogleEvent,
  type ActivityMapContext,
  type GoogleEventResource,
} from '@/utils/calendar/activityToGoogleEvent';
import { planReconcile, type ReconcileUpsert } from '@/utils/calendar/reconcilePlan';
import type { CalendarConnection } from '@/types/models';

const FLAG = 'googleCalendarSync';

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

/** User-facing error registry — exhaustive over CalendarErrorKind (i18n keys for Layer 6/7). */
export const CALENDAR_SYNC_ERRORS = {
  auth: { messageKey: 'calendarSync.error.auth', severity: 'warning' },
  forbidden: { messageKey: 'calendarSync.error.forbidden', severity: 'error' },
  not_found: { messageKey: 'calendarSync.error.notFound', severity: 'warning' },
  conflict: { messageKey: 'calendarSync.error.conflict', severity: 'warning' },
  rate_limited: { messageKey: 'calendarSync.error.rateLimited', severity: 'warning' },
  transient: { messageKey: 'calendarSync.error.transient', severity: 'warning' },
  unknown: { messageKey: 'calendarSync.error.unknown', severity: 'error' },
} as const satisfies Record<
  CalendarErrorKind,
  { messageKey: string; severity: 'warning' | 'error' }
>;

// ── Module-level engine state (per page/device, not in the CRDT) ──────────────

let clientImpl: CalendarClient | null = null;
/** Device-local K-counter for invalid_grant (kept out of the CRDT — Pass 4). */
const invalidGrantCounters = new Map<string, number>();

/** Test seam — inject a fake CalendarClient. */
export function setCalendarClientForTesting(client: CalendarClient | null): void {
  clientImpl = client;
}

function getClient(): CalendarClient {
  if (!clientImpl) clientImpl = createGoogleCalendarClient(createGoogleTokenProvider());
  return clientImpl;
}

function nowIso(): string {
  return toISODateString(new Date());
}

function todayYmd(): string {
  return nowIso().slice(0, 10);
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

/** Member-name resolver + app origin + timezone for the event mapper. */
function buildMapContext(): ActivityMapContext {
  const members = isDocLoaded() ? getDoc().familyMembers : {};
  const nameById = new Map(Object.values(members).map((m) => [m.id, m.name]));
  return {
    memberName: (id) => nameById.get(id),
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

/** Bounded-concurrency pool. Each task owns its try/catch; the pool never rejects. */
async function runPooled(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const task = tasks[next++];
      await task();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useCalendarSyncStore = defineStore('calendarSync', () => {
  const deviceId = getDeviceId();
  const { isVisible } = useToday();

  /** Reactive projection of connections from the CRDT (re-reads on docVersion bump). */
  const connections = computed<CalendarConnection[]>(() => {
    void docVersion.value;
    if (!isDocLoaded()) return [];
    return Object.values(getDoc().calendarConnections ?? {});
  });

  const isConnectSupported = computed(() => isCalendarConnectSupported());

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

  /** Upsert (insert/patch) the link record for an activity↔event mapping. */
  async function recordLink(
    connectionId: string,
    activityId: string,
    googleEventId: string,
    hash: string
  ): Promise<void> {
    const existing = await getCalendarEventLink(connectionId, activityId);
    const lastPushedAt = nowIso();
    if (existing) {
      await updateCalendarEventLink(existing.id, {
        googleEventId,
        lastPushedHash: hash,
        lastPushedAt,
      });
    } else {
      await createCalendarEventLink({
        connectionId,
        activityId,
        googleEventId,
        lastPushedHash: hash,
        lastPushedAt,
      });
    }
  }

  /** Apply one upsert. `verifyExisting` does a remote-existence probe for unchanged
   *  events (re-creates a manually-deleted one). Throws CalendarApiError on failure. */
  async function applyUpsert(
    client: CalendarClient,
    connectionId: string,
    calendarId: string,
    u: ReconcileUpsert,
    ctx: ActivityMapContext,
    verifyExisting: boolean
  ): Promise<void> {
    const resource = activityToGoogleEvent(u.activity, ctx);
    const hasLink = u.existingHash !== undefined;

    if (!hasLink) {
      await createOrResurrect(client, connectionId, calendarId, u.eventId, resource);
      await recordLink(connectionId, u.activity.id, u.eventId, u.hash);
      return;
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
      return;
    }

    // Unchanged. On a verify pass, restore the event if it was deleted/cancelled
    // in Google (eventExists treats a cancelled event as missing).
    if (verifyExisting) {
      const exists = await client.eventExists(connectionId, calendarId, u.eventId);
      if (!exists) {
        await createOrResurrect(client, connectionId, calendarId, u.eventId, resource);
        await recordLink(connectionId, u.activity.id, u.eventId, u.hash);
      }
    }
  }

  /**
   * Reconcile one connection. `verifyExisting` toggles the remote-existence probe
   * for unchanged events. `force` bypasses the freshness skip (manual / connect).
   */
  async function reconcileConnection(
    connectionId: string,
    opts: { verifyExisting: boolean; force?: boolean }
  ): Promise<void> {
    const connection = await getCalendarConnectionById(connectionId);
    if (!connection) return;

    // A connection mid-disconnect retries its teardown instead of syncing.
    if (connection.status === 'disconnecting') {
      await finishDisconnect(connectionId);
      return;
    }
    if (!opts.force && shouldSkipForFreshness(connection)) return;

    await withConnectionLock(connectionId, async () => {
      const client = getClient();
      const calendarId = connection.destinationCalendarId || 'primary';
      const ctx = buildMapContext();
      const activities = await getAllActivities();
      const links = await getCalendarEventLinksForConnection(connectionId);
      const plan = planReconcile(activities, links, todayYmd());

      const errors: CalendarApiError[] = [];
      const record = (e: unknown) => {
        errors.push(e instanceof CalendarApiError ? e : new CalendarApiError('unknown', String(e)));
      };

      const tasks: Array<() => Promise<void>> = [
        ...plan.upserts.map(
          (u) => () =>
            applyUpsert(client, connectionId, calendarId, u, ctx, opts.verifyExisting).catch(record)
        ),
        ...plan.deletes.map((link) => async () => {
          try {
            await client.deleteEvent(connectionId, calendarId, link.googleEventId);
            await removeCalendarEventLinkById(connectionId, link.activityId);
          } catch (e) {
            record(e);
          }
        }),
      ];

      await runPooled(tasks, MAX_INFLIGHT);
      await settleConnectionStatus(connection, errors);

      // Diagnostic (prod-off feature) — surfaces what each connection actually did,
      // so a per-account discrepancy is visible in the console rather than guessed at.
      const kinds = errors.length ? [...new Set(errors.map((e) => e.kind))].join(',') : 'none';
      console.warn(
        `[calendarSync] reconciled ${connection.accountEmail} (cal=${calendarId}): ` +
          `${plan.upserts.length} activities, ${plan.deletes.length} deletes, ${errors.length} errors [${kinds}]`
      );
    });
  }

  /** Translate the batch's errors into the connection's status (shared-token-safe). */
  async function settleConnectionStatus(
    connection: CalendarConnection,
    errors: CalendarApiError[]
  ): Promise<void> {
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
          message: `[calendarSync] connection parked needs_reconnect after ${n} auth failures`,
          severity: 'warning',
          context: { connectionId: connection.id },
        });
      }
      return;
    }

    // Any successful access resets the device-local auth counter + self-heals.
    invalidGrantCounters.delete(connection.id);

    const otherErrors = errors.filter((e) => e.kind !== 'auth');
    if (otherErrors.length > 0) {
      const worst = otherErrors[0];
      const prevFailures = connection.consecutiveFailures ?? 0;
      await updateCalendarConnection(connection.id, {
        status: 'error',
        lastError: worst.kind,
        consecutiveFailures: prevFailures + 1,
        lastReconciledAt: nowIso(),
        lastReconciledBy: deviceId,
      });
      // Report once on transition into error.
      if (connection.status !== 'error') {
        reportError({
          surface: 'calendar-sync',
          message: `[calendarSync] reconcile error (${worst.kind}): ${worst.message}`,
          error: worst,
          severity: CALENDAR_SYNC_ERRORS[worst.kind].severity,
          context: { connectionId: connection.id },
        });
      }
      return;
    }

    // Clean success → ok + freshness-claim.
    await updateCalendarConnection(connection.id, {
      status: 'ok',
      lastError: undefined,
      consecutiveFailures: 0,
      lastSyncedAt: nowIso(),
      lastReconciledAt: nowIso(),
      lastReconciledBy: deviceId,
    });
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

  /** Run the consent flow + create a family-wide connection. Returns the auth result. */
  async function connect(): Promise<CalendarConnectResult> {
    if (!isFlagEnabled(FLAG)) {
      return { status: 'failed', code: 'not_configured', message: 'Feature is not enabled.' };
    }
    const result = await connectGoogleCalendar({ loginHint: getGoogleAccountEmail() ?? undefined });
    if (result.status !== 'connected') return result;

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
    return result;
  }

  /** Re-run consent for an EXISTING connection (e.g. after needs_reconnect): updates
   *  its shared refresh token + scopes in place — never creates a duplicate. */
  async function reconnect(connectionId: string): Promise<CalendarConnectResult> {
    if (!isFlagEnabled(FLAG)) {
      return { status: 'failed', code: 'not_configured', message: 'Feature is not enabled.' };
    }
    const existing = await getCalendarConnectionById(connectionId);
    const result = await connectGoogleCalendar({ loginHint: existing?.accountEmail });
    if (result.status !== 'connected') return result;
    await updateCalendarConnection(connectionId, {
      accountEmail: result.email ?? existing?.accountEmail ?? 'unknown',
      refreshToken: result.refreshToken,
      grantedScopes: result.grantedScopes,
      status: 'ok',
      lastError: undefined,
      consecutiveFailures: 0,
    });
    invalidGrantCounters.delete(connectionId);
    void reconcileConnection(connectionId, { verifyExisting: true, force: true });
    return result;
  }

  /** Remove the connection: delete its events first, then drop its token + record. */
  async function disconnect(connectionId: string): Promise<void> {
    await updateCalendarConnection(connectionId, { status: 'disconnecting' });
    await finishDisconnect(connectionId);
  }

  /** Partial-failure-safe teardown — drops the record only once all events are gone. */
  async function finishDisconnect(connectionId: string): Promise<void> {
    const connection = await getCalendarConnectionById(connectionId);
    if (!connection) return;
    const client = getClient();
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
  }

  /** Change the destination calendar: remove events from the old one, then re-sync. */
  async function setDestinationCalendar(connectionId: string, calendarId: string): Promise<void> {
    const connection = await getCalendarConnectionById(connectionId);
    if (!connection || connection.destinationCalendarId === calendarId) return;
    const client = getClient();
    const oldCalendarId = connection.destinationCalendarId || 'primary';
    const links = await getCalendarEventLinksForConnection(connectionId);

    const tasks = links.map((link) => async () => {
      try {
        await client.deleteEvent(connectionId, oldCalendarId, link.googleEventId);
      } catch {
        /* best-effort cleanup of the old calendar */
      }
      await removeCalendarEventLinkById(connectionId, link.activityId);
    });
    await runPooled(tasks, MAX_INFLIGHT);

    await updateCalendarConnection(connectionId, { destinationCalendarId: calendarId });
    void reconcileConnection(connectionId, { verifyExisting: true, force: true });
  }

  /** Calendars for the destination picker. Falls back to a primary-only option if the
   *  calendarlist scope was dropped under granular consent (no silent empty list). */
  async function listCalendarsFor(connectionId: string): Promise<CalendarSummary[]> {
    const connection = await getCalendarConnectionById(connectionId);
    if (!connection) return [];
    // Fallback option mirrors the stored id so the picker always shows it selected.
    const fallback: CalendarSummary[] = [
      {
        id: connection.destinationCalendarId || 'primary',
        summary: 'Primary calendar',
        primary: true,
      },
    ];
    const hasScope = connection.grantedScopes.some((s) => s.includes('calendar.calendarlist'));
    if (!hasScope) return fallback;
    try {
      const calendars = await getClient().listCalendars(connectionId);
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
  async function syncNow(connectionId?: string): Promise<void> {
    if (connectionId) {
      await reconcileConnection(connectionId, { verifyExisting: true, force: true });
    } else {
      await reconcileAll({ verifyExisting: true, force: true });
    }
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

    // Edits → a fast, no-verify push (debounced to coalesce bulk edits).
    stopActivityWatch = watch(
      () => (isDocLoaded() ? docVersion.value : 0),
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
  }

  return {
    connections,
    isConnectSupported,
    connect,
    reconnect,
    disconnect,
    setDestinationCalendar,
    listCalendarsFor,
    syncNow,
    start,
    stop,
  };
});
