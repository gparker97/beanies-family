import type { TodoItem } from '@/types/models';
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
