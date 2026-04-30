import { watch, onScopeDispose, getCurrentScope } from 'vue';
import { useToday } from './useToday';
import { reportError } from '@/utils/errorReporter';

/**
 * Generic primitive: invoke `callback` every `intervalMs` while the document
 * is visible, optionally firing once immediately on each hidden→visible
 * transition. Stops cleanly when hidden so idle background tabs don't burn
 * cycles.
 *
 * Builds on `useToday().isVisible` — the app's singleton visibility sink —
 * so this composable never registers its own `visibilitychange` listener.
 * Adding more pollers therefore costs zero additional event-listener load.
 *
 * Callback failures are caught + reported (`[usePollWhileVisible]` console
 * + `reportError`) but never propagate — a throwing callback never kills
 * the loop. The caller's responsibility is the work itself; this primitive
 * guarantees the cadence and the cleanup.
 *
 * Returns `{ stop }` for explicit teardown (e.g. when a service swaps the
 * thing being polled). When called inside an effect scope (Vue setup or a
 * manual `effectScope`), auto-stops on scope dispose; explicit `stop()` is
 * idempotent.
 *
 * @example
 *   // Inside a service: poll while a local-file provider is active.
 *   const watcher = usePollWhileVisible(
 *     () => fetchAndMergeRemote(),
 *     15_000,
 *     { fireImmediatelyOnVisible: true }
 *   );
 *   // Later, when provider swaps:
 *   watcher.stop();
 */
export interface PollWhileVisibleOptions {
  /**
   * Fire `callback` once each time visibility becomes visible — including
   * the initial mount if the tab is already visible. Use this when the
   * caller wants "catch up immediately on become-visible, then poll on
   * the regular cadence". Omit (default false) for "interval ticks only".
   */
  fireImmediatelyOnVisible?: boolean;
  /**
   * Surface name passed to `reportError` when the callback throws. Default:
   * `'poll-while-visible'`. Set this for clearer Slack telemetry buckets.
   */
  surface?: string;
}

export interface PollWhileVisibleHandle {
  /** Stop the loop. Idempotent. Auto-called on scope dispose. */
  stop: () => void;
}

export function usePollWhileVisible(
  callback: () => Promise<void> | void,
  intervalMs: number,
  options: PollWhileVisibleOptions = {}
): PollWhileVisibleHandle {
  const { fireImmediatelyOnVisible = false, surface = 'poll-while-visible' } = options;
  const { isVisible } = useToday();

  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  async function safeRun(): Promise<void> {
    try {
      await callback();
    } catch (e) {
      // A throwing callback must never kill the loop or propagate. Log
      // with [usePollWhileVisible] for dev diagnostics and report so the
      // failure shows up in `#beanies-errors`.
      console.warn(`[usePollWhileVisible] callback threw (${surface})`, e);
      reportError({
        surface,
        message: 'poll callback threw',
        error: e,
        severity: 'warning',
        context: { action: 'poll' },
      });
    }
  }

  function startInterval(): void {
    if (stopped || timer !== null) return;
    timer = setInterval(() => {
      void safeRun();
    }, intervalMs);
  }

  function stopInterval(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  // Watch the singleton visibility ref. `immediate: true` so we start the
  // interval right away if the tab is already visible at registration.
  const stopWatcher = watch(
    isVisible,
    (visible, prev) => {
      if (visible) {
        // hidden→visible transition (or initial mount while visible)
        if (fireImmediatelyOnVisible && prev !== true) {
          void safeRun();
        }
        startInterval();
      } else {
        stopInterval();
      }
    },
    { immediate: true }
  );

  function stop(): void {
    if (stopped) return;
    stopped = true;
    stopInterval();
    stopWatcher();
  }

  // Auto-stop on scope dispose (Vue setup or any manual effectScope).
  // Falls through silently if there's no active scope (e.g. called from a
  // plain service module) — caller must invoke stop() explicitly.
  if (getCurrentScope()) {
    onScopeDispose(stop);
  }

  return { stop };
}
