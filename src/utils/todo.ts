import type { CreateTodoInput, RecurrenceRule, TodoItem, TodoSort } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';
import { toAssigneePayload } from './assignees';
import { formatNookDate, localToday } from './date';
import { todoLink, todoLinkPatch } from './activityLinks';
import { startRepeat } from './todoRecurrence';
import { plateClock, showRulePatch, todoPlate, type TodoShowRule } from './todoPlate';

/**
 * Is this open to-do overdue (past its due date, or due today with its time already past)?
 * One definition everywhere: `todoPlate` with the device-local clock, compared as strings,
 * so a to-do due on the 24th is never overdue before the 24th ends in any time zone. A
 * malformed due date reads as undated (never overdue).
 */
export function isTodoOverdue(todo: TodoItem): boolean {
  return !todo.completed && todoPlate(todo, plateClock()) === 'overdue';
}

/**
 * Is this open to-do due today and not yet overdue? Overdue takes precedence: a to-do due
 * today with a time already past is overdue, not due-today (`todoPlate`).
 */
export function isTodoDueToday(todo: TodoItem): boolean {
  return !todo.completed && todoPlate(todo, plateClock()) === 'today';
}

/**
 * Sort a list of to-dos for display. Pure — returns a NEW array and never
 * mutates the input. Semantics match the Family To-Do page's historical order:
 * - `newest` / `oldest`: by `createdAt`.
 * - `dueDate`: earliest due date first, with undated items pushed to the end.
 *
 * `dueDate` is a date-only `ISODateString` (the time of day lives in the
 * separate `dueTime` field), so a plain string `localeCompare` is correct and
 * faithful — no `Date` parsing. `Array.prototype.sort` is stable, so ties
 * (equal `createdAt`, equal `dueDate`, or two undated items) preserve input
 * order, matching the prior behaviour exactly. Add no secondary tie-breaker.
 */
export function sortTodos(items: TodoItem[], sort: TodoSort): TodoItem[] {
  const sorted = [...items];
  switch (sort) {
    case 'newest':
      return sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case 'oldest':
      return sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    case 'dueDate':
      return sorted.sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      });
    default:
      return sorted;
  }
}

/** The fields a person can give a new to-do, from any of the places one is created. */
export interface TodoCreateFields {
  title: string;
  description?: string;
  dueDate?: string;
  dueTime?: string;
  assigneeIds?: string[];
  /** Link the new to-do to this activity (#114). Ignored without an id. */
  activityId?: string;
  /** With `activityId`: the session of a repeating activity it belongs to (`YYYY-MM-DD`). */
  activityDate?: string;
  /** Make it a repeating to-do (#123). Ignored without a due date, which anchors the series. */
  repeat?: RecurrenceRule;
  /** "Keep Parents Posted" on a child's routine. Written only when the repeat starts. */
  notifyParents?: boolean;
  /** "Show from" (`utils/todoPlate`). Ignored without a due date (an undated to-do always shows). */
  show?: TodoShowRule;
}

/**
 * Build the `createTodo` input for a new to-do. Shared by the To-Dos page sidebar, its quick-add
 * bar, the Nook widget and the magic beans review drawer, so every create follows one set of
 * rules:
 *   - the title is trimmed (a caller that needs a fallback title applies it before calling);
 *   - an empty or blank description, date or time is saved as absent, never as `''`
 *     (`stripUndefined` drops only `undefined`, and a cleared picker yields `''`);
 *   - a time is kept only alongside a date (reminders and "overdue" assume both);
 *   - assignees are written only when there are some;
 *   - an activity link is written only with an id, through `todoLinkPatch`;
 *   - a repeat is written only with a due date, through `startRepeat` (the due date is the
 *     anchor, and `dueDate` becomes the series' first occurrence on or after today);
 *   - `notifyParents` is written (as `true`) only alongside a started repeat;
 *   - a show rule is written only with a due date, through `showRulePatch` (for the kind the
 *     to-do ends up as: a repeat that could not start writes the one-off rule), and only its
 *     non-default fields.
 *
 * Built FIELD BY FIELD and never by spreading `fields`: the review drawer passes whole drafts,
 * which carry keys that must never be persisted (`matchDate`, `timeDropped`, `dueDerived`,
 * `duplicateOf`). Pure: no id, no store, no logging.
 */
export function toCreateTodoInput(
  fields: TodoCreateFields,
  createdBy: string,
  todayYmd: string = localToday()
): CreateTodoInput {
  const description = fields.description?.trim() || undefined;
  const dueDate = fields.dueDate?.trim() || undefined;
  const dueTime = dueDate ? fields.dueTime?.trim() || undefined : undefined;
  const assigneeIds = fields.assigneeIds ?? [];
  const started = dueDate && fields.repeat ? startRepeat(fields.repeat, dueDate, todayYmd) : null;
  const show = dueDate && fields.show ? showRulePatch(fields.show, !!started) : null;
  return {
    title: fields.title.trim(),
    ...(description ? { description } : {}),
    ...(started
      ? {
          dueDate: started.dueDate,
          repeat: started.repeat,
          repeatLog: started.repeatLog,
          ...(fields.notifyParents ? { notifyParents: true } : {}),
        }
      : dueDate
        ? { dueDate }
        : {}),
    ...(dueTime ? { dueTime } : {}),
    ...(show?.showFrom ? { showFrom: show.showFrom } : {}),
    ...(show?.showOn ? { showOn: show.showOn } : {}),
    ...(show?.showLeadDays ? { showLeadDays: show.showLeadDays } : {}),
    ...(assigneeIds.length ? toAssigneePayload([...assigneeIds]) : {}),
    // Through the link writer, so the id and session date are always written together.
    ...(fields.activityId ? todoLinkPatch(todoLink(fields)) : {}),
    completed: false,
    createdBy,
  };
}

/**
 * A short label for a due day: "Today", else the compact Nook date ("Wed, 6 Mar"). Used where
 * a repeating to-do's next date is shown (the reminders roster, the card's linked to-do row).
 */
export function dueDayLabel(
  ymd: string,
  todayYmd: string,
  t: (key: UIStringKey) => string
): string {
  return ymd === todayYmd ? t('date.today') : formatNookDate(ymd);
}
