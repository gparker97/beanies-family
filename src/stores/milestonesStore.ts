import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { wrapAsync } from '@/composables/useStoreActions';
import { reportError } from '@/utils/errorReporter';
import * as repo from '@/services/automerge/repositories/milestoneRepository';
import { isKnownMilestoneCategory } from '@/constants/milestoneCategories';
import type { Milestone, MilestoneCategory } from '@/types/models';
import { trackFeature } from '@/services/analytics/plausible';

type CreateInput = Omit<Milestone, 'id' | 'createdAt' | 'updatedAt'>;
type UpdateInput = Partial<CreateInput>;

/**
 * Milestones store — one-off life events captured for posterity.
 *
 * Per-bean by default (`memberId` set). When `memberId === null`, the
 * milestone is family-wide; consumers key off the null check rather
 * than a phantom "family bean" object.
 *
 * Sort order is `occurredOn DESC` everywhere a list is shown — milestones
 * are date-anchored. Malformed `occurredOn` values fall back to
 * `createdAt` via `safeOccurredOn` (`@/utils/date`); this store keeps
 * the data as-is so support can find + fix the bad item.
 *
 * Unknown `category` values (future schema drift / manually-edited docs)
 * fall back to `'custom'` for rendering with a one-time per-session
 * `reportError`. Data is preserved on disk; only the runtime presentation
 * degrades.
 */
export const useMilestonesStore = defineStore('milestones', () => {
  const milestones = ref<Milestone[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // Track unknown-category warnings emitted this session so we don't spam
  // Slack on every read-cycle. Cleared on store reset (when family changes).
  const reportedUnknownCategories = new Set<string>();

  /** Defensive read: unknown category → render as 'custom'. */
  function safeCategoryFor(m: Milestone): MilestoneCategory {
    if (isKnownMilestoneCategory(m.category)) return m.category;
    if (!reportedUnknownCategories.has(m.category)) {
      reportedUnknownCategories.add(m.category);
      console.warn(
        '[milestonesStore] unknown milestone category — rendering as "custom":',
        m.category,
        m.id
      );
      reportError({
        surface: 'milestonesStore',
        message: 'unknown milestone category',
        context: { itemId: m.id, category: m.category },
      });
    }
    return 'custom';
  }

  function byMember(memberId: string) {
    return computed(() =>
      milestones.value
        .filter((m) => m.memberId === memberId)
        .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn))
    );
  }

  const familyWide = computed(() =>
    milestones.value
      .filter((m) => m.memberId === null)
      .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn))
  );

  async function loadMilestones() {
    await wrapAsync(
      isLoading,
      error,
      async () => {
        milestones.value = await repo.getAllMilestones();
      },
      { action: 'milestonesStore:loadMilestones' }
    );
  }

  async function createMilestone(input: CreateInput): Promise<Milestone | null> {
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        const created = await repo.createMilestone(input);
        milestones.value = [...milestones.value, created];
        return created;
      },
      { action: 'milestonesStore:createMilestone' }
    );
    return trackFeature(result ?? null, 'milestone');
  }

  async function updateMilestone(id: string, input: UpdateInput): Promise<Milestone | null> {
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        const updated = await repo.updateMilestone(id, input);
        if (updated) {
          milestones.value = milestones.value.map((m) => (m.id === id ? updated : m));
        }
        return updated;
      },
      { action: 'milestonesStore:updateMilestone' }
    );
    return result ?? null;
  }

  async function deleteMilestone(id: string): Promise<void> {
    await wrapAsync(
      isLoading,
      error,
      async () => {
        await repo.deleteMilestone(id);
        milestones.value = milestones.value.filter((m) => m.id !== id);
      },
      { action: 'milestonesStore:deleteMilestone' }
    );
  }

  function reset(): void {
    milestones.value = [];
    isLoading.value = false;
    error.value = null;
    reportedUnknownCategories.clear();
  }

  return {
    milestones,
    isLoading,
    error,
    byMember,
    familyWide,
    safeCategoryFor,
    loadMilestones,
    createMilestone,
    updateMilestone,
    deleteMilestone,
    reset,
  };
});
