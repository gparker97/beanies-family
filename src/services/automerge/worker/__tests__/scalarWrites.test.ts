// @vitest-environment node
/**
 * #124 R4: the writer's choke points, end to end through `applyMutation`.
 *
 *  - OFF (no mint, every shipped build): a fixed scripted op sequence lands on a RECORDED op
 *    count, and no string leaf of `toJS(doc)` is an `ImmutableString` (plan acceptance bullet
 *    2). Not a byte snapshot: Automerge stamps wall-clock `time` per change, so `save` bytes
 *    differ run to run; the op count does not.
 *  - ON (a mint installed): the same sequence writes every structural string as a `str` scalar
 *    at each choke point (`set`, `patch` key writes and list inserts, `patchSettings` defaults and
 *    a dynamic-map key, `setSettings`, the goal contribution entry, the cascade create/update and
 *    the ten `updatedAt` stamps), keeps prose as text, and projects to the SAME JSON as OFF.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Automerge from '@automerge/automerge';
import type { CollectionName, FamilyDocument } from '@/types/automerge';
import { applyMutation, migrateDoc } from '../docOps';
import type { MutationOp } from '../protocol';
import { appendUnique } from '../reconcile';
import { isImmutableString, setScalarMint } from '../scalarStrings';
import { registerTransactionOps } from '../transactionOps';

type Doc = Automerge.Doc<FamilyDocument>;
type AnyRec = Record<string, unknown>;

beforeAll(() => registerTransactionOps());
// The handlers' own `nowIso()` stamps (the goal contribution, the cascade's account stamp): a
// fixed clock, so the OFF and ON documents compare equal.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-20T12:00:00.000Z'));
});
afterEach(() => {
  setScalarMint(null);
  vi.useRealTimers();
});

const mint = (s: string) => new Automerge.ImmutableString(s);
const T0 = '2026-10-20T08:00:00.000Z';
const T1 = '2026-10-20T09:00:00.000Z';
const T2 = '2026-10-20T10:00:00.000Z';

const set = (collection: CollectionName, entity: AnyRec & { id: string }): MutationOp => ({
  op: 'set',
  collection,
  id: entity.id,
  entity,
});
const named = (name: string, args: AnyRec): MutationOp => ({ op: 'named', name, args });

const ITEMS = [
  { id: 'i1', title: 'Milk', completed: false, createdAt: T0 },
  { id: 'i2', title: 'Eggs', completed: false, createdAt: T0 },
];

/** The scripted sequence: one op through every choke point. */
const SCRIPT: readonly MutationOp[] = [
  set('accounts', {
    id: 'chk',
    name: 'Everyday',
    type: 'checking',
    currency: 'USD',
    balance: 1000,
    memberId: 'm1',
    createdAt: T0,
    updatedAt: T0,
  }),
  set('goals', {
    id: 'g',
    name: 'Car',
    type: 'savings',
    targetAmount: 1000,
    currentAmount: 0,
    currency: 'USD',
    isCompleted: false,
    createdAt: T0,
    updatedAt: T0,
  }),
  set('lists', {
    id: 'L',
    title: 'Groceries',
    lifecycle: 'recurring',
    items: ITEMS,
    createdBy: 'm1',
    createdAt: T0,
    updatedAt: T0,
  }),
  // A tick: an in-place key write on an existing element, with the stamp.
  {
    op: 'patch',
    collection: 'lists',
    id: 'L',
    patch: {
      items: [{ ...ITEMS[0], completed: true, completedBy: 'm1', completedAt: T1 }, ITEMS[1]],
    },
    base: { items: ITEMS },
    updatedAt: T1,
  },
  // An insert: a new element spliced into the list.
  {
    op: 'patch',
    collection: 'lists',
    id: 'L',
    patch: {
      items: [
        { ...ITEMS[0], completed: true, completedBy: 'm1', completedAt: T1 },
        ITEMS[1],
        { id: 'i3', title: 'Bread', completed: false, createdAt: T2 },
      ],
    },
    updatedAt: T2,
  },
  // `notificationReads` (`onMissing: 'create'`): dynamic keys under a dynamic-map collection.
  {
    op: 'patch',
    collection: 'notificationReads',
    id: 'm1',
    patch: { 'todo-due:t1': T1 },
    onMissing: 'create',
  },
  named('patchSettings', {
    defaults: { id: 'app_settings', baseCurrency: 'USD', theme: 'system' },
    patch: { dismissedHintKeys: { 'birthday-m1': T1 }, homeTimeZone: 'Asia/Singapore' },
    updatedAt: T1,
  }),
  named('patchSettings', {
    patch: { dismissedHintKeys: { 'birthday-m1': T1, 'school-m2': T2 } },
    updatedAt: T2,
  }),
  named('applyGoalContribution', {
    id: 'g',
    delta: 25,
    contribution: { id: 'c1', amount: 25, at: T1, updatedBy: 'm1', note: 'Birthday money' },
  }),
  named('commitTransactionCascade', {
    mode: 'create',
    transaction: {
      id: 't1',
      accountId: 'chk',
      type: 'expense',
      amount: 100,
      currency: 'USD',
      category: 'groceries',
      date: '2026-10-20',
      description: 'Weekly shop',
      isReconciled: false,
      createdAt: T1,
      updatedAt: T1,
    },
  }),
  named('commitTransactionCascade', {
    mode: 'update',
    id: 't1',
    patch: { amount: 120, category: 'household' },
    updatedAt: T2,
  }),
];

/** The `setSettings` replacement runs on its own doc (it would discard the patched settings). */
const SET_SETTINGS: MutationOp = named('setSettings', {
  settings: { id: 'app_settings', baseCurrency: 'SGD', language: 'en', updatedAt: T0 },
});

function run(ops: readonly MutationOp[], start?: Doc): Doc {
  let doc: Doc = start ?? migrateDoc(Automerge.init<FamilyDocument>());
  for (const op of ops) doc = applyMutation(doc, op).doc;
  return doc;
}

/** Every string-ish leaf of `toJS(doc)`, by dotted path, with whether it is an ImmutableString. */
function leaves(node: unknown, path = '', out = new Map<string, boolean>()): Map<string, boolean> {
  if (typeof node === 'string') out.set(path, false);
  else if (isImmutableString(node)) out.set(path, true);
  else if (Array.isArray(node)) node.forEach((v, i) => leaves(v, `${path}[${i}]`, out));
  else if (node !== null && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) leaves(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}

/**
 * Recorded from this sequence with no mint installed (#124 Phase 3a, 2026-10-20), and the same
 * sequence run against `main` before #124 (4f09dae4) gives the same two numbers. With no mint
 * `docValue` IS the JSON copy every shipped build makes, so this is the shipped op count; a
 * change here means the OFF writer no longer writes what main does.
 */
const OFF_NUM_OPS = 910;
const OFF_SET_SETTINGS_NUM_OPS = 80;

describe('scalar writer OFF: the shipped write path, unchanged (#124 acceptance 2)', () => {
  it('the scripted sequence lands on the recorded op count, with no ImmutableString anywhere', () => {
    const doc = run(SCRIPT);
    expect(Automerge.stats(doc).numOps).toBe(OFF_NUM_OPS);
    const all = leaves(Automerge.toJS(doc));
    expect(all.size).toBeGreaterThan(40);
    expect([...all].filter(([, wrapped]) => wrapped).map(([p]) => p)).toEqual([]);
    const replaced = run([SET_SETTINGS]);
    expect(Automerge.stats(replaced).numOps).toBe(OFF_SET_SETTINGS_NUM_OPS);
    expect([...leaves(Automerge.toJS(replaced))].some(([, w]) => w)).toBe(false);
  });
});

describe('scalar writer ON: every choke point writes structural strings as scalars', () => {
  const on = (ops: readonly MutationOp[]): Doc => {
    setScalarMint(mint);
    return run(ops);
  };

  it('projects to exactly the JSON the OFF writer produces, in far fewer ops', () => {
    const off = run(SCRIPT);
    const onDoc = on(SCRIPT);
    expect(JSON.parse(JSON.stringify(onDoc))).toEqual(JSON.parse(JSON.stringify(off)));
    expect(Automerge.stats(onDoc).numOps).toBeLessThan(Automerge.stats(off).numOps / 2);
  });

  it('a reorder (moveAfter, then insertAt) keeps the moved element minted, never a {val} map', () => {
    const doc = on(SCRIPT);
    const before = JSON.parse(JSON.stringify(doc)) as { lists: { L: { items: unknown[] } } };
    const items = before.lists.L.items as Array<Record<string, unknown>>;
    // Move the last item (i3) to the front: `reconcileList` detaches it with `moveAfter`
    // (a `docValue` copy) and `insertAt` copies and re-mints it; the mint must survive both.
    setScalarMint(mint);
    const moved = run(
      [
        {
          op: 'patch',
          collection: 'lists',
          id: 'L',
          patch: { items: [items[2], items[0], items[1]] },
          base: { items },
          updatedAt: T2,
        },
      ],
      doc
    );
    const list = Automerge.toJS(moved).lists.L as unknown as {
      items: Array<Record<string, unknown>>;
    };
    expect(list.items.map((i) => i.id && String(i.id))).toEqual(['i3', 'i1', 'i2']);
    expect(list.items.map((i) => isImmutableString(i.id))).toEqual([true, true, true]);
    expect(list.items.map((i) => typeof i.title)).toEqual(['string', 'string', 'string']);
    expect(JSON.parse(JSON.stringify(moved)).lists.L.items).toEqual([items[2], items[0], items[1]]);
  });

  it('wraps ids, FKs, enums, codes and timestamps at every site; prose stays text', () => {
    const all = leaves(Automerge.toJS(on(SCRIPT)));
    const wrapped = (p: string) => {
      expect(all.has(p), `${p} is written`).toBe(true);
      return all.get(p);
    };
    const scalar = [
      // `set`
      'accounts.chk.id',
      'accounts.chk.type',
      'accounts.chk.currency',
      'accounts.chk.memberId',
      'accounts.chk.createdAt',
      'lists.L.lifecycle',
      'lists.L.createdBy',
      'lists.L.items[1].id',
      // `patch`: an in-place key write on an element, a spliced insert, the stamp
      'lists.L.items[0].completedBy',
      'lists.L.items[0].completedAt',
      'lists.L.items[2].id',
      'lists.L.items[2].createdAt',
      'lists.L.updatedAt',
      // a dynamic key of the dynamic-map collection (the collection is the container)
      'notificationReads.m1.todo-due:t1',
      // `patchSettings`: the defaults, a key write, a dynamic-map key insert, the stamp
      'settings.id',
      'settings.baseCurrency',
      'settings.homeTimeZone',
      'settings.dismissedHintKeys.birthday-m1',
      'settings.dismissedHintKeys.school-m2',
      'settings.updatedAt',
      // the goal contribution entry and its stamp
      'goals.g.manualContributions[0].id',
      'goals.g.manualContributions[0].at',
      'goals.g.manualContributions[0].updatedBy',
      'goals.g.updatedAt',
      // the cascade: the created row, a patched key, the update stamp, the account stamp
      'transactions.t1.id',
      'transactions.t1.accountId',
      'transactions.t1.date',
      'transactions.t1.category',
      'transactions.t1.updatedAt',
      'accounts.chk.updatedAt',
    ];
    const text = [
      'accounts.chk.name',
      'lists.L.title',
      'lists.L.items[0].title',
      'lists.L.items[2].title',
      'goals.g.manualContributions[0].note',
      'transactions.t1.description',
    ];
    expect(scalar.filter((p) => wrapped(p) !== true)).toEqual([]);
    expect(text.filter((p) => wrapped(p) !== false)).toEqual([]);
  });

  it('setSettings writes the replacement in the scalar form', () => {
    const all = leaves(Automerge.toJS(on([SET_SETTINGS])));
    expect(
      ['settings.id', 'settings.baseCurrency', 'settings.language'].map((p) => all.get(p))
    ).toEqual([true, true, true]);
  });

  it('a `set` never touches the caller entity (inline mode shares it with main)', () => {
    setScalarMint(mint);
    const entity = { id: 'a', name: 'x', type: 'checking', updatedAt: T0 };
    applyMutation(migrateDoc(Automerge.init<FamilyDocument>()), set('accounts', entity));
    expect(entity).toEqual({ id: 'a', name: 'x', type: 'checking', updatedAt: T0 });
  });

  it('appendUnique (the photo attach) mints the appended id, and stays a no-op on a repeat', () => {
    setScalarMint(mint);
    const host: AnyRec = {};
    expect(appendUnique(host, 'photoIds', 'p1')).toBe(true);
    expect(isImmutableString((host.photoIds as unknown[])[0])).toBe(true);
    expect(appendUnique(host, 'photoIds', 'p1')).toBe(false); // canonical equality sees through
    expect(appendUnique(host, 'photoIds', 'p2')).toBe(true);
    expect((host.photoIds as unknown[]).map((v) => isImmutableString(v))).toEqual([true, true]);
  });
});
