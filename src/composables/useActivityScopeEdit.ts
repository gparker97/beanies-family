import { ref } from 'vue';
import { useActivityStore } from '@/stores/activityStore';
import { chooseScope } from '@/composables/useRecurringEditScope';
import { confirm } from '@/composables/useConfirm';
import { toDateInputValue, addDays, parseLocalDate } from '@/utils/date';
import type { FamilyActivity, UpdateFamilyActivityInput } from '@/types/models';

/**
 * Shared composable for scope-aware activity view/edit/delete.
 * Used by FamilyPlannerPage and FamilyNookPage to avoid duplicating
 * the recurring-scope logic in both pages.
 *
 * Scope modal is deferred to save time (not shown when opening the edit modal).
 * Delete still shows scope modal before deleting.
 */
export function useActivityScopeEdit() {
  const activityStore = useActivityStore();

  const viewingActivity = ref<FamilyActivity | null>(null);
  const viewingOccurrenceDate = ref<string | undefined>();

  function openViewModal(id: string, date?: string) {
    const activity = activityStore.activities.find((a) => a.id === id);
    if (activity) {
      viewingActivity.value = activity;
      viewingOccurrenceDate.value = date;
    }
  }

  /**
   * Handle "Edit" from the view modal. Returns the activity to open in the
   * full edit modal, along with the occurrence date for context.
   * Scope is deferred to save time — no scope modal shown here.
   */
  function handleViewOpenEdit(activity: FamilyActivity): {
    activity: FamilyActivity;
    occurrenceDate?: string;
  } {
    const occurrenceDate = viewingOccurrenceDate.value;
    viewingActivity.value = null;
    return { activity, occurrenceDate };
  }

  /**
   * Scope-aware save. Shows scope modal when saving changes to a recurring
   * activity occurrence. Returns true if saved, false if cancelled.
   */
  async function handleScopedSave(
    templateId: string,
    occurrenceDate: string,
    changes: UpdateFamilyActivityInput
  ): Promise<boolean> {
    const scope = await chooseScope();
    if (!scope) return false;

    if (scope === 'all') {
      await activityStore.updateActivity(templateId, changes);
    } else if (scope === 'this-only') {
      await activityStore.materializeOverride(templateId, occurrenceDate, changes);
    } else if (scope === 'this-and-future') {
      const newTemplate = await activityStore.splitActivity(templateId, occurrenceDate);
      if (newTemplate) {
        // Remove date and recurrenceEndDate from changes — splitActivity already set
        // the correct start date (occurrenceDate) and preserved the original end date.
        // Letting the form's date through would reset the start to the original,
        // causing overlapping occurrences with the end-dated original template.
        const {
          date: _d,
          recurrenceEndDate: _re,
          ...safeChanges
        } = changes as Record<string, unknown>;
        await activityStore.updateActivity(
          newTemplate.id,
          safeChanges as UpdateFamilyActivityInput
        );
      }
    }
    return true;
  }

  /**
   * Scope-aware delete. For recurring activities, shows scope modal first.
   * Returns true if something was deleted/modified.
   */
  async function handleScopedDelete(activity: FamilyActivity): Promise<boolean> {
    if (activity.recurrence !== 'none' && viewingOccurrenceDate.value) {
      const scope = await chooseScope();
      if (!scope) return false;

      if (scope === 'this-only') {
        const override = await activityStore.materializeOverride(
          activity.id,
          viewingOccurrenceDate.value,
          { isActive: false }
        );
        return !!override;
      }

      if (scope === 'this-and-future') {
        const dayBefore = toDateInputValue(
          addDays(parseLocalDate(viewingOccurrenceDate.value!), -1)
        );
        const updated = await activityStore.updateActivity(activity.id, {
          recurrenceEndDate: dayBefore,
        });
        return !!updated;
      }

      // 'all' — fall through to standard delete with confirm
    }

    const confirmed = await confirm({
      title: 'planner.deleteActivity',
      message: 'planner.deleteConfirm',
      variant: 'danger',
    });
    if (confirmed) {
      return activityStore.deleteActivity(activity.id);
    }
    return false;
  }

  return {
    viewingActivity,
    viewingOccurrenceDate,
    openViewModal,
    handleViewOpenEdit,
    handleScopedSave,
    handleScopedDelete,
  };
}
