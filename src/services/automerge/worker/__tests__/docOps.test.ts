import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Automerge from '@automerge/automerge';
import {
  COLLECTION_NAMES,
  MIGRATED_ROOT_KEYS,
  type FamilyDocument,
  type CollectionName,
} from '@/types/automerge';
import {
  migrateDoc,
  loadDoc,
  saveDoc,
  mergeDocs,
  applyMutation,
  materializeCollection,
  buildFullProjection,
  projectionDeltasBetween,
  getHeads,
  getChangesSince,
  applyChanges,
  frameChanges,
  unframeChanges,
  registerNamedOp,
  __resetNamedOpsForTesting,
  countRootConflicts,
  rootConflictSnapshot,
  rootConflictsSince,
  buildRebaseOps,
} from '../docOps';
import { MIGRATION_CHANGES } from '../migrationChanges';
import { deviceWriterIdFor, isDeviceWriterIdEphemeral, setDeviceWriterId } from '../docActor';
import {
  COUNTER_WRITES_DEFAULT,
  setCounterWrites,
  adjustField,
  counterStats,
  foldDoc,
  foldEntity,
  foldIndex,
} from '../counterFields';
import type { MutationOp, ProjectionDelta } from '../protocol';
import { calculateExtraPayment } from '@/utils/loanPayment';
import {
  TEST_DEVICE,
  apply,
  converge,
  fork,
  resetTestDevices,
  seeded,
  useTestDevices,
} from './twoDevices';

type Doc = Automerge.Doc<FamilyDocument>;
const base = (): Doc => migrateDoc(Automerge.init<FamilyDocument>());
const txn = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  amount: 10,
  updatedAt: '2026-01-01',
  ...extra,
});

describe('docOps — lifecycle', () => {
  it('migrate adds all missing collections; load/save round-trips', () => {
    const d = base();
    expect(d.transactions).toEqual({});
    expect(d.settings ?? null).toBeNull();
    const withOne = applyMutation(d, {
      op: 'set',
      collection: 'transactions',
      id: 't1',
      entity: txn('t1'),
    }).doc;
    const reloaded = loadDoc(saveDoc(withOne));
    expect(materializeCollection(reloaded, 'transactions', foldIndex(reloaded))).toEqual([
      ['t1', txn('t1')],
    ]);
  });
});

describe('docOps — change primitives (B1/B2 incremental)', () => {
  const setAcct = (doc: Doc, id: string, balance: number): Doc =>
    applyMutation(doc, { op: 'set', collection: 'accounts', id, entity: { id, balance } }).doc;

  it('frameChanges / unframeChanges round-trips a Uint8Array[] with boundaries intact', () => {
    const parts = [new Uint8Array([1, 2, 3]), new Uint8Array([]), new Uint8Array([9, 8, 7, 6])];
    const framed = frameChanges(parts);
    const back = unframeChanges(framed);
    expect(back).toHaveLength(3);
    expect(Array.from(back[0]!)).toEqual([1, 2, 3]);
    expect(Array.from(back[1]!)).toEqual([]);
    expect(Array.from(back[2]!)).toEqual([9, 8, 7, 6]);
  });

  it('unframeChanges throws on a truncated buffer (→ caught by cache recovery)', () => {
    const framed = frameChanges([new Uint8Array([1, 2, 3, 4])]);
    expect(() => unframeChanges(framed.subarray(0, framed.length - 2))).toThrow();
  });

  it('getChangesSince → frame → unframe → applyChanges reconstructs the same state', () => {
    const d0 = setAcct(base(), 'a1', 1);
    const heads0 = getHeads(d0);
    const d0bin = saveDoc(d0); // snapshot the base before d0's handle is consumed
    const d1 = setAcct(setAcct(d0, 'a2', 2), 'a3', 3);
    const framed = frameChanges(getChangesSince(d1, heads0));
    // Apply onto a FRESH base (the real cache-reload path: base from disk + increments).
    const rebuilt = applyChanges(loadDoc(d0bin), unframeChanges(framed)).doc;
    expect(materializeCollection(rebuilt, 'accounts', foldIndex(rebuilt))).toEqual(
      materializeCollection(d1, 'accounts', foldIndex(d1))
    );
  });

  it('applyChanges is idempotent — re-applying already-present changes is a no-op', () => {
    const d0 = setAcct(base(), 'a1', 1);
    const heads0 = getHeads(d0);
    const d1 = setAcct(d0, 'a2', 2);
    const d1bin = saveDoc(d1);
    const changes = getChangesSince(d1, heads0);
    const once = applyChanges(loadDoc(d1bin), changes).doc; // d1 already has these changes
    const expected = loadDoc(d1bin);
    expect(materializeCollection(once, 'accounts', foldIndex(once))).toEqual(
      materializeCollection(expected, 'accounts', foldIndex(expected))
    );
    expect(getHeads(once)).toEqual(getHeads(expected));
  });
});

describe('docOps — mutations', () => {
  it('set → upsert delta + entity result', () => {
    const { delta, result } = applyMutation(base(), {
      op: 'set',
      collection: 'accounts',
      id: 'a1',
      entity: { id: 'a1', balance: 100 },
    });
    expect(delta).toEqual({
      kind: 'upsert',
      collection: 'accounts',
      id: 'a1',
      entity: { id: 'a1', balance: 100 },
    });
    expect(result).toEqual({ id: 'a1', balance: 100 });
  });

  it('patch merges fields, honours deleteKeys + updatedAt', () => {
    let d = applyMutation(base(), {
      op: 'set',
      collection: 'todos',
      id: 'x',
      entity: { id: 'x', title: 'old', stale: 1 },
    }).doc;
    const { doc, delta } = applyMutation(d, {
      op: 'patch',
      collection: 'todos',
      id: 'x',
      patch: { title: 'new' },
      deleteKeys: ['stale'],
      updatedAt: '2026-02-02',
    });
    d = doc;
    expect(materializeCollection(d, 'todos', foldIndex(d))[0]![1]).toEqual({
      id: 'x',
      title: 'new',
      updatedAt: '2026-02-02',
    });
    expect((delta as { entity: unknown }).entity).toEqual({
      id: 'x',
      title: 'new',
      updatedAt: '2026-02-02',
    });
  });

  it('delete → remove delta', () => {
    const d = applyMutation(base(), {
      op: 'set',
      collection: 'goals',
      id: 'g',
      entity: { id: 'g' },
    }).doc;
    const { doc, delta } = applyMutation(d, { op: 'delete', collection: 'goals', id: 'g' });
    expect(materializeCollection(doc, 'goals', foldIndex(doc))).toEqual([]);
    expect(delta).toEqual({ kind: 'remove', collection: 'goals', id: 'g' });
  });

  it('increment is an atomic read-modify-write (reads the CURRENT value each time)', () => {
    let d = applyMutation(base(), {
      op: 'set',
      collection: 'accounts',
      id: 'a',
      entity: { id: 'a', balance: 100 },
    }).doc;
    d = applyMutation(d, {
      op: 'increment',
      collection: 'accounts',
      id: 'a',
      field: 'balance',
      delta: -10,
    }).doc;
    const { doc, result } = applyMutation(d, {
      op: 'increment',
      collection: 'accounts',
      id: 'a',
      field: 'balance',
      delta: -10,
    });
    // 100 → 90 → 80 (each increment reads the current balance, not a stale absolute)
    expect(
      (materializeCollection(doc, 'accounts', foldIndex(doc))[0]![1] as { balance: number }).balance
    ).toBe(80);
    expect((result as { balance: number }).balance).toBe(80);
  });

  it('batch is one atomic change → multi delta', () => {
    const d = applyMutation(base(), {
      op: 'set',
      collection: 'accounts',
      id: 'a',
      entity: { id: 'a', balance: 50 },
    }).doc;
    const { doc, delta } = applyMutation(d, {
      op: 'batch',
      ops: [
        { op: 'set', collection: 'transactions', id: 't', entity: txn('t') },
        { op: 'increment', collection: 'accounts', id: 'a', field: 'balance', delta: 10 },
      ],
    });
    expect(materializeCollection(doc, 'transactions', foldIndex(doc))).toHaveLength(1);
    expect(
      (materializeCollection(doc, 'accounts', foldIndex(doc))[0]![1] as { balance: number }).balance
    ).toBe(60);
    expect(delta.kind).toBe('multi');
    expect((delta as { deltas: ProjectionDelta[] }).deltas).toHaveLength(2);
  });

  it('a mid-batch failure commits NOTHING (atomicity)', () => {
    const d = base();
    expect(() =>
      applyMutation(d, {
        op: 'batch',
        ops: [
          { op: 'set', collection: 'transactions', id: 't', entity: txn('t') },
          { op: 'patch', collection: 'transactions', id: 'missing', patch: { x: 1 } }, // throws
        ],
      })
    ).toThrow(/not found/);
    // The original doc is untouched — the valid `set` did not leak through.
    expect(materializeCollection(d, 'transactions', foldIndex(d))).toEqual([]);
  });
});

describe('docOps — merge dirty (heads-derived)', () => {
  it('remote-ahead + local-clean → dirty false', () => {
    const b = base();
    const local = Automerge.clone(b);
    const remote = applyMutation(Automerge.clone(b), {
      op: 'set',
      collection: 'todos',
      id: 'r',
      entity: { id: 'r' },
    }).doc;
    const { dirty } = mergeDocs(local, remote);
    expect(dirty).toBe(false);
  });

  it('local carries an unsynced change → dirty true', () => {
    const b = base();
    const local = applyMutation(Automerge.clone(b), {
      op: 'set',
      collection: 'todos',
      id: 'l',
      entity: { id: 'l' },
    }).doc;
    const remote = Automerge.clone(b);
    const { dirty } = mergeDocs(local, remote);
    expect(dirty).toBe(true);
  });

  it('clean (local === remote) → dirty false', () => {
    const b = base();
    const { dirty } = mergeDocs(Automerge.clone(b), Automerge.clone(b));
    expect(dirty).toBe(false);
  });

  it('diverged (both carry own changes) → dirty true (local has changes remote lacks)', () => {
    const b = base();
    const local = applyMutation(Automerge.clone(b), {
      op: 'set',
      collection: 'todos',
      id: 'l',
      entity: { id: 'l' },
    }).doc;
    const remote = applyMutation(Automerge.clone(b), {
      op: 'set',
      collection: 'todos',
      id: 'r',
      entity: { id: 'r' },
    }).doc;
    const { dirty, doc } = mergeDocs(local, remote);
    expect(dirty).toBe(true);
    expect(Object.keys(doc.todos).sort()).toEqual(['l', 'r']); // both kept
  });

  it('merges in place into local without cloning → the device actorId stays stable', () => {
    // The old clone(local) minted a fresh random actorId per merge; merging in
    // place must preserve local's actor (one stable actor per device).
    const b = base();
    const local = applyMutation(Automerge.clone(b), {
      op: 'set',
      collection: 'todos',
      id: 'l',
      entity: { id: 'l' },
    }).doc;
    const localActor = Automerge.getActorId(local);
    const remote = applyMutation(Automerge.clone(b), {
      op: 'set',
      collection: 'todos',
      id: 'r',
      entity: { id: 'r' },
    }).doc;
    const { doc } = mergeDocs(local, remote);
    expect(Automerge.getActorId(doc)).toBe(localActor);
  });
});

describe('docOps — projectionDeltasBetween (poll-merge delta)', () => {
  const withTodo = (doc: Automerge.Doc<FamilyDocument>, id: string, extra = {}) =>
    applyMutation(doc, { op: 'set', collection: 'todos', id, entity: { id, ...extra } }).doc;

  it('emits an upsert only for the entity a merge brought in (not the whole doc)', () => {
    const origin = withTodo(base(), 'l1', { title: 'local' });
    const from = getHeads(origin);
    const remote = withTodo(Automerge.clone(origin), 'r1', { title: 'remote' });
    const { doc: merged, heads: to } = mergeDocs(origin, remote);

    const deltas = projectionDeltasBetween(merged, from, to);
    expect(deltas).toEqual([
      { kind: 'upsert', collection: 'todos', id: 'r1', entity: { id: 'r1', title: 'remote' } },
    ]);
  });

  it('emits a remove when the merge deletes an entity', () => {
    const origin = withTodo(withTodo(base(), 'a'), 'b');
    const from = getHeads(origin);
    const remote = applyMutation(Automerge.clone(origin), {
      op: 'delete',
      collection: 'todos',
      id: 'b',
    }).doc;
    const { doc: merged, heads: to } = mergeDocs(origin, remote);

    expect(projectionDeltasBetween(merged, from, to)).toEqual([
      { kind: 'remove', collection: 'todos', id: 'b' },
    ]);
  });

  it('emits a single settings delta when settings change', () => {
    __resetNamedOpsForTesting();
    const origin = base();
    const from = getHeads(origin);
    const remote = applyMutation(Automerge.clone(origin), {
      op: 'named',
      name: 'setSettings',
      args: { settings: { baseCurrency: 'GBP' } },
    }).doc;
    const { doc: merged, heads: to } = mergeDocs(origin, remote);

    const deltas = projectionDeltasBetween(merged, from, to);
    expect(deltas).toEqual([{ kind: 'settings', settings: { baseCurrency: 'GBP' } }]);
  });

  it('patchSettings merges into the document settings (never replaces), and deleteKeys clears', () => {
    __resetNamedOpsForTesting();
    let doc = applyMutation(base(), {
      op: 'named',
      name: 'setSettings',
      args: { settings: { baseCurrency: 'GBP', planToken: 'tok', theme: 'dark' } },
    }).doc;
    // A boot-time write that only knows one field must leave the others alone.
    doc = applyMutation(doc, {
      op: 'named',
      name: 'patchSettings',
      args: { patch: { exchangeRates: [], exchangeRateLastFetch: '2026-10-01T00:00:00.000Z' } },
    }).doc;
    expect(doc.settings).toMatchObject({
      baseCurrency: 'GBP',
      planToken: 'tok',
      theme: 'dark',
      exchangeRates: [],
    });
    doc = applyMutation(doc, {
      op: 'named',
      name: 'patchSettings',
      args: { patch: { theme: 'light' }, deleteKeys: ['planToken'] },
    }).doc;
    expect(doc.settings).toMatchObject({ baseCurrency: 'GBP', theme: 'light' });
    expect((doc.settings as unknown as Record<string, unknown>).planToken).toBeUndefined();
    // A document with no settings yet: the caller's defaults seed it, then the patch applies,
    // so the raw document carries the whole settings object (exports read it raw).
    const fresh = applyMutation(base(), {
      op: 'named',
      name: 'patchSettings',
      args: {
        patch: { onboardingCompleted: true },
        defaults: { baseCurrency: 'USD', theme: 'system' },
      },
    }).doc;
    expect(fresh.settings).toMatchObject({
      baseCurrency: 'USD',
      theme: 'system',
      onboardingCompleted: true,
    });
    // ...and never reset an existing object.
    const kept = applyMutation(fresh, {
      op: 'named',
      name: 'patchSettings',
      args: { patch: { theme: 'dark' }, defaults: { baseCurrency: 'SGD', theme: 'system' } },
    }).doc;
    expect(kept.settings).toMatchObject({ baseCurrency: 'USD', theme: 'dark' });
  });

  it('patchSettings from two devices on different fields both survive the merge', () => {
    __resetNamedOpsForTesting();
    const origin = applyMutation(base(), {
      op: 'named',
      name: 'setSettings',
      args: { settings: { baseCurrency: 'GBP', theme: 'dark' } },
    }).doc;
    const a = applyMutation(Automerge.clone(origin), {
      op: 'named',
      name: 'patchSettings',
      args: { patch: { planToken: 'tok' } },
    }).doc;
    const b = applyMutation(Automerge.clone(origin), {
      op: 'named',
      name: 'patchSettings',
      args: { patch: { exchangeRateLastFetch: '2026-10-01T00:00:00.000Z' } },
    }).doc;
    const { doc: merged } = mergeDocs(a, b);
    expect(merged.settings).toMatchObject({
      baseCurrency: 'GBP',
      theme: 'dark',
      planToken: 'tok',
      exchangeRateLastFetch: '2026-10-01T00:00:00.000Z',
    });
  });

  it('empty delta (no changes brought in) → empty array (not null)', () => {
    const origin = withTodo(base(), 'x');
    const heads = getHeads(origin);
    // diff against itself → nothing changed.
    expect(projectionDeltasBetween(origin, heads, heads)).toEqual([]);
  });

  it('ignores length-1 migrate patches (top-level collection creation)', () => {
    // A genuinely un-migrated origin: the diff from its heads includes the
    // length-1 migrate patches (collection roots, no id) that must be ignored.
    const rawOrigin = Automerge.init<FamilyDocument>(); // NOT migrated (no collections)
    const from = getHeads(rawOrigin);
    // remote descends from the same raw origin, is migrated, and adds a todo.
    const remote = withTodo(migrateDoc(Automerge.clone(rawOrigin)), 'r1');
    const { doc: merged, heads: to } = mergeDocs(rawOrigin, remote);
    // Only the real entity, never a bogus delta from the migrate creates.
    expect(projectionDeltasBetween(merged, from, to)).toEqual([
      { kind: 'upsert', collection: 'todos', id: 'r1', entity: { id: 'r1' } },
    ]);
  });

  it('returns null (→ caller falls back to full) on an unexpected top-level diff path', () => {
    // Force a patch whose path root is an unknown top-level key (path.length >= 2).
    const origin = base();
    const from = getHeads(origin);
    const remote = Automerge.change(Automerge.clone(origin), (d) => {
      (d as unknown as Record<string, Record<string, unknown>>).bogusCollection = {
        x: { id: 'x' },
      };
    });
    const { doc: merged, heads: to } = mergeDocs(origin, remote);
    expect(projectionDeltasBetween(merged, from, to)).toBeNull();
  });
});

describe('docOps — projection + named ops', () => {
  beforeEach(() => __resetNamedOpsForTesting());

  it('buildFullProjection emits a bulk-reset per collection + settings', () => {
    const d = applyMutation(base(), {
      op: 'set',
      collection: 'transactions',
      id: 't',
      entity: txn('t'),
    }).doc;
    const deltas = buildFullProjection(d);
    const txnDelta = deltas.find((x) => x.kind === 'bulk' && x.collection === 'transactions');
    expect(txnDelta).toMatchObject({ kind: 'bulk', reset: true, entities: [['t', txn('t')]] });
    expect(deltas.some((x) => x.kind === 'settings')).toBe(true);
  });

  it("patch onMissing:'create' inits an absent two-level slice (notificationReads)", () => {
    // Default (throw): patching an absent target throws.
    expect(() =>
      applyMutation(base(), {
        op: 'patch',
        collection: 'notificationReads',
        id: 'm1',
        patch: { n1: '2026-01-01' },
      })
    ).toThrow(/not found/);
    // 'create': the member sub-map is created then the keys applied.
    const { doc } = applyMutation(base(), {
      op: 'patch',
      collection: 'notificationReads',
      id: 'm1',
      patch: { n1: '2026-01-01' },
      onMissing: 'create',
    });
    expect(materializeCollection(doc, 'notificationReads', foldIndex(doc))).toEqual([
      ['m1', { n1: '2026-01-01' }],
    ]);
  });

  it("patch onMissing:'skip' is a delta-safe no-op on an absent entity (concurrent delete)", () => {
    const d0 = base();
    const { doc, delta, result } = applyMutation(d0, {
      op: 'patch',
      collection: 'accounts',
      id: 'gone',
      patch: { name: 'X' },
      onMissing: 'skip',
    });
    // No throw; nothing created; echoes undefined; delta is a `remove` (not an
    // upsert of undefined, which would throw in toPlain).
    expect(materializeCollection(doc, 'accounts', foldIndex(doc))).toEqual([]);
    expect(result).toBeUndefined();
    expect(delta).toEqual({ kind: 'remove', collection: 'accounts', id: 'gone' });
  });

  it("increment stamps updatedAt and onMissing:'skip' no-ops on an absent entity", () => {
    // Seed an account, then increment its balance with an updatedAt.
    let d = applyMutation(base(), {
      op: 'set',
      collection: 'accounts',
      id: 'a1',
      entity: { id: 'a1', balance: 100, updatedAt: '2026-01-01' },
    }).doc;
    d = applyMutation(d, {
      op: 'increment',
      collection: 'accounts',
      id: 'a1',
      field: 'balance',
      delta: -30,
      updatedAt: '2026-02-02',
    }).doc;
    expect(materializeCollection(d, 'accounts', foldIndex(d))[0]![1]).toEqual({
      id: 'a1',
      balance: 70,
      updatedAt: '2026-02-02',
    });
    // Absent entity + skip → delta-safe no-op.
    const skip = applyMutation(d, {
      op: 'increment',
      collection: 'accounts',
      id: 'gone',
      field: 'balance',
      delta: 5,
      onMissing: 'skip',
    });
    expect(skip.result).toBeUndefined();
    expect(skip.delta).toEqual({ kind: 'remove', collection: 'accounts', id: 'gone' });
    // Default (throw) still rejects.
    expect(() =>
      applyMutation(d, {
        op: 'increment',
        collection: 'accounts',
        id: 'gone',
        field: 'balance',
        delta: 5,
      })
    ).toThrow(/not found/);
  });

  it('a batch that deletes then patches the same id does not throw (deltaFor guard)', () => {
    const seeded = applyMutation(base(), {
      op: 'set',
      collection: 'todos',
      id: 't1',
      entity: { id: 't1', title: 'old' },
    }).doc;
    // delete t1, then patch t1 with skip → the patch is a no-op; deltaFor must
    // emit `remove`, not toPlain(undefined) (which would throw).
    expect(() =>
      applyMutation(seeded, {
        op: 'batch',
        ops: [
          { op: 'delete', collection: 'todos', id: 't1' },
          {
            op: 'patch',
            collection: 'todos',
            id: 't1',
            patch: { title: 'new' },
            onMissing: 'skip',
          },
        ],
      })
    ).not.toThrow();
  });

  it('named op runs its registered handler and contributes its delta', () => {
    registerNamedOp('tagTodo', (draft, args) => {
      const id = args.id as string;
      (draft.todos as unknown as Record<string, Record<string, unknown>>)[id]!.tagged = true;
      return {
        deltas: [{ kind: 'upsert', collection: 'todos', id, entity: { id, tagged: true } }],
      };
    });
    const d = applyMutation(base(), {
      op: 'set',
      collection: 'todos',
      id: 'x',
      entity: { id: 'x' },
    }).doc;
    const { doc, delta } = applyMutation(d, { op: 'named', name: 'tagTodo', args: { id: 'x' } });
    expect(
      (materializeCollection(doc, 'todos', foldIndex(doc))[0]![1] as { tagged: boolean }).tagged
    ).toBe(true);
    expect(delta).toEqual({
      kind: 'upsert',
      collection: 'todos',
      id: 'x',
      entity: { id: 'x', tagged: true },
    });
  });
});

describe('docOps — core domain named ops (financial atomic RMW)', () => {
  const goal = (extra: Record<string, unknown> = {}) => ({
    id: 'g',
    currentAmount: 50,
    targetAmount: 100,
    isCompleted: false,
    updatedAt: '2026-01-01',
    ...extra,
  });

  it('applyGoalContribution adds, and a top-level named op returns the echoed entity', () => {
    const d = applyMutation(base(), {
      op: 'set',
      collection: 'goals',
      id: 'g',
      entity: goal(),
    }).doc;
    const { doc, result, delta } = applyMutation(d, {
      op: 'named',
      name: 'applyGoalContribution',
      args: { id: 'g', delta: 30 },
    });
    expect((result as { currentAmount: number }).currentAmount).toBe(80);
    expect((result as { isCompleted: boolean }).isCompleted).toBe(false);
    expect(delta).toMatchObject({ kind: 'upsert', collection: 'goals', id: 'g' });
    expect(
      (materializeCollection(doc, 'goals', foldIndex(doc))[0]![1] as { currentAmount: number })
        .currentAmount
    ).toBe(80);
  });

  it('applyGoalContribution auto-completes at target and floors at 0', () => {
    // Auto-complete: 50 → 110 ≥ target 100.
    const d0 = applyMutation(base(), {
      op: 'set',
      collection: 'goals',
      id: 'g',
      entity: goal(),
    }).doc;
    const completed = applyMutation(d0, {
      op: 'named',
      name: 'applyGoalContribution',
      args: { id: 'g', delta: 60 },
    });
    expect(completed.result as { currentAmount: number; isCompleted: boolean }).toMatchObject({
      currentAmount: 110,
      isCompleted: true,
    });
    // Floor (fresh doc — Automerge freezes a doc once changed): a big reversal
    // cannot drive the amount negative.
    const d1 = applyMutation(base(), {
      op: 'set',
      collection: 'goals',
      id: 'g',
      entity: goal(),
    }).doc;
    const floored = applyMutation(d1, {
      op: 'named',
      name: 'applyGoalContribution',
      args: { id: 'g', delta: -500 },
    }).doc;
    expect(
      (
        materializeCollection(floored, 'goals', foldIndex(floored))[0]![1] as {
          currentAmount: number;
        }
      ).currentAmount
    ).toBe(0);
  });

  it('applyLoanPayment amortizes an account-backed loan and reverse restores it', () => {
    const acct = { id: 'acc', type: 'loan', balance: 1000, interestRate: 12, currency: 'USD' };
    let d = applyMutation(base(), {
      op: 'set',
      collection: 'accounts',
      id: 'acc',
      entity: acct,
    }).doc;
    const pay = applyMutation(d, {
      op: 'named',
      name: 'applyLoanPayment',
      args: { loanId: 'acc', paymentAmount: 100, isRecurring: true },
    });
    // monthlyRate 0.01 → interest 10, principal 90, newBalance 910
    expect(pay.result).toMatchObject({
      applied: true,
      hostCollection: 'accounts',
      interestPortion: 10,
      principalPortion: 90,
    });
    d = pay.doc;
    expect(
      (materializeCollection(d, 'accounts', foldIndex(d))[0]![1] as { balance: number }).balance
    ).toBe(910);

    const rev = applyMutation(d, {
      op: 'named',
      name: 'reverseLoanPayment',
      args: { loanId: 'acc', principalToRestore: 90 },
    });
    expect(
      (materializeCollection(rev.doc, 'accounts', foldIndex(rev.doc))[0]![1] as { balance: number })
        .balance
    ).toBe(1000);
  });

  it('applyLoanPayment writes the NESTED asset-loan balance (extra payment)', () => {
    const asset = {
      id: 'ast',
      name: 'Car',
      currency: 'USD',
      loan: { hasLoan: true, outstandingBalance: 5000, interestRate: 6, monthlyPayment: 200 },
    };
    const d = applyMutation(base(), {
      op: 'set',
      collection: 'assets',
      id: 'ast',
      entity: asset,
    }).doc;
    const { doc, result } = applyMutation(d, {
      op: 'named',
      name: 'applyLoanPayment',
      args: { loanId: 'ast', paymentAmount: 200, isRecurring: false },
    });
    expect((result as { principalPortion: number }).principalPortion).toBe(200);
    const host = materializeCollection(doc, 'assets', foldIndex(doc))[0]![1] as {
      loan: { outstandingBalance: number };
    };
    expect(host.loan.outstandingBalance).toBe(4800);
  });

  it('applyLoanPayment on an unknown/paid-off loan is a no-op (applied:false)', () => {
    const { result, delta } = applyMutation(base(), {
      op: 'named',
      name: 'applyLoanPayment',
      args: { loanId: 'missing', paymentAmount: 100, isRecurring: true },
    });
    expect(result).toEqual({ applied: false });
    expect(delta).toEqual({ kind: 'multi', deltas: [] });
  });
});

// ─── #117 Phase 2: the relative writes behind `adjustField` ──────────────────
//
// The cases above run with the switch OFF (the shipped default) and pass unchanged: the dormant
// path is today's absolute read-modify-write, in minor units. The two-device merges with writes
// ON live in `counterMerge.test.ts`.

describe('docOps — relative writes through adjustField (#117 Phase 2)', () => {
  beforeEach(() => useTestDevices());
  afterEach(() => {
    setCounterWrites(null);
    resetTestDevices();
  });

  const AT = '2026-10-03T10:00:00.000Z';
  const entry = (id: string, amount: number, note?: string) => ({
    id,
    amount,
    at: AT,
    updatedBy: 'member-1',
    ...(note ? { note } : {}),
  });
  const goalDoc = (extra: Record<string, unknown> = {}): Doc =>
    seeded([
      {
        op: 'set',
        collection: 'goals',
        id: 'g',
        entity: { id: 'g', currentAmount: 50, targetAmount: 100, isCompleted: false, ...extra },
      },
    ]);
  const contribute = (doc: Doc, args: Record<string, unknown>) =>
    applyMutation(doc, { op: 'named', name: 'applyGoalContribution', args: { id: 'g', ...args } });
  const goalOf = (doc: Doc) =>
    materializeCollection(doc, 'goals', foldIndex(doc))[0]![1] as {
      currentAmount: number;
      isCompleted: boolean;
      manualContributions?: Array<Record<string, unknown>>;
    };

  describe('applyGoalContribution history args', () => {
    it('appends the entry in the same change, creating the array when absent', () => {
      const r = contribute(goalDoc(), { delta: 30, contribution: entry('c1', 30, 'birthday') });
      expect(r.result).toMatchObject({
        currentAmount: 80,
        manualContributions: [entry('c1', 30, 'birthday')],
      });
      expect(goalOf(r.doc).manualContributions).toEqual([entry('c1', 30, 'birthday')]);
      const r2 = contribute(r.doc, { delta: 5.25, contribution: entry('c2', 5.25) });
      expect(goalOf(r2.doc)).toMatchObject({ currentAmount: 85.25 });
      expect(goalOf(r2.doc).manualContributions!.map((c) => c.id)).toEqual(['c1', 'c2']);
    });

    it('records the APPLIED amount: a reversal past zero is floored, and so is its entry', () => {
      const r = contribute(goalDoc(), { delta: -80, contribution: entry('c1', -80) });
      expect(goalOf(r.doc).currentAmount).toBe(0);
      expect(goalOf(r.doc).manualContributions).toEqual([entry('c1', -50)]);
    });

    it('a retried contribution id is a full no-op: no second amount, no second entry, no write', () => {
      const once = contribute(goalDoc(), { delta: 30, contribution: entry('c1', 30) });
      const heads = getHeads(once.doc);
      const again = contribute(once.doc, { delta: 30, contribution: entry('c1', 30) });
      expect(getHeads(again.doc)).toEqual(heads);
      expect(again.result).toMatchObject({ currentAmount: 80 });
      expect(goalOf(again.doc).manualContributions).toHaveLength(1);
    });

    it('a zero applied delta appends nothing (a reversal on an empty goal, or a zero delta)', () => {
      const empty = contribute(goalDoc({ currentAmount: 0 }), {
        delta: -10,
        contribution: entry('c1', -10),
      });
      expect(goalOf(empty.doc).currentAmount).toBe(0);
      expect(goalOf(empty.doc).manualContributions).toBeUndefined();
      const zero = contribute(goalDoc({ manualContributions: [] }), {
        delta: 0,
        contribution: entry('c2', 0),
      });
      expect(goalOf(zero.doc)).toMatchObject({ currentAmount: 50, manualContributions: [] });
    });

    it('undo splices exactly that entry by id and reverses its amount', () => {
      let d = contribute(goalDoc(), { delta: 30, contribution: entry('c1', 30) }).doc;
      d = contribute(d, { delta: 20, contribution: entry('c2', 20) }).doc;
      const undone = contribute(d, { delta: -30, undoContributionId: 'c1' });
      expect(goalOf(undone.doc).currentAmount).toBe(70);
      expect(goalOf(undone.doc).manualContributions).toEqual([entry('c2', 20)]);
    });

    it('an undo whose entry is absent is a full no-op: no amount, no history edit, no write', () => {
      let d = contribute(goalDoc(), { delta: 30, contribution: entry('c1', 30) }).doc;
      d = contribute(d, { delta: 20, contribution: entry('c2', 20) }).doc;
      d = contribute(d, { delta: -30, undoContributionId: 'c1' }).doc;
      const heads = getHeads(d);
      // A second undo of the same id, and an undo of an id that never existed.
      for (const undoContributionId of ['c1', 'nope']) {
        const again = contribute(d, { delta: -30, undoContributionId });
        expect(getHeads(again.doc)).toEqual(heads);
        expect(again.result).toMatchObject({ currentAmount: 70 });
        expect(goalOf(again.doc).manualContributions).toEqual([entry('c2', 20)]);
      }
      // A goal with no history at all: still nothing moves.
      const g = goalDoc();
      const bare = contribute(g, { delta: -10, undoContributionId: 'c9' });
      expect(getHeads(bare.doc)).toEqual(getHeads(g));
      expect(goalOf(bare.doc).currentAmount).toBe(50);
    });

    it("a stored NEGATIVE amount (pre-Phase-2 history): writes off keeps today's write-time floor", () => {
      // Today: `Math.max(0, current + delta)` = max(0, -30 + 10) = 0 is what is stored.
      setCounterWrites(false);
      const off = contribute(goalDoc({ currentAmount: -30 }), { delta: 10 });
      expect(off.doc.goals.g!.currentAmount).toBe(0);
      expect(goalOf(off.doc).currentAmount).toBe(0);
      // Writes on: the stored -30 stays (a baseline is never rewritten), the Counter holds the
      // applied +10 (the folded amount was 0, so the floor did not trim it), and the READ floor
      // shows max(0, -30 + 10) = 0, the same number.
      setCounterWrites(true);
      const on = contribute(goalDoc({ currentAmount: -30 }), { delta: 10 });
      expect(on.doc.goals.g!.currentAmount).toBe(-30);
      expect(Object.values(on.doc.counterDeltas).map((c) => c.value)).toEqual([1000]);
      expect(goalOf(on.doc).currentAmount).toBe(0);
    });

    it('auto-completes on the folded amount and never un-completes', () => {
      const done = contribute(goalDoc(), { delta: 50 });
      expect(goalOf(done.doc)).toMatchObject({ currentAmount: 100, isCompleted: true });
      const back = contribute(done.doc, { delta: -40 });
      expect(goalOf(back.doc)).toMatchObject({ currentAmount: 60, isCompleted: true });
    });

    it.each([
      [{ delta: 'ten' }, /`delta` must be a finite number/],
      [{ delta: Number.NaN }, /`delta` must be a finite number/],
      [{ delta: 1, contribution: { id: 'c1', amount: 1 } }, /`contribution` must be a Goal/],
      [{ delta: 1, contribution: { ...entry('c1', 1), note: 7 } }, /`contribution` must be/],
      [{ delta: 1, undoContributionId: '' }, /`undoContributionId` must be a non-empty/],
      [{ delta: 1, contribution: entry('c1', 1), undoContributionId: 'c0' }, /never both/],
    ])('a malformed args shape throws and commits nothing (%o)', (args, message) => {
      const d = goalDoc();
      expect(() => contribute(d, args)).toThrow(message);
      expect(goalOf(d).currentAmount).toBe(50);
    });

    it('drops a key main added by mistake rather than writing it into the history', () => {
      const r = contribute(goalDoc(), {
        delta: 1,
        contribution: { ...entry('c1', 1), stray: 'x', note: undefined },
      });
      expect(goalOf(r.doc).manualContributions).toEqual([entry('c1', 1)]);
    });
  });

  it('increment: an unknown field throws before the existence check, even on skip', () => {
    expect(() =>
      applyMutation(base(), {
        op: 'increment',
        collection: 'accounts',
        id: 'gone',
        field: 'balanec',
        delta: 1,
        onMissing: 'skip',
      })
    ).toThrow(/not a Counter field of "accounts"/);
  });

  it('named handlers receive `${device}:${actor}` as ctx.writerId', () => {
    let seen: string | undefined;
    registerNamedOp('probeCtx', (_draft, _args, ctx) => {
      seen = ctx.writerId;
      return { deltas: [] };
    });
    const d = base();
    applyMutation(d, { op: 'named', name: 'probeCtx', args: {} });
    expect(seen).toBe(`${TEST_DEVICE}:${Automerge.getActorId(d)}`);
  });

  describe('no family cache opened: an EPHEMERAL device id, never a throw', () => {
    const accountDoc = () =>
      seeded([{ op: 'set', collection: 'accounts', id: 'a', entity: { id: 'a', balance: 100 } }]);
    const inc = (delta: number) =>
      ({ op: 'increment', collection: 'accounts', id: 'a', field: 'balance', delta }) as const;
    const keyWriters = (doc: Doc) =>
      Object.keys(doc.counterDeltas).map((k) => k.slice(k.lastIndexOf('/') + 1));

    beforeEach(() => {
      resetTestDevices(); // the realm's own id, as production
      setDeviceWriterId(null); // and no cache: nothing persisted was ever posted
      setCounterWrites(true);
    });
    afterEach(() => setDeviceWriterId(null));

    it('a write with writes on keys under the ephemeral id; the rebase replays it as own', () => {
      const origin = accountDoc();
      const baseline = getHeads(origin);
      const peer = apply(Automerge.clone(origin), inc(-1));
      expect(isDeviceWriterIdEphemeral()).toBe(true);
      const eph = deviceWriterIdFor(Automerge.getActorId(peer));
      expect(keyWriters(peer)).toEqual([`${eph}:${Automerge.getActorId(peer)}`]);
      // Same session, a compacted target: the ephemeral keys are this device's own.
      const target = Automerge.from({
        ...(foldDoc(origin) as object),
        podLineage: { id: 'L-NEW', seq: 1 },
      }) as unknown as Doc;
      const built = buildRebaseOps(peer, baseline, target)!;
      expect(built.op).toMatchObject({ op: 'increment', id: 'a', delta: -1 });
      expect(built.counterIncrements).toBe(1);
    });

    it('once the cache posts its persisted id, new keys use it (the ephemeral id is dropped)', () => {
      let doc = apply(accountDoc(), inc(-1));
      const eph = deviceWriterIdFor('x');
      setDeviceWriterId('persisted-device');
      expect(isDeviceWriterIdEphemeral()).toBe(false);
      doc = apply(Automerge.clone(doc), inc(-2));
      const writers = keyWriters(doc).map((w) => w.slice(0, w.indexOf(':')));
      expect(writers.sort()).toEqual([eph, 'persisted-device'].sort());
      // The old ephemeral key is now foreign to this realm: only the persisted one replays.
      expect(deviceWriterIdFor('x')).toBe('persisted-device');
    });
  });

  it('a loan payment written dormant lands on res.newBalance exactly (no float drift)', () => {
    // 1.2 − 1.1: `calculateExtraPayment` returns round2's 0.1, and today's float add
    // `cur + (newBalance − cur)` would store 0.10000000000000009.
    const want = calculateExtraPayment(1.2, 1.1).newBalance;
    expect(1.2 + (want - 1.2)).not.toBe(want);
    const d = seeded([
      {
        op: 'set',
        collection: 'assets',
        id: 'ast',
        entity: {
          id: 'ast',
          loan: { hasLoan: true, outstandingBalance: 1.2, interestRate: 0, monthlyPayment: 1 },
        },
      },
    ]);
    const r = applyMutation(d, {
      op: 'named',
      name: 'applyLoanPayment',
      args: { loanId: 'ast', paymentAmount: 1.1, isRecurring: false },
    });
    expect(
      (r.doc.assets as unknown as Record<string, AnyRecLoan>).ast!.loan.outstandingBalance
    ).toBe(want);
  });

  it('the dormant path never touches the counterDeltas map', () => {
    expect(COUNTER_WRITES_DEFAULT).toBe(false);
    const d = apply(
      seeded([
        { op: 'set', collection: 'accounts', id: 'a', entity: { id: 'a', balance: 100 } },
        {
          op: 'set',
          collection: 'accounts',
          id: 'loan',
          entity: { id: 'loan', type: 'loan', balance: 1000, interestRate: 12 },
        },
        { op: 'set', collection: 'goals', id: 'g', entity: { id: 'g', currentAmount: 5 } },
      ]),
      { op: 'increment', collection: 'accounts', id: 'a', field: 'balance', delta: -20.25 },
      { op: 'named', name: 'applyGoalContribution', args: { id: 'g', delta: 1.5 } },
      {
        op: 'named',
        name: 'applyLoanPayment',
        args: { loanId: 'loan', paymentAmount: 100, isRecurring: true },
      },
      { op: 'named', name: 'reverseLoanPayment', args: { loanId: 'loan', principalToRestore: 90 } }
    );
    expect(Object.keys(d.counterDeltas)).toEqual([]);
    expect(read(d, 'accounts', 'a').balance).toBe(79.75);
    expect(read(d, 'goals', 'g').currentAmount).toBe(6.5);
    expect(read(d, 'accounts', 'loan').balance).toBe(1000);
  });

  it('with writes on, each op writes its own key and leaves the baseline alone', () => {
    setCounterWrites(true);
    const d = apply(
      seeded([
        { op: 'set', collection: 'accounts', id: 'a', entity: { id: 'a', balance: 100 } },
        {
          op: 'set',
          collection: 'goals',
          id: 'g',
          entity: { id: 'g', currentAmount: 50, targetAmount: 100, isCompleted: false },
        },
        {
          op: 'set',
          collection: 'assets',
          id: 'ast',
          entity: { id: 'ast', loan: { hasLoan: true, outstandingBalance: 100, interestRate: 0 } },
        },
      ]),
      { op: 'increment', collection: 'accounts', id: 'a', field: 'balance', delta: -20.25 },
      {
        op: 'named',
        name: 'applyGoalContribution',
        args: { id: 'g', delta: 60, contribution: entry('c1', 60) },
      },
      {
        op: 'named',
        name: 'applyLoanPayment',
        args: { loanId: 'ast', paymentAmount: 30.5, isRecurring: false },
      }
    );
    // `${collection}/${id}/${field}@${decimals}/${device}:${actor}`, cents (no currency set).
    const writer = `${TEST_DEVICE}:${Automerge.getActorId(d)}`;
    expect(JSON.parse(JSON.stringify(d.counterDeltas))).toEqual({
      [`accounts/a/balance@2/${writer}`]: -2025,
      [`goals/g/currentAmount@2/${writer}`]: 6000,
      [`assets/ast/loan.outstandingBalance@2/${writer}`]: -3050,
    });
    expect(read(d, 'accounts', 'a').balance).toBe(100);
    expect(read(d, 'goals', 'g')).toMatchObject({ currentAmount: 50, isCompleted: true });
    expect(goalOf(d)).toMatchObject({ currentAmount: 110, manualContributions: [entry('c1', 60)] });
    expect(
      (materializeCollection(d, 'assets', foldIndex(d))[0]![1] as AnyRecLoan).loan
        .outstandingBalance
    ).toBe(69.5);
    expect(counterStats(d)).toMatchObject({ keys: 3, conflicts: 0, malformed: 0 });
  });
});

type AnyRecLoan = { loan: { outstandingBalance: number } };

// ─── #117: merge-safe writes through `patch` / `patchSettings` ───────────────
//
// Every test forks one document onto two devices (`twoDevices.ts`), writes on both the way the
// stores do (a `patch` carrying the `base` the store built it from), converges, and asserts
// both edits survived. The `residual:` tests pin the accepted last-writer-wins cases listed in
// the plan (`docs/plans/2026-10-01-crdt-merge-safe-writes.md`, "Residual"), so a change in
// their behaviour is a visible test change, not a silent one.

type AnyRec = Record<string, unknown>;

/** A `patch` op as the repositories send it: the new values plus the snapshot they came from. */
const patchOp = (
  collection: CollectionName,
  id: string,
  patch: AnyRec,
  snapshot?: AnyRec,
  extra: Partial<Extract<MutationOp, { op: 'patch' }>> = {}
): MutationOp => ({
  op: 'patch',
  collection,
  id,
  patch,
  ...(snapshot ? { base: snapshot } : {}),
  ...extra,
});

const setOp = (collection: CollectionName, entity: AnyRec): MutationOp => ({
  op: 'set',
  collection,
  id: entity.id as string,
  entity,
});

const settingsOp = (args: AnyRec): MutationOp => ({ op: 'named', name: 'patchSettings', args });

/** One entity, read plain. */
const read = (doc: Doc, collection: CollectionName, id: string): AnyRec =>
  JSON.parse(JSON.stringify((doc[collection] as AnyRec)[id])) as AnyRec;

const readSettings = (doc: Doc): AnyRec => JSON.parse(JSON.stringify(doc.settings)) as AnyRec;

const item = (id: string, text: string, checked = false) => ({ id, text, checked });

describe('docOps — merge-safe writes (#117)', () => {
  beforeEach(() => __resetNamedOpsForTesting());

  const items0 = [item('i1', 'milk'), item('i2', 'eggs')];
  const list0 = { id: 'L', title: 'Shopping', items: items0 };

  it('list: a tick on A and an add on B both survive', () => {
    const { a, b } = fork(seeded([setOp('lists', list0)]));
    const a1 = apply(
      a,
      patchOp('lists', 'L', { items: [item('i1', 'milk', true), items0[1]] }, { items: items0 })
    );
    const b1 = apply(
      b,
      patchOp('lists', 'L', { items: [...items0, item('i3', 'bread')] }, { items: items0 })
    );
    const { a: merged } = converge(a1, b1);
    expect(read(merged, 'lists', 'L').items).toEqual([
      item('i1', 'milk', true),
      item('i2', 'eggs'),
      item('i3', 'bread'),
    ]);
  });

  it('list: two quick ticks built from the same stale state on ONE device both land', () => {
    // The store reads `lists.value`, refreshed only after the write resolves, so the second
    // tap sends an array built from the pre-first-tap state, with that same state as `base`.
    let doc = seeded([setOp('lists', list0)]);
    doc = apply(
      doc,
      patchOp('lists', 'L', { items: [item('i1', 'milk', true), items0[1]] }, { items: items0 })
    );
    doc = apply(
      doc,
      patchOp('lists', 'L', { items: [items0[0], item('i2', 'eggs', true)] }, { items: items0 })
    );
    expect(read(doc, 'lists', 'L').items).toEqual([
      item('i1', 'milk', true),
      item('i2', 'eggs', true),
    ]);
  });

  it('vacation: two members voting on one idea both count (key memberId)', () => {
    const ideas0 = [{ id: 'idea', title: 'Beach', votes: [] as AnyRec[] }];
    const { a, b } = fork(seeded([setOp('vacations', { id: 'V', ideas: ideas0 })]));
    const vote = (memberId: string) => [{ ...ideas0[0], votes: [{ memberId }] }];
    const a1 = apply(a, patchOp('vacations', 'V', { ideas: vote('m1') }, { ideas: ideas0 }));
    const b1 = apply(b, patchOp('vacations', 'V', { ideas: vote('m2') }, { ideas: ideas0 }));
    const { a: merged } = converge(a1, b1);
    const votes = (read(merged, 'vacations', 'V').ideas as Array<{ votes: AnyRec[] }>)[0]!.votes;
    expect(votes.map((v) => v.memberId).sort()).toEqual(['m1', 'm2']);
  });

  it('vacation: a segment edit on A and a segment add on B both survive', () => {
    const segs0 = [{ id: 's1', from: 'SIN', to: 'NRT' }];
    const { a, b } = fork(seeded([setOp('vacations', { id: 'V', travelSegments: segs0 })]));
    const a1 = apply(
      a,
      patchOp(
        'vacations',
        'V',
        { travelSegments: [{ ...segs0[0], from: 'KUL' }] },
        { travelSegments: segs0 }
      )
    );
    const b1 = apply(
      b,
      patchOp(
        'vacations',
        'V',
        { travelSegments: [...segs0, { id: 's2', from: 'NRT', to: 'SIN' }] },
        { travelSegments: segs0 }
      )
    );
    const { a: merged } = converge(a1, b1);
    expect(read(merged, 'vacations', 'V').travelSegments).toEqual([
      { id: 's1', from: 'KUL', to: 'NRT' },
      { id: 's2', from: 'NRT', to: 'SIN' },
    ]);
  });

  it('activity: two duty ticks on different dates both survive (key date)', () => {
    const { a, b } = fork(seeded([setOp('activities', { id: 'A1', dropoffCompletions: [] })]));
    const tick = (date: string, memberId: string) =>
      patchOp(
        'activities',
        'A1',
        { dropoffCompletions: [{ date, memberId }] },
        { dropoffCompletions: [] }
      );
    const { a: merged } = converge(
      apply(a, tick('2026-10-01', 'm1')),
      apply(b, tick('2026-10-02', 'm2'))
    );
    const done = read(merged, 'activities', 'A1').dropoffCompletions as AnyRec[];
    expect(done.map((c) => c.date).sort()).toEqual(['2026-10-01', '2026-10-02']);
  });

  it('goal: contribution history appended on both devices keeps both entries', () => {
    const { a, b } = fork(seeded([setOp('goals', { id: 'G', manualContributions: [] })]));
    const add = (id: string, amount: number) =>
      patchOp('goals', 'G', { manualContributions: [{ id, amount }] }, { manualContributions: [] });
    const { a: merged } = converge(apply(a, add('c1', 10)), apply(b, add('c2', 20)));
    const history = read(merged, 'goals', 'G').manualContributions as AnyRec[];
    expect(history.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
  });

  it('budget: two categories edited on two devices both survive (key categoryId)', () => {
    const cats0 = [
      { categoryId: 'food', amount: 100 },
      { categoryId: 'fun', amount: 50 },
    ];
    const { a, b } = fork(seeded([setOp('budgets', { id: 'B', categories: cats0 })]));
    const a1 = apply(
      a,
      patchOp(
        'budgets',
        'B',
        { categories: [{ categoryId: 'food', amount: 120 }, cats0[1]] },
        { categories: cats0 }
      )
    );
    const b1 = apply(
      b,
      patchOp(
        'budgets',
        'B',
        { categories: [cats0[0], { categoryId: 'fun', amount: 70 }] },
        { categories: cats0 }
      )
    );
    const { a: merged } = converge(a1, b1);
    expect(read(merged, 'budgets', 'B').categories).toEqual([
      { categoryId: 'food', amount: 120 },
      { categoryId: 'fun', amount: 70 },
    ]);
  });

  it('asset: a loan field edit on A and a loan payment on B both survive (loan is per key)', () => {
    const loan0 = { hasLoan: true, outstandingBalance: 5000, interestRate: 6, monthlyPayment: 200 };
    const asset0 = { id: 'ast', name: 'Car', currency: 'USD', loan: loan0 };
    const { a, b } = fork(seeded([setOp('assets', asset0)]));
    // AssetModal sends the whole `loan` it built; only `interestRate` changed.
    const a1 = apply(
      a,
      patchOp('assets', 'ast', { loan: { ...loan0, interestRate: 5 } }, { loan: loan0 })
    );
    const b1 = apply(b, {
      op: 'named',
      name: 'applyLoanPayment',
      args: { loanId: 'ast', paymentAmount: 200, isRecurring: false },
    });
    const { a: merged } = converge(a1, b1);
    expect(read(merged, 'assets', 'ast').loan).toEqual({
      ...loan0,
      interestRate: 5,
      outstandingBalance: 4800,
    });
  });

  describe('settings', () => {
    const usdGbp = { from: 'USD', to: 'GBP', rate: 0.8 };
    const settings0 = { baseCurrency: 'USD', exchangeRates: [usdGbp], aiApiKeys: {} };
    const seed = (): Doc =>
      seeded([{ op: 'named', name: 'setSettings', args: { settings: settings0 } }]);

    it('an exchange rate added on each device: both survive (key from|to)', () => {
      const { a, b } = fork(seed());
      const add = (to: string, rate: number) =>
        settingsOp({
          patch: { exchangeRates: [usdGbp, { from: 'USD', to, rate }] },
          base: { exchangeRates: [usdGbp] },
        });
      const { a: merged } = converge(apply(a, add('EUR', 0.9)), apply(b, add('SGD', 1.3)));
      const rates = readSettings(merged).exchangeRates as AnyRec[];
      expect(rates.map((r) => r.to).sort()).toEqual(['EUR', 'GBP', 'SGD']);
    });

    it('aiApiKeys for two providers set on two devices: both survive', () => {
      const { a, b } = fork(seed());
      const setKey = (provider: string, key: string) =>
        settingsOp({ patch: { aiApiKeys: { [provider]: key } }, base: { aiApiKeys: {} } });
      const { a: merged } = converge(
        apply(a, setKey('claude', 'k1')),
        apply(b, setKey('openai', 'k2'))
      );
      expect(readSettings(merged).aiApiKeys).toEqual({ claude: 'k1', openai: 'k2' });
    });

    it('a base-less patchSettings removes a rate (the document is the base)', () => {
      // The rebase sends no `base`; the composer's value must land exactly, removals included.
      const doc = apply(seed(), settingsOp({ patch: { exchangeRates: [] } }));
      expect(readSettings(doc).exchangeRates).toEqual([]);
    });

    it('a supplied base that lacks the key is additive: it never removes a rate it did not see', () => {
      // The #95 boot window: the projection is empty, so `base` is `{}`.
      const eur = { from: 'USD', to: 'EUR', rate: 0.9 };
      const doc = apply(seed(), settingsOp({ patch: { exchangeRates: [eur] }, base: {} }));
      // (A new item goes after its nearest preceding `next` neighbour, here the front.)
      expect(readSettings(doc).exchangeRates).toEqual([eur, usdGbp]);
    });

    it('updatedAt is stamped only when the patch wrote something', () => {
      const doc = seed();
      const heads = getHeads(doc);
      const same = apply(
        doc,
        settingsOp({ patch: { baseCurrency: 'USD' }, updatedAt: '2026-10-01T00:00:00.000Z' })
      );
      expect(getHeads(same)).toEqual(heads);
      expect(readSettings(same).updatedAt).toBeUndefined();
      const moved = apply(
        same,
        settingsOp({ patch: { baseCurrency: 'GBP' }, updatedAt: '2026-10-01T00:00:00.000Z' })
      );
      expect(readSettings(moved)).toMatchObject({
        baseCurrency: 'GBP',
        updatedAt: '2026-10-01T00:00:00.000Z',
      });
    });
  });

  it('a recurrence rule edited on both devices stays ONE whole rule (a value, never per key)', () => {
    const rule0 = { frequency: 'weekly', interval: 1, daysOfWeek: [1] };
    const ruleA = { frequency: 'weekly', interval: 2, daysOfWeek: [1] };
    const ruleB = { frequency: 'monthly', interval: 1, dayOfMonth: 15 };
    const { a, b } = fork(seeded([setOp('recurringItems', { id: 'R', rule: rule0 })]));
    const { a: merged } = converge(
      apply(a, patchOp('recurringItems', 'R', { rule: ruleA }, { rule: rule0 })),
      apply(b, patchOp('recurringItems', 'R', { rule: ruleB }, { rule: rule0 }))
    );
    expect([ruleA, ruleB]).toContainEqual(read(merged, 'recurringItems', 'R').rule);
  });

  it('a patch whose values all match writes nothing: heads unchanged, no updatedAt stamp', () => {
    const doc = seeded([setOp('lists', { ...list0, updatedAt: '2026-01-01' })]);
    const heads = getHeads(doc);
    const { doc: after, notes } = applyMutation(
      doc,
      patchOp(
        'lists',
        'L',
        { title: 'Shopping', items: items0 },
        { title: 'Shopping', items: items0 },
        { updatedAt: '2026-10-01', deleteKeys: ['notThere'] }
      )
    );
    expect(getHeads(after)).toEqual(heads);
    expect(read(after, 'lists', 'L').updatedAt).toBe('2026-01-01');
    expect(notes).toEqual([]);
  });

  it("onMissing:'create' counts as a write, so updatedAt is stamped even for an empty patch", () => {
    const { doc } = applyMutation(
      seeded(),
      patchOp('notificationReads', 'm1', {}, undefined, {
        onMissing: 'create',
        updatedAt: '2026-10-01',
      })
    );
    expect(read(doc, 'notificationReads', 'm1')).toEqual({ updatedAt: '2026-10-01' });
  });

  it('a non-object entity is a programming error and throws', () => {
    const doc = Automerge.change(seeded(), (d) => {
      (d.todos as unknown as AnyRec).bad = 'not an entity';
    });
    expect(() => applyMutation(doc, patchOp('todos', 'bad', { title: 'x' }))).toThrow(
      /is not an object/
    );
  });

  it('reconciler notes come back scoped to <collection>.<field>', () => {
    const doc = seeded([setOp('lists', list0)]);
    const { notes } = applyMutation(
      doc,
      patchOp('lists', 'L', { items: [...items0, items0[0]] }, { items: items0 })
    );
    expect(notes).toEqual([{ action: 'next_duplicate_keys', kind: 'lists.items', count: 1 }]);
  });

  // ─── Residual last-writer-wins, accepted and documented (each pinned) ──────

  it('residual: the same scalar changed on both devices keeps exactly one value', () => {
    const { a, b } = fork(seeded([setOp('lists', list0)]));
    const { a: merged } = converge(
      apply(a, patchOp('lists', 'L', { title: 'Groceries' }, { title: 'Shopping' })),
      apply(b, patchOp('lists', 'L', { title: 'Weekly shop' }, { title: 'Shopping' }))
    );
    expect(['Groceries', 'Weekly shop']).toContain(read(merged, 'lists', 'L').title);
  });

  it('residual: update vs remove of the same item: the item is gone', () => {
    const { a, b } = fork(seeded([setOp('lists', list0)]));
    const { a: merged } = converge(
      apply(
        a,
        patchOp('lists', 'L', { items: [items0[0], item('i2', 'brown eggs')] }, { items: items0 })
      ),
      apply(b, patchOp('lists', 'L', { items: [items0[0]] }, { items: items0 }))
    );
    expect(read(merged, 'lists', 'L').items).toEqual([items0[0]]);
  });

  it('residual: move vs update of the same item: the moved item keeps its old value', () => {
    const three = [...items0, item('i3', 'bread')];
    const { a, b } = fork(seeded([setOp('lists', { ...list0, items: three })]));
    const moved = [three[2], three[0], three[1]];
    const { a: merged } = converge(
      apply(a, patchOp('lists', 'L', { items: moved }, { items: three })),
      apply(
        b,
        patchOp('lists', 'L', { items: [three[0], three[1], item('i3', 'rye')] }, { items: three })
      )
    );
    // A move is a delete + insert of a copy, so B's edit landed on the deleted original. Only
    // the dragged item is exposed; the others did not move.
    expect(read(merged, 'lists', 'L').items).toEqual(moved);
  });

  it('residual: a keyless element edited on both devices leaves both edited versions', () => {
    const steps0 = ['boil water', 'add pasta'];
    const { a, b } = fork(seeded([setOp('recipes', { id: 'P', steps: steps0 })]));
    const edit = (step: string) =>
      patchOp('recipes', 'P', { steps: [steps0[0], step] }, { steps: steps0 });
    const { a: merged } = converge(
      apply(a, edit('add penne')),
      apply(b, edit('add pasta, salt well'))
    );
    const steps = read(merged, 'recipes', 'P').steps as string[];
    expect(steps).toHaveLength(3);
    expect(steps[0]).toBe('boil water');
    expect([...steps.slice(1)].sort()).toEqual(['add pasta, salt well', 'add penne']);
  });

  it('residual: the same member voting on two devices duplicates, and un-vote removes both', () => {
    const ideas0 = [{ id: 'idea', title: 'Beach', votes: [] as AnyRec[] }];
    const { a, b } = fork(seeded([setOp('vacations', { id: 'V', ideas: ideas0 })]));
    const voted = [{ ...ideas0[0], votes: [{ memberId: 'm1' }] }];
    const { a: merged } = converge(
      apply(a, patchOp('vacations', 'V', { ideas: voted }, { ideas: ideas0 })),
      apply(b, patchOp('vacations', 'V', { ideas: voted }, { ideas: ideas0 }))
    );
    const seen = read(merged, 'vacations', 'V').ideas as Array<{ votes: AnyRec[] }>;
    expect(seen[0]!.votes).toEqual([{ memberId: 'm1' }, { memberId: 'm1' }]);
    // `toggleIdeaVote` removes EVERY vote with that memberId, built from what the store shows.
    const unvoted = [{ ...ideas0[0], votes: [] }];
    const { doc: after, notes } = applyMutation(
      merged,
      patchOp('vacations', 'V', { ideas: unvoted }, { ideas: seen })
    );
    expect(read(after, 'vacations', 'V').ideas).toEqual(unvoted);
    expect(notes).toEqual([{ action: 'healed_duplicate_keys', kind: 'vacations.ideas', count: 1 }]);
  });

  it('residual: a derived scalar can disagree with the merged array until the next write', () => {
    const { a, b } = fork(seeded([setOp('lists', { ...list0, completed: false })]));
    // Each tick alone leaves one item unticked, so each write keeps `completed: false`.
    const { a: merged } = converge(
      apply(
        a,
        patchOp(
          'lists',
          'L',
          { items: [item('i1', 'milk', true), items0[1]], completed: false },
          { items: items0, completed: false }
        )
      ),
      apply(
        b,
        patchOp(
          'lists',
          'L',
          { items: [items0[0], item('i2', 'eggs', true)], completed: false },
          { items: items0, completed: false }
        )
      )
    );
    const list = read(merged, 'lists', 'L');
    expect((list.items as AnyRec[]).every((i) => i.checked)).toBe(true);
    expect(list.completed).toBe(false);
  });

  it('residual: first creation of an optional array on both devices keeps only one', () => {
    // The conflict is on the parent map's key, which no reconciler can fix.
    const { a, b } = fork(seeded([setOp('goals', { id: 'G' })]));
    const add = (id: string) =>
      patchOp('goals', 'G', { manualContributions: [{ id, amount: 10 }] }, {});
    const { a: merged } = converge(apply(a, add('c1')), apply(b, add('c2')));
    expect(read(merged, 'goals', 'G').manualContributions).toHaveLength(1);
  });
});

describe('docOps — deterministic collection creation (#117, plan F)', () => {
  /**
   * A pod written before `missing` shipped: every other collection exists, created by an
   * ordinary random-actor change, exactly as today's pods were.
   */
  const oldPod = (...missing: CollectionName[]): Doc =>
    Automerge.change(Automerge.init<FamilyDocument>(), (d) => {
      for (const name of COLLECTION_NAMES) {
        if (!missing.includes(name)) (d as unknown as AnyRec)[name] = {};
      }
    });
  const todo = (id: string): MutationOp => setOp('todos', { id, title: id });
  const lastChange = (doc: Doc) => Automerge.decodeChange(Automerge.getLastLocalChange(doc)!);

  it('every device creates an absent root map as the SAME object (the stored change)', () => {
    const one = migrateDoc(Automerge.init<FamilyDocument>());
    const two = migrateDoc(Automerge.init<FamilyDocument>());
    expect(Automerge.getActorId(one)).not.toBe(Automerge.getActorId(two));
    for (const name of MIGRATED_ROOT_KEYS) {
      expect(Automerge.getObjectId(one[name])).toBe(Automerge.getObjectId(two[name]));
    }
  });

  it('a doc with nothing missing comes back as the same handle with heads unchanged', () => {
    const doc = seeded([todo('t1')]);
    const heads = getHeads(doc);
    expect(migrateDoc(doc)).toBe(doc);
    expect(getHeads(doc)).toEqual(heads);
  });

  it('two devices migrating an old pod both write into ONE merged collection, no root conflict', () => {
    const { a, b } = fork(oldPod('todos'));
    // Divergent histories before the migration, as on two real devices.
    const a1 = apply(migrateDoc(apply(a, setOp('accounts', { id: 'acct-a' }))), todo('e1'));
    const b1 = apply(migrateDoc(apply(b, setOp('accounts', { id: 'acct-b' }))), todo('e2'));
    const { a: merged } = converge(a1, b1);
    expect(Object.keys(merged.todos).sort()).toEqual(['e1', 'e2']);
    expect(countRootConflicts(merged)).toBe(0);
  });

  describe('the Phase 2 counterDeltas map (#117 Phase 2)', () => {
    afterEach(() => setCounterWrites(null));

    it('two devices migrating an old pod get ONE counterDeltas object; keys written on both merge', () => {
      setCounterWrites(true);
      // An old pod: every collection present, no counterDeltas, one account at 100.
      const pod = apply(oldPod(), setOp('accounts', { id: 'A', balance: 100 }));
      expect(pod.counterDeltas).toBeUndefined();
      const { a, b } = fork(pod);
      // Divergent histories before the migration, as on two real devices.
      const a0 = migrateDoc(apply(a, setOp('todos', { id: 'ta', title: 'a' })));
      const b0 = migrateDoc(apply(b, setOp('todos', { id: 'tb', title: 'b' })));
      expect(Automerge.getObjectId(a0.counterDeltas)).toBe(Automerge.getObjectId(b0.counterDeltas));
      const adjust = (doc: Doc, delta: number) =>
        Automerge.change(doc, (d) =>
          adjustField(d, 'accounts', 'A', 'balance', delta, `dev:${Automerge.getActorId(doc)}`)
        );
      const { a: merged } = converge(adjust(a0, -20.25), adjust(b0, -30.5));
      expect(Object.keys(merged.counterDeltas)).toHaveLength(2);
      expect(countRootConflicts(merged)).toBe(0);
      expect(counterStats(merged)).toMatchObject({ keys: 2, conflicts: 0, malformed: 0 });
      const acct = JSON.parse(JSON.stringify(merged.accounts.A)) as AnyRec;
      expect(foldEntity('accounts', 'A', acct, foldIndex(merged)).balance).toBe(49.25);
    });

    it('a pod that already holds counterDeltas is untouched (same handle, heads unchanged)', () => {
      const doc = base();
      expect(doc.counterDeltas).toEqual({});
      const heads = getHeads(doc);
      expect(migrateDoc(doc)).toBe(doc);
      expect(getHeads(doc)).toEqual(heads);
    });
  });

  it('a `null` collection migrates via an ordinary change and is usable', () => {
    const withNull = Automerge.change(oldPod(), (d) => {
      (d as unknown as AnyRec).todos = null;
    });
    const migrated = migrateDoc(withNull);
    expect(migrated.todos).toEqual({});
    // An ordinary local change, not the stored one (which would leave the key `null`, probe c).
    expect(lastChange(migrated).actor).toBe(Automerge.getActorId(migrated));
    expect(lastChange(migrated).message).toBe('migrate: add missing collections');
    expect(read(apply(migrated, todo('t1')), 'todos', 't1')).toEqual({ id: 't1', title: 't1' });
    expect(countRootConflicts(migrated)).toBe(0);
  });

  it('mixes absent and null in one migrate: stored change for absent, ordinary for null', () => {
    const doc = Automerge.change(oldPod('lists'), (d) => {
      (d as unknown as AnyRec).todos = null;
    });
    const migrated = migrateDoc(doc);
    expect(migrated.lists).toEqual({});
    expect(migrated.todos).toEqual({});
    const listsActor = Automerge.getObjectId(migrated.lists)!.split('@')[1];
    expect(listsActor).toBe(
      Automerge.decodeChange(Uint8Array.from(Buffer.from(MIGRATION_CHANGES.lists, 'base64'))).actor
    );
    expect(Automerge.getObjectId(migrated.todos)!.split('@')[1]).toBe(
      Automerge.getActorId(migrated)
    );
  });

  it('a corrupt stored change throws loudly (a build defect), never skipped', () => {
    const table = MIGRATION_CHANGES as Record<CollectionName, string>;
    const saved = table.todos;
    try {
      table.todos = 'AAAA';
      expect(() => migrateDoc(oldPod('todos'))).toThrow(/stored migration change for "todos"/);
      // Decodable, but for the wrong collection: also a build defect.
      table.todos = table.lists;
      expect(() => migrateDoc(oldPod('todos'))).toThrow(/wrong shape/);
    } finally {
      table.todos = saved;
    }
  });

  it("mixed fleet: a pre-#117 device's `{}` beats the stored change; the conflict is counted and only a full projection is phantom-free", () => {
    const { a, b } = fork(oldPod('todos'));
    // A is on the new build: the stored change. B is on the old build: a random-actor `{}`.
    const a1 = apply(migrateDoc(a), todo('e1'));
    const b1 = apply(
      Automerge.change(b, (d) => {
        (d as unknown as AnyRec).todos = {};
      }),
      todo('e2')
    );
    const aHeads = getHeads(a1);
    const before = rootConflictSnapshot(a1);
    const { a: merged } = converge(a1, b1);

    expect(countRootConflicts(merged)).toBe(1);
    expect(rootConflictsSince(before, merged)).toEqual({ total: 1, added: 1 });
    // B's assignment sits behind the old pod's ops, so it wins on op counter; A's map is hidden.
    expect(Object.keys(merged.todos)).toEqual(['e2']);
    const todosBulk = buildFullProjection(merged).find(
      (d): d is Extract<ProjectionDelta, { kind: 'bulk' }> =>
        d.kind === 'bulk' && d.collection === 'todos'
    );
    expect(todosBulk?.entities.map(([id]) => id)).toEqual(['e2']);

    // WHY the full projection: the delta from A's heads upserts the winner's entity and emits
    // NOTHING for A's own `e1`, which would stay in A's projection as a phantom.
    const deltas = projectionDeltasBetween(merged, aHeads, getHeads(merged)) ?? [];
    expect(deltas.some((d) => d.kind === 'remove' && d.id === 'e1')).toBe(false);

    // A conflict that merely persists is not news on the next merge.
    expect(rootConflictsSince(rootConflictSnapshot(merged), merged)).toEqual({
      total: 1,
      added: 0,
    });
  });

  it('a third concurrent value at an already-conflicted key counts as added', () => {
    const origin = oldPod('todos');
    const devices = [0, 1, 2].map(() => Automerge.clone(origin));
    const [x, y, z] = devices.map((d, i) =>
      apply(
        Automerge.change(d, (doc) => {
          (doc as unknown as AnyRec).todos = {};
        }),
        todo(`e${i}`)
      )
    );
    const xy = mergeDocs(x!, y!).doc;
    const before = rootConflictSnapshot(xy);
    expect(before.get('todos')).toBe(2);
    const xyz = mergeDocs(xy, z!).doc;
    expect(rootConflictsSince(before, xyz)).toEqual({ total: 1, added: 1 });
  });
});
