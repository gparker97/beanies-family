import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createReconcileLoop } from '@/utils/reconcileLoop';
import { reportError } from '@/utils/errorReporter';

vi.mock('@/utils/errorReporter', () => ({ reportError: vi.fn() }));

const DEBOUNCE = 100;

/** A run whose completion the test controls. */
function deferredRun() {
  const releases: Array<() => void> = [];
  const run = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        releases.push(resolve);
      })
  );
  const releaseNext = async () => {
    releases.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
  };
  return { run, releaseNext };
}

function makeLoop(run: () => unknown) {
  return createReconcileLoop({
    debounceMs: DEBOUNCE,
    run,
    surface: 'test-loop',
    failureMessage: 'test reconcile failed',
  });
}

describe('createReconcileLoop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(reportError).mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounce coalesces a burst of triggers into one run', async () => {
    const run = vi.fn();
    const loop = makeLoop(run);
    loop.queue();
    await vi.advanceTimersByTimeAsync(DEBOUNCE - 10);
    loop.queue();
    loop.queue();
    await vi.advanceTimersByTimeAsync(DEBOUNCE - 10);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('keeps one run in flight and coalesces mid-run triggers into exactly one rerun', async () => {
    const { run, releaseNext } = deferredRun();
    const loop = makeLoop(run);
    loop.queue();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(run).toHaveBeenCalledTimes(1);

    // Triggers during the run: no second concurrent run.
    loop.queue();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    loop.queue();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(run).toHaveBeenCalledTimes(1);

    // Settling the run re-queues once (through the debounce).
    await releaseNext();
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(run).toHaveBeenCalledTimes(2);

    // No further reruns once the rerun settles with nothing queued.
    await releaseNext();
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 5);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('runNow skips the debounce and cancels a pending debounced trigger', async () => {
    const run = vi.fn();
    const loop = makeLoop(run);
    loop.queue();
    await loop.runNow();
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 2);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runNow while busy returns the in-flight promise and queues one rerun', async () => {
    const { run, releaseNext } = deferredRun();
    const loop = makeLoop(run);
    const first = loop.runNow();
    await vi.advanceTimersByTimeAsync(0);
    const joined = loop.runNow();
    expect(joined).toBe(first);
    expect(run).toHaveBeenCalledTimes(1);

    let settled = false;
    void joined.then(() => (settled = true));
    await releaseNext();
    expect(settled).toBe(true);

    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('reports a throw (sync or async) and keeps working', async () => {
    const run = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('sync boom');
      })
      .mockImplementationOnce(async () => {
        throw new Error('async boom');
      })
      .mockImplementation(() => undefined);
    const loop = makeLoop(run);

    await expect(loop.runNow()).resolves.toBeUndefined();
    loop.queue();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(reportError).toHaveBeenCalledTimes(2);
    expect(reportError).toHaveBeenCalledWith({
      surface: 'test-loop',
      severity: 'error',
      message: 'test reconcile failed',
      error: expect.objectContaining({ message: 'sync boom' }),
    });

    loop.queue();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(run).toHaveBeenCalledTimes(3);
    expect(reportError).toHaveBeenCalledTimes(2);
  });

  it('reset clears a pending timer and both flags', async () => {
    const { run, releaseNext } = deferredRun();
    const loop = makeLoop(run);

    // Pending timer is dropped.
    loop.queue();
    loop.reset();
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 2);
    expect(run).not.toHaveBeenCalled();

    // In-flight + rerun state is dropped: a new run can start at once, and the
    // old run settling queues nothing.
    void loop.runNow();
    await vi.advanceTimersByTimeAsync(0);
    loop.queue();
    await vi.advanceTimersByTimeAsync(DEBOUNCE); // marks rerunQueued
    loop.reset();
    const fresh = loop.runNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);

    await releaseNext(); // the pre-reset run settles
    await vi.advanceTimersByTimeAsync(DEBOUNCE * 2);
    expect(run).toHaveBeenCalledTimes(2);

    // The fresh run still owns the loop: a trigger while it runs is deferred.
    expect(loop.runNow()).toBe(fresh);
    await releaseNext();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(run).toHaveBeenCalledTimes(3);
  });
});
