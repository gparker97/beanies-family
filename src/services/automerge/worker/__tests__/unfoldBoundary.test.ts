// @vitest-environment node
/**
 * The unfold boundary (#117 Phase 2, plan `docs/plans/2026-10-03-crdt-counters-117-phase-2.md`
 * §C `patch` and `set`, "Two value spaces, one boundary", "The unfold copies, never mutates").
 *
 * Main sends FOLDED values (what the user sees: baseline + Σ Counters); the document stores RAW
 * absolutes. A based `patch` and a `set` on a Counter collection are unfolded in the worker
 * (`raw = round((v − Σ) · 10^d) / 10^d`, `d` the entity's currency scale) before the reconciler
 * runs, so:
 *  - an unchanged folded field is an unchanged raw field and writes nothing;
 *  - a changed field reads back as exactly what was sent;
 *  - with Σ = 0 the value passes through untouched (no rounding);
 *  - concurrent adjustments on a peer survive an edit, and add onto an absolute write;
 *  - the caller's op object is never mutated (inline mode hands the worker the caller's own op);
 *  - the reconciler's Law-1 verify still runs, raw against raw.
 *
 * Counter keys are written through the real primitive (`adjustField`) with writes ON, because
 * the `increment` op only reaches it once the writer package lands.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Automerge from '@automerge/automerge';
import type { CollectionName } from '@/types/automerge';
import { applyMutation, buildFullProjection, getHeads } from '../docOps';
import { setCounterWrites, adjustField } from '../counterFields';
import type { MutationOp } from '../protocol';
import { apply, converge, fork, seeded, type Doc } from './twoDevices';

type AnyRec = Record<string, unknown>;

// The Law-1 fallback is forced by swapping the reconciler's inner walk for a no-op, the same
// seam `reconcile.test.ts` uses, but reached through `docOps` (whose `reconcileInto` is mocked).
const verify = vi.hoisted(() => ({ faulty: false }));
vi.mock('../reconcile', async (importOriginal) => {
  const real = await importOriginal<typeof import('../reconcile')>();
  const broken = real.__reconcileIntoWithForTesting(() => {});
  return {
    ...real,
    reconcileInto: (...args: Parameters<typeof real.reconcileInto>) =>
      (verify.faulty ? broken : real.reconcileInto)(...args),
  };
});

afterEach(() => {
  setCounterWrites(null);
  verify.faulty = false;
});

// ─── Fixture ─────────────────────────────────────────────────────────────────

const LOAN = { hasLoan: true, outstandingBalance: 100, interestRate: 0, monthlyPayment: 10 };
const ACCOUNT = { id: 'A', name: 'Car loan', type: 'loan', balance: 100 };
const GOAL = { id: 'G', name: 'Trip', currentAmount: 100, targetAmount: 500, isCompleted: false };
const ASSET = { id: 'L', name: 'House', currency: 'USD', loan: LOAN };

const set = (collection: CollectionName, entity: { id: string } & AnyRec): MutationOp => ({
  op: 'set',
  collection,
  id: entity.id,
  entity,
});

const base3 = (): Doc =>
  seeded([set('accounts', ACCOUNT), set('goals', GOAL), set('assets', ASSET)]);

/** Every Counter-backed field in the fixture: [collection, id, field]. */
const FIELDS = [
  ['accounts', 'A', 'balance'],
  ['goals', 'G', 'currentAmount'],
  ['assets', 'L', 'loan.outstandingBalance'],
] as const;

/** One device's adjustment, through the real write primitive with Counter writes ON. */
function adjust(doc: Doc, collection: CollectionName, id: string, field: string, delta: number) {
  setCounterWrites(true);
  try {
    const writer = Automerge.getActorId(doc);
    return Automerge.change(doc, (d) => adjustField(d, collection, id, field, delta, writer));
  } finally {
    setCounterWrites(null);
  }
}

const adjustAll = (doc: Doc, delta: number): Doc =>
  FIELDS.reduce((d, [c, id, f]) => adjust(d, c, id, f, delta), doc);

/** What main would show for one entity (the full projection, folded). */
function projected(doc: Doc, collection: CollectionName, id: string): AnyRec | undefined {
  for (const d of buildFullProjection(doc)) {
    if (d.kind === 'bulk' && d.collection === collection) {
      const hit = d.entities.find(([k]) => k === id);
      return hit?.[1] as AnyRec | undefined;
    }
  }
  return undefined;
}

/** What the document stores (raw) for one entity. */
const stored = (doc: Doc, collection: CollectionName, id: string): AnyRec =>
  Automerge.toJS(doc)[collection][id] as unknown as AnyRec;

function valueAt(entity: unknown, field: string): unknown {
  return field.split('.').reduce<unknown>((o, k) => (o as AnyRec | undefined)?.[k], entity);
}

/** `{ [field]: value }` for a possibly nested field, carrying the rest of `loan`. */
function withValue(field: string, value: number, loan: AnyRec = LOAN): AnyRec {
  return field === 'loan.outstandingBalance'
    ? { loan: { ...loan, outstandingBalance: value } }
    : { [field]: value };
}

const patch = (
  collection: CollectionName,
  id: string,
  p: AnyRec,
  base: AnyRec | undefined,
  extra: Partial<Extract<MutationOp, { op: 'patch' }>> = {}
): MutationOp => ({ op: 'patch', collection, id, patch: p, ...(base ? { base } : {}), ...extra });

const counterMap = (doc: Doc): unknown => JSON.parse(JSON.stringify(doc.counterDeltas));

// ─── patch ───────────────────────────────────────────────────────────────────

describe('based patch: the unfold at the boundary', () => {
  it.each(FIELDS)('%s/%s.%s: an unchanged folded field writes nothing', (c, id, f) => {
    const doc = adjustAll(base3(), -20.25); // folded 79.75 everywhere
    const folded = valueAt(projected(doc, c, id), f) as number;
    expect(folded).toBe(79.75);
    const same = withValue(f, folded, { ...LOAN, outstandingBalance: folded });
    const op = patch(c, id, same, structuredClone(same), { updatedAt: '2026-10-03T00:00:00Z' });
    const res = applyMutation(doc, op);
    expect(getHeads(res.doc)).toEqual(getHeads(doc)); // `changed: false` on main
    expect(res.notes).toEqual([]);
  });

  it.each(FIELDS)('%s/%s.%s: a changed field folds back to exactly `next`', (c, id, f) => {
    const doc = adjustAll(base3(), -20.25);
    const prev = { ...LOAN, outstandingBalance: 79.75 };
    const next = 123.45; // at most the entity's scale (two decimals: no currency on the fixture)
    const res = applyMutation(
      doc,
      patch(c, id, withValue(f, next, prev), withValue(f, 79.75, prev))
    );
    expect(valueAt(res.result, f)).toBe(next); // the echo
    expect(valueAt(projected(res.doc, c, id), f)).toBe(next); // the full projection
    expect(valueAt(stored(res.doc, c, id), f)).toBe(143.7); // raw = next − Σ
    expect(counterMap(res.doc)).toEqual(counterMap(doc)); // the map is never written
  });

  it('a Counter that arrived after the caller read cancels out: the result is what was sent', () => {
    const doc = adjust(base3(), 'accounts', 'A', 'balance', -20);
    // The caller read 100 (before the -20 merged in) and sends 150.
    const res = applyMutation(doc, patch('accounts', 'A', { balance: 150 }, { balance: 100 }));
    expect(projected(res.doc, 'accounts', 'A')?.balance).toBe(150);
  });

  it('with Σ = 0 the stored value is byte-for-byte what was sent (no rounding)', () => {
    const doc = base3();
    const odd = 0.1 + 0.2; // 0.30000000000000004: rounding to the scale would change it
    const res = applyMutation(doc, patch('accounts', 'A', { balance: odd }, { balance: 100 }));
    expect(stored(res.doc, 'accounts', 'A').balance).toBe(odd);
    expect(projected(res.doc, 'accounts', 'A')?.balance).toBe(odd);
  });

  it('a base-less patch is raw space: applied as sent, not unfolded', () => {
    const doc = adjust(base3(), 'accounts', 'A', 'balance', -20);
    const res = applyMutation(doc, patch('accounts', 'A', { balance: 150 }, undefined));
    expect(stored(res.doc, 'accounts', 'A').balance).toBe(150);
    expect(projected(res.doc, 'accounts', 'A')?.balance).toBe(130);
  });

  it('a non-Counter collection is untouched by the unfold', () => {
    const doc = seeded([set('todos', { id: 'T', title: 'x', amount: 5 } as never)]);
    const res = applyMutation(doc, patch('todos', 'T', { amount: 7 }, { amount: 5 }));
    expect(stored(res.doc, 'todos', 'T').amount).toBe(7);
  });

  it('removing `loan` via deleteKeys then re-creating it absorbs the stale keys', () => {
    let doc = adjust(base3(), 'assets', 'L', 'loan.outstandingBalance', -20); // folded 80
    doc = applyMutation(doc, patch('assets', 'L', {}, {}, { deleteKeys: ['loan'] })).doc;
    expect(projected(doc, 'assets', 'L')?.loan).toBeUndefined(); // no phantom loan
    expect(Object.keys(doc.counterDeltas)).toHaveLength(1); // the stale key persists
    const fresh = { hasLoan: true, outstandingBalance: 50, interestRate: 0, monthlyPayment: 5 };
    const res = applyMutation(doc, patch('assets', 'L', { loan: fresh }, {}));
    expect(valueAt(res.result, 'loan.outstandingBalance')).toBe(50);
    expect(projected(res.doc, 'assets', 'L')?.loan).toEqual(fresh);
    expect(valueAt(stored(res.doc, 'assets', 'L'), 'loan.outstandingBalance')).toBe(70);
  });
});

// ─── set ─────────────────────────────────────────────────────────────────────

describe('set: the unfold at the boundary', () => {
  it('Σ = 0: the entity is stored exactly as sent', () => {
    const odd = 0.1 + 0.2;
    const doc = seeded([set('accounts', { ...ACCOUNT, balance: odd })]);
    expect(stored(doc, 'accounts', 'A').balance).toBe(odd);
  });

  it.each(FIELDS)('%s/%s.%s: a set under an id with stale keys reads back as sent', (c, id, f) => {
    let doc = adjustAll(base3(), 30.5);
    doc = apply(doc, { op: 'delete', collection: c, id });
    const fixture = { accounts: ACCOUNT, goals: GOAL, assets: ASSET }[c] as AnyRec;
    const entity = { ...fixture, ...withValue(f, 5) };
    const res = applyMutation(doc, { op: 'set', collection: c, id, entity });
    expect(res.result).toBe(entity); // the echo is the caller's entity
    expect(valueAt(projected(res.doc, c, id), f)).toBe(5);
    expect(valueAt(stored(res.doc, c, id), f)).toBe(-25.5); // raw = 5 − 30.5
  });
});

// ─── Two devices ─────────────────────────────────────────────────────────────

describe('two devices: adjustments and absolute writes merge', () => {
  it('an unrelated field edit on one device leaves a concurrent adjustment on the other', () => {
    // Both devices already hold an adjustment (Σ = -5): the edit carries the folded 95.
    const { a, b } = fork(adjust(base3(), 'accounts', 'A', 'balance', -5));
    const a2 = apply(
      a,
      patch('accounts', 'A', { name: 'Renamed', balance: 95 }, { name: 'Car loan', balance: 95 })
    );
    const b2 = adjust(b, 'accounts', 'A', 'balance', -20.25);
    const merged = converge(a2, b2).a;
    expect(projected(merged, 'accounts', 'A')).toMatchObject({
      name: 'Renamed',
      balance: 74.75,
    });
  });

  it('a concurrent absolute write and adjustment merge to set + delta', () => {
    const { a, b } = fork(adjust(base3(), 'accounts', 'A', 'balance', -5)); // folded 95
    const a2 = apply(a, patch('accounts', 'A', { balance: 500 }, { balance: 95 }));
    const b2 = adjust(b, 'accounts', 'A', 'balance', -20.25);
    const merged = converge(a2, b2).a;
    expect(projected(merged, 'accounts', 'A')?.balance).toBe(479.75);
  });
});

// ─── Inputs are never mutated ────────────────────────────────────────────────

describe('the unfold copies, never mutates', () => {
  it('op.patch and op.base are deep-equal before and after', () => {
    const doc = adjustAll(base3(), -20.25);
    const prev = { ...LOAN, outstandingBalance: 79.75 };
    const op = patch(
      'assets',
      'L',
      { name: 'Home', loan: { ...prev, outstandingBalance: 60 } },
      { name: 'House', loan: prev }
    );
    const before = structuredClone(op);
    const res = applyMutation(doc, op);
    expect(op).toEqual(before);
    expect(valueAt(projected(res.doc, 'assets', 'L'), 'loan.outstandingBalance')).toBe(60);
  });

  it('op.entity is deep-equal before and after', () => {
    let doc = adjust(base3(), 'accounts', 'A', 'balance', -20);
    doc = apply(doc, { op: 'delete', collection: 'accounts', id: 'A' });
    const op: MutationOp = { op: 'set', collection: 'accounts', id: 'A', entity: { ...ACCOUNT } };
    const before = structuredClone(op);
    applyMutation(doc, op);
    expect(op).toEqual(before);
  });
});

// ─── Law 1 still runs ────────────────────────────────────────────────────────

describe('the Law-1 verify on a Counter entity', () => {
  it.each(FIELDS)('%s/%s.%s: a real change raises no verify note', (c, id, f) => {
    const doc = adjustAll(base3(), -20.25);
    const prev = { ...LOAN, outstandingBalance: 79.75 };
    const res = applyMutation(doc, patch(c, id, withValue(f, 42, prev), withValue(f, 79.75, prev)));
    expect(res.notes.filter((n) => n.action === 'reconcile_verify_failed')).toEqual([]);
  });

  it.each(FIELDS)(
    '%s/%s.%s: a forced verify failure falls back to the whole write, map untouched',
    (c, id, f) => {
      const doc = adjustAll(base3(), -20.25);
      const prev = { ...LOAN, outstandingBalance: 79.75 };
      verify.faulty = true;
      const res = applyMutation(
        doc,
        patch(c, id, withValue(f, 42, prev), withValue(f, 79.75, prev))
      );
      verify.faulty = false;
      expect(res.notes).toContainEqual(
        expect.objectContaining({ action: 'reconcile_verify_failed' })
      );
      expect(valueAt(projected(res.doc, c, id), f)).toBe(42);
      expect(counterMap(res.doc)).toEqual(counterMap(doc));
    }
  );
});
