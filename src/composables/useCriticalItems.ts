import { computed } from 'vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useTodoStore } from '@/stores/todoStore';
import { useActivityStore } from '@/stores/activityStore';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { useTranslation } from '@/composables/useTranslation';
import { formatTime12, formatDateShort } from '@/utils/date';
import { useToday } from '@/composables/useToday';
import { normalizeAssignees } from '@/utils/assignees';
import { isTodoOverdue } from '@/utils/todo';
import { getActivityFallbackEmoji } from '@/constants/activityCategories';
import type { DutyCompletion } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

export interface CriticalItem {
  id: string;
  type: 'todo' | 'activity';
  message: string;
  icon: string;
  time: string; // HH:mm for sorting, '' if untimed
  occurrenceDate?: string; // for activity modal opening
  completable?: boolean; // whether this item can be checked off inline
  completed?: boolean; // whether this item is done
  dutyType?: 'dropoff' | 'pickup' | 'dropoff-pickup'; // for duty items only
}

const MAX_ITEMS = 5;

/** Check whether a duty has been completed for a given occurrence date. */
function isDutyDone(completions: DutyCompletion[] | undefined, date: string): boolean {
  return completions?.some((c) => c.date === date) ?? false;
}

export function useCriticalItems() {
  const familyStore = useFamilyStore();
  const todoStore = useTodoStore();
  const activityStore = useActivityStore();
  const { getMemberName } = useMemberInfo();
  const { t } = useTranslation();
  const { today: todayStr } = useToday();

  const criticalItems = computed<CriticalItem[]>(() => {
    const memberId = familyStore.currentMemberId;
    if (!memberId) return [];

    const items: CriticalItem[] = [];

    // ── Activities where current member has a role today ──────────────
    const todayActivities = activityStore.activitiesForDate(todayStr.value);
    for (const { activity, date } of todayActivities) {
      // Vacation notifications only on departure day
      if (activity.vacationId && date !== activity.date) continue;

      const isPickup = activity.pickupMemberId === memberId;
      const isDropoff = activity.dropoffMemberId === memberId;
      const isAssignee = normalizeAssignees(activity).includes(memberId);

      const assignees = normalizeAssignees(activity);
      const child = assignees.length ? getMemberName(assignees[0], '') : '';

      if (isDropoff && isPickup) {
        // Combined dropoff + pickup for same person
        const key: UIStringKey =
          activity.startTime && activity.endTime
            ? 'nook.criticalDropoffPickup'
            : activity.startTime
              ? 'nook.criticalDropoffPickupStartOnly'
              : activity.endTime
                ? 'nook.criticalDropoffPickupEndOnly'
                : 'nook.criticalDropoffPickupNoTime';
        const dropoffDone = isDutyDone(activity.dropoffCompletions, date);
        const pickupDone = isDutyDone(activity.pickupCompletions, date);
        items.push({
          id: activity.id,
          type: 'activity',
          message: buildMessage(key, {
            child,
            activity: activity.title,
            startTime: formatTime12(activity.startTime ?? ''),
            endTime: formatTime12(activity.endTime ?? ''),
          }),
          icon: '🚗',
          time: activity.startTime ?? '',
          occurrenceDate: date,
          completable: true,
          completed: dropoffDone && pickupDone,
          dutyType: 'dropoff-pickup',
        });
      } else if (isPickup) {
        items.push({
          id: activity.id,
          type: 'activity',
          message: buildMessage(
            activity.endTime ? 'nook.criticalPickup' : 'nook.criticalPickupNoTime',
            { child, activity: activity.title, time: formatTime12(activity.endTime ?? '') }
          ),
          icon: '🚗',
          time: activity.endTime ?? '',
          occurrenceDate: date,
          completable: true,
          completed: isDutyDone(activity.pickupCompletions, date),
          dutyType: 'pickup',
        });
      } else if (isDropoff) {
        items.push({
          id: activity.id,
          type: 'activity',
          message: buildMessage(
            activity.startTime ? 'nook.criticalDropoff' : 'nook.criticalDropoffNoTime',
            { child, activity: activity.title, time: formatTime12(activity.startTime ?? '') }
          ),
          icon: '🚗',
          time: activity.startTime ?? '',
          occurrenceDate: date,
          completable: true,
          completed: isDutyDone(activity.dropoffCompletions, date),
          dutyType: 'dropoff',
        });
      }

      // Only show generic assignee message if not already showing pickup/dropoff
      if (isAssignee && !isPickup && !isDropoff) {
        items.push({
          id: activity.id,
          type: 'activity',
          message: buildMessage(
            activity.startTime ? 'nook.criticalActivity' : 'nook.criticalActivityNoTime',
            { activity: activity.title, time: formatTime12(activity.startTime ?? '') }
          ),
          icon: activity.icon ?? getActivityFallbackEmoji(activity.category),
          time: activity.startTime ?? '',
          occurrenceDate: date,
        });
      }
    }

    // ── Todos assigned to current member ──────────────────────────────
    for (const todo of todoStore.openTodos) {
      if (!normalizeAssignees(todo).includes(memberId)) continue;

      const dueDate = todo.dueDate?.split('T')[0] ?? '';
      const hasDate = dueDate !== '';
      const isOverdue = isTodoOverdue(todo);
      const isDueToday = dueDate === todayStr.value;
      const isFuture = hasDate && !isOverdue && !isDueToday;

      // Skip todos with a future due date
      if (isFuture) continue;

      const isFromOther = todo.createdBy && todo.createdBy !== memberId;
      const taskTitle = lowercaseFirst(todo.title);

      let message: string;
      if (isOverdue) {
        const dateLabel = formatDateShort(dueDate);
        message = isFromOther
          ? buildMessage('nook.criticalTodoAssignedOverdue', {
              creator: getMemberName(todo.createdBy),
              task: taskTitle,
              date: dateLabel,
            })
          : buildMessage('nook.criticalTodoSelfOverdue', {
              task: taskTitle,
              date: dateLabel,
            });
      } else if (isDueToday) {
        message = isFromOther
          ? buildMessage('nook.criticalTodoAssigned', {
              creator: getMemberName(todo.createdBy),
              task: taskTitle,
            })
          : buildMessage('nook.criticalTodoSelf', { task: taskTitle });
      } else {
        // No due date — show as a general reminder
        message = isFromOther
          ? buildMessage('nook.criticalTodoAssignedNoDue', {
              creator: getMemberName(todo.createdBy),
              task: taskTitle,
            })
          : buildMessage('nook.criticalTodoSelfNoDue', { task: taskTitle });
      }

      items.push({
        id: todo.id,
        type: 'todo',
        message,
        icon: isOverdue ? '⏰' : '📋',
        time: isDueToday ? (todo.dueTime ?? '') : '',
        completable: true,
        completed: false, // open todos are never completed (completed ones are filtered out)
      });
    }

    // Sort: timed items first (ascending), untimed last
    items.sort((a, b) => {
      if (a.time && b.time) return a.time.localeCompare(b.time);
      if (a.time && !b.time) return -1;
      if (!a.time && b.time) return 1;
      return 0;
    });

    return items.slice(0, MAX_ITEMS);
  });

  const overflowCount = computed(() => {
    // Recount without slice to determine overflow
    const memberId = familyStore.currentMemberId;
    if (!memberId) return 0;
    const totalActivities = activityStore
      .activitiesForDate(todayStr.value)
      .reduce((n, { activity, date }) => {
        // Vacation notifications only on departure day
        if (activity.vacationId && date !== activity.date) return n;
        const isPickup = activity.pickupMemberId === memberId;
        const isDropoff = activity.dropoffMemberId === memberId;
        const isAssignee = normalizeAssignees(activity).includes(memberId);
        // Combined dropoff+pickup counts as 1
        if (isDropoff && isPickup) n++;
        else if (isPickup) n++;
        else if (isDropoff) n++;
        if (isAssignee && !isPickup && !isDropoff) n++;
        return n;
      }, 0);
    const totalTodos = todoStore.openTodos.filter((todo) => {
      if (!normalizeAssignees(todo).includes(memberId)) return false;
      const dd = todo.dueDate?.split('T')[0] ?? '';
      return dd === '' || dd <= todayStr.value;
    }).length;
    const total = totalActivities + totalTodos;
    return Math.max(0, total - MAX_ITEMS);
  });

  /** Replace {placeholders} in a translated string. */
  function buildMessage(key: UIStringKey, replacements: Record<string, string>): string {
    let msg = t(key);
    for (const [k, v] of Object.entries(replacements)) {
      msg = msg.replace(`{${k}}`, v);
    }
    return msg;
  }

  /** Lowercase the first character for mid-sentence use. */
  function lowercaseFirst(str: string): string {
    if (!str) return str;
    return str.charAt(0).toLowerCase() + str.slice(1);
  }

  return { criticalItems, overflowCount };
}
