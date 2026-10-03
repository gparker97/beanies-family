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
 *     key (probe e'), so two actors creating the same key corrupts it beyond repair. The key's
 *     writer segment is `${deviceWriterId}:${actorId}`: the Automerge actor (fresh on every
 *     `load`, probe o) makes it single-writer, and the device id (minted once per family cache,
 *     `cache.ts`) says WHICH DEVICE owns it, which is how the rebase tells its own keys from a
 *     peer's. The map itself is created by a stored migration change so every device writes into
 *     ONE object.
 *  2. INTEGER MINOR UNITS, AT THE KEY'S OWN DECIMALS. `Counter.increment` truncates to an i64
 *     (probe l: -20.5 stores -20, a later +0.25 is dropped), so every Counter holds
 *     `round(amount × 10^d)`, where `d` is the entity's currency minor unit at the time of the
 *     write (`decimalsFor`, clamped to [2, 8]), and `d` is WRITTEN INTO THE KEY. A reader never
 *     guesses a scale: a key says what its integer means, so a currency change, or a future
 *     build with a different table, cannot reinterpret a Counter already in a pod.
 *  3. Σ = 0 IS THE IDENTITY. With no keys for an entity, the fold and the unfold pass values
 *     through untouched, so a build with writes off writes byte-for-byte what it wrote before.
 *  4. THE FOLD NEVER THROWS. A malformed or unknown key is skipped and counted: it persists
 *     until compaction, and a throw on read would block the family's whole open.
 *
 * Every Counter-specific algorithm lives here (fold, unfold, write, compaction ledger, rebase
 * growth, stats) so `docOps.ts` and `applyAndProject.ts` only call in, and no other site
 * hand-codes a field name, a key format or a scale.
 *
 * Worker-side: imports Automerge as a value (like `docOps.ts`). Its one `src/constants/` import
 * is `currencies.ts`, which is pure data (a type-only import of its own), so nothing main-only
 * reaches the worker. Everything except `adjustField` (the one writer) and `foldDoc`/
 * `counterStats` (which read a document through the Automerge API) is pure on plain values.
 */
import * as Automerge from '@automerge/automerge';
import { CURRENCIES } from '@/constants/currencies';
import type { CollectionName, FamilyDocument, COUNTER_COLLECTION_NAMES } from '@/types/automerge';
import { StaleBuildCounterError } from '@/types/sync';
import type { MutationOp } from './protocol';

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

/** One adjusted field: the path to its stored absolute (at most two segments), the read-time
 *  floor (`null` = none; balances may be negative), and the path to the ENTITY's currency
 *  code, which sets the scale its Counters are written and folded at (`decimalsFor`). */
export interface CounterField {
  readonly abs: readonly [string] | readonly [string, string];
  readonly floor: number | null;
  readonly currency: readonly [string];
}

/**
 * THE table of Counter-backed fields. The only source of field names: keys, folds, unfolds,
 * `increment.field` validation and the rebase all read it. A field is named by its `abs` path
 * joined with `.` (`balance`, `currentAmount`, `loan.outstandingBalance`).
 *
 * The floor is a MERGE BACKSTOP only: the write-time goal floor and the loan clamp still decide
 * at write (on the folded value); two concurrent decrements that each passed their own check
 * can still cross 0 together, and the read floor keeps that from showing as a negative goal.
 *
 * `currency` is the entity's own `currency` on all three (`Account`, `Goal`, `Asset`; an asset's
 * `loan` carries none of its own), checked against the model types in `counterFields.test.ts`.
 */
export const COUNTER_FIELDS = {
  accounts: [{ abs: ['balance'], floor: null, currency: ['currency'] }],
  goals: [{ abs: ['currentAmount'], floor: 0, currency: ['currency'] }],
  assets: [{ abs: ['loan', 'outstandingBalance'], floor: 0, currency: ['currency'] }],
  // Exactly the collections `COUNTER_COLLECTION_NAMES` lists (both directions: a missing key and
  // an extra key are compile errors), so the pure list `photoOps` reads cannot drift from this.
} as const satisfies Record<(typeof COUNTER_COLLECTION_NAMES)[number], readonly CounterField[]>;

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

// ─── Scale: the entity's currency minor unit ─────────────────────────────────

/** The narrowest and widest scale a Counter is WRITTEN at. Two decimals is the floor so a
 *  0-decimal currency (JPY, KRW) still holds a cent of float noise rather than rounding it into
 *  a whole unit; eight is the widest minor unit in `CURRENCIES` (BTC, ETH, SOL, DOGE). The
 *  headroom is `2^53 / 10^d` major units: ~9e13 at two decimals, ~9e7 at eight. */
export const MIN_COUNTER_DECIMALS = 2;
export const MAX_COUNTER_DECIMALS = 8;

const CURRENCY_DECIMALS: ReadonlyMap<string, number> = new Map(
  CURRENCIES.map((c) => [c.code, c.decimals] as const)
);

/**
 * The scale (decimal places) a currency's Counters are written at: its `CURRENCIES` minor unit,
 * clamped to [`MIN_COUNTER_DECIMALS`, `MAX_COUNTER_DECIMALS`]. An unknown or absent code reads
 * as the minimum, so an entity with no currency (a fixture, a legacy row) still has a scale.
 * Pure; it decides only how a NEW write is keyed. An existing key is read at the decimals it
 * carries, never at this.
 */
export function decimalsFor(code: unknown): number {
  const d = typeof code === 'string' ? CURRENCY_DECIMALS.get(code) : undefined;
  return Math.min(MAX_COUNTER_DECIMALS, Math.max(MIN_COUNTER_DECIMALS, d ?? MIN_COUNTER_DECIMALS));
}

/**
 * The decimals for `spec`'s field, from the first source that carries a currency code at
 * `spec.currency`: a patch that changes the currency first, then the stored entity. With none,
 * `decimalsFor(undefined)`.
 */
export function fieldDecimals(spec: CounterField, ...sources: unknown[]): number {
  for (const source of sources) {
    if (source === null || typeof source !== 'object') continue;
    const code = (source as AnyRecord)[spec.currency[0]];
    if (typeof code === 'string') return decimalsFor(code);
  }
  return decimalsFor(undefined);
}

const scaleOf = (decimals: number): number => 10 ** decimals;

/**
 * `delta` in integer minor units at `decimals`, or a THROW. NaN, Infinity and a delta past the
 * safe-integer headroom are programming errors on the write path: a Counter would truncate or
 * wrap them silently, so the worker refuses instead and names the fix. Only a DELTA is held to
 * this (only a delta becomes a Counter); a stored absolute never throws. `-0` is normalised.
 */
export function toMinor(delta: number, decimals: number): number {
  const minor = roundHalfAway(delta * scaleOf(decimals));
  if (!Number.isSafeInteger(minor)) {
    throw new Error(
      `counterFields: amount ${String(delta)} cannot be held as integer minor units at ` +
        `${decimals} decimals (×10^${decimals} is not a safe integer). Fix the caller: a ` +
        `NaN/Infinity reached a money field, or the amount exceeds the Counter headroom.`
    );
  }
  return minor === 0 ? 0 : minor;
}

/** Minor units at `decimals` back to a major-unit number. Integer ÷ 10^d is correctly rounded,
 *  so a value with at most `d` decimals round-trips exactly. */
export function fromMinor(minor: number, decimals: number): number {
  return minor / scaleOf(decimals);
}

/**
 * `value` rounded to `decimals` places through integer space (`round(v · 10^d) / 10^d`), or
 * `value` itself when the scaled value is past the safe-integer headroom (never a real balance
 * at its own currency's scale). THE one rounding rule the fold, the unfold and the dormant write
 * share; it runs on stored absolutes, so it never throws.
 */
export function roundTo(value: number, decimals: number): number {
  const scaled = roundHalfAway(value * scaleOf(decimals));
  if (!Number.isSafeInteger(scaled)) return value;
  return scaled === 0 ? 0 : scaled / scaleOf(decimals);
}

/**
 * Round to the nearest integer, HALF AWAY FROM ZERO (C9h, data-layer audit 2026-10-03).
 * `Math.round` rounds half towards +∞, so a -2.5 withdrawal became -2 minor units while a +2.5
 * deposit became +3: the two directions of the same money disagreed by a minor unit.
 */
function roundHalfAway(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/**
 * The rebase's carry for a Counter-backed ABSOLUTE that both the peer and the target moved
 * (C9g): the peer's raw change applied as a SHIFT, `t + (b − a)`, rounded at the entity's
 * scale. A compaction folds Counters into the absolute, so the target's absolute moves even
 * when nobody edited it; a three-way "both changed" conflict there dropped the peer's offline
 * "set balance to X" for good.
 */
export function shiftAbsolute(t: number, a: number, b: number, decimals: number): number {
  return roundTo(t + (b - a), decimals);
}

/** A stored absolute as a finite number: absent, non-numeric or non-finite reads as 0
 *  (today's `typeof cur === 'number' ? cur : 0`, minus NaN/Infinity, which no fold can add to). */
function finiteOr0(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** `value` held at `floor` (`null` = no floor). */
const applyFloor = (value: number, floor: number | null): number =>
  floor === null ? value : Math.max(floor, value);

/**
 * THE fold arithmetic: `round((abs + Σ) · 10^d) / 10^d`, then the floor. `sumMajor` is Σ in
 * MAJOR units (`sigma`); `decimals` is the ENTITY's current scale (`fieldDecimals`), so a value
 * the user entered with at most `d` decimals reads back exactly. Shared by `foldEntity` and the
 * goal and loan handlers so the three can never disagree on rounding or the floor.
 *
 * `sumMajor === 0` returns the absolute untouched (no rounding), so a write-time decision on an
 * entity with no keys sees exactly today's number.
 */
export function foldValue(
  abs: unknown,
  sumMajor: number,
  floor: number | null,
  decimals: number
): number {
  const base = finiteOr0(abs);
  return applyFloor(sumMajor === 0 ? base : roundTo(base + sumMajor, decimals), floor);
}

// ─── Keys ────────────────────────────────────────────────────────────────────

/** The (entity, field) part of a key: what the fold index is keyed by. */
const entityFieldKey = (collection: string, id: string, field: string): string =>
  `${collection}/${id}/${field}`;

/**
 * The Counter key `${collection}/${id}/${field}@${decimals}/${writer}`, where `writer` is
 * `${deviceWriterId}:${actorId}` (`docActor.counterWriterId`). Throws for a field not in the
 * table, a writer that would not parse back (empty, or a `/` in it), or a scale outside
 * [`MIN_COUNTER_DECIMALS`, `MAX_COUNTER_DECIMALS`]: a key the fold cannot read is an adjustment
 * that silently vanishes. The id may contain `/`; the parser reads the fixed segments from both
 * ends.
 */
export function counterKey(
  collection: string,
  id: string,
  field: string,
  decimals: number,
  writerId: string
): string {
  resolveField(collection, field);
  if (id === '' || writerId === '' || writerId.includes('/')) {
    throw new Error(
      `counterFields: cannot key ${collection}/${id}/${field} for writer "${writerId}": ` +
        `the id and writer must be non-empty and the writer must not contain "/".`
    );
  }
  if (
    !Number.isInteger(decimals) ||
    decimals < MIN_COUNTER_DECIMALS ||
    decimals > MAX_COUNTER_DECIMALS
  ) {
    throw new Error(
      `counterFields: cannot key ${collection}/${id}/${field} at ${String(decimals)} decimals ` +
        `(must be an integer in [${MIN_COUNTER_DECIMALS}, ${MAX_COUNTER_DECIMALS}]).`
    );
  }
  return `${entityFieldKey(collection, id, field)}@${decimals}/${writerId}`;
}

/** A key's segments, structurally: no table check. */
interface KeyParts {
  collection: string;
  id: string;
  field: string;
  decimals: number;
  writer: string;
}

/** Split a key into its segments, or `null` when it is not `c/id/field@d/writer`. The writer
 *  may contain `:` (it always does); only `/` separates segments. */
function splitCounterKey(key: string): KeyParts | null {
  const parts = key.split('/');
  if (parts.length < 4) return null;
  const collection = parts[0]!;
  const scaled = parts[parts.length - 2]!;
  const writer = parts[parts.length - 1]!;
  const id = parts.slice(1, -2).join('/');
  const at = scaled.lastIndexOf('@');
  if (at < 0) return null;
  const field = scaled.slice(0, at);
  const digits = scaled.slice(at + 1);
  if (collection === '' || id === '' || field === '' || writer === '') return null;
  if (!/^\d{1,2}$/.test(digits)) return null;
  return { collection, id, field, decimals: Number(digits), writer };
}

/** A key this build can fold. */
export interface ParsedCounterKey {
  collection: CounterCollection;
  id: string;
  field: string;
  /** The scale its Counter's integer is at (minor units per major = 10^decimals). */
  decimals: number;
  /** `${deviceWriterId}:${actorId}` for every key this build writes. */
  writer: string;
}

/** A key's segments, or `null` when it does not parse or names a (collection, field) this
 *  build's table lacks (a future build's field). Never throws. */
export function parseCounterKey(key: string): ParsedCounterKey | null {
  const parts = splitCounterKey(key);
  if (!parts || !isCounterCollection(parts.collection)) return null;
  if (!lookupField(parts.collection, parts.field)) return null;
  return parts as ParsedCounterKey;
}

/** A Counter's value in minor units, or `null` when it is not a safe integer. Reads a
 *  `Counter`/`WriteableCounter` (document, draft, `toJS`) or a plain number (`toPlain`). */
function counterValue(v: unknown): number | null {
  const n = v instanceof Automerge.Counter ? v.value : v;
  return typeof n === 'number' && Number.isSafeInteger(n) ? n : null;
}

// ─── Fold ────────────────────────────────────────────────────────────────────

/** What a diagnostic may name about a key: its collection and field, never the entity id or
 *  the writer (both reach the firehose unmasked through an error message). */
export interface CounterKeyLabel {
  readonly collection: string;
  readonly field: string;
}

/** One (collection, id, field) and its integer sums, one per scale its keys carry. */
interface FieldSums {
  readonly collection: CounterCollection;
  readonly id: string;
  readonly field: string;
  readonly minorByDecimals: Map<number, number>;
}

/** The read-only view of a fold index every reader takes. */
export interface FoldIndex {
  /** (collection, id, field) entries with at least one key. */
  readonly size: number;
  /** Keys the fold skipped: unparseable, an unknown collection or field, a non-integer value. */
  readonly malformed: number;
  /** The first skipped key that does not split into `c/id/field@d/writer`, or that holds a
   *  value no build can read: dropped by a compaction, because nothing can ever read it. */
  readonly firstMalformed: CounterKeyLabel | null;
  /** The first STRUCTURALLY VALID key whose collection OR field this build's table lacks: a
   *  newer build's Counter, which a compaction must refuse to destroy (`foldDoc`, C9e). */
  readonly unknownField: CounterKeyLabel | null;
  /** Σ for one (collection, id, field) in MAJOR units; 0 when it has no keys. */
  major(collection: string, id: string, field: string): number;
}

/**
 * The fold index: Σ per (collection, id, field), held as EXACT integer sums per scale and
 * converted to major units only on read (each group `/ 10^d`, then added). Mutable only through
 * `add`, which `foldIndex` and `adjustField` call; everyone else reads it as a `FoldIndex`.
 */
export class CounterIndex implements FoldIndex {
  private readonly sums = new Map<string, FieldSums>();
  malformed = 0;
  firstMalformed: CounterKeyLabel | null = null;
  unknownField: CounterKeyLabel | null = null;

  get size(): number {
    return this.sums.size;
  }

  /** Record `minor` integer units at `decimals` against (collection, id, field). */
  add(collection: CounterCollection, id: string, field: string, decimals: number, minor: number) {
    const k = entityFieldKey(collection, id, field);
    let entry = this.sums.get(k);
    if (!entry) {
      entry = { collection, id, field, minorByDecimals: new Map() };
      this.sums.set(k, entry);
    }
    entry.minorByDecimals.set(decimals, (entry.minorByDecimals.get(decimals) ?? 0) + minor);
  }

  major(collection: string, id: string, field: string): number {
    const entry = this.sums.get(entityFieldKey(collection, id, field));
    return entry ? majorOf(entry) : 0;
  }

  /** Every (collection, id, field) with its Σ in major units, in insertion order. */
  *fields(): IterableIterator<{
    collection: CounterCollection;
    id: string;
    field: string;
    major: number;
  }> {
    for (const entry of this.sums.values()) {
      yield {
        collection: entry.collection,
        id: entry.id,
        field: entry.field,
        major: majorOf(entry),
      };
    }
  }
}

/** One entry's Σ in major units: each scale's exact integer sum ÷ 10^d, then added. A single
 *  scale (the normal case) is therefore exact; a group summing to 0 adds nothing. */
function majorOf(entry: FieldSums): number {
  let total = 0;
  for (const [decimals, minor] of entry.minorByDecimals) {
    if (minor !== 0) total += fromMinor(minor, decimals);
  }
  return total;
}

/** Anything that may carry the Counter map: a committed doc, an unmigrated doc, a draft. */
type CounterSource = { readonly counterDeltas?: Readonly<Record<string, unknown>> | null };

/** A key's diagnostic label: its collection and field when it splits, else neither. */
const labelOf = (parts: KeyParts | null): CounterKeyLabel =>
  parts
    ? { collection: parts.collection, field: parts.field }
    : { collection: '(unparseable)', field: '(unparseable)' };

/**
 * One pass over `doc.counterDeltas`: Σ per (collection, id, field). Build it ONCE per
 * materialisation call and hand it to every `foldEntity`/`sigma`.
 *
 * Takes a committed doc, a draft (probe m: a `WriteableCounter`'s value already includes this
 * change's increments) or an UNMIGRATED doc: `decryptToDoc` does not migrate, so the map can be
 * absent (probe o), and that reads as an empty index. An empty or absent map returns without
 * iterating, which is the whole dormant cost: one `Object.keys`.
 *
 * ⚠️ NEVER THROWS, AND THE ONE CLASSIFIER OF A BAD KEY. A key that does not parse, names a
 * collection or field this build lacks, or holds a value that is not a safe integer is skipped
 * and counted in `malformed`; the first known-collection/unknown-field key is recorded as
 * `unknownField` (a newer build's field) and the first of the rest as `firstMalformed`.
 * `foldDoc` and `counterStats` read those, never re-derive them. The key persists until
 * compaction, so a throw here would block the family's open for a bug only a developer can fix.
 */
export function foldIndex(doc: CounterSource): CounterIndex {
  const index = new CounterIndex();
  const map = doc.counterDeltas;
  if (!map) return index;
  const keys = Object.keys(map);
  if (keys.length === 0) return index;
  for (const key of keys) {
    const parts = splitCounterKey(key);
    // C9e: a key that SPLITS but names a collection or a field this build does not know is a
    // newer build's Counter, never garbage, whichever of the two it is.
    if (
      parts !== null &&
      (!isCounterCollection(parts.collection) || !lookupField(parts.collection, parts.field))
    ) {
      index.malformed++;
      index.unknownField ??= labelOf(parts);
      continue;
    }
    const value = parts !== null ? counterValue(map[key]) : null;
    if (parts === null || value === null) {
      index.malformed++;
      index.firstMalformed ??= labelOf(parts);
      continue;
    }
    index.add(parts.collection as CounterCollection, parts.id, parts.field, parts.decimals, value);
  }
  return index;
}

/** Σ in MAJOR units for one (collection, id, field); `0` when it has no keys. THE lookup. */
export function sigma(index: FoldIndex, collection: string, id: string, field: string): number {
  return index.major(collection, id, field);
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
 * `foldValue(abs, Σ, floor, d)` at the entity's own currency scale. A missing leaf reads as
 * 0 + Σ; a missing PARENT (an asset that stopped being a loan) folds nothing, so stale keys
 * cannot resurface as a phantom payment.
 *
 * ⚠️ MUTATES `plain`: hand it a fresh copy (`toPlain`, `toJS`), never a live document value.
 * `id` is the MAP KEY the entity lives under (what a Counter key and an `increment` op name),
 * passed explicitly rather than read from `plain.id`.
 */
export function foldEntity<T>(
  collection: string,
  id: string,
  plain: T,
  index: FoldIndex,
  /** `foldDoc` only: write `abs + Σ` WITHOUT the read floor (C9b). */
  unfloored = false
): T {
  if (!isCounterCollection(collection)) return plain;
  if (plain === null || typeof plain !== 'object') return plain;
  for (const spec of COUNTER_FIELDS[collection] as readonly CounterField[]) {
    const sum = index.size === 0 ? 0 : sigma(index, collection, id, spec.abs.join('.'));
    const parent = parentOf(plain as AnyRecord, spec.abs);
    if (!parent) continue;
    const leaf = leafOf(spec.abs);
    if (sum === 0) {
      // ⚠️ THE READ FLOOR HOLDS WITH NO KEYS TOO (C9b). The floor is read-only, so the stored
      // absolute may sit below it: two concurrent decrements that crossed 0, folded by a
      // compaction into an unfloored absolute. Reading it raw after the fold would show the
      // negative the floor existed to hide. A non-number passes through untouched (rule 3).
      const v = parent[leaf];
      if (!unfloored && spec.floor !== null && typeof v === 'number' && v < spec.floor) {
        parent[leaf] = spec.floor;
      }
      continue;
    }
    const floor = unfloored ? null : spec.floor;
    parent[leaf] = foldValue(parent[leaf], sum, floor, fieldDecimals(spec, plain));
  }
  return plain;
}

// ─── Unfold (the main → worker write boundary) ───────────────────────────────

/** `obj` with the number at `abs` unfolded by `sum` (major units) at `decimals`, as a COPY (and
 *  a copied parent), or `obj` itself when there is no finite number there. */
function unfoldAt(
  obj: AnyRecord,
  abs: CounterField['abs'],
  sum: number,
  decimals: number
): AnyRecord {
  const leaf = leafOf(abs);
  const parent = parentOf(obj, abs);
  const v = parent?.[leaf];
  // Non-finite passes through: nothing can be subtracted from it, and the unfold is a
  // boundary conversion, not a validator.
  if (!parent || typeof v !== 'number' || !Number.isFinite(v)) return obj;
  // `roundTo`, never `toMinor(v)`: `v` is an absolute, not a delta, so one past the integer
  // headroom takes the float path instead of throwing on a write today's code accepted.
  const raw = roundTo(v - sum, decimals);
  if (abs.length === 1) return { ...obj, [leaf]: raw };
  return { ...obj, [abs[0]]: { ...parent, [leaf]: raw } };
}

/**
 * Convert a FOLDED `patch` (and its `base`) from main into RAW space: for each Counter field
 * with Σ ≠ 0 that holds a number, `round((v − Σ) · 10^d) / 10^d`. `fold(raw)` then reads back
 * exactly `v` (for any `v` with at most `d` decimals), an unchanged field stays unchanged (both
 * sides subtract the same Σ at the same `d`, so the reconciler writes nothing), and a Counter
 * that arrived between the caller's read and the write cancels out. `base` may be `undefined`:
 * the `set` case, where only the entity is converted.
 *
 * `d` is the scale the fold will read the entity at AFTER this write: the patch's own currency
 * when it carries one (a currency change in the same edit), else `stored`'s (the entity in the
 * draft). Patch and base use the same `d`, so equal folded values stay equal raw values.
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
  index: FoldIndex,
  stored?: unknown
): { patch: P; base: B } {
  if (index.size === 0 || !isCounterCollection(collection)) return { patch, base };
  let nextPatch: AnyRecord = patch;
  let nextBase: AnyRecord | undefined = base;
  for (const spec of COUNTER_FIELDS[collection] as readonly CounterField[]) {
    const sum = sigma(index, collection, id, spec.abs.join('.'));
    if (sum === 0) continue;
    const decimals = fieldDecimals(spec, patch, stored);
    nextPatch = unfoldAt(nextPatch, spec.abs, sum, decimals);
    if (nextBase !== undefined) nextBase = unfoldAt(nextBase, spec.abs, sum, decimals);
  }
  return { patch: nextPatch as P, base: nextBase as B };
}

// ─── Write ───────────────────────────────────────────────────────────────────

/**
 * THE one write primitive for an adjustment, and the ONLY reader of the switch. Called inside
 * a change callback by `increment`, the goal contribution and both loan ops, so the three
 * cannot drift.
 *
 * The scale is the entity's currency (`fieldDecimals`), and `delta` becomes integer minor units
 * at it FIRST, on both paths (a delta that rounds to 0 at that scale writes nothing):
 *  - writes ON: create this writer's own key `…@${d}/${writerId}` if absent, then
 *    `increment(minor)`. Throws if the draft has no `counterDeltas` map (`migrateDoc` did not
 *    run), a programming error.
 *  - writes OFF (dormant): `abs = max(floor, round((cur + delta) · 10^d) / 10^d)` on the
 *    absolute, never touching the map. A loan op's `newBalance − outstandingBalance` (a float
 *    subtraction of two `round2` values) therefore lands on `newBalance` exactly, where
 *    `cur + delta` could miss it by an ulp, and an 8-decimal crypto balance keeps every decimal.
 *    The field's floor is applied to the WRITTEN value, as today's goal write
 *    (`Math.max(0, current + delta)`) did: with no keys the read floor cannot help, because a
 *    stored negative from pre-Phase-2 history would otherwise be written back below it. A
 *    stored absolute past the integer headroom takes `roundTo`'s float path, never a throw.
 *
 * Returns whether it WROTE anything (C9c): false for a delta that rounds to 0 and for a dormant
 * write the floor clamps to the value already stored, so a caller stamps `updatedAt` (and
 * reports a loan payment as applied) only for a real write.
 *
 * Throws when the entity, or the parent of a nested field (an asset's `loan`), is missing:
 * callers check existence and `onMissing` first.
 *
 * `writerId` is `docActor.counterWriterId(actor)`: `${deviceWriterId}:${actorId}`, unique per
 * live handle and fresh per `load` (rule 1 in the header). Never absent: a session whose cache
 * never opened writes under an ephemeral device id (`docActor.ts`).
 *
 * `index`, when given, is `foldIndex(draft)` built BEFORE this write by a handler that reads the
 * draft again afterwards (its echo). A Counter write is recorded in it (`CounterIndex.add`), so
 * that one index stays exactly what a fresh `foldIndex(draft)` would now return (probe m) and
 * the handler never rebuilds it. It never changes what is written. The dormant path touches no
 * key, so it leaves the index alone.
 */
export function adjustField(
  draft: FamilyDocument,
  collection: CollectionName,
  id: string,
  field: string,
  delta: number,
  writerId: string,
  index?: CounterIndex
): boolean {
  const spec = resolveField(collection, field);
  const entity = (draft[collection] as unknown as Record<string, AnyRecord> | undefined)?.[id];
  if (!entity) {
    throw new Error(
      `counterFields: cannot adjust ${collection}/${id}/${field}: the entity is missing ` +
        `(the caller must check existence and onMissing first).`
    );
  }
  const decimals = fieldDecimals(spec, entity);
  const minor = toMinor(delta, decimals);
  const parent = parentOf(entity, spec.abs);
  if (!parent) {
    throw new Error(
      `counterFields: cannot adjust ${collection}/${id}/${field}: it has no "${spec.abs[0]}".`
    );
  }
  if (minor === 0) return false;
  if (countersOn) {
    const map = (draft as { counterDeltas?: Record<string, Automerge.Counter> }).counterDeltas;
    if (!map) {
      throw new Error(
        `counterFields: the document has no counterDeltas map (adjusting ` +
          `${collection}/${id}/${field}). Run migrateDoc on every document before writing.`
      );
    }
    const key = counterKey(collection, id, field, decimals, writerId);
    if (map[key] === undefined) map[key] = new Automerge.Counter(0);
    map[key]!.increment(minor);
    index?.add(collection as CounterCollection, id, field, decimals, minor);
    return true;
  }
  const leaf = leafOf(spec.abs);
  // ⚠️ C9a: THE FLOOR IS ON THE FOLDED VALUE, so in raw space it is `floor − Σ`. A mixed fleet
  // (this build dormant, a peer writing Counters) can hold raw 0 with Σ = +50: a −30 withdrawal
  // must land as raw −30 (folded 20), and clamping the RAW value at 0 dropped it entirely.
  const sum = (index ?? foldIndex(draft)).major(collection, id, field);
  const rawFloor = spec.floor === null ? null : spec.floor - sum;
  const before = parent[leaf];
  const next = applyFloor(roundTo(finiteOr0(before) + delta, decimals), rawFloor);
  // C9c: report whether anything was WRITTEN, so a clamped no-op leaves the heads (and
  // `updatedAt`) alone.
  if (before === next) return false;
  parent[leaf] = next;
  return true;
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
 * `counterDeltas = {}` and the fold ledger EXTENDED with every key removed from the map. Each
 * ledger entry is keyed by the full Counter key, scale included, so a rebase reads it at the
 * decimals its integer was written at.
 *
 * ⚠️ THE LEDGER IS CUMULATIVE, NEVER REPLACED. A dirty peer is rebased at ANY generation gap
 * (`podLineage.ts`), so a peer two compactions behind must still find the key folded at the
 * earlier one, or it re-emits that adjustment and counts it twice. Every parseable key is
 * ledgered, including one whose entity is gone or whose `loan` was removed (folded into
 * nothing): the ledger records that the key's value was CONSUMED, so a rebase cannot replay it.
 *
 * ⚠️ THROWS `StaleBuildCounterError` FOR ANY STRUCTURALLY VALID KEY WHOSE COLLECTION OR FIELD
 * THIS BUILD LACKS (C9e; it used to refuse only an unknown FIELD and silently drop an unknown
 * COLLECTION). Either is a newer build's Counter: compaction empties the map, so folding past
 * it would destroy every adjustment it carries, and the fix is updating the app. `compactDoc`
 * lets the class through unclassified so the user is told exactly that. The message names the
 * collection and field only, never the entity id or the writer: it reaches the firehose unmasked.
 *
 * A key that does not even split (or a known key holding a value that is not a safe integer)
 * cannot be read by any build, so refusing would block compaction forever for nothing: it is
 * dropped, unledgered, with ONE `console.warn`. The READ side (`foldIndex`) never throws (rule
 * 4); it is also the one classifier this reads.
 *
 * ⚠️ THE STORED ABSOLUTE IS `abs + Σ`, UNFLOORED (C9b). The floor is a READ-time backstop; baking
 * it into the stored value turned "two decrements crossed 0" into a lost amount that no later
 * adjustment could recover. `foldEntity` applies the floor on every read, keys or not.
 *
 * `foldedCounters` is written only when it holds something, so a dormant pod's compaction
 * source is today's plus the empty map.
 */
export function foldDoc(before: Doc): FoldedSource {
  const index = foldIndex(before);
  if (index.unknownField) {
    throw new StaleBuildCounterError(index.unknownField.collection, index.unknownField.field);
  }
  if (index.firstMalformed) {
    const { collection, field } = index.firstMalformed;
    console.warn(
      `[counterFields] compaction drops ${index.malformed} Counter key(s) no build can fold ` +
        `(first: ${collection}.${field}).`
    );
  }
  const plain = Automerge.toJS(before) as unknown as AnyRecord;
  if (index.size > 0) {
    for (const collection of Object.keys(COUNTER_FIELDS)) {
      const entities = plain[collection];
      if (entities === null || typeof entities !== 'object') continue;
      for (const [id, entity] of Object.entries(entities as AnyRecord)) {
        foldEntity(collection, id, entity, index, true);
      }
    }
  }
  const prior = plain.foldedCounters as Record<string, number> | undefined;
  const ledger: Record<string, number> = { ...prior };
  let added = 0;
  for (const [key, v] of Object.entries(before.counterDeltas ?? {})) {
    const value = parseCounterKey(key) ? counterValue(v) : null;
    if (value === null) continue; // a dropped key (warned above): never ledgered
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
 * The rebase's Counter pass: what THIS DEVICE adjusted that `target` does not yet hold, as one
 * `increment` op per (collection, id, field).
 *
 * ⚠️ OWNERSHIP IS THE KEY'S DEVICE SEGMENT, NEVER A VALUE COMPARISON. Only keys whose writer
 * starts with `${deviceWriterId}:` are this device's; a foreign key is NEVER replayed, however
 * its local copy compares to the target. A foreign key's local copy can be stale-lower than
 * what the compactor folded (its writer kept adjusting after `local` last merged), and
 * `mine − ledger` on it would fabricate that writer's later growth, negated, on its account. A
 * baseline view cannot tell the two apart (a baseline commit that missed Drive makes a foreign
 * key look changed; an own key that nets back to its baseline value looks unchanged), so none
 * is taken. Two tabs of one device share the device id (and have different actors), so each
 * re-emits its own keys.
 *
 * Per own key, growth = local value − (the target's live key ?? the target's ledger entry ?? 0)
 * in minor units at the key's decimals: exact, and negative when the device reversed an
 * adjustment after the fold. The live read comes first because a target that never compacted
 * (or was compacted by a pre-fold build, which carries the map through intact) still holds the
 * key. `onMissing: 'skip'` keeps the composer's "the compactor deleted it" rule. Malformed keys
 * are skipped. The emitted delta is major units (Σ per scale ÷ 10^d); the increment re-keys it
 * under the rebasing session's own key at the entity's current scale.
 *
 * `deviceWriterId` is the realm's id at rebase time (`docActor.deviceWriterIdFor`): the cache's
 * persisted one, or this session's ephemeral one when the cache never opened, which is exactly
 * the id this session's own keys carry.
 */
export function counterGrowthOps(
  local: GrowthSource,
  target: GrowthSource,
  deviceWriterId: string
): { ops: MutationOp[]; count: number } {
  const map = local.counterDeltas;
  if (!map) return { ops: [], count: 0 };
  const keys = Object.keys(map);
  if (keys.length === 0) return { ops: [], count: 0 };
  const own = `${deviceWriterId}:`;
  const growth = new CounterIndex();
  for (const key of keys) {
    const parsed = parseCounterKey(key);
    if (!parsed || !parsed.writer.startsWith(own)) continue; // foreign (or unreadable): never
    const mine = counterValue(map[key]);
    if (mine === null) continue;
    const theirs =
      counterValue(target.counterDeltas?.[key]) ?? counterValue(target.foldedCounters?.[key]) ?? 0;
    const g = mine - theirs;
    if (g !== 0) growth.add(parsed.collection, parsed.id, parsed.field, parsed.decimals, g);
  }
  const ops: MutationOp[] = [];
  for (const { collection, id, field, major } of growth.fields()) {
    if (major === 0) continue;
    ops.push({ op: 'increment', collection, id, field, delta: major, onMissing: 'skip' });
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
 * One pass over the map for conflicts (`getConflicts` on the nested map, probe n: `undefined`
 * for a single value, one entry per writer otherwise), plus `foldIndex`'s own malformed count
 * (the one classifier) and the ledger size. O(keys), tens at most between compactions; an
 * absent map reports zeros.
 */
export function counterStats(doc: Doc): CounterStats {
  const map = doc.counterDeltas as Record<string, unknown> | undefined;
  const ledgerKeys = Object.keys(doc.foldedCounters ?? {}).length;
  if (!map) return { keys: 0, conflicts: 0, malformed: 0, ledgerKeys };
  const keys = Object.keys(map);
  let conflicts = 0;
  for (const key of keys) {
    const values = Automerge.getConflicts(map as unknown as Automerge.Doc<AnyRecord>, key);
    if (values && Object.keys(values).length > 1) conflicts++;
  }
  return { keys: keys.length, conflicts, malformed: foldIndex(doc).malformed, ledgerKeys };
}
