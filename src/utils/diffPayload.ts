/**
 * Minimal-diff helper for form payloads.
 *
 * WHY THIS EXISTS: a full "create" payload reused as an "update" payload writes
 * every field, including ones the user never touched. When the user is editing
 * ONE OCCURRENCE of a recurring series, that is how an untouched date field
 * (seeded from the series template) silently moved the occurrence — see
 * `docs/plans/2026-08-15-recurring-occurrence-edit-data-loss.md`.
 *
 * `original` and `next` MUST be the same shape (both form payloads, or both
 * entity slices). This is a field-by-field comparison, not a semantic merge.
 *
 * Conventions — these MUST match `automergeRepository` (see its `stripUndefined`
 * and the `Object.keys`-driven delete list in `update`):
 *  - absent from `next`                → omitted (field left untouched)
 *  - present and equal to original     → omitted
 *  - present and different             → included
 *  - `''` / `null` / `undefined` all count as "absent" for the unchanged check
 *    (so '' → null is no change)
 *  - a change to raw `''` / `undefined`, with a value in `original`
 *                                      → included as `undefined` so the key is
 *                                        DELETED.
 *  - a change to raw `null`            → included as `null`, a real write. `null` is
 *                                        a meaningful value for some fields (e.g.
 *                                        `memberId: null` = family-wide) that readers
 *                                        test with `=== null`; deleting the key would
 *                                        make the item vanish from them.
 *  - arrays compared BY VALUE, element-wise (daysOfWeek, assigneeIds, photoIds); elements
 *    use the same equality, so an array of equal objects reads as unchanged
 *
 * A cleared field is ASSIGNED (`out[k] = undefined`), never omitted — both
 * `automergeRepository.update` (which keys its delete list off `Object.keys`)
 * and the payment-presence checks in `FamilyPlannerPage` (which use `in`)
 * depend on the key being present.
 *
 * COMPLEXITY BUDGET — deliberately ~30 lines. Scalars by `===`, arrays by
 * length + element-wise `isEqual`, anything else by a `JSON.stringify` fallback.
 * No deep-equal dependency, no nested-object semantics, no key-ordering
 * guarantees for objects. Activity and reschedule payloads contain only scalars
 * and flat arrays. If a future payload needs nested-object diffing, that is a
 * design smell in the payload — do not grow this into a general object-diff
 * library. Pinned by an out-of-contract test.
 */

/** Normalise the "no value" spellings to a single one for COMPARISON ONLY, so `''`, `null` and
 *  `undefined` read as the same "absent" state. The emitted value keeps `null` (see header). */
function normalize(value: unknown): unknown {
  return value === '' || value === null ? undefined : value;
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => isEqual(item, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

export function diffPayload<T extends object>(original: T, next: Partial<T>): Partial<T> {
  const out: Record<string, unknown> = {};
  const before = original as Record<string, unknown>;
  for (const key of Object.keys(next)) {
    const raw = (next as Record<string, unknown>)[key];
    const nextValue = normalize(raw);
    const prevValue = normalize(before[key]);
    if (isEqual(nextValue, prevValue)) continue;
    // Assign (never omit) so a clear is a present-but-undefined key; a raw null is written as null.
    out[key] = raw === null ? null : nextValue;
  }
  return out as Partial<T>;
}

/**
 * The payload spelling of an optional free-text field: trimmed, and `undefined` when blank, so
 * a form built with `buildPayload` can represent a CLEAR (the key is present and undefined).
 * Pair with `useFormModal`'s `formDiff`, which keeps untouched blanks out of the write.
 */
export function orUndefined(v: string): string | undefined {
  return v.trim() || undefined;
}
