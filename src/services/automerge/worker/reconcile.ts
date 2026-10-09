/**
 * #117 — the ONE reconciler behind the worker's `patch` and `patchSettings`.
 * Plan: `docs/plans/2026-10-01-crdt-merge-safe-writes.md` §A. ADR-039.
 *
 * WHY IT EXISTS. Automerge only keeps two devices' concurrent edits when each
 * write is fine-grained. Assigning a whole array or object creates a brand-new
 * Automerge object, and at merge only one of the two objects survives, so a
 * tick on one phone and an added item on the other lose one of the two. This
 * module turns "here is the new value of this field" into the smallest set of
 * in-place edits (per-key assignment, `splice` insert/remove, minimal moves)
 * that takes the target there. It is PURE: no Automerge import, so it runs and
 * is tested on plain objects, and runs unchanged on an Automerge draft proxy.
 *
 * THE BASE CONTRACT. Every call is three-way: `target` (what the document holds
 * now), `next` (what the caller wants) and `base` (the snapshot the caller BUILT
 * `next` FROM). Only the caller's own changes (`next` vs `base`) are written;
 * anything the target changed meanwhile (a merged peer edit, a queued write) is
 * left alone. `base === undefined` means "nothing known": the write is additive
 * (it inserts and overwrites, but never deletes or moves anything). The caller
 * chooses `base`; there is no mode flag.
 *
 * THE FOUR LAWS (the whole contract; each is a table in `reconcile.test.ts`,
 * and the seeded random suite asserts all four):
 *  1. If target equals base, the result equals `next` (after dropping duplicate
 *     keys from `next`). Enforced at runtime too: see "verify" below.
 *  2. Every change in `next` relative to `base` is in the result, unless its
 *     item was concurrently removed.
 *  3. Every target value that differs from `base`, and that `next` left equal
 *     to `base`, is untouched.
 *  4. If `next` equals `base`, nothing is written.
 *
 * SHAPES.
 *  - object vs object recurses per key ONLY inside an array element or under a
 *    `MERGE_FIELDS` key. The entity root is the caller's per-key loop. Every
 *    other nested object (`rule`, `dateOfBirth`, `feeSchedule`, ...) is a VALUE
 *    and is written whole when it changed, so a merge can never produce a
 *    half-and-half date or rule.
 *  - array vs array runs the list algorithm (`reconcileList`). Item identity is
 *    `keyOf`: a string `id`, else the `KEY_FIELDS` entry for the field, else
 *    value identity (canonical JSON plus an occurrence suffix).
 *  - anything else (scalar, value object, type change, a missing side) is
 *    written whole when the caller changed it and the target differs.
 *  - `undefined` means delete. A key is deleted only when it is in `base`.
 *
 * VERIFY. When the target equalled `base` on entry, the reconciled value must
 * canonically equal `next` (Law 1). If it does not, the key is whole-assigned
 * (exactly today's behaviour) and a `reconcile_verify_failed` note is returned,
 * so a reconciler bug degrades to the old write and is visible, never silent.
 *
 * INVARIANTS. Never `delete arr[i]` (on a plain array it leaves a hole, on the
 * proxy it removes: the two would diverge), only `splice`. Every value written
 * is a plain JSON copy, never a reference into `next` or the target.
 */

type AnyRecord = Record<string, unknown>;

/** Item identity fields for keyless arrays-of-objects, keyed by field name. */
export const KEY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  votes: ['memberId'],
  dropoffCompletions: ['date'],
  pickupCompletions: ['date'],
  exchangeRates: ['from', 'to'],
  categories: ['categoryId'],
  repeatLog: ['date'],
};

/** Map-like nested objects patched per key. Every other nested object is a value. */
export const MERGE_FIELDS: ReadonlySet<string> = new Set([
  'loan',
  'aiApiKeys',
  'helpfulHintLeadDays',
  'dismissedHintKeys',
]);

/**
 * A finding the caller logs on main (the worker cannot telemeter). Exactly three
 * kinds: `healed_duplicate_keys` (info, the expected result of a concurrent
 * identical insert), `next_duplicate_keys` (warn, a caller sent one key twice)
 * and `reconcile_verify_failed` (warn, Law 1 failed and the key was
 * whole-assigned). `kind` is the top-level field the note arose under.
 */
export interface ReconcileNote {
  action: 'healed_duplicate_keys' | 'next_duplicate_keys' | 'reconcile_verify_failed';
  kind?: string;
  count: number;
}

/** Accumulators threaded through one op. `writes` decides the `updatedAt` stamp. */
export interface ReconcileContext {
  writes: number;
  notes: ReconcileNote[];
}

interface Scope {
  /** The field name used for `KEY_FIELDS` / `MERGE_FIELDS` lookups. */
  field: string;
  /** May an object-vs-object pair recurse per key here? */
  mergeable: boolean;
  /** The top-level field, for notes. */
  kind: string;
  ctx: ReconcileContext;
}

type Reconcile = (
  parent: AnyRecord,
  key: string | number,
  next: unknown,
  base: unknown,
  scope: Scope
) => void;

// ─── Equality and copies ─────────────────────────────────────────────────────

function sortKeys(_key: string, value: unknown): unknown {
  if (!isMap(value)) return value;
  const sorted: AnyRecord = {};
  for (const k of Object.keys(value).sort()) sorted[k] = value[k];
  return sorted;
}

/** Sorted-key JSON. `undefined` stays `undefined`; undefined-valued keys drop out. */
function canonicalJson(value: unknown): string | undefined {
  return JSON.stringify(value, sortKeys);
}

/** The worker's one equality: canonical (sorted-key) JSON, so key order never counts. */
export function canonicalEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** A plain JSON copy. JSON, not `structuredClone`: an Automerge proxy cannot be cloned. */
function copy<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function isMap(value: unknown): value is AnyRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// ─── Identity ────────────────────────────────────────────────────────────────

/**
 * An item's key within the array stored at `field`. Total: an `id:` key for a
 * string `id`, a `k:` key when every `KEY_FIELDS` field is a string, otherwise a
 * `v:` value key (canonical JSON + `#occurrence`, counted in `occurrences`), so
 * repeated primitives such as `['salt', 'salt']` are two distinct items.
 */
function keyOf(field: string, item: unknown, occurrences: Map<string, number>): string {
  if (isMap(item)) {
    if (typeof item.id === 'string') return `id:${item.id}`;
    const parts = KEY_FIELDS[field]?.map((f) => item[f]);
    if (parts && parts.every((p) => typeof p === 'string')) return `k:${JSON.stringify(parts)}`;
  }
  const value = `v:${canonicalJson(item)}`;
  const seen = occurrences.get(value) ?? 0;
  occurrences.set(value, seen + 1);
  return `${value}#${seen}`;
}

function keysOf(field: string, items: readonly unknown[]): string[] {
  const occurrences = new Map<string, number>();
  return items.map((item) => keyOf(field, item, occurrences));
}

/** Key → index of its FIRST occurrence. */
function firstIndex(keys: readonly string[]): Map<string, number> {
  const index = new Map<string, number>();
  keys.forEach((k, i) => {
    if (!index.has(k)) index.set(k, i);
  });
  return index;
}

/** Keys that occur more than once. */
function duplicated(keys: readonly string[]): Set<string> {
  const first = firstIndex(keys);
  return new Set(keys.filter((k, i) => first.get(k) !== i));
}

// ─── Notes ───────────────────────────────────────────────────────────────────

function note(scope: Scope, action: ReconcileNote['action'], count: number): void {
  const same = scope.ctx.notes.find((n) => n.action === action && n.kind === scope.kind);
  if (same) same.count += count;
  else scope.ctx.notes.push({ action, kind: scope.kind, count });
}

function childScope(scope: Scope, field: string): Scope {
  return { ...scope, field, mergeable: MERGE_FIELDS.has(field) };
}

// ─── Normalising `next` ──────────────────────────────────────────────────────

/**
 * `next` with every repeated array key reduced to its first occurrence, walking
 * exactly where the reconciler recurses (value objects are left as they are).
 * A repeat that `base` also repeats is a documented semantic-key duplicate the
 * caller merely passed through, not a caller bug: it is dropped without a note,
 * and the target heal reports it. Undefined array elements become `null`, as JSON
 * would make them.
 */
function normalise(next: unknown, base: unknown, scope: Scope): unknown {
  if (Array.isArray(next))
    return normaliseList(next, Array.isArray(base) ? base : undefined, scope);
  if (!scope.mergeable || !isMap(next)) return next;
  const baseMap = isMap(base) ? base : undefined;
  const out: AnyRecord = {};
  for (const [k, v] of Object.entries(next))
    out[k] = normalise(v, baseMap?.[k], childScope(scope, k));
  return out;
}

function normaliseList(next: unknown[], base: unknown[] | undefined, scope: Scope): unknown[] {
  const items = next.map((v) => (v === undefined ? null : v));
  const baseKeys = base ? keysOf(scope.field, base) : [];
  const baseIndex = firstIndex(baseKeys);
  const baseRepeats = duplicated(baseKeys);
  const elementScope = { ...scope, mergeable: true };
  const seen = new Set<string>();
  const out: unknown[] = [];
  let dropped = 0;
  keysOf(scope.field, items).forEach((k, i) => {
    if (seen.has(k)) {
      if (!baseRepeats.has(k)) dropped++;
      return;
    }
    seen.add(k);
    out.push(normalise(items[i], base?.[baseIndex.get(k) ?? -1], elementScope));
  });
  if (dropped > 0) note(scope, 'next_duplicate_keys', dropped);
  return out;
}

// ─── The reconciler ──────────────────────────────────────────────────────────

/** Dispatch on shape. See the module header for the table. */
const reconcileValue: Reconcile = (parent, key, next, base, scope) => {
  if (next === undefined) return removeKey(parent, key, base, scope.ctx);
  if (base !== undefined && canonicalEqual(next, base)) return; // Law 4
  const target = parent[key];
  if (Array.isArray(next) && Array.isArray(target)) {
    return reconcileList(target, next, Array.isArray(base) ? base : undefined, scope);
  }
  if (scope.mergeable && isMap(next) && isMap(target)) {
    return reconcileMap(target, next, isMap(base) ? base : undefined, scope);
  }
  if (canonicalEqual(next, target)) return;
  parent[key] = copy(next);
  scope.ctx.writes++;
};

/** Delete only what the caller knew about: a key absent from `base` is never deleted. */
function removeKey(
  parent: AnyRecord,
  key: string | number,
  base: unknown,
  ctx: ReconcileContext
): void {
  if (base === undefined || parent[key] === undefined) return;
  delete parent[key];
  ctx.writes++;
}

function reconcileMap(
  target: AnyRecord,
  next: AnyRecord,
  base: AnyRecord | undefined,
  scope: Scope
): void {
  for (const k of Object.keys(next))
    reconcileValue(target, k, next[k], base?.[k], childScope(scope, k));
  if (!base) return;
  for (const k of Object.keys(base)) {
    if (!(k in next)) removeKey(target, k, base[k], scope.ctx);
  }
}

/**
 * The list algorithm, one ordered pass:
 *  1. heal duplicate keys in the target (first occurrence wins);
 *  2. splice out target items the caller removed (in `base`, not in `next`);
 *  3. walk `next` in order. A present item recurses with its base item; a new
 *     item is inserted after the nearest preceding `next` item present in the
 *     target (or at the front); a caller move (off the LIS of base positions)
 *     is moved the same way. Concurrent inserts keep their place; items the
 *     target removed concurrently are not resurrected.
 */
function reconcileList(
  target: unknown[],
  next: unknown[],
  base: unknown[] | undefined,
  scope: Scope
): void {
  const tKeys = healTarget(target, scope);
  const nKeys = keysOf(scope.field, next);
  const baseIndex = base ? firstIndex(keysOf(scope.field, base)) : undefined;
  if (baseIndex) removeDropped(target, tKeys, baseIndex, new Set(nKeys), scope.ctx);
  const moves = plannedMoves(nKeys, baseIndex, new Set(tKeys));
  const elementScope = { ...scope, mergeable: true };
  const slots = target as unknown as AnyRecord;
  let cursor = -1;
  nKeys.forEach((k, i) => {
    const at = tKeys.indexOf(k);
    if (at === -1 && baseIndex?.has(k)) return; // removed concurrently: not resurrected
    if (at === -1) {
      cursor = insertAt(target, tKeys, cursor + 1, k, next[i], scope.ctx);
      return;
    }
    cursor = moves.has(k) ? moveAfter(target, tKeys, at, cursor, scope.ctx) : at;
    reconcileValue(slots, cursor, next[i], base?.[baseIndex?.get(k) ?? -1], elementScope);
  });
}

/** Splice out repeated keys (a concurrent identical insert); returns the target's keys. */
function healTarget(target: unknown[], scope: Scope): string[] {
  const keys = keysOf(scope.field, target);
  const first = firstIndex(keys);
  let healed = 0;
  for (let i = keys.length - 1; i >= 0; i--) {
    if (first.get(keys[i]!) === i) continue;
    target.splice(i, 1);
    keys.splice(i, 1);
    healed++;
  }
  if (healed > 0) {
    note(scope, 'healed_duplicate_keys', healed);
    scope.ctx.writes += healed;
  }
  return keys;
}

function removeDropped(
  target: unknown[],
  tKeys: string[],
  baseIndex: Map<string, number>,
  nextKeys: Set<string>,
  ctx: ReconcileContext
): void {
  for (let i = tKeys.length - 1; i >= 0; i--) {
    const k = tKeys[i]!;
    if (!baseIndex.has(k) || nextKeys.has(k)) continue;
    target.splice(i, 1);
    tKeys.splice(i, 1);
    ctx.writes++;
  }
}

/**
 * The caller's moves: items in base, next and target whose base positions (in
 * `next` order) fall off the longest increasing subsequence. Minimal, so only
 * the item the user actually dragged is moved. No base, no caller order: none.
 */
function plannedMoves(
  nKeys: readonly string[],
  baseIndex: Map<string, number> | undefined,
  inTarget: Set<string>
): Set<string> {
  if (!baseIndex) return new Set();
  const present = nKeys.filter((k) => baseIndex.has(k) && inTarget.has(k));
  const keep = lisMembers(present.map((k) => baseIndex.get(k)!));
  return new Set(present.filter((_, i) => !keep.has(i)));
}

/** Indices of one longest strictly increasing subsequence of `seq` (O(n log n)). */
function lisMembers(seq: readonly number[]): Set<number> {
  const tails: number[] = [];
  const prev: number[] = new Array<number>(seq.length).fill(-1);
  seq.forEach((value, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]!]! < value) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1]!;
    tails[lo] = i;
  });
  const keep = new Set<number>();
  for (let i = tails.at(-1) ?? -1; i !== -1; i = prev[i]!) keep.add(i);
  return keep;
}

function insertAt(
  target: unknown[],
  tKeys: string[],
  at: number,
  key: string,
  value: unknown,
  ctx: ReconcileContext
): number {
  target.splice(at, 0, copy(value));
  tKeys.splice(at, 0, key);
  ctx.writes++;
  return at;
}

/** Move the item at `from` to just after `cursor` (a copy, then splice). Returns its index. */
function moveAfter(
  target: unknown[],
  tKeys: string[],
  from: number,
  cursor: number,
  ctx: ReconcileContext
): number {
  if (from === cursor + 1) return from;
  const item = copy(target[from]);
  const [key] = tKeys.splice(from, 1);
  target.splice(from, 1);
  const to = from < cursor ? cursor : cursor + 1;
  return insertAt(target, tKeys, to, key!, item, ctx);
}

// ─── Entry points ────────────────────────────────────────────────────────────

function reconcileWith(
  inner: Reconcile,
  parent: AnyRecord,
  key: string,
  next: unknown,
  base: unknown,
  ctx: ReconcileContext
): void {
  const scope: Scope = { field: key, mergeable: MERGE_FIELDS.has(key), kind: key, ctx };
  const targetWasBase = canonicalEqual(parent[key], base);
  const clean = normalise(next, base, scope);
  inner(parent, key, clean, base, scope);
  if (!targetWasBase || canonicalEqual(parent[key], clean)) return;
  // Law 1 failed: fall back to today's whole write, visibly.
  if (clean === undefined) delete parent[key];
  else parent[key] = copy(clean);
  ctx.writes++;
  note(scope, 'reconcile_verify_failed', 1);
}

/**
 * Reconcile `parent[key]` towards `next`, given the `base` the caller built
 * `next` from (`undefined` = additive). Called once per top-level key of a
 * `patch` / `patchSettings`. Counts writes and pushes notes into `ctx`.
 */
export function reconcileInto(
  parent: AnyRecord,
  key: string,
  next: unknown,
  base: unknown,
  ctx: ReconcileContext
): void {
  reconcileWith(reconcileValue, parent, key, next, base, ctx);
}

/**
 * Append `value` to the array at `entity[field]` unless an equal element is
 * already there (canonical equality). Creates the array when it is missing.
 * Returns whether it wrote. Used by the photo attach, where a repeat of the same
 * id is only ever a retry and must be a no-op.
 */
export function appendUnique(entity: AnyRecord, field: string, value: unknown): boolean {
  const list = entity[field];
  if (!Array.isArray(list)) {
    entity[field] = [copy(value)];
    return true;
  }
  if (list.some((item) => canonicalEqual(item, value))) return false;
  list.push(copy(value));
  return true;
}

/**
 * TEST-ONLY: `reconcileInto` with a substitute inner reconcile, so a test can
 * inject a faulty one and prove the Law-1 verify falls back to a whole write.
 */
export function __reconcileIntoWithForTesting(
  inner: (parent: AnyRecord, key: string | number, next: unknown, base: unknown) => void
): typeof reconcileInto {
  return (parent, key, next, base, ctx) => reconcileWith(inner, parent, key, next, base, ctx);
}
