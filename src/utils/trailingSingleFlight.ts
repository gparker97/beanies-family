/**
 * Trailing single-flight: at most ONE run in flight, and at most ONE queued
 * ("trailing") run that every caller arriving during the in-flight run shares.
 *
 * Shape: two slots, `running` and `next`.
 *
 *   idle                 → call() starts `run` synchronously and occupies `running`
 *   running, no next     → call() creates `next`; its promise starts after `running`
 *                          settles (fulfilled OR rejected) and is PROMOTED into
 *                          `running` the moment it starts
 *   running + next       → call() joins `next`: args merged, callers counted
 *
 * Each caller receives the promise of the run that covers its arguments: an
 * idle caller gets its own run; a caller during a run gets the trailing run,
 * whose work STARTS after the call, so it always observes the caller's state.
 * Requests are coalesced; the work each request asked for is never skipped.
 *
 * Ordering rule inside `call()`: test `next` BEFORE `running`. When the
 * in-flight run settles, its slot is cleared in a `.then` callback, and the
 * trailing run is promoted in a LATER microtask. A caller landing in that gap
 * sees `running === null` but `next !== null`; it must join `next`, never
 * start a second concurrent run.
 *
 * A slot is cleared only if it still holds the promise that settled (identity
 * check), so an older run can never clear a newer one.
 *
 * `pending()` returns the latest promise (`next` if queued, else `running`) and
 * is non-null for the whole of every run, including the trailing one, so a
 * guard that asks "is a save in flight?" from INSIDE the trailing run gets the
 * truthful answer.
 *
 * ⚠️ No re-entrancy: `run` (and anything it awaits) must never call `call()`
 * on the same instance. The call would join `next`, which waits for the very
 * run that is awaiting it: a deadlock.
 *
 * `onCoalesced(callers)` fires when a trailing run starts on behalf of two or
 * more callers. It is telemetry; a throw inside it is logged and swallowed so
 * it can never fail the run.
 */
export interface TrailingSingleFlight<A, R> {
  /** Request a run with `args`; resolves/rejects with the covering run. */
  call(args: A): Promise<R>;
  /** The latest promise (trailing if queued, else in-flight), or null when idle. */
  pending(): Promise<R> | null;
}

interface NextSlot<A, R> {
  promise: Promise<R>;
  args: A;
  callers: number;
}

const noop = (): void => {};

export function createTrailingSingleFlight<A, R>(
  run: (args: A) => Promise<R>,
  merge: (queued: A, incoming: A) => A,
  onCoalesced?: (callers: number) => void
): TrailingSingleFlight<A, R> {
  let running: Promise<R> | null = null;
  let next: NextSlot<A, R> | null = null;

  /** Invoke `run` synchronously; a synchronous throw becomes a rejection. */
  function start(args: A): Promise<R> {
    try {
      return run(args);
    } catch (e) {
      return Promise.reject(e);
    }
  }

  /** Clear `running` when `p` settles, but only if `p` is still the one in the slot. */
  function track(p: Promise<R>): Promise<R> {
    const clearIfSame = (): void => {
      if (running === p) running = null;
    };
    p.then(clearIfSame, clearIfSame);
    return p;
  }

  /** Move the queued slot into `running`, then start its run. */
  function promote(slot: NextSlot<A, R>): Promise<R> {
    next = null;
    running = slot.promise;
    if (slot.callers >= 2 && onCoalesced) {
      try {
        onCoalesced(slot.callers);
      } catch (e) {
        console.warn('[trailingSingleFlight] onCoalesced hook threw; run continues', e);
      }
    }
    return start(slot.args);
  }

  function call(args: A): Promise<R> {
    if (next) {
      next.args = merge(next.args, args);
      next.callers += 1;
      return next.promise;
    }
    if (running) {
      // Build the slot first so `promote` can close over it; the promise is
      // assigned once, before anyone can observe the slot.
      const slot: NextSlot<A, R> = {
        promise: undefined as unknown as Promise<R>,
        args,
        callers: 1,
      };
      slot.promise = running.then(noop, noop).then(() => promote(slot));
      next = slot;
      return track(slot.promise);
    }
    running = track(start(args));
    return running;
  }

  function pending(): Promise<R> | null {
    return next?.promise ?? running;
  }

  return { call, pending };
}
