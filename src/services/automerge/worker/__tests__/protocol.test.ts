import { describe, it, expect } from 'vitest';
import { CorruptPayloadError, PayloadTooLargeError, PayloadLoadError } from '@/types/sync';
import {
  serializeError,
  reconstructError,
  DocWorkerError,
  isRpcResponse,
  isWorkerSignal,
} from '../protocol';
import { PodLineageError, lineageBlockError } from '@/services/sync/podLineage';

describe('protocol — error transport', () => {
  it('round-trips CorruptPayloadError preserving class + step + familyId', () => {
    const original = new CorruptPayloadError('materialize blew up', 'materialize', 'fam-123');
    const wire = serializeError(original);
    expect(wire).toEqual({
      name: 'CorruptPayloadError',
      message: 'materialize blew up',
      data: { step: 'materialize', familyId: 'fam-123', payloadBytes: null },
    });

    const rebuilt = reconstructError(wire);
    // Load-bearing: recovery dispatch is `instanceof CorruptPayloadError`.
    expect(rebuilt).toBeInstanceOf(CorruptPayloadError);
    expect((rebuilt as CorruptPayloadError).step).toBe('materialize');
    expect((rebuilt as CorruptPayloadError).familyId).toBe('fam-123');
    expect(rebuilt.message).toBe('materialize blew up');
  });

  it('carries the rebase-unavailable flag across the worker boundary', () => {
    // The guard throws in the WORKER, and the ONE place that can tell a broken
    // rebase from a correct refusal reads this flag on MAIN. If the codec drops
    // it, the block still surfaces correctly to the user and the soak silently
    // loses its deciding signal — a failure with no symptom.
    const wire = serializeError(lineageBlockError('adopt-remote', { rebaseUnavailable: true }));
    const rebuilt = reconstructError(wire);
    expect(rebuilt).toBeInstanceOf(PodLineageError);
    expect((rebuilt as PodLineageError).verdict).toBe('adopt-remote');
    expect((rebuilt as PodLineageError).rebaseUnavailable).toBe(true);
  });

  it('leaves the flag unset for an ordinary lineage block', () => {
    // Anti-vacuity: a codec that hardcoded `true` would pass the test above and
    // report every correct refusal as broken machinery.
    const rebuilt = reconstructError(serializeError(lineageBlockError('adopt-remote')));
    expect((rebuilt as PodLineageError).rebaseUnavailable).toBeUndefined();
    expect((rebuilt as PodLineageError).verdict).toBe('adopt-remote');
  });

  it('round-trips PayloadTooLargeError as its OWN class, never as corruption', () => {
    // The whole point of the sibling class: an out-of-memory failure must not
    // arrive on main as a CorruptPayloadError, because the recovery dispatch
    // there DELETES the local cache.
    const original = new PayloadTooLargeError('oom', 'load', 'fam-9', 3_145_728);
    const wire = serializeError(original);
    expect(wire).toEqual({
      name: 'PayloadTooLargeError',
      message: 'oom',
      data: { step: 'load', familyId: 'fam-9', payloadBytes: 3_145_728 },
    });

    const rebuilt = reconstructError(wire);
    expect(rebuilt).toBeInstanceOf(PayloadTooLargeError);
    expect(rebuilt).not.toBeInstanceOf(CorruptPayloadError);
    // Still a PayloadLoadError, which is what `surface()` keys its
    // expected-degradation (no-toast) check on.
    expect(rebuilt).toBeInstanceOf(PayloadLoadError);
    expect((rebuilt as PayloadTooLargeError).payloadBytes).toBe(3_145_728);
    expect((rebuilt as PayloadTooLargeError).step).toBe('load');
  });

  it('keys the registry on LITERAL names, so a minified build still reconstructs', () => {
    // If a registry key were ever derived from `Ctor.name`, terser would mangle
    // it and every typed error would silently degrade to DocWorkerError.
    for (const err of [
      new CorruptPayloadError('a', 'load', null),
      new PayloadTooLargeError('b', 'load', null),
    ]) {
      expect(reconstructError(serializeError(err))).toBeInstanceOf(err.constructor);
    }
  });

  it('reconstructs an unregistered error as DocWorkerError carrying the name + op', () => {
    const wire = serializeError(new TypeError('boom'));
    expect(wire.name).toBe('TypeError');
    const rebuilt = reconstructError(wire, 'mutate');
    expect(rebuilt).toBeInstanceOf(DocWorkerError);
    expect(rebuilt.message).toContain('TypeError');
    expect(rebuilt.message).toContain('boom');
    expect((rebuilt as DocWorkerError).op).toBe('mutate');
  });

  it('serializes a non-Error throw without crashing', () => {
    const wire = serializeError('just a string');
    expect(wire.name).toBe('Error');
    expect(wire.message).toBe('just a string');
    expect(wire.data).toBeUndefined();
  });

  it('routes messages: responses have cid, signals have signal', () => {
    expect(isRpcResponse({ cid: 3, ok: true })).toBe(true);
    expect(isRpcResponse({ signal: 'ready' })).toBe(false);
    expect(isWorkerSignal({ signal: 'perf', label: 'x', durationMs: 1 })).toBe(true);
    expect(isWorkerSignal({ cid: 3, ok: true })).toBe(false);
    expect(isRpcResponse(null)).toBe(false);
    expect(isWorkerSignal(undefined)).toBe(false);
  });
});
