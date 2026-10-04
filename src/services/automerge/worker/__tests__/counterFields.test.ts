// @vitest-environment node
/**
 * The Counter-field module (#117 Phase 2, plan `docs/plans/2026-10-03-crdt-counters-117-phase-2.md`
 * §A; writer flip, plan `docs/plans/2026-10-04-crdt-counters-117-writer-flip.md` §A-D). Pure
 * table, per-currency scale, fold/unfold, the one write primitive in both switch positions,
 * carry-register keys, the bounded compaction ledger, rebase knowledge and the carry pass. The Automerge behaviours these rest
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
  COUNTER_WRITES_DEFAULT,
  LEDGER_WINDOW,
  MAX_COUNTER_DECIMALS,
  MIN_COUNTER_DECIMALS,
  adjustField,
  baselineKnowledge,
  carryKeyFor,
  counterGrowthOps,
  counterKey,
  counterStats,
  counterWritesOn,
  decimalsFor,
  fieldDecimals,
  foldDoc,
  foldEntity,
  foldIndex,
  foldValue,
  fromMinor,
  isCounterCollection,
  ledgerSeq,
  ledgerValue,
  parseCounterKey,
  resolveField,
  setCounterWrites,
  sigma,
  targetKnowledge,
  toMinor,
  unfoldPatch,
  type CounterCollection,
  type Knowledge,
  type GrowthKnowledge,
} from '../counterFields';
import { migrateDoc } from '../docOps';

type Doc = Automerge.Doc<FamilyDocument>;
type AnyRec = Record<string, unknown>;

/** This test's writer segment: an actor id (the actor is the whole writer, #117 writer flip). */
const W1 = 'w1';

afterEach(() => setCounterWrites(null));

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
  it('round-trips every table field, the scale and an actor writer', () => {
    for (const [collection, fields] of Object.entries(COUNTER_FIELDS)) {
      for (const f of fields) {
        const field = f.abs.join('.');
        const key = counterKey(collection, 'id-1', field, 6, 'abc123');
        expect(key).toBe(`${collection}/id-1/${field}@6/abc123`);
        expect(parseCounterKey(key)).toEqual({
          collection,
          id: 'id-1',
          field,
          decimals: 6,
          writer: 'abc123',
          carry: null,
          canonical: key,
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
      carry: null,
      canonical: 'accounts/a/b@c/balance@2/d:w',
    });
  });

  it('parses a carry register: carry.of, carry.seq and the canonical key it stands for', () => {
    expect(parseCounterKey('accounts/a/b/balance@2/carry.abc123.7')).toEqual({
      collection: 'accounts',
      id: 'a/b',
      field: 'balance',
      decimals: 2,
      writer: 'carry.abc123.7',
      carry: { of: 'abc123', seq: 7 },
      canonical: 'accounts/a/b/balance@2/abc123',
    });
    // `of` is everything up to the LAST dot; a segment with no trailing digits is no carry.
    expect(parseCounterKey('goals/G/currentAmount@2/carry.x.y.12')?.carry).toEqual({
      of: 'x.y',
      seq: 12,
    });
    expect(parseCounterKey('goals/G/currentAmount@2/carry.x')?.carry).toBeNull();
    expect(parseCounterKey('goals/G/currentAmount@2/carry.x.')?.carry).toBeNull();
  });

  it('carryKeyFor round-trips through parseCounterKey and is stamped with the generation', () => {
    const canonical = counterKey('assets', 'L', 'loan.outstandingBalance', 8, 'abc123');
    const name = carryKeyFor(canonical, 4);
    expect(name).toBe('assets/L/loan.outstandingBalance@8/carry.abc123.4');
    expect(parseCounterKey(name)).toMatchObject({
      collection: 'assets',
      id: 'L',
      field: 'loan.outstandingBalance',
      decimals: 8,
      carry: { of: 'abc123', seq: 4 },
      canonical,
    });
    // Two generations, two names: the name-keyed ledger can never overwrite one with another.
    expect(carryKeyFor(canonical, 5)).not.toBe(name);
    // A carried carry is re-stamped from its canonical key, never nested.
    expect(carryKeyFor(parseCounterKey(name)!.canonical, 5)).toBe(
      'assets/L/loan.outstandingBalance@8/carry.abc123.5'
    );
    expect(carryKeyFor(canonical, 0)).toMatch(/carry\.abc123\.0$/);
  });

  it('carryKeyFor refuses a register, an unparseable key and a bad generation', () => {
    expect(() => carryKeyFor('accounts/A/balance@2/carry.x.1', 2)).toThrow(/canonical/);
    expect(() => carryKeyFor('garbage', 2)).toThrow(/canonical/);
    expect(() => carryKeyFor('accounts/A/balance@2/x', -1)).toThrow(/non-negative/);
    expect(() => carryKeyFor('accounts/A/balance@2/x', 1.5)).toThrow(/non-negative/);
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
    // The carry-register namespace is closed to increments (rule 5).
    expect(() => counterKey('accounts', 'A', 'balance', 2, 'carry.x.1')).toThrow(/carry-register/);
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
    setCounterWrites(true);
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
    setCounterWrites(true);
    let doc = docWith((d) => adjustField(d, 'accounts', 'A', 'balance', -20.25, W1));
    doc = Automerge.change(doc, (d) => adjustField(d, 'accounts', 'A', 'balance', -0.5, W1));
    doc = Automerge.change(doc, (d) =>
      adjustField(d, 'assets', 'L', 'loan.outstandingBalance', -10, W1)
    );
    doc = Automerge.change(doc, (d) => adjustField(d, 'accounts', 'BTC', 'balance', 0.00004, W1));
    expect((doc.accounts.A as Account).balance).toBe(100);
    expect(read(doc).counterDeltas).toEqual({
      'accounts/A/balance@2/w1': -2075,
      'assets/L/loan.outstandingBalance@2/w1': -1000,
      'accounts/BTC/balance@8/w1': 4000,
    });
    expect(doc.counterDeltas['accounts/A/balance@2/w1']).toBeInstanceOf(Automerge.Counter);
  });

  it('writes on: throws when the map is missing (migrateDoc did not run)', () => {
    setCounterWrites(true);
    const unmigrated = Automerge.change(Automerge.init<FamilyDocument>(), (d) => {
      (d as unknown as AnyRec).accounts = { A: { id: 'A', balance: 1 } };
    });
    expect(() =>
      Automerge.change(unmigrated, (d) => adjustField(d, 'accounts', 'A', 'balance', 1, W1))
    ).toThrow(/Run migrateDoc/);
  });

  it('writes off: rounded to the entity scale on the absolute, never touching the map', () => {
    setCounterWrites(false);
    const doc = docWith((d) => {
      adjustField(d, 'accounts', 'A', 'balance', -20.25, W1);
      adjustField(d, 'goals', 'G', 'currentAmount', 0.1, W1);
    });
    expect((doc.accounts.A as Account).balance).toBe(79.75);
    expect((doc.goals.G as Goal).currentAmount).toBe(100.1);
    expect(Object.keys(doc.counterDeltas)).toEqual([]);
  });

  it('writes off: a 0.00004 BTC delta moves an 8-decimal balance, and keeps all eight', () => {
    setCounterWrites(false);
    let doc = docWith((d) => adjustField(d, 'accounts', 'BTC', 'balance', 0.00004, W1));
    expect((doc.accounts.BTC as Account).balance).toBe(0.50004);
    doc = Automerge.change(doc, (d) =>
      adjustField(d, 'accounts', 'BTC', 'balance', -0.12345678, W1)
    );
    expect((doc.accounts.BTC as Account).balance).toBe(0.37658322);
  });

  it('writes off: an absolute past the integer headroom takes a float add, never a throw', () => {
    setCounterWrites(false);
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
    setCounterWrites(false);
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
    setCounterWrites(false);
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
      setCounterWrites(on);
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
    setCounterWrites(true);
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
      setCounterWrites(on);
      const origin = docWith();
      const after = Automerge.change(origin, (d) =>
        adjustField(d, 'accounts', 'A', 'balance', 0.001, W1)
      );
      expect(Automerge.getHeads(after)).toEqual(Automerge.getHeads(origin));
    }
  });

  it('throws for a missing entity, a missing loan, an unknown field and a NaN delta', () => {
    for (const on of [true, false]) {
      setCounterWrites(on);
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

  it('the switch ships off, and setCounterWrites(null) restores the default', () => {
    expect(COUNTER_WRITES_DEFAULT).toBe(false);
    expect(counterWritesOn()).toBe(false);
    setCounterWrites(true);
    expect(counterWritesOn()).toBe(true);
    setCounterWrites(false);
    expect(counterWritesOn()).toBe(false);
    setCounterWrites(true);
    setCounterWrites(null);
    expect(counterWritesOn()).toBe(COUNTER_WRITES_DEFAULT);
  });
});

describe('foldDoc (the compaction source)', () => {
  it('folds every field, empties the map and ledgers every parsed key as { v, s: newSeq }', () => {
    setCounterWrites(true);
    const doc = docWith((d) => {
      adjustField(d, 'accounts', 'A', 'balance', -20.25, W1);
      adjustField(d, 'accounts', 'BTC', 'balance', 0.00004, W1);
      adjustField(d, 'goals', 'G', 'currentAmount', 30.5, W1);
      adjustField(d, 'assets', 'L', 'loan.outstandingBalance', -10, W1);
    });
    const source = foldDoc(doc, 3);
    expect((source.accounts.A as Account).balance).toBe(79.75);
    expect((source.accounts.BTC as Account).balance).toBe(0.50004);
    expect((source.goals.G as Goal).currentAmount).toBe(130.5);
    expect((source.assets.L as Asset).loan!.outstandingBalance).toBe(90);
    expect(source.counterDeltas).toEqual({});
    expect(source.foldedCounters).toEqual({
      'accounts/A/balance@2/w1': { v: -2025, s: 3 },
      'accounts/BTC/balance@8/w1': { v: 4000, s: 3 },
      'goals/G/currentAmount@2/w1': { v: 3050, s: 3 },
      'assets/L/loan.outstandingBalance@2/w1': { v: -1000, s: 3 },
    });
    expect(source.ledger).toEqual({ pruned: 0, normalised: 0, collisions: 0 });
    // No Counter instance anywhere: the source is pure JSON.
    expect(JSON.parse(JSON.stringify(source))).toEqual(source);
  });

  it('the ledger figures are never a document key (non-enumerable: spread and from drop them)', () => {
    setCounterWrites(true);
    const source = foldDoc(
      docWith((d) => adjustField(d, 'accounts', 'A', 'balance', -1, W1)),
      1
    );
    expect(source.ledger.pruned).toBe(0);
    expect(Object.keys(source)).not.toContain('ledger');
    expect('ledger' in { ...source }).toBe(false);
    const doc = Automerge.from(source as unknown as AnyRec);
    expect(Object.keys(doc)).not.toContain('ledger');
  });

  it('carries prior entries across compactions, each keeping the generation it was folded at', () => {
    setCounterWrites(true);
    const first = Automerge.from(
      foldDoc(
        docWith((d) => adjustField(d, 'accounts', 'A', 'balance', -1, W1)),
        1
      ) as unknown as AnyRec
    ) as unknown as Doc;
    const second = Automerge.change(first, (d) =>
      adjustField(d, 'accounts', 'A', 'balance', -2, 'w2')
    );
    const source = foldDoc(second, 2);
    expect((source.accounts.A as Account).balance).toBe(97);
    expect(source.foldedCounters).toEqual({
      'accounts/A/balance@2/w1': { v: -100, s: 1 },
      'accounts/A/balance@2/w2': { v: -200, s: 2 },
    });
  });

  it('normalises a bare-number (0.91.2) entry as { v, s: newSeq }, and counts it', () => {
    const doc = docWith((d) => {
      (d as unknown as AnyRec).foldedCounters = { 'accounts/A/balance@2/old': -500 };
    });
    const source = foldDoc(doc, 7);
    expect(source.foldedCounters).toEqual({ 'accounts/A/balance@2/old': { v: -500, s: 7 } });
    expect(source.ledger).toEqual({ pruned: 0, normalised: 1, collisions: 0 });
  });

  it('prunes entries folded more than LEDGER_WINDOW generations ago and keeps the boundary', () => {
    const newSeq = 20;
    const edge = newSeq - LEDGER_WINDOW; // s === edge is kept; s < edge is pruned
    const doc = docWith((d) => {
      (d as unknown as AnyRec).foldedCounters = {
        'accounts/A/balance@2/gone': { v: 1, s: edge - 1 },
        'accounts/A/balance@2/edge': { v: 2, s: edge },
        'accounts/A/balance@2/young': { v: 3, s: newSeq - 1 },
      };
    });
    const source = foldDoc(doc, newSeq);
    expect(source.foldedCounters).toEqual({
      'accounts/A/balance@2/edge': { v: 2, s: edge },
      'accounts/A/balance@2/young': { v: 3, s: newSeq - 1 },
    });
    expect(source.ledger).toEqual({ pruned: 1, normalised: 0, collisions: 0 });
    // Pruning everything still writes the (now empty) ledger: it held something before.
    const all = foldDoc(doc, newSeq + LEDGER_WINDOW + 1);
    expect(all.foldedCounters).toEqual({});
    expect(all.ledger.pruned).toBe(3);
  });

  it('folds a carry register into the absolute and ledgers it under its own full name', () => {
    const doc = docWith((d) => {
      (d.counterDeltas as unknown as AnyRec)['accounts/A/balance@2/carry.x.4'] = 250;
    });
    const source = foldDoc(doc, 5);
    expect((source.accounts.A as Account).balance).toBe(102.5);
    expect(source.foldedCounters).toEqual({
      'accounts/A/balance@2/carry.x.4': { v: 250, s: 5 },
    });
  });

  it('counts and warns a name collision (the newer value wins), naming collection and field only', () => {
    setCounterWrites(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const doc = docWith((d) => {
        (d as unknown as AnyRec).foldedCounters = { 'accounts/A/balance@2/w1': { v: -1, s: 2 } };
        adjustField(d, 'accounts', 'A', 'balance', -5, W1);
      });
      const source = foldDoc(doc, 3);
      expect(source.foldedCounters).toEqual({ 'accounts/A/balance@2/w1': { v: -500, s: 3 } });
      expect(source.ledger).toEqual({ pruned: 0, normalised: 0, collisions: 1 });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toMatch(/accounts\.balance.*newer value wins/);
      expect(String(warn.mock.calls[0]![0])).not.toMatch(/w1|\/A\//);
    } finally {
      warn.mockRestore();
    }
  });

  it('drops a prior ledger entry of neither shape, with one warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const doc = docWith((d) => {
        (d as unknown as AnyRec).foldedCounters = {
          'accounts/A/balance@2/bad': 'x',
          'accounts/A/balance@2/ok': { v: 4, s: 1 },
        };
      });
      expect(foldDoc(doc, 2).foldedCounters).toEqual({
        'accounts/A/balance@2/ok': { v: 4, s: 1 },
      });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toMatch(/drops 1 fold-ledger entry/);
    } finally {
      warn.mockRestore();
    }
  });

  it('ledgers a key whose entity or loan is gone (consumed, so a rebase cannot replay it)', () => {
    setCounterWrites(true);
    const doc = Automerge.change(
      docWith((d) => adjustField(d, 'assets', 'L', 'loan.outstandingBalance', -10, W1)),
      (d) => {
        delete (d.assets as unknown as Record<string, Asset>).L!.loan;
      }
    );
    const source = foldDoc(doc, 1);
    expect(source.assets.L).toEqual({ id: 'L' });
    expect(source.foldedCounters).toEqual({
      'assets/L/loan.outstandingBalance@2/w1': { v: -1000, s: 1 },
    });
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
      foldDoc(doc, 1);
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

  it('DROPS a key no build can read (unparseable, non-integer), with ONE warning', () => {
    // ⚠️ BEHAVIOUR CHANGED (C9e, data-layer audit 2026-10-03): an UNKNOWN COLLECTION used to be
    // dropped here too. A key that splits is a newer build's Counter whichever segment is
    // unknown, so it now refuses (pinned below); only a key that does not split, or a value no
    // build can read, is dropped.
    setCounterWrites(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const doc = docWith((d) => {
        adjustField(d, 'accounts', 'A', 'balance', -20.25, W1);
        const map = d.counterDeltas as unknown as AnyRec;
        map['garbage'] = new Automerge.Counter(3);
        map['accounts/SECRET-ID/balance@2/dev:y'] = 1.5; // not a safe integer
      });
      const source = foldDoc(doc, 1);
      expect((source.accounts.A as Account).balance).toBe(79.75);
      expect(source.counterDeltas).toEqual({});
      expect(source.foldedCounters).toEqual({ 'accounts/A/balance@2/w1': { v: -2025, s: 1 } });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toMatch(/drops 2 Counter key/);
      expect(String(warn.mock.calls[0]![0])).not.toMatch(/SECRET-ID|dev:y/);
    } finally {
      warn.mockRestore();
    }
  });

  it('REFUSES a structurally valid key for an UNKNOWN COLLECTION (C9e), naming no id', () => {
    setCounterWrites(true);
    const doc = docWith((d) => {
      const map = d.counterDeltas as unknown as AnyRec;
      map['todos/SECRET-ID/balance@2/dev:x'] = new Automerge.Counter(3);
    });
    expect(() => foldDoc(doc, 1)).toThrow(StaleBuildCounterError);
    expect(() => foldDoc(doc, 1)).toThrow(/todos\.balance/);
    expect(() => foldDoc(doc, 1)).not.toThrow(/SECRET-ID/);
  });

  it('a dormant pod: absolutes untouched, empty map, no ledger key', () => {
    const doc = docWith();
    const source = foldDoc(doc, 1);
    expect(source).toEqual({ ...JSON.parse(JSON.stringify(doc)), counterDeltas: {} });
    expect('foldedCounters' in source).toBe(false);
  });
});

describe('ledgerValue / ledgerSeq: the two readers of the entry union', () => {
  it('reads both shapes; a bare number has no generation', () => {
    expect(ledgerValue(-500)).toBe(-500);
    expect(ledgerSeq(-500)).toBeNull();
    expect(ledgerValue({ v: 7, s: 3 })).toBe(7);
    expect(ledgerSeq({ v: 7, s: 3 })).toBe(3);
  });

  it('anything else reads as null, never a throw', () => {
    for (const bad of [null, undefined, 'x', 1.5, {}, { v: 'x', s: 'y' }, { v: 1.5, s: 0.5 }]) {
      expect(ledgerValue(bad)).toBeNull();
      expect(ledgerSeq(bad)).toBeNull();
    }
  });
});

/** Canonical (actor) keys used by the knowledge and growth tests. */
const KX = 'accounts/A/balance@2/x';
const carryX = (seq: number) => carryKeyFor(KX, seq);

describe('targetKnowledge: the target holds what was folded after the peer generation', () => {
  // Peer on P = 3, target on T = 5.
  const P = 3;
  const T = 5;
  const target = {
    foldedCounters: {
      [KX]: { v: 800, s: 4 }, // same name as a peer name → included
      [carryX(4)]: { v: 100, s: 5 }, // a carry onto 4 ≥ P → included
      [carryX(3)]: { v: 10, s: 4 }, // a carry onto 3 ≥ P → included
      [carryX(2)]: { v: 1000, s: 3 }, // a carry onto 2 < P: the peer already discounts it
      'accounts/A/balance@2/y': 50, // another canonical key, a bare number
      garbage: 99,
    },
    counterDeltas: {
      [carryX(T)]: 7, // the current-generation register: the register rule owns it
    },
  };
  const k = targetKnowledge(target, P, T);

  it('sums same-name entries and later-generation carries of the canonical key only', () => {
    expect(k.of(KX, new Set([KX]))).toBe(800 + 100 + 10);
  });

  it('an earlier-generation carry is excluded, and the current-generation register too', () => {
    // With the actor key not live on the peer, only the carries onto ≥ P count.
    expect(k.of(KX, new Set())).toBe(100 + 10);
  });

  it('an entry matching both conditions is counted once (two local names, one canonical key)', () => {
    expect(k.of(KX, new Set([KX, carryX(4)]))).toBe(800 + 100 + 10);
  });

  it('reads a bare-number entry by value, keyed under its own canonical key', () => {
    expect(k.of('accounts/A/balance@2/y', new Set(['accounts/A/balance@2/y']))).toBe(50);
    expect(k.of('accounts/A/balance@2/y', new Set())).toBe(0);
  });

  it('includes a carried-through live copy (a pre-fold compaction kept the map)', () => {
    const carried = targetKnowledge(
      { counterDeltas: { [KX]: new Automerge.Counter(300), [carryX(3)]: 20 } },
      P,
      T
    );
    expect(carried.of(KX, new Set([KX]))).toBe(320);
  });

  it('a target with neither map knows nothing', () => {
    expect(targetKnowledge({}, P, T).of(KX, new Set([KX]))).toBe(0);
  });
});

describe('baselineKnowledge: the restore rule reads the peer own baseline by exact name', () => {
  it('sums the baseline value of each name, absent as 0', () => {
    const k = baselineKnowledge({
      counterDeltas: { [KX]: new Automerge.Counter(1000), [carryX(2)]: 40 },
    });
    expect(k.of(KX, new Set([KX]))).toBe(1000);
    expect(k.of(KX, new Set([KX, carryX(2)]))).toBe(1040);
    expect(k.of(KX, new Set(['accounts/A/balance@2/z']))).toBe(0);
    expect(baselineKnowledge({}).of(KX, new Set([KX]))).toBe(0);
  });
});

describe('counterGrowthOps (the rebase carry pass)', () => {
  const baseline = docWith();
  const T = 5;

  /** A fresh copy of the baseline (its own actor `own`) holding `counters` as Counters and
   *  `registers` as plain integers; both may name keys with the copy's own actor. */
  function peer(
    keys: (own: string) => { counters?: Record<string, number>; registers?: Record<string, number> }
  ): { doc: Doc; own: string } {
    const fresh = Automerge.clone(baseline);
    const own = Automerge.getActorId(fresh);
    const { counters = {}, registers = {} } = keys(own);
    const doc = Automerge.change(fresh, (d) => {
      const map = d.counterDeltas as unknown as AnyRec;
      for (const [key, v] of Object.entries(counters)) map[key] = new Automerge.Counter(v);
      for (const [key, v] of Object.entries(registers)) map[key] = v;
    });
    return { doc, own };
  }

  /** Knowledge from a fixed table: canonical → known. */
  const knows = (table: Record<string, number>): Knowledge => ({
    of: (canonical) => table[canonical] ?? 0,
  });
  /** The same knowledge for own and foreign keys (a fresh peer, or the restore rule). */
  const both = (k: Knowledge): GrowthKnowledge => ({ exact: k, foreign: k });

  it('groups two live names of one canonical key into ONE op over their sum', () => {
    const { doc, own } = peer((o) => ({
      counters: { [`accounts/A/balance@2/${o}`]: 1200 },
      registers: { [`accounts/A/balance@2/carry.${o}.3`]: 200 },
    }));
    const K = `accounts/A/balance@2/${own}`;
    const seen: Array<[string, string[]]> = [];
    const knowledge: Knowledge = {
      of(canonical, names) {
        seen.push([canonical, [...names].sort()]);
        return 900;
      },
    };
    const ops = counterGrowthOps(doc, both(knowledge), T);
    expect(ops).toEqual([
      {
        op: 'carry',
        collection: 'accounts',
        id: 'A',
        name: carryKeyFor(K, T),
        minor: 1200 + 200 - 900,
        exact: true,
      },
    ]);
    // The knowledge was asked ONCE for the canonical key, with the whole name set.
    expect(seen).toEqual([[K, [`accounts/A/balance@2/carry.${own}.3`, K].sort()]]);
  });

  it('an exact group reads `knowledge.exact`, a foreign group `knowledge.foreign`; nothing is sign-filtered', () => {
    const { doc, own } = peer((o) => ({
      counters: { [KX]: 500, [`goals/G/currentAmount@2/${o}`]: -50 },
    }));
    const K = `goals/G/currentAmount@2/${own}`;
    const ledger = knows({ [KX]: 800, [K]: 0 });
    const baselineView = knows({ [KX]: 500, [K]: 999 });
    // Fresh: both read the ledger, and a foreign negative (a real reversal) is carried.
    expect(counterGrowthOps(doc, both(ledger), T)).toEqual([
      { op: 'carry', collection: 'accounts', id: 'A', name: carryX(T), minor: -300, exact: false },
      {
        op: 'carry',
        collection: 'goals',
        id: 'G',
        name: carryKeyFor(K, T),
        minor: -50,
        exact: true,
      },
    ]);
    // Not fresh: the foreign key reads the baseline (a pure copy grows by 0), the own key the
    // ledger (its -50 is exact whatever the baseline says).
    expect(counterGrowthOps(doc, { exact: ledger, foreign: baselineView }, T)).toEqual([
      {
        op: 'carry',
        collection: 'goals',
        id: 'G',
        name: carryKeyFor(K, T),
        minor: -50,
        exact: true,
      },
    ]);
  });

  it('a stale-HIGH foreign copy (the writer spent since) carries +491 against the ledger, 0 against the baseline (chaos layer 6, seed 2)', () => {
    // B holds D's key at 1000 through Drive; D spends 491 and compacts (ledger 509). B is not
    // fresh: against the ledger its stale copy reads +491 and would undo the expense.
    const { doc } = peer(() => ({ counters: { [KX]: 1000 } }));
    const ledger = knows({ [KX]: 509 });
    expect(counterGrowthOps(doc, both(ledger), T)).toEqual([
      expect.objectContaining({ name: carryX(T), minor: 491, exact: false }),
    ]);
    const before = { counterDeltas: { [KX]: 1000 } };
    expect(counterGrowthOps(doc, { exact: ledger, foreign: baselineKnowledge(before) }, T)).toEqual(
      []
    );
  });

  it('a register of the own actor alone is not exact (only the live actor key makes it so)', () => {
    // A session that continues under a new actor is foreign to its own earlier keys: the
    // foreign knowledge decides its growth.
    const { doc } = peer(() => ({ registers: { [carryX(3)]: -40 } }));
    const ops = counterGrowthOps(doc, { exact: knows({ [KX]: -40 }), foreign: knows({}) }, T);
    expect(ops).toEqual([expect.objectContaining({ minor: -40, exact: false })]);
  });

  it('one op per canonical key: two actors, two scales and two entities are separate', () => {
    const { doc } = peer(() => ({
      counters: {
        [KX]: 100,
        'accounts/A/balance@2/y': 200,
        'accounts/A/balance@8/x': 4000,
        'assets/L/loan.outstandingBalance@2/x': -60,
      },
    }));
    const ops = counterGrowthOps(doc, both(knows({})), T);
    expect(ops.map((o) => [o.name, o.minor])).toEqual([
      [carryX(T), 100],
      ['accounts/A/balance@2/carry.y.5', 200],
      ['accounts/A/balance@8/carry.x.5', 4000],
      ['assets/L/loan.outstandingBalance@2/carry.x.5', -60],
    ]);
  });

  it('against a baseline knowledge: signed growth over the view, nothing for an unchanged key', () => {
    const { doc } = peer(() => ({ counters: { [KX]: 1300, 'accounts/A/balance@2/y': 70 } }));
    const before = { counterDeltas: { [KX]: 1000, 'accounts/A/balance@2/y': 70 } };
    expect(counterGrowthOps(doc, both(baselineKnowledge(before)), T)).toEqual([
      { op: 'carry', collection: 'accounts', id: 'A', name: carryX(T), minor: 300, exact: false },
    ]);
    const lower = { counterDeltas: { [KX]: 1500 } };
    expect(counterGrowthOps(doc, both(baselineKnowledge(lower)), T)).toEqual([
      expect.objectContaining({ name: carryX(T), minor: -200 }),
      expect.objectContaining({ name: 'accounts/A/balance@2/carry.y.5', minor: 70 }),
    ]);
  });

  it('the restore-generation scenario: two live names, folded together, carry nothing', () => {
    // A restored file holds K live on R; a pre-restore peer put carry.X.R = 2 beside it; D
    // compacts R → R+1. Peer F on R holds both live and rebases onto R+1: zero growth.
    const R = 4;
    const { doc } = peer(() => ({ counters: { [KX]: 1000 }, registers: { [carryX(R)]: 200 } }));
    const target = {
      foldedCounters: { [KX]: { v: 1000, s: R + 1 }, [carryX(R)]: { v: 200, s: R + 1 } },
    };
    expect(counterGrowthOps(doc, both(targetKnowledge(target, R, R + 1)), R + 1)).toEqual([]);
  });

  it('the three-generation scenario: another peer carried and folded growth is subtracted', () => {
    // S (actor X) holds K = 10 on P; D folded 8 at T; B carried 1 onto T; T+1 folded it. S
    // rebasing onto T+1 knows 8 + 1 and carries 1, so the fold at T+2 is 10, never 11.
    const P = 2;
    const { doc } = peer(() => ({ counters: { [KX]: 1000 } }));
    const target = {
      foldedCounters: { [KX]: { v: 800, s: P + 1 }, [carryX(P + 1)]: { v: 100, s: P + 2 } },
    };
    const ops = counterGrowthOps(doc, both(targetKnowledge(target, P, P + 2)), P + 2);
    expect(ops).toEqual([expect.objectContaining({ name: carryX(P + 2), minor: 100 })]);
    // A carry folded from a generation BEFORE the peer's is not subtracted.
    const older = {
      foldedCounters: { [KX]: { v: 800, s: P + 1 }, [carryX(P - 1)]: { v: 100, s: P } },
    };
    expect(counterGrowthOps(doc, both(targetKnowledge(older, P, P + 2)), P + 2)).toEqual([
      expect.objectContaining({ minor: 200 }),
    ]);
  });

  it('skips malformed keys and non-integer values', () => {
    const { doc } = peer(() => ({
      counters: { garbage: 1, 'accounts/A/creditLimit@2/x': 5, [KX]: 100 },
      registers: { 'accounts/A/balance@2/carry.z.1': 1.5 },
    }));
    expect(counterGrowthOps(doc, both(knows({})), T)).toEqual([
      expect.objectContaining({ name: carryX(T), minor: 100 }),
    ]);
  });

  it('no key, or nothing grown, is no ops', () => {
    expect(counterGrowthOps(baseline, both(knows({})), T)).toEqual([]);
    const { doc } = peer(() => ({ counters: { [KX]: 500 } }));
    expect(counterGrowthOps(doc, both(knows({ [KX]: 500 })), T)).toEqual([]);
  });

  it('works on live documents written through adjustField (the own key is exact)', () => {
    setCounterWrites(true);
    const live = Automerge.clone(baseline);
    const own = Automerge.getActorId(live);
    const ahead = Automerge.change(live, (d) => {
      adjustField(d, 'accounts', 'A', 'balance', -1, own);
      adjustField(d, 'accounts', 'A', 'balance', -2.5, own);
    });
    const K = `accounts/A/balance@2/${own}`;
    const target = { foldedCounters: { [K]: { v: -100, s: 1 } } };
    expect(
      counterGrowthOps(ahead, { exact: targetKnowledge(target, 0, 1), foreign: knows({}) }, 1)
    ).toEqual([
      {
        op: 'carry',
        collection: 'accounts',
        id: 'A',
        name: carryKeyFor(K, 1),
        minor: -250,
        exact: true,
      },
    ]);
  });
});

describe('counterStats', () => {
  it("counts keys, conflicts, the fold's malformed keys and the ledger", () => {
    setCounterWrites(true);
    const origin = docWith((d) => {
      adjustField(d, 'accounts', 'A', 'balance', -1, W1);
      (d.counterDeltas as unknown as AnyRec)['garbage'] = new Automerge.Counter(1);
      (d as unknown as AnyRec).foldedCounters = {
        'accounts/A/balance@2/old': { v: -5, s: 4 },
        'accounts/A/balance@2/older': { v: -6, s: 2 },
        'accounts/A/balance@2/bare': -7,
      };
    });
    expect(counterStats(origin)).toEqual({
      keys: 2,
      conflicts: 0,
      carryConflicts: 0,
      malformed: 1,
      ledgerKeys: 3,
      ledgerOldest: 2,
    });
    // Two actors creating the SAME key: the bug the key design exists to prevent.
    const a = Automerge.change(Automerge.clone(origin), (d) => {
      d.counterDeltas['accounts/A/balance@2/dev:shared'] = new Automerge.Counter(1);
    });
    const b = Automerge.change(Automerge.clone(origin), (d) => {
      d.counterDeltas['accounts/A/balance@2/dev:shared'] = new Automerge.Counter(2);
    });
    expect(counterStats(Automerge.merge(a, b))).toMatchObject({ conflicts: 1, carryConflicts: 0 });
  });

  it('two concurrent puts of one carry register count as carryConflicts, not conflicts', () => {
    const origin = docWith();
    const put = (v: number) =>
      Automerge.change(Automerge.clone(origin), (d) => {
        (d.counterDeltas as unknown as AnyRec)[carryX(3)] = v;
      });
    expect(counterStats(Automerge.merge(put(5), put(7)))).toMatchObject({
      conflicts: 0,
      carryConflicts: 1,
    });
  });

  it('ledgerOldest is null for a ledger of bare entries only', () => {
    const doc = docWith((d) => {
      (d as unknown as AnyRec).foldedCounters = { 'accounts/A/balance@2/bare': -7 };
    });
    expect(counterStats(doc)).toMatchObject({ ledgerKeys: 1, ledgerOldest: null });
  });

  it('an absent map reports zeros', () => {
    expect(counterStats(Automerge.init<FamilyDocument>())).toEqual({
      keys: 0,
      conflicts: 0,
      carryConflicts: 0,
      malformed: 0,
      ledgerKeys: 0,
      ledgerOldest: null,
    });
  });
});
