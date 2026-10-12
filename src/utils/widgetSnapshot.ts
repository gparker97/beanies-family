/**
 * The home-screen widget snapshot builder (#130, ADR-042): pure, Pinia-free, total.
 *
 * Computes the family's day once, in JS, and returns the `WidgetSnapshot` the native widgets
 * paint (contract: `types/widgetSnapshot.ts`). The composable `useWidgetSnapshot` assembles
 * the input from the stores and publishes the result; this file only computes.
 *
 * ⚠️ THIS MODULE MAKES NO AUDIENCE DECISION OF ITS OWN. "My day" is the Nook briefing's rule
 * and "our day" is the beanie wall's, and every gate below is a call into `audience.ts`,
 * `reminderSchedule.ts` or `wallJobs.ts`, so the widget cannot drift from the Nook and the
 * wall without those modules changing too. The per-audience differences live in ONE
 * `AUDIENCE_RULES` value per audience, never as `if (audience === ...)` in a block.
 *
 * Shape: `buildWidgetSnapshot` calls `buildWidgetDay` for each of the `WIDGET_DAYS` days,
 * for `my` and (unless the viewer is a child) `our`. A day is two sections (round 9b): the
 * CALENDAR (`rows`: trips, birthdays, events) and the TO-DOS (`tasks`: to-dos, hints and
 * lists in one due order, built as if that day were today). Each day walks `DAY_PARTS` with
 * ONE try/catch: a throw empties that part for that day and audience, counts as `skipped`,
 * and warns with the part and the record it was on (the `buildReminderSchedule` pattern).
 * One malformed record never empties the whole widget. The picker switches are applied
 * natively; every part is always built.
 */
import type {
  FamilyMember,
  FamilyVacation,
  LanguageCode,
  MealPlanEntry,
  Recipe,
  TodoItem,
} from '@/types/models';
import {
  WIDGET_DAYS,
  WIDGET_SNAPSHOT_VERSION,
  type WidgetAvatar,
  type WidgetDay,
  type WidgetDayEntry,
  type WidgetDot,
  type WidgetRow,
  type WidgetSnapshot,
  type WidgetTask,
  type WidgetTaskBucket,
  type WidgetTasks,
  type WidgetText,
} from '@/types/widgetSnapshot';
import type { UIStringKey } from '@/services/translation/uiStrings';
import type { ReminderInput } from '@/composables/useScheduledReminders';
import type { ActivityOccurrence } from '@/utils/calendar/occurrence';
import type { AvatarVariant } from '@/constants/avatars';
import type { HintTodo } from '@/utils/helpfulHints';
import { isHint } from '@/utils/helpfulHints';
import {
  activityReminderContext,
  localDateTime,
  type ActivityReminderContext,
} from '@/utils/reminderSchedule';
import {
  classifyAudience,
  classifyOwnerAudience,
  isDutyDone,
  ownerItemSurfaces,
} from '@/utils/audience';
import { buildWallJobs, isWallSafeList, jobOwnerIds, uniqueTodoJobs } from '@/utils/wallJobs';
import { isFiled, isListDue, isRecurring } from '@/utils/listLifecycle';
import { sortByTime } from '@/utils/wallActivities';
import { isTimedContinuation } from '@/utils/calendar/occurrence';
import { isAllDayActivity } from '@/utils/calendar/activityDays';
import { isSurpriseHint } from '@/constants/helpfulHints';
import { pickTonight } from '@/constants/mealSlots';
import { inkOnMemberColor, resolveMemberColor } from '@/constants/memberColors';
import { WIDGET_PAGE_PATHS } from '@/constants/externalDeepLinkPaths';
import { mealDisplayName } from '@/utils/mealDisplayName';
import { tripDayProgress, tripPhase } from '@/utils/vacation';
import { birthdaysInRange, MAX_AGE_SHOWN_ON_CALENDAR } from '@/utils/birthdays';
import { ENTITY_DEEP_LINKS, entityDeepLink, type DeepLink } from '@/utils/entityDeepLink';
import { shareableOrigin } from '@/utils/shareableOrigin';
import { formatUiDate } from '@/utils/uiLocale';
import { addDaysYmd, formatTime12 } from '@/utils/date';
import { fillTemplate } from '@/utils/fillTemplate';
import { firstName, formatNameList, normalizeAssignees } from '@/utils/assignees';
import { getMemberAvatarVariant } from '@/composables/useMemberAvatar';
import { isAdultMember } from '@/composables/useMemberInfo';

/**
 * Everything the builder reads. The first six fields are the reminders' own input
 * (`useScheduledReminders().reminderInput`), reused so the widget sees exactly the
 * occurrences and to-dos the OS reminders do; the rest are widget-only.
 */
export interface WidgetSnapshotInput extends Pick<
  ReminderInput,
  'occurrencesByDate' | 'todos' | 'lists' | 'currentMember' | 'resolveMember' | 't'
> {
  /** Device-local today (`useToday`), `YYYY-MM-DD`. */
  today: string;
  /** Today and the next `WIDGET_DAYS - 1` days, ascending; `days[0]` is `today`. */
  days: string[];
  members: FamilyMember[];
  /** `familyStore.initialsById`. */
  initialsById: ReadonlyMap<string, string>;
  /** Each day's meals in slot order (`mealPlanStore.mealsForDate`), keyed by ymd. */
  mealsByDate: Record<string, MealPlanEntry[]>;
  recipes: Recipe[];
  vacations: FamilyVacation[];
  /** `todoStore.visibleHintTodos(viewer, resolveMember)`: already hidden from whom they concern. */
  hintTodos: HintTodo[];
  flags: { mealPlanner: boolean; helpfulHints: boolean };
  /** Per-device "Show event titles on the lock screen" (`settingsStore.widgetLockScreenTitles`). */
  lockScreenTitles: boolean;
  language: LanguageCode;
  familyId: string;
}

export interface WidgetSnapshotResult {
  snapshot: WidgetSnapshot;
  /** Blocks dropped by a THROWN error across all days and audiences: a data bug. */
  skipped: number;
}

// ── Audience rules ──────────────────────────────────────────────────────────

type AudienceKey = 'my' | 'our' | 'child';

/**
 * Everything that differs between the three views of a day, in one place. Each predicate
 * delegates to the app's own classifier; none of them decides anything itself.
 */
interface AudienceRules {
  /** Which activity occurrences become rows. */
  showsActivity(ctx: ActivityReminderContext): boolean;
  /** Which to-do rule applies: the briefing's to-do loop, the wall's jobs, or none. */
  due: 'briefing' | 'wall' | 'none';
  /** Which lists may show: the owner's (briefing), the wall-safe ones, or none (`due: 'none'`). */
  lists: 'owner' | 'wall';
  /** Whether an undated task counts toward the date column's "for you today" count. */
  countUndated: boolean;
  /** Count copy at the foot of the date column. */
  countKeys: { one: UIStringKey; other: UIStringKey };
  /** Whether a task's dot may be the viewer's own (and the family's when nobody owns it). */
  dueNamesViewer: boolean;
  /** Which hints may show. */
  hints: 'viewer' | 'noSurprise' | 'none';
  /** Whether the viewer's pick-ups are listed (the lock-screen inline slot). */
  pickups: boolean;
  /** Whether a trip must concern the viewer (`classifyAudience`) to be counted down. */
  tripsForViewerOnly: boolean;
  /**
   * Whether copy may address the viewer as "you" ("tonight: tacos, you cook"). Off on the
   * family view, which reads the same whoever's phone it is on ("Sam cooks").
   */
  addressesViewer: boolean;
  /** Whether "coming up" counts down only the viewer's own birthday (the child view). */
  birthdaysForViewerOnly: boolean;
}

const AUDIENCE_RULES: Readonly<Record<AudienceKey, AudienceRules>> = Object.freeze({
  // The Nook briefing: a duty on it, or `classifyAudience` says it is mine or my child's.
  my: {
    showsActivity: (ctx) => ctx.dutyRoles.length > 0 || ownerItemSurfaces(ctx.audience),
    due: 'briefing',
    lists: 'owner',
    countUndated: true,
    countKeys: { one: 'widget.forYouToday.one', other: 'widget.forYouToday.other' },
    dueNamesViewer: false,
    hints: 'viewer',
    pickups: true,
    tripsForViewerOnly: true,
    addressesViewer: true,
    birthdaysForViewerOnly: false,
  },
  // The beanie wall's day lanes: everything on the day, no private lists, no surprises.
  our: {
    showsActivity: () => true,
    due: 'wall',
    lists: 'wall',
    countUndated: false,
    countKeys: { one: 'widget.dueToday.one', other: 'widget.dueToday.other' },
    dueNamesViewer: true,
    hints: 'noSurprise',
    pickups: false,
    tripsForViewerOnly: false,
    addressesViewer: false,
    birthdaysForViewerOnly: false,
  },
  // A child session: the child's own rows only; no to-dos, no hints.
  child: {
    showsActivity: (ctx) => ctx.audience.kind === 'assignee',
    due: 'none',
    lists: 'owner',
    countUndated: false,
    countKeys: { one: 'widget.forYouToday.one', other: 'widget.forYouToday.other' },
    dueNamesViewer: false,
    hints: 'none',
    pickups: true,
    tripsForViewerOnly: true,
    addressesViewer: true,
    birthdaysForViewerOnly: true,
  },
});

// ── Small pure helpers ──────────────────────────────────────────────────────

/**
 * The bundled beanie art for a member. One mapping, shared by the peek (`viewer.avatar`)
 * and the handoff avatars, so native needs one image per value.
 */
export function widgetAvatarFor(variant: AvatarVariant): WidgetAvatar {
  switch (variant) {
    case 'adult-male':
      return 'father';
    case 'adult-female':
      return 'mother';
    case 'child-male':
      return 'boy';
    case 'child-female':
      return 'girl';
    case 'pet-dog':
      return 'dog';
    default:
      // adult-other, child-other and the two family variants.
      return 'neutral';
  }
}

/**
 * An absolute widget link: `shareableOrigin()` (never `location.origin`, which is
 * `capacitor://` in the iOS shell) + path + query, always carrying `src=widget`, so native
 * only appends `&w=<size>`.
 */
function widgetLink(origin: string, link: DeepLink): string {
  const query = new URLSearchParams({ ...link.query, src: 'widget' });
  return `${origin}${link.path}?${query.toString()}`;
}

/** The to-do page itself (the due count), from the same entity map the item links use. */
function todoPageLink(origin: string): string {
  return widgetLink(origin, { path: ENTITY_DEEP_LINKS.todo.path, query: {} });
}

/** `{ text, emphasis }`, filling one template; `emphasis` must be a substring of `text`. */
function emphasised(text: string, emphasis: string): WidgetText {
  return text.includes(emphasis) ? { text, emphasis } : { text };
}

/** Pick `.one` or `.other` and fill `{n}`. */
function counted(
  t: (key: UIStringKey) => string,
  keys: { one: UIStringKey; other: UIStringKey },
  n: number
): string {
  return fillTemplate(t(n === 1 ? keys.one : keys.other), { n: String(n) });
}

// ── Per-day context ─────────────────────────────────────────────────────────

/** One activity row being built, with the context the later blocks enrich it from. */
interface RowEntry {
  occ: ActivityOccurrence;
  ctx: ActivityReminderContext;
  row: WidgetRow;
}

interface DayContext {
  input: WidgetSnapshotInput;
  ymd: string;
  /** The last day of the look-ahead from `ymd` (later tasks beyond it are left out). */
  horizon: string;
  viewer: FamilyMember;
  rules: AudienceRules;
  origin: string;
  /** Rows built by the "events" part, enriched by "who's where". */
  entries: RowEntry[];
  /** Trip and birthday rows, assembled into the calendar ahead of the events. */
  tripRows: WidgetRow[];
  birthdayRows: WidgetRow[];
  /** The record a block is on, for the skipped-block warning. */
  cursor: string;
}

/** A member by id, through the input's resolver (stale ids resolve to nothing). */
function member(ctx: DayContext, id: string | undefined): FamilyMember | undefined {
  return id ? ctx.input.resolveMember(id) : undefined;
}

/** First names of the resolvable members among `ids`, as the app's name list. */
function firstNames(ctx: DayContext, ids: readonly string[]): string {
  return formatNameList(
    ids
      .map((id) => member(ctx, id))
      .filter((m): m is FamilyMember => m !== undefined)
      .map((m) => firstName(m.name))
  );
}

/** The coloured initial beside a row: the first resolvable assignee, else the family icon. */
function rowDot(ctx: DayContext, assigneeIds: readonly string[]): WidgetDot {
  const owner = assigneeIds.map((id) => member(ctx, id)).find((m) => m !== undefined);
  if (!owner) return { kind: 'family' };
  const color = resolveMemberColor(owner.color);
  return {
    kind: 'member',
    initial: ctx.input.initialsById.get(owner.id) ?? firstName(owner.name).slice(0, 1),
    color,
    ink: inkOnMemberColor(color),
  };
}

/** Start and end instants (epoch ms) of a timed occurrence; nulls for an all-day one. */
function rowInstants(occ: ActivityOccurrence): { startsAt: number | null; endsAt: number | null } {
  const a = occ.activity;
  if (isAllDayActivity(a)) return { startsAt: null, endsAt: null };
  const start = localDateTime(occ.date, a.startTime);
  if (!start) return { startsAt: null, endsAt: null };
  let end = a.endTime ? localDateTime(occ.date, a.endTime) : start;
  // An end before the start runs past midnight (the wall's overnight rule).
  if (end && end < start) end = localDateTime(addDaysYmd(occ.date, 1), a.endTime);
  return { startsAt: start.getTime(), endsAt: (end ?? start).getTime() };
}

/**
 * Occurrences that are a day's own events. A trip is shown on its departure day only, as
 * the briefing does, and an overnight event's next-morning tail is not a second event
 * (`isTimedContinuation`, the wall's and the reminders' rule).
 */
function dayOccurrences(ctx: DayContext): ActivityOccurrence[] {
  const occurrences = ctx.input.occurrencesByDate[ctx.ymd] ?? [];
  const own = occurrences.filter((occ) => {
    const a = occ.activity;
    if (a.vacationId && occ.date !== a.date) return false;
    return !isTimedContinuation(occ);
  });
  // `sortByTime` puts all-day first; the widget lists timed first, then untimed.
  const sorted = sortByTime(own);
  return [
    ...sorted.filter((o) => !isAllDayActivity(o.activity)),
    ...sorted.filter((o) => isAllDayActivity(o.activity)),
  ];
}

// ── Calendar: events, who's where, meals ────────────────────────────────────

/** "events": the day's activity rows. */
const eventsPart: DayPart = {
  build(_day, ctx) {
    for (const occ of dayOccurrences(ctx)) {
      const a = occ.activity;
      ctx.cursor = a.id;
      const actx = activityReminderContext(a, ctx.viewer, ctx.input.resolveMember);
      if (!ctx.rules.showsActivity(actx)) continue;
      const assignees = normalizeAssignees(a);
      const row: WidgetRow = {
        id: `${a.id}:${occ.date}`,
        kind: 'event',
        todayOnly: false,
        time: isAllDayActivity(a) ? '' : formatTime12(a.startTime ?? ''),
        ...rowInstants(occ),
        title: a.title,
        who: firstNames(ctx, assignees),
        dot: rowDot(ctx, assignees),
        // The viewer's duty is done when every duty they hold here is ticked for this date.
        isDone:
          actx.dutyRoles.length > 0 &&
          actx.dutyRoles.every((role) =>
            isDutyDone(role === 'dropoff' ? a.dropoffCompletions : a.pickupCompletions, occ.date)
          ),
        handoff: null,
        link: widgetLink(ctx.origin, entityDeepLink('activity', a.id, { date: occ.date })),
      };
      ctx.entries.push({ occ, ctx: actx, row });
    }
  },
  clear(_day, ctx) {
    ctx.entries = [];
  },
};

/** "who's where": drop-off / pick-up handoffs on the rows, and the viewer's pick-ups. */
const whosWherePart: DayPart = {
  build(day, ctx) {
    const { t } = ctx.input;
    const pickups: WidgetDay['pickups'] = [];
    for (const { occ, row } of ctx.entries) {
      const a = occ.activity;
      ctx.cursor = a.id;
      const dropoff = member(ctx, a.dropoffMemberId);
      const pickup = member(ctx, a.pickupMemberId);
      const time = a.endTime ? formatTime12(a.endTime) : '';
      const avatar = (m: FamilyMember) => widgetAvatarFor(getMemberAvatarVariant(m));
      if (dropoff && pickup && dropoff.id === pickup.id) {
        row.handoff = {
          inlineTitle: fillTemplate(t('widget.handoff.drives'), {
            title: a.title,
            name: firstName(dropoff.name),
          }),
          avatars: [],
        };
      } else if (dropoff && pickup) {
        row.handoff = {
          line: fillTemplate(
            t(time ? 'widget.handoff.dropoffPickup' : 'widget.handoff.dropoffPickupNoTime'),
            { dropoff: firstName(dropoff.name), pickup: firstName(pickup.name), time }
          ),
          avatars: [avatar(dropoff), avatar(pickup)],
        };
      } else if (dropoff) {
        row.handoff = {
          line: fillTemplate(t('widget.handoff.dropoffOnly'), { name: firstName(dropoff.name) }),
          avatars: [avatar(dropoff)],
        };
      } else if (pickup) {
        row.handoff = {
          line: fillTemplate(
            t(time ? 'widget.handoff.pickupOnly' : 'widget.handoff.pickupOnlyNoTime'),
            { name: firstName(pickup.name), time }
          ),
          avatars: [avatar(pickup)],
        };
      }
      if (ctx.rules.pickups && pickup?.id === ctx.viewer.id && a.endTime) {
        const at = localDateTime(occ.date, a.endTime);
        if (at) {
          // Name the child being collected, never the activity: this text is shown on the
          // lock screen whatever "Show event titles" says, so it must never carry a title.
          // The child is an assignee other than the driver; the first one that still resolves.
          const child = normalizeAssignees(a)
            .filter((id) => id !== ctx.viewer.id)
            .find((id) => ctx.input.resolveMember(id) !== undefined);
          const who = child ? firstNames(ctx, [child]) : '';
          pickups.push({
            at: at.getTime(),
            text: who
              ? fillTemplate(t('widget.pickup'), { time, name: who })
              : fillTemplate(t('widget.pickupNoName'), { time }),
          });
        }
      }
    }
    day.pickups = pickups.sort((x, y) => x.at - y.at);
  },
  clear(day, ctx) {
    for (const entry of ctx.entries) entry.row.handoff = null;
    day.pickups = [];
  },
};

/** "meals": tonight's dinner (`pickTonight`) and its cook, when the meal planner is on. */
const mealsPart: DayPart = {
  build(day, ctx) {
    const { t, flags } = ctx.input;
    if (!flags.mealPlanner) return;
    const meal = pickTonight(ctx.input.mealsByDate[ctx.ymd] ?? []);
    if (!meal) return;
    ctx.cursor = meal.id;
    const name = mealDisplayName(meal, ctx.input.recipes, t);
    const cook = member(ctx, meal.cookMemberId);
    const text =
      cook?.id === ctx.viewer.id && ctx.rules.addressesViewer
        ? fillTemplate(t('widget.tonightYouCook'), { meal: name })
        : cook
          ? fillTemplate(t('widget.tonight'), { meal: name, name: firstName(cook.name) })
          : fillTemplate(t('widget.tonightNoCook'), { meal: name });
    day.tonight = {
      ...emphasised(text, name),
      link: widgetLink(ctx.origin, { path: WIDGET_PAGE_PATHS.mealPlanner, query: {} }),
    };
  },
  clear(day) {
    day.tonight = null;
  },
};

// ── Calendar: trips and birthdays (the `comingUp` switch) ───────────────────

/**
 * A trip on the day: "Shanghai trip · starts" on its first day, and "Shanghai trip · day 3
 * of 6" while it runs. The running row is `todayOnly`: it pins to the top of today and is
 * never repeated under each later day of the look-ahead. The trip's own activities (the
 * flight on departure day) are ordinary event rows.
 */
function tripRows(ctx: DayContext): WidgetRow[] {
  const { t } = ctx.input;
  const out: { start: string; row: WidgetRow }[] = [];
  for (const v of ctx.input.vacations) {
    ctx.cursor = v.id;
    const assignees = v.assigneeIds ?? [];
    if (
      ctx.rules.tripsForViewerOnly &&
      classifyAudience(assignees, ctx.viewer, ctx.input.resolveMember).kind === 'hidden'
    ) {
      continue;
    }
    const phase = tripPhase(v, ctx.ymd);
    let status: string;
    if (phase === 'today') {
      status = t('widget.tripStarts');
    } else if (phase === 'ongoing') {
      const progress = tripDayProgress(v, ctx.ymd);
      status = progress
        ? fillTemplate(t('widget.tripDay'), {
            n: String(progress.day),
            total: String(progress.total),
          })
        : t('widget.tripOnNow');
    } else {
      continue;
    }
    out.push({
      start: v.startDate ?? '',
      row: {
        id: `trip:${v.id}:${ctx.ymd}`,
        kind: 'trip',
        todayOnly: phase === 'ongoing',
        time: '',
        startsAt: null,
        endsAt: null,
        title: fillTemplate(t('widget.tripRow'), { name: v.name, status }),
        titleEmphasis: status,
        who: firstNames(ctx, assignees),
        dot: rowDot(ctx, assignees),
        isDone: false,
        handoff: null,
        link: widgetLink(ctx.origin, entityDeepLink('vacation', v.id)),
      },
    });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start)).map((o) => o.row);
}

/** Birthdays on the day ("Ava turns 10"). A child sees only their own (mockup 2g). */
function birthdayRows(ctx: DayContext): WidgetRow[] {
  const { t } = ctx.input;
  const members = ctx.rules.birthdaysForViewerOnly
    ? ctx.input.members.filter((m) => m.id === ctx.viewer.id)
    : ctx.input.members;
  return birthdaysInRange(members, ctx.ymd, ctx.ymd).map((b) => {
    ctx.cursor = b.memberId;
    const name = firstName(b.name);
    // The age is named only where the calendar names it (`birthdayLabel`'s rule).
    const age =
      b.age !== undefined && b.age <= MAX_AGE_SHOWN_ON_CALENDAR ? String(b.age) : undefined;
    return {
      id: `birthday:${b.memberId}:${ctx.ymd}`,
      kind: 'birthday',
      todayOnly: false,
      time: '',
      startsAt: null,
      endsAt: null,
      title: age
        ? fillTemplate(t('widget.birthdayTurns'), { name, age })
        : fillTemplate(t('widget.birthdayOf'), { name }),
      who: name,
      dot: rowDot(ctx, [b.memberId]),
      isDone: false,
      handoff: null,
      link: widgetLink(ctx.origin, entityDeepLink('member', b.memberId)),
    };
  });
}

const tripsPart: DayPart = {
  build(_day, ctx) {
    ctx.tripRows = tripRows(ctx);
  },
  clear(_day, ctx) {
    ctx.tripRows = [];
  },
};

const birthdaysPart: DayPart = {
  build(_day, ctx) {
    ctx.birthdayRows = birthdayRows(ctx);
  },
  clear(_day, ctx) {
    ctx.birthdayRows = [];
  },
};

// ── The to-dos section: to-dos, hints and lists, one order ──────────────────

/** A task before it becomes a row: what it is, when it is due, and whose it is. */
interface TaskDraft {
  id: string;
  kind: WidgetTask['kind'];
  title: string;
  /** `YYYY-MM-DD`, or '' when undated. */
  due: string;
  dueTime?: string;
  ownerIds: string[];
  link: string;
}

/** The most to-dos and lists (and, separately, hints) one day carries; `overflow` counts the rest. */
export const MAX_WIDGET_TASKS = 16;

/** The order of the section: overdue, today, undated, later this week. */
const TASK_BUCKET_ORDER: readonly WidgetTaskBucket[] = ['overdue', 'today', 'undated', 'later'];

/** Which bucket `due` falls in on the day, or null when it is past the look-ahead. */
function taskBucket(ctx: DayContext, due: string): WidgetTaskBucket | null {
  if (!due) return 'undated';
  if (due < ctx.ymd) return 'overdue';
  if (due === ctx.ymd) return 'today';
  return due <= ctx.horizon ? 'later' : null;
}

/**
 * "My day": the briefing's to-do rule (`useCriticalItems`): not hidden from the viewer by
 * `classifyAudience`. Hints come through `hintTodos` instead, so they are skipped here.
 */
function myTodoDrafts(ctx: DayContext): TaskDraft[] {
  const out: TaskDraft[] = [];
  for (const todo of ctx.input.todos) {
    ctx.cursor = todo.id;
    if (isHint(todo) || todo.completed || todo.someday) continue;
    const owners = normalizeAssignees(todo);
    if (classifyAudience(owners, ctx.viewer, ctx.input.resolveMember).kind === 'hidden') continue;
    out.push(todoDraft(ctx, todo, owners, 'todo'));
  }
  return out;
}

/**
 * "Our day": the wall's to-do card (`buildWallJobs` + `uniqueTodoJobs`), open jobs only, one
 * row per to-do. Hints come through `hintTodos`, so wall jobs for a hint are skipped.
 */
function ourTodoDrafts(ctx: DayContext): TaskDraft[] {
  const byId = new Map(ctx.input.todos.map((todo) => [todo.id, todo]));
  const { todos } = buildWallJobs({
    todos: ctx.input.todos,
    lists: ctx.input.lists,
    memberIds: ctx.input.members.map((m) => m.id),
    todayYmd: ctx.ymd,
  });
  const out: TaskDraft[] = [];
  for (const job of uniqueTodoJobs(todos.filter((j) => !j.done))) {
    const todo = job.todoId ? byId.get(job.todoId) : undefined;
    if (!todo || isHint(todo)) continue;
    ctx.cursor = todo.id;
    out.push(todoDraft(ctx, todo, jobOwnerIds(job), 'todo'));
  }
  return out;
}

function todoDraft(
  ctx: DayContext,
  todo: TodoItem,
  ownerIds: string[],
  kind: 'todo' | 'hint'
): TaskDraft {
  return {
    id: `todo:${todo.id}`,
    kind,
    title: todo.title,
    due: todo.dueDate?.slice(0, 10) ?? '',
    dueTime: todo.dueTime,
    ownerIds,
    link: widgetLink(ctx.origin, entityDeepLink('todo', todo.id)),
  };
}

/**
 * Hints the viewer may see, minus surprises on "our day"; none for a child. A hint ranks
 * like an undated to-do, or as due today on the day of its event: its `dueDate` is the
 * NUDGE date (in the past for the whole lead window, `utils/helpfulHints.ts`), so ranking
 * by it would read every hint as overdue. The briefing ignores it for the same reason
 * (`useCriticalItems`). An expired hint (event already past) is left out.
 */
function hintDrafts(ctx: DayContext): TaskDraft[] {
  const { rules, input } = ctx;
  if (!input.flags.helpfulHints || rules.hints === 'none') return [];
  const out: TaskDraft[] = [];
  // `input.hintTodos` is soonest event first (sorted once, in `buildWidgetSnapshot`).
  for (const hint of input.hintTodos) {
    ctx.cursor = hint.id;
    if (hint.completed) continue;
    if (rules.hints === 'noSurprise' && isSurpriseHint(hint.hintType)) continue;
    const event = hint.hintEventDate?.slice(0, 10) ?? '';
    if (event && event < ctx.ymd) continue;
    // A hint is about an event; whose it is never needs a dot, and it has no due time.
    out.push({
      ...todoDraft(ctx, hint, [], 'hint'),
      due: event === ctx.ymd ? ctx.ymd : '',
      dueTime: undefined,
    });
  }
  return out;
}

/**
 * Lists with open items that are due: overdue, today, undated (the briefing's `isListDue`
 * rule) or later this week. Recurring and filed lists never are. "My day" uses the
 * single-owner audience the briefing and the OS reminders share; "our day" uses the wall's
 * `isWallSafeList`, so a private list never reaches a shared view.
 */
function listDrafts(ctx: DayContext): TaskDraft[] {
  const { t } = ctx.input;
  const out: TaskDraft[] = [];
  for (const list of ctx.input.lists) {
    ctx.cursor = list.id;
    if (isRecurring(list) || isFiled(list)) continue;
    const visible =
      ctx.rules.lists === 'owner'
        ? ownerItemSurfaces(
            classifyOwnerAudience(list.ownerId, ctx.viewer, ctx.input.resolveMember)
          )
        : isWallSafeList(list);
    if (!visible) continue;
    const remaining = list.items.filter((i) => !i.completed).length;
    if (remaining === 0) continue;
    const state = isListDue(list, ctx.ymd);
    // `isListDue` says null for a future-dated list; `taskBucket` keeps it when it falls
    // inside the look-ahead.
    const due = state === 'noDue' ? '' : (list.dueDate?.slice(0, 10) ?? '');
    out.push({
      id: `list:${list.id}`,
      kind: 'list',
      title: fillTemplate(t('widget.listRemaining'), { list: list.title, n: String(remaining) }),
      due,
      ownerIds: list.ownerId ? [list.ownerId] : [],
      link: widgetLink(ctx.origin, entityDeepLink('list', list.id)),
    });
  }
  return out;
}

/** The dot beside a task: whose it is when that is not the viewer ("our day": anyone's). */
function taskDot(ctx: DayContext, draft: TaskDraft): WidgetDot | null {
  if (draft.kind === 'hint') return null;
  const owners = ctx.rules.dueNamesViewer
    ? draft.ownerIds
    : draft.ownerIds.filter((id) => id !== ctx.viewer.id);
  if (owners.length === 0) return ctx.rules.dueNamesViewer ? { kind: 'family' } : null;
  return rowDot(ctx, owners);
}

function taskRow(ctx: DayContext, draft: TaskDraft, bucket: WidgetTaskBucket): WidgetTask {
  const { t } = ctx.input;
  const timed = !!draft.dueTime;
  let tag = '';
  let tagTone: WidgetTask['tagTone'] = 'accent';
  if (bucket === 'overdue') {
    tag = t('widget.taskOverdue');
  } else if (bucket === 'today') {
    tag = timed
      ? fillTemplate(t('widget.dueBy'), { time: formatTime12(draft.dueTime ?? '') })
      : t('widget.taskToday');
  } else if (bucket === 'later') {
    tag = shortDate(ctx.input, draft.due);
    tagTone = 'soft';
  }
  return {
    id: draft.id,
    kind: draft.kind,
    bucket,
    title: draft.title,
    tag,
    tagTone,
    timed,
    dot: taskDot(ctx, draft),
    link: draft.link,
  };
}

/**
 * The to-dos section for the day, as if the day were today: to-dos, hints and lists ranked
 * together by when they are due (overdue, today, undated, later this week), then by date and
 * time, never by kind. The kind only picks the glyph.
 */
const tasksPart: DayPart = {
  build(day, ctx) {
    const { rules, input } = ctx;
    if (rules.due === 'none' && rules.hints === 'none') return;
    const drafts = [
      ...(rules.due === 'briefing'
        ? myTodoDrafts(ctx)
        : rules.due === 'wall'
          ? ourTodoDrafts(ctx)
          : []),
      ...hintDrafts(ctx),
      ...(rules.due === 'none' ? [] : listDrafts(ctx)),
    ];
    const ranked: { draft: TaskDraft; bucket: WidgetTaskBucket }[] = [];
    for (const draft of drafts) {
      const bucket = taskBucket(ctx, draft.due);
      if (bucket) ranked.push({ draft, bucket });
    }
    // Stable: bucket, then due date, then timed before untimed by time; source order last.
    ranked.sort((a, b) => {
      const byBucket = TASK_BUCKET_ORDER.indexOf(a.bucket) - TASK_BUCKET_ORDER.indexOf(b.bucket);
      if (byBucket !== 0) return byBucket;
      if (a.draft.due !== b.draft.due) return a.draft.due.localeCompare(b.draft.due);
      const at = a.draft.dueTime ?? '';
      const bt = b.draft.dueTime ?? '';
      if (at && bt) return at.localeCompare(bt);
      return Number(!at) - Number(!bt);
    });
    const all = ranked.map(({ draft, bucket }) => {
      ctx.cursor = draft.id;
      return taskRow(ctx, draft, bucket);
    });
    // The count covers what the `due` switch shows (to-dos and lists), never hints, so the
    // date column never counts a row the hint switch hides.
    const count = all.filter(
      (i) =>
        i.kind !== 'hint' &&
        (i.bucket === 'overdue' ||
          i.bucket === 'today' ||
          (i.bucket === 'undated' && rules.countUndated))
    ).length;
    // Capped per switch (no widget draws more, and the list is carried for 14 day-views), so a
    // long to-do list never crowds out the hints, in display order.
    const isHintTask = (i: WidgetTask) => i.kind === 'hint';
    const dueTasks = all.filter((i) => !isHintTask(i));
    const hintTasks = all.filter(isHintTask);
    const kept = new Set([
      ...dueTasks.slice(0, MAX_WIDGET_TASKS),
      ...hintTasks.slice(0, MAX_WIDGET_TASKS),
    ]);
    const items = all.filter((i) => kept.has(i));
    day.tasks = {
      items,
      overflow: {
        due: Math.max(0, dueTasks.length - MAX_WIDGET_TASKS),
        hint: Math.max(0, hintTasks.length - MAX_WIDGET_TASKS),
      },
      heading: input.t(
        items.some((i) => i.kind === 'list') ? 'widget.tasksAndLists' : 'widget.tasks'
      ),
      count,
      countText: taskCountText(ctx, count),
      link: todoPageLink(ctx.origin),
    };
  },
  clear(day, ctx) {
    day.tasks = emptyTasks(ctx);
  },
};

/** One part of a day, in `DAY_PARTS` order; each is isolated by the build loop. */
interface DayPart {
  /** Writes this part of `day` (or of `ctx`, for rows assembled later). May throw. */
  build(day: WidgetDay, ctx: DayContext): void;
  /** Puts this part back to its empty value after a throw. */
  clear(day: WidgetDay, ctx: DayContext): void;
}

/**
 * The parts of a day, in build order (events before who's where, which enriches their
 * rows). The picker switches are applied natively, so every part is always built.
 */
const DAY_PARTS: readonly (readonly [string, DayPart])[] = [
  ['events', eventsPart],
  ['whosWhere', whosWherePart],
  ['meals', mealsPart],
  ['trips', tripsPart],
  ['birthdays', birthdaysPart],
  ['tasks', tasksPart],
];

// ── Days ────────────────────────────────────────────────────────────────────

/** "Thu 16": a later day, as the look-ahead dividers and a later task's tag name it. */
function shortDate(input: WidgetSnapshotInput, ymd: string): string {
  return `${formatUiDate(ymd, input.language, { weekday: 'short' })} ${formatUiDate(ymd, input.language, { day: 'numeric' })}`;
}

/**
 * "**4** for you today" at the foot of the date column. Empty when nothing is due: a "0 due
 * today" line is noise on a home screen, and both renderers hide an empty `WidgetText`.
 */
function taskCountText(ctx: DayContext, count: number): WidgetText {
  return count > 0
    ? emphasised(counted(ctx.input.t, ctx.rules.countKeys, count), String(count))
    : { text: '' };
}

function emptyTasks(ctx: DayContext): WidgetTasks {
  return {
    items: [],
    overflow: { due: 0, hint: 0 },
    heading: ctx.input.t('widget.tasks'),
    count: 0,
    countText: taskCountText(ctx, 0),
    link: todoPageLink(ctx.origin),
  };
}

/** One audience's view of one day: every part, each isolated. */
function buildWidgetDay(
  ymd: string,
  audience: AudienceKey,
  base: Omit<
    DayContext,
    'ymd' | 'horizon' | 'rules' | 'entries' | 'tripRows' | 'birthdayRows' | 'cursor'
  >
): { day: WidgetDay; skipped: number } {
  const ctx: DayContext = {
    ...base,
    ymd,
    horizon: addDaysYmd(ymd, WIDGET_DAYS - 1),
    rules: AUDIENCE_RULES[audience],
    entries: [],
    tripRows: [],
    birthdayRows: [],
    cursor: '',
  };
  const day: WidgetDay = {
    rows: [],
    tonight: null,
    tasks: emptyTasks(ctx),
    thingsText: '',
    pickups: [],
  };
  let skipped = 0;
  for (const [name, part] of DAY_PARTS) {
    ctx.cursor = '';
    try {
      part.build(day, ctx);
    } catch (err) {
      part.clear(day, ctx);
      skipped++;
      console.warn(
        `[buildWidgetSnapshot] dropped '${name}' for ${audience} on ${ymd} at record ${ctx.cursor || '(none)'}:`,
        err
      );
    }
  }
  // The calendar: trips, then birthdays, then the day's events (timed, then untimed).
  day.rows = [...ctx.tripRows, ...ctx.birthdayRows, ...ctx.entries.map((e) => e.row)];
  const { t } = ctx.input;
  day.thingsText =
    day.rows.length === 0
      ? t('widget.thingsOnToday.none')
      : counted(
          t,
          { one: 'widget.thingsOnToday.one', other: 'widget.thingsOnToday.other' },
          day.rows.length
        );
  return { day, skipped };
}

function dayEntry(ymd: string, input: WidgetSnapshotInput): Omit<WidgetDayEntry, 'my' | 'our'> {
  const { language } = input;
  return {
    ymd,
    numeral: formatUiDate(ymd, language, { day: 'numeric' }),
    weekday: formatUiDate(ymd, language, { weekday: 'long' }),
    month: formatUiDate(ymd, language, { month: 'long' }),
    weekdayShort: formatUiDate(ymd, language, { weekday: 'short' }),
    dividerDate: shortDate(input, ymd),
  };
}

/**
 * Build the whole snapshot. `now` stamps `generatedAt` only; "today" is `input.days[0]`
 * (the device-local day), matching every store getter.
 */
export function buildWidgetSnapshot(
  rawInput: WidgetSnapshotInput,
  now: Date
): WidgetSnapshotResult {
  // Hints soonest event first, once for all 14 day-views (the briefing's order).
  const input: WidgetSnapshotInput = {
    ...rawInput,
    hintTodos: [...rawInput.hintTodos].sort((a, b) =>
      (a.hintEventDate ?? '').localeCompare(b.hintEventDate ?? '')
    ),
  };
  const viewer = input.currentMember;
  const isChild = !isAdultMember(viewer);
  const origin = shareableOrigin();
  const base = { input, viewer, origin };
  const { t } = input;
  let skipped = 0;

  const view = (ymd: string, audience: AudienceKey): WidgetDay => {
    const built = buildWidgetDay(ymd, audience, base);
    skipped += built.skipped;
    return built.day;
  };
  const audiences: { my: AudienceKey; our: AudienceKey | null } = {
    my: isChild ? 'child' : 'my',
    our: isChild ? null : 'our',
  };
  const days: WidgetDayEntry[] = input.days.map((ymd) => ({
    ...dayEntry(ymd, input),
    my: view(ymd, audiences.my),
    our: audiences.our ? view(ymd, audiences.our) : null,
  }));

  const viewerFirstName = firstName(viewer.name);
  const snapshot: WidgetSnapshot = {
    version: WIDGET_SNAPSHOT_VERSION,
    generatedAt: now.toISOString(),
    familyIdTail: input.familyId.slice(-6),
    viewer: {
      memberId: viewer.id,
      firstName: viewerFirstName,
      avatar: widgetAvatarFor(getMemberAvatarVariant(viewer)),
      isChild,
    },
    settings: { lockScreenTitles: input.lockScreenTitles },
    labels: {
      asOf: t('widget.asOf'),
      later: t('widget.later'),
      next: t('widget.next'),
      tomorrow: t('widget.tomorrow'),
      more: t('widget.more'),
      nothingToday: t('widget.thingsOnToday.none'),
      myDay: t('widget.myDay'),
      ourDay: t('widget.ourDay'),
      childsDay: fillTemplate(t('widget.childsDay'), { name: viewerFirstName }),
      nothingOnToday: t('widget.nothingOnToday'),
      enjoy: t('widget.enjoy'),
    },
    links: {
      nook: widgetLink(origin, { path: WIDGET_PAGE_PATHS.nook, query: {} }),
      todo: todoPageLink(origin),
    },
    days,
  };
  return { snapshot, skipped };
}
