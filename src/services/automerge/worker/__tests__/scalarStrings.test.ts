// @vitest-environment node
/**
 * #124: `scalarStrings.ts`: the classification table, the three read helpers, the write half
 * (`docValue`, `stampUpdatedAt`, the mint slot) and the `asStrForm` test helper built on the
 * same table. The engine facts these rest on are pinned in `automergeSemantics.test.ts` (q).
 */
import { afterEach, describe, it, expect } from 'vitest';
import * as Automerge from '@automerge/automerge';
import {
  SCALAR_FIELDS,
  TEXT_FIELDS,
  classify,
  docValue,
  isImmutableString,
  isMapValue,
  isScalarField,
  scalarMint,
  setScalarMint,
  stampUpdatedAt,
  str,
} from '../scalarStrings';
import { asStrForm, identity } from './strForms';

const Imm = Automerge.ImmutableString;

describe('isImmutableString / str / isMapValue', () => {
  it('recognises the engine value, and nothing that merely looks like it', () => {
    expect(isImmutableString(new Imm('x'))).toBe(true);
    // A structured clone (the postMessage hop) has lost the marker: it is just an object.
    expect(isImmutableString(structuredClone(new Imm('x')))).toBe(false);
    for (const v of ['x', { val: 'x' }, null, undefined, 1, ['x']]) {
      expect(isImmutableString(v)).toBe(false);
    }
  });

  it("is false for a LIST proxy inside a change, where the engine's own check says true", () => {
    const seen: boolean[] = [];
    Automerge.change(
      Automerge.from<{ l: string[]; m: { k: string } }>({ l: ['a'], m: { k: 'v' } }),
      (d) => {
        seen.push(Automerge.isImmutableString(d.l), isImmutableString(d.l), isImmutableString(d.m));
      }
    );
    expect(seen).toEqual([true, false, false]);
  });

  it('is false for a MAP proxy inside a change too (the root and a nested map)', () => {
    const seen: boolean[] = [];
    Automerge.change(
      Automerge.from<{ m: { k: string; n: { j: string } } }>({ m: { k: 'v', n: { j: 'w' } } }),
      (d) => {
        seen.push(isImmutableString(d), isImmutableString(d.m), isImmutableString(d.m.n));
        seen.push(isMapValue(d.m), isMapValue(d.m.n));
      }
    );
    expect(seen).toEqual([false, false, false, true, true]);
  });

  it('str unwraps an ImmutableString, passes a string through, and is undefined otherwise', () => {
    expect(str(new Imm('2026-10-20'))).toBe('2026-10-20');
    expect(str('2026-10-20')).toBe('2026-10-20');
    expect(str('')).toBe('');
    for (const v of [undefined, null, 7, { val: 'x' }, ['x']]) expect(str(v)).toBeUndefined();
  });

  it('isMapValue: a non-array object that is not an ImmutableString', () => {
    expect(isMapValue({})).toBe(true);
    expect(isMapValue({ val: 'x' })).toBe(true);
    for (const v of [new Imm('x'), [], null, undefined, 'x', 1]) expect(isMapValue(v)).toBe(false);
  });
});

describe('classification', () => {
  it('infers only the Id / Ids / At suffixes; everything else is listed', () => {
    for (const name of ['memberId', 'photoIds', 'createdAt', 'id', 'date', 'currency', 'type']) {
      expect(isScalarField(name)).toBe(true);
    }
    // No `By`, `On` or `Date` suffix rule: `diagnosedBy` is a doctor's name.
    for (const name of ['diagnosedBy', 'title', 'name', 'notes', 'tags']) {
      expect(isScalarField(name)).toBe(false);
    }
  });

  it('the two sets are disjoint, and no acknowledged text name suffix-matches', () => {
    for (const name of TEXT_FIELDS) {
      expect(SCALAR_FIELDS.has(name)).toBe(false);
      expect(isScalarField(name)).toBe(false);
    }
    for (const name of ['title', 'name', 'note', 'notes', 'description', 'diagnosedBy']) {
      expect(TEXT_FIELDS.has(name)).toBe(true);
    }
  });

  it('own key, else container: arrays and dynamic maps classify by their own field name', () => {
    expect(classify('id', 'items')).toBe('scalar'); // a keyed element's own key
    expect(classify('title', 'items')).toBe('text');
    expect(classify(0, 'photoIds')).toBe('scalar'); // an array element has no key of its own
    expect(classify(0, 'tags')).toBe('text');
    expect(classify(0, 'notAField')).toBe('unclassified');
    expect(classify('birthday-m1', 'dismissedHintKeys')).toBe('scalar');
    expect(classify('openai', 'aiApiKeys')).toBe('scalar');
    expect(classify('notAField', 'loan')).toBe('unclassified');
    expect(classify('title', undefined)).toBe('text');
  });
});

describe('docValue / stampUpdatedAt (the write half)', () => {
  const mint = (v: string) => new Imm(v);
  afterEach(() => setScalarMint(null));

  const entity = () => ({
    id: 'L',
    title: 'groceries',
    memberIds: ['m1'],
    tags: ['weekly'],
    items: [{ id: 'a', title: 'milk', completedAt: '2026-10-20T00:00:00.000Z', done: true }],
    loan: { lender: 'Bank', loanStartDate: '2026-01-01' },
    count: 3,
    nothing: null,
  });

  it('with no mint: exactly the old JSON copy (fresh object, undefined passes through)', () => {
    expect(scalarMint()).toBeNull();
    const value = entity();
    const out = docValue('lists', value);
    expect(out).toEqual(value);
    expect(out).not.toBe(value);
    expect(out.items).not.toBe(value.items);
    expect(docValue('lists', undefined)).toBeUndefined();
    expect(docValue('id', 'x')).toBe('x');
    // An ImmutableString read from the doc copies to its plain string (its `toJSON`).
    expect(docValue('id', new Imm('x'))).toBe('x');
    expect(JSON.stringify(docValue('lists', { a: undefined, b: 1 }))).toBe('{"b":1}');
  });

  it('with a mint: wraps exactly the scalar strings, own key else container, at every depth', () => {
    setScalarMint(mint);
    const value = entity();
    type Raw = Record<string, unknown>;
    const out = docValue('lists', value) as unknown as Raw & {
      memberIds: unknown[];
      tags: unknown[];
      items: Raw[];
      loan: Raw;
    };
    const wrapped = (v: unknown) => isImmutableString(v);
    const item = out.items[0]!;
    expect([out.id, out.memberIds[0], item.id, item.completedAt].map(wrapped)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(wrapped(out.loan.loanStartDate)).toBe(true);
    expect([out.title, out.tags[0], item.title, out.loan.lender].map(wrapped)).toEqual([
      false,
      false,
      false,
      false,
    ]);
    expect([out.count, out.nothing, item.done]).toEqual([3, null, true]);
    // The caller's value is never touched (inline mode shares `op.entity` with main).
    expect(value).toEqual(entity());
    // And the JSON projection is unchanged.
    expect(JSON.parse(JSON.stringify(out))).toEqual(entity());
  });

  it('a bare string classifies by its field, else the container (a dynamic map key)', () => {
    setScalarMint(mint);
    expect(isImmutableString(docValue('updatedAt', '2026-10-20T00:00:00.000Z'))).toBe(true);
    expect(docValue('title', 'milk')).toBe('milk');
    expect(isImmutableString(docValue('birthday-m1', '2026-10-21', 'dismissedHintKeys'))).toBe(
      true
    );
    expect(isImmutableString(docValue('openai', 'sk', 'aiApiKeys'))).toBe(true);
    expect(docValue('notAField', 'x', 'loan')).toBe('x');
    // An array element written by index classifies by the array's name.
    expect(isImmutableString(docValue(0, 'm1', 'memberIds'))).toBe(true);
    expect(docValue(0, 'weekly', 'tags')).toBe('weekly');
    // A whole dynamic map written under its own name wraps its values.
    const keys = docValue('dismissedHintKeys', { h1: '2026-10-21' }) as Record<string, unknown>;
    expect(isImmutableString(keys.h1)).toBe(true);
  });

  it('an element object written by index classifies its keys with the array as container', () => {
    setScalarMint(mint);
    const out = docValue(0, { id: 'a', title: 'milk' }, 'items') as Record<string, unknown>;
    expect([isImmutableString(out.id), isImmutableString(out.title)]).toEqual([true, false]);
  });

  it('a minted write is ONE op in the document; the same text write is 1 + length', () => {
    const iso = '2026-10-20T00:00:00.000Z';
    const opsOf = (on: boolean) => {
      setScalarMint(on ? mint : null);
      const base = Automerge.from<{ e: Record<string, unknown> }>({ e: {} });
      const before = Automerge.stats(base).numOps;
      const after = Automerge.change(base, (d) => stampUpdatedAt(d.e, iso));
      return Automerge.stats(after).numOps - before;
    };
    expect(opsOf(false)).toBe(1 + iso.length);
    expect(opsOf(true)).toBe(1);
  });
});

describe('asStrForm (the str test row)', () => {
  type Doc = {
    lists: Record<string, AnyList>;
    settings: { aiApiKeys: Record<string, string>; dismissedHintKeys: Record<string, string> };
    counterDeltas: Record<string, unknown>;
  };
  type AnyList = {
    id: unknown;
    title: unknown;
    tags: unknown[];
    memberIds: unknown[];
    items: Array<Record<string, unknown>>;
  };
  const seed = () =>
    Automerge.from<Doc>({
      lists: {
        L: {
          id: 'L',
          title: 'groceries',
          tags: ['weekly'],
          memberIds: ['m1'],
          items: [{ id: 'a', title: 'milk', updatedAt: '2026-10-20T00:00:00.000Z' }],
        },
      },
      settings: { aiApiKeys: { openai: 'sk' }, dismissedHintKeys: { h1: '2026-10-21' } },
      counterDeltas: {},
    });

  it('classifies a collection entity under the COLLECTION name, as docValue does', () => {
    // `notificationReads` is memberId -> (notificationId -> ISO readAt): both key levels are
    // dynamic, so only the collection name can classify the timestamps. The writer does that
    // (`docValue('notificationReads', entity)`); the str row must match or it proves nothing.
    type Reads = { notificationReads: Record<string, Record<string, unknown>> };
    const doc = asStrForm(
      Automerge.from<Reads>({ notificationReads: { m1: { n1: '2026-10-20T00:00:00.000Z' } } })
    );
    expect(isImmutableString(doc.notificationReads.m1!.n1)).toBe(true);
  });

  it('wraps exactly the scalar-classified strings, at every depth', () => {
    const doc = asStrForm(seed());
    const list = doc.lists.L!;
    expect(
      [list.id, list.memberIds[0], list.items[0]!.id, list.items[0]!.updatedAt].map(
        isImmutableString
      )
    ).toEqual([true, true, true, true]);
    expect([list.title, list.tags[0], list.items[0]!.title].map(isImmutableString)).toEqual([
      false,
      false,
      false,
    ]);
    expect(isImmutableString(doc.settings.aiApiKeys.openai)).toBe(true);
    expect(isImmutableString(doc.settings.dismissedHintKeys.h1)).toBe(true);
    // The JSON projection is unchanged: main never sees the difference.
    expect(JSON.parse(JSON.stringify(doc))).toEqual(JSON.parse(JSON.stringify(seed())));
  });

  it('is a no-op (same heads) on a doc already in the form; identity is the text row', () => {
    const once = asStrForm(seed());
    expect(Automerge.getHeads(asStrForm(once))).toEqual(Automerge.getHeads(once));
    const text = seed();
    expect(identity(text)).toBe(text);
  });
});
