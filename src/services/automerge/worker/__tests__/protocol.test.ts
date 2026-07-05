import { describe, it, expect } from 'vitest';
import { CorruptPayloadError } from '@/types/sync';
import {
  serializeError,
  reconstructError,
  DocWorkerError,
  isRpcResponse,
  isWorkerSignal,
} from '../protocol';

describe('protocol — error transport', () => {
  it('round-trips CorruptPayloadError preserving class + step + familyId', () => {
    const original = new CorruptPayloadError('materialize blew up', 'materialize', 'fam-123');
    const wire = serializeError(original);
    expect(wire).toEqual({
      name: 'CorruptPayloadError',
      message: 'materialize blew up',
      data: { step: 'materialize', familyId: 'fam-123' },
    });

    const rebuilt = reconstructError(wire);
    // Load-bearing: recovery dispatch is `instanceof CorruptPayloadError`.
    expect(rebuilt).toBeInstanceOf(CorruptPayloadError);
    expect((rebuilt as CorruptPayloadError).step).toBe('materialize');
    expect((rebuilt as CorruptPayloadError).familyId).toBe('fam-123');
    expect(rebuilt.message).toBe('materialize blew up');
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
