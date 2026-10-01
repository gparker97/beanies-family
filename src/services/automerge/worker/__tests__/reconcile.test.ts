// @vitest-environment node
/**
 * The reconciler's whole contract is four laws (see the header of
 * `../reconcile.ts`). One table per law, then the shapes the plan calls out
 * (duplicates, value identity, value objects, merge fields, moves), a seeded
 * random suite that asserts all four laws, and the Law-1 runtime verify.
 *
 * Everything runs on plain objects: the reconciler has no Automerge import, and
 * it removes with `splice` only, so plain arrays behave exactly like the proxy.
 * Merges through Automerge itself are covered by `docOps.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import {
  reconcileInto,
  appendUnique,
  canonicalEqual,
  KEY_FIELDS,
  MERGE_FIELDS,
  __reconcileIntoWithForTesting,
  type ReconcileContext,
} from '../reconcile';

type AnyRecord = Record<string, unknown>;

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
const freshCtx = (): ReconcileContext => ({ writes: 0, notes: [] });

/**
 * Reconcile one field. `target` is what the document holds, `base` what the
 * caller built `next` from. Returns the resulting value plus the context.
 */
function run(field: string, target: unknown, next: unknown, base: unknown) {
  const parent: AnyRecord = target === undefined ? {} : { [field]: clone(target) };
  const ctx = freshCtx();
  reconcileInto(parent, field, clone(next), clone(base), ctx);
  return { value: parent[field], has: field in parent, parent, ctx };
}

/** The `docOps` loop: every key of `next`, plus deletes for base keys it dropped. */
function runEntity(target: AnyRecord, next: AnyRecord, base: AnyRecord | undefined) {
  const parent = clone(target);
  const ctx = freshCtx();
  const keys = new Set([...Object.keys(next), ...Object.keys(base ?? {})]);
  for (const k of keys) reconcileInto(parent, k, clone(next[k]), clone(base?.[k]), ctx);
  return { result: parent, ctx };
}

const ids = (list: unknown) => (list as Array<{ id: string }>).map((i) => i.id);
const verifyFailures = (ctx: ReconcileContext) =>
  ctx.notes.filter((n) => n.action === 'reconcile_verify_failed');

// ─── Law 1: target equals base → result equals next ──────────────────────────

describe('Law 1: if target equals base, the result equals next', () => {
  const a = { id: 'a', name: 'milk', done: false };
  const b = { id: 'b', name: 'eggs', done: false };
  const c = { id: 'c', name: 'bread', done: false };
  const d = { id: 'd', name: 'jam', done: false };

  const cases: Array<[string, string, unknown, unknown]> = [
    ['scalar change', 'title', 'Old', 'New'],
    ['scalar set where absent', 'title', undefined, 'New'],
    ['type change: string to array', 'title', 'x', ['x']],
    ['type change: array to object', 'tags', ['x'], { x: true }],
    ['type change: object to null', 'rule', { freq: 'weekly' }, null],
    ['list: tick one item', 'items', [a, b, c], [a, { ...b, done: true }, c]],
    ['list: insert at the front', 'items', [a, b], [d, a, b]],
    ['list: insert in the middle', 'items', [a, b], [a, d, b]],
    ['list: append', 'items', [a, b], [a, b, d]],
    ['list: remove', 'items', [a, b, c], [a, c]],
    ['list: clear to empty', 'items', [a, b], []],
    ['list: reverse', 'items', [a, b, c, d], [d, c, b, a]],
    ['list: rotate', 'items', [a, b, c, d], [b, c, d, a]],
    [
      'list: move, edit, add and remove together',
      'items',
      [a, b, c],
      [c, { ...a, name: 'oat' }, d],
    ],
    ['list: clear an element field', 'items', [{ ...a, memo: 'x' }], [a]],
    [
      'primitives: remove one of two duplicates',
      'ingredients',
      ['salt', 'pepper', 'salt'],
      ['pepper', 'salt'],
    ],
    ['primitives: add a duplicate', 'ingredients', ['salt'], ['salt', 'salt']],
    ['primitives: reorder duplicates', 'ingredients', ['a', 'b', 'a', 'b'], ['b', 'b', 'a', 'a']],
    [
      'keyless objects: edit one step',
      'steps',
      [{ text: 'boil' }, { text: 'stir' }],
      [{ text: 'boil' }, { text: 'whisk' }],
    ],
    [
      'votes keyed by memberId',
      'votes',
      [{ memberId: 'm1' }],
      [{ memberId: 'm2' }, { memberId: 'm1' }],
    ],
    [
      'exchangeRates keyed by from|to',
      'exchangeRates',
      [{ from: 'USD', to: 'GBP', rate: 0.8 }],
      [
        { from: 'USD', to: 'GBP', rate: 0.79 },
        { from: 'EUR', to: 'GBP', rate: 0.85 },
      ],
    ],
    [
      'categories keyed by categoryId',
      'categories',
      [{ categoryId: 'food', amount: 1 }],
      [{ categoryId: 'food', amount: 2 }],
    ],
    [
      'completions keyed by date',
      'dropoffCompletions',
      [{ date: '2026-10-01', by: 'm1' }],
      [
        { date: '2026-10-01', by: 'm2' },
        { date: '2026-10-02', by: 'm1' },
      ],
    ],
    [
      'merge field: loan per key, with a key cleared',
      'loan',
      { rate: 4, term: 30, lender: 'x' },
      { rate: 5, term: 30 },
    ],
    [
      'value object: rule',
      'rule',
      { freq: 'weekly', interval: 1 },
      { freq: 'weekly', interval: 2 },
    ],
    [
      'nested list inside an element',
      'ideas',
      [{ id: 'i1', votes: [{ memberId: 'm1' }] }],
      [{ id: 'i1', votes: [{ memberId: 'm1' }, { memberId: 'm2' }] }],
    ],
  ];

  it.each(cases)('%s', (_name, field, base, next) => {
    const { value, ctx } = run(field, base, next, base);
    expect(value).toEqual(next);
    expect(verifyFailures(ctx)).toEqual([]);
  });

  it('a clear (next undefined) deletes a key that was in base', () => {
    const { has, ctx } = run('memo', 'x', undefined, 'x');
    expect(has).toBe(false);
    expect(ctx.writes).toBe(1);
  });

  it('base and target both undefined: next is written whole', () => {
    const { value, ctx } = run('items', undefined, [a], undefined);
    expect(value).toEqual([a]);
    expect(ctx.writes).toBe(1);
  });
});

// ─── Law 2: the caller's changes land, despite concurrent target edits ───────

describe('Law 2: every change in next relative to base is in the result', () => {
  const base = [
    { id: 'a', name: 'milk', done: false },
    { id: 'b', name: 'eggs', done: false },
  ];

  it('a tick lands next to a concurrently added item', () => {
    const target = [...base, { id: 'c', name: 'jam', done: false }];
    const next = [base[0], { ...base[1], done: true }];
    const { value } = run('items', target, next, base);
    expect(value).toEqual([base[0], { ...base[1], done: true }, target[2]]);
  });

  it('an add lands next to a concurrent tick', () => {
    const target = [{ ...base[0], done: true }, base[1]];
    const next = [...base, { id: 'c', name: 'jam', done: false }];
    const { value } = run('items', target, next, base);
    expect(value).toEqual([target[0], base[1], next[2]]);
  });

  it('a removal lands even when the item was concurrently edited (update vs remove)', () => {
    const target = [{ ...base[0], name: 'oat milk' }, base[1]];
    const { value } = run('items', target, [base[1]], base);
    expect(ids(value)).toEqual(['b']);
  });

  it('a field edit is not applied to an item removed concurrently (no resurrection)', () => {
    const target = [base[1]];
    const next = [{ ...base[0], done: true }, base[1]];
    const { value } = run('items', target, next, base);
    expect(ids(value)).toEqual(['b']);
  });

  it('a scalar the caller changed overwrites a concurrent change (same-scalar LWW)', () => {
    const { value } = run('title', 'Theirs', 'Mine', 'Old');
    expect(value).toBe('Mine');
  });

  it('a value object is written whole: a concurrent sub-field change is not merged', () => {
    const baseRule = { freq: 'weekly', interval: 1 };
    const target = { freq: 'weekly', interval: 3 };
    const next = { freq: 'monthly', interval: 1 };
    const { value } = run('rule', target, next, baseRule);
    expect(value).toEqual(next);
  });

  it('a value object (dateOfBirth) is replaced, not patched per key', () => {
    const dob = { year: 2018, month: 4, day: 2 };
    const parent: AnyRecord = { dateOfBirth: clone(dob) };
    const before = parent.dateOfBirth;
    reconcileInto(parent, 'dateOfBirth', { ...dob, day: 3 }, dob, freshCtx());
    expect(parent.dateOfBirth).not.toBe(before);
    expect(parent.dateOfBirth).toEqual({ ...dob, day: 3 });
  });

  it('a merge field (loan) is patched per key: the object itself is kept', () => {
    const loan = { rate: 4, term: 30 };
    const parent: AnyRecord = { loan: clone(loan) };
    const before = parent.loan;
    reconcileInto(parent, 'loan', { ...loan, rate: 5 }, loan, freshCtx());
    expect(parent.loan).toBe(before);
    expect(parent.loan).toEqual({ rate: 5, term: 30 });
  });

  it('a caller move lands with exactly one move, on the LIS-minimal item', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));
    const parent: AnyRecord = { items: clone(items) };
    const kept = (parent.items as AnyRecord[]).filter((i) => i.id !== 'b');
    const ctx = freshCtx();
    const next = [items[0], items[2], items[3], items[4], items[1]];
    reconcileInto(parent, 'items', clone(next), items, ctx);
    expect(ids(parent.items)).toEqual(['a', 'c', 'd', 'e', 'b']);
    expect(ctx.writes).toBe(1);
    // Every item off the moved one is the same object: only `b` was touched.
    for (const item of kept) expect((parent.items as AnyRecord[]).includes(item)).toBe(true);
  });

  it('a primitive set change on both sides merges as a set union', () => {
    const { value } = run('assigneeIds', ['m1', 'm3'], ['m1', 'm2'], ['m1']);
    expect(value).toEqual(['m1', 'm2', 'm3']);
  });
});

// ─── Law 3: concurrent target changes the caller did not touch survive ───────

describe('Law 3: target values the caller left equal to base are untouched', () => {
  const a = { id: 'a', name: 'milk' };
  const b = { id: 'b', name: 'eggs' };
  const c = { id: 'c', name: 'bread' };

  it('a concurrent insert keeps its place', () => {
    const target = [a, { id: 'x', name: 'new' }, b, c];
    const { value } = run('items', target, [a, b, { ...c, name: 'rye' }], [a, b, c]);
    expect(ids(value)).toEqual(['a', 'x', 'b', 'c']);
  });

  it('a concurrent field edit on another item survives', () => {
    const target = [{ ...a, name: 'oat milk' }, b];
    const { value } = run('items', target, [a, { ...b, name: 'duck eggs' }], [a, b]);
    expect(value).toEqual([
      { ...a, name: 'oat milk' },
      { ...b, name: 'duck eggs' },
    ]);
  });

  it('a concurrent field edit on the same item, different field, survives', () => {
    const base = [{ id: 'a', name: 'milk', done: false }];
    const target = [{ id: 'a', name: 'oat milk', done: false }];
    const { value } = run('items', target, [{ id: 'a', name: 'milk', done: true }], base);
    expect(value).toEqual([{ id: 'a', name: 'oat milk', done: true }]);
  });

  it('a concurrent reorder is kept when the caller did not move anything', () => {
    const target = [c, a, b];
    const { value } = run('items', target, [a, { ...b, name: 'x' }, c], [a, b, c]);
    expect(ids(value)).toEqual(['c', 'a', 'b']);
  });

  it('a concurrent loan key survives a caller edit to another key', () => {
    const base = { rate: 4, term: 30 };
    const { value } = run('loan', { rate: 4, term: 25 }, { rate: 5, term: 30 }, base);
    expect(value).toEqual({ rate: 5, term: 25 });
  });

  it('a concurrent aiApiKeys provider survives the caller adding another', () => {
    const { value } = run('aiApiKeys', { claude: 'k1' }, { openai: 'k2' }, {});
    expect(value).toEqual({ claude: 'k1', openai: 'k2' });
  });

  it('a concurrent scalar change survives a caller who sent it unchanged', () => {
    const { value, ctx } = run('title', 'Theirs', 'Old', 'Old');
    expect(value).toBe('Theirs');
    expect(ctx.writes).toBe(0);
  });
});

// ─── Law 4: next equals base → nothing is written ────────────────────────────

describe('Law 4: if next equals base, nothing is written', () => {
  const cases: Array<[string, string, unknown, unknown]> = [
    ['scalar, target changed', 'title', 'Theirs', 'Old'],
    [
      'list, target added and ticked',
      'items',
      [{ id: 'a', done: true }, { id: 'b' }],
      [{ id: 'a' }],
    ],
    [
      'list, target holds a duplicate key (not healed by a no-op)',
      'votes',
      [{ memberId: 'm' }, { memberId: 'm' }],
      [{ memberId: 'm' }],
    ],
    ['merge field, target changed', 'loan', { rate: 9 }, { rate: 4 }],
    [
      'value object, key order differs',
      'rule',
      { interval: 1, freq: 'weekly' },
      { freq: 'weekly', interval: 1 },
    ],
    ['primitives, target reordered', 'tags', ['b', 'a'], ['a', 'b']],
  ];

  it.each(cases)('%s', (_name, field, target, base) => {
    const { value, ctx } = run(field, target, base, base);
    expect(ctx.writes).toBe(0);
    expect(ctx.notes).toEqual([]);
    expect(value).toEqual(target);
  });
});

// ─── Clears and the additive (base undefined) mode ───────────────────────────

describe('clears and base === undefined (additive)', () => {
  it('a key in base missing from next is deleted, inside an element and a merge field', () => {
    const items = run('items', [{ id: 'a', memo: 'x' }], [{ id: 'a' }], [{ id: 'a', memo: 'x' }]);
    expect(items.value).toEqual([{ id: 'a' }]);
    const loan = run('loan', { rate: 4, lender: 'x' }, { rate: 4 }, { rate: 4, lender: 'x' });
    expect(loan.value).toEqual({ rate: 4 });
  });

  it('with base undefined nothing is deleted: list items, map keys and the key itself survive', () => {
    expect(run('items', [{ id: 'a' }, { id: 'b' }], [{ id: 'b' }], undefined).value).toEqual([
      { id: 'a' },
      { id: 'b' },
    ]);
    expect(run('loan', { rate: 4, lender: 'x' }, { rate: 5 }, undefined).value).toEqual({
      rate: 5,
      lender: 'x',
    });
    expect(run('memo', 'x', undefined, undefined).has).toBe(true);
  });

  it('with base undefined nothing moves, and new items go after their predecessor', () => {
    const target = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const { value, ctx } = run('items', target, [{ id: 'c' }, { id: 'n' }, { id: 'a' }], undefined);
    expect(ids(value)).toEqual(['a', 'b', 'c', 'n']);
    expect(ctx.writes).toBe(1);
  });

  it('a key absent from base but present in the target is never deleted', () => {
    const { value } = run('loan', { rate: 4, lender: 'x' }, { rate: 5 }, { rate: 4 });
    expect(value).toEqual({ rate: 5, lender: 'x' });
  });
});

// ─── Duplicates and identity ─────────────────────────────────────────────────

describe('duplicates and identity', () => {
  it('a duplicate key in the target is healed (first occurrence wins) with an info note', () => {
    const target = [{ memberId: 'm1', w: 1 }, { memberId: 'm2' }, { memberId: 'm1', w: 2 }];
    const base = [{ memberId: 'm1', w: 1 }, { memberId: 'm2' }];
    const { value, ctx } = run('votes', target, [...base, { memberId: 'm3' }], base);
    expect(value).toEqual([{ memberId: 'm1', w: 1 }, { memberId: 'm2' }, { memberId: 'm3' }]);
    expect(ctx.notes).toEqual([{ action: 'healed_duplicate_keys', kind: 'votes', count: 1 }]);
  });

  it('a duplicate key in next is dropped with a warn note', () => {
    const base = [{ id: 'a' }];
    const { value, ctx } = run('items', base, [{ id: 'a' }, { id: 'b' }, { id: 'b', x: 1 }], base);
    expect(value).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(ctx.notes).toEqual([{ action: 'next_duplicate_keys', kind: 'items', count: 1 }]);
    expect(verifyFailures(ctx)).toEqual([]);
  });

  it('a next duplicate the base also holds is passed-through state, not a caller bug', () => {
    const dup = [{ memberId: 'm' }, { memberId: 'm' }];
    const { value, ctx } = run('votes', dup, [...dup, { memberId: 'n' }], dup);
    expect(value).toEqual([{ memberId: 'm' }, { memberId: 'n' }]);
    expect(ctx.notes.map((n) => n.action)).toEqual(['healed_duplicate_keys']);
  });

  it('un-vote on a duplicated element removes every copy', () => {
    const dup = [{ memberId: 'm' }, { memberId: 'm' }, { memberId: 'n' }];
    const { value } = run('votes', dup, [{ memberId: 'n' }], dup);
    expect(value).toEqual([{ memberId: 'n' }]);
  });

  it('notes from a nested list carry the top-level field as kind', () => {
    const base = [{ id: 'i1', votes: [{ memberId: 'm' }] }];
    const next = [{ id: 'i1', votes: [{ memberId: 'm' }, { memberId: 'n' }, { memberId: 'n' }] }];
    const { ctx } = run('ideas', base, next, base);
    expect(ctx.notes).toEqual([{ action: 'next_duplicate_keys', kind: 'ideas', count: 1 }]);
  });

  it('elements missing their key field fall back to value identity, never one shared key', () => {
    const target = [{ weight: 1 }, { weight: 2 }, { memberId: 7 }];
    const { value, ctx } = run('votes', target, [...target, { weight: 3 }], target);
    expect(value).toEqual([...target, { weight: 3 }]);
    expect(ctx.notes).toEqual([]);
  });

  it('a non-string id falls back to value identity', () => {
    const target = [
      { id: 1, n: 'a' },
      { id: 1, n: 'b' },
    ];
    expect(run('items', target, target.slice(1), target).value).toEqual([{ id: 1, n: 'b' }]);
  });

  it('an id beats the key table, and id and value keys cannot collide', () => {
    const target = [{ id: 'm1', memberId: 'x' }, { memberId: 'x' }];
    const { value, ctx } = run('votes', target, [...target, 'id:m1'], target);
    expect(value).toEqual([...target, 'id:m1']);
    expect(ctx.notes).toEqual([]);
  });

  it('occurrence-suffixed primitives: removing the second "salt" keeps one', () => {
    const base = ['salt', 'pepper', 'salt'];
    const { value } = run('ingredients', base, ['salt', 'pepper'], base);
    expect(value).toEqual(['salt', 'pepper']);
  });

  it('a keyless element edited concurrently on both sides leaves both versions (residual)', () => {
    const base = [{ text: 'boil' }];
    const { value } = run('steps', [{ text: 'boil hard' }], [{ text: 'boil gently' }], base);
    // The caller's edit is a new item with no present predecessor, so it goes to the front.
    expect(value).toEqual([{ text: 'boil gently' }, { text: 'boil hard' }]);
  });
});

// ─── Copies, equality and helpers ────────────────────────────────────────────

describe('copies and helpers', () => {
  it('written values are copies, never references into next', () => {
    const parent: AnyRecord = { items: [{ id: 'a' }] };
    const next = [{ id: 'a' }, { id: 'b', tags: ['x'] }];
    const rule = { freq: 'weekly' };
    reconcileInto(parent, 'items', next, [{ id: 'a' }], freshCtx());
    reconcileInto(parent, 'rule', rule, undefined, freshCtx());
    (next[1]!.tags as string[]).push('mutated');
    rule.freq = 'mutated';
    expect(parent).toEqual({
      items: [{ id: 'a' }, { id: 'b', tags: ['x'] }],
      rule: { freq: 'weekly' },
    });
  });

  it('canonicalEqual ignores key order and undefined-valued keys', () => {
    expect(canonicalEqual({ a: 1, b: [{ x: 1, y: 2 }] }, { b: [{ y: 2, x: 1 }], a: 1 })).toBe(true);
    expect(canonicalEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(canonicalEqual([1, 2], [2, 1])).toBe(false);
    expect(canonicalEqual(null, undefined)).toBe(false);
    expect(canonicalEqual(undefined, undefined)).toBe(true);
  });

  it('appendUnique appends once, creates the array, and reports whether it wrote', () => {
    const host: AnyRecord = {};
    expect(appendUnique(host, 'photoIds', 'p1')).toBe(true);
    expect(appendUnique(host, 'photoIds', 'p1')).toBe(false);
    expect(appendUnique(host, 'photoIds', 'p2')).toBe(true);
    expect(host.photoIds).toEqual(['p1', 'p2']);
  });

  it('exports the key and merge tables the plan specifies', () => {
    expect(KEY_FIELDS).toEqual({
      votes: ['memberId'],
      dropoffCompletions: ['date'],
      pickupCompletions: ['date'],
      exchangeRates: ['from', 'to'],
      categories: ['categoryId'],
    });
    expect([...MERGE_FIELDS].sort()).toEqual(['aiApiKeys', 'helpfulHintLeadDays', 'loan']);
  });
});

// ─── Runtime verify ──────────────────────────────────────────────────────────

describe('runtime verify (Law 1 at runtime)', () => {
  const base = [{ id: 'a', done: false }];
  const next = [{ id: 'a', done: true }, { id: 'b' }];
  const faulty = __reconcileIntoWithForTesting((parent, key) => {
    (parent[key] as unknown[]).splice(0); // a buggy inner that empties the list
  });

  it('a faulty inner reconcile falls back to a whole write and says so', () => {
    const parent: AnyRecord = { items: clone(base) };
    const ctx = freshCtx();
    faulty(parent, 'items', clone(next), clone(base), ctx);
    expect(parent.items).toEqual(next);
    expect(ctx.notes).toEqual([{ action: 'reconcile_verify_failed', kind: 'items', count: 1 }]);
    expect(ctx.writes).toBeGreaterThan(0);
  });

  it('when the target already differed from base, there is no ground truth and no fallback', () => {
    const parent: AnyRecord = { items: [{ id: 'z' }] };
    const ctx = freshCtx();
    faulty(parent, 'items', clone(next), clone(base), ctx);
    expect(parent.items).toEqual([]);
    expect(ctx.notes).toEqual([]);
  });
});

// ─── Seeded random: all four laws ────────────────────────────────────────────

/** A tiny LCG, so a failure is reproducible from its seed with no new dependency. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

interface Rng {
  int(n: number): number;
  pick<T>(xs: readonly T[]): T;
}

function rngFrom(seed: number): Rng {
  const next = lcg(seed);
  return {
    int: (n) => Math.floor(next() * n),
    pick: (xs) => xs[Math.floor(next() * xs.length)]!,
  };
}

type Item = { id: string; name: string; done: boolean; memo?: string };
type Vote = { memberId: string; weight: number };
interface Entity extends AnyRecord {
  title: string;
  count: number;
  note?: string;
  tags: string[];
  items: Item[];
  loan: { rate: number; term: number; lender?: string };
  rule: { freq: string; interval: number };
  votes: Vote[];
}

const WORDS = ['milk', 'eggs', 'jam', 'rye', 'oat', 'tea'];
const LISTS = ['tags', 'items', 'votes'] as const;
type ListField = (typeof LISTS)[number];

function genBase(rng: Rng): Entity {
  const items = Array.from({ length: rng.int(6) }, (_, i) => ({
    id: `i${i}`,
    name: rng.pick(WORDS),
    done: rng.int(2) === 1,
  }));
  return {
    title: rng.pick(WORDS),
    count: rng.int(10),
    ...(rng.int(2) ? { note: 'n' } : {}),
    tags: ['t0', 't1', 't2', 't3'].slice(0, rng.int(5)),
    items,
    loan: { rate: rng.int(9), term: 30, ...(rng.int(2) ? { lender: 'bank' } : {}) },
    rule: { freq: 'weekly', interval: 1 },
    votes: ['m0', 'm1'].slice(0, rng.int(3)).map((memberId) => ({ memberId, weight: 1 })),
  };
}

function moveRandom<T>(rng: Rng, xs: T[]): boolean {
  if (xs.length < 2) return false;
  const [x] = xs.splice(rng.int(xs.length), 1);
  xs.splice(rng.int(xs.length + 1), 0, x!);
  return true;
}

function editItems(rng: Rng, e: Entity, side: string, moved: Set<ListField>): void {
  const op = rng.int(5);
  const item = e.items.length ? rng.pick(e.items) : undefined;
  if (op === 0)
    e.items.splice(rng.int(e.items.length + 1), 0, {
      id: `${side}${rng.int(1e6)}`,
      name: 'new',
      done: false,
    });
  else if (op === 1 && item) e.items.splice(e.items.indexOf(item), 1);
  else if (op === 2 && moveRandom(rng, e.items)) moved.add('items');
  else if (op === 3 && item) item.done = !item.done;
  else if (item && rng.int(2)) item.memo = rng.pick(WORDS);
  else if (item) delete item.memo;
}

function editTags(rng: Rng, e: Entity, moved: Set<ListField>): void {
  const op = rng.int(3);
  const fresh = `t${rng.int(12)}`;
  if (op === 0 && !e.tags.includes(fresh)) e.tags.splice(rng.int(e.tags.length + 1), 0, fresh);
  else if (op === 1 && e.tags.length) e.tags.splice(rng.int(e.tags.length), 1);
  else if (moveRandom(rng, e.tags)) moved.add('tags');
}

function editVotes(rng: Rng, e: Entity): void {
  const member = `m${rng.int(4)}`;
  const existing = e.votes.find((v) => v.memberId === member);
  if (!existing) e.votes.push({ memberId: member, weight: rng.int(3) });
  else if (rng.int(2)) e.votes.splice(e.votes.indexOf(existing), 1);
  else existing.weight = rng.int(3) + 10;
}

function editOnce(rng: Rng, e: Entity, side: string, moved: Set<ListField>): void {
  const op = rng.int(9);
  if (op === 0) e.title = rng.pick(WORDS);
  else if (op === 1) e.count = rng.int(10);
  else if (op === 2 && rng.int(2)) e.note = rng.pick(WORDS);
  else if (op === 2) delete e.note;
  else if (op === 3) editTags(rng, e, moved);
  else if (op === 4 || op === 5) editItems(rng, e, side, moved);
  else if (op === 6) e.loan = { ...e.loan, [rng.pick(['rate', 'term', 'lender'])]: rng.int(50) };
  else if (op === 7) e.rule = { freq: rng.pick(['weekly', 'monthly']), interval: rng.int(3) + 1 };
  else editVotes(rng, e);
}

function mutate(rng: Rng, base: Entity, side: string) {
  const e = clone(base);
  const moved = new Set<ListField>();
  for (let n = rng.int(5) + 1; n > 0; n--) editOnce(rng, e, side, moved);
  return { e, moved };
}

/** Law 2 wins over Law 3 when both apply; returns the expected value for one slot. */
function expected(b: unknown, t: unknown, n: unknown): unknown {
  return canonicalEqual(n, b) ? t : n;
}

function keyOfField(field: ListField, x: unknown): string {
  if (field === 'tags') return x as string;
  if (field === 'votes') return (x as Vote).memberId;
  return (x as Item).id;
}

function byKey(field: ListField, xs: unknown[]): Map<string, AnyRecord> {
  return new Map(xs.map((x) => [keyOfField(field, x), x as AnyRecord]));
}

function checkList(
  field: ListField,
  b: Entity,
  t: Entity,
  n: Entity,
  r: Entity,
  orderFrom: 'next' | 'target' | null
) {
  const [B, T, N] = [byKey(field, b[field]), byKey(field, t[field]), byKey(field, n[field])];
  const R = byKey(field, r[field]);
  expect(R.size, `${field}: keys unique`).toBe((r[field] as unknown[]).length);
  for (const k of new Set([...B.keys(), ...T.keys(), ...N.keys()])) {
    const shouldExist = N.has(k) ? !B.has(k) || T.has(k) : T.has(k) && !B.has(k);
    expect(R.has(k), `${field}: presence of ${k}`).toBe(shouldExist);
    if (!shouldExist || field === 'tags') continue;
    const [bi, ti, ni, ri] = [B.get(k), T.get(k), N.get(k), R.get(k)!];
    // A key both sides inserted has no base item: the merge is additive over the target's.
    for (const f of new Set([...Object.keys(ti ?? {}), ...Object.keys(ni ?? {})])) {
      const want = ni ? expected(bi?.[f], ti?.[f], ni[f]) : ti?.[f];
      expect(canonicalEqual(ri[f], want), `${field}.${k}.${f}`).toBe(true);
    }
  }
  if (!orderFrom) return;
  const source = orderFrom === 'next' ? n[field] : t[field];
  const order = (source as unknown[]).map((x) => keyOfField(field, x)).filter((k) => R.has(k));
  const got = (r[field] as unknown[])
    .map((x) => keyOfField(field, x))
    .filter((k) => order.includes(k));
  expect(got, `${field}: order follows ${orderFrom}`).toEqual(order);
}

function checkLaws2And3(
  b: Entity,
  t: Entity,
  n: Entity,
  r: Entity,
  tMoved: Set<ListField>,
  nMoved: Set<ListField>
) {
  for (const k of ['title', 'count', 'note', 'rule'] as const) {
    expect(canonicalEqual(r[k], expected(b[k], t[k], n[k])), k).toBe(true);
  }
  for (const k of new Set([
    ...Object.keys(b.loan),
    ...Object.keys(t.loan),
    ...Object.keys(n.loan),
  ])) {
    const pick = (o: AnyRecord) => o[k];
    expect(
      canonicalEqual(pick(r.loan), expected(pick(b.loan), pick(t.loan), pick(n.loan))),
      `loan.${k}`
    ).toBe(true);
  }
  for (const field of LISTS) {
    const orderFrom = !tMoved.has(field) ? 'next' : !nMoved.has(field) ? 'target' : null;
    checkList(field, b, t, n, r, orderFrom);
  }
}

describe('seeded random: all four laws hold', () => {
  const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

  it('Law 1: target === base → result === next (300 seeds)', () => {
    for (const seed of SEEDS) {
      const rng = rngFrom(seed);
      const base = genBase(rng);
      const { e: next } = mutate(rng, base, 'n');
      const { result, ctx } = runEntity(base, next, base);
      expect(result, `seed ${seed}`).toEqual(next);
      expect(ctx.notes, `seed ${seed}`).toEqual([]);
    }
  });

  it('Law 4: next === base → no writes, target untouched (300 seeds)', () => {
    for (const seed of SEEDS) {
      const rng = rngFrom(seed);
      const base = genBase(rng);
      const { e: target } = mutate(rng, base, 't');
      const { result, ctx } = runEntity(target, base, base);
      expect(ctx.writes, `seed ${seed}`).toBe(0);
      expect(result, `seed ${seed}`).toEqual(target);
    }
  });

  it('Laws 2 and 3: concurrent target edits and caller edits both land (300 seeds)', () => {
    for (const seed of SEEDS) {
      const rng = rngFrom(seed);
      const base = genBase(rng);
      const { e: target, moved: tMoved } = mutate(rng, base, 't');
      const { e: next, moved: nMoved } = mutate(rng, base, 'n');
      const { result, ctx } = runEntity(target, next, base);
      try {
        checkLaws2And3(base, target, next, result as Entity, tMoved, nMoved);
      } catch (err) {
        throw new Error(`seed ${seed}: ${(err as Error).message}`);
      }
      expect(verifyFailures(ctx), `seed ${seed}`).toEqual([]);
    }
  });
});
