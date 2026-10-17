/**
 * The home-screen widget snapshot (#130, ADR-042).
 *
 * The app computes the family's day once, in JS, with the same rules the Nook briefing
 * and the beanie wall use, and hands this JSON to the native widget through the
 * `WidgetBridge` plugin. The widgets on iOS (WidgetKit, `ios/App/BeaniesWidgets/`) and
 * Android (RemoteViews, `android/.../widget/`) only PAINT it: they make no audience
 * decision, translate nothing they can read from here, and never compute a colour.
 *
 * ⚠️ THIS FILE IS A CROSS-PLATFORM CONTRACT. The Swift `Codable` mirror
 * (`WidgetSnapshotStore.swift`) and the Java reader (`WidgetSnapshot.java`) parse the
 * same shape. `src/utils/__tests__/fixtures/widget-snapshot.v3.json` is the committed
 * example the builder test asserts against, so a change here shows up as a diff there
 * (`widget-snapshot.v2.json` is kept as the older shape the readers must still accept).
 * Adding an OPTIONAL field is safe (both readers ignore unknown keys). Renaming, removing
 * or retyping a field needs `WIDGET_SNAPSHOT_VERSION` bumped and both readers updated in
 * the same change; a reader that meets a version it does not know shows "open beanies to
 * refresh" rather than guessing.
 *
 * Privacy: plain data on the device, wiped at sign-out (sign-out step
 * `clearWidgetSnapshot`). It never carries finance data, private lists, surprise hints,
 * or an item `classifyAudience` hides from the viewer.
 */
import type { WeatherGlyph } from './weather';

/**
 * The version the app WRITES. Readers ACCEPT 2 and 3 (`WIDGET_SNAPSHOT_READABLE_VERSIONS`):
 * v3 (#134, 2026-10) is v2 plus optional fields only (`weather`, the `labels.weather*` /
 * `labels.circle*` strings, `WidgetDay.handoffs`, `WidgetTasks.doneToday`,
 * `WidgetRow.shortTitle` / `whoFirst`), so a v3 reader paints a v2 file with those absent,
 * and the bump exists so an OLD (v2-only) reader shows "open beanies to refresh" instead of
 * a widget missing its weather. Swift `supportedVersions = 2...3`, Java `MIN_VERSION = 2`,
 * `MAX_VERSION = 3`.
 */
export const WIDGET_SNAPSHOT_VERSION = 3 as const;

/** Every version the native readers accept, oldest first; the last is the one written. */
export const WIDGET_SNAPSHOT_READABLE_VERSIONS = [2, WIDGET_SNAPSHOT_VERSION] as const;

/**
 * Every placement size a widget can report or be opened from. The native side appends
 * `&w=<size>` to every link it opens; `inboundLinkBridge` logs the size only when it is
 * one of these (the query value is untrusted: any app can deliver an Intent).
 */
export const WIDGET_SIZES = [
  'ios-small',
  'ios-medium',
  'ios-large',
  'ios-accessory',
  'android-2x2',
  'android-4x2',
  'android-4x3',
] as const;
export type WidgetSize = (typeof WIDGET_SIZES)[number];

export function isWidgetSize(value: string | null | undefined): value is WidgetSize {
  return !!value && (WIDGET_SIZES as readonly string[]).includes(value);
}

/**
 * The lock-screen circle's "Show" options (#134), in picker order. Mirrored by the Swift
 * `CircleShowOption` (`AccessoryConfigIntent.swift`); the native side relays how many circles
 * are placed per option in the publish result's `placements.circle`.
 */
export const CIRCLE_SHOW_OPTIONS = ['nextUp', 'nextHandoff', 'todosLeft', 'thingsLeft'] as const;
export type CircleShowOption = (typeof CIRCLE_SHOW_OPTIONS)[number];

/**
 * The six picker switches. Each one shows or hides a KIND of row; it never decides where a
 * row goes (round 9b): the calendar section always comes first and the to-dos section sits
 * in a fixed place underneath. Mirrored as constants in Swift (`WidgetFill.swift`) and Java
 * (`WidgetFill.java`), and the names are the per-widget preference keys, so keep the three
 * in this order and never rename one.
 *
 * - `events`: activity rows (calendar)
 * - `whosWhere`: the drop-off / pick-up handoff on those rows
 * - `meals`: tonight's dinner in the footer
 * - `due`: to-dos and lists (the to-dos section)
 * - `comingUp`: trips and birthdays (calendar)
 * - `hint`: helpful hints (the to-dos section, ranked exactly like a to-do)
 */
export const WIDGET_FILL_ORDER = [
  'events',
  'whosWhere',
  'meals',
  'due',
  'comingUp',
  'hint',
] as const;
export type WidgetBlockKind = (typeof WIDGET_FILL_ORDER)[number];

/**
 * The picker default for a new widget: everything on. Round 9 made every block fill only
 * room that would otherwise be empty, so nothing competes for space by being switched on.
 */
export const WIDGET_DEFAULT_BLOCKS: Readonly<Record<WidgetBlockKind, boolean>> = Object.freeze({
  events: true,
  whosWhere: true,
  meals: true,
  due: true,
  comingUp: true,
  hint: true,
});

/** How many days the snapshot carries: today and the six after it (the look-ahead). */
export const WIDGET_DAYS = 7;

/** Whose day a widget shows. A child session only ever publishes `my`. */
export type WidgetAudience = 'my' | 'our';

/**
 * The beanie art a native widget paints for a person. Each maps to one bundled image
 * (iOS asset catalog / Android drawable) with the same name.
 */
export type WidgetAvatar = 'father' | 'mother' | 'neutral' | 'boy' | 'girl' | 'dog';

/**
 * Pre-rendered text with an optional emphasised substring ("tonight: **tacos**, Sam cooks").
 * Native bolds the FIRST occurrence of `emphasis` in `text`; absent or not found = plain.
 * Kept as a substring rather than split segments so word order stays the translator's.
 */
export interface WidgetText {
  text: string;
  emphasis?: string;
}

/** The coloured initial beside a row, or the family hug icon for a family-wide event. */
export type WidgetDot =
  | {
      kind: 'member';
      /** One or two letters (`familyStore.initialsById`). */
      initial: string;
      /** `#RRGGBB`, already through `resolveMemberColor`. */
      color: string;
      /** `#RRGGBB` for the initial on that fill (`inkOnMemberColor`); native never computes it. */
      ink: string;
    }
  | { kind: 'family' };

/**
 * Who drops off and who picks up. Two shapes, chosen by the builder:
 * - the same person does both → `inlineTitle` ("piano, Jo drives"), no sub-line;
 * - different people → `line` ("Sam drops off, Jo picks up 12:30") with up to two avatars
 *   (drop-off first).
 * Shown only when the widget's "who's where" block is on; off → plain `title`, no line.
 */
export interface WidgetHandoff {
  inlineTitle?: string;
  line?: string;
  avatars: WidgetAvatar[];
}

/**
 * What a calendar row is. `event` is an activity (the `events` switch); `trip` and
 * `birthday` belong to the `comingUp` switch. Native draws a trip's and a birthday's glyph
 * in the time column, where an event puts its time.
 */
export type WidgetRowKind = 'event' | 'trip' | 'birthday';

/** One calendar row. */
export interface WidgetRow {
  /** Stable within a snapshot (`<activityId>:<ymd>`); used for list identity only. */
  id: string;
  kind: WidgetRowKind;
  /**
   * Shown only when this day is the one the widget treats as TODAY, never under a look-ahead
   * divider: a trip in progress ("Shanghai trip · day 3 of 6") pins to the top of today, and
   * repeating it under every later day of the trip would be noise.
   */
  todayOnly: boolean;
  /** Display time ("10:15am"), '' for an untimed / all-day row. */
  time: string;
  /** Epoch ms of the start, null when untimed. */
  startsAt: number | null;
  /**
   * Epoch ms of the end (or the start when there is no end), null when untimed. There is
   * deliberately no `isPast`: each renderer judges "past" as `endsAt < now` on the device
   * clock, so a row greys out without a republish.
   */
  endsAt: number | null;
  title: string;
  /** A substring of `title` to bold ("day 3 of 6"); absent or not found = plain. */
  titleEmphasis?: string;
  /**
   * First names only ("Max", "Max, Ava"), for the lock screen when
   * `settings.lockScreenTitles` is off. '' when nobody is assigned.
   */
  who: string;
  /**
   * v3: the title's first word (`utils/firstWord.ts`: "swimming" from "swimming lesson"),
   * the lock-screen circle's word when `settings.lockScreenTitles` is on. '' for a blank
   * title. Absent in a v2 snapshot.
   */
  shortTitle?: string;
  /**
   * v3: the first assignee's first name ("Max"), the circle's word when titles are off.
   * '' when nobody is assigned. Absent in a v2 snapshot.
   */
  whoFirst?: string;
  dot: WidgetDot | null;
  /**
   * The viewer's drop-off/pick-up duty on this row is ticked. In a child view the renderers
   * draw the green tick when `isDone` OR the row is past (`endsAt < now`): a child's day is
   * a list of things to get through, so finished reads as done.
   */
  isDone: boolean;
  handoff: WidgetHandoff | null;
  /** Absolute https link, already carrying `src=widget`; native appends `&w=<size>`. */
  link: string;
}

/**
 * What a row in the to-dos section is: a to-do (`due` switch), a helpful hint or reminder
 * (`hint` switch), or a list with open items (`due` switch). All three share ONE order.
 */
export type WidgetTaskKind = 'todo' | 'hint' | 'list';

/**
 * When a task is due, relative to the day it was built for. The section is ordered by this,
 * then by date and time, whatever the kind: overdue, today, undated, later this week.
 */
export type WidgetTaskBucket = 'overdue' | 'today' | 'undated' | 'later';

/** One row of the to-dos section. */
export interface WidgetTask {
  /** Stable within a snapshot (`todo:<id>`, `list:<id>`). */
  id: string;
  kind: WidgetTaskKind;
  bucket: WidgetTaskBucket;
  /** "call the dentist", "groceries, 6 left". */
  title: string;
  /**
   * The right-hand word: "overdue", "by 5pm", "today" (accent tone), "Thu 16" (soft tone),
   * or '' for an undated task. Never colour alone: the word carries the meaning.
   */
  tag: string;
  tagTone: 'accent' | 'soft';
  /** The to-do has a due time: native fills the ring. */
  timed: boolean;
  /** Whose it is, when that is someone other than the viewer (or the family on "our day"). */
  dot: WidgetDot | null;
  link: string;
}

/** The to-dos section of one day. */
export interface WidgetTasks {
  /**
   * Already in display order. Capped per switch: at most `MAX_WIDGET_TASKS` (16,
   * `utils/widgetSnapshot.ts`) to-dos and lists, and as many hints, so a long to-do list can
   * never crowd out the hints a widget with only the hint switch on would show.
   */
  items: WidgetTask[];
  /**
   * How many the cap left out, per switch (`due`: to-dos and lists, `hint`: hints). Native's
   * "{n} more" adds the overflow of the switches that are on to the shown items that did not fit.
   */
  overflow: { due: number; hint: number };
  /** "to-dos" or "to-dos and lists" (when any list is among `items`). */
  heading: string;
  /**
   * How many to-dos and lists are due now (overdue or today, plus undated on "my day"): the
   * count at the foot of the date column, shown with the `due` switch. Later-this-week tasks
   * and hints are listed but never counted.
   */
  count: number;
  /** "**4** for you today" / "**4** due today"; `text` is '' when `count` is 0. */
  countText: WidgetText;
  /**
   * v3: to-dos completed on this day (`completedAt`'s local date) among those that would
   * count in `count` were they open. The circle's "To-dos left" ring is
   * `doneToday / (doneToday + count)`. Absent in a v2 snapshot.
   */
  doneToday?: number;
  /** The to-do page, for the count and the section heading. */
  link: string;
}

/** A pick-up the viewer is doing, for the lock-screen inline slot. */
export interface WidgetPickup {
  /** Epoch ms of the pick-up. */
  at: number;
  /** "pick-up 12:30pm, Max" (the child being picked up). */
  text: string;
}

/** v3: one of the viewer's own drop-offs or pick-ups, for the circle's "Next handoff". */
export interface WidgetDayHandoff {
  /** Epoch ms: the activity's start for a drop-off, its end for a pick-up. */
  at: number;
  kind: 'dropoff' | 'pickup';
  /**
   * The first name of the person being dropped off or collected (an assignee other than the
   * viewer), never the activity: it shows whatever `lockScreenTitles` says. '' when nobody
   * else is assigned.
   */
  name: string;
  /** The activity's link (as on its row). */
  link: string;
}

/** One audience's view of one day. */
export interface WidgetDay {
  /**
   * The calendar section: trips, then birthdays, then timed events by start, then untimed
   * events. Nothing that is not on the calendar is ever here.
   */
  rows: WidgetRow[];
  /** "tonight: **tacos**, Sam cooks"; the "meals" block. null when nothing is planned or the flag is off. */
  tonight: (WidgetText & { link: string }) | null;
  /**
   * The to-dos section, built as if this day were today, so a widget that rolls past
   * midnight without the app still ranks overdue and later correctly. Empty for a child.
   */
  tasks: WidgetTasks;
  /** "6 things on today" / "nothing on today", the small widget's handwritten line. */
  thingsText: string;
  /** Pick-ups the viewer does on this day, ascending (my day only; empty on our day). */
  pickups: WidgetPickup[];
  /**
   * v3: the viewer's own timed drop-offs and pick-ups on this day, ascending by `at` (my day
   * only; empty on our day). Absent in a v2 snapshot. `pickups` stays for the inline slot.
   */
  handoffs?: WidgetDayHandoff[];
}

export interface WidgetDayEntry {
  /** Local calendar date, "2026-10-11". */
  ymd: string;
  /** "11", localized. */
  numeral: string;
  /** "Saturday", localized. */
  weekday: string;
  /** "October", localized. */
  month: string;
  /** "Sat" for the small widget header, localized. */
  weekdayShort: string;
  /**
   * "Sun 12": this day's divider in the look-ahead. Native adds `labels.tomorrow` beside it
   * when the day is tomorrow relative to the device clock, so a widget that has rolled past
   * midnight never calls the wrong day tomorrow.
   */
  dividerDate: string;
  my: WidgetDay | null;
  /** null for a child session. */
  our: WidgetDay | null;
}

/**
 * Strings the native side composes at render time (everything item-level is already
 * rendered above). Strings shown when there is NO readable snapshot ("open beanies",
 * "sign in to see your day", "open beanies to refresh") and the picker labels cannot come
 * from here; they live in the native string tables (en + zh-Hans).
 */
export interface WidgetLabels {
  /** "as of {time}": native fills {time} from `generatedAt` in the device's format. */
  asOf: string;
  /** "later ›" */
  later: string;
  /** "next" (small widget). */
  next: string;
  /** "tomorrow", beside the next day's divider. */
  tomorrow: string;
  /** "{n} more": the to-dos section heading when not every task fits. */
  more: string;
  /** "nothing on today": the calendar's first line when today has no rows. */
  nothingToday: string;
  /** "my day" / "our day" for the foot of the date column. */
  myDay: string;
  ourDay: string;
  /** "Ava's day" (child view header), already filled. */
  childsDay: string;
  /**
   * "nothing on today," and "enjoy": the relaxed state when the whole week is clear, and,
   * joined, the calendar's first line when today is empty and there are no tasks.
   */
  nothingOnToday: string;
  enjoy: string;
  /**
   * v3: "as of {time}" beside a weather reading old enough to show its age; native fills
   * {time} from `weather.fetchedAt` in the device's format. Absent in a v2 snapshot.
   */
  weatherAsOf?: string;
  /** v3, the lock-screen circle: "left" ("3 left", Things left). */
  circleLeft?: string;
  /** v3, the circle: "all done" (Things left, nothing still to come today). */
  circleAllDone?: string;
  /** v3, the circle: "all clear" (Next up, nothing on the rest of the week). */
  circleAllClear?: string;
  /** v3, the circle: "to do" ("4 to do", To-dos left). */
  circleToDo?: string;
}

/** How many home-zone days `WidgetWeather.days` carries: today and the four after it. */
export const WIDGET_WEATHER_DAYS = 5;

/** v3: one home-zone day of the forecast, already formatted in the family's unit. */
export interface WidgetWeatherDay {
  /** `YYYY-MM-DD` in the family's home time zone. Native picks the entry for its own ymd. */
  ymd: string;
  glyph: WeatherGlyph;
  /** "57°" */
  high: string;
  /** "49°" */
  low: string;
  /** "57° / 49°" */
  range: string;
}

/**
 * v3: the home town's weather (#134, ADR-043), built from the same reading and helpers as
 * the web atom (`utils/weather/weatherReading.ts`). The staleness thresholds travel as
 * instants, so native holds no copy of them: `now < ageFrom` shows no age;
 * `ageFrom <= now < currentUntil` shows the age (`labels.weatherAsOf`) and the softer ink;
 * `now >= currentUntil` hides `current.temp` and keeps the day's range. `days` are the HOME
 * zone's days (the provider's), so a reader picks today by the ymd in `zone`, never by the
 * device's date (the calendar `days[].ymd` stay device-local: a travelling parent's device
 * and home can sit on different dates for most of a day). A reading with no entry for the
 * home-zone today is treated as no reading.
 */
export interface WidgetWeather {
  /** IANA id of the home zone the `days` are keyed in ("Asia/Singapore"). */
  zone: string;
  /** Epoch ms the reading arrived (device clock). */
  fetchedAt: number;
  /** `fetchedAt + AGE_SHOW_MS`: from here the age is shown. */
  ageFrom: number;
  /** `fetchedAt + CURRENT_MAX_MS`: from here the current temperature is hidden. */
  currentUntil: number;
  current: {
    glyph: WeatherGlyph;
    /** "55°" */
    temp: string;
    /** The translated condition word ("Partly cloudy"). */
    condition: string;
  };
  /** The home-zone today and the days after it, at most `WIDGET_WEATHER_DAYS`, ascending. */
  days: WidgetWeatherDay[];
}

/** Absolute https links (with `src=widget`) for surfaces that are not an item. */
export interface WidgetLinks {
  /** The date column, "later ›", and any tap outside an item. */
  nook: string;
  /** The due count. */
  todo: string;
}

export interface WidgetSnapshot {
  version: typeof WIDGET_SNAPSHOT_VERSION;
  /** ISO timestamp of the build; drives "as of" and the 24 h staleness rule. */
  generatedAt: string;
  /** Last 6 characters of the family id (paging/prefs scoping and diagnostics; not PII). */
  familyIdTail: string;
  viewer: {
    memberId: string;
    firstName: string;
    avatar: WidgetAvatar;
    isChild: boolean;
  };
  settings: {
    /** Per-device "Show event titles on the lock screen" (default true). */
    lockScreenTitles: boolean;
  };
  labels: WidgetLabels;
  links: WidgetLinks;
  /** Today and the next six days (`WIDGET_DAYS`), ascending. */
  days: WidgetDayEntry[];
  /**
   * v3: the home town's weather, or null when Show Weather is off, no town is set, or there
   * is no reading with an entry for the home-zone today. Absent in a v2 snapshot.
   */
  weather?: WidgetWeather | null;
}
