import { computed } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import { useFamilyStore } from '@/stores/familyStore';
import { useTodoStore } from '@/stores/todoStore';
import { useListStore } from '@/stores/listStore';
import { useMealPlanStore } from '@/stores/mealPlanStore';
import { useRecipesStore } from '@/stores/recipesStore';
import { useActivityStore } from '@/stores/activityStore';
import { isMedicationActive, useMedicationsStore } from '@/stores/medicationsStore';
import { useHolidayStore } from '@/stores/holidayStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useResponsibilityStore } from '@/stores/responsibilityStore';
import { useNotificationsStore } from '@/stores/notificationsStore';
import { useVacationStore } from '@/stores/vacationStore';
import { useFlightStatusStore } from '@/stores/flightStatusStore';
import { useChoreStore } from '@/stores/choreStore';
import { buildTravelBriefingRows } from '@/composables/criticalItems/travelRows';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { useResponsibilityCardLabel } from '@/composables/useResponsibilityCardLabel';
import { buildCardBriefingRows, ymdOf, type CardBriefingRow } from '@/utils/responsibilityDeck';
import { useTranslation } from '@/composables/useTranslation';
import { BRIEFING_HIDE_PREFIX } from '@/utils/notifications';
import { logEvent } from '@/services/telemetry/logEvent';
import {
  formatTime12,
  formatDateShort,
  formatNookDate,
  addDays,
  toISODateString,
} from '@/utils/date';
import { useToday } from '@/composables/useToday';
import { normalizeAssignees, formatNameList } from '@/utils/assignees';
import { fillTemplate } from '@/utils/fillTemplate';
import { isCardTodo } from '@/utils/todoRecurrence';
import { plateClock, platedTodos, type ShownPlate } from '@/utils/todoPlate';
import {
  classifyAudience,
  classifyOwnerAudience,
  classifyPlateList,
  classifyPlateTodo,
  choreLinesFor,
  isDutyDone,
} from '@/utils/audience';
import { CHORE_BLOCK_META } from '@/constants/choreBlocks';
import { isFlagEnabled } from '@/config/flags';
import { getActivityFallbackEmoji } from '@/constants/activityCategories';
import { hintEmoji, isFreshHint } from '@/utils/helpfulHints';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { showToast } from '@/composables/useToast';
import type { ChoreBlock } from '@/types/models';

export interface CriticalItem {
  id: string;
  type:
    'todo' | 'activity' | 'medication' | 'holiday' | 'list' | 'meal' | 'card' | 'travel' | 'chores';
  message: string;
  icon: string;
  time: string; // HH:mm for sorting, '' if untimed
  /** Not today's business (a to-do or list not due yet, a Helpful Hint): sorts below every
   * row that belongs to today, in insertion order (upcoming to-dos, lists, then hints). */
  later?: boolean;
  occurrenceDate?: string; // for activity modal opening
  completable?: boolean; // whether this item can be checked off inline
  completed?: boolean; // whether this item is done
  dutyType?: 'dropoff' | 'pickup' | 'dropoff-pickup'; // for duty items only
  caption?: string; // optional subtitle below the message (used by 'holiday')
  /**
   * The row's ✕ writes this per-member read key (notificationsStore.markRead): a Who
   * Owns What row's own key, else a `briefing-hide:` key for this day or occurrence.
   * Absent only on a hint row, whose ✕ dismisses the hint itself (`dismissHint`).
   */
  dismissKey?: string;
  /** An un-kept Helpful Hint row: the ✕ dismisses the hint family-wide, as on the to-do page. */
  dismissHint?: boolean;
  /** Generic: tapping the row routes here (never falls through to open-activity). */
  route?: RouteLocationRaw;
  /** A `chores` row's time-of-day block: the view paints the row's icon in its colour. */
  choreBlock?: ChoreBlock;
}

/** The hide toast's second line: says the item itself is untouched (still open). */
const HIDDEN_TOAST_KEYS = {
  todo: 'nook.briefing.hidden.todo',
  activity: 'nook.briefing.hidden.activity',
  other: 'nook.briefing.hidden.other',
  plain: 'nook.briefing.hidden.plain', // nothing to open (a holiday note)
} satisfies Record<string, UIStringKey>;

function hiddenToastKey(item: CriticalItem, canOpen: boolean): UIStringKey {
  if (!canOpen) return HIDDEN_TOAST_KEYS.plain;
  if (item.type === 'todo') return HIDDEN_TOAST_KEYS.todo;
  if (item.type === 'activity') return HIDDEN_TOAST_KEYS.activity;
  return HIDDEN_TOAST_KEYS.other;
}

/** How many briefing items show before the "Show all N" disclosure appears. */
export const CRITICAL_ITEMS_INITIAL_VISIBLE = 5;

// The canonical "who sees what" audience rule (`classifyAudience` + `isDutyDone`
// + `BriefingAudience`) now lives in `@/utils/audience` — shared verbatim with
// the in-app notification deriver so the two can't drift. Mirrored in the "Your
// Daily Briefing" help article.

// Message-key lookup tables — `satisfies` keeps every key real and the tables
// exhaustive, so a typo or a missing variant is a compile error. The to-do tables are
// keyed by the to-do's plate (`utils/todoPlate`); a `waiting` to-do never reaches them.
const TODO_ASSIGNEE_KEYS = {
  overdue: { self: 'nook.criticalTodoSelfOverdue', other: 'nook.criticalTodoAssignedOverdue' },
  today: { self: 'nook.criticalTodoSelf', other: 'nook.criticalTodoAssigned' },
  undated: { self: 'nook.criticalTodoSelfNoDue', other: 'nook.criticalTodoAssignedNoDue' },
  upcoming: {
    self: 'nook.criticalTodoSelfUpcoming',
    other: 'nook.criticalTodoAssignedUpcoming',
  },
} satisfies Record<ShownPlate, Record<'self' | 'other', UIStringKey>>;

const TODO_FORCHILD_KEYS = {
  overdue: 'nook.criticalTodoForChildOverdue',
  today: 'nook.criticalTodoForChild',
  undated: 'nook.criticalTodoForChildNoDue',
  upcoming: 'nook.criticalTodoForChildUpcoming',
} satisfies Record<ShownPlate, UIStringKey>;

const TODO_UNASSIGNED_KEYS = {
  overdue: 'nook.criticalTodoUnassignedOverdue',
  today: 'nook.criticalTodoUnassigned',
  undated: 'nook.criticalTodoUnassignedNoDue',
  upcoming: 'nook.criticalTodoUnassignedUpcoming',
} satisfies Record<ShownPlate, UIStringKey>;

const ACTIVITY_ASSIGNEE_KEYS = {
  timed: 'nook.criticalActivity',
  untimed: 'nook.criticalActivityNoTime',
} satisfies Record<'timed' | 'untimed', UIStringKey>;

const ACTIVITY_FORCHILD_KEYS = {
  timed: 'nook.criticalActivityForChild',
  untimed: 'nook.criticalActivityForChildNoTime',
} satisfies Record<'timed' | 'untimed', UIStringKey>;

// Beanie Lists (#33): briefing message keys (assignee / for-child / unassigned ×
// plate), mirroring the to-do tables. The 'assignee' audience (= the list is yours)
// maps to the owner table; `upcoming` is a list shown early by its show rule.
const LIST_OWNER_KEYS = {
  overdue: 'lists.briefing.owner.overdue',
  today: 'lists.briefing.owner.today',
  undated: 'lists.briefing.owner.noDue',
  upcoming: 'lists.briefing.owner.upcoming',
} satisfies Record<ShownPlate, UIStringKey>;
const LIST_FORCHILD_KEYS = {
  overdue: 'lists.briefing.forChild.overdue',
  today: 'lists.briefing.forChild.today',
  undated: 'lists.briefing.forChild.noDue',
  upcoming: 'lists.briefing.forChild.upcoming',
} satisfies Record<ShownPlate, UIStringKey>;
const LIST_UNASSIGNED_KEYS = {
  overdue: 'lists.briefing.unassigned.overdue',
  today: 'lists.briefing.unassigned.today',
  undated: 'lists.briefing.unassigned.noDue',
  upcoming: 'lists.briefing.unassigned.upcoming',
} satisfies Record<ShownPlate, UIStringKey>;

// Meal planner (#27) — a cook assignment for today's meal. Briefing-only (like
// medication/lists); no due-state, so one key per audience kind.
const MEAL_OWNER_KEY = 'mealPlanner.briefing.owner' satisfies UIStringKey;
const MEAL_FORCHILD_KEY = 'mealPlanner.briefing.forChild' satisfies UIStringKey;
const MEAL_UNASSIGNED_KEY = 'mealPlanner.briefing.unassigned' satisfies UIStringKey;

// The choreboard (#146): one line per bean, `.one` / `.other` by the count; `{block}` is the
// block's lowercase word (`CHORE_BLOCK_META[block].wordKey`, shared with the widget). The viewer's
// own line is "You have ...".
const CHORE_LINE_KEYS = {
  self: { one: 'choreboard.briefing.self.one', other: 'choreboard.briefing.self.other' },
  bean: { one: 'choreboard.briefing.bean.one', other: 'choreboard.briefing.bean.other' },
} satisfies Record<'self' | 'bean', Record<'one' | 'other', UIStringKey>>;
const CHOREBOARD_PATH = '/choreboard';
/** A briefing chore line's id: bean, block and the missed state, so each is dismissed alone. */
const choreLineId = (line: { beanId: string; block: ChoreBlock; missed: boolean }): string =>
  `${line.beanId}:${line.block}${line.missed ? ':missed' : ''}`;

// Helpful Hints (#40) — one fixed framing, no due-state table (see the loop).
const HINT_KEY = 'nook.criticalHint' satisfies UIStringKey;

// Who Owns What (#109) — card rows come from the pure `buildCardBriefingRows`; this
// only maps them. Copy never counts anything about anyone but the viewer.
const WHO_OWNS_WHAT_PATH = '/who-owns-what';
const MOVED_KEYS = {
  from: 'whoOwnsWhat.briefing.movedAway',
  to: 'whoOwnsWhat.briefing.movedToYou',
} satisfies Record<'from' | 'to', UIStringKey>;

export function useCriticalItems() {
  const familyStore = useFamilyStore();
  const todoStore = useTodoStore();
  const listStore = useListStore();
  const mealPlanStore = useMealPlanStore();
  const recipesStore = useRecipesStore();
  const activityStore = useActivityStore();
  const medicationsStore = useMedicationsStore();
  const holidayStore = useHolidayStore();
  const settingsStore = useSettingsStore();
  const responsibilityStore = useResponsibilityStore();
  const notificationsStore = useNotificationsStore();
  const vacationStore = useVacationStore();
  const flightStatusStore = useFlightStatusStore();
  const choreStore = useChoreStore();
  const { cardName } = useResponsibilityCardLabel();
  const { getMemberName, getMemberById } = useMemberInfo();
  const { t, currentLanguage } = useTranslation();
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

      // Generic "you have …" / for-child "Ansel: …" message — only if we're not
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
    // Which to-dos and where they sit: `platedTodos` (plate order: overdue, today, undated,
    // upcoming) and `classifyPlateTodo` (the rule the widget shares). A to-do not showing yet
    // (its "Show from" date is ahead) is left out. Visibility per `classifyTodoAudience`:
    // assignees see their own, every adult sees a child's one-off to-dos and a child's routine
    // (repeating, incl. card to-dos) only once it is overdue or opted in (`notifyParents`);
    // everyone sees unassigned ones.
    // #40: `manualActiveTodos` excludes Helpful Hints — a hint's nudge-date
    // dueDate is in the past for its whole lead window, so through this loop's
    // tables it would read as "overdue". Hints have their own loop below with a
    // single fixed framing.
    // `todayStr` is read above, so this recomputes at midnight; the clock adds the minute.
    const clock = plateClock();
    for (const { todo } of platedTodos(todoStore.manualActiveTodos, clock)) {
      const classified = classifyPlateTodo(todo, currentMember, getMemberById, clock);
      if (!classified) continue;
      const { plate, audience } = classified;

      const dueDate = todo.dueDate?.slice(0, 10) ?? '';
      const taskTitle = lowercaseFirst(todo.title);
      const dateLabel =
        plate === 'overdue'
          ? formatDateShort(dueDate)
          : plate === 'upcoming'
            ? formatNookDate(dueDate)
            : '';

      let message: string;
      let icon = plate === 'overdue' ? '⏰' : '📋';
      if (isCardTodo(todo) && todo.repeat && dueDate === clock.ymd) {
        // #123: a card reminder on its due day reads as the reminder itself, for every
        // audience the loop admits ("Reminder for Sofia: put the trash out at 8:00 PM!"),
        // including once its time has passed (a missed reminder still names its time).
        const sole = normalizeAssignees(todo)[0];
        const name = getMemberName(sole, t('family.unknownMemberInline'));
        message = todo.dueTime
          ? buildMessage('nook.reminderFor', {
              name,
              task: taskTitle,
              time: formatTime12(todo.dueTime),
            })
          : buildMessage('nook.reminderForAllDay', { name, task: taskTitle });
        icon = '🔔';
      } else if (audience.kind === 'assignee') {
        const fromOther = !!todo.createdBy && todo.createdBy !== memberId;
        const key = TODO_ASSIGNEE_KEYS[plate][fromOther ? 'other' : 'self'];
        message = buildMessage(key, {
          creator: getMemberName(todo.createdBy),
          task: taskTitle,
          date: dateLabel,
        });
      } else if (audience.kind === 'forChild') {
        message = buildMessage(TODO_FORCHILD_KEYS[plate], {
          children: formatNameList(audience.childNames),
          task: taskTitle,
          date: dateLabel,
        });
      } else {
        message = buildMessage(TODO_UNASSIGNED_KEYS[plate], {
          task: taskTitle,
          date: dateLabel,
        });
      }

      items.push({
        id: todo.id,
        type: 'todo',
        message,
        icon,
        time: plate === 'today' ? (todo.dueTime ?? '') : '',
        ...(plate === 'upcoming' ? { later: true } : {}),
        completable: true,
        completed: false, // open todos are never completed (completed ones are filtered out)
      });
    }

    // ── Beanie Lists for the current member (whole lists, never items) ──
    // Gated behind `familyLists`; flag off → no list items at all. Which lists and where
    // they sit: `classifyPlateList`, the rule the widget shares (the list's show rule, its
    // assignees through `ownerItemSurfaces`, and its "N left"). It leaves out a list not
    // showing yet, one nobody known is assigned to (the SAME gate the bell deriver and the
    // OS scheduler use, so a list owned by nobody never lands on every member's plate), a
    // filed list and one with nothing left. `upcoming` is a list shown early by its rule.
    if (isFlagEnabled('familyLists')) {
      for (const list of listStore.activeLists) {
        const classified = classifyPlateList(list, currentMember, getMemberById, clock);
        if (!classified) continue;
        const { plate, audience, remaining, due } = classified;
        const dateLabel =
          plate === 'overdue' && due
            ? formatDateShort(due)
            : plate === 'upcoming' && due
              ? formatNookDate(due)
              : '';
        const params = { list: list.title, date: dateLabel, remaining: String(remaining) };

        let message: string;
        if (audience.kind === 'assignee') {
          message = buildMessage(LIST_OWNER_KEYS[plate], params);
        } else if (audience.kind === 'forChild') {
          message = buildMessage(LIST_FORCHILD_KEYS[plate], {
            ...params,
            children: formatNameList(audience.childNames),
          });
        } else {
          message = buildMessage(LIST_UNASSIGNED_KEYS[plate], params);
        }

        items.push({
          id: list.id,
          type: 'list',
          message,
          icon: plate === 'overdue' ? '⏰' : '🧾',
          time: '', // untimed — tapping opens /lists?view=<id>
          ...(plate === 'upcoming' ? { later: true } : {}),
          completable: false,
        });
      }
    }

    // ── Today's cook assignments (meal planner) ──────────────────────
    // Recipe meals for today with a cook that aren't cooked yet. Briefing-only,
    // non-completable (marking cooked needs the rating form, not a checkbox).
    // Gated behind `mealPlanner`; flag off → no meal briefing items at all.
    if (isFlagEnabled('mealPlanner')) {
      for (const meal of mealPlanStore.todaysCookAssignments) {
        const audience = classifyOwnerAudience(meal.cookMemberId!, currentMember, getMemberById);
        if (audience.kind === 'hidden') continue;
        const recipeName = recipesStore.recipes.find((r) => r.id === meal.recipeId)?.name ?? '';
        let message: string;
        if (audience.kind === 'forChild') {
          message = buildMessage(MEAL_FORCHILD_KEY, {
            name: formatNameList(audience.childNames),
            meal: recipeName,
          });
        } else if (audience.kind === 'unassigned') {
          message = buildMessage(MEAL_UNASSIGNED_KEY, { meal: recipeName });
        } else {
          message = buildMessage(MEAL_OWNER_KEY, { meal: recipeName });
        }
        items.push({
          id: meal.id,
          type: 'meal',
          message,
          icon: '🍲',
          time: meal.serveTime ?? '',
          completable: false,
        });
      }
    }

    // ── Today's departures (#143): plain rows, or the airline's change/cancellation ──
    items.push(
      ...buildTravelBriefingRows(
        vacationStore.travelSegmentOccurrencesInRange(todayStr.value, todayStr.value),
        {
          today: todayStr.value,
          nowMs: Date.now(),
          viewer: currentMember,
          members: familyStore.members,
          resolveMember: getMemberById,
          t,
          lang: currentLanguage.value,
          verificationFor: flightStatusStore.verificationFor,
        }
      )
    );

    // ── Who Owns What (#109) card rows ───────────────────────────────
    // Untimed, so they keep insertion order among today's rows: below the rest of today,
    // above the `later` tail (upcoming to-dos, then hints).
    const cardRows = buildCardBriefingRows({
      cards: responsibilityStore.resolved,
      moves: responsibilityStore.moves,
      checkIns: responsibilityStore.checkIns,
      rhythmWeeks: responsibilityStore.rhythmWeeks,
      readState: notificationsStore.readState,
      viewerId: memberId,
      viewerIsAdult: responsibilityStore.canDeal, // same gate as the nav badge + deck writes
      today: todayStr.value,
    });
    for (const row of cardRows) items.push(cardItem(row));

    // ── The choreboard (#146): one line per bean the viewer may follow ─────
    // Gated behind `choreboard` (flag off → no chore lines at all). The numbers come from the
    // read model (`choreDayFor`, today on the one chore clock) through `choreLinesFor`, the rule
    // the widget shares: a bean always sees their own; a grown-up sees a child's chore only when
    // it keeps parents posted or its block has ended with it undone; siblings never. A bean with
    // nothing left has no line here (the widget shows it as "Done"). Untimed and not `later`, so
    // the lines sit among today's rows, above the hints. The viewer's own line comes first.
    if (isFlagEnabled('choreboard')) {
      const beans = [...familyStore.humans].sort(
        (a, b) => Number(b.id === memberId) - Number(a.id === memberId)
      );
      const readState = notificationsStore.readState;
      for (const bean of beans) {
        // The candidates come best first; the first one the viewer has not hidden today wins,
        // so hiding the missed Morning line hands over to the Afternoon line rather than
        // blanking the bean (the widget, which hides nothing, shows the first candidate).
        const line = choreLinesFor(
          choreStore.choreDayFor(bean.id),
          bean.id,
          currentMember,
          getMemberById
        ).find(
          (l) =>
            l.left > 0 &&
            !readState[hideKey({ type: 'chores', id: choreLineId(l) }, todayStr.value)]
        );
        if (!line) continue;
        const keys = CHORE_LINE_KEYS[line.own ? 'self' : 'bean'];
        items.push({
          // The line's id carries its block and whether it is about missed chores, because the
          // day's hide key is built from it: hiding the morning line must not hide the same
          // bean's afternoon line, nor the line that later says the morning was missed.
          id: choreLineId(line),
          type: 'chores',
          message: buildMessage(line.left === 1 ? keys.one : keys.other, {
            name: bean.name,
            n: String(line.left),
            block: t(CHORE_BLOCK_META[line.block].wordKey),
          }),
          icon: CHORE_BLOCK_META[line.block].emoji,
          time: '',
          completable: false,
          choreBlock: line.block,
          route: { path: CHOREBOARD_PATH, query: { bean: bean.id } },
        });
      }
    }

    // ── Helpful Hints (#40) for the current member ─────────────────────
    // Hints ride their own loop, never the to-do loop: a hint's dueDate is its
    // nudge date, so through the overdue/today/noDue tables every hint would read
    // as overdue for its whole lead window. One fixed framing, no date state, no
    // ⏰. Audience is the store's own `visibleHintTodos` so a surprise-sensitive
    // hint (the birthday person's present) stays hidden from them.
    //
    // Untimed, flagged `later` and pushed LAST: the sort keeps insertion order within the
    // `later` tail, so hints sit after upcoming to-dos and after every row of today. Keep this the final block
    // before the sort — a new item kind goes ABOVE it. The "hints after a manual
    // to-do" unit test is what locks this.
    if (isFlagEnabled('helpfulHints')) {
      // dueDate is deliberately ignored: for a hint it is the notification-fire
      // date (today, or tomorrow once the 09:00 slot has passed), so a date
      // filter here would hide every hint generated after 09:00 until the next
      // morning. Sort soonest event first, not newest-generated first
      // (`activeTodos` order).
      const hints = todoStore
        .visibleHintTodos(currentMember, getMemberById)
        .sort((a, b) => (a.hintEventDate ?? '').localeCompare(b.hintEventDate ?? ''));
      for (const hint of hints) {
        items.push({
          id: hint.id,
          type: 'todo', // tick → toggleComplete, tap → open-todo, unchanged
          message: buildMessage(HINT_KEY, { task: lowercaseFirst(hint.title) }),
          icon: hintEmoji(hint.hintType), // tolerant of a type this build doesn't know
          time: '',
          completable: true,
          completed: false,
          // Only an un-kept hint is dismissed outright. A KEPT hint is the family's own
          // to-do now: its ✕ just hides it for today, like any other to-do.
          dismissHint: isFreshHint(hint),
          later: true,
        });
      }
    }

    // Sort: timed items first (ascending), untimed next, not-yet-due to-dos last
    items.sort((a, b) => {
      if (a.time && b.time) return a.time.localeCompare(b.time);
      if (a.time && !b.time) return -1;
      if (!a.time && b.time) return 1;
      // Not-yet-due to-dos and hints sit below everything that belongs to today (lists,
      // meals, cards), keeping insertion order among themselves: to-dos, then hints.
      return Number(!!a.later) - Number(!!b.later);
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

    // Every row the member can dismiss for the day gets its hide key; rows already
    // hidden drop out. Card rows carry their own keys and their own snooze rule
    // (`buildCardBriefingRows` already filtered them), so they skip this filter.
    const readState = notificationsStore.readState;
    return items.flatMap((item) => {
      if (item.dismissHint || item.dismissKey) return [item];
      const dismissKey = hideKey(item, todayStr.value);
      return readState[dismissKey] ? [] : [{ ...item, dismissKey }];
    });
  });

  /**
   * A dismissed row's key. Activities key on their occurrence, so the dismissal is
   * for that session only; everything else keys on today, so a to-do that is still
   * overdue (or a dose still owed) is back in tomorrow's briefing.
   */
  function hideKey(
    item: Pick<CriticalItem, 'type' | 'id' | 'occurrenceDate'>,
    today: string
  ): string {
    return `${BRIEFING_HIDE_PREFIX}${item.type}:${item.id}:${item.occurrenceDate ?? today}`;
  }

  /**
   * The row's ✕. A fresh hint is dismissed family-wide (`discardTodo`, never
   * regenerated; it shows its own Undo toast). Any other row is hidden from this
   * member's briefing, with the house Undo toast saying the item itself is still
   * open; tapping that toast runs `open` (the row's own tap target, from the view).
   */
  async function dismissItem(item: CriticalItem, open?: () => void): Promise<boolean> {
    let action: 'hint' | 'card' | 'hide' | 'hide-done';
    let ok: boolean;
    if (item.dismissHint) {
      action = 'hint';
      ok = await todoStore.discardTodo(item.id); // logs its own helpful-hints outcome too
    } else if (item.dismissKey) {
      const key = item.dismissKey;
      action = item.type === 'card' ? 'card' : item.completed ? 'hide-done' : 'hide';
      notificationsStore.markRead(key); // reports its own write failure
      ok = true;
      showToast('info', t('nook.briefing.hiddenToast'), t(hiddenToastKey(item, !!open)), {
        actionLabel: t('action.undo'),
        actionFn: () => {
          notificationsStore.markUnread(key);
          logBriefing('info', 'briefing item restored', item.type, 'undo');
        },
        openFn: open
          ? () => {
              logBriefing('info', 'briefing item opened from toast', item.type, 'open');
              open();
            }
          : undefined,
        durationMs: 6000,
      });
    } else {
      return false;
    }
    // One event per tap, after the outcome. `hide-done` = a row the member had ticked.
    logBriefing(
      ok ? 'info' : 'warn',
      ok ? 'briefing item dismissed' : 'briefing item dismiss failed',
      item.type,
      action
    );
    return ok;
  }

  function logBriefing(
    level: 'info' | 'warn',
    message: string,
    kind: CriticalItem['type'],
    action: string
  ): void {
    logEvent({ level, surface: 'daily-briefing', message, context: { kind, action } });
  }

  /** One card row → one briefing item. No deck logic here, only copy and routing. */
  function cardItem(row: CardBriefingRow): CriticalItem {
    const base = { type: 'card' as const, time: '' };
    switch (row.kind) {
      case 'moved': {
        const card = responsibilityStore.cardById(row.cardId);
        const otherId = row.role === 'to' ? row.move.fromId : row.move.toId;
        return {
          ...base,
          id: row.dismissKey,
          message: buildMessage(MOVED_KEYS[row.role], {
            card: card ? cardName(card) : '',
            name: getMemberName(otherId, t('family.unknownMemberInline')),
            date: formatNookDate(ymdOf(row.move.at)),
          }),
          icon: '🙋',
          dismissKey: row.dismissKey,
          route: { path: WHO_OWNS_WHAT_PATH, query: { card: row.cardId } },
        };
      }
      case 'checkin':
        return {
          ...base,
          id: row.dismissKey,
          message: t('whoOwnsWhat.briefing.checkIn'),
          caption: t('whoOwnsWhat.briefing.checkInCaption'),
          icon: '🗓️',
          dismissKey: row.dismissKey,
          route: WHO_OWNS_WHAT_PATH,
        };
    }
  }

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

  return { criticalItems, dismissItem };
}
