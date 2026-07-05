import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the telemetry sink so we can assert escalation without shipping anything.
const logEvent = vi.fn();
vi.mock('@/services/telemetry', () => ({ logEvent: (...args: unknown[]) => logEvent(...args) }));

import { measureSync, measureAsync } from '@/utils/perfTiming';

/** Drive `performance.now()` so each measured op reports an exact duration. */
function stubDuration(ms: number): void {
  let call = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => {
    call += 1;
    return call === 1 ? 0 : ms; // start → end
  });
}

describe('perfTiming', () => {
  beforeEach(() => {
    logEvent.mockClear();
    // Silence the deliberate console.info instrumentation during tests.
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the wrapped function result', () => {
    stubDuration(5);
    expect(measureSync('x.op', () => 42)).toBe(42);
  });

  it('propagates a throw and still records', () => {
    stubDuration(9);
    expect(() =>
      measureSync('x.throws', () => {
        throw new Error('boom');
      })
    ).toThrow('boom');
  });

  it('does NOT escalate a fast op to telemetry', () => {
    stubDuration(50); // below the 250ms telemetry floor
    measureSync('x.fast', () => null);
    expect(logEvent).not.toHaveBeenCalled();
  });

  it('escalates a felt stall to telemetry at info level', () => {
    stubDuration(400); // ≥250, <1000
    measureSync('x.stall', () => null, { perf_doc_bytes: 1024 });
    expect(logEvent).toHaveBeenCalledTimes(1);
    const arg = logEvent.mock.calls[0]![0] as {
      level: string;
      surface: string;
      context: Record<string, unknown>;
    };
    expect(arg.level).toBe('info');
    expect(arg.surface).toBe('load-perf');
    expect(arg.context.perf_op).toBe('x.stall');
    expect(arg.context.perf_duration_ms).toBe(400);
    expect(arg.context.perf_doc_bytes).toBe(1024);
  });

  it('escalates a felt freeze to telemetry at warn level', () => {
    stubDuration(2500); // ≥1000
    measureSync('x.freeze', () => null);
    expect(logEvent).toHaveBeenCalledTimes(1);
    const arg = logEvent.mock.calls[0]![0] as { level: string };
    expect(arg.level).toBe('warn');
  });

  it('measureAsync awaits and returns the resolved value', async () => {
    stubDuration(30);
    await expect(measureAsync('x.async', async () => 'done')).resolves.toBe('done');
  });
});
