import { computed } from 'vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useTodoStore } from '@/stores/todoStore';
import { useActivityStore } from '@/stores/activityStore';
import { isMedicationActive, useMedicationsStore } from '@/stores/medicationsStore';
import { useHolidayStore } from '@/stores/holidayStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { isAdultMember, useMemberInfo } from '@/composables/useMemberInfo';
import { useTranslation } from '@/composables/useTranslation';
import { formatTime12, formatDateShort, addDays, toISODateString } from '@/utils/date';
import { useToday } from '@/composables/useToday';
import { normalizeAssignees, formatNameList } from '@/utils/assignees';
import { isTodoOverdue } from '@/utils/todo';
import { getActivityFallbackEmoji } from '@/constants/activityCategories';
import type { DutyCompletion, FamilyMember } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';

export interface CriticalItem {
  id: string;
  type: 'todo' | 'activity' | 'medication' | 'holiday';
  message: string;
  icon: string;
  time: string; // HH:mm for sorting, '' if untimed
  occurrenceDate?: string; // for activity modal opening
  completable?: boolean; // whether this item can be checked off inline
  completed?: boolean; // whether this item is done
  dutyType?: 'dropoff' | 'pickup' | 'dropoff-pickup'; // for duty items only
  caption?: string; // optional subtitle below the message (used by 'holiday')
}

/** How many briefing items show before the "Show all N" disclosure appears. */
export const CRITICAL_ITEMS_INITIAL_VISIBLE = 5;

/** Check whether a duty has been completed for a given occurrence date. */
function isDutyDone(completions: DutyCompletion[] | undefined, date: string): boolean {
  return completions?.some((c) => c.date === date) ?? false;
}

// ── Daily-briefing visibility rule ──────────────────────────────────────────
// `classifyAudience` is *the* canonical statement of "who sees a briefing item",
// used by both the activity loop and the to-do loop below. The rule:
//   • You're directly assigned                  → it's yours ('assignee').
//   • No adult is assigned, but ≥1 child is      → every adult sees it, framed by
//     the child's name ("Neil: …") ('forChild'); the assigned child still sees it
//     as their own via the 'assignee' branch. Other children don't see it.
//   • Nobody (resolvable, non-pet) is assigned   → everyone non-pet sees it
//     ("… (anyone can do this)") ('unassigned') — also where truly-unassigned,
//     all-stale-ID, and pet-only items land, all degrading gracefully.
//   • Anything else                              → 'hidden' for this viewer.
// Pets never get a briefing. Mirrored in the "Your Daily Briefing" help article.
type BriefingAudience =
  | { kind: 'assignee' }
  | { kind: 'forChild'; childNames: string[] }
  | { kind: 'unassigned' }
  | { kind: 'hidden' };

function classifyAudience(
  assigneeIds: string[],
  viewer: FamilyMember,
  resolveMember: (id: string) => FamilyMember | undefined
): BriefingAudience {
  const known = assigneeIds.map(resolveMember).filter((m): m is FamilyMember => m !== undefined);
  if (known.some((m) => m.id === viewer.id)) return { kind: 'assignee' };
  if (known.some(isAdultMember)) return { kind: 'hidden' }; // a parent owns it → only assignees see it
  const kids = known.filter((m) => !m.isPet); // already non-adult — any adult would have returned above
  if (kids.length > 0) {
    return isAdultMember(viewer)
      ? { kind: 'forChild', childNames: kids.map((m) => m.name) }
      : { kind: 'hidden' }; // other children don't get this kid's item
  }
  return viewer.isPet ? { kind: 'hidden' } : { kind: 'unassigned' }; // none / all-stale / pet-only
}

type DateState = 'overdue' | 'today' | 'noDue';

// Message-key lookup tables — `satisfies` keeps every key real and the tables
// exhaustive, so a typo or a missing variant is a compile error.
const TODO_ASSIGNEE_KEYS = {
  overdue: { self: 'nook.criticalTodoSelfOverdue', other: 'nook.criticalTodoAssignedOverdue' },
  today: { self: 'nook.criticalTodoSelf', other: 'nook.criticalTodoAssigned' },
  noDue: { self: 'nook.criticalTodoSelfNoDue', other: 'nook.criticalTodoAssignedNoDue' },
} satisfies Record<DateState, Record<'self' | 'other', UIStringKey>>;

const TODO_FORCHILD_KEYS = {
  overdue: 'nook.criticalTodoForChildOverdue',
  today: 'nook.criticalTodoForChild',
  noDue: 'nook.criticalTodoForChildNoDue',
} satisfies Record<DateState, UIStringKey>;

const TODO_UNASSIGNED_KEYS = {
  overdue: 'nook.criticalTodoUnassignedOverdue',
  today: 'nook.criticalTodoUnassigned',
  noDue: 'nook.criticalTodoUnassignedNoDue',
} satisfies Record<DateState, UIStringKey>;

const ACTIVITY_ASSIGNEE_KEYS = {
  timed: 'nook.criticalActivity',
  untimed: 'nook.criticalActivityNoTime',
} satisfies Record<'timed' | 'untimed', UIStringKey>;

const ACTIVITY_FORCHILD_KEYS = {
  timed: 'nook.criticalActivityForChild',
  untimed: 'nook.criticalActivityForChildNoTime',
} satisfies Record<'timed' | 'untimed', UIStringKey>;

export function useCriticalItems() {
  const familyStore = useFamilyStore();
  const todoStore = useTodoStore();
  const activityStore = useActivityStore();
  const medicationsStore = useMedicationsStore();
  const holidayStore = useHolidayStore();
  const settingsStore = useSettingsStore();
  const { getMemberName, getMemberById } = useMemberInfo();
  const { t } = useTranslation();
  const { today: todayStr } = useToday();

  /**
   * The full, sorted briefing list for the current member. Capping to the
   * first {@link CRITICAL_ITEMS_INITIAL_VISIBLE} (with "Show all"/"Show less")
   * is a view concern — `FamilyStatusToast` does it via `useExpandableList`.
   */
  const criticalItems = computed<CriticalItem[]>(() => {
    const currentMember = familyStore.currentMember;
    if (!currentMember) return [];
    const memberId = currentMember.id;

    const items: CriticalItem[] = [];

    // ── Activities where current member has a role today ──────────────
    const todayActivities = activityStore.activitiesForDate(todayStr.value);
    for (const { activity, date } of todayActivities) {
      // Vacation notifications only on departure day
      if (activity.vacationId && date !== activity.date) continue;

      const isPickup = activity.pickupMemberId === memberId;
      const isDropoff = activity.dropoffMemberId === memberId;
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

      // Generic "you have …" / for-child "Neil: …" message — only if we're not
      // already showing a pickup/dropoff item for this activity.
      if (!isPickup && !isDropoff) {
        const audience = classifyAudience(assignees, currentMember, getMemberById);
        if (audience.kind === 'assignee' || audience.kind === 'forChild') {
          const timing = activity.startTime ? 'timed' : 'untimed';
          const key =
            audience.kind === 'forChild'
              ? ACTIVITY_FORCHILD_KEYS[timing]
              : ACTIVITY_ASSIGNEE_KEYS[timing];
          items.push({
            id: activity.id,
            type: 'activity',
            message: buildMessage(key, {
              children: audience.kind === 'forChild' ? formatNameList(audience.childNames) : '',
              activity: activity.title,
              time: formatTime12(activity.startTime ?? ''),
            }),
            icon: activity.icon ?? getActivityFallbackEmoji(activity.category),
            time: activity.startTime ?? '',
            occurrenceDate: date,
          });
        }
      }
    }

    // ── Active medications with required-but-not-yet-logged doses today ──
    // Audience: shown to ALL family members (the "for {member}" in the
    // message carries the context — patient sees their own, caretakers
    // see the patient's). Skips legacy/as-needed (no structured count).
    // The `?? []` is defensive insurance; the store always initializes
    // `medications` to an array, but null-safe access here means a
    // mid-init race could never crash the whole computed.
    for (const med of medicationsStore.medications ?? []) {
      // Skip inactive medications (ended, future-dated, or otherwise not
      // currently being given).
      if (!isMedicationActive(med, todayStr.value)) continue;
      // Skip legacy meds (dosesPerDay undefined) and explicit "as needed"
      // (null) — both surface as "Other" in the form and produce no
      // reminder. Add a 4th condition? Insert above this comment block.
      if (typeof med.dosesPerDay !== 'number') continue;
      // Skip if today's full dose count is already logged.
      const remaining = med.dosesPerDay - medicationsStore.dosesToday(med.id);
      if (remaining <= 0) continue;

      const memberName = getMemberName(med.memberId, t('family.unknownMemberInline'));
      const messageKey: UIStringKey =
        remaining === 1 ? 'nook.criticalMedReminderOne' : 'nook.criticalMedReminder';
      items.push({
        id: med.id,
        type: 'medication',
        message: buildMessage(messageKey, {
          medication: med.name,
          member: memberName,
          remaining: String(remaining),
        }),
        icon: '💊',
        time: '', // untimed in v1
        completable: false, // tap-to-open-detail; no inline +dose
      });
    }

    // ── To-dos for the current member ─────────────────────────────────
    // Visibility per `classifyAudience` above: assignees see their own,
    // every adult sees child-only to-dos, everyone sees unassigned ones.
    for (const todo of todoStore.activeTodos) {
      const audience = classifyAudience(normalizeAssignees(todo), currentMember, getMemberById);
      if (audience.kind === 'hidden') continue;

      const dueDate = todo.dueDate?.split('T')[0] ?? '';
      const hasDate = dueDate !== '';
      const isOverdue = isTodoOverdue(todo);
      const isDueToday = dueDate === todayStr.value;
      // A to-do with a due date still in the future isn't on anyone's plate yet.
      if (hasDate && !isOverdue && !isDueToday) continue;

      const dateState: DateState = isOverdue ? 'overdue' : isDueToday ? 'today' : 'noDue';
      const taskTitle = lowercaseFirst(todo.title);
      const dateLabel = isOverdue ? formatDateShort(dueDate) : '';

      let message: string;
      if (audience.kind === 'assignee') {
        const fromOther = !!todo.createdBy && todo.createdBy !== memberId;
        const key = TODO_ASSIGNEE_KEYS[dateState][fromOther ? 'other' : 'self'];
        message = buildMessage(key, {
          creator: getMemberName(todo.createdBy),
          task: taskTitle,
          date: dateLabel,
        });
      } else if (audience.kind === 'forChild') {
        message = buildMessage(TODO_FORCHILD_KEYS[dateState], {
          children: formatNameList(audience.childNames),
          task: taskTitle,
          date: dateLabel,
        });
      } else {
        message = buildMessage(TODO_UNASSIGNED_KEYS[dateState], {
          task: taskTitle,
          date: dateLabel,
        });
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

    // ── Tomorrow's public holiday (pinned to position 0) ──────────────
    // Gated on country + the planner's "show public holidays" toggle
    // (`settingsStore.showPublicHolidays` auto-returns false when no
    // country is set). One entry max per day; no checkbox.
    if (settingsStore.showPublicHolidays) {
      const tomorrowISO = toISODateString(addDays(new Date(todayStr.value + 'T00:00:00'), 1));
      const holiday = holidayStore.holidayForDate(tomorrowISO);
      if (holiday) {
        items.unshift({
          id: `holiday-${holiday.date}`,
          type: 'holiday',
          message: buildMessage('nook.holiday.tomorrow.message', { holidayName: holiday.name }),
          caption: t('nook.holiday.tomorrow.caption'),
          icon: '✨',
          time: '',
          completable: false,
        });
      }
    }

    return items;
  });

  /** Replace {placeholders} in a translated string. Unknown placeholders no-op. */
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

  return { criticalItems };
}
