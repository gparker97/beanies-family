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
  ImportNotVisibleError,
  type ImportEntry,
} from '@/services/automerge/repositories/calendarRepository';
import { computePushHash } from '@/utils/calendar/activityToGoogleEvent';
import { makeMemberNameResolver } from '@/utils/calendar/memberNames';
import {
  planImport,
  redateToOccurrence,
  type ImportCandidate,
  type ImportSource,
} from '@/utils/calendar/planImport';
import { useActivityStore } from '@/stores/activityStore';
import { useCalendarSyncStore } from '@/stores/calendarSyncStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useAuthStore } from '@/stores/authStore';
import { logEvent } from '@/services/telemetry';
import { reportError } from '@/utils/errorReporter';
import { trackFeature } from '@/services/analytics/plausible';
import { useTranslationStore } from '@/stores/translationStore';
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

/**
 * How many `events.instances` lookups a scan will make to re-date candidates whose
 * repeat pattern beanies cannot express. Each is one request, so this is a hard
 * bound on how long the scan can take. Unsupported patterns are rare; a family
 * with more than this many has bigger problems than a stale date on the tail.
 */
const MAX_OCCURRENCE_LOOKUPS = 25;

export type ImportPhase = 'idle' | 'choosing' | 'scanning' | 'reviewing' | 'importing';

/**
 * The outcome of a commit. `unverified` is NOT a failure: the Automerge batch
 * committed and only the read-back check did not see it, so the caller must tell
 * the user their events ARE in, not that nothing happened.
 */
export type CommitResult =
  { kind: 'ok'; count: number } | { kind: 'unverified' } | { kind: 'failed' };

export const useCalendarImportStore = defineStore('calendarImport', () => {
  const phase = ref<ImportPhase>('idle');
  const connectionId = ref<string | null>(null);
  const calendars = ref<CalendarSummary[]>([]);
  const chosenCalendarIds = ref<Set<string>>(new Set());
  const candidates = ref<ImportCandidate[]>([]);
  const selectedIds = ref<Set<string>>(new Set());
  const truncated = ref(false);
  const skippedCalendars = ref<Array<{ id: string; reason: string }>>([]);

  /**
   * Whether beanies can READ this calendar's event bodies.
   *
   * `writer` counts. The import only ever reads, and a shared family calendar the
   * user can write to but does not own is exactly the calendar a parent most wants
   * brought across — restricting this to `owner` greyed out the partner's shared
   * calendar with the message "read only", which was both wrong and the opposite
   * of what it meant. `reader`/`freeBusyReader` genuinely cannot be imported:
   * `freeBusyReader` sees no titles, and a `reader` calendar cannot be adopted or
   * kept in step afterwards.
   *
   * ABSENT accessRole fails OPEN onto the existing 403-skip path, so a calendar
   * the user does own is never hidden by a missing field.
   */
  function isReadable(cal: CalendarSummary): boolean {
    return (
      cal.accessRole === undefined || cal.accessRole === 'owner' || cal.accessRole === 'writer'
    );
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

  /** Localized label for a calendar Google returned with no summary. */
  function untitledCalendar(): string {
    return useTranslationStore().t('calendarImport.choose.untitled');
  }

  /**
   * Move every `unsupported-recurrence` candidate onto its NEXT occurrence.
   *
   * These import as ONE-OFFS, and a recurring master's start is its ORIGINAL
   * start — a weekly swim lesson begun in 2019 arrives dated 2019. Left there the
   * activity lands on a date nobody will ever scroll to, while the chip, the
   * legend and the help article all promise "the next time it happens".
   * `events.instances` is the only thing that knows when that is.
   *
   * Bounded and fault-isolated: only unsupported candidates are looked up, at most
   * `MAX_OCCURRENCE_LOOKUPS` of them, and a failed lookup leaves that one candidate
   * on its master's date rather than failing the scan. A date slightly in the past
   * is a much smaller harm than losing the whole review list.
   */
  async function withNextOccurrences(
    id: string,
    list: ImportCandidate[],
    timeMin: string,
    timeMax: string
  ): Promise<ImportCandidate[]> {
    // Only the ones that actually need it: a master whose start is already in the
    // future is showing a sensible date, and re-dating it would spend a request to
    // change nothing. Narrowing to PAST-dated masters is also what keeps the cap
    // from binding in practice, which matters because the row says "next date
    // only" — a promise that would not hold for anything the cap dropped.
    const today = toISODateString(new Date());
    const targets = list
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.outcome === 'unsupported-recurrence' && c.draft.date < today)
      .slice(0, MAX_OCCURRENCE_LOOKUPS);
    if (targets.length === 0) return list;

    const client = getCalendarClient();
    const out = [...list];
    let failed = 0;

    for (const { c, i } of targets) {
      try {
        const instances = await client.listInstances(
          id,
          c.calendarId,
          c.googleEventId,
          timeMin,
          timeMax
        );
        const next = instances.find((inst) => inst.status !== 'cancelled' && inst.start);
        if (next) out[i] = redateToOccurrence(c, next.start, next.end);
      } catch {
        failed += 1;
      }
    }

    if (failed > 0) {
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'import_occurrence_lookup_failed',
        context: { action: 'import_occurrence_lookup_failed', count: failed },
      });
    }
    // Re-sort: a re-dated candidate has moved, often by years.
    out.sort((a, b) => a.draft.date.localeCompare(b.draft.date));
    return out;
  }

  /**
   * Read the chosen calendars and build the review list. Writes nothing, to
   * beanies or to Google. Returns true when the review list is ready.
   *
   * Every failure inside is contained: a calendar the grant cannot read is a skip
   * with a reason, and anything that escapes the per-calendar loop (the link read,
   * the planner, the occurrence lookups) lands in the outer catch, which reports
   * and returns the user to the chooser. A throw here previously latched the
   * spinner forever and was attributed to `vue-render` in CloudWatch.
   */
  async function scan(): Promise<boolean> {
    const id = connectionId.value;
    if (!id) return false;

    phase.value = 'scanning';
    skippedCalendars.value = [];

    try {
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
            calendarLabel: cal.summary?.trim() || untitledCalendar(),
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
      // No member means no valid creator and no valid assignee, and
      // `createActivity` does not validate either. Importing with `''` would write
      // N activities the rest of the app treats as malformed. Throw into the outer
      // catch instead: the user sees a real message and nothing is written.
      const memberId = useAuthStore().currentUser?.memberId ?? useFamilyStore().members[0]?.id;
      if (!memberId)
        throw new Error('calendar import: no family member to own the imported activities');

      const links = await getAllCalendarEventLinks();
      const plan = planImport(sources, links, {
        memberId,
        destinationCalendarId: connection?.destinationCalendarId ?? 'primary',
      });

      // ⚠️ The cap counts only what the user can ACT on. Slicing the raw list first
      // meant a family that had already imported 300 events got 200 rows every one
      // of which was disabled — "nothing new" from a calendar full of new things.
      // Already-imported rows still ride along as context; they just do not consume
      // the budget.
      const capped: ImportCandidate[] = [];
      let actionable = 0;
      let beyondCap = 0;
      for (const c of plan.candidates) {
        if (c.alreadyImported) {
          if (actionable < IMPORT_MAX_CANDIDATES) capped.push(c);
          continue;
        }
        if (actionable >= IMPORT_MAX_CANDIDATES) {
          beyondCap += 1;
          continue;
        }
        actionable += 1;
        capped.push(c);
      }
      truncated.value = beyondCap > 0;
      candidates.value = await withNextOccurrences(id, capped, timeMin, timeMax);
      // Everything actionable is ticked when the review opens (greg, 2026-09-11).
      selectedIds.value = new Set(
        candidates.value.filter((c) => !c.alreadyImported).map((c) => c.googleEventId)
      );

      if (plan.skipped.length > 0) {
        // Not noise: a run that offers far less than the user expected is explained
        // by this line alone, without a repro.
        logEvent({
          level: 'info',
          surface: SURFACE,
          message: 'import_skipped_events',
          context: { action: 'import_skipped_events', count: plan.skipped.length },
        });
      }

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
      return true;
    } catch (error) {
      // Nothing was written, so the honest recovery is to put the user back on the
      // chooser with a message rather than leave the spinner running.
      reportError({
        surface: SURFACE,
        severity: 'error',
        message: 'calendar import scan failed',
        error,
        context: { action: 'import_scan_failed' },
      });
      logEvent({
        level: 'error',
        surface: SURFACE,
        message: 'import_scan_failed',
        context: { action: 'import_scan_failed' },
      });
      phase.value = 'choosing';
      return false;
    }
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
   * What a commit did. Three outcomes, not two, because the middle one MUST NOT be
   * worded as a failure: `ImportNotVisibleError` is thrown AFTER the batch has
   * committed, so telling the user "nothing was imported" invites a retry
   * that makes a SECOND full set of activities — the exact duplication this whole
   * feature exists to prevent. `calendarRepository`'s own docblock forbids it.
   */
  async function commit(): Promise<CommitResult> {
    const id = connectionId.value;
    const picked = pickedCandidates.value;
    if (!id || picked.length === 0) return { kind: 'ok', count: 0 };

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

      const created = trackFeature(await createImportedActivities(entries), 'activity');
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
      return { kind: 'ok', count: created.length };
    } catch (error) {
      // 🔴 The ONE branch that must not read as a failure. The batch COMMITTED and
      // the activities are merely not in the projection yet; a retry would write
      // them a second time. Same narrowing as `listStore`'s `ListsNotVisibleError`.
      const unverified = error instanceof ImportNotVisibleError;

      reportError({
        surface: SURFACE,
        severity: unverified ? 'critical' : 'error',
        message: unverified
          ? 'calendar import verify failed: the batch committed but the activities are not in the projection'
          : 'calendar import commit failed: nothing was created (the batch is atomic)',
        error,
        context: {
          action: 'import_commit_failed',
          error_code: unverified ? 'verify-missing' : 'batch-write-threw',
        },
      });
      logEvent({
        level: 'error',
        surface: SURFACE,
        message: 'import_commit_failed',
        context: {
          action: 'import_commit_failed',
          error_code: unverified ? 'verify-missing' : 'batch-write-threw',
        },
      });

      if (unverified) {
        // The write happened. Close the flow rather than leaving a review list the
        // user would naturally re-commit.
        phase.value = 'idle';
        return { kind: 'unverified' };
      }
      // A genuine failure: one atomic change, so nothing was half-created and the
      // user can simply try again from the list they are already looking at.
      phase.value = 'reviewing';
      return { kind: 'failed' };
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
