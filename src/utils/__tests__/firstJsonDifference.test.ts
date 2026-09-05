/**
 * The gate that decides whether a compaction is allowed to replace a family's
 * pod. A false `null` here means an unverified rewrite ships.
 */
import { describe, it, expect } from 'vitest';
import { firstJsonDifference } from '@/utils/firstJsonDifference';

describe('firstJsonDifference', () => {
  it('returns null for deeply equal trees', () => {
    const a = { accounts: { a1: { id: 'a1', bal: 1 } }, list: [1, 2, { x: true }] };
    expect(firstJsonDifference(a, structuredClone(a))).toBeNull();
  });

  it('ignores object KEY ORDER, which is not meaning in JSON', () => {
    expect(firstJsonDifference({ a: 1, b: 2 }, { b: 2, a: 1 })).toBeNull();
  });

  it('does NOT ignore array order, which is', () => {
    expect(firstJsonDifference([1, 2], [2, 1])).toBe('[0]');
  });

  it('names the path to the first difference, not the value', () => {
    // The path reaches the firehose; the value must not.
    const d = firstJsonDifference(
      { accounts: { a1: { balance: 100 } } },
      { accounts: { a1: { balance: 999 } } }
    );
    expect(d).toBe('accounts.a1.balance');
    expect(d).not.toContain('999');
  });

  it('catches a key present on one side only', () => {
    expect(firstJsonDifference({ a: 1 }, { a: 1, b: 2 })).toBe('b');
    expect(firstJsonDifference({ a: 1, b: 2 }, { a: 1 })).toBe('b');
  });

  it('catches a key whose value is explicitly undefined vs absent', () => {
    // `toJS` can produce either; they are NOT the same document and the gate
    // must not wave it through.
    expect(firstJsonDifference({ a: 1, b: undefined }, { a: 1 })).toBe('b');
  });

  it('cannot confuse an index with a key literally named length', () => {
    // `[i]` rather than `.i` for indices, so `{length: 1}` and `[x]` report
    // differently.
    expect(firstJsonDifference({ length: 1 }, { length: 2 })).toBe('length');
  });

  it('catches a length change before walking the elements', () => {
    expect(firstJsonDifference([1, 2, 3], [1, 2])).toBe('(root)[length]');
  });

  it('distinguishes null from an object, and an array from an object', () => {
    expect(firstJsonDifference({ a: null }, { a: {} })).toBe('a');
    expect(firstJsonDifference({ a: [] }, { a: {} })).toBe('a');
  });

  it('distinguishes types that == would conflate', () => {
    expect(firstJsonDifference({ a: 1 }, { a: '1' })).toBe('a');
    expect(firstJsonDifference({ a: 0 }, { a: false })).toBe('a');
  });

  it('reports a stable path across runs for the same inputs', () => {
    // Keys are walked sorted, so a flapping path cannot read as several bugs.
    const a = { z: 1, a: 1, m: 1 };
    const b = { z: 2, a: 2, m: 2 };
    expect(firstJsonDifference(a, b)).toBe('a');
    expect(firstJsonDifference(a, b)).toBe('a');
  });
});
