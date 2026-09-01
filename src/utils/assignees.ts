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
 * The assignees that are actually PEOPLE — de-duplicated, and with every id that no longer
 * resolves to a member dropped.
 *
 * `assigneeIds` is a raw id list in a CRDT that no write path prunes, so it accumulates:
 * a member who was later removed, an id written twice by two devices merging, a pet, an
 * id that arrived from a calendar sync. Counting those raw entries is how a one-owner
 * trumpet lesson came to wear the shared style — the record held two ids, only one of
 * which was a person, so the edit form showed one owner while the count said two.
 *
 * Anything DECIDING between "one person's" and "several people's" must count these, not
 * `normalizeAssignees`.
 */
export function effectiveAssignees(
  entity: { assigneeIds?: string[]; assigneeId?: string },
  isKnownMember: (id: string) => boolean
): string[] {
  const seen = new Set<string>();
  for (const id of normalizeAssignees(entity)) if (isKnownMember(id)) seen.add(id);
  return [...seen];
}

/**
 * Is this a SHARED thing rather than one person's?
 *
 * Exactly one assignee belongs to that person; anything else — several assignees, or none
 * at all — is shared. The same 0/1/2+ rule `classifyActivityChip` uses, so the wall, the
 * planner and the chip cannot describe one event three ways.
 *
 * `isKnownMember` is REQUIRED, not optional. An optional resolver is one a call site
 * forgets, and forgetting it silently reintroduces the exact defect this exists to fix —
 * so every caller is made to say how an id becomes a person.
 *
 * STYLE ONLY. Which columns an event appears in is `belongsInMemberColumn`, and the two
 * answers deliberately differ: a two-owner event wears the shared style in exactly its two
 * owners' lanes. Collapsing them is what once pushed a multi-owner event into every
 * column in the family.
 */
export function isSharedEvent(
  entity: { assigneeIds?: string[]; assigneeId?: string },
  isKnownMember: (id: string) => boolean
): boolean {
  return effectiveAssignees(entity, isKnownMember).length !== 1;
}

/**
 * Does this entity belong in `memberId`'s column?
 *
 * Owned means owned: an entity with one or more named assignees appears in THEIR columns
 * and nobody else's. Only an entity with NO owner at all is everybody's, on the principle
 * that an event owned by nobody is owned by everybody.
 *
 * An earlier cut of this reused `isSharedEvent` (which is `length !== 1`), so a two- or
 * three-owner event was pushed into every column in the family — the same event reading as
 * five separate personal obligations. That is the opposite of what a per-person column is
 * for: a lane answers "what does this bean have on", not "what is going on today".
 *
 * The app's own form requires at least one owner, so the no-owner branch is a safety net
 * for data that arrives another way (an import, a calendar sync, an older record) rather
 * than something a family can create on purpose.
 *
 * Uses the RAW ids on purpose, unlike `isSharedEvent`: placement asks "is this id on the
 * record", and a stale id cannot make that true for anyone. Resolving first would turn an
 * event whose every id has gone stale into a family-wide one shown in every column, which
 * is a louder failure than the quiet one it has now.
 *
 * Deliberately NOT `matchesAssigneeFilter`: that answers "does the current filter admit
 * this", which is a different question with a different answer.
 */
export function belongsInMemberColumn(
  entity: { assigneeIds?: string[]; assigneeId?: string },
  memberId: string
): boolean {
  const assignees = normalizeAssignees(entity);
  return assignees.length === 0 || assignees.includes(memberId);
}

/**
 * Does this entity match the current member filter?
 *
 * THE convention, in one place: an entity with NO assignees belongs to the whole family,
 * so it always shows. A member filter narrows to people; it does not delete the family's
 * own events.
 *
 * This existed only inside the wall (`matchesWallFilter`), while the planner's day and
 * week timelines hand-rolled `assignees.some(isSelected)` — and `.some()` on an EMPTY
 * array is always false, so filtering to one person silently removed family dinner from
 * the timeline. Every filter now shares this predicate so a fourth copy cannot drift.
 */
export function matchesAssigneeFilter(
  entity: { assigneeIds?: string[]; assigneeId?: string },
  isSelected: (id: string) => boolean
): boolean {
  const assignees = normalizeAssignees(entity);
  if (assignees.length === 0) return true;
  return assignees.some(isSelected);
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
