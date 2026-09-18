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
import { readHashMarker, APPROVAL_LINK_HASH } from '@/services/auth/deepLinks';
import { emitApprovalKeyDropped, type DeliveryKind } from '@/services/telemetry/deepLinkEvents';
import { reportError } from '@/utils/errorReporter';
import { nativeOAuthTransport } from '@/constants/nativeOAuth';

/**
 * Paths we are willing to route from an external link. Anything else is ignored.
 *
 * ⚠️ EXACT MATCH, DELIBERATELY — not a prefix, and not `isRouteActive`.
 *
 * A bare `startsWith` accepts `/joinery` and `/welcome-evil`. But segment-boundary prefix
 * matching is wrong here too, in the other direction: it admits `/welcome/anything`, and
 * this file has TWO gates reading the same path (the routing allowlist, and the approval
 * marker gate below). When those two disagree — as they did, one accepting `/welcome/` and
 * the other requiring an exact `/welcome` — a link routes, has its fragment stripped, and
 * delivers nothing at all, silently.
 *
 * `/welcome` and `/join` are flat routes with no children, so descendant matching buys
 * nothing. Exact matching makes both gates the same comparison BY CONSTRUCTION rather than
 * by a shared helper someone has to remember to keep shared — and it keeps `utils/route.ts`
 * (a nav-highlighting helper) out of a security decision, where a future "make nav matching
 * more forgiving" change would silently widen an auth boundary.
 */
const ROUTABLE_PATHS = new Set(['/join', '/welcome']);

/** Trailing slashes are cosmetic in a URL someone typed or a QR encoded; normalise once. */
function normalisePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

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
 * @param onApprovalKey injected for the same reason, and it is what makes a device-approval
 *   scan work at all.
 *
 *   ⚠️ DO NOT REPLACE THIS WITH A ROUTE-CHANGE NOTIFICATION. That is what shipped broken in
 *   0.21.3. The old path captured the key and navigated to `/welcome`, expecting a watcher
 *   on `route.fullPath` to notice — but the scanner is SIGNED IN, so `router.beforeEach`
 *   redirects `/welcome` to the Nook by name, and a phone already sitting on `/nook` sees
 *   the identical path on both sides. The watcher never fired and the key was orphaned.
 *
 *   Delivering through an injected callback also removes the cold-launch race rather than
 *   repairing it: the callback is bound before `getLaunchUrl()` below is even called, so
 *   there is no window in which a key can arrive before a consumer exists.
 */
export function installInboundLinkListener(
  navigate: (path: string) => void,
  onApprovalKey: (key: string, delivery: DeliveryKind) => void
): void {
  if (!isNative()) return;

  function handle(url: string, delivery: DeliveryKind): void {
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
      const path = normalisePath(parsed.pathname);
      if (!ROUTABLE_PATHS.has(path)) {
        logEvent({
          level: 'info',
          surface: 'login-flow',
          message: 'inbound link path not routable; ignored',
          context: { action: 'inbound_link_ignored' },
        });
        return;
      }

      // ⚠️ EVERYTHING BELOW IS AFTER the origin and path checks, never before them. An
      // untrusted URL must drive no app state at all — not a navigation and above all not
      // an approval key.
      //
      // ⚠️ `markConsumed` is deliberately NOT called here. It writes a SINGLE sessionStorage
      // slot that the launch-URL replay guard reads, so marking every warm link would evict
      // the launch URL from that slot and re-arm the very replay the guard exists to stop
      // (see the docblock above it). The launch path does its own marking.

      // A device-approval scan.
      //
      // ⚠️ `/welcome` ONLY, not every routable path. This narrows the surface: an approval
      // marker riding on `/join` would raise the approval sheet over a join flow, which is
      // a more convincing place to land someone than a bare welcome gate.
      //
      // ⚠️ IT DOES NOT ESTABLISH THAT THE CODE WAS SCANNED. Do not read it as closing
      // tap-phishing, because it does not: `/welcome` is a VERIFIED App Link
      // (`AndroidManifest.xml` `autoVerify="true"`) and Universal Link (AASA), and on iOS a
      // camera scan opens a URL through that same mechanism. A link tapped in Messages is
      // therefore byte-identical here to a code deliberately scanned, and the OS gives us
      // no provenance to tell them apart. The only real defence remains the human
      // fingerprint comparison in `DeviceApprovalSheet`. Closing that gap needs a
      // provenance binding (an app-issued nonce, or reaching the sheet only from an in-app
      // "approve a device" entry point) and is NOT solved by this path check.
      //
      // ⚠️ APPROVAL ONLY, DELIBERATELY — `KIT_LINK_HASH` is NOT handled here. A recovery
      // kit is redeemed on a device that is by definition SIGNED OUT, so `/welcome` is not
      // redirected, `LoginPage` actually mounts, and it reads the marker straight off
      // `window.location.hash` itself. The failure this file exists to fix cannot occur
      // for kit, because its precondition is being signed in. Adding kit here would create
      // a SECOND consumer racing LoginPage for a once-only value, i.e. a good chance of
      // breaking a working flow.
      //
      // Known residual gap, recorded rather than silently half-closed: a WARM native kit
      // scan (app already running, signed out) is not delivered by anything. Not reachable
      // in the common path, since a cold device is by definition not running the app.
      const hasApprovalMarker = parsed.hash.includes(APPROVAL_LINK_HASH);
      if (hasApprovalMarker && path !== '/welcome') {
        // Routable, but not a path an approval may arrive on. The fragment is dropped below;
        // say so, or a marker stripped here looks identical to nobody scanning anything.
        emitApprovalKeyDropped({ delivery, errorCode: 'path-not-eligible' });
      }
      const approvalKey =
        path === '/welcome' ? readHashMarker(parsed.hash, APPROVAL_LINK_HASH) : null;
      if (approvalKey === '') {
        // `readHashMarker` distinguishes null (no marker) from '' (marker, empty value), and
        // a truncated link or a partial QR scan lands here. Dropping it silently would look
        // identical to "nobody scanned anything" in CloudWatch, which is the exact blind
        // spot this surface exists to close.
        emitApprovalKeyDropped({ delivery, errorCode: 'empty-key' });
      }
      if (approvalKey) {
        try {
          // ⚠️ The consumer emits `approval_key_delivered`, NOT this call site. Delivery here
          // only means "handed over"; the consumer may legitimately hold the key until the
          // pod is open, and counting that as delivered would make the success metric count
          // buffering — reproducing the blind spot that let 0.21.3 look healthy.
          onApprovalKey(approvalKey, delivery);
        } catch (e) {
          // The key is gone by the time we get here and only the user can retry, so this
          // must never be swallowed.
          emitApprovalKeyDropped({ delivery, errorCode: 'consumer-threw' });
          reportError({
            surface: 'deep-link',
            message: 'device-approval consumer threw; the scan is lost and the user must re-scan',
            severity: 'error',
            error: e,
            // NOT `approval_key_dropped` — `reportError` routes through `logEvent` on the
            // caller's surface, so reusing that action writes two `deep-link` records with
            // the same action for one failure and doubles the apparent rate.
            context: { action: 'approval_consumer_error' },
          });
        }
      }

      logEvent({
        level: 'info',
        surface: 'login-flow',
        message: 'inbound link routed',
        // ⚠️ Path only — NEVER the search string. It carries the token.
        context: { action: 'inbound_link_routed', route_path: parsed.pathname },
      });
      // ⚠️ STRIP ONLY THE APPROVAL MARKER, AND FORWARD THE REST.
      //
      // Dropping the whole fragment here broke the printed recovery kit: its QR is
      // `/welcome#beanies-kit=<code>` (`recoveryKit.ts:123`), `/welcome` is a verified App
      // Link, so scanning it on a phone with beanies installed opens the APP and this
      // bridge is the only route in — and `LoginPage` reads that marker straight off
      // `window.location.hash`, which `navigate` is what populates. Stripping it sent
      // someone restoring on a new device to a blank welcome gate to hand-type their kit
      // code, on BOTH the warm and cold paths.
      //
      // The approval marker still must not ride along: it has already been consumed above,
      // `isSameOriginReturnPath` accepts fragments, and analytics autocapture scrubs query
      // params but not the hash.
      //
      // ⚠️ Keyed on the MARKER BEING PRESENT, not on whether we consumed it. On `/join` the
      // marker is deliberately not read, so `approvalKey` is null there — and forwarding on
      // that basis would have put an attacker-supplied key straight into `location.href`,
      // which is the opposite of the intent. A test caught exactly that.
      const forwardedHash = parsed.hash.includes(APPROVAL_LINK_HASH) ? '' : parsed.hash;
      navigate(`${parsed.pathname}${parsed.search}${forwardedHash}`);
    } catch (e) {
      reportError({
        surface: 'login-flow',
        message: 'inbound link handler threw',
        severity: 'error',
        error: e,
      });
    }
  }

  void CapacitorApp.addListener('appUrlOpen', ({ url }) => handle(url, 'warm'));

  // ⚠️ A COLD LAUNCH NEVER REACHES THE LISTENER, and the retained-event fallback cannot
  // save it either. Capacitor flushes a retained `appUrlOpen` to the FIRST listener only
  // and removes it from the queue on the way — and the first listener is
  // `installNativeAuthListener`, registered a few lines earlier in App.vue. It sees an
  // invite URL, `nativeOAuthTransport` returns null, it returns, and the event is gone.
  //
  // This matters more than the warm case FOR MAGIC LINKS: the primary magic-link scenario
  // IS a cold launch — new phone, app installed but not running, tap the link in WhatsApp.
  // A warm magic-link tap works, because `/join` is excluded from the already-signed-in
  // redirect, so hand-testing on a device that is already open would never show it.
  // `iosOpenInAdapter` in this same directory already carries this exact fix and the
  // comment explaining why.
  //
  // ⚠️ THAT "WARM TAPS WORK" CLAIM WAS NEVER TRUE FOR DEVICE APPROVAL, and reading it as
  // though it were is what let 0.21.3 ship broken on every native device. Approval links
  // point at `/welcome`, which IS redirected for a signed-in user, and the old consumer
  // inferred delivery from a route change that therefore never happened. Both halves are
  // fixed by `onApprovalKey` being called directly from `handle()` above: warm delivery no
  // longer depends on routing, and cold delivery no longer races the app's first render,
  // because the callback is already bound when this runs.
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
      handle(launch.url, 'cold-launch');
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
