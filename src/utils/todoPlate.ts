/**
 * Where an open to-do or list sits on a day ("its plate"), and when it starts showing ("Show
 * from").
 *
 * The ONE date rule for every surface that shows to-dos and lists: the daily briefing, the
 * Nook, the wall, the phone widget and the To-Dos page's groups. The rule reads a `ShowSubject`
 * (a to-do through `todoSubject`, a list through `listSubject` in `utils/listLifecycle`); the
 * kinds differ only in the one-off default (`ONE_OFF_DEFAULT`). Pure and string-based: every comparison
 * is a `YYYY-MM-DD` or `HH:mm` string comparison against a `PlateClock`, never `Date`
 * arithmetic, so a to-do's day never depends on how a date string is parsed (a bare
 * `new Date('YYYY-MM-DD')` is UTC, which turned to-dos overdue a day early west of UTC).
 * The one date shift is `addDaysYmd` for a repeating to-do's lead (string in, string out).
 *
 * The show rule is stored as three optional fields on `TodoItem` and `FamilyList` (`showFrom`,
 * `showOn`, `showLeadDays`), written only through `showRulePatch` and read only through
 * `showRuleOf` (`todoShowRule` for a to-do).
 * Invariants:
 *   - Never hidden on or after the due date (`todoShowDate` takes the earlier of the two).
 *   - Fails open: a malformed or out-of-range value reads as the kind's default, never as
 *     hidden past the due date.
 *   - An undated to-do always shows, whatever a merge left in its fields.
 *   - `todoPlate` never reads `completed` or `someday`: callers filter, so a to-do finished
 *     today keeps its bucket.
 */
import type { ISODateString, TodoItem } from '@/types/models';
import type { Cadence } from '@/types/recurrence';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { addDaysYmd, formatNookDate, toDateInputValue, toTimeInputValue } from './date';
import { fillTemplate } from './fillTemplate';
import { isRepeating } from './todoRecurrence';

/** "Now" as the plate rule reads it: the device-local day and minute. */
export interface PlateClock {
  /** `YYYY-MM-DD`, device-local. */
  ymd: string;
  /** `HH:mm`, device-local, 24-hour. */
  hhmm: string;
}

/** The clock for `date` (now by default), in the device's own time zone. */
export function plateClock(date: Date = new Date()): PlateClock {
  return { ymd: toDateInputValue(date), hhmm: toTimeInputValue(date) };
}

/**
 * When a to-do starts showing:
 *   - `now`: right away (the one-off default);
 *   - `from`: from `date` (one-off only), never later than the due date;
 *   - `due`: on the due date (the repeating default);
 *   - `lead`: `days` before each due date (repeating only).
 */
export type TodoShowRule =
  | { kind: 'now' }
  | { kind: 'from'; date: string }
  | { kind: 'due' }
  | { kind: 'lead'; days: number };

/** The longest "days before" lead on a repeating to-do. */
export const SHOW_LEAD_MAX = 30;
/** Where the "days before" stepper starts. */
export const SHOW_LEAD_DEFAULT = 3;

/**
 * Where an open to-do sits on a day:
 *   - `overdue`: its due date (and time, when it has one) has passed;
 *   - `today`: due today, not yet past its time;
 *   - `upcoming`: due later, and showing;
 *   - `undated`: no due date (always showing);
 *   - `waiting`: not showing yet (only the To-Dos page lists it).
 */
export type TodoPlate = 'overdue' | 'today' | 'upcoming' | 'undated' | 'waiting';

/** A plate that shows on a surface (everything but `waiting`). */
export type ShownPlate = Exclude<TodoPlate, 'waiting'>;

/** The order every surface lists plates in (the widget's `TASK_BUCKET_ORDER` matches it). */
export const TODO_PLATE_ORDER: readonly TodoPlate[] = [
  'overdue',
  'today',
  'undated',
  'upcoming',
  'waiting',
];

type ShowFields = Pick<
  TodoItem,
  'dueDate' | 'dueTime' | 'repeat' | 'showFrom' | 'showOn' | 'showLeadDays'
>;

/** What the rule is applied to. The kinds differ only in their one-off default. */
export type ShowKind = 'todo' | 'list';

/**
 * When a one-off with a due date and no stored rule shows: a to-do right away, a list on its
 * due date (greg, 2026-11-13). Repeating subjects of both kinds default to the due date.
 */
export const ONE_OFF_DEFAULT: Readonly<Record<ShowKind, 'now' | 'due'>> = Object.freeze({
  todo: 'now',
  list: 'due',
});

/** The fields the rule reads, whatever is being shown. */
export interface ShowSubject {
  kind: ShowKind;
  /** The day it is due (a repeating list: its reset day). */
  dueDate?: ISODateString;
  dueTime?: string;
  repeating: boolean;
  /** For the lead clamp (`maxShowLead`). */
  cadence?: Cadence | null;
  showFrom?: ISODateString;
  showOn?: 'now' | 'due';
  showLeadDays?: number;
}

/** A to-do as a show subject. */
function todoSubject(todo: ShowFields): ShowSubject {
  return {
    kind: 'todo',
    dueDate: todo.dueDate,
    dueTime: todo.dueTime,
    repeating: isRepeating(todo),
    cadence: todo.repeat?.rule,
    showFrom: todo.showFrom,
    showOn: todo.showOn,
    showLeadDays: todo.showLeadDays,
  };
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{2}:\d{2}$/;

/** Is `value` a plain `YYYY-MM-DD` string (the only shape a show date is stored in)? */
export function isYmd(value: unknown): value is string {
  return typeof value === 'string' && YMD.test(value);
}

/**
 * The longest lead a cadence leaves room for: one day less than the SHORTEST gap between two
 * occurrences, never past `SHOW_LEAD_MAX`. A lead as long as the gap would show the to-do all
 * the time, which is what "Every day" already says. 0 means there is no room (a daily repeat),
 * so "days before" is not offered. No cadence (a legacy or malformed rule) is the plain ceiling.
 *
 * Gaps: `interval` days; 7 x `interval` days, or the closest pair of weekdays on a plain weekly
 * rule with several; 28 x `interval` for months (the shortest month); 365 x `interval` for years.
 */
export function maxShowLead(cadence: Cadence | null | undefined): number {
  if (!cadence) return SHOW_LEAD_MAX;
  const interval =
    Number.isInteger(cadence.interval) && cadence.interval >= 1 ? cadence.interval : 1;
  let gap: number;
  switch (cadence.unit) {
    case 'day':
      gap = interval;
      break;
    case 'week': {
      gap = 7 * interval;
      const days = [...new Set(cadence.weekdays ?? [])]
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        .sort((a, b) => a - b);
      if (interval === 1 && days.length > 1) {
        days.forEach((d, i) => {
          const next = days[(i + 1) % days.length]!;
          gap = Math.min(gap, (next - d + 7) % 7 || 7);
        });
      }
      break;
    }
    case 'month':
      gap = 28 * interval;
      break;
    case 'year':
      gap = 365 * interval;
      break;
    default:
      return SHOW_LEAD_MAX;
  }
  return Math.max(0, Math.min(SHOW_LEAD_MAX, gap - 1));
}

/** Is `days` a usable lead: a whole number from 1 to `SHOW_LEAD_MAX`? */
export function isShowLeadDays(days: unknown): days is number {
  return typeof days === 'number' && Number.isInteger(days) && days >= 1 && days <= SHOW_LEAD_MAX;
}

/** The due date as `YYYY-MM-DD`, or '' when absent or malformed (which then reads as undated). */
function dueYmdOf(subject: { dueDate?: string }): string {
  const due = subject.dueDate?.slice(0, 10) ?? '';
  return isYmd(due) ? due : '';
}

const NOW: TodoShowRule = Object.freeze({ kind: 'now' });
const DUE: TodoShowRule = Object.freeze({ kind: 'due' });

/** The one-off default rule for a kind. */
function oneOffDefault(kind: ShowKind): TodoShowRule {
  return ONE_OFF_DEFAULT[kind] === 'due' ? DUE : NOW;
}

/**
 * The effective show rule. Fields from a merge of two devices' edits resolve as:
 *   - an undated subject is always `now` (there is no due date to wait for, and no UI to
 *     change a rule it cannot see);
 *   - repeating: `showOn: 'now'`, then a valid `showLeadDays` (`lead`), then `due` (the
 *     repeating default); `showFrom` is ignored. A stored lead longer than the cadence leaves
 *     room for (`maxShowLead`: the repeat was shortened later, or another device wrote it) READS
 *     as the longest that fits, and as `due` when none fits; the stored value is left alone, so
 *     lengthening the repeat again brings it back;
 *   - one-off: an explicit `showOn` (`'due'`, then `'now'`) wins over `showFrom`; a valid
 *     `showFrom` is `from`; anything else (absent, malformed) is the kind's default
 *     (`ONE_OFF_DEFAULT`). `showLeadDays` is ignored.
 */
export function showRuleOf(subject: ShowSubject): TodoShowRule {
  if (!dueYmdOf(subject)) return NOW;
  if (subject.repeating) {
    if (subject.showOn === 'now') return NOW;
    if (isShowLeadDays(subject.showLeadDays)) {
      const days = Math.min(subject.showLeadDays, maxShowLead(subject.cadence));
      if (days >= 1) return { kind: 'lead', days };
    }
    return DUE;
  }
  if (subject.showOn === 'due') return DUE;
  if (subject.showOn === 'now') return NOW;
  if (isYmd(subject.showFrom)) return { kind: 'from', date: subject.showFrom };
  return oneOffDefault(subject.kind);
}

/** `showRuleOf` for a to-do. */
export function todoShowRule(todo: ShowFields): TodoShowRule {
  return showRuleOf(todoSubject(todo));
}

/**
 * The default rule: a repeating subject shows on each due date; a one-off by its kind's
 * `ONE_OFF_DEFAULT` (a to-do right away, a list on its due date).
 */
export function defaultShowRule(repeating: boolean, kind: ShowKind = 'todo'): TodoShowRule {
  return repeating ? DUE : oneOffDefault(kind);
}

/**
 * Why a requested rule cannot be stored, or null when it can: a `from` date that is not
 * `YYYY-MM-DD`, or a `lead` on a one-off, out of 1-30, or longer than the cadence leaves room
 * for (`maxShowLead`). The one check both stores' `setShowRule` refuse with.
 */
export function invalidShowRule(
  rule: TodoShowRule,
  repeating: boolean,
  cadence: Cadence | null | undefined
): 'invalid-date' | 'invalid-lead' | null {
  if (rule.kind === 'from' && !isYmd(rule.date)) return 'invalid-date';
  if (
    rule.kind === 'lead' &&
    (!repeating || !isShowLeadDays(rule.days) || rule.days > maxShowLead(cadence))
  ) {
    return 'invalid-lead';
  }
  return null;
}

/**
 * Whether there is a "Show from" choice to offer: a repeating to-do with a due date always
 * (the choice governs every later occurrence); a one-off only while its due date is still
 * ahead (due today or earlier, it already shows). The field and its host both gate on this.
 */
export function showFieldApplies(repeating: boolean, dueDate: string, todayYmd: string): boolean {
  const due = dueDate.slice(0, 10);
  return isYmd(due) && (repeating || due > todayYmd);
}

/** Every show field cleared: the base of every patch, so a write never leaves a stale one. */
export const CLEARED = Object.freeze({
  showFrom: undefined,
  showOn: undefined,
  showLeadDays: undefined,
});

export type ShowRulePatch = Pick<TodoItem, 'showFrom' | 'showOn' | 'showLeadDays'>;

/**
 * The ONE writer of the show fields. Writes only a non-default value and always clears the
 * rest, so the stored choice follows the due date as a flag, never as a copied date:
 *   - one-off: `from` → `{showFrom}`; `now` or `due` → all cleared when it is the kind's
 *     default (`ONE_OFF_DEFAULT`), else `{showOn}` (a to-do stores `{showOn: 'due'}`, a list
 *     `{showOn: 'now'}`); `lead` (repeating only) → written as the kind's default;
 *   - repeating: `due` or `from` → all cleared (the repeating default); `now` →
 *     `{showOn: 'now'}`; `lead` → `{showLeadDays}`.
 * A malformed `from` date or lead fails open to the kind's default (the store refuses them
 * before they reach here).
 */
export function showRulePatch(
  rule: TodoShowRule,
  repeating: boolean,
  kind: ShowKind = 'todo'
): ShowRulePatch {
  if (repeating) {
    if (rule.kind === 'now') return { ...CLEARED, showOn: 'now' };
    if (rule.kind === 'lead' && isShowLeadDays(rule.days)) {
      return { ...CLEARED, showLeadDays: rule.days };
    }
    return { ...CLEARED };
  }
  if (rule.kind === 'from' && isYmd(rule.date)) return { ...CLEARED, showFrom: rule.date };
  const showOn = rule.kind === 'now' || rule.kind === 'due' ? rule.kind : ONE_OFF_DEFAULT[kind];
  return showOn === ONE_OFF_DEFAULT[kind] ? { ...CLEARED } : { ...CLEARED, showOn };
}

/**
 * What a due-date change does to the stored show rule, or null when it does nothing. The one
 * place this lives, called by `todoStore.updateTodo` (and `listStore.updateList`, for a one-off
 * list, with `kind: 'list'`) for every write that carries `dueDate`:
 *   - a due date that EXISTED and is now cleared takes the rule with it (an undated subject
 *     has no rule; a stale one must not come back when a date is set again). One that had no
 *     due date to begin with is left alone (a repeat's undo patch writes `dueDate: undefined`);
 *   - a one-off `showFrom` at or past the NEW due date becomes "on the due date" (a flag that
 *     follows the date; for a list that is its default, so the fields are cleared), exactly as
 *     the create form does.
 * A list carries no `repeat`, so `isRepeating` is false for it: the list store calls this for
 * one-off lists only.
 */
export function showPatchOnDueChange(
  existing: ShowFields,
  nextDueDate: string | null | undefined,
  kind: ShowKind = 'todo'
): ShowRulePatch | null {
  const hadDue = dueYmdOf(existing) !== '';
  const nextDue = nextDueDate ? nextDueDate.slice(0, 10) : '';
  if (!nextDue) {
    const hasRule =
      existing.showFrom !== undefined ||
      existing.showOn !== undefined ||
      existing.showLeadDays !== undefined;
    return hadDue && hasRule ? { ...CLEARED } : null;
  }
  if (isRepeating(existing) || existing.showOn !== undefined) return null;
  return isYmd(existing.showFrom) && isYmd(nextDue) && existing.showFrom >= nextDue
    ? showRulePatch(DUE, false, kind)
    : null;
}

/** The earlier of two `YYYY-MM-DD` strings. */
const earlierOf = (a: string, b: string): string => (a < b ? a : b);

/** The day `rule` starts showing a to-do due on `dueYmd`, or undefined for `now`. */
function ruleShowDate(rule: TodoShowRule, dueYmd: string): string | undefined {
  if (!dueYmd) return undefined;
  switch (rule.kind) {
    case 'due':
      return dueYmd;
    case 'lead':
      return addDaysYmd(dueYmd, -rule.days);
    case 'from':
      return earlierOf(rule.date, dueYmd);
    case 'now':
      return undefined;
  }
}

/**
 * The day the subject starts showing, or undefined when it shows right away. Never after the
 * due date. On a repeating to-do with a lead, the date moves with each roll: `rollOverdue`
 * keeps `dueDate` at the next occurrence, so a ticked occurrence waits again until the next
 * lead window opens (a repeating list's due day is its next reset, so it moves the same way).
 */
export function showDateOf(subject: ShowSubject): string | undefined {
  return ruleShowDate(showRuleOf(subject), dueYmdOf(subject));
}

/** `showDateOf` for a to-do. */
export function todoShowDate(todo: ShowFields): string | undefined {
  return showDateOf(todoSubject(todo));
}

/**
 * Where the subject sits on the clock's day. Tests in order: overdue (due before today, or
 * today with a due time already past), today, waiting (its show date is after today),
 * undated, upcoming. Date-only: never reads `completed` or `someday`.
 */
export function plateOf(subject: ShowSubject, clock: PlateClock): TodoPlate {
  const due = dueYmdOf(subject);
  if (due) {
    if (due < clock.ymd) return 'overdue';
    if (due === clock.ymd) {
      // A malformed time reads as untimed (end of the day): never overdue early.
      const time = subject.dueTime && HHMM.test(subject.dueTime) ? subject.dueTime : '';
      return time && time < clock.hhmm ? 'overdue' : 'today';
    }
  }
  const show = showDateOf(subject);
  if (show && show > clock.ymd) return 'waiting';
  return due ? 'upcoming' : 'undated';
}

/** `plateOf` for a to-do. */
export function todoPlate(todo: ShowFields, clock: PlateClock): TodoPlate {
  return plateOf(todoSubject(todo), clock);
}

/** A to-do and its plate, computed once. */
export interface PlatedTodo<P extends TodoPlate = TodoPlate> {
  todo: TodoItem;
  plate: P;
}

/** Due date, then timed before untimed by time (a to-do's natural order within a plate). */
function byDueThenTime(a: TodoItem, b: TodoItem): number {
  const ad = dueYmdOf(a);
  const bd = dueYmdOf(b);
  if (ad !== bd) return ad.localeCompare(bd);
  const at = a.dueTime ?? '';
  const bt = b.dueTime ?? '';
  if (at && bt) return at.localeCompare(bt);
  return Number(!at) - Number(!bt);
}

/**
 * Each to-do with its plate, sorted: overdue (oldest due first), today (timed by time, then
 * untimed), undated (source order), upcoming (soonest due first), waiting (soonest show date
 * first). Stable, so ties keep the input order. Pure: returns a new array.
 */
export function platedTodos(todos: readonly TodoItem[], clock: PlateClock): PlatedTodo[] {
  const rank = (plate: TodoPlate) => TODO_PLATE_ORDER.indexOf(plate);
  return todos
    .map((todo) => ({ todo, plate: todoPlate(todo, clock), show: todoShowDate(todo) ?? '' }))
    .sort((a, b) => {
      const byPlate = rank(a.plate) - rank(b.plate);
      if (byPlate !== 0) return byPlate;
      if (a.plate === 'undated') return 0;
      if (a.plate === 'waiting' && a.show !== b.show) return a.show.localeCompare(b.show);
      return byDueThenTime(a.todo, b.todo);
    })
    .map(({ todo, plate }) => ({ todo, plate }));
}

/** The To-Dos page's Open groups, each named by the first plate it holds. */
export type TodoGroupId = 'overdue' | 'today' | 'upcoming' | 'waiting';

/** The ONE header map: which group each plate lands in, and that group's heading. */
const TODO_GROUP_OF: Readonly<Record<TodoPlate, TodoGroupId>> = Object.freeze({
  overdue: 'overdue',
  today: 'today',
  undated: 'upcoming',
  upcoming: 'upcoming',
  waiting: 'waiting',
});

export const TODO_GROUP_HEADER = Object.freeze({
  overdue: 'todo.section.overdue',
  today: 'todo.section.dueToday',
  upcoming: 'todo.section.comingUp',
  waiting: 'todo.section.notShowingYet',
} satisfies Record<TodoGroupId, UIStringKey>);

const TODO_GROUP_ORDER: readonly TodoGroupId[] = ['overdue', 'today', 'upcoming', 'waiting'];

export interface TodoGroup {
  id: TodoGroupId;
  labelKey: UIStringKey;
  todos: TodoItem[];
}

/**
 * The To-Dos page's Open section: Overdue, Due today, Coming up (undated, then upcoming) and
 * Not showing yet, in that order, each in `platedTodos` order. Empty groups are left out.
 */
export function groupOpenTodos(plated: readonly PlatedTodo[]): TodoGroup[] {
  const byGroup = new Map<TodoGroupId, TodoItem[]>();
  for (const { todo, plate } of plated) {
    const id = TODO_GROUP_OF[plate];
    const list = byGroup.get(id);
    if (list) list.push(todo);
    else byGroup.set(id, [todo]);
  }
  return TODO_GROUP_ORDER.flatMap((id) => {
    const todos = byGroup.get(id);
    return todos ? [{ id, labelKey: TODO_GROUP_HEADER[id], todos }] : [];
  });
}

/**
 * The form field's date → the stored rule (one-off): a date on or before today is `now`; on
 * or after the due date is `due` (a flag, so it follows the due date when that moves); a date
 * between is `from`. A malformed date fails open to `now`. The ONLY mapping from the field.
 */
export function fieldShowRule(date: string, dueDate: string, todayYmd: string): TodoShowRule {
  if (!isYmd(date) || date <= todayYmd) return NOW;
  const due = dueDate.slice(0, 10);
  if (isYmd(due) && date >= due) return DUE;
  return { kind: 'from', date };
}

/**
 * The stored rule → the form field's date, the inverse of `fieldShowRule`: `now`, or any rule
 * whose show date is today or earlier, reads as today; otherwise the show date (`due` → the
 * due date, `from` → its date, never after the due date). Without a due date, today.
 */
export function showRuleField(rule: TodoShowRule, dueDate: string, todayYmd: string): string {
  const due = dueDate.slice(0, 10);
  const show = ruleShowDate(rule, isYmd(due) ? due : '');
  return show && show > todayYmd ? show : todayYmd;
}

/**
 * The tag for a rule that is still holding a to-do back: "Shows from Tue, 24 Nov", "Shows on
 * the due date", "Shows 3 days before". '' when the to-do already shows (`now`, a show date
 * of today or earlier, or no due date). Takes the rule rather than a `TodoItem` so the create
 * form (which has no item yet) can use it too.
 */
export function showRuleLabel(
  rule: TodoShowRule,
  dueDate: string,
  todayYmd: string,
  t: (key: UIStringKey) => string
): string {
  const due = dueDate.slice(0, 10);
  const show = ruleShowDate(rule, isYmd(due) ? due : '');
  if (!show || show <= todayYmd) return '';
  if (rule.kind === 'lead') {
    const key = rule.days === 1 ? 'todo.show.tag.lead.one' : 'todo.show.tag.lead.other';
    return fillTemplate(t(key), { n: rule.days });
  }
  if (show === due) return t('todo.show.tag.due');
  return showFromTag(show, t);
}

/** "Shows from Tue, 24 Nov": the one format of a tag that names the day something shows. */
export function showFromTag(showYmd: string, t: (key: UIStringKey) => string): string {
  return fillTemplate(t('todo.show.tag.from'), { date: formatNookDate(showYmd) });
}
