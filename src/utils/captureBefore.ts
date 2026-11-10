/**
 * The prior values of some fields of a record, as a patch that writes them back: the data
 * half of every Undo ("restore what was there before this write").
 *
 * Shared by calendar drag and drop (`utils/calendar/activityUndo.ts`, which keeps a typed
 * wrapper) and the live flight checks' "Update with airline data" Undo.
 */

/**
 * A detached plain copy, so a later write to the live record (a reactive / CRDT-backed
 * object) cannot change what Undo restores. Captured fields are strings, string arrays and
 * plain objects, so a JSON round trip is exact.
 */
function detach<T>(value: T): T {
  return value !== null && typeof value === 'object'
    ? (JSON.parse(JSON.stringify(value)) as T)
    : value;
}

/**
 * The prior values of `keys` on `record`, as a patch that writes them back. A key the record
 * does not carry is present as an explicit `undefined`, so restoring it CLEARS whatever the
 * write added (a `diffPayload`-style present-`undefined` is a deliberate clear).
 */
export function captureBefore<T extends object>(record: T, keys: readonly (keyof T)[]): Partial<T> {
  const before: Partial<T> = {};
  // eslint-disable-next-line security/detect-object-injection -- keys are typed record fields
  for (const key of keys) before[key] = detach(record[key]);
  return before;
}
