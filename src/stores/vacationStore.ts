import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { wrapAsync } from '@/composables/useStoreActions';
import * as vacationRepo from '@/services/automerge/repositories/vacationRepository';
import * as activityRepo from '@/services/automerge/repositories/activityRepository';
import { computeVacationDates } from '@/utils/vacation';
import { toISODateString, extractDatePart } from '@/utils/date';
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
  const upcomingVacations = computed(() => {
    const today = extractDatePart(new Date().toISOString());
    return vacations.value
      .filter((v) => !v.endDate || extractDatePart(v.endDate) >= today)
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
   * The activity serves as the all-day calendar span; the vacation holds the rich data.
   */
  async function createVacation(
    input: Omit<CreateFamilyVacationInput, 'activityId'>
  ): Promise<FamilyVacation | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      // Derive dates from segments
      const { startDate, endDate } = computeVacationDates(input);

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
    return result ?? null;
  }

  /**
   * Update a vacation and sync its linked activity's date range.
   */
  async function updateVacation(
    id: string,
    input: UpdateFamilyVacationInput
  ): Promise<FamilyVacation | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const existing = vacations.value.find((v) => v.id === id);
      if (!existing) return null;

      // Merge input with existing to compute dates from full segment arrays
      const merged = {
        travelSegments: input.travelSegments ?? existing.travelSegments,
        accommodations: input.accommodations ?? existing.accommodations,
        transportation: input.transportation ?? existing.transportation,
      };
      const { startDate, endDate } = computeVacationDates(merged);

      const updated = await vacationRepo.updateVacation(id, {
        ...input,
        startDate,
        endDate,
      });
      if (!updated) return null;

      // Sync linked activity dates and title
      await activityRepo.updateActivity(existing.activityId, {
        title: input.name ?? existing.name,
        date: startDate ?? extractDatePart(new Date().toISOString()),
        endDate,
        assigneeIds: input.assigneeIds ?? existing.assigneeIds,
      });

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
