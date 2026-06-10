// External-calendar clash orchestrator (#34) — READ-ONLY.
//
// MVO Orchestrator (separate from calendarSyncStore, which WRITES): queries Google
// free/busy for the connected calendars over the visible planner window and
// decorates beanies activities that overlap a busy block. Privacy-preserving —
// availability only, never event details. Writes NOTHING to any calendar.
//
// Reliability/contract notes:
//  - All state is store-scoped (no module-level mutable cache) so a single stop()
//    deterministically tears everything down.
//  - `clashes` is recomputed by REPLACING the ref (never mutating the Map in place)
//    so Vue reactivity fires and indicators actually appear when busy data lands.
//  - Busy data lives ONLY in an ephemeral in-memory cache (short TTL); never
//    persisted to disk, never sent to a beanies server.
//  - Free/busy failures degrade silently to the USER (no toast) but are always
//    classified + reported (console/Slack) — never a bare catch.

import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { isFlagEnabled } from '@/config/flags';
import { reportError } from '@/utils/errorReporter';
import { getCalendarClient } from '@/services/calendar/clientInstance';
import { runPooled } from '@/utils/calendar/runPooled';
import {
  computeClashes,
  clashKey,
  type ActivityOccurrence,
  type ClashInfo,
  type ConnectionBusy,
} from '@/utils/calendar/clashDetection';
import type { BusyInterval } from '@/services/calendar/CalendarClient';
import { useCalendarSyncStore } from '@/stores/calendarSyncStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { CalendarConnection } from '@/types/models';

const FLAG = 'calendarClashNudge';
const FREEBUSY_SCOPE = 'calendar.freebusy';
/** Busy data is re-queried at most once per (connection, window) per this TTL. */
const CLASH_BUSY_TTL_MS = 300_000; // 5 min
/** Bounded concurrency over connections. */
const MAX_INFLIGHT = 5;

interface BusyCacheEntry {
  windowKey: string;
  intervals: BusyInterval[];
  fetchedAt: number;
}

function hasFreebusy(connection: CalendarConnection): boolean {
  return connection.grantedScopes.some((s) => s.includes(FREEBUSY_SCOPE));
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

  /** Connections that actually granted the freebusy scope (partial-grant safe). */
  function freebusyConnections(): CalendarConnection[] {
    return syncStore.connections.filter(hasFreebusy);
  }

  const someConnectionHasFreebusy = computed(() => syncStore.connections.some(hasFreebusy));

  /** Feature is live only when the flag + the user toggle are on AND at least one
   *  connection granted free/busy. */
  const isAvailable = computed(
    () =>
      isFlagEnabled(FLAG) &&
      settingsStore.calendarClashNudgeEnabled &&
      someConnectionHasFreebusy.value
  );

  function windowKeyOf(timeMinIso: string, timeMaxIso: string): string {
    return `${timeMinIso}|${timeMaxIso}`;
  }

  /** Fetch + cache busy intervals for one connection (failure → absent, reported). */
  async function fetchBusy(
    connection: CalendarConnection,
    windowKey: string,
    timeMinIso: string,
    timeMaxIso: string
  ): Promise<void> {
    const calendarId = connection.destinationCalendarId || 'primary';
    try {
      const result = await getCalendarClient().queryFreeBusy(
        connection.id,
        [calendarId],
        timeMinIso,
        timeMaxIso
      );
      const intervals = Object.values(result).flat();
      busyCache.set(connection.id, { windowKey, intervals, fetchedAt: Date.now() });
    } catch (e) {
      // Silent to the USER (no toast — anti-spam) but ALWAYS classified + reported.
      reportError({
        surface: 'calendar-clash',
        message: '[calendarClash] free/busy query failed',
        error: e,
        severity: 'warning',
        context: { connectionId: connection.id },
      });
      // Treat as absent for this window; cache empty so a transient failure doesn't
      // refetch-storm within the TTL. Re-attempted on the next window/TTL change.
      busyCache.set(connection.id, { windowKey, intervals: [], fetchedAt: Date.now() });
    }
  }

  /** Recompute the decoration map (pure) from the cache for the given window. */
  function recompute(
    connections: CalendarConnection[],
    windowKey: string,
    occurrences: ActivityOccurrence[]
  ): void {
    const busyByConnection: ConnectionBusy[] = connections.map((connection) => {
      const entry = busyCache.get(connection.id);
      return {
        connectionId: connection.id,
        calendarLabel: connection.accountEmail,
        intervals: entry && entry.windowKey === windowKey ? entry.intervals : [],
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

    const connections = freebusyConnections();
    const stale = connections.filter((c) => {
      const e = busyCache.get(c.id);
      return !(e && e.windowKey === windowKey && Date.now() - e.fetchedAt < CLASH_BUSY_TTL_MS);
    });

    if (stale.length > 0) {
      inFlightWindowKey = windowKey;
      try {
        await runPooled(
          stale.map((c) => () => fetchBusy(c, windowKey, timeMinIso, timeMaxIso)),
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
    someConnectionHasFreebusy,
    ensureBusyForWindow,
    clashFor,
    stop,
  };
});
