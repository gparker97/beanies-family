/**
 * Resolve an element that is about to render, or `null` once `timeoutMs` has passed without it.
 *
 * For flows that change state and then need the element that state draws: a view that moves to
 * another period renders over a tick or two, and the mobile month stream mounts several months
 * progressively, so a single `nextTick` lookup misses often enough to matter. `find` runs once
 * per animation frame (a 16ms timer where there are no frames, e.g. a test DOM) until it returns
 * an element or the deadline passes. Never throws: a `find` that throws counts as "not yet".
 */
export function waitForElement(
  find: () => HTMLElement | null | undefined,
  timeoutMs: number
): Promise<HTMLElement | null> {
  const deadline = Date.now() + timeoutMs;
  const nextFrame: (cb: () => void) => void =
    typeof requestAnimationFrame === 'function'
      ? (cb) => requestAnimationFrame(() => cb())
      : (cb) => setTimeout(cb, 16);

  return new Promise((resolve) => {
    const attempt = () => {
      let el: HTMLElement | null | undefined = null;
      try {
        el = find();
      } catch (err) {
        // A finder that throws (a detached root, a bad selector) is treated as a miss and
        // retried; the caller logs the final miss, so this stays a console-level note.
        console.warn('[waitForElement] finder threw; retrying until the deadline', err);
      }
      if (el) return resolve(el);
      if (Date.now() >= deadline) return resolve(null);
      nextFrame(attempt);
    };
    attempt();
  });
}

export interface ScrollSettleOptions {
  /** How long to wait for a scroll to START before deciding none is coming. */
  startWithinMs: number;
  /** The most a started scroll is waited on, in case neither end signal ever arrives. */
  maxMs: number;
  /** A started scroll counts as settled after this long with no further `scroll` event. */
  quietMs?: number;
}

/** What ended the wait, for the caller's logs. */
export type ScrollSettleOutcome = 'no_scroll' | 'scrollend' | 'quiet' | 'timeout';

/**
 * Resolve once a scroll that another part of the page is about to start on `scroller` has
 * finished, so a follow-up scroll is not cancelled by it (a smooth `scrollTo` started after ours
 * replaces ours).
 *
 * The signal is the scroller's own events, not a guessed delay: the `scrollend` event where the
 * engine has it, else the first `quietMs` gap between `scroll` events (WebKit shipped `scrollend`
 * late, and the iOS app runs on it). Bounded both ways: when no scroll starts within
 * `startWithinMs` nothing is coming, and a started one is never waited on past `maxMs`. A null
 * scroller resolves at once. Never rejects.
 */
export function waitForScrollSettle(
  scroller: HTMLElement | null | undefined,
  { startWithinMs, maxMs, quietMs = 150 }: ScrollSettleOptions
): Promise<ScrollSettleOutcome> {
  if (!scroller) return Promise.resolve('no_scroll');
  return new Promise((resolve) => {
    const listeners = new AbortController();
    const timers: {
      start?: ReturnType<typeof setTimeout>;
      max?: ReturnType<typeof setTimeout>;
      quiet?: ReturnType<typeof setTimeout>;
    } = {};
    let finished = false;
    const finish = (outcome: ScrollSettleOutcome) => {
      if (finished) return;
      finished = true;
      listeners.abort();
      clearTimeout(timers.start);
      clearTimeout(timers.max);
      clearTimeout(timers.quiet);
      resolve(outcome);
    };
    timers.start = setTimeout(() => finish('no_scroll'), startWithinMs);
    timers.max = setTimeout(() => finish('timeout'), maxMs);
    scroller.addEventListener(
      'scroll',
      () => {
        clearTimeout(timers.start);
        clearTimeout(timers.quiet);
        timers.quiet = setTimeout(() => finish('quiet'), quietMs);
      },
      { signal: listeners.signal, passive: true }
    );
    scroller.addEventListener('scrollend', () => finish('scrollend'), {
      signal: listeners.signal,
    });
  });
}
