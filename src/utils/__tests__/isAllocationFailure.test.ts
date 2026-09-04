/**
 * The allocation-failure classifier.
 *
 * The asymmetry is the whole point and is what these tests exist to pin: a
 * false positive leaves a corrupt cache un-healed and the user wedged, while a
 * false negative DELETES the cache — base, increments and all, including edits
 * that never reached Drive. Neither direction is free and the second is the
 * unrecoverable one, so both are pinned here rather than assumed.
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
  it('does NOT match the UNAMBIGUOUS bad-length RangeErrors', () => {
    // These mean "that is not a valid array length", which memory pressure
    // never produces. They are the corruption signature, and matching them
    // would skip the self-heal that a genuinely corrupt cache needs.
    expect(isAllocationFailure(new RangeError('Invalid typed array length: -1'))).toBe(false);
    expect(isAllocationFailure(new RangeError('Invalid array length'))).toBe(false);
  });

  it('DOES match "Array buffer allocation failed" — the ambiguous one', () => {
    // V8 throws this both for `new Uint8Array(2^40)` and for a real allocation
    // failure under memory pressure, so the string alone cannot decide it. The
    // call path does: nothing on the pod-open path allocates from payload
    // content (`base64ToBuffer` sizes from the string length; `unframeChanges`
    // only `subarray`s, behind bounds checks), so here it means the device ran
    // out of room.
    //
    // Asserted as a POSITIVE deliberately. Excluding it was a real regression:
    // it is the first thing a 3GB tablet hits, and calling that corruption
    // makes `initAndLoadCache` delete the entire cache DB.
    expect(isAllocationFailure(new RangeError('Array buffer allocation failed'))).toBe(true);
  });

  it('rejects the error a NEGATIVE length actually throws, built for real', () => {
    // Belt and braces: construct it rather than trusting a string literal that
    // could drift from what the engine emits. (2.5 is deliberately absent — V8
    // truncates a fractional length instead of throwing.)
    let thrown: unknown;
    try {
      new Uint8Array(-1);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RangeError);
    expect(isAllocationFailure(thrown)).toBe(false);
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
