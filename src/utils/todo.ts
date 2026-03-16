import type { TodoItem } from '@/types/models';

/**
 * Check whether a todo item is overdue (past its due date/time).
 * Handles both date-only and date+time precision.
 */
export function isTodoOverdue(todo: TodoItem): boolean {
  if (todo.completed || !todo.dueDate) return false;
  const now = new Date();
  const dueDate = new Date(todo.dueDate);
  if (todo.dueTime) {
    const parts = todo.dueTime.split(':').map(Number);
    dueDate.setHours(parts[0] ?? 23, parts[1] ?? 59, 0, 0);
  } else {
    dueDate.setHours(23, 59, 59, 999);
  }
  return now > dueDate;
}
