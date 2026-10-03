// @vitest-environment node
/**
 * The Counter-field module (#117 Phase 2, plan `docs/plans/2026-10-03-crdt-counters-117-phase-2.md`
 * §A). Pure table, per-currency scale, fold/unfold, the one write primitive in both switch
 * positions, the compaction fold and the rebase growth pass. The Automerge behaviours these rest
 * on are pinned separately in `automergeSemantics.test.ts` (probes e'..o).
 *
 * Fixture entities carry no `currency` unless a test says otherwise, so they are at the default
 * scale (two decimals): a key reads `…/balance@2/…` and its Counter holds cents.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Automerge from '@automerge/automerge';
import type { FamilyDocument } from '@/types/automerge';
import type { Account, Asset, CurrencyCode, Goal } from '@/types/models';
import { CURRENCIES } from '@/constants/currencies';
import { StaleBuildCounterError } from '@/types/sync';
import { calculateExtraPayment } from '@/utils/loanPayment';
import {
  COUNTER_FIELDS,
  COUNTER_WRITES_ENABLED,
  MAX_COUNTER_DECIMALS,
  MIN_COUNTER_DECIMALS,
  __setCounterWritesForTesting,
  adjustField,
  counterGrowthOps,
  counterKey,
  counterStats,
  decimalsFor,
  fieldDecimals,
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

/** This test's device and its writer segment (`${device}:${actor}`). */
const W1 = 'dev:w1';

afterEach(() => __setCounterWritesForTesting(COUNTER_WRITES_ENABLED));

/** A migrated doc holding one account, goal and loan asset (plus a BTC account), plus `edit`. */
function docWith(edit?: (d: FamilyDocument) => void): Doc {
  const seeded = Automerge.change(migrateDoc(Automerge.init<FamilyDocument>()), (d) => {
    (d.accounts as unknown as AnyRec).A = { id: 'A', balance: 100 };
    (d.accounts as unknown as AnyRec).BTC = { id: 'BTC', balance: 0.5, currency: 'BTC' };
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

  it('every abs path resolves to a number and every currency path to a CurrencyCode (compile-time)', () => {
    // Exhaustive by type: a new collection or path in the table must point at a numeric model
    // field and at the entity's CurrencyCode, or this object literal stops compiling.
    type Leaf<E, P> = P extends readonly [infer A extends keyof E]
      ? E[A]
      : P extends readonly [infer A extends keyof E, infer B]
        ? B extends keyof NonNullable<E[A]>
          ? NonNullable<E[A]>[B]
          : never
        : never;
    type Models = { accounts: Account; goals: Goal; assets: Asset };
    type Spec<C extends CounterCollection> = (typeof COUNTER_FIELDS)[C][number];
    type IsSound<C extends CounterCollection> =
      NonNullable<Leaf<Models[C], Spec<C>['abs']>> extends number
        ? Leaf<Models[C], Spec<C>['currency']> extends CurrencyCode
          ? true
          : false
        : false;
    const sound: { [C in CounterCollection]: IsSound<C> } = {
      accounts: true,
      goals: true,
      assets: true,
    };
    expect(Object.keys(sound).sort()).toEqual(Object.keys(COUNTER_FIELDS).sort());
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

describe('decimalsFor / fieldDecimals: the scale is the currency minor unit', () => {
  it("reads CURRENCIES' minor unit, clamped to [2, 8]", () => {
    expect(decimalsFor('USD')).toBe(2);
    expect(decimalsFor('XRP')).toBe(6);
    expect(decimalsFor('BTC')).toBe(8);
    expect(decimalsFor('JPY')).toBe(2); // 0 in CURRENCIES, clamped up
    expect(decimalsFor('KRW')).toBe(2);
  });

  it('an unknown or absent code is the minimum', () => {
    expect(decimalsFor('IDR')).toBe(MIN_COUNTER_DECIMALS);
    expect(decimalsFor(undefined)).toBe(MIN_COUNTER_DECIMALS);
    expect(decimalsFor(42)).toBe(MIN_COUNTER_DECIMALS);
  });

  it('every listed currency lands inside the clamp', () => {
    for (const { code } of CURRENCIES) {
      const d = decimalsFor(code);
      expect(d).toBeGreaterThanOrEqual(MIN_COUNTER_DECIMALS);
      expect(d).toBeLessThanOrEqual(MAX_COUNTER_DECIMALS);
    }
  });

  it("fieldDecimals takes the first source with a currency: the patch's, then the stored entity's", () => {
    const spec = resolveField('accounts', 'balance');
    expect(fieldDecimals(spec, { balance: 1 }, { currency: 'BTC' })).toBe(8);
    expect(fieldDecimals(spec, { currency: 'XRP' }, { currency: 'BTC' })).toBe(6);
    expect(fieldDecimals(spec, undefined, null)).toBe(2);
  });
});

describe('scale', () => {
  it('round-trips any amount with up to d decimals exactly, at 2, 6 and 8 decimals', () => {
    for (const v of [0, 1, -1, 0.1, 0.01, 49.25, -20.25, 1234.56, -0.3, 999999.99]) {
      expect(fromMinor(toMinor(v, 2), 2)).toBe(v);
    }
    for (const v of [0.000001, 12.345678, -0.5]) expect(fromMinor(toMinor(v, 6), 6)).toBe(v);
    for (const v of [0.00000001, 0.12345678, -1.00004, 21.5]) {
      expect(fromMinor(toMinor(v, 8), 8)).toBe(v);
    }
    expect(toMinor(20.25, 2)).toBe(2025);
    expect(toMinor(0.00004, 8)).toBe(4000);
  });

  it('rounds past the scale and normalises -0', () => {
    expect(toMinor(0.30000000000000004, 2)).toBe(30);
    expect(fromMinor(toMinor(1.23456, 2), 2)).toBe(1.23);
    expect(Object.is(toMinor(-0.001, 2), 0)).toBe(true);
  });

  it('throws on NaN, Infinity and past the safe-integer headroom, naming the fix', () => {
    expect(() => toMinor(Number.NaN, 2)).toThrow(/Fix the caller/);
    expect(() => toMinor(Number.POSITIVE_INFINITY, 2)).toThrow(/not a safe integer/);
    expect(() => toMinor(1e14, 2)).toThrow(/headroom/);
    expect(() => toMinor(1e8, 8)).toThrow(/headroom/);
    expect(toMinor(9e13, 2)).toBe(9e15);
  });
});

describe('foldValue', () => {
  it('adds in major units and rounds to the entity scale', () => {
    expect(foldValue(100, -50.75, null, 2)).toBe(49.25);
    expect(foldValue(0.1, 0.2, null, 2)).toBe(0.3); // 0.1 + 0.2 without the float noise
    expect(foldValue(0.5, 0.00004, null, 8)).toBe(0.50004);
  });

  it('applies the floor when one is given, never when it is null', () => {
    expect(foldValue(10, -20, 0, 2)).toBe(0);
    expect(foldValue(10, -20, null, 2)).toBe(-10);
  });

  it('is the identity at Σ 0 (no rounding), floor aside', () => {
    expect(foldValue(1.23456789, 0, null, 2)).toBe(1.23456789);
    expect(foldValue(-5, 0, 0, 2)).toBe(0);
  });

  it('reads an absent or non-finite absolute as 0', () => {
    expect(foldValue(undefined, 0.5, null, 2)).toBe(0.5);
    expect(foldValue(Number.NaN, 0.5, null, 2)).toBe(0.5);
  });
});

describe('counterKey / parseCounterKey', () => {
  it('round-trips every table field, the scale and a device:actor writer', () => {
    for (const [collection, fields] of Object.entries(COUNTER_FIELDS)) {
      for (const f of fields) {
        const field = f.abs.join('.');
        const key = counterKey(collection, 'id-1', field, 6, 'dev-1:abc123');
        expect(key).toBe(`${collection}/id-1/${field}@6/dev-1:abc123`);
        expect(parseCounterKey(key)).toEqual({
          collection,
          id: 'id-1',
          field,
          decimals: 6,
          writer: 'dev-1:abc123',
        });
      }
    }
  });

  it('parses an id containing "/" or "@" (fixed segments are read from both ends)', () => {
    expect(parseCounterKey(counterKey('accounts', 'a/b@c', 'balance', 2, 'd:w'))).toEqual({
      collection: 'accounts',
      id: 'a/b@c',
      field: 'balance',
      decimals: 2,
      writer: 'd:w',
    });
  });

  it('returns null for unparseable keys and for fields this build lacks', () => {
    for (const bad of [
      '',
      'accounts/A/balance@2',
      'accounts//balance@2/w',
      'accounts/A/balance@2/',
      'accounts/A/balance/w', // no scale
      'accounts/A/balance@x/w',
      'accounts/A/@2/w',
      'todos/T/balance@2/w',
      'accounts/A/creditLimit@2/w',
    ]) {
      expect(parseCounterKey(bad)).toBeNull();
    }
  });

  it('counterKey refuses a key that could not parse back, or an unwritable scale', () => {
    expect(() => counterKey('accounts', 'A', 'balance', 2, 'a/b')).toThrow(/must not contain/);
    expect(() => counterKey('accounts', '', 'balance', 2, 'w')).toThrow(/non-empty/);
    expect(() => counterKey('accounts', 'A', 'nope', 2, 'w')).toThrow(/COUNTER_FIELDS/);
    expect(() => counterKey('accounts', 'A', 'balance', 1, 'w')).toThrow(/decimals/);
    expect(() => counterKey('accounts', 'A', 'balance', 9, 'w')).toThrow(/decimals/);
    expect(() => counterKey('accounts', 'A', 'balance', 2.5, 'w')).toThrow(/decimals/);
  });
});

describe('foldIndex / sigma', () => {
  it('sums every writer per (entity, field), in major units', () => {
    const index = foldIndex(
      withMap({
        'accounts/A/balance@2/d:w1': -2025,
        'accounts/A/balance@2/d:w2': -3050,
        'goals/G/currentAmount@2/d:w1': 100,
      })
    );
    expect(sigma(index, 'accounts', 'A', 'balance')).toBe(-50.75);
    expect(sigma(index, 'goals', 'G', 'currentAmount')).toBe(1);
    expect(sigma(index, 'assets', 'L', 'loan.outstandingBalance')).toBe(0);
    expect(index.malformed).toBe(0);
  });

  it('keys at different scales are summed exactly per scale, then added in major units', () => {
    // A currency change between writes: the old keys keep the scale they were written at.
    const index = foldIndex(
      withMap({
        'accounts/A/balance@2/d:w1': -2025, // -20.25
        'accounts/A/balance@8/d:w2': 1_000_000, // +0.01
        'accounts/A/balance@8/d:w3': 4000, // +0.00004
      })
    );
    expect(sigma(index, 'accounts', 'A', 'balance')).toBeCloseTo(-20.23996, 12);
  });

  it('skips and classifies bad keys, never throws', () => {
    const index = foldIndex(
      withMap({
        'accounts/A/balance@2/w1': 100,
        garbage: 5,
        'accounts/A/futureField@2/w1': 7,
        'accounts/A/balance@2/w2': 1.5,
        'accounts/A/balance@2/w3': 'x',
        'todos/T/balance@2/w1': 1,
      })
    );
    expect(sigma(index, 'accounts', 'A', 'balance')).toBe(1);
    expect(index.malformed).toBe(5);
    // A KNOWN collection's unknown field is a newer build's key; the rest nothing can read.
    expect(index.unknownField).toEqual({ collection: 'accounts', field: 'futureField' });
    expect(index.firstMalformed).toEqual({
      collection: '(unparseable)',
      field: '(unparseable)',
    });
  });

  it('a well-formed key with a non-integer value is labelled by collection and field only', () => {
    const index = foldIndex(withMap({ 'accounts/SECRET-ID/balance@2/dev:actor': 1.5 }));
    expect(index.firstMalformed).toEqual({ collection: 'accounts', field: 'balance' });
    expect(index.unknownField).toBeNull();
  });

  it('an absent or empty map is an empty index (unmigrated docs from decryptToDoc)', () => {
    expect(foldIndex({}).size).toBe(0);
    expect(foldIndex({ counterDeltas: null }).size).toBe(0);
    expect(foldIndex(withMap({})).malformed).toBe(0);
    expect(foldIndex(Automerge.init<FamilyDocument>()).size).toBe(0);
  });

  it('reads live Counters from a document', () => {
    __setCounterWritesForTesting(true);
    const doc = docWith((d) => adjustField(d, 'accounts', 'A', 'balance', -20.25, W1));
    expect(sigma(foldIndex(doc), 'accounts', 'A', 'balance')).toBe(-20.25);
  });
});

describe('foldEntity', () => {
  const index = foldIndex(
    withMap({
      'accounts/A/balance@2/d:w1': -2025,
      'accounts/A/balance@2/d:w2': -3050,
      'accounts/BTC/balance@8/d:w1': 4000,
      'goals/G/currentAmount@2/d:w1': -20_000,
      'assets/L/loan.outstandingBalance@2/d:w1': -5000,
      'assets/NOLOAN/loan.outstandingBalance@2/d:w1': -5000,
    })
  );

  it('folds each field to the entity scale and returns the same object', () => {
    const acct = { id: 'A', balance: 100, name: 'x' };
    expect(foldEntity('accounts', 'A', acct, index)).toBe(acct);
    expect(acct).toEqual({ id: 'A', balance: 49.25, name: 'x' });
    expect(foldEntity('assets', 'L', { loan: { outstandingBalance: 100 } }, index)).toEqual({
      loan: { outstandingBalance: 50 },
    });
  });

  it('an 8-decimal currency keeps all eight', () => {
    expect(
      foldEntity('accounts', 'BTC', { id: 'BTC', balance: 0.5, currency: 'BTC' }, index)
    ).toEqual({ id: 'BTC', balance: 0.50004, currency: 'BTC' });
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
      'accounts/A/balance@2/d:w1': -5075,
      'assets/L/loan.outstandingBalance@2/d:w1': -5000,
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

  it.each([
    ['a 2-decimal currency', 'USD', [0.01, 49.25, -1234.56, 999_999.99]],
    ['a 6-decimal currency', 'XRP', [0.000001, 12.345678, -7.5]],
    ['an 8-decimal currency', 'BTC', [0.00000001, 0.12345678, 21.00004]],
    ['a large 0-decimal balance (IDR, unlisted: two decimals)', 'IDR', [1_250_000_000]],
  ] as const)('fold(unfold(next)) === next for %s', (_name, currency, values) => {
    const ix = foldIndex(
      withMap({
        'accounts/X/balance@2/d:w1': -2025,
        'accounts/X/balance@8/d:w2': 4000,
      })
    );
    for (const next of values) {
      const stored = { id: 'X', balance: 0, currency };
      const raw = unfoldPatch('accounts', 'X', { balance: next }, undefined, ix, stored).patch;
      expect(foldEntity('accounts', 'X', { ...stored, ...raw }, ix).balance).toBe(next);
    }
  });

  it("a patch that changes the currency unfolds at the NEW currency's scale", () => {
    const ix = foldIndex(withMap({ 'accounts/X/balance@8/d:w1': 4000 })); // +0.00004
    const raw = unfoldPatch('accounts', 'X', { balance: 1.5, currency: 'BTC' }, undefined, ix, {
      currency: 'USD',
    }).patch;
    expect(raw.balance).toBe(1.49996);
    expect(foldEntity('accounts', 'X', { ...raw }, ix).balance).toBe(1.5);
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

  it('an absolute past the integer headroom unfolds by a float subtract, never a throw', () => {
    // 2e14 × 10^2 is not a safe integer; today's patch wrote it without complaint.
    const huge = 2e14;
    expect(() => toMinor(huge, 2)).toThrow();
    const { patch, base } = unfoldPatch(
      'accounts',
      'A',
      { balance: huge },
      { balance: huge },
      index
    );
    expect(patch.balance).toBe(huge + 50.75);
    expect(base.balance).toBe(patch.balance);
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

  it("writes on: creates the writer's key at the entity scale, increments, leaves the absolute", () => {
    __setCounterWritesForTesting(true);
    let doc = docWith((d) => adjustField(d, 'accounts', 'A', 'balance', -20.25, W1));
    doc = Automerge.change(doc, (d) => adjustField(d, 'accounts', 'A', 'balance', -0.5, W1));
    doc = Automerge.change(doc, (d) =>
      adjustField(d, 'assets', 'L', 'loan.outstandingBalance', -10, W1)
    );
    doc = Automerge.change(doc, (d) => adjustField(d, 'accounts', 'BTC', 'balance', 0.00004, W1));
    expect((doc.accounts.A as Account).balance).toBe(100);
    expect(read(doc).counterDeltas).toEqual({
      'accounts/A/balance@2/dev:w1': -2075,
      'assets/L/loan.outstandingBalance@2/dev:w1': -1000,
      'accounts/BTC/balance@8/dev:w1': 4000,
    });
    expect(doc.counterDeltas['accounts/A/balance@2/dev:w1']).toBeInstanceOf(Automerge.Counter);
  });

  it('writes on: throws when the map is missing (migrateDoc did not run)', () => {
    __setCounterWritesForTesting(true);
    const unmigrated = Automerge.change(Automerge.init<FamilyDocument>(), (d) => {
      (d as unknown as AnyRec).accounts = { A: { id: 'A', balance: 1 } };
    });
    expect(() =>
      Automerge.change(unmigrated, (d) => adjustField(d, 'accounts', 'A', 'balance', 1, W1))
    ).toThrow(/Run migrateDoc/);
  });

  it('writes off: rounded to the entity scale on the absolute, never touching the map', () => {
    __setCounterWritesForTesting(false);
    const doc = docWith((d) => {
      adjustField(d, 'accounts', 'A', 'balance', -20.25, W1);
      adjustField(d, 'goals', 'G', 'currentAmount', 0.1, W1);
    });
    expect((doc.accounts.A as Account).balance).toBe(79.75);
    expect((doc.goals.G as Goal).currentAmount).toBe(100.1);
    expect(Object.keys(doc.counterDeltas)).toEqual([]);
  });

  it('writes off: a 0.00004 BTC delta moves an 8-decimal balance, and keeps all eight', () => {
    __setCounterWritesForTesting(false);
    let doc = docWith((d) => adjustField(d, 'accounts', 'BTC', 'balance', 0.00004, W1));
    expect((doc.accounts.BTC as Account).balance).toBe(0.50004);
    doc = Automerge.change(doc, (d) =>
      adjustField(d, 'accounts', 'BTC', 'balance', -0.12345678, W1)
    );
    expect((doc.accounts.BTC as Account).balance).toBe(0.37658322);
  });

  it('writes off: an absolute past the integer headroom takes a float add, never a throw', () => {
    __setCounterWritesForTesting(false);
    const huge = 2e14; // ×10^2 is not a safe integer; today's `cur + delta` accepted it
    const doc = Automerge.change(
      docWith((d) => {
        (d.accounts as unknown as Record<string, Account>).A!.balance = huge;
      }),
      (d) => adjustField(d, 'accounts', 'A', 'balance', -20.25, W1)
    );
    expect((doc.accounts.A as Account).balance).toBe(huge - 20.25);
    // Only the DELTA is held to the headroom.
    expect(() =>
      Automerge.change(doc, (d) => adjustField(d, 'accounts', 'A', 'balance', huge, W1))
    ).toThrow(/Fix the caller/);
  });

  it("writes off: the field's floor holds on the WRITTEN value, as today's goal write did", () => {
    __setCounterWritesForTesting(false);
    // A stored negative goal amount from pre-Phase-2 history. Today: `max(0, -30 + 10)` = 0.
    const doc = Automerge.change(
      docWith((d) => {
        (d.goals as unknown as Record<string, Goal>).G!.currentAmount = -30;
        (d.accounts as unknown as Record<string, Account>).A!.balance = -30;
      }),
      (d) => {
        adjustField(d, 'goals', 'G', 'currentAmount', 10, W1);
        adjustField(d, 'accounts', 'A', 'balance', 10, W1); // no floor: may stay negative
      }
    );
    expect((doc.goals.G as Goal).currentAmount).toBe(0);
    expect((doc.accounts.A as Account).balance).toBe(-20);
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
      (d) => adjustField(d, 'assets', 'L', 'loan.outstandingBalance', delta, W1)
    );
    expect((doc.assets.L as Asset).loan!.outstandingBalance).toBe(res.newBalance);
    expect(Object.keys(doc.counterDeltas)).toEqual([]);
  });

  it('both modes fold to the same value', () => {
    const run = (on: boolean, id: string, delta: number) => {
      __setCounterWritesForTesting(on);
      const doc = docWith((d) => adjustField(d, 'accounts', id, 'balance', delta, W1));
      const acct = JSON.parse(JSON.stringify(doc.accounts[id])) as AnyRec;
      return foldEntity('accounts', id, acct, foldIndex(doc)).balance;
    };
    expect(run(true, 'A', -20.25)).toBe(79.75);
    expect(run(false, 'A', -20.25)).toBe(79.75);
    expect(run(true, 'BTC', 0.00004)).toBe(0.50004);
    expect(run(false, 'BTC', 0.00004)).toBe(0.50004);
  });

  it('records a Counter write in the index it is handed, as a rebuild would', () => {
    __setCounterWritesForTesting(true);
    let recorded: number | null = null;
    const doc = docWith((d) => {
      const index = foldIndex(d);
      adjustField(d, 'accounts', 'BTC', 'balance', 0.00004, W1, index);
      recorded = sigma(index, 'accounts', 'BTC', 'balance');
    });
    expect(recorded).toBe(0.00004);
    expect(sigma(foldIndex(doc), 'accounts', 'BTC', 'balance')).toBe(0.00004);
  });

  it('a zero adjustment (at the entity scale) writes nothing, in either mode', () => {
    for (const on of [true, false]) {
      __setCounterWritesForTesting(on);
      const origin = docWith();
      const after = Automerge.change(origin, (d) =>
        adjustField(d, 'accounts', 'A', 'balance', 0.001, W1)
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
      expect(tryAdjust((d) => adjustField(d, 'accounts', 'X', 'balance', 1, W1))).toThrow(
        /entity is missing/
      );
      expect(
        tryAdjust((d) => adjustField(d, 'assets', 'NOLOAN', 'loan.outstandingBalance', 1, W1))
      ).toThrow(/has no "loan"/);
      expect(tryAdjust((d) => adjustField(d, 'accounts', 'A', 'creditLimit', 1, W1))).toThrow(
        /COUNTER_FIELDS/
      );
      expect(tryAdjust((d) => adjustField(d, 'accounts', 'A', 'balance', Number.NaN, W1))).toThrow(
        /Fix the caller/
      );
    }
  });

  it('the switch ships off', () => {
    expect(COUNTER_WRITES_ENABLED).toBe(false);
  });
});

describe('foldDoc (the compaction source)', () => {
  it('folds every field, empties the map and ledgers every parsed key with its scale', () => {
    __setCounterWritesForTesting(true);
    const doc = docWith((d) => {
      adjustField(d, 'accounts', 'A', 'balance', -20.25, W1);
      adjustField(d, 'accounts', 'BTC', 'balance', 0.00004, W1);
      adjustField(d, 'goals', 'G', 'currentAmount', 30.5, W1);
      adjustField(d, 'assets', 'L', 'loan.outstandingBalance', -10, W1);
    });
    const source = foldDoc(doc);
    expect((source.accounts.A as Account).balance).toBe(79.75);
    expect((source.accounts.BTC as Account).balance).toBe(0.50004);
    expect((source.goals.G as Goal).currentAmount).toBe(130.5);
    expect((source.assets.L as Asset).loan!.outstandingBalance).toBe(90);
    expect(source.counterDeltas).toEqual({});
    expect(source.foldedCounters).toEqual({
      'accounts/A/balance@2/dev:w1': -2025,
      'accounts/BTC/balance@8/dev:w1': 4000,
      'goals/G/currentAmount@2/dev:w1': 3050,
      'assets/L/loan.outstandingBalance@2/dev:w1': -1000,
    });
    // No Counter instance anywhere: the source is pure JSON.
    expect(JSON.parse(JSON.stringify(source))).toEqual(source);
  });

  it('the ledger is CUMULATIVE across compactions, never replaced', () => {
    __setCounterWritesForTesting(true);
    const first = Automerge.from(
      foldDoc(
        docWith((d) => adjustField(d, 'accounts', 'A', 'balance', -1, W1))
      ) as unknown as AnyRec
    ) as unknown as Doc;
    const second = Automerge.change(first, (d) =>
      adjustField(d, 'accounts', 'A', 'balance', -2, 'dev:w2')
    );
    const source = foldDoc(second);
    expect((source.accounts.A as Account).balance).toBe(97);
    expect(source.foldedCounters).toEqual({
      'accounts/A/balance@2/dev:w1': -100,
      'accounts/A/balance@2/dev:w2': -200,
    });
  });

  it('ledgers a key whose entity or loan is gone (consumed, so a rebase cannot replay it)', () => {
    __setCounterWritesForTesting(true);
    const doc = Automerge.change(
      docWith((d) => adjustField(d, 'assets', 'L', 'loan.outstandingBalance', -10, W1)),
      (d) => {
        delete (d.assets as unknown as Record<string, Asset>).L!.loan;
      }
    );
    const source = foldDoc(doc);
    expect(source.assets.L).toEqual({ id: 'L' });
    expect(source.foldedCounters).toEqual({ 'assets/L/loan.outstandingBalance@2/dev:w1': -1000 });
  });

  it("REFUSES a newer build's field (known collection, unknown field), naming collection and field only", () => {
    // Compaction empties the map, so folding past a newer build's key would destroy its
    // adjustment for good. The message reaches the firehose: never the id or the writer.
    const doc = docWith((d) => {
      (d.counterDeltas as unknown as AnyRec)['accounts/SECRET-ID/creditLimit@2/dev:actor'] =
        new Automerge.Counter(5);
    });
    let thrown: unknown;
    try {
      foldDoc(doc);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(StaleBuildCounterError);
    const err = thrown as StaleBuildCounterError;
    expect([err.collection, err.field]).toEqual(['accounts', 'creditLimit']);
    expect(err.message).toMatch(/accounts\.creditLimit.*Update the app/);
    expect(err.message).not.toMatch(/SECRET-ID|dev:actor/);
    // The fold on READ still never throws (rule 4): only the compaction refuses.
    expect(foldIndex(doc).malformed).toBe(1);
  });

  it('DROPS a key no build can read (unparseable, unknown collection, non-integer), with ONE warning', () => {
    __setCounterWritesForTesting(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const doc = docWith((d) => {
        adjustField(d, 'accounts', 'A', 'balance', -20.25, W1);
        const map = d.counterDeltas as unknown as AnyRec;
        map['garbage'] = new Automerge.Counter(3);
        map['todos/T/balance@2/dev:x'] = new Automerge.Counter(3);
        map['accounts/SECRET-ID/balance@2/dev:y'] = 1.5; // not a safe integer
      });
      const source = foldDoc(doc);
      expect((source.accounts.A as Account).balance).toBe(79.75);
      expect(source.counterDeltas).toEqual({});
      expect(source.foldedCounters).toEqual({ 'accounts/A/balance@2/dev:w1': -2025 });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toMatch(/drops 3 Counter key/);
      expect(String(warn.mock.calls[0]![0])).not.toMatch(/SECRET-ID|dev:y/);
    } finally {
      warn.mockRestore();
    }
  });

  it('a dormant pod: absolutes untouched, empty map, no ledger key', () => {
    const doc = docWith();
    const source = foldDoc(doc);
    expect(source).toEqual({ ...JSON.parse(JSON.stringify(doc)), counterDeltas: {} });
    expect('foldedCounters' in source).toBe(false);
  });
});

describe('counterGrowthOps (the rebase ledger pass)', () => {
  /** A copy of `from` whose map holds `keys` as Counters (minor units), as one change. Cloned,
   *  so `from` stays usable (a changed handle is outdated). */
  const withCounters = (from: Doc, keys: Record<string, number>): Doc =>
    Automerge.change(Automerge.clone(from), (d) => {
      for (const [k, v] of Object.entries(keys)) {
        const map = d.counterDeltas as unknown as Record<string, Automerge.Counter>;
        if (map[k] === undefined) map[k] = new Automerge.Counter(v);
        else map[k]!.increment(v - map[k]!.value);
      }
    });

  const baseline = docWith();
  const local = withCounters(baseline, {
    'accounts/A/balance@2/dev:w1': -3000, // target holds it live at -1000 → growth -20
    'accounts/A/balance@2/dev:w2': -500, // target ledgered it at -500 → no growth
    'goals/G/currentAmount@2/dev:w1': 700, // target has neither → all of it
    'assets/L/loan.outstandingBalance@2/dev:w1': -100, // ledgered at -40 → growth -0.6
    'accounts/A/balance@2/peer:w9': -9000, // FOREIGN: never replayed, whatever the target says
  });
  const target = {
    counterDeltas: { 'accounts/A/balance@2/dev:w1': new Automerge.Counter(-1000) },
    foldedCounters: {
      'accounts/A/balance@2/dev:w2': -500,
      'assets/L/loan.outstandingBalance@2/dev:w1': -40,
    },
  };

  it('emits own local minus (live key ?? ledger ?? 0) per entity field, as skip-on-missing increments', () => {
    const { ops, count } = counterGrowthOps(local, target, 'dev');
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

  it('ownership is the device PREFIX of the writer, not a substring or another device', () => {
    // `dev` must not claim `devX:…`, and the peer's own pass claims only its key.
    const keys = withCounters(baseline, {
      'accounts/A/balance@2/devX:w1': -100,
      'accounts/A/balance@2/peer:w9': -200,
    });
    expect(counterGrowthOps(keys, {}, 'dev').ops).toEqual([]);
    expect(counterGrowthOps(keys, {}, 'peer').ops).toEqual([
      expect.objectContaining({ id: 'A', delta: -2 }),
    ]);
  });

  it('skips malformed keys', () => {
    const withGarbage = withCounters(baseline, {
      garbage: 1,
      'accounts/A/balance@2/dev:w1': -100,
    });
    expect(counterGrowthOps(withGarbage, {}, 'dev').ops).toEqual([
      expect.objectContaining({ id: 'A', delta: -1 }),
    ]);
  });

  it('groups several own writers (two tabs of one device) of one field into one op', () => {
    const { ops } = counterGrowthOps(
      withCounters(baseline, {
        'accounts/A/balance@2/dev:tab1': -100,
        'accounts/A/balance@2/dev:tab2': -200,
      }),
      {},
      'dev'
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

  it('sums keys at different scales exactly per scale (a currency changed between writes)', () => {
    const { ops } = counterGrowthOps(
      withCounters(baseline, {
        'accounts/A/balance@2/dev:w1': -2025,
        'accounts/A/balance@8/dev:w2': 4000,
      }),
      {},
      'dev'
    );
    expect(ops).toEqual([expect.objectContaining({ id: 'A', delta: -20.25 + 0.00004 })]);
  });

  it('no key, or nothing grown, is no ops', () => {
    expect(counterGrowthOps(baseline, target, 'dev')).toEqual({ ops: [], count: 0 });
    const level = withCounters(baseline, { 'accounts/A/balance@2/dev:w2': -500 });
    expect(counterGrowthOps(level, target, 'dev').ops).toEqual([]);
  });

  it('works on live documents (Counter values on both sides)', () => {
    __setCounterWritesForTesting(true);
    const origin = docWith((d) => adjustField(d, 'accounts', 'A', 'balance', -1, W1));
    const ahead = Automerge.change(Automerge.clone(origin), (d) =>
      adjustField(d, 'accounts', 'A', 'balance', -2.5, W1)
    );
    expect(counterGrowthOps(ahead, origin, 'dev').ops).toEqual([
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
  it("counts keys, conflicts, the fold's malformed keys and the ledger", () => {
    __setCounterWritesForTesting(true);
    const origin = docWith((d) => {
      adjustField(d, 'accounts', 'A', 'balance', -1, W1);
      (d.counterDeltas as unknown as AnyRec)['garbage'] = new Automerge.Counter(1);
      (d as unknown as AnyRec).foldedCounters = { 'accounts/A/balance@2/dev:old': -5 };
    });
    expect(counterStats(origin)).toEqual({ keys: 2, conflicts: 0, malformed: 1, ledgerKeys: 1 });
    // Two actors creating the SAME key: the bug the key design exists to prevent.
    const a = Automerge.change(Automerge.clone(origin), (d) => {
      d.counterDeltas['accounts/A/balance@2/dev:shared'] = new Automerge.Counter(1);
    });
    const b = Automerge.change(Automerge.clone(origin), (d) => {
      d.counterDeltas['accounts/A/balance@2/dev:shared'] = new Automerge.Counter(2);
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
