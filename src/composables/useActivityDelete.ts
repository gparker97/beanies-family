/**
 * Deleting an activity from the UI, in one place.
 *
 * The planner, the Nook and the activity drawer all confirmed and deleted on their own, and
 * two of them ignored the result. This mirrors `confirmAndDeleteList`: confirm, delete,
 * report `true` ONLY when the activity is gone, so callers close or celebrate on success
 * and only on success.
 *
 * Linked to-dos (magic beans shared result, `TodoItem.activityId`): when the activity has
 * open linked to-dos, the confirm asks whether to keep them (the default) or delete them
 * too. Completed to-dos are always kept. The activity is deleted FIRST; the to-dos go only
 * after that succeeds, in one batch, so a failed activity delete never costs a to-do. If
 * the to-do delete itself fails the to-dos survive and `wrapAsync` has already told the
 * user; the activity is still gone, so this still returns `true`.
 *
 * Never reports a `false` from `deleteActivity`: the store reports every refusal itself
 * (a throw is toasted by `wrapAsync`, a vacation-linked refusal and a missing record by
 * the store), so a report here would be the second one.
 */
import { confirm, confirmChoice } from '@/composables/useConfirm';
import { useActivityStore } from '@/stores/activityStore';
import { useTodoStore } from '@/stores/todoStore';
import { useTranslationStore } from '@/stores/translationStore';
import { logEvent } from '@/services/telemetry';
import { fillTemplate } from '@/utils/fillTemplate';
import type { FamilyActivity } from '@/types/models';

const SURFACE = 'activity-delete';

type LinkedTodosChoice = 'keep' | 'delete';

/** Ask how to delete: the plain danger confirm, or keep/delete-too when to-dos are linked. */
async function askToDelete(linkedCount: number): Promise<LinkedTodosChoice | null> {
  if (linkedCount === 0) {
    const ok = await confirm({
      title: 'planner.deleteActivity',
      message: 'planner.deleteConfirm',
      variant: 'danger',
    });
    return ok ? 'keep' : null;
  }

  const { t } = useTranslationStore();
  const one = linkedCount === 1;
  const choice = await confirmChoice({
    variant: 'danger',
    title: 'planner.deleteLinkedTodos.title',
    message: one ? 'planner.deleteLinkedTodos.message.one' : 'planner.deleteLinkedTodos.message',
    choices: [
      { id: 'keep', label: t('planner.deleteLinkedTodos.keep') },
      {
        id: 'delete',
        label: fillTemplate(
          t(one ? 'planner.deleteLinkedTodos.delete.one' : 'planner.deleteLinkedTodos.delete'),
          { count: linkedCount }
        ),
      },
    ],
    defaultChoice: 'keep',
  });
  if (choice === null) return null;
  return choice === 'delete' ? 'delete' : 'keep';
}

/**
 * Confirm, then delete the activity (and, when chosen, its open linked to-dos).
 *
 * @returns `true` ONLY when the activity was actually deleted.
 */
export async function confirmAndDeleteActivity(activity: FamilyActivity): Promise<boolean> {
  const activityStore = useActivityStore();
  const todoStore = useTodoStore();

  const linkedCount = todoStore.openTodosForActivity(activity.id).length;
  if (linkedCount > 0) {
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'Asked whether to keep the linked to-dos',
      context: { action: 'linked_todos_prompt', count: linkedCount, activity_id: activity.id },
    });
  }

  const choice = await askToDelete(linkedCount);
  if (choice === null) return false;

  // Re-read after the dialog: a to-do completed or deleted while it was open is not deleted
  // here (completed ones are always kept). It must be read BEFORE the activity delete, since
  // `openTodosForActivity` resolves against the activity store.
  const linkedIds = todoStore.openTodosForActivity(activity.id).map((t) => t.id);

  if (!(await activityStore.deleteActivity(activity.id))) return false;

  if (linkedCount > 0) {
    if (choice === 'delete') {
      // A failure here is toasted + reported once by `wrapAsync`; the to-dos survive.
      if (await todoStore.deleteTodos(linkedIds)) {
        logEvent({
          level: 'info',
          surface: SURFACE,
          message: 'Deleted the linked to-dos with the activity',
          context: {
            action: 'linked_todos_deleted',
            count: linkedIds.length,
            activity_id: activity.id,
          },
        });
      }
    } else {
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'Kept the linked to-dos',
        context: { action: 'linked_todos_kept', count: linkedIds.length, activity_id: activity.id },
      });
    }
  }
  return true;
}
