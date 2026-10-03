// @vitest-environment node
/**
 * Automerge semantics the fine-grained write path depends on (#117, plan
 * `docs/plans/2026-10-01-crdt-merge-safe-writes.md`, "Automerge semantics are
 * hypotheses until probed").
 *
 * These are NOT tests of our code. They pin the library behaviour that
 * `reconcile.ts`, the committed migration changes (plan F) and the Phase 2
 * Counter fold assume, on `@automerge/automerge` 3.4.1. An upgrade that changes
 * any of them must fail here, in CI, rather than silently corrupt merges in a
 * family's pod. If one of these fails after an upgrade, do not "fix" the test:
 * re-read the plan section that depends on it.
 *
 *  (a) per-key assignment on a list element and splice/push on a proxied list
 *      merge as expected; an empty change leaves heads unchanged; `delete
 *      list[i]` removes on the proxy but leaves a hole on a plain array, which
 *      is why the reconciler only ever uses `splice`.
 *  (b) a move (insert a plain copy + splice the original) inside one change
 *      merges with a concurrent field edit and push on other elements.
 *  (c) a deterministic migration change (fixed actor, seq 1, deps [], time 0)
 *      applied on two devices with divergent histories dedupes to ONE map, so
 *      both devices' entities land in it; applied where the key holds a `null`
 *      written behind earlier ops, the key stays `null` (on an op-counter tie
 *      the higher actor wins instead, so "stays null" is not unconditional).
 *  (d) `getConflicts` reports both values for a root key both devices assigned.
 *  (e) Phase 2: two devices concurrently creating a Counter at the same entity
 *      key are both readable through `getConflicts` on the nested object.
 *
 * Phase 2 (plan `docs/plans/2026-10-03-crdt-counters-117-phase-2.md`, Assumption 2). These
 * are why `counterFields.ts` keeps ONE writer per key, in integer minor units, in a root map:
 *  (e') a later increment applies to EVERY conflicting Counter at a key, so a key two actors
 *       created can never be summed correctly again (the lazy-Counter sketch was unsafe).
 *  (f) plain reads on `view(doc, heads)` are heads-aware; `getConflicts` on a view is not.
 *  (g) `toJS` keeps a Counter as a `Counter`, `from` re-imports it as one, and a folded plain
 *      source (empty map, plain-number ledger) imports as plain values.
 *  (h) `diff` reports a Counter creation as `put` (a Counter) and an increment as `inc` (a
 *      number) at `[counterDeltas, key]`, so `touchedBetween` sees the key.
 *  (j) an absolute set concurrent with an increment merges to `set + delta`.
 *  (k) Counters survive `save`/`load`.
 *  (l) a Counter truncates a non-integer increment and holds integers exactly up to
 *      `MAX_SAFE_INTEGER`: the minor-unit scale is mandatory and sufficient.
 *  (m) inside a change callback a draft Counter's `.value` already includes this change's
 *      increments, so a handler may fold on the draft.
 *  (n) `JSON.stringify` of a Counter is its number (`toPlain` folds a single-writer key for
 *      free); `getConflicts` on the nested map is `undefined` for one writer, one entry each
 *      for a conflict.
 *  (o) the actor is stable across `merge` and fresh on every `load` (no actor pinned), and an
 *      absent root key reads `undefined`.
 */
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import * as Automerge from '@automerge/automerge';

type AnyRecord = Record<string, unknown>;
type Item = { id: string; name: string; done?: boolean };
type ListDoc = { items: Item[] };

const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Fork `origin` into two devices with distinct random actors. */
function fork<T>(origin: Automerge.Doc<T>): { a: Automerge.Doc<T>; b: Automerge.Doc<T> } {
  const a = Automerge.clone(origin);
  const b = Automerge.clone(origin);
  expect(Automerge.getActorId(a)).not.toBe(Automerge.getActorId(b));
  return { a, b };
}

/** Merge both ways and return one side after asserting they converged. */
function converge<T>(a: Automerge.Doc<T>, b: Automerge.Doc<T>): Automerge.Doc<T> {
  const ab = Automerge.merge(Automerge.clone(a), b);
  const ba = Automerge.merge(Automerge.clone(b), a);
  expect(plain(ab)).toEqual(plain(ba));
  return ab;
}

function listOrigin(): Automerge.Doc<ListDoc> {
  return Automerge.from<ListDoc>({
    items: [
      { id: 'x', name: 'milk' },
      { id: 'y', name: 'eggs' },
      { id: 'z', name: 'bread' },
    ],
  });
}

/** The plan-F migration change for `name`, built exactly as the generator will. */
function migrationChange(name: string): Uint8Array {
  const actor = createHash('sha256')
    .update('beanies-migration:' + name)
    .digest('hex')
    .slice(0, 16);
  const empty = Automerge.init<AnyRecord>({ actor });
  const created = Automerge.change(empty, { time: 0 }, (d) => {
    d[name] = {};
  });
  const change = Automerge.getLastLocalChange(created);
  if (!change) throw new Error('migration change was not produced');
  return change;
}

describe('automerge semantics (a): fine-grained list edits', () => {
  it('a per-key edit on one element and a push on another device both survive', () => {
    const { a, b } = fork(listOrigin());
    const a2 = Automerge.change(a, (d) => {
      d.items[0]!.done = true;
    });
    const b2 = Automerge.change(b, (d) => {
      d.items.push({ id: 'w', name: 'jam' });
    });
    expect(plain(converge(a2, b2)).items).toEqual([
      { id: 'x', name: 'milk', done: true },
      { id: 'y', name: 'eggs' },
      { id: 'z', name: 'bread' },
      { id: 'w', name: 'jam' },
    ]);
  });

  it('a splice removal on one device and a field edit on another element both survive', () => {
    const { a, b } = fork(listOrigin());
    const a2 = Automerge.change(a, (d) => {
      d.items.splice(1, 1);
    });
    const b2 = Automerge.change(b, (d) => {
      d.items[2]!.name = 'rye';
    });
    expect(plain(converge(a2, b2)).items).toEqual([
      { id: 'x', name: 'milk' },
      { id: 'z', name: 'rye' },
    ]);
  });

  it('a change callback that writes nothing leaves heads unchanged', () => {
    const origin = listOrigin();
    const after = Automerge.change(origin, () => {});
    expect(Automerge.getHeads(after)).toEqual(Automerge.getHeads(origin));
  });

  it('`delete list[i]` removes on the proxy but leaves a hole on a plain array', () => {
    const doc = Automerge.change(Automerge.from({ xs: [1, 2, 3] }), (d) => {
      delete (d.xs as unknown as AnyRecord)[1];
    });
    expect(plain(doc).xs).toEqual([1, 3]);
    const arr = [1, 2, 3];
    delete (arr as unknown as AnyRecord)[1];
    expect(plain(arr)).toEqual([1, null, 3]);
  });
});

describe('automerge semantics (b): a move is insert-copy + splice in one change', () => {
  it('a move on A and a field edit + push on B merge to all three changes', () => {
    const { a, b } = fork(listOrigin());
    const a2 = Automerge.change(a, (d) => {
      const moved = plain(d.items[2]!);
      d.items.splice(2, 1);
      d.items.splice(0, 0, moved);
    });
    expect(plain(a2).items.map((i) => i.id)).toEqual(['z', 'x', 'y']);
    const b2 = Automerge.change(b, (d) => {
      d.items[1]!.name = 'free-range eggs';
      d.items.push({ id: 'w', name: 'jam' });
    });
    expect(plain(converge(a2, b2)).items).toEqual([
      { id: 'z', name: 'bread' },
      { id: 'x', name: 'milk' },
      { id: 'y', name: 'free-range eggs' },
      { id: 'w', name: 'jam' },
    ]);
  });
});

describe('automerge semantics (c): deterministic migration change', () => {
  const NAME = 'newCollection';

  it('decodes to seq 1, startOp 1, deps [], time 0 and creates only the empty map', () => {
    const change = migrationChange(NAME);
    const decoded = Automerge.decodeChange(change);
    expect(decoded.seq).toBe(1);
    expect(decoded.startOp).toBe(1);
    expect(decoded.deps).toEqual([]);
    expect(decoded.time).toBe(0);
    expect(decoded.actor).toHaveLength(16);
    // Byte-for-byte deterministic within one Automerge version.
    expect(Array.from(migrationChange(NAME))).toEqual(Array.from(change));
    const [alone] = Automerge.applyChanges(Automerge.init<AnyRecord>(), [change]);
    expect(plain(alone)).toEqual({ [NAME]: {} });
  });

  it('two devices with divergent histories share one map, so both entities land', () => {
    const origin = Automerge.from<AnyRecord>({ settings: { theme: 'dark' } });
    const { a, b } = fork(origin);
    // Divergent histories before the migration: each device has its own edits.
    const a1 = Automerge.change(a, (d) => {
      (d.settings as AnyRecord).theme = 'light';
    });
    const b1 = Automerge.change(b, (d) => {
      (d.settings as AnyRecord).lang = 'en';
    });
    const [a2] = Automerge.applyChanges(a1, [migrationChange(NAME)]);
    const [b2] = Automerge.applyChanges(b1, [migrationChange(NAME)]);
    const a3 = Automerge.change(a2, (d) => {
      (d[NAME] as AnyRecord).e1 = { id: 'e1' };
    });
    const b3 = Automerge.change(b2, (d) => {
      (d[NAME] as AnyRecord).e2 = { id: 'e2' };
    });
    const merged = converge(a3, b3);
    expect(plain(merged)[NAME]).toEqual({ e1: { id: 'e1' }, e2: { id: 'e2' } });
    // One object id, so no root conflict at the key. On 3.4.1 `getConflicts`
    // returns `undefined` unless a key holds MORE than one value.
    expect(Automerge.getConflicts(merged, NAME)).toBeUndefined();
  });

  // The stored change has deps [] and op counter 1, so it is CONCURRENT with
  // whatever wrote the `null`, and Automerge keeps the op with the higher
  // (counter, actor). A real pod's `null` sits behind earlier ops, so it wins
  // on counter and the key stays `null`. That is why plan F applies the stored
  // change only to ABSENT keys and keeps an ordinary change for `null` ones.
  it('applied where the key holds a null written after earlier ops, the key stays null', () => {
    const history = Automerge.change(Automerge.from<AnyRecord>({ settings: {} }), (d) => {
      (d.settings as AnyRecord).theme = 'dark';
    });
    const withNull = Automerge.change(history, (d) => {
      d[NAME] = null;
    });
    const [after] = Automerge.applyChanges(withNull, [migrationChange(NAME)]);
    expect(after[NAME]).toBeNull();
    // ...and the two values are a root conflict, which plan F's detection counts.
    expect(Object.keys(Automerge.getConflicts(after, NAME) ?? {})).toHaveLength(2);
  });

  it('on a counter tie (null at op 1) the higher actor wins: not "always null"', () => {
    const nullAt1 = (actor: string) =>
      Automerge.change(Automerge.init<AnyRecord>({ actor }), (d) => {
        d[NAME] = null;
      });
    const [highActor] = Automerge.applyChanges(nullAt1('ff'.repeat(16)), [migrationChange(NAME)]);
    const [lowActor] = Automerge.applyChanges(nullAt1('00'.repeat(16)), [migrationChange(NAME)]);
    expect(highActor[NAME]).toBeNull();
    expect(plain(lowActor[NAME])).toEqual({});
  });
});

describe('automerge semantics (d): root conflicts are visible', () => {
  it('getConflicts reports both values for a root key both devices assigned', () => {
    const { a, b } = fork(Automerge.init<AnyRecord>());
    const a2 = Automerge.change(a, (d) => {
      d.coll = { e1: { id: 'e1' } };
    });
    const b2 = Automerge.change(b, (d) => {
      d.coll = { e2: { id: 'e2' } };
    });
    const merged = converge(a2, b2);
    expect(Object.keys(Automerge.getConflicts(merged, 'coll') ?? {})).toHaveLength(2);
  });
});

describe('automerge semantics (e): concurrent lazy Counter creation (Phase 2)', () => {
  it('both counters are readable via getConflicts on the nested object and sum exactly', () => {
    const origin = Automerge.from<AnyRecord>({ accounts: { a1: { id: 'a1', balance: 100 } } });
    const { a, b } = fork(origin);
    const debit = (doc: Automerge.Doc<AnyRecord>, by: number) =>
      Automerge.change(doc, (d) => {
        const acct = (d.accounts as AnyRecord).a1 as AnyRecord;
        acct.balanceDelta = new Automerge.Counter();
        (acct.balanceDelta as Automerge.Counter).increment(by);
      });
    const merged = converge(debit(a, -20), debit(b, -30));
    const acct = (merged.accounts as AnyRecord).a1 as AnyRecord;
    const values = Object.values(Automerge.getConflicts(acct, 'balanceDelta') ?? {});
    expect(values).toHaveLength(2);
    const sum = values.reduce<number>((s, v) => s + (v as Automerge.Counter).value, 0);
    expect(sum).toBe(-50);
  });
});

// ─── Phase 2: single-writer Counters in a root map ──────────────────────────────

type CounterDoc = { counterDeltas: Record<string, Automerge.Counter> } & AnyRecord;
const KEY = 'accounts/A/balance/w';

/** A doc whose `counterDeltas` map is ONE object on every fork (as the stored change makes it). */
function counterOrigin(): Automerge.Doc<CounterDoc> {
  return Automerge.from<CounterDoc>({
    counterDeltas: {},
    accounts: { A: { id: 'A', balance: 100 } },
  });
}

/** Increment `key` by `by` in one change, creating the Counter first when `create`. */
const bump = (doc: Automerge.Doc<CounterDoc>, key: string, by: number, create = false) =>
  Automerge.change(doc, (d) => {
    if (create) d.counterDeltas[key] = new Automerge.Counter();
    d.counterDeltas[key]!.increment(by);
  });

const counterValues = (doc: Automerge.Doc<CounterDoc>, key: string): number[] =>
  Object.values(Automerge.getConflicts(doc.counterDeltas, key) ?? {})
    .map((v) => (v as Automerge.Counter).value)
    .sort((x, y) => x - y);

describe("automerge semantics (e'): a later increment double-applies to conflicting Counters", () => {
  it('two lazily created Counters (-20, -30) plus one increment of -5 read -25 and -35', () => {
    const { a, b } = fork(counterOrigin());
    const merged = converge(bump(a, KEY, -20, true), bump(b, KEY, -30, true));
    // The true total after the increment is -55. The sum of conflicts is -60 and the winner is
    // one of them: neither read is right, and the error grows with every later increment.
    expect(counterValues(bump(merged, KEY, -5), KEY)).toEqual([-35, -25]);
  });
});

describe('automerge semantics (f): view reads are heads-aware, getConflicts on a view is not', () => {
  it('a key absent at older heads reads undefined on the view; getConflicts still reports now', () => {
    const origin = counterOrigin();
    const baseline = Automerge.getHeads(origin);
    const { a, b } = fork(origin);
    const merged = converge(bump(a, KEY, -20, true), bump(b, KEY, -30, true));
    const old = Automerge.view(merged, baseline);
    expect(old.counterDeltas[KEY]).toBeUndefined();
    expect(counterValues(old, KEY)).toEqual([-30, -20]);
  });
});

describe('automerge semantics (g): toJS / from carry Counters; a folded source is plain', () => {
  it('toJS keeps a Counter instance, from re-imports it as a working Counter', () => {
    const doc = bump(counterOrigin(), KEY, -202_500, true);
    const js = Automerge.toJS(doc);
    expect(js.counterDeltas[KEY]).toBeInstanceOf(Automerge.Counter);
    expect(js.counterDeltas[KEY]!.value).toBe(-202_500);
    const rebuilt = Automerge.from<CounterDoc>(js);
    expect(rebuilt.counterDeltas[KEY]).toBeInstanceOf(Automerge.Counter);
    expect(bump(rebuilt, KEY, -1).counterDeltas[KEY]!.value).toBe(-202_501);
  });

  it('a folded source (empty map, plain-number ledger) imports as plain values', () => {
    const source = {
      counterDeltas: {},
      foldedCounters: { [KEY]: -202_500 },
      accounts: { A: { id: 'A', balance: 79.75 } },
    };
    const rebuilt = Automerge.from<AnyRecord>(structuredClone(source));
    const ledger = rebuilt.foldedCounters as Record<string, unknown>;
    expect(ledger[KEY]).toBe(-202_500);
    expect(ledger[KEY]).not.toBeInstanceOf(Automerge.Counter);
    expect(plain(rebuilt)).toEqual(source);
  });
});

describe('automerge semantics (h): diff reports Counter writes at [counterDeltas, key]', () => {
  it('creation is `put` with a Counter, an increment is `inc` with a number', () => {
    const origin = counterOrigin();
    const created = bump(origin, KEY, 0, true);
    const incremented = bump(created, KEY, -7);
    const puts = Automerge.diff(
      incremented,
      Automerge.getHeads(origin),
      Automerge.getHeads(created)
    );
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ action: 'put', path: ['counterDeltas', KEY] });
    expect((puts[0] as { value: unknown }).value).toBeInstanceOf(Automerge.Counter);
    const incs = Automerge.diff(
      incremented,
      Automerge.getHeads(created),
      Automerge.getHeads(incremented)
    );
    expect(incs).toEqual([{ action: 'inc', path: ['counterDeltas', KEY], value: -7 }]);
  });
});

describe('automerge semantics (j): an absolute set concurrent with an increment', () => {
  it('merges to set + delta (both survive: the transaction happened, so it is counted)', () => {
    const { a, b } = fork(counterOrigin());
    const setOnA = Automerge.change(a, (d) => {
      (d.accounts as Record<string, AnyRecord>).A!.balance = 200;
    });
    const merged = converge(setOnA, bump(b, KEY, -202_500, true)); // -20.25 in minor units
    const balance = (merged.accounts as Record<string, AnyRecord>).A!.balance as number;
    const minor = merged.counterDeltas[KEY]!.value;
    expect([balance, minor]).toEqual([200, -202_500]);
    expect((Math.round(balance * 10_000) + minor) / 10_000).toBe(179.75);
  });
});

describe('automerge semantics (k): Counters survive save/load', () => {
  it('a loaded Counter keeps its value and stays incrementable', () => {
    const loaded = Automerge.load<CounterDoc>(
      Automerge.save(bump(counterOrigin(), KEY, -202_500, true))
    );
    expect(loaded.counterDeltas[KEY]).toBeInstanceOf(Automerge.Counter);
    expect(loaded.counterDeltas[KEY]!.value).toBe(-202_500);
    expect(bump(loaded, KEY, 2_500).counterDeltas[KEY]!.value).toBe(-200_000);
  });
});

describe('automerge semantics (l): Counters are integer-only', () => {
  it('a non-integer increment is truncated, and a fractional one is dropped', () => {
    const halved = bump(counterOrigin(), KEY, -20.5, true);
    expect(halved.counterDeltas[KEY]!.value).toBe(-20);
    expect(bump(halved, KEY, 0.25).counterDeltas[KEY]!.value).toBe(-20);
  });

  it('holds integers exactly up to MAX_SAFE_INTEGER (through save/load)', () => {
    const big = 9_007_199_254_739_980;
    const doc = Automerge.load<CounterDoc>(Automerge.save(bump(counterOrigin(), KEY, big, true)));
    expect(doc.counterDeltas[KEY]!.value).toBe(big);
    expect(bump(doc, KEY, -big).counterDeltas[KEY]!.value).toBe(0);
  });
});

describe('automerge semantics (m): a draft Counter reads its own change', () => {
  it("Object.entries(draft.counterDeltas) yields Counters whose value includes this change's increments", () => {
    const origin = bump(counterOrigin(), KEY, -10, true);
    let seen: number[] = [];
    Automerge.change(origin, (d) => {
      d.counterDeltas[KEY]!.increment(-5);
      d.counterDeltas['goals/G/currentAmount/w'] = new Automerge.Counter();
      d.counterDeltas['goals/G/currentAmount/w']!.increment(7);
      seen = Object.entries(d.counterDeltas).map(([, c]) => {
        expect(c).toBeInstanceOf(Automerge.Counter);
        return c.value;
      });
    });
    expect(seen.sort((x, y) => x - y)).toEqual([-15, 7]);
  });
});

describe('automerge semantics (n): JSON of a Counter, and conflicts on a nested map', () => {
  it('JSON.stringify of a map holding a Counter yields the plain number', () => {
    const doc = bump(counterOrigin(), KEY, -202_500, true);
    expect(JSON.parse(JSON.stringify(doc.counterDeltas))).toEqual({ [KEY]: -202_500 });
  });

  it('getConflicts on the nested map: undefined for one writer, one entry per writer otherwise', () => {
    const single = bump(counterOrigin(), KEY, -1, true);
    expect(Automerge.getConflicts(single.counterDeltas, KEY)).toBeUndefined();
    const { a, b } = fork(counterOrigin());
    const merged = converge(bump(a, KEY, -1, true), bump(b, KEY, -2, true));
    expect(counterValues(merged, KEY)).toEqual([-2, -1]);
  });
});

describe('automerge semantics (o): actor lifetime, and an absent root key', () => {
  it('the actor is stable across merge and fresh on every load (no actor pinned)', () => {
    const { a, b } = fork(counterOrigin());
    const actor = Automerge.getActorId(a);
    const merged = Automerge.merge(a, bump(b, KEY, 1, true));
    expect(Automerge.getActorId(merged)).toBe(actor);
    const bytes = Automerge.save(merged);
    const one = Automerge.load<CounterDoc>(bytes);
    const two = Automerge.load<CounterDoc>(bytes);
    expect(Automerge.getActorId(one)).not.toBe(actor);
    expect(Automerge.getActorId(one)).not.toBe(Automerge.getActorId(two));
  });

  it('an absent counterDeltas reads undefined on a plain read', () => {
    const legacy = Automerge.from<AnyRecord>({ accounts: {} });
    expect(legacy.counterDeltas).toBeUndefined();
  });
});
