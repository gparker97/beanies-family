/**
 * Normalize assignee fields from either the new array field or legacy single field.
 * This is the single source of truth — all consumers use this instead of reading assigneeId directly.
 */
export function normalizeAssignees(entity: {
  assigneeIds?: string[];
  assigneeId?: string;
}): string[] {
  if (entity.assigneeIds?.length) return entity.assigneeIds;
  if (entity.assigneeId) return [entity.assigneeId];
  return [];
}

/**
 * Build the write payload for assignees.
 * Populates both the new array field and legacy single field for backward compatibility.
 */
export function toAssigneePayload(ids: string[]): {
  assigneeIds: string[];
  assigneeId: string | undefined;
} {
  return {
    assigneeIds: ids,
    assigneeId: ids[0] ?? undefined,
  };
}

/**
 * Human-friendly conjunction list of names:
 *   []                     → ""
 *   ["Neil"]               → "Neil"
 *   ["Neil", "Sam"]        → "Neil & Sam"
 *   ["Neil", "Sam", "Max"] → "Neil, Sam & Max"
 * Falsy entries (empty strings) are dropped. Total — never throws.
 */
export function formatNameList(names: string[]): string {
  const xs = names.filter(Boolean);
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} & ${xs[xs.length - 1]}`;
}
