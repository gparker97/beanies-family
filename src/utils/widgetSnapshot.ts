/**
 * The home-screen widget snapshot builder (#130, ADR-042): pure, Pinia-free, total.
 *
 * Computes the family's day once, in JS, and returns the `WidgetSnapshot` the native widgets
 * paint (contract: `types/widgetSnapshot.ts`). The composable `useWidgetSnapshot` assembles
 * the input from the stores and publishes the result; this file only computes.
 *
 * ⚠️ THIS MODULE MAKES NO AUDIENCE DECISION OF ITS OWN. The family view shows every calendar
 * event and the daily briefing's to-dos and lists (the viewer's own, unassigned ones and their
 * children's, with the briefing's routine gate), and every gate below is a call into
 * `audience.ts` or `reminderSchedule.ts`, so the widget cannot drift from the briefing without
 * those modules changing too. The one deliberate difference: the widget never shows a surprise
 * hint (a home screen is glanceable by the person it is for). The family / child differences
 * live in ONE `AUDIENCE_RULES` value per view, never as `if (audience === ...)` in a block.
 *
 * Shape: `buildWidgetSnapshot` calls `buildWidgetDay` once for each of the `WIDGET_DAYS` days:
 * the family view, or a child's own. A day is two sections (round 9b): the
 * CALENDAR (`rows`: trips, birthdays, events) and the TO-DOS (`tasks`: to-dos, hints and
 * lists in one due order, built as if that day were today). Each day walks `DAY_PARTS` with
 * ONE try/catch: a throw empties that part for that day, counts as `skipped`,
 * and warns with the part and the record it was on (the `buildReminderSchedule` pattern).
 * One malformed record never empties the whole widget. The picker switches are applied
 * natively; every part is always built.
 *
 * v3 (#134) adds the home town's weather (`buildWidgetWeather`, from the same reading and
 * formatters as the web atom, so there is no second formatter), the viewer's handoffs, the
 * to-dos done today, and each row's one-word forms (`shortTitle`, `whoFirst`) for the
 * lock-screen circle.
 *
 * v4 replaces each day's `my` + `our` with one `view` and drops the "my day" / "our day"
 * labels: there is no whose-day choice on the home screen any more. The lock screen still
 * shows only the viewer's own day, so each row carries `mine` (the old "my day" rule,
 * `isViewersOwnActivity`) and each day an `ownThingsText` counting only those rows; the
 * viewer's `pickups` and `handoffs` are their own already.
 */
import type {
  FamilyActivity,
  FamilyList,
  FamilyMember,
  FamilyVacation,
  LanguageCode,
  MealPlanEntry,
  Recipe,
  TemperatureUnit,
  TodoItem,
} from '@/types/models';
import type { WeatherReading } from '@/types/weather';
import {
  WIDGET_DAYS,
  WIDGET_SNAPSHOT_VERSION,
  WIDGET_WEATHER_DAYS,
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
  type WidgetWeather,
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
  classifyListAudience,
  classifyPlateTodo,
  isDutyDone,
  ownerItemSurfaces,
} from '@/utils/audience';
import { plateClock, type PlateClock, type ShownPlate } from '@/utils/todoPlate';
import {
  isFiled,
  isListDue,
  isRecurring,
  listProgress,
  nextListResetOnOrAfter,
} from '@/utils/listLifecycle';
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
import {
  ENTITY_DEEP_LINKS,
  entityDeepLink,
  plannerDayLink,
  type DeepLink,
} from '@/utils/entityDeepLink';
import { shareableOrigin } from '@/utils/shareableOrigin';
import { formatUiDate } from '@/utils/uiLocale';
import { addDaysYmd, extractDatePart, formatTime12 } from '@/utils/date';
import { fillTemplate } from '@/utils/fillTemplate';
import { firstName, formatNameList, normalizeAssignees } from '@/utils/assignees';
import { firstWord } from '@/utils/firstWord';
import { glyphFor } from '@/utils/weather/weatherCodes';
import {
  AGE_SHOW_MS,
  CURRENT_MAX_MS,
  conditionKey,
  formatTemp,
  homeYmdAt,
  outlook,
  todayEntry,
} from '@/utils/weather/weatherReading';
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
  /**
   * The home town's weather (#134): the store's reading plus the family's unit and home zone,
   * or null when Show Weather is off or no town is set (`weatherStore.isActive`). Only
   * time-independent inputs, never the store's `atom`: its age text changes on every 5-minute
   * tick, and every publish reloads every widget (WidgetKit's reload budget).
   */
  weather: WidgetWeatherInput | null;
}

export interface WidgetWeatherInput {
  /** `weatherStore.reading`: null before the first answer (or after a cache miss). */
  reading: WeatherReading | null;
  /** `settingsStore.temperatureUnit`. */
  unit: TemperatureUnit;
  /** The family home time zone (`weatherStore.homeZone`), which names the forecast's days. */
  zone: string;
}

export interface WidgetSnapshotResult {
  snapshot: WidgetSnapshot;
  /** Blocks dropped by a THROWN error across all days: a data bug. */
  skipped: number;
}

// ── Audience rules ──────────────────────────────────────────────────────────

/** The family's view (every adult), or a child session's own. */
type AudienceKey = 'family' | 'child';

/**
 * Everything that differs between the two views of a day, in one place. Each predicate
 * delegates to the app's own classifier; none of them decides anything itself. What both views
 * share is not a rule: the viewer's own pick-ups and handoffs are always listed, "you cook"
 * always addresses the viewer, and lists always follow the briefing's owner audience.
 */
interface AudienceRules {
  /** Which activity occurrences become rows. */
  showsActivity(ctx: ActivityReminderContext): boolean;
  /**
   * Which of those rows are the viewer's own (`WidgetRow.mine`): the lock screen shows only
   * these, the home-screen widget shows every row.
   */
  ownsActivity(ctx: ActivityReminderContext): boolean;
  /**
   * Whether the to-dos section is built: the briefing's to-dos and lists and the viewer's hints
   * (never a surprise). Off for a child, whose widget is their calendar only.
   */
  showsTasks: boolean;
  /** Whether a task's dot may be the viewer's own (and the family's when nobody owns it). */
  dueNamesViewer: boolean;
  /** Whether a trip must concern the viewer (`classifyAudience`) to be counted down (child only). */
  tripsForViewerOnly: boolean;
  /** Whether "coming up" counts down only the viewer's own birthday (the child view). */
  birthdaysForViewerOnly: boolean;
}

/**
 * The viewer's own activity, the Nook briefing's rule (v2/v3's "my day"): a drop-off or pick-up
 * duty on it, or `classifyAudience` says it is the viewer's or their child's. A family-wide
 * event with nobody assigned is not the viewer's own (`ownerItemSurfaces` excludes
 * `unassigned`), nor is another adult's.
 */
const isViewersOwnActivity = (ctx: ActivityReminderContext): boolean =>
  ctx.dutyRoles.length > 0 || ownerItemSurfaces(ctx.audience);

const AUDIENCE_RULES: Readonly<Record<AudienceKey, AudienceRules>> = Object.freeze({
  // The family's day: every event on the calendar, and the briefing's to-dos and lists.
  family: {
    showsActivity: () => true,
    ownsActivity: isViewersOwnActivity,
    showsTasks: true,
    dueNamesViewer: true,
    // Every family trip, whoever is going. The row names who is going.
    tripsForViewerOnly: false,
    birthdaysForViewerOnly: false,
  },
  // A child session: the child's own rows only; no to-dos, no hints.
  child: {
    showsActivity: (ctx) => ctx.audience.kind === 'assignee',
    // Every row a child sees is already their own.
    ownsActivity: () => true,
    showsTasks: false,
    dueNamesViewer: false,
    tripsForViewerOnly: true,
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
  /** The last day of the look-ahead from `ymd` (later hints and lists beyond it are left out). */
  horizon: string;
  /**
   * The to-do plate clock for the day being built: today's real minute on today, the start of
   * the day on every later day (each is built as if it were today, from midnight).
   */
  clock: PlateClock;
  /** When the snapshot is built: today's minute for `clock`. */
  now: Date;
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

/** The first of `ids` that still resolves to a member. */
function firstMember(ctx: DayContext, ids: readonly string[]): FamilyMember | undefined {
  return ids.map((id) => member(ctx, id)).find((m) => m !== undefined);
}

/**
 * A row's one-word forms for the lock-screen circle (v3): the title's first word, and the
 * first assignee's first name ('' when nobody resolves).
 */
function rowWords(
  ctx: DayContext,
  title: string,
  assigneeIds: readonly string[]
): Pick<WidgetRow, 'shortTitle' | 'whoFirst'> {
  const first = firstMember(ctx, assigneeIds);
  return {
    shortTitle: firstWord(title, ctx.input.language),
    whoFirst: first ? firstName(first.name) : '',
  };
}

/** The coloured initial beside a row: the first resolvable assignee, else the family icon. */
function rowDot(ctx: DayContext, assigneeIds: readonly string[]): WidgetDot {
  const owner = firstMember(ctx, assigneeIds);
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
        ...rowWords(ctx, a.title, assignees),
        dot: rowDot(ctx, assignees),
        mine: ctx.rules.ownsActivity(actx),
        // The viewer's duty is done when every duty they hold here is ticked for this date.
        isDone:
          actx.dutyRoles.length > 0 &&
          actx.dutyRoles.every((role) =>
            isDutyDone(role === 'dropoff' ? a.dropoffCompletions : a.pickupCompletions, occ.date)
          ),
        handoff: null,
        link: widgetLink(ctx.origin, plannerDayLink(occ.date)),
      };
      ctx.entries.push({ occ, ctx: actx, row });
    }
  },
  clear(_day, ctx) {
    ctx.entries = [];
  },
};

/**
 * The first name of the person a duty is for: an assignee other than the viewer (the child
 * being dropped off or collected), the first one that still resolves; '' when none. Never the
 * activity: the pick-up line and the handoffs show on the lock screen whatever "Show event
 * titles" says, so they must never carry a title.
 */
function dutyName(ctx: DayContext, a: FamilyActivity): string {
  const other = firstMember(
    ctx,
    normalizeAssignees(a).filter((id) => id !== ctx.viewer.id)
  );
  return other ? firstName(other.name) : '';
}

/**
 * "who's where": drop-off / pick-up handoffs on the rows, the viewer's pick-ups, and (v3) the
 * viewer's own timed drop-offs and pick-ups (`handoffs`), all from the same handoff data.
 */
const whosWherePart: DayPart = {
  build(day, ctx) {
    const { t } = ctx.input;
    const pickups: WidgetDay['pickups'] = [];
    const handoffs: NonNullable<WidgetDay['handoffs']> = [];
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
      // A drop-off is at the start (null for an all-day row); a pick-up at the end time.
      if (dropoff?.id === ctx.viewer.id && row.startsAt !== null) {
        handoffs.push({
          at: row.startsAt,
          kind: 'dropoff',
          name: dutyName(ctx, a),
          link: row.link,
        });
      }
      const pickupAt = a.endTime ? localDateTime(occ.date, a.endTime) : null;
      if (pickup?.id === ctx.viewer.id && pickupAt) {
        const who = dutyName(ctx, a);
        pickups.push({
          at: pickupAt.getTime(),
          text: who
            ? fillTemplate(t('widget.pickup'), { time, name: who })
            : fillTemplate(t('widget.pickupNoName'), { time }),
        });
        handoffs.push({ at: pickupAt.getTime(), kind: 'pickup', name: who, link: row.link });
      }
    }
    day.pickups = pickups.sort((x, y) => x.at - y.at);
    day.handoffs = handoffs.sort((x, y) => x.at - y.at);
  },
  clear(day, ctx) {
    for (const entry of ctx.entries) entry.row.handoff = null;
    day.pickups = [];
    day.handoffs = [];
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
      cook?.id === ctx.viewer.id
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
    const title = fillTemplate(t('widget.tripRow'), { name: v.name, status });
    out.push({
      start: v.startDate ?? '',
      row: {
        id: `trip:${v.id}:${ctx.ymd}`,
        kind: 'trip',
        todayOnly: phase === 'ongoing',
        time: '',
        startsAt: null,
        endsAt: null,
        title,
        titleEmphasis: status,
        who: firstNames(ctx, assignees),
        ...rowWords(ctx, title, assignees),
        dot: rowDot(ctx, assignees),
        // Every family trip is the viewer's own, whoever is going (as on v2/v3's "my day"): a
        // partner away is part of the parent at home's day. A child sees only their own.
        mine: true,
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
    const title = age
      ? fillTemplate(t('widget.birthdayTurns'), { name, age })
      : fillTemplate(t('widget.birthdayOf'), { name });
    return {
      id: `birthday:${b.memberId}:${ctx.ymd}`,
      kind: 'birthday',
      todayOnly: false,
      time: '',
      startsAt: null,
      endsAt: null,
      title,
      who: name,
      ...rowWords(ctx, title, [b.memberId]),
      dot: rowDot(ctx, [b.memberId]),
      // Every birthday is the viewer's own (as on v2/v3's "my day"); a child sees only theirs.
      mine: true,
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
  /**
   * A to-do completed on the day (v3): never a row, only counted in `doneToday`. Open drafts
   * (every hint and list) are false.
   */
  done: boolean;
  /**
   * A to-do's bucket, precomputed from its plate (`utils/todoPlate`): to-dos follow the show
   * rule and have no look-ahead. Absent on hints and lists, which use `taskBucket`.
   */
  bucket?: WidgetTaskBucket;
}

/** The most to-dos and lists (and, separately, hints) one day carries; `overflow` counts the rest. */
export const MAX_WIDGET_TASKS = 16;

/** The order of the section: overdue, today, undated, later this week. */
const TASK_BUCKET_ORDER: readonly WidgetTaskBucket[] = ['overdue', 'today', 'undated', 'later'];

/** A shown to-do plate as the widget's bucket. */
const PLATE_TO_TASK_BUCKET = {
  overdue: 'overdue',
  today: 'today',
  undated: 'undated',
  upcoming: 'later',
} as const satisfies Record<ShownPlate, WidgetTaskBucket>;

/** Which bucket a hint's or list's `due` falls in on the day, or null past the look-ahead. */
function taskBucket(ctx: DayContext, due: string): WidgetTaskBucket | null {
  if (!due) return 'undated';
  if (due < ctx.ymd) return 'overdue';
  if (due === ctx.ymd) return 'today';
  return due <= ctx.horizon ? 'later' : null;
}

/**
 * A completed to-do's completion falls on `ymd` (local date). `extractDatePart`, never a
 * slice: `completedAt` is a UTC timestamp (the wall's `todoBucket` rule).
 */
function completedOn(todo: TodoItem, ymd: string): boolean {
  return todo.completed && extractDatePart(todo.completedAt ?? '') === ymd;
}

/**
 * The briefing's to-do rule (`classifyPlateTodo`, shared with `useCriticalItems`): showing on
 * the day (not `waiting`) and not hidden from the viewer, so a partner's to-do never shows and a
 * child's routine shows only when missed or kept posted. Every day after today is `projected`,
 * so a child's routine due today never reads as missed (and shown to a parent) on the days
 * after it. Hints come through `hintTodos` instead, so they are skipped here. Open to-dos, plus
 * (marked `done`) those completed on the day, for `doneToday`.
 */
function todoDrafts(ctx: DayContext): TaskDraft[] {
  const out: TaskDraft[] = [];
  const projected = ctx.ymd !== ctx.input.today;
  for (const todo of ctx.input.todos) {
    ctx.cursor = todo.id;
    if (isHint(todo) || todo.someday) continue;
    if (todo.completed && !completedOn(todo, ctx.ymd)) continue;
    const classified = classifyPlateTodo(
      todo,
      ctx.viewer,
      ctx.input.resolveMember,
      ctx.clock,
      projected
    );
    if (!classified) continue;
    out.push({
      ...todoDraft(ctx, todo, normalizeAssignees(todo), 'todo'),
      bucket: PLATE_TO_TASK_BUCKET[classified.plate],
    });
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
    done: completedOn(todo, ctx.ymd),
  };
}

/**
 * Hints the viewer may see, never a surprise (the one difference from the briefing: a home
 * screen is glanceable by the person the surprise is for); none for a child. A hint ranks
 * like an undated to-do, or as due today on the day of its event: its `dueDate` is the
 * NUDGE date (in the past for the whole lead window, `utils/helpfulHints.ts`), so ranking
 * by it would read every hint as overdue. The briefing ignores it for the same reason
 * (`useCriticalItems`). An expired hint (event already past) is left out.
 */
function hintDrafts(ctx: DayContext): TaskDraft[] {
  const { rules, input } = ctx;
  if (!input.flags.helpfulHints || !rules.showsTasks) return [];
  const out: TaskDraft[] = [];
  // `input.hintTodos` is soonest event first (sorted once, in `buildWidgetSnapshot`).
  for (const hint of input.hintTodos) {
    ctx.cursor = hint.id;
    if (hint.completed || isSurpriseHint(hint.hintType)) continue;
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
 * When a list is on the plate for the day being built, and how many items that is. A one-off
 * passes its own due date through (`taskBucket` sorts overdue/today/later/undated from it; an
 * undated list is `''`). A repeating list is due on the day its round began (`isListDue`); on
 * any other day the engine's first scheduled reset on/after the day, which will untick every
 * item, so all of them count. The on-or-after date is never before the day, so a repeating
 * list never reaches `overdue`; `null` when it has no schedule or no baseline (silent, as today).
 */
function listDraftDue(
  ctx: DayContext,
  list: FamilyList
): { due: string; remaining: number } | null {
  if (!isRecurring(list)) {
    return { due: list.dueDate?.slice(0, 10) ?? '', remaining: listProgress(list).open };
  }
  if (isListDue(list, ctx.ymd) === 'today') {
    return { due: ctx.ymd, remaining: listProgress(list).open };
  }
  const next = nextListResetOnOrAfter(list, ctx.ymd);
  return next ? { due: next, remaining: list.items.length } : null;
}

/**
 * Lists with open items that are due: overdue, today, undated (the briefing's `isListDue`
 * rule) or later this week. A repeating list is due on the day it resets (and `later` ahead
 * of its next scheduled reset); filed lists never are. Who sees a list is the single-owner
 * audience the briefing and the OS reminders share: the viewer's own and their children's
 * (private categories included, as on the briefing), never another adult's, and a child's
 * recurring list only when it keeps parents posted. `missed` is false: a recurring list never
 * reads as overdue (`isListDue`), and the routine gate only applies to recurring lists, so the
 * briefing's `due === 'overdue'` would be false for every list it gates.
 */
function listDrafts(ctx: DayContext): TaskDraft[] {
  const { t } = ctx.input;
  const out: TaskDraft[] = [];
  for (const list of ctx.input.lists) {
    ctx.cursor = list.id;
    if (isFiled(list)) continue;
    const audience = classifyListAudience(list, ctx.viewer, ctx.input.resolveMember, false);
    if (!ownerItemSurfaces(audience)) continue;
    const plate = listDraftDue(ctx, list);
    if (!plate || plate.remaining === 0) continue;
    out.push({
      id: `list:${list.id}`,
      kind: 'list',
      title: fillTemplate(t('widget.listRemaining'), {
        list: list.title,
        n: String(plate.remaining),
      }),
      due: plate.due,
      ownerIds: list.ownerId ? [list.ownerId] : [],
      link: widgetLink(ctx.origin, entityDeepLink('list', list.id)),
      done: false,
    });
  }
  return out;
}

/** The dot beside a task: whose it is (the family's when nobody owns it); never on a hint. */
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
    // A to-do has no look-ahead, so one due beyond it names its month too ("Dec 18").
    tag =
      draft.due > ctx.horizon
        ? formatUiDate(draft.due, ctx.input.language, { month: 'short', day: 'numeric' })
        : shortDate(ctx.input, draft.due);
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
    if (!rules.showsTasks) return;
    const drafts = [...todoDrafts(ctx), ...hintDrafts(ctx), ...listDrafts(ctx)];
    const ranked: { draft: TaskDraft; bucket: WidgetTaskBucket }[] = [];
    let doneToday = 0;
    for (const draft of drafts) {
      const bucket = draft.bucket ?? taskBucket(ctx, draft.due);
      if (!bucket) continue;
      // A to-do done on the day is never a row; it counts when it would have counted open.
      if (draft.done) doneToday += Number(countsNow(draft.kind, bucket));
      else ranked.push({ draft, bucket });
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
    const count = all.filter((i) => countsNow(i.kind, i.bucket)).length;
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
      doneToday,
      link: todoPageLink(ctx.origin),
    };
  },
  clear(day, ctx) {
    day.tasks = emptyTasks(ctx);
  },
};

/**
 * Whether a task counts toward the date column's "N due today" count: to-dos and lists (never
 * hints) that are overdue or due today. The same rule picks which completed to-dos count in
 * `doneToday`, so the circle's ring and the count agree.
 */
function countsNow(kind: WidgetTask['kind'], bucket: WidgetTaskBucket): boolean {
  return kind !== 'hint' && (bucket === 'overdue' || bucket === 'today');
}

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
 * "**4** due today" at the foot of the date column. Empty when nothing is due: a "0 due
 * today" line is noise on a home screen, and both renderers hide an empty `WidgetText`.
 */
function taskCountText(ctx: DayContext, count: number): WidgetText {
  return count > 0
    ? emphasised(
        counted(ctx.input.t, { one: 'widget.dueToday.one', other: 'widget.dueToday.other' }, count),
        String(count)
      )
    : { text: '' };
}

function emptyTasks(ctx: DayContext): WidgetTasks {
  return {
    items: [],
    overflow: { due: 0, hint: 0 },
    heading: ctx.input.t('widget.tasks'),
    count: 0,
    countText: taskCountText(ctx, 0),
    doneToday: 0,
    link: todoPageLink(ctx.origin),
  };
}

/**
 * The plate clock for building `ymd`: the real minute when `ymd` is the device-local day of
 * `now` (today; the calendar days are device-local too, `input.days`), else the start of the
 * day, since every later day is built as if it had just begun.
 */
function dayClock(ymd: string, now: Date): PlateClock {
  const live = plateClock(now);
  return { ymd, hhmm: live.ymd === ymd ? live.hhmm : '00:00' };
}

/** One view of one day (the family's, or a child's): every part, each isolated. */
function buildWidgetDay(
  ymd: string,
  audience: AudienceKey,
  base: Omit<
    DayContext,
    'ymd' | 'horizon' | 'clock' | 'rules' | 'entries' | 'tripRows' | 'birthdayRows' | 'cursor'
  >
): { day: WidgetDay; skipped: number } {
  const ctx: DayContext = {
    ...base,
    ymd,
    horizon: addDaysYmd(ymd, WIDGET_DAYS - 1),
    clock: dayClock(ymd, base.now),
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
    ownThingsText: '',
    pickups: [],
    handoffs: [],
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
  day.thingsText = thingsText(ctx, day.rows.length);
  day.ownThingsText = thingsText(ctx, day.rows.filter((r) => r.mine).length);
  return { day, skipped };
}

/** "6 things on today" / "nothing on today", the small widget's and the lock screen's line. */
function thingsText(ctx: DayContext, n: number): string {
  const { t } = ctx.input;
  return n === 0
    ? t('widget.thingsOnToday.none')
    : counted(t, { one: 'widget.thingsOnToday.one', other: 'widget.thingsOnToday.other' }, n);
}

function dayEntry(ymd: string, input: WidgetSnapshotInput): Omit<WidgetDayEntry, 'view'> {
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

// ── Weather (v3, #134) ──────────────────────────────────────────────────────

/**
 * The home town's weather for the native widgets, from the same reading, glyph mapping and
 * `formatTemp` as the web atom (`buildWeatherAtom`), so there is no second formatter. null
 * when weather is off or has no town (`input.weather` null), when there is no reading yet, or
 * when the reading has no entry for the home-zone today (the web's `unavailable`). `days` are
 * the home-zone today and the days after it, by `ymd`, never by position. The staleness
 * thresholds travel as instants (`ageFrom`, `currentUntil`), so native holds no copy.
 */
export function buildWidgetWeather(
  input: Pick<WidgetSnapshotInput, 'weather' | 't'>,
  now: Date
): WidgetWeather | null {
  const reading = input.weather?.reading;
  if (!input.weather || !reading) return null;
  const { unit, zone } = input.weather;
  const todayYmd = homeYmdAt(now.getTime(), zone);
  const today = todayEntry(reading.daily, todayYmd);
  if (!today) return null;
  const glyph = glyphFor(reading.current.code, reading.current.isDay).glyph;
  return {
    zone,
    fetchedAt: reading.fetchedAt,
    ageFrom: reading.fetchedAt + AGE_SHOW_MS,
    currentUntil: reading.fetchedAt + CURRENT_MAX_MS,
    current: {
      glyph,
      temp: formatTemp(reading.current.tempC, unit),
      condition: input.t(conditionKey(glyph)),
    },
    days: [today, ...outlook(reading.daily, todayYmd, WIDGET_WEATHER_DAYS - 1)].map((d) => {
      const high = formatTemp(d.maxC, unit);
      const low = formatTemp(d.minC, unit);
      return {
        ymd: d.ymd,
        glyph: glyphFor(d.code, true).glyph,
        high,
        low,
        range: fillTemplate(input.t('widget.weatherRange'), { high, low }),
      };
    }),
  };
}

/**
 * Build the whole snapshot. `now` stamps `generatedAt` and picks the weather's home-zone
 * today; "today" for the calendar is `input.days[0]` (the device-local day), matching every
 * store getter.
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
  const base = { input, viewer, origin, now };
  const { t } = input;
  let skipped = 0;

  const audience: AudienceKey = isChild ? 'child' : 'family';
  const days: WidgetDayEntry[] = input.days.map((ymd) => {
    const built = buildWidgetDay(ymd, audience, base);
    skipped += built.skipped;
    return { ...dayEntry(ymd, input), view: built.day };
  });

  // Isolated like a day part: a malformed reading drops the weather, never the widget.
  let weather: WidgetWeather | null = null;
  try {
    weather = buildWidgetWeather(input, now);
  } catch (err) {
    skipped++;
    console.warn('[buildWidgetSnapshot] dropped weather (malformed reading):', err);
  }

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
      childsDay: fillTemplate(t('widget.childsDay'), { name: viewerFirstName }),
      nothingOnToday: t('widget.nothingOnToday'),
      enjoy: t('widget.enjoy'),
      weatherAsOf: t('widget.weatherAsOf'),
      circleLeft: t('widget.circleLeft'),
      circleAllDone: t('widget.circleAllDone'),
      circleAllClear: t('widget.circleAllClear'),
      circleToDo: t('widget.circleToDo'),
    },
    links: {
      nook: widgetLink(origin, plannerDayLink()),
      todo: todoPageLink(origin),
    },
    days,
    weather,
  };
  return { snapshot, skipped };
}
