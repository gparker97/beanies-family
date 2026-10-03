/**
 * #117 Phase 2: the three ADJUSTED money fields, made merge-safe with Automerge Counters
 * (plan `docs/plans/2026-10-03-crdt-counters-117-phase-2.md` §A, ADR-039 addendum).
 *
 * Account `balance`, goal `currentAmount` and asset `loan.outstandingBalance` are adjusted, not
 * edited: a transaction moves a balance by a delta. Written as absolutes (`cur + delta`), two
 * devices' -20 and -30 on 100 merge to 80, not 50. So the stored absolute becomes a BASELINE,
 * and each adjustment is an increment on a Counter in the root `counterDeltas` map. Every reader
 * sees `baseline + Σ Counters` (the FOLD); every absolute write from main is converted back by
 * subtracting Σ (the UNFOLD). Main never sees a Counter and never computes a sum.
 *
 * ⚠️ THE FOUR RULES THIS MODULE EXISTS TO HOLD (each pinned in `automergeSemantics.test.ts`):
 *  1. ONE WRITER PER KEY, FOR LIFE. A later increment applies to EVERY conflicting Counter at a
 *     key (probe e'), so two actors creating the same key corrupts it beyond repair. The key
 *     carries the writer (the Automerge actor, fresh on every `load`, probe o), and the map
 *     itself is created by a stored migration change so every device writes into ONE object.
 *  2. INTEGER MINOR UNITS ONLY. `Counter.increment` truncates to an i64 (probe l: -20.5 stores
 *     -20, a later +0.25 is dropped), so every Counter holds `round(amount × COUNTER_SCALE)`.
 *  3. Σ = 0 IS THE IDENTITY. With no keys for an entity, the fold and the unfold pass values
 *     through untouched, so a build with writes off writes byte-for-byte what it wrote before.
 *  4. THE FOLD NEVER THROWS. A malformed or unknown key is skipped and counted: it persists
 *     until compaction, and a throw on read would block the family's whole open.
 *
 * Every Counter-specific algorithm lives here (fold, unfold, write, compaction ledger, rebase
 * growth, stats) so `docOps.ts` and `applyAndProject.ts` only call in, and no other site
 * hand-codes a field name, a key format or the scale.
 *
 * Worker-side: imports Automerge as a value (like `docOps.ts`) and NOTHING from
 * `src/constants/`. Everything except `adjustField` (the one writer) and `foldDoc`/
 * `counterStats` (which read a document through the Automerge API) is pure on plain values.
 */
import * as Automerge from '@automerge/automerge';
import type { CollectionName, FamilyDocument } from '@/types/automerge';
import type { Heads, MutationOp } from './protocol';

type AnyRecord = Record<string, unknown>;
type Doc = Automerge.Doc<FamilyDocument>;

// ─── The switch ──────────────────────────────────────────────────────────────

/**
 * Whether adjustments are WRITTEN as Counters. The READER side (fold, map creation, ledger,
 * projection touch) is always on; only the writer waits behind this.
 *
 * ⚠️ RELEASE ORDER, NEVER COMPRESSED (runbook `docs/runbooks/native-store-submission.md` §7):
 *  1. ship the fold-capable build (this one, `false`) everywhere;
 *  2. raise the update floor (`promptBelowVersion`) to that build;
 *  3. flip this to `true` in the NEXT release, together with the `SNAPSHOT_MANUAL_REV` bump in
 *     `cache.ts` (a pre-fold build's persisted snapshot holds unfolded absolutes only once a
 *     newer build has written Counters, which is after the flip).
 * Never flip in the same release that first ships the fold: a pre-fold build cannot read a
 * Counter, displays balances missing every adjustment written as one, and turns its own
 * "set balance to X" into `X + Σ`. The floor only PROMPTS, so the build that flips must be
 * at least one release after the build that reads.
 *
 * A compile-time constant, not a runtime flag or a Beanie Lab toggle: it is an ordering
 * control. Its only reader is `adjustField`, through module state the test seam below sets.
 */
export const COUNTER_WRITES_ENABLED = false;

let countersOn: boolean = COUNTER_WRITES_ENABLED;

/** Test seam: run `adjustField` with writes on or off. Reset to `COUNTER_WRITES_ENABLED` in an
 *  `afterEach`; module state leaks between tests in one file otherwise. */
export function __setCounterWritesForTesting(on: boolean): void {
  countersOn = on;
}

// ─── The table ───────────────────────────────────────────────────────────────

/**
 * Minor units per major unit: four decimals. Covers every ISO 4217 minor unit and the
 * four-decimal CLF; `2^53 / 10^4 ≈ 9e11` major units of headroom (enough for IDR/KRW-scale
 * balances). Changing it changes the meaning of every Counter already in a pod: never edit.
 */
export const COUNTER_SCALE = 10_000;

/** One adjusted field: the path to its stored absolute (at most two segments) and the
 *  read-time floor (`null` = none; balances may be negative). */
export interface CounterField {
  readonly abs: readonly [string] | readonly [string, string];
  readonly floor: number | null;
}

/**
 * THE table of Counter-backed fields. The only source of field names: keys, folds, unfolds,
 * `increment.field` validation and the rebase all read it. A field is named by its `abs` path
 * joined with `.` (`balance`, `currentAmount`, `loan.outstandingBalance`).
 *
 * The floor is a MERGE BACKSTOP only: the write-time goal floor and the loan clamp still decide
 * at write (on the folded value); two concurrent decrements that each passed their own check
 * can still cross 0 together, and the read floor keeps that from showing as a negative goal.
 */
export const COUNTER_FIELDS = {
  accounts: [{ abs: ['balance'], floor: null }],
  goals: [{ abs: ['currentAmount'], floor: 0 }],
  assets: [{ abs: ['loan', 'outstandingBalance'], floor: 0 }],
} as const satisfies Partial<Record<CollectionName, readonly CounterField[]>>;

/** A collection that holds at least one Counter-backed field. */
export type CounterCollection = keyof typeof COUNTER_FIELDS;

/** `${collection}/${field}` → its table row. Built once from the table, so it cannot drift. */
const FIELD_LOOKUP: ReadonlyMap<string, CounterField> = new Map(
  Object.entries(COUNTER_FIELDS).flatMap(([collection, fields]) =>
    (fields as readonly CounterField[]).map((f) => [`${collection}/${f.abs.join('.')}`, f] as const)
  )
);

/** Whether `collection` has any Counter-backed field (the unfold and fold skip the rest). */
export function isCounterCollection(collection: string): collection is CounterCollection {
  return Object.hasOwn(COUNTER_FIELDS, collection);
}

function lookupField(collection: string, field: string): CounterField | undefined {
  return FIELD_LOOKUP.get(`${collection}/${field}`);
}

/**
 * The table row for an `increment` op's `field`, or a THROW. A numeric field that is not in the
 * table would otherwise silently take the absolute path and lose concurrent adjustments again;
 * failing loudly in the worker reaches main through the RPC error path. Audited callers:
 * `accountsStore.ts` and `transactionRepository.ts`, both `'balance'`.
 */
export function resolveField(collection: string, field: string): CounterField {
  const spec = lookupField(collection, field);
  if (!spec) {
    throw new Error(
      `counterFields: "${field}" is not a Counter field of "${collection}". ` +
        `Add the field to COUNTER_FIELDS in counterFields.ts before adjusting it.`
    );
  }
  return spec;
}

// ─── Scale ───────────────────────────────────────────────────────────────────

/**
 * `amount` in integer minor units, or a THROW. NaN, Infinity and an amount past the safe-integer
 * headroom are programming errors on the write path: a Counter would truncate or wrap them
 * silently, so the worker refuses instead and names the fix. `-0` is normalised to `0`.
 */
export function toMinor(amount: number): number {
  const minor = Math.round(amount * COUNTER_SCALE);
  if (!Number.isSafeInteger(minor)) {
    throw new Error(
      `counterFields: amount ${String(amount)} cannot be held as integer minor units ` +
        `(×${COUNTER_SCALE} is not a safe integer). Fix the caller: a NaN/Infinity reached a ` +
        `money field, or the amount exceeds the Counter headroom.`
    );
  }
  return minor === 0 ? 0 : minor;
}

/** Minor units back to a major-unit number. Integer ÷ 10^4 is correctly rounded, so a value
 *  with at most four decimals round-trips exactly. */
export function fromMinor(minor: number): number {
  return minor / COUNTER_SCALE;
}

/** A stored absolute as a finite number: absent, non-numeric or non-finite reads as 0
 *  (today's `typeof cur === 'number' ? cur : 0`, minus NaN/Infinity, which no fold can add to). */
function finiteOr0(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * `base + minor` in integer minor-unit space, or a float add when `base` is past the
 * safe-integer headroom (`|base| > ~9.0e11`). THE one place a STORED absolute meets the scale:
 * the fold, the dormant write and the unfold all go through it, so none of them can throw on a
 * stored value that today's plain `cur + delta` accepted. Only a DELTA is held to the headroom
 * (`toMinor`), because only a delta becomes a Counter.
 */
function addMinor(base: number, minor: number): number {
  const scaled = Math.round(base * COUNTER_SCALE);
  return Number.isSafeInteger(scaled) ? fromMinor(scaled + minor) : base + fromMinor(minor);
}

/** `value` held at `floor` (`null` = no floor). */
const applyFloor = (value: number, floor: number | null): number =>
  floor === null ? value : Math.max(floor, value);

/**
 * THE fold arithmetic: `abs + minor`, in integer space, then the floor. Shared by `foldEntity`
 * and the goal and loan handlers so the three can never disagree on rounding or the floor.
 *
 * `minor === 0` returns the absolute untouched (no rounding), so a write-time decision on an
 * entity with no keys sees exactly today's number. An absolute past the safe-integer headroom
 * (never a real balance) falls back to a float add rather than throwing: this runs on READ.
 */
export function foldValue(abs: unknown, minor: number, floor: number | null): number {
  const base = finiteOr0(abs);
  return applyFloor(minor === 0 ? base : addMinor(base, minor), floor);
}

// ─── Keys ────────────────────────────────────────────────────────────────────

/** The (entity, field) part of a key: what the fold index is keyed by. */
const entityFieldKey = (collection: string, id: string, field: string): string =>
  `${collection}/${id}/${field}`;

/**
 * The Counter key `${collection}/${id}/${field}/${writerId}`. Throws for a field not in the
 * table, or a field/writer segment that would not parse back (a `/` in it): a key the fold
 * cannot read is an adjustment that silently vanishes. The id may contain `/`; the parser
 * reads the fixed segments from both ends.
 */
export function counterKey(
  collection: string,
  id: string,
  field: string,
  writerId: string
): string {
  resolveField(collection, field);
  if (id === '' || writerId === '' || writerId.includes('/')) {
    throw new Error(
      `counterFields: cannot key ${collection}/${id}/${field} for writer "${writerId}": ` +
        `the id and writer must be non-empty and the writer must not contain "/".`
    );
  }
  return `${entityFieldKey(collection, id, field)}/${writerId}`;
}

/** A key's (collection, id, field), or `null` when it does not parse or names a
 *  (collection, field) this build's table lacks (a future build's field). Never throws. */
export function parseCounterKey(
  key: string
): { collection: CounterCollection; id: string; field: string } | null {
  const parts = key.split('/');
  if (parts.length < 4) return null;
  const collection = parts[0]!;
  const field = parts[parts.length - 2]!;
  const writer = parts[parts.length - 1]!;
  const id = parts.slice(1, -2).join('/');
  if (collection === '' || id === '' || field === '' || writer === '') return null;
  if (!isCounterCollection(collection) || !lookupField(collection, field)) return null;
  return { collection, id, field };
}

/** A Counter's value in minor units, or `null` when it is not a safe integer. Reads a
 *  `Counter`/`WriteableCounter` (document, draft, `toJS`) or a plain number (`toPlain`). */
function counterValue(v: unknown): number | null {
  const n = v instanceof Automerge.Counter ? v.value : v;
  return typeof n === 'number' && Number.isSafeInteger(n) ? n : null;
}

// ─── Fold ────────────────────────────────────────────────────────────────────

/** Σ minor units per (collection, id, field), plus how many keys were skipped as malformed. */
export interface FoldIndex extends ReadonlyMap<string, number> {
  readonly malformed: number;
}

class CounterIndex extends Map<string, number> implements FoldIndex {
  malformed = 0;
}

/** Anything that may carry the Counter map: a committed doc, an unmigrated doc, a draft. */
type CounterSource = { readonly counterDeltas?: Readonly<Record<string, unknown>> | null };

/**
 * One pass over `doc.counterDeltas`: Σ minor units per (collection, id, field). Build it ONCE
 * per materialisation call and hand it to every `foldEntity`/`sigma`.
 *
 * Takes a committed doc, a draft (probe m: a `WriteableCounter`'s value already includes this
 * change's increments) or an UNMIGRATED doc: `decryptToDoc` does not migrate, so the map can be
 * absent (probe o), and that reads as an empty index. An empty or absent map returns without
 * iterating, which is the whole dormant cost: one `Object.keys`.
 *
 * ⚠️ NEVER THROWS. A key that does not parse, names a field this build lacks, or holds a value
 * that is not a safe integer is skipped and counted in `malformed`. The key persists until
 * compaction, so a throw here would block the family's open for a bug only a developer can fix.
 */
export function foldIndex(doc: CounterSource): FoldIndex {
  const index = new CounterIndex();
  const map = doc.counterDeltas;
  if (!map) return index;
  const keys = Object.keys(map);
  if (keys.length === 0) return index;
  for (const key of keys) {
    const parsed = parseCounterKey(key);
    const value = parsed ? counterValue(map[key]) : null;
    if (!parsed || value === null) {
      index.malformed++;
      continue;
    }
    const k = entityFieldKey(parsed.collection, parsed.id, parsed.field);
    index.set(k, (index.get(k) ?? 0) + value);
  }
  return index;
}

/** Σ minor units for one (collection, id, field); `0` when it has no keys. THE lookup. */
export function sigma(index: FoldIndex, collection: string, id: string, field: string): number {
  return index.get(entityFieldKey(collection, id, field)) ?? 0;
}

/** The object holding a field's leaf, or `null` when the parent is absent (an asset with no
 *  `loan`). Paths are at most two segments, so this is two guarded reads, not a deep walk. */
function parentOf(obj: AnyRecord, abs: CounterField['abs']): AnyRecord | null {
  if (abs.length === 1) return obj;
  const p = obj[abs[0]];
  return p !== null && typeof p === 'object' && !Array.isArray(p) ? (p as AnyRecord) : null;
}

const leafOf = (abs: CounterField['abs']): string => abs[abs.length - 1]!;

/**
 * Fold one PLAIN entity in place and return it: each Counter field with Σ ≠ 0 becomes
 * `foldValue(abs, Σ, floor)`. A missing leaf reads as 0 + Σ; a missing PARENT (an asset that
 * stopped being a loan) folds nothing, so stale keys cannot resurface as a phantom payment.
 *
 * ⚠️ MUTATES `plain`: hand it a fresh copy (`toPlain`, `toJS`), never a live document value.
 * `id` is the MAP KEY the entity lives under (what a Counter key and an `increment` op name),
 * passed explicitly rather than read from `plain.id`.
 */
export function foldEntity<T>(collection: string, id: string, plain: T, index: FoldIndex): T {
  if (index.size === 0 || !isCounterCollection(collection)) return plain;
  if (plain === null || typeof plain !== 'object') return plain;
  for (const spec of COUNTER_FIELDS[collection] as readonly CounterField[]) {
    const minor = sigma(index, collection, id, spec.abs.join('.'));
    if (minor === 0) continue;
    const parent = parentOf(plain as AnyRecord, spec.abs);
    if (!parent) continue;
    const leaf = leafOf(spec.abs);
    parent[leaf] = foldValue(parent[leaf], minor, spec.floor);
  }
  return plain;
}

// ─── Unfold (the main → worker write boundary) ───────────────────────────────

/** `obj` with the number at `abs` unfolded by `minor`, as a COPY (and a copied parent), or
 *  `obj` itself when there is no finite number there. */
function unfoldAt(obj: AnyRecord, abs: CounterField['abs'], minor: number): AnyRecord {
  const leaf = leafOf(abs);
  const parent = parentOf(obj, abs);
  const v = parent?.[leaf];
  // Non-finite passes through: nothing can be subtracted from it, and the unfold is a
  // boundary conversion, not a validator.
  if (!parent || typeof v !== 'number' || !Number.isFinite(v)) return obj;
  // `addMinor`, never `toMinor(v)`: `v` is a stored-scale absolute, not a delta, so one past the
  // integer headroom takes the float path instead of throwing on a write today's code accepted.
  const raw = addMinor(v, -minor);
  if (abs.length === 1) return { ...obj, [leaf]: raw };
  return { ...obj, [abs[0]]: { ...parent, [leaf]: raw } };
}

/**
 * Convert a FOLDED `patch` (and its `base`) from main into RAW space: for each Counter field
 * with Σ ≠ 0 that holds a number, `(round(v·S) − Σ) / S`. `fold(raw)` then reads back exactly
 * `v`, an unchanged field stays unchanged (both sides subtract the same Σ, so the reconciler
 * writes nothing), and a Counter that arrived between the caller's read and the write cancels
 * out. `base` may be `undefined`: the `set` case, where only the entity is converted.
 *
 * ⚠️ Σ = 0 IS THE IDENTITY: the value passes through untouched (no rounding), so with writes
 * off, and on every create, seed and rebase `set`, the write is exactly today's.
 *
 * ⚠️ COPIES, NEVER MUTATES. In inline mode the executor hands the worker the caller's own op
 * object, so editing `patch` in place would rewrite main's state. Returns the inputs themselves
 * when nothing changed, and fresh objects (with a copied `loan`) when something did.
 */
export function unfoldPatch<P extends AnyRecord, B extends AnyRecord | undefined>(
  collection: string,
  id: string,
  patch: P,
  base: B,
  index: FoldIndex
): { patch: P; base: B } {
  if (index.size === 0 || !isCounterCollection(collection)) return { patch, base };
  let nextPatch: AnyRecord = patch;
  let nextBase: AnyRecord | undefined = base;
  for (const spec of COUNTER_FIELDS[collection] as readonly CounterField[]) {
    const minor = sigma(index, collection, id, spec.abs.join('.'));
    if (minor === 0) continue;
    nextPatch = unfoldAt(nextPatch, spec.abs, minor);
    if (nextBase !== undefined) nextBase = unfoldAt(nextBase, spec.abs, minor);
  }
  return { patch: nextPatch as P, base: nextBase as B };
}

// ─── Write ───────────────────────────────────────────────────────────────────

/**
 * THE one write primitive for an adjustment, and the ONLY reader of the switch. Called inside
 * a change callback by `increment`, the goal contribution and both loan ops, so the three
 * cannot drift.
 *
 * `delta` becomes integer minor units FIRST, on both paths, so they agree to the last bit:
 *  - writes ON: create the writer's own key if absent, then `increment(minor)`. Throws if the
 *    draft has no `counterDeltas` map: `migrateDoc` did not run, a real programming error.
 *  - writes OFF (dormant): `abs = max(floor, cur + minor)` in integer minor units on the
 *    absolute, never touching the map. A loan op's `newBalance − outstandingBalance` (a float
 *    subtraction of two `round2` values) therefore lands on `newBalance` exactly, where
 *    `cur + delta` could miss it by an ulp. Differs from today's float add only below the fourth
 *    decimal. The field's floor is applied to the WRITTEN value, as today's goal write
 *    (`Math.max(0, current + delta)`) did: with no keys the read floor cannot help, because a
 *    stored negative from pre-Phase-2 history would otherwise be written back below it. A
 *    stored absolute past the integer headroom takes `addMinor`'s float path, never a throw.
 *
 * A zero adjustment writes nothing on either path. Throws when the entity, or the parent of a
 * nested field (an asset's `loan`), is missing: callers check existence and `onMissing` first.
 *
 * `writerId` is `Automerge.getActorId(doc)`: unique per live handle and fresh per `load`, which
 * is what makes every key single-writer (rule 1 in the header).
 *
 * `index`, when given, is `foldIndex(draft)` built BEFORE this write by a handler that reads the
 * draft again afterwards (its echo). A Counter write is recorded in it, so that one index stays
 * exactly what a fresh `foldIndex(draft)` would now return (probe m) and the handler never
 * rebuilds it. It never changes what is written. The dormant path touches no key, so it leaves
 * the index alone.
 */
export function adjustField(
  draft: FamilyDocument,
  collection: CollectionName,
  id: string,
  field: string,
  delta: number,
  writerId: string,
  index?: FoldIndex
): void {
  const spec = resolveField(collection, field);
  const minor = toMinor(delta);
  const entity = (draft[collection] as unknown as Record<string, AnyRecord> | undefined)?.[id];
  if (!entity) {
    throw new Error(
      `counterFields: cannot adjust ${collection}/${id}/${field}: the entity is missing ` +
        `(the caller must check existence and onMissing first).`
    );
  }
  const parent = parentOf(entity, spec.abs);
  if (!parent) {
    throw new Error(
      `counterFields: cannot adjust ${collection}/${id}/${field}: it has no "${spec.abs[0]}".`
    );
  }
  if (minor === 0) return;
  if (countersOn) {
    const map = (draft as { counterDeltas?: Record<string, Automerge.Counter> }).counterDeltas;
    if (!map) {
      throw new Error(
        `counterFields: the document has no counterDeltas map (adjusting ` +
          `${collection}/${id}/${field}). Run migrateDoc on every document before writing.`
      );
    }
    const key = counterKey(collection, id, field, writerId);
    if (map[key] === undefined) map[key] = new Automerge.Counter(0);
    map[key]!.increment(minor);
    if (index) {
      const k = entityFieldKey(collection, id, field);
      (index as CounterIndex).set(k, (index.get(k) ?? 0) + minor);
    }
    return;
  }
  const leaf = leafOf(spec.abs);
  parent[leaf] = applyFloor(addMinor(finiteOr0(parent[leaf]), minor), spec.floor);
}

// ─── Compaction and rebase ───────────────────────────────────────────────────

/** The compaction source: a plain document with every Counter folded, the map empty and the
 *  ledger extended. No `Counter` instance anywhere in it. */
export type FoldedSource = Omit<FamilyDocument, 'counterDeltas' | 'foldedCounters'> & {
  counterDeltas: Record<string, never>;
  foldedCounters?: Record<string, number>;
};

/**
 * The compaction source for `before`: `Automerge.toJS`, every Counter field folded, then
 * `counterDeltas = {}` and the fold ledger EXTENDED with every key removed from the map.
 *
 * ⚠️ THE LEDGER IS CUMULATIVE, NEVER REPLACED. A dirty peer is rebased at ANY generation gap
 * (`podLineage.ts`), so a peer two compactions behind must still find the key folded at the
 * earlier one, or it re-emits that adjustment and counts it twice. Every parseable key is
 * ledgered, including one whose entity is gone or whose `loan` was removed (folded into
 * nothing): the ledger records that the key's value was CONSUMED, so a rebase cannot replay it.
 *
 * ⚠️ THROWS WHEN THE MAP HOLDS A KEY THIS BUILD CANNOT FOLD (unparseable, a field this build's
 * table lacks, a non-integer value). Compaction empties the map, so a key it cannot fold would
 * be destroyed with every adjustment it carries (a future build's Counter field, compacted by a
 * build that predates it). Refusing keeps the old document: `compactDoc` runs this inside its
 * verify `try`, so the throw takes the same "keep the old document, classify, rethrow" path a
 * verify difference takes. The READ side (`foldIndex`) still never throws (rule 4): only the
 * one operation that would make the loss permanent refuses.
 *
 * `foldedCounters` is written only when it holds something, so a dormant pod's compaction
 * source is today's plus the empty map.
 */
export function foldDoc(before: Doc): FoldedSource {
  const index = foldIndex(before);
  if (index.malformed > 0) {
    const offending = Object.entries(before.counterDeltas ?? {}).find(
      ([k, v]) => !parseCounterKey(k) || counterValue(v) === null
    )?.[0];
    throw new Error(
      `counterFields: cannot compact: the Counter map holds ${index.malformed} key(s) this build ` +
        `cannot fold (first: "${String(offending)}"). Compacting would destroy those ` +
        `adjustments. Update the app before compacting.`
    );
  }
  const plain = Automerge.toJS(before) as unknown as AnyRecord;
  if (index.size > 0) {
    for (const collection of Object.keys(COUNTER_FIELDS)) {
      const entities = plain[collection];
      if (entities === null || typeof entities !== 'object') continue;
      for (const [id, entity] of Object.entries(entities as AnyRecord)) {
        foldEntity(collection, id, entity, index);
      }
    }
  }
  const prior = plain.foldedCounters as Record<string, number> | undefined;
  const ledger: Record<string, number> = { ...prior };
  let added = 0;
  for (const [key, v] of Object.entries(before.counterDeltas ?? {})) {
    const value = parseCounterKey(key) ? counterValue(v) : null;
    if (value === null) continue;
    ledger[key] = value;
    added++;
  }
  plain.counterDeltas = {};
  if (added > 0 || prior !== undefined) plain.foldedCounters = ledger;
  return plain as unknown as FoldedSource;
}

/** Anything carrying the map and (optionally) the ledger: a doc or a plain source. */
type GrowthSource = CounterSource & {
  readonly foldedCounters?: Readonly<Record<string, unknown>> | null;
};

/**
 * The rebase's Counter pass: what `local` adjusted that `target` does not yet hold, as one
 * `increment` op per (collection, id, field). Per key, growth = local value − (the target's
 * live key ?? the target's ledger entry ?? 0), in minor units.
 *
 * ONLY KEYS `local` CHANGED SINCE `baselineHeads` ARE CONSIDERED. A key whose value at the
 * baseline equals its value now is skipped: either a FOREIGN writer's key (it reached `local`
 * through a merge the baseline already covers), or an own key with nothing new. Without this,
 * a foreign key whose local copy is STALE (lower than what the compactor folded, because its
 * writer kept adjusting after `local` last merged) would fabricate a negative increment on
 * another device's account: `local − ledger` is the writer's later growth, negated.
 *
 * For a changed key the growth is still measured against the TARGET, never the baseline: the
 * ledger says what any compaction already folded, so a stale baseline cannot double-count an
 * adjustment that reached Drive after it. The live read comes first because a target that
 * never compacted (or was compacted by a pre-fold build, which carries the map through intact)
 * still holds the key. `onMissing: 'skip'` keeps the composer's "the compactor deleted it"
 * rule. Malformed keys are skipped.
 *
 * Pure except for one `Automerge.view` (plain reads on a view are heads-aware, probe f). The
 * caller (`buildRebaseOps`) has already proved `local` holds `baselineHeads`.
 */
export function counterGrowthOps(
  local: Doc,
  target: GrowthSource,
  baselineHeads: Heads
): { ops: MutationOp[]; count: number } {
  const map = local.counterDeltas as Readonly<Record<string, unknown>> | undefined;
  if (!map || Object.keys(map).length === 0) return { ops: [], count: 0 };
  const atBaseline = (Automerge.view(local, baselineHeads) as GrowthSource).counterDeltas;
  const growth = new Map<
    string,
    { collection: CounterCollection; id: string; field: string; minor: number }
  >();
  for (const key of Object.keys(map)) {
    const parsed = parseCounterKey(key);
    const mine = parsed ? counterValue(map[key]) : null;
    if (!parsed || mine === null) continue;
    if (counterValue(atBaseline?.[key]) === mine) continue; // foreign, or nothing new
    const theirs =
      counterValue(target.counterDeltas?.[key]) ?? counterValue(target.foldedCounters?.[key]) ?? 0;
    const g = mine - theirs;
    if (g === 0) continue;
    const k = entityFieldKey(parsed.collection, parsed.id, parsed.field);
    const acc = growth.get(k);
    if (acc) acc.minor += g;
    else growth.set(k, { ...parsed, minor: g });
  }
  const ops: MutationOp[] = [];
  for (const { collection, id, field, minor } of growth.values()) {
    if (minor === 0) continue;
    ops.push({
      op: 'increment',
      collection,
      id,
      field,
      delta: fromMinor(minor),
      onMissing: 'skip',
    });
  }
  return { ops, count: ops.length };
}

// ─── Stats ───────────────────────────────────────────────────────────────────

/** The merge terminus's Counter figures. `conflicts` must be 0 by construction. */
export interface CounterStats {
  /** Keys in the live map (growth between compactions). */
  keys: number;
  /** Keys holding more than one concurrent value: two writers shared a key. A bug. */
  conflicts: number;
  /** Keys the fold skipped (unparseable, unknown field, non-integer value). */
  malformed: number;
  /** Entries in the cumulative fold ledger. */
  ledgerKeys: number;
}

/**
 * One pass over the map: key count, conflicts (`getConflicts` on the nested map, probe n:
 * `undefined` for a single value, one entry per writer otherwise), malformed keys and the ledger
 * size. O(keys), tens at most between compactions; an absent map reports zeros.
 */
export function counterStats(doc: Doc): CounterStats {
  const map = doc.counterDeltas as Record<string, unknown> | undefined;
  const ledgerKeys = Object.keys(doc.foldedCounters ?? {}).length;
  if (!map) return { keys: 0, conflicts: 0, malformed: 0, ledgerKeys };
  const keys = Object.keys(map);
  let conflicts = 0;
  let malformed = 0;
  for (const key of keys) {
    const values = Automerge.getConflicts(map as unknown as Automerge.Doc<AnyRecord>, key);
    if (values && Object.keys(values).length > 1) conflicts++;
    if (!parseCounterKey(key) || counterValue(map[key]) === null) malformed++;
  }
  return { keys: keys.length, conflicts, malformed, ledgerKeys };
}
