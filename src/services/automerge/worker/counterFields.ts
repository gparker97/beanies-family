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
 * ⚠️ THE FIVE RULES THIS MODULE EXISTS TO HOLD (rules 1, 2 and 5 pinned in
 *    `automergeSemantics.test.ts`):
 *  1. ONE WRITER PER KEY, FOR LIFE, AND THE ACTOR IS THE WHOLE WRITER. A later increment applies
 *     to EVERY conflicting Counter at a key (probe e'), so two actors creating the same key
 *     corrupts it beyond repair. The key's writer segment is the Automerge actor alone
 *     (`${collection}/${id}/${field}@${d}/${actorId}`, #117 writer flip, plan
 *     `docs/plans/2026-10-04-crdt-counters-117-writer-flip.md` §A): the actor is fresh on every
 *     `load` (probe o) and every adopt, rebase and compaction installs a freshly loaded or built
 *     document, so a key name is never continued by a second handle or across lineages. NO KEY
 *     HAS AN OWNER: there is no device id, and the rebase carries every live key (rule 5). The
 *     map itself is created by a stored migration change so every device writes into ONE object.
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
 *  5. A REBASE CARRIES, IT NEVER INCREMENTS (probe p). A dirty peer rebasing onto a compacted
 *     target writes the growth the target lacks as a CARRY REGISTER: a put-only plain integer at
 *     `…@${d}/carry.${writer}.${targetSeq}` (`carryKeyFor`), where `writer` is the actor the key
 *     stands for and `targetSeq` the target generation. Two peers carrying one key onto one
 *     generation write ONE name (Automerge keeps one value, never two Counters that add); two
 *     generations write two names, so the name-keyed ledger never overwrites one register with
 *     another. A register is never incremented: a plain integer makes `.increment` a TypeError.
 *     Increments only ever go to the session's own actor key.
 *
 *     THE CANONICAL-KNOWLEDGE RULE: growth is per CANONICAL key (the key with any carry prefix
 *     and generation stripped), the SUM of the peer's live names for it minus the target's
 *     knowledge of it folded AFTER the peer's generation `P`, which the names alone identify: a
 *     target entry counts iff its name is one of the peer's live names (live on `P`, so first
 *     folded at `≥ P+1`) or it is a carry onto a generation `≥ P` (`targetKnowledge`); the
 *     current-generation register is excluded (the register rule owns it). Why canonical, not
 *     exact-name: session S (actor X) holds `K = 10` on `P`; compactor D held 8 and compacted to
 *     `T` (ledger `K = 8`); peer B held 9, rebased onto `T` and put `carry.X.T = 1`; `T+1`
 *     ledgers it. S rebasing onto `T+1` per exact name sees 8, carries 2, and the fold reads 11
 *     for a true 10; per canonical key it knows 8 + 1 = 9, carries 1, and the fold reads 10.
 *     Why the SUM over names, once per canonical key: a restore keeps the chosen file's history,
 *     so `K` can be live on the restore generation `R` beside a pre-restore peer's
 *     `carry.X.R = 2`. Peer F on `R` holds both; D compacts to `R+1` (ledger `K = 10`,
 *     `carry.X.R = 2`). Per name and summed, F computes −2 for `K` and 0 for the register, a
 *     phantom reversal; over the name set, 12 − (10 + 2) = 0. With one live name per canonical
 *     key the two formulations are identical.
 *
 *     THE FRESHNESS RULE (plan Requirement 4, amended in the build): a FOREIGN key is compared to
 *     the ledger only when the peer holds every change the compactor folded (`fromHeads`).
 *     Otherwise its copy may be stale in EITHER direction: B holds D's key at `v`, D spends 491
 *     and compacts (ledger `v − 491`), and B, behind, would compute `+491` and undo the expense.
 *     So a non-fresh peer takes the BASELINE rule for foreign keys (`local − before`, 0 for a
 *     pure copy received through Drive), and keeps the ledger rule for its own (`GrowthKnowledge`).
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
// Type-only (a cycle with `protocol.ts`'s type-only `CounterStats` import, erased both ways).
import type { MutationOp } from './protocol';

type AnyRecord = Record<string, unknown>;
type Doc = Automerge.Doc<FamilyDocument>;

// ─── The switch ──────────────────────────────────────────────────────────────

/**
 * Whether adjustments are WRITTEN as Counters when no policy has ever reached this realm (a
 * self-host without a registry, a first boot before the registry answers). The READER side
 * (fold, map creation, ledger, carries, projection touch) is always on; only the writer waits.
 *
 * ⚠️ THE SWITCH IS A SERVED POLICY (#117 writer flip, plan §F). The registry GET carries
 * `dataPolicy.counterWrites`; main persists the last-known value and the worker receives it
 * through `setCounterWrites` at `setFamilyKey`, on a respawn or inline re-drive, and on a live
 * change. The flip and the rollback are a Terraform variable, never a release. Release order
 * (runbook `docs/runbooks/native-store-submission.md` §7): ship this build with the policy off,
 * wait until it is live on both stores and the floor is raised to it, then flip the variable.
 * A later release may flip THIS default once the hosted fleet has soaked.
 */
export const COUNTER_WRITES_DEFAULT = false;

let countersOn: boolean = COUNTER_WRITES_DEFAULT;

/**
 * THE setter for the Counter-write switch: the policy the worker was handed, or `null` for "no
 * policy" (`COUNTER_WRITES_DEFAULT`). The worker's `setCounterWrites` RPC calls it, and tests
 * use it as their seam: reset with `setCounterWrites(null)` in an `afterEach`, because module
 * state leaks between tests in one file otherwise.
 */
export function setCounterWrites(on: boolean | null): void {
  countersOn = on ?? COUNTER_WRITES_DEFAULT;
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

/** The carry-register namespace. Written only by `carryKeyFor`; refused by `counterKey`. */
const CARRY_PREFIX = 'carry.';

/** `carry.<of>.<seq>`: `of` is everything up to the LAST `.`, `seq` the decimal digits after. */
const CARRY_SEGMENT = /^carry\.(.+)\.(\d{1,15})$/;

/**
 * The Counter key `${collection}/${id}/${field}@${decimals}/${writer}`, where `writer` is the
 * writing handle's Automerge actor (rule 1). Throws for a field not in the table, a writer that
 * would not parse back (empty, or a `/` in it) or that would read as a carry register (it
 * starts with `carry.`, a namespace only `carryKeyFor` writes), or a scale outside
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
  if (id === '' || writerId === '' || writerId.includes('/') || writerId.startsWith(CARRY_PREFIX)) {
    throw new Error(
      `counterFields: cannot key ${collection}/${id}/${field} for writer "${writerId}": ` +
        `the id and writer must be non-empty, the writer must not contain "/" and must not ` +
        `start with "${CARRY_PREFIX}" (the carry-register namespace).`
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
 *  may contain `:` or `.` (a carry register's does); only `/` separates segments. */
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
  /** The writer segment: an actor id for an increment key, `carry.<of>.<seq>` for a register.
   *  (A 0.91.2-shaped `${deviceId}:${actorId}` segment also parses; no build ever wrote one.) */
  writer: string;
  /** Set when the writer segment is a carry register `carry.<of>.<seq>`: `of` is the writer of
   *  the key it stands for, `seq` the generation it was put on. `null` for an increment key. */
  carry: { of: string; seq: number } | null;
  /** The key with the writer replaced by `carry.of` (a register), or the key itself: every
   *  name for one writer's adjustment of one field at one scale shares it (rule 5). */
  canonical: string;
}

/** A key's segments, or `null` when it does not parse or names a (collection, field) this
 *  build's table lacks (a future build's field). Never throws. */
export function parseCounterKey(key: string): ParsedCounterKey | null {
  const parts = splitCounterKey(key);
  if (!parts || !isCounterCollection(parts.collection)) return null;
  if (!lookupField(parts.collection, parts.field)) return null;
  const m = CARRY_SEGMENT.exec(parts.writer);
  const carry = m ? { of: m[1]!, seq: Number(m[2]) } : null;
  const canonical = carry
    ? `${entityFieldKey(parts.collection, parts.id, parts.field)}@${parts.decimals}/${carry.of}`
    : key;
  return { ...(parts as Omit<ParsedCounterKey, 'carry' | 'canonical'>), carry, canonical };
}

/**
 * The carry-register name for `canonicalKey` put on generation `targetSeq`:
 * `${collection}/${id}/${field}@${d}/carry.${writer}.${targetSeq}` (rule 5). THE only place a
 * register name is built. Throws for a key that does not parse, that is itself a register (a
 * caller must pass the canonical key), or a generation that is not a non-negative integer.
 */
export function carryKeyFor(canonicalKey: string, targetSeq: number): string {
  const parsed = parseCounterKey(canonicalKey);
  if (!parsed || parsed.carry !== null || !Number.isSafeInteger(targetSeq) || targetSeq < 0) {
    throw new Error(
      `counterFields: cannot build a carry register for generation ${String(targetSeq)}: the ` +
        `key must be a canonical (non-carry) Counter key this build can parse and the ` +
        `generation a non-negative integer.`
    );
  }
  const { collection, id, field, decimals, writer } = parsed;
  return `${entityFieldKey(collection, id, field)}@${decimals}/${CARRY_PREFIX}${writer}.${targetSeq}`;
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
 * `writerId` is the writing handle's Automerge actor (`Automerge.getActorId(doc)`, read once per
 * mutation by `applyMutation`): unique per live handle and fresh per `load`, so it is the whole
 * writer (rule 1). It never names a carry register (`counterKey` refuses `carry.`), so an
 * increment can never land on one (rule 5).
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

/**
 * One fold-ledger entry: `{ v: minorUnits, s: foldedAtSeq }` (#117 writer flip, plan §D), or a
 * bare number written by a 0.91.2 compaction (normalised by this build's next `foldDoc`).
 * Read ONLY through `ledgerValue` / `ledgerSeq`.
 */
export type LedgerEntry = number | { v: number; s: number };

/** How many generations a ledger entry is kept after the compaction that folded it. A dirty
 *  peer further behind than this cannot compute exact growth and is blocked (`ledger-window`). */
export const LEDGER_WINDOW = 12;

/** A ledger entry's value in minor units (either shape), or `null` when it is neither shape. */
export function ledgerValue(e: unknown): number | null {
  if (typeof e === 'number') return Number.isSafeInteger(e) ? e : null;
  if (e !== null && typeof e === 'object') {
    const v = (e as { v?: unknown }).v;
    return typeof v === 'number' && Number.isSafeInteger(v) ? v : null;
  }
  return null;
}

/** The generation a ledger entry was folded at, or `null` for a bare number (0.91.2) or an
 *  entry with no readable `s`. Read by pruning and `counterStats` only, never by growth. */
export function ledgerSeq(e: unknown): number | null {
  if (e === null || typeof e !== 'object') return null;
  const s = (e as { s?: unknown }).s;
  return typeof s === 'number' && Number.isSafeInteger(s) ? s : null;
}

/** What one compaction did to the ledger, for the compaction log. */
export interface LedgerFigures {
  /** Entries dropped because they were folded more than `LEDGER_WINDOW` generations ago. */
  pruned: number;
  /** Bare-number (0.91.2) entries rewritten as `{ v, s: newSeq }`. */
  normalised: number;
  /** Folded keys whose name was already in the prior ledger: a name reuse (a bug), warned. */
  collisions: number;
}

/** The compaction source: a plain document with every Counter folded, the map empty and the
 *  ledger rebuilt. No `Counter` instance anywhere in it. */
export type FoldedSource = Omit<FamilyDocument, 'counterDeltas' | 'foldedCounters'> & {
  counterDeltas: Record<string, never>;
  foldedCounters?: Record<string, { v: number; s: number }>;
  /**
   * What this compaction did to the ledger. ⚠️ NON-ENUMERABLE, so it is never a document key:
   * `{ ...source }` and `Automerge.from(source)` both drop it (a new root key would degrade a
   * 0.91.2 peer's incremental projection, `docOps.touchedBetween`). Read it off the returned
   * object before spreading.
   */
  readonly ledger: LedgerFigures;
};

/**
 * The compaction source for `before`, compacting to generation `newSeq`: `Automerge.toJS`, every
 * Counter field folded, then `counterDeltas = {}` and the fold ledger REBUILT. Each ledger entry
 * is keyed by the full Counter key, scale included (a carry register under its own full name),
 * so a rebase reads it at the decimals its integer was written at.
 *
 * ⚠️ THE LEDGER IS BOUNDED BY GENERATION (#117 writer flip, plan §D). Every key folded here is
 * written `{ v, s: newSeq }`; a prior entry is kept (a bare 0.91.2 number rewritten as
 * `{ v, s: newSeq }`, conservative: it lives a full window from now) unless its `s` is older
 * than `newSeq − LEDGER_WINDOW`, when it is pruned. A dirty peer is rebased only within the
 * window (`blockedBy: 'ledger-window'` beyond it), and every entry its growth reads was folded
 * at a generation after its own, so a pruned entry is never one a rebase still needs. Every
 * parseable key is ledgered, including one whose entity is gone or whose `loan` was removed
 * (folded into nothing): the ledger records that the key's value was CONSUMED.
 *
 * A folded key whose name is already in the prior ledger is a NAME REUSE (impossible with fresh
 * actors and generation-stamped registers): counted in `ledger.collisions`, warned once, and the
 * newer value wins, so nothing is silent.
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
 * 4); it is also the one classifier this reads. A prior ledger entry of neither shape is dropped
 * the same way, with one warning.
 *
 * ⚠️ THE STORED ABSOLUTE IS `abs + Σ`, UNFLOORED (C9b). The floor is a READ-time backstop; baking
 * it into the stored value turned "two decrements crossed 0" into a lost amount that no later
 * adjustment could recover. `foldEntity` applies the floor on every read, keys or not.
 *
 * `foldedCounters` is written only when it holds something (or held something before), so a
 * dormant pod's compaction source is today's plus the empty map.
 */
export function foldDoc(before: Doc, newSeq: number): FoldedSource {
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
  const prior = plain.foldedCounters as Record<string, unknown> | undefined;
  const ledger: Record<string, { v: number; s: number }> = {};
  const figures: LedgerFigures = { pruned: 0, normalised: 0, collisions: 0 };
  const pruneBelow = newSeq - LEDGER_WINDOW;
  let unreadable = 0;
  for (const [name, e] of Object.entries(prior ?? {})) {
    const v = ledgerValue(e);
    if (v === null) {
      unreadable++;
      continue;
    }
    const s = ledgerSeq(e);
    if (s !== null && s < pruneBelow) {
      figures.pruned++;
      continue;
    }
    if (s === null) figures.normalised++;
    ledger[name] = { v, s: s ?? newSeq };
  }
  if (unreadable > 0) {
    console.warn(
      `[counterFields] compaction drops ${unreadable} fold-ledger entr${unreadable === 1 ? 'y' : 'ies'} ` +
        `that hold no readable value.`
    );
  }
  let added = 0;
  let firstCollision: CounterKeyLabel | null = null;
  for (const [key, v] of Object.entries(before.counterDeltas ?? {})) {
    const parsed = parseCounterKey(key);
    const value = parsed ? counterValue(v) : null;
    if (parsed === null || value === null) continue; // a dropped key (warned above): never ledgered
    if (prior !== undefined && Object.hasOwn(prior, key)) {
      figures.collisions++;
      firstCollision ??= { collection: parsed.collection, field: parsed.field };
    }
    ledger[key] = { v: value, s: newSeq };
    added++;
  }
  if (firstCollision) {
    console.warn(
      `[counterFields] compaction folded ${figures.collisions} Counter key name(s) already in ` +
        `the fold ledger (first: ${firstCollision.collection}.${firstCollision.field}); the ` +
        `newer value wins. A key name was reused, which fresh actors and generation-stamped ` +
        `carry registers should make impossible.`
    );
  }
  plain.counterDeltas = {};
  if (added > 0 || prior !== undefined) plain.foldedCounters = ledger;
  Object.defineProperty(plain, 'ledger', { value: figures, enumerable: false });
  return plain as unknown as FoldedSource;
}

/** Anything carrying the map and (optionally) the ledger: a doc or a plain source. */
export type GrowthSource = CounterSource & {
  readonly foldedCounters?: Readonly<Record<string, unknown>> | null;
};

/**
 * What a rebase target already holds of one canonical key, in minor units at that key's scale,
 * given the set of names the dirty peer holds live for it. Built ONCE per rebase by
 * `targetKnowledge` (the ledger rule) or `baselineKnowledge` (the baseline rule: a restore, or
 * a non-fresh peer's foreign keys); `counterGrowthOps` subtracts it from the peer's live sum.
 */
export interface Knowledge {
  of(canonical: string, names: ReadonlySet<string>): number;
}

/** One target entry for a canonical key: its name, its carry generation, its value. */
interface KnownEntry {
  readonly name: string;
  readonly carrySeq: number | null;
  readonly value: number;
}

/**
 * The target's knowledge for a peer on generation `localSeq` rebasing onto generation
 * `targetSeq` (rule 5, plan Requirement 3). One pass over the target's ledger and one over its
 * live map, grouped by canonical key; `of(K, names)` sums the entries of `K` whose name is one
 * of `names` (live on the peer's generation, so first folded after it) OR that are a carry onto
 * a generation `≥ localSeq` (first folded after the peer's generation). Everything older is
 * knowledge the peer's own values already discount.
 *
 * The live current-generation register `carryKeyFor(K, targetSeq)` is EXCLUDED: the register
 * rule owns it (an own-actor carry overwrites it, a foreign carry is skipped outright). Any
 * other live name on a compacted target is a below-floor pre-fold compaction's carried-through
 * copy and is knowledge like a ledger entry. Unparseable names and unreadable values are
 * skipped. `s` is never read: growth is decided by names alone.
 */
export function targetKnowledge(
  target: GrowthSource,
  localSeq: number,
  targetSeq: number
): Knowledge {
  const byCanonical = new Map<string, KnownEntry[]>();
  const record = (name: string, value: number | null, parsed: ParsedCounterKey) => {
    if (value === null) return;
    let list = byCanonical.get(parsed.canonical);
    if (!list) {
      list = [];
      byCanonical.set(parsed.canonical, list);
    }
    list.push({ name, carrySeq: parsed.carry?.seq ?? null, value });
  };
  for (const [name, e] of Object.entries(target.foldedCounters ?? {})) {
    const parsed = parseCounterKey(name);
    if (parsed) record(name, ledgerValue(e), parsed);
  }
  for (const [name, v] of Object.entries(target.counterDeltas ?? {})) {
    const parsed = parseCounterKey(name);
    if (!parsed) continue;
    if (parsed.carry !== null && parsed.carry.seq === targetSeq) continue; // the register rule's
    record(name, counterValue(v), parsed);
  }
  return {
    of(canonical, names) {
      let known = 0;
      for (const e of byCanonical.get(canonical) ?? []) {
        if (names.has(e.name) || (e.carrySeq !== null && e.carrySeq >= localSeq)) known += e.value;
      }
      return known;
    },
  };
}

/**
 * The restore rule's knowledge (plan Requirement 6): the peer's OWN baseline view `before`,
 * looked up by exact name (same document, same lineage), so growth is only what this peer has
 * not yet synced and adjustments a restore rolled back are not re-applied.
 */
export function baselineKnowledge(before: CounterSource): Knowledge {
  return {
    of(_canonical, names) {
      let known = 0;
      for (const n of names) known += counterValue(before.counterDeltas?.[n]) ?? 0;
      return known;
    },
  };
}

/**
 * One rebase carry (rule 5): put `minor` (integer minor units at the scale `name` carries) as
 * the plain-integer register `name` on entity `(collection, id)`. `exact` is true when one of
 * the peer's live names for the canonical key is the rebasing document's own actor key: such a
 * carry OVERWRITES an existing register; a foreign one is skipped when a register exists.
 *
 * Worker-only, like the rebase's raw `patch`: the `carry` kind of `protocol.ts`'s `MutationOp`
 * (declared there, beside `increment`), applied by `docOps.mutateDraft`.
 */
export type CarryOp = Extract<MutationOp, { op: 'carry' }>;

/**
 * Which knowledge a rebase subtracts, per kind of canonical key (plan Requirements 4 and 6),
 * chosen ONCE by the composer:
 *  - restore rule: both are `baselineKnowledge(before)`;
 *  - ledger rule, fresh peer: both are `targetKnowledge(...)`;
 *  - ledger rule, non-fresh peer (`ledger+baseline`): `exact` is `targetKnowledge(...)` (the own
 *    session holds its complete key) and `foreign` is `baselineKnowledge(before)` (a foreign
 *    copy may be stale either way, so only what this peer has not synced is carried).
 */
export interface GrowthKnowledge {
  /** For a canonical key one of whose live names is the rebasing document's own actor key. */
  readonly exact: Knowledge;
  /** For every other canonical key. */
  readonly foreign: Knowledge;
}

/** One canonical key's live names on the rebasing peer, summed. */
interface CanonicalGroup {
  readonly collection: CounterCollection;
  readonly id: string;
  readonly names: Set<string>;
  sum: number;
  exact: boolean;
}

/**
 * The rebase's Counter pass: the growth `target` lacks, as ONE `carry` op per canonical key
 * (rule 5, plan Requirements 2-4). Nobody owns a key: EVERY live parseable key the peer holds is
 * considered, own or foreign.
 *
 * First pass: group the peer's parseable live names by canonical key (`sum` of their values;
 * `exact` when one of them is the peer's own actor key, `Automerge.getActorId(local)`). Second
 * pass, per group: `g = sum − source.of(canonical, names)`, where `source` is `knowledge.exact`
 * for an exact group and `knowledge.foreign` otherwise; `g = 0` emits nothing; everything else
 * becomes one `carry` op named `carryKeyFor(K, targetSeq)`. NOTHING IS SKIPPED AND NOTHING IS
 * SIGN-FILTERED (plan Requirement 4, amended in the build): a stale foreign copy can read high
 * as well as low (an expense is a negative increment), so a sign rule cannot tell a stale copy
 * from a reversal. The caller makes a foreign key safe by choosing its knowledge instead: the
 * target's ledger when the peer is fresh (it holds every change the compactor folded), else the
 * peer's own baseline, under which a pure copy received through Drive grows by exactly 0.
 *
 * Malformed keys (unparseable, unknown field, a value that is not a safe integer) are skipped.
 * `onMissing` is the `carry` op's own rule: an entity the compactor deleted is skipped there.
 */
export function counterGrowthOps(
  local: Doc,
  knowledge: GrowthKnowledge,
  targetSeq: number,
  targetLive?: Readonly<Record<string, unknown>> | null
): CarryOp[] {
  const map = local.counterDeltas as Readonly<Record<string, unknown>> | undefined;
  if (!map) return [];
  const keys = Object.keys(map);
  if (keys.length === 0) return [];
  const own = Automerge.getActorId(local);
  const groups = new Map<string, CanonicalGroup>();
  for (const key of keys) {
    const parsed = parseCounterKey(key);
    const value = parsed ? counterValue(map[key]) : null;
    if (parsed === null || value === null) continue;
    let group = groups.get(parsed.canonical);
    if (!group) {
      group = {
        collection: parsed.collection,
        id: parsed.id,
        names: new Set(),
        sum: 0,
        exact: false,
      };
      groups.set(parsed.canonical, group);
    }
    group.names.add(key);
    group.sum += value;
    group.exact ||= parsed.carry === null && parsed.writer === own;
  }
  const ops: CarryOp[] = [];
  for (const [canonical, group] of groups) {
    const source = group.exact ? knowledge.exact : knowledge.foreign;
    const g = group.sum - source.of(canonical, group.names);
    const name = carryKeyFor(canonical, targetSeq);
    // Zero growth carries nothing, EXCEPT for the key's own session when the target already holds
    // a register for it: "own overwrites" must fire with 0 too, or a foreign carrier's staler
    // register stands (a withdrawal back to the folded value would be lost; review round 1).
    if (g === 0 && !(group.exact && targetLive?.[name] !== undefined)) continue;
    ops.push({
      op: 'carry',
      collection: group.collection,
      id: group.id,
      name,
      minor: g,
      exact: group.exact,
    });
  }
  return ops;
}

/**
 * Whether `local` holds a live Counter key written by its OWN actor: the only keys whose growth
 * reads the target's ledger when the peer is not fresh (foreign keys then take the baseline rule).
 * The ledger-window block asks this, so a peer far behind that merely holds other writers' keys
 * still rebases (review round 1).
 */
export function hasOwnCounterKey(local: Doc): boolean {
  const map = local.counterDeltas as Readonly<Record<string, unknown>> | undefined;
  if (!map) return false;
  const own = Automerge.getActorId(local);
  for (const key of Object.keys(map)) {
    const parsed = parseCounterKey(key);
    if (parsed && parsed.carry === null && parsed.writer === own) return true;
  }
  return false;
}

// ─── Stats ───────────────────────────────────────────────────────────────────

/** The merge terminus's Counter figures. `conflicts` must be 0 by construction. */
export interface CounterStats {
  /** Keys in the live map (growth between compactions). */
  keys: number;
  /** Increment keys holding more than one concurrent value: two writers shared a key. A bug. */
  conflicts: number;
  /** Carry registers holding more than one concurrent value: two peers put the same register
   *  without having merged each other first. The documented residual (Automerge's pick). */
  carryConflicts: number;
  /** Keys the fold skipped (unparseable, unknown field, non-integer value). */
  malformed: number;
  /** Entries in the bounded fold ledger. */
  ledgerKeys: number;
  /** The oldest generation a ledger entry was folded at, or `null` (empty, or bare entries only). */
  ledgerOldest: number | null;
}

/**
 * One pass over the map for conflicts (`getConflicts` on the nested map, probe n: `undefined`
 * for a single value, one entry per writer otherwise), split into increment keys (a bug) and
 * carry registers (the residual) by `parseCounterKey(key).carry`, plus `foldIndex`'s own
 * malformed count (the one classifier) and the ledger's size and oldest generation. O(keys),
 * tens at most between compactions; an absent map reports zeros.
 */
export function counterStats(doc: Doc): CounterStats {
  const map = doc.counterDeltas as Record<string, unknown> | undefined;
  const ledger = (doc.foldedCounters ?? {}) as Readonly<Record<string, unknown>>;
  const ledgerNames = Object.keys(ledger);
  let ledgerOldest: number | null = null;
  for (const name of ledgerNames) {
    const s = ledgerSeq(ledger[name]);
    if (s !== null && (ledgerOldest === null || s < ledgerOldest)) ledgerOldest = s;
  }
  const ledgerKeys = ledgerNames.length;
  if (!map) {
    return { keys: 0, conflicts: 0, carryConflicts: 0, malformed: 0, ledgerKeys, ledgerOldest };
  }
  const keys = Object.keys(map);
  let conflicts = 0;
  let carryConflicts = 0;
  for (const key of keys) {
    const values = Automerge.getConflicts(map as unknown as Automerge.Doc<AnyRecord>, key);
    if (!values || Object.keys(values).length <= 1) continue;
    if (parseCounterKey(key)?.carry) carryConflicts++;
    else conflicts++;
  }
  return {
    keys: keys.length,
    conflicts,
    carryConflicts,
    malformed: foldIndex(doc).malformed,
    ledgerKeys,
    ledgerOldest,
  };
}

/** Read-only view of the module's Counter-write switch (`setCounterWrites` sets it). */
export function counterWritesOn(): boolean {
  return countersOn;
}
