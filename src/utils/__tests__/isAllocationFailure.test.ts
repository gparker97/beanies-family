/**
 * The allocation-failure classifier.
 *
 * The asymmetry is the whole point and is what these tests exist to pin: a
 * MISSED out-of-memory just degrades to today's behaviour, but a FALSE POSITIVE
 * skips the cache clear that genuine corruption needs to self-heal and leaves
 * the user wedged. So the negative cases below matter more than the positive
 * ones — particularly `RangeError` and a bare `unreachable` trap, both of which
 * are ALSO shapes real corruption produces.
 */
import { describe, it, expect } from 'vitest';
import { isAllocationFailure } from '@/utils/isAllocationFailure';

describe('isAllocationFailure — positive cases', () => {
  it.each([
    // The message actually observed on the Galaxy Tab A9+.
    'error inflating document chunk ops: out of memory',
    'Out of memory',
    'memory allocation failed',
    'Allocation size overflow',
    'Array buffer allocation failed',
    'WebAssembly.Memory(): could not allocate wasm memory',
    'cannot grow memory',
    'memory.grow failed',
  ])('matches %s', (message) => {
    expect(isAllocationFailure(new Error(message))).toBe(true);
  });

  it('matches a bare string throw', () => {
    expect(isAllocationFailure('out of memory')).toBe(true);
  });

  it('matches when the phrase is only on `cause` (Automerge 3.x wraps some Rust failures)', () => {
    const wrapped = new Error('load failed', { cause: new Error('out of memory') });
    expect(isAllocationFailure(wrapped)).toBe(true);
  });
});

describe('isAllocationFailure — negative cases (the ones that matter)', () => {
  it('does NOT match a bare RangeError', () => {
    // `new Uint8Array(<absurd length>)` throws this, and a corrupt payload with
    // a garbage length prefix produces exactly that. Matching it would classify
    // real corruption as OOM and skip the cache clear it needs.
    expect(isAllocationFailure(new RangeError('Invalid array length'))).toBe(false);
  });

  it('does NOT match a bare `unreachable` wasm trap', () => {
    // In release wasm EVERY Rust panic!/unwrap() compiles to `unreachable`, not
    // just rust_oom, so matching it would sweep in most Automerge decode panics.
    expect(isAllocationFailure(new Error('unreachable'))).toBe(false);
    expect(isAllocationFailure(new Error('RuntimeError: unreachable executed'))).toBe(false);
  });

  it('does NOT match genuine corruption messages', () => {
    for (const message of [
      'Out of bounds table access',
      'invalid chunk type',
      'failed to parse document',
      'checksum mismatch',
    ]) {
      expect(isAllocationFailure(new Error(message))).toBe(false);
    }
  });

  it.each([undefined, null, 0, {}, [], new Error('')])('does not throw on %s', (value) => {
    expect(isAllocationFailure(value)).toBe(false);
  });

  it('does not walk deeper than one `cause` hop', () => {
    // A fixed single step, so there is no cycle risk and no unbounded walk.
    const deep = new Error('a', { cause: new Error('b', { cause: new Error('out of memory') }) });
    expect(isAllocationFailure(deep)).toBe(false);
  });

  it('survives a self-referential cause without hanging', () => {
    const e = new Error('boom') as Error & { cause?: unknown };
    e.cause = e;
    expect(isAllocationFailure(e)).toBe(false);
  });
});
