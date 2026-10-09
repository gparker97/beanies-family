import { reportError } from '@/utils/errorReporter';

/**
 * The debounced, single-flight reconcile loop shared by unattended writers
 * (the card-reminders orchestrator, the to-do auto-roll).
 *
 * It is the hand-rolled pattern in `useHelpfulHints` / `useLocalNotifications`
 * lifted as-is:
 *   - `queue()` clears and re-arms the debounce timer, so a burst of triggers
 *     coalesces into one run.
 *   - Only one run is ever in flight. A trigger that arrives during a run sets
 *     `rerunQueued`, and the run re-queues ONCE when it settles, so a change
 *     made mid-run is never lost and overlapping runs never interleave.
 *   - A throw is caught and reported (`severity: 'error'`). Vue stops
 *     re-running a watcher whose effect throws, so an unguarded run would
 *     silently disable the loop for the session; here the next trigger runs
 *     again as normal.
 *
 * `runNow()` skips the debounce (for an explicit "do it now" path such as a
 * load or a test). When a run is already in flight it marks the rerun and
 * returns the in-flight promise instead of starting a second run. The returned
 * promise never rejects.
 *
 * `reset()` clears the timer and both flags; it backs the module-level
 * `__reset...ForTesting` helpers of the loop's owners.
 */
export interface ReconcileLoopOptions {
  /** Quiet period after the last `queue()` before a run starts. */
  debounceMs: number;
  /** The reconcile body. May be sync or async; a throw or rejection is reported. */
  run: () => unknown;
  /** kebab-case telemetry surface for the failure report. */
  surface: string;
  /** Human-readable message for the failure report. */
  failureMessage: string;
}

export interface ReconcileLoop {
  /** Debounced trigger: (re)arms the timer. */
  queue(): void;
  /** Immediate trigger: runs now, or joins (and queues one rerun after) the run in flight. */
  runNow(): Promise<void>;
  /** Clear the pending timer and the in-flight / rerun state. */
  reset(): void;
}

export function createReconcileLoop(options: ReconcileLoopOptions): ReconcileLoop {
  const { debounceMs, run, surface, failureMessage } = options;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | null = null;
  let rerunQueued = false;

  function clearTimer(): void {
    if (debounce) clearTimeout(debounce);
    debounce = undefined;
  }

  function queue(): void {
    clearTimer();
    debounce = setTimeout(() => {
      debounce = undefined;
      void runNow();
    }, debounceMs);
  }

  function runNow(): Promise<void> {
    // A run starting now covers whatever a pending debounced trigger asked for.
    clearTimer();
    if (inFlight) {
      rerunQueued = true;
      return inFlight;
    }
    // `run` is started from a microtask so `inFlight` is assigned before any of
    // its code (including a synchronous throw) can settle the run.
    const current: Promise<void> = Promise.resolve()
      .then(run)
      .then(
        () => undefined,
        (error: unknown) => {
          reportError({ surface, severity: 'error', message: failureMessage, error });
        }
      )
      .finally(() => {
        // A `reset()` mid-run hands the loop to a new run; this one must not
        // clear that run's state or queue on its behalf.
        if (inFlight !== current) return;
        inFlight = null;
        if (rerunQueued) {
          rerunQueued = false;
          queue();
        }
      });
    inFlight = current;
    return current;
  }

  function reset(): void {
    clearTimer();
    inFlight = null;
    rerunQueued = false;
  }

  return { queue, runNow, reset };
}
