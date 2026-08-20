/**
 * Plausible analytics — privacy-friendly, gated on VITE_PLAUSIBLE_DOMAIN.
 *
 * No-op silently when the env var is unset (vanilla self-host stays fully
 * offline by default). Replaces the static <script> tag that previously lived
 * in index.html, which leaked self-host page views to greg's Plausible site.
 *
 * Failure handling: every path logs `[analytics]` prefix + Error. Analytics
 * is non-critical — it never blocks the app, and we never toast users about
 * it.
 */

import { features } from '@/config/features';

export function initAnalytics(): void {
  if (!features.analytics) return;

  try {
    const queue: PlausibleQueue =
      window.plausible ??
      (function (...args: unknown[]) {
        (queue.q = queue.q ?? []).push(args);
      } as PlausibleQueue);
    queue.init =
      queue.init ??
      function (i: object) {
        queue.o = i || {};
      };
    window.plausible = queue;
    queue.init({});

    const domain = import.meta.env.VITE_PLAUSIBLE_DOMAIN;
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://plausible.io/js/pa-${domain}.js`;
    script.onerror = (err) => {
      console.warn(
        '[analytics] Plausible script failed to load — analytics disabled for this session.',
        { domain, err }
      );
    };
    document.head.appendChild(script);
  } catch (err) {
    console.warn(
      '[analytics] failed to initialize Plausible — analytics disabled for this session.',
      err
    );
  }
}

// ─── Temporary suppression ───────────────────────────────────────────────────
//
// Every analytics call site in the app is a bare `window.plausible?.('event')` —
// there is no central `track()` wrapper to gate. So suppressing events for one
// code path genuinely requires swapping the global, and that swap belongs HERE,
// in the module that owns and installs it, rather than hidden inside whichever
// feature happens to need it. A global mutation buried in a feature module is
// invisible to anyone auditing what the app reports.

let suppressDepth = 0;
let savedPlausible: PlausibleQueue | undefined;
let plausibleWasPresent = false;

const noopPlausible = (() => {}) as unknown as PlausibleQueue;

/**
 * Run `fn` with `window.plausible` swapped for a no-op, restoring it afterwards.
 *
 * The only sanctioned way to suppress analytics for a code path. Used by demo-mode
 * seeding, which drives the real sign-up flow and would otherwise push fake
 * `signup` / `login` conversions into Plausible on every reviewer tap.
 *
 * Re-entrant: nested calls share one saved original and restore exactly once.
 *
 * Restores ABSENCE faithfully. When analytics is off (`VITE_PLAUSIBLE_DOMAIN`
 * unset — which is the case on BOTH mobile release lanes, where it is an explicit
 * exemption in the workflow env-parity test) `window.plausible` is `undefined`.
 * Assigning the saved value back would leave an installed no-op function where
 * there had been nothing, so `window.plausible?.()` would start succeeding into
 * a black hole instead of short-circuiting. Hence the `delete`.
 *
 * Limitation: this suppresses calls made synchronously or awaited inside `fn`.
 * An event fired from a `setTimeout` scheduled inside `fn` but running after it
 * returns will still land. No such call exists on the demo-seed path.
 */
export async function withAnalyticsSuppressed<T>(fn: () => Promise<T>): Promise<T> {
  if (suppressDepth++ === 0) {
    plausibleWasPresent = 'plausible' in window;
    savedPlausible = window.plausible;
    window.plausible = noopPlausible;
  }
  try {
    return await fn();
  } finally {
    if (--suppressDepth === 0) {
      if (plausibleWasPresent) {
        window.plausible = savedPlausible;
      } else {
        delete window.plausible;
      }
      savedPlausible = undefined;
    }
  }
}
