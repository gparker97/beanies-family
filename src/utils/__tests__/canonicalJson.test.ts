import { describe, it, expect } from 'vitest';
import { canonicalJson } from '../canonicalJson';

describe('canonicalJson', () => {
  it('serialises maps with sorted keys at every depth, so key order never counts', () => {
    const a = { b: 1, a: { d: [1, { z: 1, y: 2 }], c: 'x' } };
    const b = { a: { c: 'x', d: [1, { y: 2, z: 1 }] }, b: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"a":{"c":"x","d":[1,{"y":2,"z":1}]},"b":1}');
  });

  it('keeps array order and JSON.stringify semantics (undefined keys drop out)', () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
    expect(canonicalJson(undefined)).toBeUndefined();
  });

  it('sorts only what the caller names a map', () => {
    const neverMap = (_v: unknown): _v is Record<string, unknown> => false;
    expect(canonicalJson({ b: 1, a: 2 }, neverMap)).toBe('{"b":1,"a":2}');
  });
});
