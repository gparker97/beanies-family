/**
 * Where an open to-do sits on a day ("its plate"), and when it starts showing ("Show from").
 *
 * The ONE date rule for every surface that shows to-dos: the daily briefing, the Nook, the
 * wall, the phone widget and the To-Dos page's groups. Pure and string-based: every comparison
 * is a `YYYY-MM-DD` or `HH:mm` string comparison against a `PlateClock`, never `Date`
 * arithmetic, so a to-do's day never depends on how a date string is parsed (a bare
 * `new Date('YYYY-MM-DD')` is UTC, which turned to-dos overdue a day early west of UTC).
 * The one date shift is `addDaysYmd` for a repeating to-do's lead (string in, string out).
 *
 * The show rule is stored as three optional fields on `TodoItem` (`showFrom`, `showOn`,
 * `showLeadDays`), written only through `showRulePatch` and read only through `todoShowRule`.
 * Invariants:
 *   - Never hidden on or after the due date (`todoShowDate` takes the earlier of the two).
 *   - Fails open: a malformed or out-of-range value reads as "right away", never as hidden.
 *   - An undated to-do always shows, whatever a merge left in its fields.
 *   - `todoPlate` never reads `completed` or `someday`: callers filter, so a to-do finished
 *     today keeps its bucket.
 */
import type { TodoItem } from '@/types/models';
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

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{2}:\d{2}$/;

/** Is `value` a plain `YYYY-MM-DD` string (the only shape a show date is stored in)? */
export function isYmd(value: unknown): value is string {
  return typeof value === 'string' && YMD.test(value);
}

/** Is `days` a usable lead: a whole number from 1 to `SHOW_LEAD_MAX`? */
export function isShowLeadDays(days: unknown): days is number {
  return typeof days === 'number' && Number.isInteger(days) && days >= 1 && days <= SHOW_LEAD_MAX;
}

/** The due date as `YYYY-MM-DD`, or '' when absent or malformed (which then reads as undated). */
function dueYmdOf(todo: Pick<TodoItem, 'dueDate'>): string {
  const due = todo.dueDate?.slice(0, 10) ?? '';
  return isYmd(due) ? due : '';
}

const NOW: TodoShowRule = Object.freeze({ kind: 'now' });
const DUE: TodoShowRule = Object.freeze({ kind: 'due' });

/**
 * The effective show rule. Fields from a merge of two devices' edits resolve as:
 *   - an undated to-do is always `now` (there is no due date to wait for, and no UI to
 *     change a rule it cannot see);
 *   - repeating: `showOn: 'now'`, then a valid `showLeadDays` (`lead`), then `due` (the
 *     repeating default); `showFrom` is ignored;
 *   - one-off: an explicit `showOn` (`'due'`, then `'now'`) wins over `showFrom`; a valid
 *     `showFrom` is `from`; anything else (absent, malformed) is `now`. `showLeadDays` is
 *     ignored.
 */
export function todoShowRule(todo: ShowFields): TodoShowRule {
  if (!dueYmdOf(todo)) return NOW;
  if (isRepeating(todo)) {
    if (todo.showOn === 'now') return NOW;
    if (isShowLeadDays(todo.showLeadDays)) return { kind: 'lead', days: todo.showLeadDays };
    return DUE;
  }
  if (todo.showOn === 'due') return DUE;
  if (todo.showOn === 'now') return NOW;
  if (isYmd(todo.showFrom)) return { kind: 'from', date: todo.showFrom };
  return NOW;
}

/** Every show field cleared: the base of every patch, so a write never leaves a stale one. */
/** The kind's default rule: a repeating to-do shows on each due date, a one-off right away. */
export function defaultShowRule(repeating: boolean): TodoShowRule {
  return repeating ? DUE : NOW;
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

const CLEARED = Object.freeze({
  showFrom: undefined,
  showOn: undefined,
  showLeadDays: undefined,
});

export type ShowRulePatch = Pick<TodoItem, 'showFrom' | 'showOn' | 'showLeadDays'>;

/**
 * The ONE writer of the show fields. Writes only a non-default value and always clears the
 * rest, so the stored choice follows the due date as a flag, never as a copied date:
 *   - one-off: `now` → all cleared; `from` → `{showFrom}`; `due` → `{showOn: 'due'}`;
 *     `lead` (repeating only) → written as `now`;
 *   - repeating: `due` or `from` → all cleared (the repeating default); `now` →
 *     `{showOn: 'now'}`; `lead` → `{showLeadDays}`.
 * A malformed `from` date or lead fails open to the kind's default (the store refuses them
 * before they reach here).
 */
export function showRulePatch(rule: TodoShowRule, repeating: boolean): ShowRulePatch {
  if (repeating) {
    if (rule.kind === 'now') return { ...CLEARED, showOn: 'now' };
    if (rule.kind === 'lead' && isShowLeadDays(rule.days)) {
      return { ...CLEARED, showLeadDays: rule.days };
    }
    return { ...CLEARED };
  }
  if (rule.kind === 'due') return { ...CLEARED, showOn: 'due' };
  if (rule.kind === 'from' && isYmd(rule.date)) return { ...CLEARED, showFrom: rule.date };
  return { ...CLEARED };
}

/** The earlier of two `YYYY-MM-DD` strings. */
/**
 * What a due-date change does to the stored show rule, or null when it does nothing. The one
 * place this lives, called by `todoStore.updateTodo` for every write that carries `dueDate`:
 *   - a due date that EXISTED and is now cleared takes the rule with it (an undated to-do has
 *     no rule; a stale one must not come back when a date is set again). A to-do that had no
 *     due date to begin with is left alone (a repeat's undo patch writes `dueDate: undefined`);
 *   - a one-off `showFrom` at or past the NEW due date becomes "on the due date" (a flag that
 *     follows the date), exactly as the create form does.
 */
export function showPatchOnDueChange(
  existing: ShowFields,
  nextDueDate: string | null | undefined
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
    ? showRulePatch(DUE, false)
    : null;
}

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
 * The day the to-do starts showing, or undefined when it shows right away. Never after the
 * due date. On a repeating to-do with a lead, the date moves with each roll: `rollOverdue`
 * keeps `dueDate` at the next occurrence, so a ticked occurrence waits again until the next
 * lead window opens.
 */
export function todoShowDate(todo: ShowFields): string | undefined {
  return ruleShowDate(todoShowRule(todo), dueYmdOf(todo));
}

/**
 * Where the to-do sits on the clock's day. Tests in order: overdue (due before today, or
 * today with a due time already past), today, waiting (its show date is after today),
 * undated, upcoming. Date-only: never reads `completed` or `someday`.
 */
export function todoPlate(todo: ShowFields, clock: PlateClock): TodoPlate {
  const due = dueYmdOf(todo);
  if (due) {
    if (due < clock.ymd) return 'overdue';
    if (due === clock.ymd) {
      // A malformed time reads as untimed (end of the day): never overdue early.
      const time = todo.dueTime && HHMM.test(todo.dueTime) ? todo.dueTime : '';
      return time && time < clock.hhmm ? 'overdue' : 'today';
    }
  }
  const show = todoShowDate(todo);
  if (show && show > clock.ymd) return 'waiting';
  return due ? 'upcoming' : 'undated';
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
  return fillTemplate(t('todo.show.tag.from'), { date: formatNookDate(show) });
}
