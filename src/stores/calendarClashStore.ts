// External-calendar clash orchestrator (#34) — READ-ONLY.
//
// MVO Orchestrator (separate from calendarSyncStore, which WRITES): reads event
// TIMES (via the field-masked events.list seam — never event content) on the
// connected calendars over the visible planner window, excludes beanies' OWN synced
// events, and decorates beanies activities that overlap an external commitment.
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
  type ClashInfo,
  type ConnectionBusy,
} from '@/utils/calendar/clashDetection';
import { deterministicEventId } from '@/utils/calendar/deterministicEventId';
import type { EventTime } from '@/services/calendar/CalendarClient';
import { useCalendarSyncStore } from '@/stores/calendarSyncStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { CalendarConnection } from '@/types/models';

const FLAG = 'calendarClashNudge';
/** Event times are re-read at most once per (connection, window) per this TTL. */
const CLASH_BUSY_TTL_MS = 300_000; // 5 min
/** Bounded concurrency over connections. */
const MAX_INFLIGHT = 5;

interface BusyCacheEntry {
  windowKey: string;
  /** Raw event times for the window — exclusion is recomputed per recompute()
   *  because the beanies-owned id set is occurrence-derived (changes independently
   *  of the time window). Do NOT cache the post-exclusion result. */
  events: EventTime[];
  fetchedAt: number;
}

export const useCalendarClashStore = defineStore('calendarClash', () => {
  const syncStore = useCalendarSyncStore();
  const settingsStore = useSettingsStore();

  // ── Ephemeral state (store-scoped; cleared in one place by stop()) ──────────
  /** connectionId → busy intervals for a window. In-memory only, never persisted. */
  const busyCache = new Map<string, BusyCacheEntry>();
  /** activity-occurrence key → clash. Recomputed by REASSIGNMENT (reactivity). */
  const clashes = ref<Map<string, ClashInfo>>(new Map());
  /** The window a fetch is currently running for — short-circuits duplicate fetches. */
  let inFlightWindowKey: string | null = null;

  /** All connected calendars. Every stored connection holds `events.owned`
   *  (#32 REQUIRED_SCOPE), so every connection is readable — no partial-grant
   *  filtering needed. */
  function connectedCalendars(): CalendarConnection[] {
    return syncStore.connections;
  }

  const hasConnectedCalendar = computed(() => syncStore.connections.length > 0);

  /** Feature is live only when the flag + the user toggle are on AND at least one
   *  calendar is connected. */
  const isAvailable = computed(
    () =>
      isFlagEnabled(FLAG) && settingsStore.calendarClashNudgeEnabled && hasConnectedCalendar.value
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
    // would become a silent unhandled rejection — guard each call: report once and
    // skip that occurrence from the self-exclusion set rather than aborting the pass.
    const beanieEventIds = new Set<string>();
    for (const o of occurrences) {
      try {
        beanieEventIds.add(deterministicEventId(o.activity.id));
      } catch (e) {
        reportError({
          surface: 'calendar-clash',
          message:
            '[calendarClash] could not derive event id for occurrence; skipping it from the self-exclusion set',
          error: e,
          severity: 'warning',
          context: { activityId: o.activity.id },
        });
      }
    }

    const busyByConnection: ConnectionBusy[] = connections.map((connection) => {
      const entry = busyCache.get(connection.id);
      const events = entry && entry.windowKey === windowKey ? entry.events : [];
      return {
        connectionId: connection.id,
        calendarLabel: connection.accountEmail,
        intervals: externalBusyIntervals(events, beanieEventIds),
      };
    });
    clashes.value = computeClashes(occurrences, busyByConnection);
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

  /** Tear down all ephemeral state on sign-out / family-switch. */
  function stop(): void {
    busyCache.clear();
    inFlightWindowKey = null;
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
