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
import { getPlatform } from '@/services/sync/capabilities';
import { isDemoSession } from '@/utils/reviewDemo';
import { logEvent } from '@/services/telemetry/logEvent';

/**
 * ── The event registry (#71) ────────────────────────────────────────────────
 *
 * ONE declaration, not two. An `AnalyticsEvent` union plus a separate
 * `PASSIVE_EVENTS` set would mean adding an event takes two edits and only one
 * is compiler-enforced — so "someone adds an auto-fired event and forgets to
 * mark it passive" stays possible, it just moves from a forgotten flag to a
 * forgotten Set entry. A record makes it structurally impossible: you cannot
 * add a key without giving it a value.
 *
 * `'passive'` means THE APP FIRES IT BY ITSELF. Those go to Plausible with
 * `interactive: false`, or they count as engagement and collapse bounce rate
 * toward 0% — which is exactly what happened before #71 (1% bounce at 1.7
 * pages/visit). A `*_dismissed` event is a genuine user click and stays
 * interactive.
 */
export const ANALYTICS_EVENTS = {
  // CONSUMED BY THE DASHBOARD — renaming or removing one of these three
  // silently blanks a panel in .claude/skills/early-adopter-metrics with no
  // error anywhere. See references/data-sources.md.
  signup: 'interactive',
  login: 'interactive',
  feature_used: 'interactive',

  admin_password_reset: 'interactive',
  member_joined: 'interactive',
  invite_request_click: 'interactive',
  create_pod_click: 'interactive',
  discord_join_click: 'interactive',
  family_deleted: 'interactive',
  install_nudge_dismissed: 'interactive',
  pwa_stale_dismissed: 'interactive',
  pwa_stale_install_clicked: 'interactive',
  community_nudge_dismissed: 'interactive',

  // Fired by the app, not the user.
  storage_persist_denied: 'passive',
  install_nudge_shown: 'passive',
  pwa_stale_detected: 'passive',
  community_nudge_shown: 'passive',
} as const;

export type AnalyticsEvent = keyof typeof ANALYTICS_EVENTS;

/** The curated feature vocabulary for `feature_used` (#71). */
export type FeatureName =
  | 'transaction'
  | 'budget'
  | 'vacation'
  | 'goal'
  | 'activity'
  | 'list'
  | 'todo'
  | 'meal_plan'
  | 'recipe'
  | 'account'
  | 'asset'
  | 'milestone'
  | 'photo'
  | 'medication'
  | 'emergency_contact'
  | 'saying';

/**
 * Bounded prop KEYS (values stay free-form) so Plausible's property namespace
 * cannot sprawl. `platform` is deliberately absent from the PUBLIC signature —
 * the seam adds it, and no call site may pass it by hand.
 */
type PublicPropKey = 'feature' | 'method' | 'action' | 'surface';

/**
 * The ONE way the app reports an analytics event.
 *
 * Attaches `platform` centrally, derives `interactive` from the registry above
 * (so a call site can never contradict it), suppresses the store-review demo
 * session, and never throws — analytics is non-critical and must not be able to
 * break a user action.
 */
export function track(
  event: AnalyticsEvent,
  opts?: { props?: Partial<Record<PublicPropKey, string>> }
): void {
  // The review-demo build IS a production release build (the same two mobile
  // lanes carry both the demo gate and the Plausible domain), so without this
  // every tap an App Store or Play reviewer makes in the demo pod would land in
  // the real property — against a dataset small enough that one person matters.
  if (isDemoSession.value) return;

  try {
    // Not memoized: `Capacitor.getPlatform()` is a synchronous property read, so
    // a module-level cache saves nothing measurable while adding hidden mutable
    // state that makes the per-platform tests unreliable.
    let platform = 'web';
    try {
      platform = getPlatform();
    } catch {
      // Detection must never break reporting — mirrors `platformLabel.ts`.
    }
    window.plausible?.(event, {
      props: { ...(opts?.props ?? {}), platform },
      interactive: ANALYTICS_EVENTS[event] === 'interactive',
    });
  } catch (err) {
    // console.warn alone is invisible in production; the logEvent is what makes
    // "did we stop reporting, or did nobody use the feature?" answerable.
    console.warn('[analytics] failed to report an event', { event, err });
    logEvent({
      level: 'warn',
      surface: 'analytics',
      message: 'track-failed',
      context: { action: event },
    });
  }
}

/**
 * Report a feature as used, passing the store action's result straight through.
 *
 * Lives at the CALLER, not inside `wrapAsync`: a store action can be reached
 * from several places with different intent (`familyStore.createMember` is
 * called from the signup path as well as the UI), and adoption should count the
 * user-initiated one. Keeping the guard here also makes fire-on-failure
 * structurally impossible — every target create action returns `X | null`.
 */
export function trackFeature<T>(result: T, feature: FeatureName): T {
  if (result !== undefined && result !== null) track('feature_used', { props: { feature } });
  return result;
}

export function initAnalytics(): void {
  if (!features.analytics) {
    // Report ONLY the anomalous branch. Logging the healthy case would fire on
    // every boot for every user and distort the by-surface counts it feeds —
    // and Plausible's own data already proves the healthy case. This is the
    // event that would have caught #71's signup gap (native builds silently
    // shipping with no analytics) in a day rather than a month; the platform
    // rides in `action` so it can actually answer that question.
    let platform = 'web';
    try {
      platform = getPlatform();
    } catch {
      /* detection is best-effort */
    }
    logEvent({
      level: 'warn',
      surface: 'analytics',
      message: 'analytics-init',
      context: { action: `disabled-no-domain:${platform}` },
    });
    return;
  }

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
// `track()` above is the app's single reporting seam, and the review-demo
// session is suppressed there. This global swap remains for the SEEDING path:
// `demoSeed` drives the real sign-up flow, whose events would otherwise be
// reported before a demo session is even established. The swap belongs HERE, in
// the module that owns and installs the global, rather than hidden inside
// whichever feature happens to need it — a global mutation buried in a feature
// module is invisible to anyone auditing what the app reports.

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
 * unset — self-host and dev builds; as of #71 the mobile release lanes DO carry
 * it, and the env-parity exemption that used to allow otherwise is gone)
 * `window.plausible` is `undefined`.
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
