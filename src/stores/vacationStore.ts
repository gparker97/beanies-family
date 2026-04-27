import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { wrapAsync } from '@/composables/useStoreActions';
import { showToast } from '@/composables/useToast';
import * as vacationRepo from '@/services/automerge/repositories/vacationRepository';
import * as activityRepo from '@/services/automerge/repositories/activityRepository';
import { computeVacationDates, extendTripDates, collectSegmentDates } from '@/utils/vacation';
import { toISODateString, extractDatePart } from '@/utils/date';
import { useToday } from '@/composables/useToday';
import type {
  FamilyVacation,
  CreateFamilyVacationInput,
  UpdateFamilyVacationInput,
  CreateFamilyActivityInput,
} from '@/types/models';

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
      .filter((v) => !v.endDate || extractDatePart(v.endDate) >= todayStr)
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

  // Actions
  async function loadVacations() {
    await wrapAsync(isLoading, error, async () => {
      vacations.value = await vacationRepo.getAllVacations();
    });
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
    const result = await wrapAsync(isLoading, error, async () => {
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
    });
    if (result) window.plausible?.('feature_used', { props: { feature: 'vacation' } });
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
    const result = await wrapAsync(isLoading, error, async () => {
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
          'Trip saved, but your calendar may be out of date',
          'Try refreshing the page to re-sync.'
        );
      }

      vacations.value = vacations.value.map((v) => (v.id === id ? updated : v));
      return updated;
    });
    return result ?? null;
  }

  /**
   * Delete a vacation and its linked activity.
   */
  async function deleteVacation(id: string): Promise<boolean> {
    const result = await wrapAsync(isLoading, error, async () => {
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
      }
      return success;
    });
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
    // Actions
    loadVacations,
    createVacation,
    updateVacation,
    deleteVacation,
    toggleIdeaVote,
    resetState,
  };
});
