import { useTranslationStore } from '@/stores/translationStore';
import { unionTravellerIds } from '@/utils/segmentTravellers';
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { wrapAsync } from '@/composables/useStoreActions';
import { showToast } from '@/composables/useToast';
import * as vacationRepo from '@/services/automerge/repositories/vacationRepository';
import * as activityRepo from '@/services/automerge/repositories/activityRepository';
import {
  computeVacationDates,
  extendTripDates,
  collectSegmentDates,
  extractSegmentOccurrences,
  tripPhase,
  type TravelSegmentOccurrence,
} from '@/utils/vacation';
import { toISODateString, extractDatePart } from '@/utils/date';
import { mergeExtractedIntoVacation } from '@/utils/segmentMerge';
import { useToday } from '@/composables/useToday';
import { trackFeature } from '@/services/analytics/plausible';
import type {
  FamilyVacation,
  VacationTravelSegment,
  VacationAccommodation,
  VacationTransportation,
  CreateFamilyVacationInput,
  UpdateFamilyVacationInput,
  CreateFamilyActivityInput,
} from '@/types/models';

/** The three segment arrays produced by AI travel extraction (#30). */
export interface ExtractedSegmentBuckets {
  travelSegments: VacationTravelSegment[];
  accommodations: VacationAccommodation[];
  transportation: VacationTransportation[];
}

export const useVacationStore = defineStore('vacations', () => {
  // State
  const vacations = ref<FamilyVacation[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const { today } = useToday();
  const upcomingVacations = computed(() => {
    const todayStr = today.value;
    return vacations.value
      .filter((v) => tripPhase(v, todayStr) !== 'past')
      .sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''));
  });

  /** O(1) lookup: activityId → FamilyVacation */
  const vacationByActivityId = computed(() => {
    const map = new Map<string, FamilyVacation>();
    for (const v of vacations.value) {
      map.set(v.activityId, v);
    }
    return map;
  });

  function getVacationById(id: string): FamilyVacation | undefined {
    return vacations.value.find((v) => v.id === id);
  }

  /**
   * All travel-segment calendar occurrences across every vacation. Pure
   * derivation — extraction lives in `extractSegmentOccurrences`. Wrapped
   * in `safeExtract` so a single corrupt segment cannot break calendar
   * render for the whole vacation: errors are logged with `[vacationStore]`
   * prefix and the segment contributes zero occurrences instead of throwing.
   */
  const allTravelSegmentOccurrences = computed<TravelSegmentOccurrence[]>(() =>
    vacations.value.flatMap((v) =>
      v.travelSegments.flatMap((seg, idx) => safeExtract(v.id, seg, idx, v.assigneeIds ?? []))
    )
  );

  function safeExtract(
    vacationId: string,
    seg: VacationTravelSegment,
    idx: number,
    tripAssigneeIds: string[]
  ): TravelSegmentOccurrence[] {
    try {
      return extractSegmentOccurrences(vacationId, seg, idx, tripAssigneeIds);
    } catch (err) {
      console.error(
        `[vacationStore] failed to extract occurrences for segment ${seg?.id ?? '<no id>'} on vacation ${vacationId}:`,
        err
      );
      return [];
    }
  }

  /**
   * Filter the all-occurrences list to a date range (inclusive on both
   * sides). Each calendar view calls this with its visible window.
   * `startISO` / `endISO` are `YYYY-MM-DD`; lex-compare works because
   * that format sorts as date.
   */
  function travelSegmentOccurrencesInRange(
    startISO: string,
    endISO: string
  ): TravelSegmentOccurrence[] {
    return allTravelSegmentOccurrences.value.filter((o) => o.date >= startISO && o.date <= endISO);
  }

  // Actions
  async function loadVacations() {
    await wrapAsync(
      isLoading,
      error,
      async () => {
        vacations.value = await vacationRepo.getAllVacations();
      },
      { action: 'vacationStore:loadVacations' }
    );
  }

  /**
   * Create a vacation and its linked FamilyActivity calendar entry.
   * The activity serves as the all-day calendar span; the vacation holds
   * the rich data.
   *
   * Trip dates are user-owned (ADR-023). Prefer `input.startDate` /
   * `input.endDate` when provided by the caller (wizard Step 1). Fall
   * back to deriving from segments only when the caller didn't supply
   * dates — programmatic paths, tests, or CRDT-merge edge cases.
   */
  async function createVacation(
    input: Omit<CreateFamilyVacationInput, 'activityId'>
  ): Promise<FamilyVacation | null> {
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        let startDate = input.startDate;
        let endDate = input.endDate;
        if (!startDate && !endDate) {
          const seed = computeVacationDates(input);
          startDate = seed.startDate;
          endDate = seed.endDate;
        }

        // Create linked FamilyActivity (all-day calendar entry)
        const activityInput: CreateFamilyActivityInput = {
          title: input.name,
          category: 'other_activity',
          icon: '✈️',
          date: startDate ?? extractDatePart(new Date().toISOString()),
          endDate: endDate,
          isAllDay: true,
          recurrence: 'none',
          feeSchedule: 'none',
          reminderMinutes: 0,
          isActive: true,
          assigneeIds: [...input.assigneeIds],
          createdBy: input.createdBy,
        };
        const activity = await activityRepo.createActivity(activityInput);

        // Create vacation with link to activity
        const vacation = await vacationRepo.createVacation({
          ...input,
          activityId: activity.id,
          startDate,
          endDate,
        });

        // Set bidirectional link: activity → vacation
        await activityRepo.updateActivity(activity.id, { vacationId: vacation.id });

        vacations.value = [...vacations.value, vacation];
        return vacation;
      },
      { action: 'vacationStore:createVacation' }
    );
    trackFeature(result, 'vacation');
    return result ?? null;
  }

  /**
   * Update a vacation and sync its linked activity's date range.
   *
   * Trip-date handling (ADR-023):
   *   1. If caller explicitly provides `startDate` or `endDate`, that's
   *      a manual-edit path — accept as-is (this is how users shrink
   *      the trip window from the summary page).
   *   2. Otherwise, if the existing vacation has no dates set
   *      (historical / pre-ADR-023 data), seed from all segments via
   *      `computeVacationDates` so auto-extend has a baseline.
   *   3. Then widen (never narrow) the window to include any date
   *      candidates from this update's segment arrays. Within-range or
   *      deleted segments don't shrink the trip.
   */
  async function updateVacation(
    id: string,
    input: UpdateFamilyVacationInput
  ): Promise<FamilyVacation | null> {
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        const existing = vacations.value.find((v) => v.id === id);
        if (!existing) {
          console.error(`[vacation] updateVacation: no vacation with id "${id}"`);
          return null;
        }

        let nextStart = existing.startDate;
        let nextEnd = existing.endDate;

        // (1) Manual-edit path: caller explicitly set a date → use it.
        if (input.startDate !== undefined) nextStart = input.startDate;
        if (input.endDate !== undefined) nextEnd = input.endDate;

        // (2) Seed fallback for historical vacations without any dates.
        //     Only runs when the caller DIDN'T explicitly set either
        //     date, so we don't stomp a manual edit.
        if (input.startDate === undefined && input.endDate === undefined) {
          if (!existing.startDate && !existing.endDate) {
            const merged = {
              travelSegments: input.travelSegments ?? existing.travelSegments,
              accommodations: input.accommodations ?? existing.accommodations,
              transportation: input.transportation ?? existing.transportation,
            };
            const seed = computeVacationDates(merged);
            nextStart = seed.startDate;
            nextEnd = seed.endDate;
          }
        }

        // (3) Auto-extend: widen the window to include any incoming
        //     segment dates. Never narrows. Runs regardless of (1)/(2)
        //     so even a manual date edit can still be extended by a
        //     concurrently-added out-of-range segment.
        const candidates = collectSegmentDates({
          travelSegments: input.travelSegments,
          accommodations: input.accommodations,
          transportation: input.transportation,
        });
        if (candidates.length > 0) {
          const extended = extendTripDates({ start: nextStart, end: nextEnd }, ...candidates);
          nextStart = extended.start;
          nextEnd = extended.end;
        }

        const updated = await vacationRepo.updateVacation(id, {
          ...input,
          startDate: nextStart,
          endDate: nextEnd,
        });
        if (!updated) return null;

        // Sync linked activity. If this fails, the vacation itself is
        // already persisted — rolling back would destroy user work.
        // Surface a clear warning toast instead of silently drifting.
        try {
          await activityRepo.updateActivity(existing.activityId, {
            title: input.name ?? existing.name,
            date: nextStart ?? extractDatePart(new Date().toISOString()),
            endDate: nextEnd,
            assigneeIds: input.assigneeIds ?? existing.assigneeIds,
          });
        } catch (activityErr) {
          console.error(
            `[vacation] Vacation updated but linked activity "${existing.activityId}" did not sync:`,
            activityErr
          );
          showToast(
            'warning',
            useTranslationStore().t('travel.calendarStale.title'),
            useTranslationStore().t('travel.calendarStale.message')
          );
        }

        vacations.value = vacations.value.map((v) => (v.id === id ? updated : v));
        return updated;
      },
      { action: 'vacationStore:updateVacation' }
    );
    return result ?? null;
  }

  /**
   * Delete a vacation and its linked activity.
   */
  async function deleteVacation(id: string): Promise<boolean> {
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        const vacation = vacations.value.find((v) => v.id === id);
        if (!vacation) return false;

        // Delete the linked activity first (repo + in-memory store)
        await activityRepo.deleteActivity(vacation.activityId);
        const { useActivityStore } = await import('@/stores/activityStore');
        const activityStore = useActivityStore();
        activityStore.removeFromMemory(vacation.activityId);

        // Delete the vacation
        const success = await vacationRepo.deleteVacation(id);
        if (success) {
          vacations.value = vacations.value.filter((v) => v.id !== id);
          // Clear any Beanie List links to this trip (and its activity) so the
          // travel-page embed stops rendering — no orphan reference.
          const { useListStore } = await import('@/stores/listStore');
          const listStore = useListStore();
          await listStore.clearLinksFor('trip', id);
          await listStore.clearLinksFor('activity', vacation.activityId);
        }
        return success;
      },
      { action: 'vacationStore:deleteVacation' }
    );
    return result ?? false;
  }

  /**
   * Toggle a family member's vote on a vacation idea.
   */
  async function toggleIdeaVote(
    vacationId: string,
    ideaId: string,
    memberId: string
  ): Promise<void> {
    const vacation = vacations.value.find((v) => v.id === vacationId);
    if (!vacation) return;

    const ideas = vacation.ideas.map((idea) => {
      if (idea.id !== ideaId) return idea;

      const existingVoteIndex = idea.votes.findIndex((vote) => vote.memberId === memberId);
      const updatedVotes =
        existingVoteIndex >= 0
          ? idea.votes.filter((_, i) => i !== existingVoteIndex)
          : [...idea.votes, { memberId, votedAt: toISODateString(new Date()) }];

      return { ...idea, votes: updatedVotes };
    });

    await updateVacation(vacationId, { ideas });
  }

  /**
   * Save an AI-extracted set of bookings, either as a NEW trip or merged into an existing one.
   *
   * This was 40 lines inside `onReviewSubmit` in TravelPlansPage — a cross-store transaction
   * living in a view, which is what MVO exists to prevent. Two rules travelled with it and
   * were enforced nowhere but that handler:
   *
   *  1. A NEW trip has no travellers to inherit, so they are seeded from the union of
   *     everyone the document named, and that default is materialized onto segments the
   *     model matched no names for — otherwise those read as "everyone" forever.
   *  2. An EMPTY union must NOT be materialized. `[]` is a DEFINED value, and a defined
   *     travellerIds is deliberately never re-resolved when the trip's travellers change —
   *     so a document naming nobody (routine on hotel confirmations) pinned every segment to
   *     "nobody", putting the flight on no one's calendar with no UI able to clear it.
   *
   * Returns the id-remap alongside the vacation because the caller must attach the source
   * document to the SURVIVING segment ids: on the attach path a merged segment keeps the
   * existing id, and linking to the dropped extracted id orphans the file.
   */
  async function saveExtractedTrip(
    target:
      | { kind: 'create'; tripName: string; tripType: FamilyVacation['tripType'] }
      | { kind: 'attach'; vacationId: string },
    buckets: ExtractedSegmentBuckets,
    createdBy: string
  ): Promise<{ vacationId: string; idRemap: Record<string, string> } | null> {
    try {
      if (target.kind === 'attach') {
        const res = await addExtractedSegments(target.vacationId, buckets);
        if (!res) return null;
        return { vacationId: res.vacation.id, idRemap: res.idRemap };
      }

      const defaultTravellers = unionTravellerIds(buckets);
      // Rule 2 above: only materialize a NON-empty default.
      if (defaultTravellers.length) {
        for (const seg of [
          ...buckets.travelSegments,
          ...buckets.accommodations,
          ...buckets.transportation,
        ] as Array<{ travellerIds?: string[] }>) {
          if (!seg.travellerIds) seg.travellerIds = defaultTravellers;
        }
      }

      const created = await createVacation({
        name: target.tripName,
        tripType: target.tripType,
        assigneeIds: defaultTravellers,
        ideas: [],
        travelSegments: buckets.travelSegments,
        accommodations: buckets.accommodations,
        transportation: buckets.transportation,
        createdBy,
      } as Parameters<typeof createVacation>[0]);
      // Identity remap on the create path: nothing merged, so every extracted id survives.
      return created ? { vacationId: created.id, idRemap: {} } : null;
    } catch (err) {
      console.error('[vacation] saveExtractedTrip failed:', err);
      return null;
    }
  }

  /**
   * Patch ONE booking segment, addressed by id, merging onto its CURRENT value.
   *
   * Replaces the pattern the three edit drawers used: capture a positional array INDEX when
   * the drawer opens, then at save time write `segments[index] = {...full form payload}`.
   * Two defects in one line:
   *
   *  • WRONG TARGET. A CRDT merge that shifts the array — another parent deleting a
   *    cancelled flight — re-points that index at a different booking, and ~35 fields of the
   *    ferry overwrite the return flight. Out of range is worse: `{...undefined}` yields
   *    `{}`, appending a segment with no id and no type that then breaks `:key`, the photo
   *    binding and the merge key.
   *
   *  • WRONG BASELINE. The payload came from an open-time snapshot, so a field another
   *    device corrected while the drawer was open was written back to its old value. Callers
   *    now send a DIFF (see `diffPayload`), and this merges it onto whatever the segment
   *    looks like now — so untouched fields are never rewritten.
   *
   * Searches all three buckets, because a segment id is unique across them and the caller
   * should not have to know which list its booking lives in.
   */
  async function updateSegment(
    vacationId: string,
    segmentId: string,
    patch: Record<string, unknown>
  ): Promise<boolean> {
    const vacation = vacations.value.find((v) => v.id === vacationId);
    if (!vacation) {
      console.warn(`[vacation] updateSegment: no vacation "${vacationId}"`);
      return false;
    }
    if (Object.keys(patch).length === 0) return true; // nothing changed — a save is a no-op

    const keys = ['travelSegments', 'accommodations', 'transportation'] as const;
    for (const key of keys) {
      const arr = (vacation[key] ?? []) as Array<{ id: string }>;
      const idx = arr.findIndex((seg) => seg.id === segmentId);
      if (idx < 0) continue;
      const nextArr = arr.map((seg, i) => (i === idx ? { ...seg, ...patch } : seg));
      const saved = await updateVacation(vacationId, {
        [key]: nextArr,
      } as UpdateFamilyVacationInput);
      return saved !== null;
    }
    // The segment is gone — deleted on another device while this drawer was open. Not an
    // error the user caused, but they must not be told it saved.
    console.warn(`[vacation] updateSegment: no segment "${segmentId}" in "${vacationId}"`);
    return false;
  }

  /** Remove one booking segment by id, from whichever bucket holds it. */
  async function deleteSegment(vacationId: string, segmentId: string): Promise<boolean> {
    const vacation = vacations.value.find((v) => v.id === vacationId);
    if (!vacation) return false;
    const keys = ['travelSegments', 'accommodations', 'transportation'] as const;
    for (const key of keys) {
      const arr = (vacation[key] ?? []) as Array<{ id: string }>;
      if (!arr.some((seg) => seg.id === segmentId)) continue;
      const nextArr = arr.filter((seg) => seg.id !== segmentId);
      const saved = await updateVacation(vacationId, {
        [key]: nextArr,
      } as UpdateFamilyVacationInput);
      return saved !== null;
    }
    return false;
  }

  /**
   * Set the attached document/photo ids on one booking segment (travel,
   * accommodation, or transportation). Owns the find-by-id + index-merge so
   * the five UI callers (3 edit drawers + wizard steps) don't each hand-roll
   * an array spread. Persists via `updateVacation` (which re-syncs trip dates).
   */
  async function updateSegmentPhotoIds(
    vacationId: string,
    segmentId: string,
    photoIds: string[]
  ): Promise<void> {
    const vacation = vacations.value.find((v) => v.id === vacationId);
    if (!vacation) {
      console.warn(`[vacation] updateSegmentPhotoIds: no vacation "${vacationId}"`);
      return;
    }
    const keys = ['travelSegments', 'accommodations', 'transportation'] as const;
    for (const key of keys) {
      const arr = vacation[key] as Array<{ id: string; photoIds?: string[] }>;
      const idx = arr.findIndex((s) => s.id === segmentId);
      if (idx < 0) continue;
      const nextArr = arr.map((s, i) => (i === idx ? { ...s, photoIds: [...photoIds] } : s));
      await updateVacation(vacationId, { [key]: nextArr } as UpdateFamilyVacationInput);
      return;
    }
    console.warn(
      `[vacation] updateSegmentPhotoIds: segment "${segmentId}" not found on vacation "${vacationId}"`
    );
  }

  /**
   * Append AI-extracted segments to an existing trip (#30). Concatenates each bucket
   * onto the current arrays and persists via `updateVacation` (which auto-extends the
   * trip window + re-syncs the linked activity). Owns the merge so the review modal
   * doesn't hand-roll array spreads — mirrors `updateSegmentPhotoIds`. Returns the
   * updated vacation (whose segments carry the ids the caller generated) or null on miss.
   */
  /**
   * Add AI-extracted segments to an existing trip, MERGING any that match an existing segment
   * (same kind + identity key) instead of duplicating — newer doc wins on fields, travellers
   * union, notes append, source document re-targeted via the returned id-remap (extracted id →
   * final segment id). The pure merge is wrapped so a malformed segment surfaces as the caller's
   * saveFailed toast (a `[vacation]` console.error), never a silent throw.
   */
  async function addExtractedSegments(
    vacationId: string,
    buckets: ExtractedSegmentBuckets
  ): Promise<{ vacation: FamilyVacation; idRemap: Record<string, string> } | null> {
    const vacation = vacations.value.find((v) => v.id === vacationId);
    if (!vacation) {
      console.warn(`[vacation] addExtractedSegments: no vacation "${vacationId}"`);
      return null;
    }
    let merged: ExtractedSegmentBuckets;
    let idRemap: Record<string, string>;
    try {
      ({ merged, idRemap } = mergeExtractedIntoVacation(
        {
          travelSegments: vacation.travelSegments,
          accommodations: vacation.accommodations,
          transportation: vacation.transportation,
        },
        buckets
      ));
    } catch (err) {
      console.error('[vacation] addExtractedSegments merge failed:', err);
      return null;
    }
    const updated = await updateVacation(vacationId, {
      travelSegments: merged.travelSegments,
      accommodations: merged.accommodations,
      transportation: merged.transportation,
    });
    return updated ? { vacation: updated, idRemap } : null;
  }

  function resetState() {
    vacations.value = [];
    isLoading.value = false;
    error.value = null;
  }

  return {
    // State
    vacations,
    isLoading,
    error,
    // Getters
    upcomingVacations,
    vacationByActivityId,
    getVacationById,
    allTravelSegmentOccurrences,
    travelSegmentOccurrencesInRange,
    // Actions
    loadVacations,
    createVacation,
    updateVacation,
    deleteVacation,
    toggleIdeaVote,
    saveExtractedTrip,
    updateSegment,
    deleteSegment,
    updateSegmentPhotoIds,
    addExtractedSegments,
    resetState,
  };
});
