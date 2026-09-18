/**
 * Routes an inbound `https://app.beanies.family/...` deep link into the Vue router.
 *
 * ⚠️ WITHOUT THIS, CLAIMING THE DOMAIN DOES NOTHING. Before this existed there were two
 * `appUrlOpen` listeners and both hard-filtered to their own URL shape: `googleAuth`'s
 * returns immediately unless the URL is an OAuth return, and `iosOpenInAdapter` handles
 * share-sheet files only. Anything else — an invite link, a magic link — was received by
 * the app and dropped on the floor. Adding the entitlement and the intent-filter without
 * this file would have produced the most confusing possible outcome: the app opens, and
 * then sits on whatever screen it was already on.
 *
 * Ordering matters. This is installed AFTER the OAuth listener and re-checks the OAuth
 * shape itself, so an OAuth return is never double-handled. Capacitor delivers the same
 * event to every listener; neither can assume it is the only one.
 */
import { App as CapacitorApp } from '@capacitor/app';
import { isNative } from '@/services/sync/capabilities';
import { logEvent } from '@/services/telemetry/logEvent';
import { captureHashMarkers, APPROVAL_LINK_HASH } from '@/services/auth/deepLinks';
import { reportError } from '@/utils/errorReporter';
import { nativeOAuthTransport } from '@/constants/nativeOAuth';

/** Paths we are willing to route from an external link. Anything else is ignored. */
const ROUTABLE_PREFIXES = ['/join', '/welcome'] as const;

/**
 * ⚠️ `getLaunchUrl` IS NOT COLD-START-ONLY, and treating it as such is a real bug.
 *
 * It returns the URL the PROCESS was launched with, and it keeps returning it for the
 * life of that process. The JS context, however, restarts on its own — a reload, memory
 * pressure, iOS reclaiming the webview — while the process lives on. Every one of those
 * restarts re-runs this module, reads the same hour-old invite URL, and routes a member
 * who is signed in and half way through their week straight back into the join flow.
 *
 * A module-level flag cannot fix it, because the thing that resets the flag is the same
 * thing that re-reads the URL. The marker has to outlive the JS context but NOT the
 * process, which is exactly `sessionStorage`'s lifetime.
 *
 * Keyed by the URL rather than a bare boolean so a genuinely different launch link is
 * still honoured. Storage can throw (private mode, blocked site data), and a throw must
 * degrade to today's behaviour — handling the link — rather than swallowing it.
 */
const LAUNCH_URL_CONSUMED_KEY = 'beanies.launchUrlConsumed';

function alreadyConsumed(url: string): boolean {
  try {
    return sessionStorage.getItem(LAUNCH_URL_CONSUMED_KEY) === url;
  } catch {
    return false; // storage unavailable — prefer handling the link over losing it
  }
}

function markConsumed(url: string): void {
  try {
    sessionStorage.setItem(LAUNCH_URL_CONSUMED_KEY, url);
  } catch {
    // Non-fatal: worst case the link replays on a reload, which is today's behaviour.
  }
}

/**
 * @param navigate injected so this stays router-free, matching `installNativeAuthListener`.
 */
export function installInboundLinkListener(navigate: (path: string) => void): void {
  if (!isNative()) return;

  function handle(url: string): void {
    try {
      // OAuth belongs to `googleAuth`'s listener. Same event, two handlers — say so
      // rather than relying on registration order.
      if (nativeOAuthTransport(url)) return;

      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        // A malformed URL is not actionable and not worth paging anyone over, but a
        // silent return is how "the link did nothing" becomes untriageable.
        logEvent({
          level: 'warn',
          surface: 'login-flow',
          message: 'inbound link was not a parseable URL',
          context: { action: 'inbound_link_unparseable' },
        });
        return;
      }

      // Only our own app origin. A custom-scheme or third-party URL routed straight into
      // the router is an open redirect with extra steps.
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'app.beanies.family') return;
      if (!ROUTABLE_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix))) {
        logEvent({
          level: 'info',
          surface: 'login-flow',
          message: 'inbound link path not routable; ignored',
          context: { action: 'inbound_link_ignored' },
        });
        return;
      }

      // ⚠️ AFTER the origin and path checks, never before them. A warm open re-runs no
      // lifecycle, so this is the only place a running app would notice the fragment — but
      // capturing above the allowlist meant a URL the bridge then REJECTED as untrusted
      // could still plant an approval key for the next in-app navigation to pick up. The
      // whole point of those checks is that an untrusted URL drives no app state.
      captureHashMarkers([APPROVAL_LINK_HASH], url);

      logEvent({
        level: 'info',
        surface: 'login-flow',
        message: 'inbound link routed',
        // ⚠️ Path only — NEVER the search string. It carries the token.
        context: { action: 'inbound_link_routed', route_path: parsed.pathname },
      });
      navigate(`${parsed.pathname}${parsed.search}${parsed.hash}`);
    } catch (e) {
      reportError({
        surface: 'login-flow',
        message: 'inbound link handler threw',
        severity: 'error',
        error: e,
      });
    }
  }

  void CapacitorApp.addListener('appUrlOpen', ({ url }) => handle(url));

  // ⚠️ A COLD LAUNCH NEVER REACHES THE LISTENER, and the retained-event fallback cannot
  // save it either. Capacitor flushes a retained `appUrlOpen` to the FIRST listener only
  // and removes it from the queue on the way — and the first listener is
  // `installNativeAuthListener`, registered a few lines earlier in App.vue. It sees an
  // invite URL, `nativeOAuthTransport` returns null, it returns, and the event is gone.
  //
  // This matters more than the warm case: the primary magic-link scenario IS a cold
  // launch — new phone, app installed but not running, tap the link in WhatsApp. Warm
  // taps work, so hand-testing on a device that is already open would never show it.
  // `iosOpenInAdapter` in this same directory already carries this exact fix and the
  // comment explaining why.
  void CapacitorApp.getLaunchUrl()
    .then((launch) => {
      if (!launch?.url) return;
      if (alreadyConsumed(launch.url)) {
        logEvent({
          level: 'info',
          surface: 'login-flow',
          message: 'launch url already consumed; not replaying',
          context: { action: 'launch_url_replay_suppressed' },
        });
        return;
      }
      markConsumed(launch.url);
      handle(launch.url);
    })
    .catch((e) =>
      reportError({
        surface: 'login-flow',
        message: 'could not read the launch url; a cold-start link open is lost',
        severity: 'warning',
        error: e,
        context: { action: 'launch_url_failed' },
      })
    );
}
