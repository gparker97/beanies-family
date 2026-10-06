import { describe, expect, it, vi } from 'vitest';
import { createTrailingSingleFlight } from '../trailingSingleFlight';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Args = { repair: boolean };
const mergeArgs = (a: Args, b: Args): Args => ({ repair: a.repair || b.repair });

/** A `run` whose every invocation hands back a controllable deferred. */
function controllableRun() {
  const runs: Array<{ args: Args; d: Deferred<boolean> }> = [];
  const run = vi.fn((args: Args) => {
    const d = deferred<boolean>();
    runs.push({ args, d });
    return d.promise;
  });
  return { run, runs };
}

const flush = async (): Promise<void> => {
  // Enough microtask turns for settle → clear → promote chains.
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('createTrailingSingleFlight', () => {
  it('starts an idle call synchronously and resolves with its own result', async () => {
    const { run, runs } = controllableRun();
    const sf = createTrailingSingleFlight(run, mergeArgs);

    const p = sf.call({ repair: false });
    expect(run).toHaveBeenCalledTimes(1); // synchronous start
    expect(sf.pending()).toBe(p);

    runs[0]!.d.resolve(true);
    await expect(p).resolves.toBe(true);
    await flush();
    expect(sf.pending()).toBeNull();
  });

  it('folds callers arriving during a run into ONE trailing run that starts after it settles', async () => {
    const { run, runs } = controllableRun();
    const onCoalesced = vi.fn();
    const sf = createTrailingSingleFlight(run, mergeArgs, onCoalesced);

    const first = sf.call({ repair: false });
    const second = sf.call({ repair: false });
    const third = sf.call({ repair: true });
    expect(run).toHaveBeenCalledTimes(1); // nothing concurrent
    expect(second).toBe(third); // same trailing promise
    expect(sf.pending()).toBe(second);

    runs[0]!.d.resolve(false);
    await expect(first).resolves.toBe(false);
    await flush();

    expect(run).toHaveBeenCalledTimes(2);
    expect(runs[1]!.args).toEqual({ repair: true }); // merged (OR-ed)
    expect(onCoalesced).toHaveBeenCalledWith(2);
    // pending() is non-null for the WHOLE trailing run (promoted slot).
    expect(sf.pending()).toBe(second);

    runs[1]!.d.resolve(true);
    await expect(second).resolves.toBe(true);
    await flush();
    expect(sf.pending()).toBeNull();
  });

  it('does not fire onCoalesced for a trailing run with a single caller', async () => {
    const { run, runs } = controllableRun();
    const onCoalesced = vi.fn();
    const sf = createTrailingSingleFlight(run, mergeArgs, onCoalesced);

    void sf.call({ repair: false });
    const trailing = sf.call({ repair: false });
    runs[0]!.d.resolve(true);
    await flush();
    runs[1]!.d.resolve(true);
    await trailing;
    expect(onCoalesced).not.toHaveBeenCalled();
  });

  it('runs the trailing run even when the in-flight run rejects', async () => {
    const { run, runs } = controllableRun();
    const sf = createTrailingSingleFlight(run, mergeArgs);

    const first = sf.call({ repair: false });
    const trailing = sf.call({ repair: false });
    runs[0]!.d.reject(new Error('boom'));
    await expect(first).rejects.toThrow('boom');
    await flush();

    expect(run).toHaveBeenCalledTimes(2);
    runs[1]!.d.resolve(true);
    await expect(trailing).resolves.toBe(true);
  });

  it('a call made in the settle→promote microtask gap joins the trailing run (run invoked exactly twice)', async () => {
    const { run, runs } = controllableRun();
    const sf = createTrailingSingleFlight(run, mergeArgs);

    const first = sf.call({ repair: false });
    const trailing = sf.call({ repair: false });

    // Attach to the in-flight promise so our callback runs in the same
    // microtask turn as the slot clear, BEFORE the trailing promotion.
    let gapCall: Promise<boolean> | null = null;
    void first.then(() => {
      gapCall = sf.call({ repair: true });
    });

    runs[0]!.d.resolve(true);
    await flush();

    expect(run).toHaveBeenCalledTimes(2);
    expect(gapCall).toBe(trailing);
    expect(runs[1]!.args).toEqual({ repair: true });
    runs[1]!.d.resolve(true);
    await expect(trailing).resolves.toBe(true);
  });

  it('a settled older run never clears a newer slot', async () => {
    const { run, runs } = controllableRun();
    const sf = createTrailingSingleFlight(run, mergeArgs);

    void sf.call({ repair: false });
    const trailing = sf.call({ repair: false });
    runs[0]!.d.resolve(true);
    await flush();
    // Trailing run is now in flight and promoted into `running`.
    expect(sf.pending()).toBe(trailing);

    // A further caller during the trailing run queues a THIRD run.
    const third = sf.call({ repair: false });
    expect(sf.pending()).toBe(third);
    runs[1]!.d.resolve(true);
    await flush();
    expect(run).toHaveBeenCalledTimes(3);
    expect(sf.pending()).toBe(third); // the newer slot survived the older settle
    runs[2]!.d.resolve(true);
    await third;
    await flush();
    expect(sf.pending()).toBeNull();
  });

  it('turns a synchronous throw from run into a rejection and frees the slot', async () => {
    const run = vi.fn((): Promise<boolean> => {
      throw new Error('sync boom');
    });
    const sf = createTrailingSingleFlight(run, mergeArgs);

    const p = sf.call({ repair: false });
    await expect(p).rejects.toThrow('sync boom');
    await flush();
    expect(sf.pending()).toBeNull();
  });

  it('a throwing onCoalesced hook does not fail the trailing run', async () => {
    const { run, runs } = controllableRun();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sf = createTrailingSingleFlight(run, mergeArgs, () => {
      throw new Error('telemetry down');
    });

    void sf.call({ repair: false });
    const trailing = sf.call({ repair: false });
    void sf.call({ repair: false });
    runs[0]!.d.resolve(true);
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
    runs[1]!.d.resolve(true);
    await expect(trailing).resolves.toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('each caller gets the boolean of the run that covers it', async () => {
    const { run, runs } = controllableRun();
    const sf = createTrailingSingleFlight(run, mergeArgs);

    const first = sf.call({ repair: false });
    const trailing = sf.call({ repair: false });
    runs[0]!.d.resolve(false);
    await flush();
    runs[1]!.d.resolve(true);
    await expect(first).resolves.toBe(false);
    await expect(trailing).resolves.toBe(true);
  });
});
