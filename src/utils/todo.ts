import type { CreateTodoInput, TodoItem, TodoSort } from '@/types/models';
import { toAssigneePayload } from './assignees';
import { localToday } from './date';
import { parseIsoDateSafely } from './safeDate';
import { todoLink, todoLinkPatch } from './activityLinks';

/**
 * Check whether a todo item is overdue (past its due date/time).
 * Handles both date-only and date+time precision. Corrupt dueDates are
 * logged via parseIsoDateSafely and treated as not-overdue (rather than
 * silently dropping the comparison via Invalid Date).
 */
export function isTodoOverdue(todo: TodoItem): boolean {
  if (todo.completed || !todo.dueDate) return false;
  const dueDate = parseIsoDateSafely(todo.dueDate, `todo ${todo.id}.dueDate`);
  if (!dueDate) return false;
  if (todo.dueTime) {
    const parts = todo.dueTime.split(':').map(Number);
    dueDate.setHours(parts[0] ?? 23, parts[1] ?? 59, 0, 0);
  } else {
    dueDate.setHours(23, 59, 59, 999);
  }
  return new Date() > dueDate;
}

/**
 * Check whether a todo item is due today (date matches local-today and not
 * overdue). Overdue takes precedence: a todo with `dueTime` earlier than now
 * but `dueDate` matching today is overdue, not due-today.
 */
export function isTodoDueToday(todo: TodoItem): boolean {
  if (todo.completed || !todo.dueDate) return false;
  if (isTodoOverdue(todo)) return false;
  return todo.dueDate.slice(0, 10) === localToday();
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
 *   - an activity link is written only with an id, through `todoLinkPatch`.
 *
 * Built FIELD BY FIELD and never by spreading `fields`: the review drawer passes whole drafts,
 * which carry keys that must never be persisted (`matchDate`, `timeDropped`, `dueDerived`,
 * `duplicateOf`). Pure: no id, no store, no logging.
 */
export function toCreateTodoInput(fields: TodoCreateFields, createdBy: string): CreateTodoInput {
  const description = fields.description?.trim() || undefined;
  const dueDate = fields.dueDate?.trim() || undefined;
  const dueTime = dueDate ? fields.dueTime?.trim() || undefined : undefined;
  const assigneeIds = fields.assigneeIds ?? [];
  return {
    title: fields.title.trim(),
    ...(description ? { description } : {}),
    ...(dueDate ? { dueDate } : {}),
    ...(dueTime ? { dueTime } : {}),
    ...(assigneeIds.length ? toAssigneePayload([...assigneeIds]) : {}),
    // Through the link writer, so the id and session date are always written together.
    ...(fields.activityId ? todoLinkPatch(todoLink(fields)) : {}),
    completed: false,
    createdBy,
  };
}
