import { createAutomergeRepository } from '../automergeRepository';
import { mutate } from '@/services/automerge/worker/docClient';
import type { MutationOp } from '@/services/automerge/worker/protocol';
import { normalizeAssignees } from '@/utils/assignees';
import type {
  FamilyActivity,
  CreateFamilyActivityInput,
  UpdateFamilyActivityInput,
} from '@/types/models';

const repo = createAutomergeRepository<
  'activities',
  FamilyActivity,
  CreateFamilyActivityInput,
  UpdateFamilyActivityInput
>('activities');

export const getAllActivities = repo.getAll;
export const getActivityById = repo.getById;
export const createActivity = repo.create;
export const updateActivity = repo.update;
export const deleteActivity = repo.remove;

export async function getActivitiesByDate(date: string): Promise<FamilyActivity[]> {
  const activities = await getAllActivities();
  return activities.filter((a) => a.date === date);
}

export async function getActivitiesByAssignee(assigneeId: string): Promise<FamilyActivity[]> {
  const activities = await getAllActivities();
  return activities.filter((a) => normalizeAssignees(a).includes(assigneeId));
}

export async function getActivitiesByCategory(category: string): Promise<FamilyActivity[]> {
  const activities = await getAllActivities();
  return activities.filter((a) => a.category === category);
}

/**
 * ONE-SHOT #55 back-fill: set `reminderMinutes` on the given activities in a
 * single atomic batch. See `utils/activityReminderBackfill.ts` for the rule and
 * the retirement contract.
 *
 * Deliberately NOT `updateActivity` per id: that goes through
 * `activityStore.updateActivity` → `syncLinkedRecurringPayment`, which rewrites
 * the activity's linked recurring payment item and re-activates any the user had
 * deactivated. A reminders migration must never touch finance data.
 *
 * `{ quiet: true }` is mandatory — `mutate` is a USER_ACTION_METHOD, so without
 * it a rejection fires the "We couldn't update your data" toast at boot for a
 * maintenance write the user never asked for. Same reason `familyStore.normalizeRoles`
 * passes it. `onMissing: 'skip'` tolerates a concurrent delete.
 */
export async function backfillActivityReminders(
  ids: string[],
  reminderMinutes: number
): Promise<void> {
  if (ids.length === 0) return;
  const ops: MutationOp[] = ids.map((id) => ({
    op: 'patch',
    collection: 'activities',
    id,
    patch: { reminderMinutes },
    onMissing: 'skip',
  }));
  await mutate({ op: 'batch', ops }, { quiet: true });
}
