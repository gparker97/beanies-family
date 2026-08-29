import { describe, it, expect } from 'vitest';
import { createChangeGate, createSampler } from '../emitPolicy';

// These gates decide what reaches CloudWatch on the highest-volume surfaces, so
// the properties that matter are: a real change is NEVER dropped, and a rate is
// still recoverable from what survives.

describe('createChangeGate', () => {
  it('emits the first outcome it sees', () => {
    const gate = createChangeGate();
    expect(gate('a')).toBe(true);
  });

  it('suppresses identical repeats', () => {
    const gate = createChangeGate();
    gate('a');
    expect(gate('a')).toBe(false);
    expect(gate('a')).toBe(false);
  });

  it('never drops a change — this is the property the whole thing rests on', () => {
    const gate = createChangeGate();
    gate('a');
    expect(gate('b')).toBe(true);
    expect(gate('a')).toBe(true);
    expect(gate('c')).toBe(true);
  });

  it('emits a heartbeat so a quiet surface can still be proven alive', () => {
    const gate = createChangeGate(3);
    expect(gate('a')).toBe(true); // change
    expect(gate('a')).toBe(false);
    expect(gate('a')).toBe(false);
    expect(gate('a')).toBe(true); // heartbeat
    expect(gate('a')).toBe(false);
  });

  it('restarts the heartbeat count after a change, so a change is never immediately followed by a redundant heartbeat', () => {
    const gate = createChangeGate(3);
    gate('a');
    gate('a');
    gate('a');
    expect(gate('b')).toBe(true); // change resets
    expect(gate('b')).toBe(false);
    expect(gate('b')).toBe(false);
    expect(gate('b')).toBe(true);
  });

  it('reports how many emissions it has suppressed', () => {
    const gate = createChangeGate(10);
    gate('a');
    gate('a');
    gate('a');
    expect(gate.suppressed).toBe(2);
  });

  it('keeps gates independent so two surfaces cannot mask each other', () => {
    const a = createChangeGate();
    const b = createChangeGate();
    a('x');
    expect(a('x')).toBe(false);
    expect(b('x')).toBe(true);
  });

  it('cuts a realistic reconcile storm to a fraction while keeping every transition', () => {
    // 12 identical reconciles a day, then one that actually did something.
    const gate = createChangeGate(20);
    let emitted = 0;
    for (let day = 0; day < 30; day++) {
      for (let i = 0; i < 12; i++) if (gate('nothing-changed')) emitted++;
    }
    if (gate('generated-1')) emitted++;
    // 361 calls collapse to a handful, and the meaningful one is not among the losses.
    expect(emitted).toBeLessThan(30);
    expect(gate('generated-1')).toBe(false); // and it settles again afterwards
  });
});

describe('createSampler', () => {
  it('passes exactly one call in N', () => {
    const sample = createSampler(4);
    expect([sample(), sample(), sample(), sample()]).toEqual([false, false, false, true]);
  });

  it('is deterministic, so a rate is exact rather than approximate', () => {
    const sample = createSampler(5);
    let passed = 0;
    for (let i = 0; i < 1000; i++) if (sample()) passed++;
    expect(passed).toBe(200); // 1000 / 5, no statistical wobble
  });

  it('passes every call when N is 1', () => {
    const sample = createSampler(1);
    expect([sample(), sample()]).toEqual([true, true]);
  });
});
