/**
 * Parse an ISO date defensively. Returns `null` on missing/empty/unparseable
 * input and logs a one-line dev warning with the supplied context label so
 * corrupt data is never silently dropped from a filter or comparison.
 *
 * Callers handle `null` explicitly — no throws, no silent `Invalid Date`
 * comparisons (which evaluate `false` against any valid Date and would
 * otherwise drop the entry without trace).
 *
 * Example:
 *   const due = parseIsoDateSafely(todo.dueDate, `todo ${todo.id}.dueDate`);
 *   if (!due) return false;  // explicit handling, no Invalid Date in scope
 */
export function parseIsoDateSafely(iso: string | null | undefined, context: string): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    console.warn(`[safeDate] could not parse "${iso}" in ${context} — excluded from filter`);
    return null;
  }
  return d;
}
