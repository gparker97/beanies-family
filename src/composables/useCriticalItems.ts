import { computed } from 'vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useTodoStore } from '@/stores/todoStore';
import { useListStore } from '@/stores/listStore';
import { useActivityStore } from '@/stores/activityStore';
import { isMedicationActive, useMedicationsStore } from '@/stores/medicationsStore';
import { useHolidayStore } from '@/stores/holidayStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { useTranslation } from '@/composables/useTranslation';
import { formatTime12, formatDateShort, addDays, toISODateString } from '@/utils/date';
import { useToday } from '@/composables/useToday';
import { normalizeAssignees, formatNameList } from '@/utils/assignees';
import { fillTemplate } from '@/utils/fillTemplate';
import { isTodoOverdue } from '@/utils/todo';
import { classifyAudience, classifyOwnerAudience, isDutyDone } from '@/utils/audience';
import { isListDue } from '@/utils/listLifecycle';
import { isFlagEnabled } from '@/config/flags';
import { getActivityFallbackEmoji } from '@/constants/activityCategories';
import type { UIStringKey } from '@/services/translation/uiStrings';

export interface CriticalItem {
  id: string;
  type: 'todo' | 'activity' | 'medication' | 'holiday' | 'list';
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

// The canonical "who sees what" audience rule (`classifyAudience` + `isDutyDone`
// + `BriefingAudience`) now lives in `@/utils/audience` — shared verbatim with
// the in-app notification deriver so the two can't drift. Mirrored in the "Your
// Daily Briefing" help article.

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

// Beanie Lists (#33) — briefing message keys (owner / for-child / unassigned ×
// due-state), mirroring the to-do tables. `classifyOwnerAudience`'s 'assignee'
// kind (= you own it) maps to the owner table.
const LIST_OWNER_KEYS = {
  overdue: 'lists.briefing.owner.overdue',
  today: 'lists.briefing.owner.today',
  noDue: 'lists.briefing.owner.noDue',
} satisfies Record<DateState, UIStringKey>;
const LIST_FORCHILD_KEYS = {
  overdue: 'lists.briefing.forChild.overdue',
  today: 'lists.briefing.forChild.today',
  noDue: 'lists.briefing.forChild.noDue',
} satisfies Record<DateState, UIStringKey>;
const LIST_UNASSIGNED_KEYS = {
  overdue: 'lists.briefing.unassigned.overdue',
  today: 'lists.briefing.unassigned.today',
  noDue: 'lists.briefing.unassigned.noDue',
} satisfies Record<DateState, UIStringKey>;

export function useCriticalItems() {
  const familyStore = useFamilyStore();
  const todoStore = useTodoStore();
  const listStore = useListStore();
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

    // ── Beanie Lists for the current member (whole lists, never items) ──
    // Gated behind `familyLists`; flag off → no list items at all. Uses the
    // shared `isListDue` predicate (so the briefing rule can't diverge from the
    // tile/store) and the single-owner audience classifier.
    if (isFlagEnabled('familyLists')) {
      for (const list of listStore.activeLists) {
        const audience = classifyOwnerAudience(list.ownerId, currentMember, getMemberById);
        if (audience.kind === 'hidden') continue;
        const due = isListDue(list, todayStr.value); // 'overdue' | 'today' | 'noDue' | null
        if (due === null) continue; // future-dated or recurring → not on the plate

        const remaining = list.items.filter((i) => !i.completed).length;
        // Don't surface empty / fully-checked lists ("0 left"): an undated list
        // only belongs on the plate while it still has open items.
        if (remaining === 0) continue;
        const dateLabel = due === 'overdue' && list.dueDate ? formatDateShort(list.dueDate) : '';

        let message: string;
        if (audience.kind === 'assignee') {
          message = buildMessage(LIST_OWNER_KEYS[due], {
            list: list.title,
            date: dateLabel,
            remaining: String(remaining),
          });
        } else if (audience.kind === 'forChild') {
          message = buildMessage(LIST_FORCHILD_KEYS[due], {
            children: formatNameList(audience.childNames),
            list: list.title,
            date: dateLabel,
            remaining: String(remaining),
          });
        } else {
          message = buildMessage(LIST_UNASSIGNED_KEYS[due], {
            list: list.title,
            date: dateLabel,
            remaining: String(remaining),
          });
        }

        items.push({
          id: list.id,
          type: 'list',
          message,
          icon: due === 'overdue' ? '⏰' : '🧾',
          time: '', // untimed — tapping opens /lists?view=<id>
          completable: false,
        });
      }
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

  /**
   * Resolve a briefing key and fill its `{placeholders}`. Delegates to the shared
   * `fillTemplate` (replaceAll + `$`-safe function replacer) — never a bare
   * `String.replace`, which is first-occurrence-only and mangles `$` sequences.
   */
  function buildMessage(key: UIStringKey, replacements: Record<string, string>): string {
    return fillTemplate(t(key), replacements);
  }

  /** Lowercase the first character for mid-sentence use. */
  function lowercaseFirst(str: string): string {
    if (!str) return str;
    return str.charAt(0).toLowerCase() + str.slice(1);
  }

  return { criticalItems };
}
