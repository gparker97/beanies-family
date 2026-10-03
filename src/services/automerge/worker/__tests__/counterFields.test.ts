// @vitest-environment node
/**
 * The Counter-field module (#117 Phase 2, plan `docs/plans/2026-10-03-crdt-counters-117-phase-2.md`
 * §A). Pure table, scale, fold/unfold, the one write primitive in both switch positions, the
 * compaction fold and the rebase growth pass. The Automerge behaviours these rest on are pinned
 * separately in `automergeSemantics.test.ts` (probes e'..o).
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as Automerge from '@automerge/automerge';
import type { FamilyDocument } from '@/types/automerge';
import type { Account, Asset, Goal } from '@/types/models';
import { calculateExtraPayment } from '@/utils/loanPayment';
import {
  COUNTER_FIELDS,
  COUNTER_SCALE,
  COUNTER_WRITES_ENABLED,
  __setCounterWritesForTesting,
  adjustField,
  counterGrowthOps,
  counterKey,
  counterStats,
  foldDoc,
  foldEntity,
  foldIndex,
  foldValue,
  fromMinor,
  isCounterCollection,
  parseCounterKey,
  resolveField,
  sigma,
  toMinor,
  unfoldPatch,
  type CounterCollection,
} from '../counterFields';
import { migrateDoc } from '../docOps';

type Doc = Automerge.Doc<FamilyDocument>;
type AnyRec = Record<string, unknown>;

afterEach(() => __setCounterWritesForTesting(COUNTER_WRITES_ENABLED));

/** A migrated doc holding one account, goal and loan asset, plus `ops` applied as one change. */
function docWith(edit?: (d: FamilyDocument) => void): Doc {
  const seeded = Automerge.change(migrateDoc(Automerge.init<FamilyDocument>()), (d) => {
    (d.accounts as unknown as AnyRec).A = { id: 'A', balance: 100 };
    (d.goals as unknown as AnyRec).G = { id: 'G', currentAmount: 100, targetAmount: 500 };
    (d.assets as unknown as AnyRec).L = { id: 'L', loan: { outstandingBalance: 100 } };
  });
  return edit ? Automerge.change(seeded, edit) : seeded;
}

/** A plain stand-in for a doc's map: `foldIndex` reads numbers as well as Counters. */
const withMap = (map: Record<string, unknown>) => ({ counterDeltas: map });

describe('COUNTER_FIELDS: the table', () => {
  it('names exactly the three adjusted fields', () => {
    const names = Object.entries(COUNTER_FIELDS).flatMap(([c, fs]) =>
      fs.map((f) => `${c}/${f.abs.join('.')}`)
    );
    expect(names).toEqual([
      'accounts/balance',
      'goals/currentAmount',
      'assets/loan.outstandingBalance',
    ]);
  });

  it('every abs path resolves to a number on the model type (compile-time, checked by type-check)', () => {
    // Exhaustive by type: a new collection or path in the table must point at a numeric model
    // field, or this object literal stops compiling.
    type Leaf<E, P> = P extends readonly [infer A extends keyof E]
      ? E[A]
      : P extends readonly [infer A extends keyof E, infer B]
        ? B extends keyof NonNullable<E[A]>
          ? NonNullable<E[A]>[B]
          : never
        : never;
    type Models = { accounts: Account; goals: Goal; assets: Asset };
    type IsNumeric<C extends CounterCollection> =
      NonNullable<Leaf<Models[C], (typeof COUNTER_FIELDS)[C][number]['abs']>> extends number
        ? true
        : false;
    const numeric: { [C in CounterCollection]: IsNumeric<C> } = {
      accounts: true,
      goals: true,
      assets: true,
    };
    expect(Object.keys(numeric).sort()).toEqual(Object.keys(COUNTER_FIELDS).sort());
  });

  it('floors: none on balances (may be negative), 0 on goals and loans', () => {
    expect(resolveField('accounts', 'balance').floor).toBeNull();
    expect(resolveField('goals', 'currentAmount').floor).toBe(0);
    expect(resolveField('assets', 'loan.outstandingBalance').floor).toBe(0);
  });

  it('resolveField throws for a field the table lacks, naming the fix', () => {
    expect(() => resolveField('accounts', 'creditLimit')).toThrow(
      /Add the field to COUNTER_FIELDS/
    );
    expect(() => resolveField('todos', 'balance')).toThrow(/not a Counter field of "todos"/);
  });

  it('isCounterCollection is exactly the table keys', () => {
    expect(isCounterCollection('accounts')).toBe(true);
    expect(isCounterCollection('transactions')).toBe(false);
    expect(isCounterCollection('toString')).toBe(false); // own keys only
  });
});

describe('scale', () => {
  it('round-trips any amount with up to four decimals exactly', () => {
    for (const v of [
      0, 1, -1, 0.1, 0.01, 0.0001, 49.25, -20.25, 1234.5678, -0.3, 0.3, 999999.9999,
    ]) {
      expect(fromMinor(toMinor(v))).toBe(v);
    }
    expect(toMinor(20.25)).toBe(202_500);
    expect(COUNTER_SCALE).toBe(10_000);
  });

  it('rounds past the fourth decimal and normalises -0', () => {
    expect(toMinor(0.30000000000000004)).toBe(3000);
    expect(fromMinor(toMinor(1.23456))).toBe(1.2346);
    expect(Object.is(toMinor(-0.00001), 0)).toBe(true);
  });

  it('throws on NaN, Infinity and past the safe-integer headroom, naming the fix', () => {
    expect(() => toMinor(Number.NaN)).toThrow(/Fix the caller/);
    expect(() => toMinor(Number.POSITIVE_INFINITY)).toThrow(/not a safe integer/);
    expect(() => toMinor(1e12)).toThrow(/headroom/);
    expect(toMinor(9e11)).toBe(9e15);
  });
});

describe('foldValue', () => {
  it('adds minor units in integer space', () => {
    expect(foldValue(100, -507_500, null)).toBe(49.25);
    expect(foldValue(0.1, 2000, null)).toBe(0.3); // 0.1 + 0.2 without the float noise
  });

  it('applies the floor when one is given, never when it is null', () => {
    expect(foldValue(10, -200_000, 0)).toBe(0);
    expect(foldValue(10, -200_000, null)).toBe(-10);
  });

  it('is the identity at minor 0 (no rounding), floor aside', () => {
    expect(foldValue(1.23456789, 0, null)).toBe(1.23456789);
    expect(foldValue(-5, 0, 0)).toBe(0);
  });

  it('reads an absent or non-finite absolute as 0', () => {
    expect(foldValue(undefined, 5000, null)).toBe(0.5);
    expect(foldValue(Number.NaN, 5000, null)).toBe(0.5);
  });
});

describe('counterKey / parseCounterKey', () => {
  it('round-trips every table field', () => {
    for (const [collection, fields] of Object.entries(COUNTER_FIELDS)) {
      for (const f of fields) {
        const field = f.abs.join('.');
        const key = counterKey(collection, 'id-1', field, 'abc123');
        expect(key).toBe(`${collection}/id-1/${field}/abc123`);
        expect(parseCounterKey(key)).toEqual({ collection, id: 'id-1', field });
      }
    }
  });

  it('parses an id containing "/" (fixed segments are read from both ends)', () => {
    expect(parseCounterKey(counterKey('accounts', 'a/b', 'balance', 'w'))).toEqual({
      collection: 'accounts',
      id: 'a/b',
      field: 'balance',
    });
  });

  it('returns null for unparseable keys and for fields this build lacks', () => {
    for (const bad of [
      '',
      'accounts/A/balance',
      'accounts//balance/w',
      'accounts/A/balance/',
      'todos/T/balance/w',
      'accounts/A/creditLimit/w',
    ]) {
      expect(parseCounterKey(bad)).toBeNull();
    }
  });

  it('counterKey refuses a key that could not parse back', () => {
    expect(() => counterKey('accounts', 'A', 'balance', 'a/b')).toThrow(/must not contain/);
    expect(() => counterKey('accounts', '', 'balance', 'w')).toThrow(/non-empty/);
    expect(() => counterKey('accounts', 'A', 'nope', 'w')).toThrow(/COUNTER_FIELDS/);
  });
});

describe('foldIndex / sigma', () => {
  it('sums every writer per (entity, field), in minor units', () => {
    const index = foldIndex(
      withMap({
        'accounts/A/balance/w1': -202_500,
        'accounts/A/balance/w2': -305_000,
        'goals/G/currentAmount/w1': 10_000,
      })
    );
    expect(sigma(index, 'accounts', 'A', 'balance')).toBe(-507_500);
    expect(sigma(index, 'goals', 'G', 'currentAmount')).toBe(10_000);
    expect(sigma(index, 'assets', 'L', 'loan.outstandingBalance')).toBe(0);
    expect(index.malformed).toBe(0);
  });

  it('skips and counts malformed keys and non-integer values, never throws', () => {
    const index = foldIndex(
      withMap({
        'accounts/A/balance/w1': 100,
        garbage: 5,
        'accounts/A/futureField/w1': 7,
        'accounts/A/balance/w2': 1.5,
        'accounts/A/balance/w3': 'x',
      })
    );
    expect(sigma(index, 'accounts', 'A', 'balance')).toBe(100);
    expect(index.malformed).toBe(4);
  });

  it('an absent or empty map is an empty index (unmigrated docs from decryptToDoc)', () => {
    expect(foldIndex({}).size).toBe(0);
    expect(foldIndex({ counterDeltas: null }).size).toBe(0);
    expect(foldIndex(withMap({})).malformed).toBe(0);
    expect(foldIndex(Automerge.init<FamilyDocument>()).size).toBe(0);
  });

  it('reads live Counters from a document', () => {
    __setCounterWritesForTesting(true);
    const doc = docWith((d) => adjustField(d, 'accounts', 'A', 'balance', -20.25, 'w1'));
    expect(sigma(foldIndex(doc), 'accounts', 'A', 'balance')).toBe(-202_500);
  });
});

describe('foldEntity', () => {
  const index = foldIndex(
    withMap({
      'accounts/A/balance/w1': -202_500,
      'accounts/A/balance/w2': -305_000,
      'goals/G/currentAmount/w1': -2_000_000,
      'assets/L/loan.outstandingBalance/w1': -500_000,
      'assets/NOLOAN/loan.outstandingBalance/w1': -500_000,
    })
  );

  it('folds each field to the cent and returns the same object', () => {
    const acct = { id: 'A', balance: 100, name: 'x' };
    expect(foldEntity('accounts', 'A', acct, index)).toBe(acct);
    expect(acct).toEqual({ id: 'A', balance: 49.25, name: 'x' });
    expect(foldEntity('assets', 'L', { loan: { outstandingBalance: 100 } }, index)).toEqual({
      loan: { outstandingBalance: 50 },
    });
  });

  it('applies the read floor on goals and loans', () => {
    expect(foldEntity('goals', 'G', { currentAmount: 100 }, index)).toEqual({ currentAmount: 0 });
  });

  it('a missing leaf reads 0 + Σ; a missing parent (no loan) folds nothing', () => {
    expect(foldEntity('accounts', 'A', { id: 'A' }, index)).toEqual({ id: 'A', balance: -50.75 });
    expect(foldEntity('assets', 'NOLOAN', { id: 'NOLOAN' }, index)).toEqual({ id: 'NOLOAN' });
  });

  it('keys by the map id passed in, not by `plain.id`', () => {
    expect(foldEntity('accounts', 'OTHER', { id: 'A', balance: 100 }, index)).toEqual({
      id: 'A',
      balance: 100,
    });
  });

  it('is the identity for Σ = 0, a non-counter collection and an empty index', () => {
    const odd = { balance: 1.23456789 };
    expect(foldEntity('accounts', 'Z', odd, index)).toEqual({ balance: 1.23456789 });
    expect(foldEntity('todos', 'A', { balance: 1 }, index)).toEqual({ balance: 1 });
    expect(foldEntity('accounts', 'A', { balance: 1 }, foldIndex({}))).toEqual({ balance: 1 });
  });
});

describe('unfoldPatch', () => {
  const index = foldIndex(
    withMap({
      'accounts/A/balance/w1': -507_500,
      'assets/L/loan.outstandingBalance/w1': -500_000,
    })
  );

  it('unfolds patch and base so the fold reads back exactly what was sent', () => {
    const { patch, base } = unfoldPatch(
      'accounts',
      'A',
      { balance: 200 },
      { balance: 49.25 },
      index
    );
    expect(patch).toEqual({ balance: 250.75 });
    expect(base).toEqual({ balance: 100 });
    expect(foldEntity('accounts', 'A', { ...patch }, index)).toEqual({ balance: 200 });
  });

  it('an unchanged folded field stays equal after the unfold (the reconciler writes nothing)', () => {
    const { patch, base } = unfoldPatch(
      'accounts',
      'A',
      { balance: 49.25, name: 'n' },
      { balance: 49.25, name: 'o' },
      index
    );
    expect(patch.balance).toBe(base.balance);
  });

  it('Σ = 0 is the identity: the same objects, values untouched (no rounding)', () => {
    const patch = { balance: 1.23456789 };
    const base = { balance: 1 };
    const out = unfoldPatch('accounts', 'NOKEYS', patch, base, index);
    expect(out.patch).toBe(patch);
    expect(out.base).toBe(base);
    const other = unfoldPatch('todos', 'A', patch, base, index);
    expect(other.patch).toBe(patch);
  });

  it('copies, never mutates: patch, base and the nested loan', () => {
    const loan = { outstandingBalance: 50, rate: 3 };
    const patch = { loan };
    const base = { loan: { outstandingBalance: 50, rate: 2 } };
    const frozen = JSON.stringify({ patch, base });
    const out = unfoldPatch('assets', 'L', patch, base, index);
    expect(JSON.stringify({ patch, base })).toBe(frozen);
    expect(out.patch).not.toBe(patch);
    expect(out.patch.loan).not.toBe(loan);
    expect(out.patch).toEqual({ loan: { outstandingBalance: 100, rate: 3 } });
    expect(out.base).toEqual({ loan: { outstandingBalance: 100, rate: 2 } });
  });

  it('base may be undefined (the `set` case): only the entity is unfolded', () => {
    const out = unfoldPatch('accounts', 'A', { id: 'A', balance: 49.25 }, undefined, index);
    expect(out).toEqual({ patch: { id: 'A', balance: 100 }, base: undefined });
  });

  it('loan re-creation: base has no loan, so only the patch side absorbs the stale keys', () => {
    const out = unfoldPatch('assets', 'L', { loan: { outstandingBalance: 300 } }, {}, index);
    expect(out.patch).toEqual({ loan: { outstandingBalance: 350 } });
    expect(out.base).toEqual({});
    expect(foldEntity('assets', 'L', structuredClone(out.patch), index)).toEqual({
      loan: { outstandingBalance: 300 },
    });
  });

  it('fields without a finite number pass through untouched', () => {
    const patch = { name: 'n', loan: { rate: 3 } };
    expect(unfoldPatch('assets', 'L', patch, undefined, index).patch).toBe(patch);
    const nan = { balance: Number.NaN };
    expect(unfoldPatch('accounts', 'A', nan, undefined, index).patch).toBe(nan);
  });
});

describe('adjustField', () => {
  const read = (doc: Doc) => JSON.parse(JSON.stringify(doc)) as AnyRec;

  it('writes on: creates the writer key, increments in minor units, leaves the absolute', () => {
    __setCounterWritesForTesting(true);
    let doc = docWith((d) => adjustField(d, 'accounts', 'A', 'balance', -20.25, 'w1'));
    doc = Automerge.change(doc, (d) => adjustField(d, 'accounts', 'A', 'balance', -0.5, 'w1'));
    doc = Automerge.change(doc, (d) =>
      adjustField(d, 'assets', 'L', 'loan.outstandingBalance', -10, 'w1')
    );
    expect((doc.accounts.A as Account).balance).toBe(100);
    expect(read(doc).counterDeltas).toEqual({
      'accounts/A/balance/w1': -207_500,
      'assets/L/loan.outstandingBalance/w1': -100_000,
    });
    expect(doc.counterDeltas['accounts/A/balance/w1']).toBeInstanceOf(Automerge.Counter);
  });

  it('writes on: throws when the map is missing (migrateDoc did not run)', () => {
    __setCounterWritesForTesting(true);
    const unmigrated = Automerge.change(Automerge.init<FamilyDocument>(), (d) => {
      (d as unknown as AnyRec).accounts = { A: { id: 'A', balance: 1 } };
    });
    expect(() =>
      Automerge.change(unmigrated, (d) => adjustField(d, 'accounts', 'A', 'balance', 1, 'w'))
    ).toThrow(/Run migrateDoc/);
  });

  it('writes off: integer minor-unit add on the absolute, never touching the map', () => {
    __setCounterWritesForTesting(false);
    const doc = docWith((d) => {
      adjustField(d, 'accounts', 'A', 'balance', -20.25, 'w1');
      adjustField(d, 'goals', 'G', 'currentAmount', 0.1, 'w1');
    });
    expect((doc.accounts.A as Account).balance).toBe(79.75);
    expect((doc.goals.G as Goal).currentAmount).toBe(100.1);
    expect(Object.keys(doc.counterDeltas)).toEqual([]);
  });

  it('writes off: a loan payment lands on round2 newBalance exactly, where a float add misses', () => {
    __setCounterWritesForTesting(false);
    const cur = 394.71;
    const res = calculateExtraPayment(cur, 393.01);
    const delta = res.newBalance - cur;
    expect(cur + delta).not.toBe(res.newBalance); // today's `cur + delta` carries float noise
    const doc = Automerge.change(
      docWith((d) => {
        (d.assets as unknown as Record<string, Asset>).L!.loan!.outstandingBalance = cur;
      }),
      (d) => adjustField(d, 'assets', 'L', 'loan.outstandingBalance', delta, 'w1')
    );
    expect((doc.assets.L as Asset).loan!.outstandingBalance).toBe(res.newBalance);
    expect(Object.keys(doc.counterDeltas)).toEqual([]);
  });

  it('both modes fold to the same value', () => {
    const run = (on: boolean) => {
      __setCounterWritesForTesting(on);
      const doc = docWith((d) => adjustField(d, 'accounts', 'A', 'balance', -20.25, 'w1'));
      const acct = JSON.parse(JSON.stringify(doc.accounts.A)) as AnyRec;
      return foldEntity('accounts', 'A', acct, foldIndex(doc)).balance;
    };
    expect(run(true)).toBe(79.75);
    expect(run(false)).toBe(79.75);
  });

  it('a zero adjustment writes nothing, in either mode', () => {
    for (const on of [true, false]) {
      __setCounterWritesForTesting(on);
      const origin = docWith();
      const after = Automerge.change(origin, (d) =>
        adjustField(d, 'accounts', 'A', 'balance', 0.00001, 'w1')
      );
      expect(Automerge.getHeads(after)).toEqual(Automerge.getHeads(origin));
    }
  });

  it('throws for a missing entity, a missing loan, an unknown field and a NaN delta', () => {
    for (const on of [true, false]) {
      __setCounterWritesForTesting(on);
      const tryAdjust = (edit: (d: FamilyDocument) => void) => () =>
        Automerge.change(
          docWith((d) => {
            (d.assets as unknown as AnyRec).NOLOAN = { id: 'NOLOAN' };
          }),
          edit
        );
      expect(tryAdjust((d) => adjustField(d, 'accounts', 'X', 'balance', 1, 'w'))).toThrow(
        /entity is missing/
      );
      expect(
        tryAdjust((d) => adjustField(d, 'assets', 'NOLOAN', 'loan.outstandingBalance', 1, 'w'))
      ).toThrow(/has no "loan"/);
      expect(tryAdjust((d) => adjustField(d, 'accounts', 'A', 'creditLimit', 1, 'w'))).toThrow(
        /COUNTER_FIELDS/
      );
      expect(tryAdjust((d) => adjustField(d, 'accounts', 'A', 'balance', Number.NaN, 'w'))).toThrow(
        /Fix the caller/
      );
    }
  });

  it('the switch ships off', () => {
    expect(COUNTER_WRITES_ENABLED).toBe(false);
  });
});

describe('foldDoc (the compaction source)', () => {
  it('folds every field, empties the map and ledgers every parsed key', () => {
    __setCounterWritesForTesting(true);
    const doc = docWith((d) => {
      adjustField(d, 'accounts', 'A', 'balance', -20.25, 'w1');
      adjustField(d, 'goals', 'G', 'currentAmount', 30.5, 'w1');
      adjustField(d, 'assets', 'L', 'loan.outstandingBalance', -10, 'w1');
      (d.counterDeltas as unknown as AnyRec)['garbage'] = new Automerge.Counter(3);
    });
    const source = foldDoc(doc);
    expect((source.accounts.A as Account).balance).toBe(79.75);
    expect((source.goals.G as Goal).currentAmount).toBe(130.5);
    expect((source.assets.L as Asset).loan!.outstandingBalance).toBe(90);
    expect(source.counterDeltas).toEqual({});
    expect(source.foldedCounters).toEqual({
      'accounts/A/balance/w1': -202_500,
      'goals/G/currentAmount/w1': 305_000,
      'assets/L/loan.outstandingBalance/w1': -100_000,
    });
    // No Counter instance anywhere: the source is pure JSON.
    expect(JSON.parse(JSON.stringify(source))).toEqual(source);
  });

  it('the ledger is CUMULATIVE across compactions, never replaced', () => {
    __setCounterWritesForTesting(true);
    const first = Automerge.from(
      foldDoc(
        docWith((d) => adjustField(d, 'accounts', 'A', 'balance', -1, 'w1'))
      ) as unknown as AnyRec
    ) as unknown as Doc;
    const second = Automerge.change(first, (d) =>
      adjustField(d, 'accounts', 'A', 'balance', -2, 'w2')
    );
    const source = foldDoc(second);
    expect((source.accounts.A as Account).balance).toBe(97);
    expect(source.foldedCounters).toEqual({
      'accounts/A/balance/w1': -10_000,
      'accounts/A/balance/w2': -20_000,
    });
  });

  it('ledgers a key whose entity or loan is gone (consumed, so a rebase cannot replay it)', () => {
    __setCounterWritesForTesting(true);
    const doc = Automerge.change(
      docWith((d) => adjustField(d, 'assets', 'L', 'loan.outstandingBalance', -10, 'w1')),
      (d) => {
        delete (d.assets as unknown as Record<string, Asset>).L!.loan;
      }
    );
    const source = foldDoc(doc);
    expect(source.assets.L).toEqual({ id: 'L' });
    expect(source.foldedCounters).toEqual({ 'assets/L/loan.outstandingBalance/w1': -100_000 });
  });

  it('a dormant pod: absolutes untouched, empty map, no ledger key', () => {
    const doc = docWith();
    const source = foldDoc(doc);
    expect(source).toEqual({ ...JSON.parse(JSON.stringify(doc)), counterDeltas: {} });
    expect('foldedCounters' in source).toBe(false);
  });
});

describe('counterGrowthOps (the rebase ledger pass)', () => {
  const local = withMap({
    'accounts/A/balance/w1': -300_000, // target holds it live at -100_000 → growth -20
    'accounts/A/balance/w2': -50_000, // target ledgered it at -50_000 → no growth
    'goals/G/currentAmount/w1': 70_000, // target has neither → all of it
    'assets/L/loan.outstandingBalance/w1': -10_000, // ledgered at -4_000 → growth -0.6
    garbage: 1, // malformed → skipped
  });
  const target = {
    counterDeltas: { 'accounts/A/balance/w1': new Automerge.Counter(-100_000) },
    foldedCounters: {
      'accounts/A/balance/w2': -50_000,
      'assets/L/loan.outstandingBalance/w1': -4_000,
    },
  };

  it('emits local minus (live key ?? ledger ?? 0) per entity field, as skip-on-missing increments', () => {
    const { ops, count } = counterGrowthOps(local, target);
    expect(ops).toEqual([
      {
        op: 'increment',
        collection: 'accounts',
        id: 'A',
        field: 'balance',
        delta: -20,
        onMissing: 'skip',
      },
      {
        op: 'increment',
        collection: 'goals',
        id: 'G',
        field: 'currentAmount',
        delta: 7,
        onMissing: 'skip',
      },
      {
        op: 'increment',
        collection: 'assets',
        id: 'L',
        field: 'loan.outstandingBalance',
        delta: -0.6,
        onMissing: 'skip',
      },
    ]);
    expect(count).toBe(3);
  });

  it('groups several writers of one field into one op', () => {
    const { ops } = counterGrowthOps(
      withMap({ 'accounts/A/balance/w1': -10_000, 'accounts/A/balance/w2': -20_000 }),
      {}
    );
    expect(ops).toEqual([
      {
        op: 'increment',
        collection: 'accounts',
        id: 'A',
        field: 'balance',
        delta: -3,
        onMissing: 'skip',
      },
    ]);
  });

  it('no map, or nothing grown, is no ops', () => {
    expect(counterGrowthOps({}, target)).toEqual({ ops: [], count: 0 });
    expect(counterGrowthOps(withMap({ 'accounts/A/balance/w2': -50_000 }), target).ops).toEqual([]);
  });

  it('works on live documents (Counter values on both sides)', () => {
    __setCounterWritesForTesting(true);
    const origin = docWith((d) => adjustField(d, 'accounts', 'A', 'balance', -1, 'w1'));
    const ahead = Automerge.change(Automerge.clone(origin), (d) =>
      adjustField(d, 'accounts', 'A', 'balance', -2.5, 'w1')
    );
    expect(counterGrowthOps(ahead, origin).ops).toEqual([
      {
        op: 'increment',
        collection: 'accounts',
        id: 'A',
        field: 'balance',
        delta: -2.5,
        onMissing: 'skip',
      },
    ]);
  });
});

describe('counterStats', () => {
  it('counts keys, conflicts, malformed keys and the ledger', () => {
    __setCounterWritesForTesting(true);
    const origin = docWith((d) => {
      adjustField(d, 'accounts', 'A', 'balance', -1, 'w1');
      (d.counterDeltas as unknown as AnyRec)['garbage'] = new Automerge.Counter(1);
      (d as unknown as AnyRec).foldedCounters = { 'accounts/A/balance/old': -5 };
    });
    expect(counterStats(origin)).toEqual({ keys: 2, conflicts: 0, malformed: 1, ledgerKeys: 1 });
    // Two actors creating the SAME key: the bug the key design exists to prevent.
    const a = Automerge.change(Automerge.clone(origin), (d) => {
      d.counterDeltas['accounts/A/balance/shared'] = new Automerge.Counter(1);
    });
    const b = Automerge.change(Automerge.clone(origin), (d) => {
      d.counterDeltas['accounts/A/balance/shared'] = new Automerge.Counter(2);
    });
    expect(counterStats(Automerge.merge(a, b)).conflicts).toBe(1);
  });

  it('an absent map reports zeros', () => {
    expect(counterStats(Automerge.init<FamilyDocument>())).toEqual({
      keys: 0,
      conflicts: 0,
      malformed: 0,
      ledgerKeys: 0,
    });
  });
});
