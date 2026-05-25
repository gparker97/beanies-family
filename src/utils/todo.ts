import type { TodoItem, TodoSort } from '@/types/models';
import { localToday } from './date';
import { parseIsoDateSafely } from './safeDate';

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
