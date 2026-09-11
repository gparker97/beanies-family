/**
 * The one-time Google Calendar import (#94): scan, review, commit.
 *
 * A separate store from `calendarSyncStore` on purpose. That one is a long-lived
 * reconcile loop with polling, locks, freshness windows and error counters; this is
 * a short-lived, user-driven, once-per-family migration. Bolting it onto a
 * 1200-line store would have meant a second lifecycle sharing state that has
 * nothing to do with reconciling.
 *
 * ## The commit writes NOTHING to Google
 *
 * Worth saying loudly because it removes a whole class of failure. Adoption is
 * achieved by recording a link whose `googleEventId` is the REAL Google id and
 * whose `lastPushedHash` is the activity's correct current hash, so the very next
 * reconcile finds the hashes equal and no-ops. No insert, no patch, no network
 * call, nothing to half-succeed.
 */

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { getCalendarClient } from '@/services/calendar/clientInstance';
import { CalendarApiError, type CalendarSummary } from '@/services/calendar/CalendarClient';
import {
  createImportedActivities,
  getAllCalendarEventLinks,
  type ImportEntry,
} from '@/services/automerge/repositories/calendarRepository';
import { computePushHash } from '@/utils/calendar/activityToGoogleEvent';
import { makeMemberNameResolver } from '@/utils/calendar/memberNames';
import { planImport, type ImportCandidate, type ImportSource } from '@/utils/calendar/planImport';
import { useActivityStore } from '@/stores/activityStore';
import { useCalendarSyncStore } from '@/stores/calendarSyncStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useAuthStore } from '@/stores/authStore';
import { logEvent } from '@/services/telemetry';
import { reportError } from '@/utils/errorReporter';
import { toISODateString } from '@/utils/date';

const SURFACE = 'calendar-import';

/** How far forward the import looks. Future only, by decision (greg, 2026-09-11). */
export const IMPORT_WINDOW_MONTHS = 12;

/**
 * How many candidates the review list will show. Bounds three things at once: the
 * review list a person has to read, the single Automerge batch, and the reconcile
 * fan-out that follows. If a window yields more, the first 200 by date are listed
 * and the UI says so rather than silently truncating.
 */
export const IMPORT_MAX_CANDIDATES = 200;

export type ImportPhase = 'idle' | 'choosing' | 'scanning' | 'reviewing' | 'importing';

export const useCalendarImportStore = defineStore('calendarImport', () => {
  const phase = ref<ImportPhase>('idle');
  const connectionId = ref<string | null>(null);
  const calendars = ref<CalendarSummary[]>([]);
  const chosenCalendarIds = ref<Set<string>>(new Set());
  const candidates = ref<ImportCandidate[]>([]);
  const selectedIds = ref<Set<string>>(new Set());
  const truncated = ref(false);
  const skippedCalendars = ref<Array<{ id: string; reason: string }>>([]);

  /** A read-only calendar cannot be scanned by the granted scope. */
  function isReadable(cal: CalendarSummary): boolean {
    // ABSENT accessRole is treated as owner, so the chooser fails OPEN onto the
    // existing 403-skip path rather than hiding a calendar the user does own.
    return cal.accessRole === undefined || cal.accessRole === 'owner';
  }

  const readableCalendars = computed(() => calendars.value.filter(isReadable));

  const selectableCandidates = computed(() => candidates.value.filter((c) => !c.alreadyImported));
  const selectedCount = computed(() => selectedIds.value.size);
  const allSelected = computed(
    () =>
      selectableCandidates.value.length > 0 &&
      selectedIds.value.size === selectableCandidates.value.length
  );

  const adoptCount = computed(
    () => pickedCandidates.value.filter((c) => c.outcome === 'adopt').length
  );
  const copyCount = computed(
    () => pickedCandidates.value.filter((c) => c.outcome !== 'adopt').length
  );

  const pickedCandidates = computed(() =>
    selectableCandidates.value.filter((c) => selectedIds.value.has(c.googleEventId))
  );

  function reset(): void {
    phase.value = 'idle';
    connectionId.value = null;
    calendars.value = [];
    chosenCalendarIds.value = new Set();
    candidates.value = [];
    selectedIds.value = new Set();
    truncated.value = false;
    skippedCalendars.value = [];
  }

  /** Open the chooser for a connection, loading its calendars. */
  async function open(id: string): Promise<void> {
    reset();
    connectionId.value = id;
    phase.value = 'choosing';
    const syncStore = useCalendarSyncStore();
    // Reuses the sync store's loader, which also normalizes a stored 'primary'
    // alias to the concrete primary id. Comparing the raw stored value would
    // wrongly refuse adoption on every connection still defaulting to 'primary'.
    calendars.value = await syncStore.listCalendarsFor(id);
    // Everything readable is ticked by default (greg, 2026-09-11).
    chosenCalendarIds.value = new Set(readableCalendars.value.map((c) => c.id));
  }

  function toggleCalendar(id: string): void {
    const next = new Set(chosenCalendarIds.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    chosenCalendarIds.value = next;
  }

  /** Read the chosen calendars and build the review list. Writes nothing. */
  async function scan(): Promise<void> {
    const id = connectionId.value;
    if (!id) return;

    phase.value = 'scanning';
    skippedCalendars.value = [];

    const chosen = readableCalendars.value.filter((c) => chosenCalendarIds.value.has(c.id));
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'import_scan',
      context: { action: 'import_scan', count: chosen.length },
    });

    const now = new Date();
    const timeMin = now.toISOString();
    const end = new Date(now);
    end.setMonth(end.getMonth() + IMPORT_WINDOW_MONTHS);
    const timeMax = end.toISOString();

    const client = getCalendarClient();
    const sources: ImportSource[] = [];

    for (const cal of chosen) {
      try {
        const events = await client.listEventsForImport(id, cal.id, timeMin, timeMax);
        sources.push({
          connectionId: id,
          calendarId: cal.id,
          calendarLabel: cal.summary || cal.id,
          events,
        });
      } catch (e) {
        // A calendar the grant cannot read is a SKIP with a reason, never an error
        // that fails the whole run. The user still gets everything else.
        const kind = e instanceof CalendarApiError ? e.kind : 'unknown';
        skippedCalendars.value.push({ id: cal.id, reason: kind });
        logEvent({
          level: 'warn',
          surface: SURFACE,
          message: 'import_calendar_skipped',
          context: { action: 'import_calendar_skipped', kind, error_code: kind },
        });
      }
    }

    const syncStore = useCalendarSyncStore();
    const connection = syncStore.connections.find((c) => c.id === id);
    const memberId = useAuthStore().currentUser?.memberId ?? useFamilyStore().members[0]?.id ?? '';

    const links = await getAllCalendarEventLinks();
    const plan = planImport(sources, links, {
      memberId,
      destinationCalendarId: connection?.destinationCalendarId ?? 'primary',
    });

    truncated.value = plan.candidates.length > IMPORT_MAX_CANDIDATES;
    candidates.value = plan.candidates.slice(0, IMPORT_MAX_CANDIDATES);
    // Everything actionable is ticked when the review opens (greg, 2026-09-11).
    selectedIds.value = new Set(
      candidates.value.filter((c) => !c.alreadyImported).map((c) => c.googleEventId)
    );

    const unsupported = candidates.value.filter(
      (c) => c.outcome === 'unsupported-recurrence'
    ).length;
    if (unsupported > 0) {
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'import_recurrence_unsupported',
        context: { action: 'import_recurrence_unsupported', count: unsupported },
      });
    }
    const notDestination = candidates.value.filter(
      (c) => c.outcome === 'copy' && c.origin === 'external'
    ).length;
    if (notDestination > 0) {
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'import_not_destination',
        context: { action: 'import_not_destination', count: notDestination },
      });
    }
    if (truncated.value) {
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'import_capped',
        context: { action: 'import_capped', count: IMPORT_MAX_CANDIDATES },
      });
    }

    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'import_scan_ok',
      context: { action: 'import_scan_ok', count: candidates.value.length },
    });

    phase.value = 'reviewing';
  }

  function toggleCandidate(googleEventId: string): void {
    const next = new Set(selectedIds.value);
    if (next.has(googleEventId)) next.delete(googleEventId);
    else next.add(googleEventId);
    selectedIds.value = next;
  }

  function toggleAll(): void {
    selectedIds.value = allSelected.value
      ? new Set()
      : new Set(selectableCandidates.value.map((c) => c.googleEventId));
  }

  /**
   * Write the ticked rows. ONE atomic batch, so either every row landed or none
   * did. Returns the number imported, or null on failure.
   */
  async function commit(): Promise<number | null> {
    const id = connectionId.value;
    const picked = pickedCandidates.value;
    if (!id || picked.length === 0) return 0;

    phase.value = 'importing';
    try {
      // ⚠️ The resolver is MANDATORY. `computePushHash` folds resolved member names
      // into the payload only when it is passed, and `reconcileConnection` always
      // passes one. Every imported activity has a non-empty `assigneeIds`, so
      // hashing without it yields a DIFFERENT hash from the one the next reconcile
      // computes, and all N events would be pushed straight back to Google for no
      // reason. For an adopted event that push rewrites the user's real event body.
      const memberName = makeMemberNameResolver();
      const now = toISODateString(new Date());

      const entries: ImportEntry[] = picked.map((c) => ({
        activity: c.draft,
        link: {
          connectionId: id,
          googleEventId: c.googleEventId,
          lastPushedHash: computePushHash(c.draft as never, memberName),
          lastPushedAt: now,
          origin: c.origin,
        },
      }));

      const created = await createImportedActivities(entries);
      // Re-mirror the store array once, not once per row. Same outcome as
      // `copyListForMembers`, with no new store action to maintain.
      await useActivityStore().loadActivities();

      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'import_commit',
        context: { action: 'import_commit', count: created.length },
      });
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'import_commit_mix',
        context: { action: 'import_commit_mix', kind: 'adopt', count: adoptCount.value },
      });

      phase.value = 'idle';
      return created.length;
    } catch (error) {
      // The write is one atomic change, so there is no partial state to report and
      // nothing to reconcile by hand: the user re-runs and nothing was half-created.
      reportError({
        surface: SURFACE,
        severity: 'error',
        message: 'calendar import commit failed',
        error,
        context: { action: 'import_commit_failed' },
      });
      logEvent({
        level: 'error',
        surface: SURFACE,
        message: 'import_commit_failed',
        context: { action: 'import_commit_failed' },
      });
      phase.value = 'reviewing';
      return null;
    }
  }

  return {
    phase,
    calendars,
    readableCalendars,
    chosenCalendarIds,
    candidates,
    selectedIds,
    selectedCount,
    selectableCandidates,
    allSelected,
    adoptCount,
    copyCount,
    truncated,
    skippedCalendars,
    isReadable,
    open,
    reset,
    toggleCalendar,
    scan,
    toggleCandidate,
    toggleAll,
    commit,
  };
});
