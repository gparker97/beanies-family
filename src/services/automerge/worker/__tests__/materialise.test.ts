// @vitest-environment node
/**
 * The materialisation funnel (#117 Phase 2, plan `docs/plans/2026-10-03-crdt-counters-117-phase-2.md`
 * §B, Requirement 3): main never sees a Counter and never computes a sum.
 *
 * One document carries Counter keys from TWO writers on each of the three Counter-backed fields
 * (account `balance`, goal `currentAmount`, asset `loan.outstandingBalance`). Every path that
 * hands an entity to main (the full projection, which is also the persisted snapshot's content;
 * a poll delta; the structural op echoes; the goal and loan named-op echoes) must carry the
 * FOLDED number (`baseline + Σ`) to four decimals, and neither `counterDeltas` nor
 * `foldedCounters` may appear anywhere in what it hands over.
 *
 * The compaction source (`foldDoc`) is pinned in `counterFields.test.ts` and, once it is wired,
 * in `compactDoc.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Automerge from '@automerge/automerge';
import type { CollectionName, FamilyDocument } from '@/types/automerge';
import {
  applyMutation,
  buildFullProjection,
  getHeads,
  materializeCollection,
  mergeDocs,
  migrateDoc,
  projectionDeltasBetween,
} from '../docOps';
import {
  COUNTER_FIELDS,
  COUNTER_WRITES_ENABLED,
  __setCounterWritesForTesting,
  adjustField,
  foldIndex,
} from '../counterFields';
import { registeredPhotoCollections } from '../photoOps';
import type { MutationOp, ProjectionDelta } from '../protocol';
import { converge, fork, seeded, type Doc } from './twoDevices';

type AnyRec = Record<string, unknown>;

afterEach(() => {
  __setCounterWritesForTesting(COUNTER_WRITES_ENABLED);
  vi.restoreAllMocks();
});

// ─── Fixture ─────────────────────────────────────────────────────────────────

const ACCOUNT = { id: 'A', name: 'Car loan', type: 'loan', balance: 100 };
const GOAL = { id: 'G', name: 'Trip', currentAmount: 100, targetAmount: 500, isCompleted: false };
const ASSET = {
  id: 'L',
  name: 'House',
  currency: 'USD',
  loan: { hasLoan: true, outstandingBalance: 100, interestRate: 0, monthlyPayment: 10 },
};

const set = (collection: CollectionName, entity: { id: string }): MutationOp => ({
  op: 'set',
  collection,
  id: entity.id,
  entity,
});

/** Every Counter-backed field in the fixture: [collection, id, field]. */
const FIELDS = [
  ['accounts', 'A', 'balance'],
  ['goals', 'G', 'currentAmount'],
  ['assets', 'L', 'loan.outstandingBalance'],
] as const;

/** One device adjusting all three fields by `delta`, through the real write primitive with
 *  Counter writes ON, keyed by that device's own actor. */
function adjustAll(doc: Doc, delta: number): Doc {
  __setCounterWritesForTesting(true);
  try {
    const writer = Automerge.getActorId(doc);
    return Automerge.change(doc, (d) => {
      for (const [c, id, f] of FIELDS) adjustField(d, c, id, f, delta, writer);
    });
  } finally {
    __setCounterWritesForTesting(COUNTER_WRITES_ENABLED);
  }
}

/** The two-writer document: 100 on every field, -20.25 from device a, -30.5 from device b. */
function twoWriterDevices(): { a: Doc; b: Doc } {
  const { a, b } = fork(
    seeded([set('accounts', ACCOUNT), set('goals', GOAL), set('assets', ASSET)])
  );
  return { a: adjustAll(a, -20.25), b: adjustAll(b, -30.5) };
}

/** 100 − 20.25 − 30.5. */
const FOLDED = 49.25;

function twoWriterDoc(): Doc {
  const { a, b } = twoWriterDevices();
  const merged = converge(a, b).a;
  // Two writers' keys per field, and the baselines untouched: the 49.25 below is a fold.
  expect(Object.keys(merged.counterDeltas)).toHaveLength(6);
  expect((merged.accounts as unknown as AnyRec).A).toMatchObject({ balance: 100 });
  // A fold ledger entry too (compaction writes it; nothing else may surface it).
  return Automerge.change(merged, (d) => {
    d.foldedCounters = { 'accounts/A/balance/0123abcd': 1 };
  });
}

/** The folded value at a field's path on a materialised entity. */
function valueAt(entity: unknown, field: string): unknown {
  return field.split('.').reduce<unknown>((o, k) => (o as AnyRec | undefined)?.[k], entity);
}

/** Every key at any depth of a plain value (arrays and objects walked). */
function allKeys(v: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(v)) for (const x of v) allKeys(x, out);
  else if (v !== null && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      allKeys(x, out);
    }
  }
  return out;
}

/** Nothing Counter-shaped reaches main: no root map, no ledger, no `Counter` instance. */
function expectNoCounterLeak(v: unknown): void {
  const keys = allKeys(v);
  expect(keys.has('counterDeltas')).toBe(false);
  expect(keys.has('foldedCounters')).toBe(false);
  expect(JSON.stringify(v)).not.toContain('counterDeltas');
  expect(JSON.stringify(v)).not.toContain('foldedCounters');
  const walk = (x: unknown): void => {
    expect(x instanceof Automerge.Counter).toBe(false);
    if (x !== null && typeof x === 'object') Object.values(x).forEach(walk);
  };
  walk(v);
}

/** The upserts in a delta (flattening `multi`), by `${collection}/${id}`. */
function upserts(delta: ProjectionDelta | ProjectionDelta[]): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const visit = (d: ProjectionDelta): void => {
    if (d.kind === 'multi') d.deltas.forEach(visit);
    else if (d.kind === 'upsert') out.set(`${d.collection}/${d.id}`, d.entity);
  };
  (Array.isArray(delta) ? delta : [delta]).forEach(visit);
  return out;
}

// ─── The full projection (and so the persisted snapshot) ─────────────────────

describe('the full projection folds every Counter field', () => {
  it('carries baseline + Σ on all three fields, and no Counter structure', () => {
    const doc = twoWriterDoc();
    const projection = buildFullProjection(doc);
    expectNoCounterLeak(projection);
    const bulk = (c: CollectionName) =>
      new Map(
        (
          projection.find((d) => d.kind === 'bulk' && d.collection === c) as {
            entities: Array<[string, unknown]>;
          }
        ).entities
      );
    for (const [c, id, f] of FIELDS) expect(valueAt(bulk(c).get(id), f)).toBe(FOLDED);
    // Unrelated fields pass through untouched.
    expect(bulk('assets').get('L')).toMatchObject({ name: 'House', loan: { interestRate: 0 } });
  });

  it('materializeCollection folds with the index it is handed', () => {
    const doc = twoWriterDoc();
    const [[, account]] = materializeCollection(doc, 'accounts', foldIndex(doc)) as [
      [string, AnyRec],
    ];
    expect(account.balance).toBe(FOLDED);
  });
});

// ─── The poll delta ──────────────────────────────────────────────────────────

describe('a poll delta re-materialises an entity whose Counter merged in', () => {
  it('a merge that brings ONLY the other writer’s keys still emits each entity’s folded upsert', () => {
    const { a, b } = twoWriterDevices();
    const from = getHeads(a);
    const merged = mergeDocs(a, b).doc; // `a` is spent after this
    const deltas = projectionDeltasBetween(merged, from, getHeads(merged));
    expect(deltas).not.toBeNull();
    expectNoCounterLeak(deltas);
    // b touched no entity field, only `[counterDeltas, key]`: the three upserts come from the
    // Counter mapping in `touchedBetween`, and nothing else is emitted.
    expect(deltas).toHaveLength(3);
    const byId = upserts(deltas!);
    for (const [c, id, f] of FIELDS) expect(valueAt(byId.get(`${c}/${id}`), f)).toBe(FOLDED);
  });

  it('an unparseable Counter key is warned and skipped, never a fallback to a full rebuild', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const doc = seeded([set('accounts', ACCOUNT)]);
    const from = getHeads(doc);
    const after = Automerge.change(doc, (d) => {
      const map = d.counterDeltas as unknown as Record<string, Automerge.Counter>;
      map['not-a-key'] = new Automerge.Counter(5);
      map['accounts/A/futureField/w1'] = new Automerge.Counter(7); // a field this build lacks
    });
    expect(projectionDeltasBetween(after, from, getHeads(after))).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('the migrate’s own length-1 `put [counterDeltas]` touches nothing', () => {
    const unmigrated = Automerge.from<AnyRec>({ accounts: { A: { ...ACCOUNT } } });
    const from = getHeads(unmigrated as unknown as Doc);
    const migrated = migrateDoc(unmigrated as unknown as Doc);
    expect(migrated.counterDeltas).toEqual({});
    expect(projectionDeltasBetween(migrated, from, getHeads(migrated))).toEqual([]);
  });
});

// ─── Op echoes ───────────────────────────────────────────────────────────────

describe('every op echo carries the folded value', () => {
  it('increment: the echo and its delta are folded', () => {
    const doc = twoWriterDoc();
    // Today's `increment` adds to the baseline (100 + 1 = 101 raw); the echo is that, folded.
    const r = applyMutation(doc, {
      op: 'increment',
      collection: 'accounts',
      id: 'A',
      field: 'balance',
      delta: 1,
    });
    expectNoCounterLeak(r.result);
    expectNoCounterLeak(r.delta);
    expect((r.result as AnyRec).balance).toBe(50.25);
    expect((upserts(r.delta).get('accounts/A') as AnyRec).balance).toBe(50.25);
  });

  it('patch: an unrelated edit echoes the folded value of the untouched Counter field', () => {
    const doc = twoWriterDoc();
    const r = applyMutation(doc, {
      op: 'patch',
      collection: 'goals',
      id: 'G',
      patch: { name: 'Big trip' },
      base: { name: 'Trip' },
    });
    expectNoCounterLeak(r.result);
    expectNoCounterLeak(r.delta);
    expect(r.result).toMatchObject({ name: 'Big trip', currentAmount: FOLDED });
    expect(upserts(r.delta).get('goals/G')).toMatchObject({ currentAmount: FOLDED });
  });

  it('a batch builds its echoes from one index, each folded', () => {
    const doc = twoWriterDoc();
    const r = applyMutation(doc, {
      op: 'batch',
      ops: [
        { op: 'patch', collection: 'accounts', id: 'A', patch: { name: 'x' }, base: {} },
        { op: 'patch', collection: 'assets', id: 'L', patch: { name: 'y' }, base: {} },
      ],
    });
    expectNoCounterLeak(r.delta);
    const byId = upserts(r.delta);
    expect((byId.get('accounts/A') as AnyRec).balance).toBe(FOLDED);
    expect(valueAt(byId.get('assets/L'), 'loan.outstandingBalance')).toBe(FOLDED);
  });

  it('set: echoes what was sent, and the projection reads it back the same', () => {
    const doc = twoWriterDoc();
    const entity = { id: 'B', name: 'Savings', type: 'savings', balance: 12.3456 };
    const r = applyMutation(doc, set('accounts', entity));
    expectNoCounterLeak(r.result);
    expectNoCounterLeak(r.delta);
    expect(r.result).toEqual(entity);
    const read = new Map(materializeCollection(r.doc, 'accounts', foldIndex(r.doc)));
    expect(read.get('B')).toEqual(entity);
  });

  it('applyGoalContribution: the result and the delta are folded', () => {
    const doc = twoWriterDoc();
    // Today's arithmetic on the baseline (100 + 10 = 110 raw), folded: 110 − 50.75.
    const r = applyMutation(doc, {
      op: 'named',
      name: 'applyGoalContribution',
      args: { id: 'G', delta: 10 },
    });
    expectNoCounterLeak(r.result);
    expectNoCounterLeak(r.delta);
    expect((r.result as AnyRec).currentAmount).toBe(59.25);
    expect((upserts(r.delta).get('goals/G') as AnyRec).currentAmount).toBe(59.25);
  });

  it('applyLoanPayment on an asset: the host echo and the delta are folded', () => {
    const doc = twoWriterDoc();
    // An extra payment of 10 on the baseline: 90 raw, folded 90 − 50.75.
    const r = applyMutation(doc, {
      op: 'named',
      name: 'applyLoanPayment',
      args: { loanId: 'L', paymentAmount: 10, isRecurring: false },
    });
    expectNoCounterLeak(r.result);
    expectNoCounterLeak(r.delta);
    const host = (r.result as AnyRec).host;
    expect(valueAt(host, 'loan.outstandingBalance')).toBe(39.25);
    expect(valueAt(upserts(r.delta).get('assets/L'), 'loan.outstandingBalance')).toBe(39.25);
  });

  it('reverseLoanPayment on a loan account: the host echo and the delta are folded', () => {
    const doc = twoWriterDoc();
    // 5 restored on the baseline: 105 raw, folded 105 − 50.75.
    const r = applyMutation(doc, {
      op: 'named',
      name: 'reverseLoanPayment',
      args: { loanId: 'A', principalToRestore: 5 },
    });
    expectNoCounterLeak(r.result);
    expectNoCounterLeak(r.delta);
    expect((r.result as AnyRec).hostCollection).toBe('accounts');
    expect(((r.result as AnyRec).host as AnyRec).balance).toBe(54.25);
    expect((upserts(r.delta).get('accounts/A') as AnyRec).balance).toBe(54.25);
  });
});

// ─── Boundaries ──────────────────────────────────────────────────────────────

describe('funnel boundaries', () => {
  it('no registered photo host is a Counter collection (photoOps materialises outside the funnel)', () => {
    // `photoOps.ts` must stay Automerge-free (photoStore imports it on main), so its attach
    // handler materialises the host with a private `toPlain`, which would hand main a RAW
    // baseline. A Counter collection that becomes a photo host must fail here first.
    const hosts = registeredPhotoCollections();
    expect(hosts.length).toBeGreaterThan(0);
    const counterCollections = new Set(Object.keys(COUNTER_FIELDS));
    expect(hosts.filter((h) => counterCollections.has(h))).toEqual([]);
  });

  it('foldIndex on an unmigrated document (no counterDeltas map) is empty', () => {
    const unmigrated = Automerge.from<AnyRec>({ accounts: { A: { ...ACCOUNT } } });
    expect((unmigrated as { counterDeltas?: unknown }).counterDeltas).toBeUndefined();
    const index = foldIndex(unmigrated as unknown as FamilyDocument);
    expect(index.size).toBe(0);
    expect(index.malformed).toBe(0);
    const [[, account]] = materializeCollection(
      unmigrated as unknown as Doc,
      'accounts',
      index
    ) as [[string, AnyRec]];
    expect(account.balance).toBe(100);
  });
});
