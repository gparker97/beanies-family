// External-calendar clash orchestrator (#34) — READ-ONLY.
//
// MVO Orchestrator (separate from calendarSyncStore, which WRITES): reads event
// TIMES (via the field-masked events.list seam — never event content) on the
// connected calendars over the visible planner window, excludes beanies' OWN synced
// events, and decorates beanies activities that overlap an external commitment.
// View-only calendars (plan 2026-11-17 A5) are further busy sources: their times
// come from calendarViewStore's already-fetched events, never a second request.
// Dependency direction: this store imports the sync and view stores; neither of
// them imports this store or each other.
// Privacy-preserving — times only, never titles/notes/location/attendees. Writes
// NOTHING to any calendar.
//
// Reliability/contract notes:
//  - All state is store-scoped (no module-level mutable cache) so a single stop()
//    deterministically tears everything down.
//  - `clashes` is recomputed by REPLACING the ref (never mutating the Map in place)
//    so Vue reactivity fires and indicators actually appear when data lands.
//  - The cache stores RAW event times; the beanies-owned exclusion is recomputed per
//    recompute() (occurrence-derived, changes independently of the window).
//  - Event times live ONLY in an ephemeral in-memory cache (short TTL); never
//    persisted to disk, never sent to a beanies server.
//  - Read failures degrade silently to the USER (no toast) but are always
//    classified + reported (console/Slack) — never a bare catch.

import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { isFlagEnabled } from '@/config/flags';
import { reportError } from '@/utils/errorReporter';
import { getCalendarClient } from '@/services/calendar/clientInstance';
import { runPooled } from '@/utils/calendar/runPooled';
import {
  computeClashes,
  externalBusyIntervals,
  clashKey,
  type ActivityOccurrence,
  type BusySource,
  type ClashInfo,
} from '@/utils/calendar/clashDetection';
import { beaniesEventIds } from '@/utils/calendar/beaniesEventIds';
import { CLASH_BUSY_TTL_MS, MAX_INFLIGHT } from '@/utils/calendar/limits';
import { isDocLoaded } from '@/services/automerge/docService';
import { list as projectionList } from '@/services/automerge/projection';
import type { EventTime } from '@/services/calendar/CalendarClient';
import { useCalendarSyncStore } from '@/stores/calendarSyncStore';
import { useCalendarViewStore } from '@/stores/calendarViewStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { calendarInUse } from '@/utils/calendar/connectEligibility';
import type { CalendarConnection } from '@/types/models';

const FLAG = 'calendarClashNudge';

interface BusyCacheEntry {
  windowKey: string;
  /** Raw event times for the window — exclusion is recomputed per recompute()
   *  because the beanies-owned id set is occurrence-derived (changes independently
   *  of the time window). Do NOT cache the post-exclusion result. */
  events: EventTime[];
  fetchedAt: number;
}

/** The window + occurrences of the latest `ensureBusyForWindow` call, kept so a
 *  change in view events can recompute without a fetch. */
interface LastRequest {
  windowKey: string;
  occurrences: ActivityOccurrence[];
}

export const useCalendarClashStore = defineStore('calendarClash', () => {
  const syncStore = useCalendarSyncStore();
  const viewStore = useCalendarViewStore();
  const settingsStore = useSettingsStore();

  // ── Ephemeral state (store-scoped; cleared in one place by stop()) ──────────
  /** connection id → busy intervals for a window. In-memory only, never persisted.
   *  Viewed calendars are not cached here: their events live in calendarViewStore. */
  const busyCache = new Map<string, BusyCacheEntry>();
  /** activity-occurrence key → clash. Recomputed by REASSIGNMENT (reactivity). */
  const clashes = ref<Map<string, ClashInfo>>(new Map());
  /** The window a fetch is currently running for — short-circuits duplicate fetches. */
  let inFlightWindowKey: string | null = null;
  /** The planner's latest window, for the view-events recompute. */
  let lastRequest: LastRequest | null = null;

  /** All connected calendars. Every stored connection holds `events.owned`
   *  (#32 REQUIRED_SCOPE), so every connection is readable — no partial-grant
   *  filtering needed. */
  function connectedCalendars(): CalendarConnection[] {
    return syncStore.connections;
  }

  const hasConnectedCalendar = computed(() => syncStore.connections.length > 0);

  /** Feature is live only when the flag + the user toggle are on AND at least one
   *  calendar is connected or viewed. */
  const isAvailable = computed(
    () =>
      isFlagEnabled(FLAG) &&
      settingsStore.calendarClashNudgeEnabled &&
      (hasConnectedCalendar.value || viewStore.isActive)
  );

  function windowKeyOf(timeMinIso: string, timeMaxIso: string): string {
    return `${timeMinIso}|${timeMaxIso}`;
  }

  /** Read + cache event times for one connection (failure → absent, reported). */
  async function fetchEventTimes(
    connection: CalendarConnection,
    windowKey: string,
    timeMinIso: string,
    timeMaxIso: string
  ): Promise<void> {
    const calendarId = connection.destinationCalendarId || 'primary';
    try {
      const events = await getCalendarClient().listEventTimes(
        connection.id,
        calendarId,
        timeMinIso,
        timeMaxIso
      );
      busyCache.set(connection.id, { windowKey, events, fetchedAt: Date.now() });
    } catch (e) {
      // Silent to the USER (no toast — anti-spam) but ALWAYS classified + reported.
      reportError({
        surface: 'calendar-clash',
        message: '[calendarClash] event-times read failed',
        error: e,
        severity: 'warning',
        context: { connectionId: connection.id },
      });
      // Treat as absent for this window; cache empty so a transient failure doesn't
      // refetch-storm within the TTL. Re-attempted on the next window/TTL change.
      busyCache.set(connection.id, { windowKey, events: [], fetchedAt: Date.now() });
    }
  }

  /**
   * Recompute the decoration map (pure) from the cache for the given window. Builds
   * the beanies-owned exclusion set fresh from the current occurrences (so it never
   * drifts from the cached times), then filters each connection's events down to the
   * OTHER busy intervals before the overlap pass.
   */
  function recompute(
    connections: CalendarConnection[],
    windowKey: string,
    occurrences: ActivityOccurrence[]
  ): void {
    // `deterministicEventId` THROWS on a blank/corrupt activity id. recompute runs
    // from a fire-and-forget `void ensureBusyForWindow(...)`, so an uncaught throw
    // would become a silent unhandled rejection. `beaniesEventIds` skips that
    // occurrence from the self-exclusion set and hands it here to be reported,
    // rather than aborting the pass. The links add adopted and imported events,
    // whose Google ids are not derived from the activity id.
    const beanieEventIds = beaniesEventIds(
      occurrences.map((o) => o.activity.id),
      isDocLoaded() ? projectionList('calendarEventLinks') : [],
      (activityId, e) =>
        reportError({
          surface: 'calendar-clash',
          message:
            '[calendarClash] could not derive event id for occurrence; skipping it from the self-exclusion set',
          error: e,
          severity: 'warning',
          context: { activity_id: activityId },
        })
    );

    // Source order is fixed because computeClashes is first-source-wins:
    // connections first (their existing order), then viewed calendars.
    const ownSources: BusySource[] = connections.map((connection) => {
      const entry = busyCache.get(connection.id);
      const events = entry && entry.windowKey === windowKey ? entry.events : [];
      return {
        sourceId: connection.id,
        source: 'own',
        sourceName: connection.accountEmail,
        intervals: externalBusyIntervals(events, beanieEventIds),
      };
    });
    clashes.value = computeClashes(occurrences, [
      ...ownSources,
      ...viewedSources(connections, beanieEventIds),
    ]);
  }

  /**
   * One busy source per viewed calendar, in `createdAt` order (the view store's
   * `calendars` order). Times come from the view store's in-memory events, which
   * cover the planner window (screen window widened by a period each side), so no
   * request is made here. A viewed calendar that IS a connection's destination is
   * skipped: it is already a source, and counting it twice would quiet it under a
   * second acknowledgement key. "Is a connection's destination" is the one rule
   * (`calendarInUse`, the `'primary'` alias resolved on both sides), counting a
   * `disconnecting` connection too, because this store reads every connection as a
   * source. The add step and both stores' guards keep the pair from being created,
   * but a flag-off or older device cannot, so the skip must hold for an existing
   * pair. Transparent ("free") and beanies-owned events are dropped exactly as for
   * a connection.
   */
  function viewedSources(
    connections: CalendarConnection[],
    beanieEventIds: ReadonlySet<string>
  ): BusySource[] {
    if (!viewStore.isActive) return [];
    const accountEmail = new Map(viewStore.accounts.map((a) => [a.id, a.accountEmail] as const));
    const uses = { connections, viewed: [] };
    const eventsByCalendar = new Map<string, EventTime[]>();
    for (const e of viewStore.events) {
      const list = eventsByCalendar.get(e.viewedCalendarId);
      if (list) list.push(e);
      else eventsByCalendar.set(e.viewedCalendarId, [e]);
    }
    return viewStore.calendars
      .filter(
        (cal) =>
          calendarInUse(cal.calendarId, accountEmail.get(cal.viewAccountId), uses, {
            countDisconnecting: true,
          }) !== 'sync'
      )
      .map((cal) => ({
        sourceId: cal.id,
        source: 'viewed' as const,
        sourceName: cal.name,
        intervals: externalBusyIntervals(eventsByCalendar.get(cal.id) ?? [], beanieEventIds),
      }));
  }

  /**
   * Ensure busy data for the visible window, then recompute clashes. View-driven
   * (the planner calls this when its window changes). Never blocks render — the
   * caller awaits nothing UI-critical; indicators appear reactively when this
   * resolves. Debounce + the in-flight guard keep rapid navigation from stacking
   * or over-querying.
   */
  async function ensureBusyForWindow(
    timeMinIso: string,
    timeMaxIso: string,
    occurrences: ActivityOccurrence[]
  ): Promise<void> {
    if (!isAvailable.value) {
      if (clashes.value.size > 0) clashes.value = new Map();
      return;
    }
    const windowKey = windowKeyOf(timeMinIso, timeMaxIso);
    lastRequest = { windowKey, occurrences };
    // A fetch for this exact window is already running → don't duplicate it.
    if (inFlightWindowKey === windowKey) return;

    const connections = connectedCalendars();
    const stale = connections.filter((c) => {
      const e = busyCache.get(c.id);
      return !(e && e.windowKey === windowKey && Date.now() - e.fetchedAt < CLASH_BUSY_TTL_MS);
    });

    if (stale.length > 0) {
      inFlightWindowKey = windowKey;
      try {
        await runPooled(
          stale.map((c) => () => fetchEventTimes(c, windowKey, timeMinIso, timeMaxIso)),
          MAX_INFLIGHT
        );
      } finally {
        if (inFlightWindowKey === windowKey) inFlightWindowKey = null;
      }
    }

    recompute(connections, windowKey, occurrences);
  }

  /** Reactive clash lookup for a single activity occurrence. */
  function clashFor(activityId: string, occurrenceDate: string): ClashInfo | undefined {
    return clashes.value.get(clashKey(activityId, occurrenceDate));
  }

  // Turning the feature off (toggle / scope revoke) must clear indicators
  // immediately, without waiting for the next planner navigation.
  watch(isAvailable, (avail) => {
    if (!avail && clashes.value.size > 0) clashes.value = new Map();
  });

  // View events land on their own schedule (window debounce, TTL poll, return to
  // the app). Recompute purely from the caches for the latest window. NOT through
  // ensureBusyForWindow: it returns early while the same window is in flight and
  // would drop this update. A connection whose fetch is still running reads as
  // empty here; that fetch's own recompute fills it in when it lands.
  watch(
    () => viewStore.events,
    () => {
      if (!isAvailable.value || !lastRequest) return;
      recompute(connectedCalendars(), lastRequest.windowKey, lastRequest.occurrences);
    }
  );

  /** Tear down all ephemeral state on sign-out / family-switch. */
  function stop(): void {
    busyCache.clear();
    inFlightWindowKey = null;
    lastRequest = null;
    if (clashes.value.size > 0) clashes.value = new Map();
  }

  return {
    isAvailable,
    hasConnectedCalendar,
    ensureBusyForWindow,
    clashFor,
    stop,
  };
});
