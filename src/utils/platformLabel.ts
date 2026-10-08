/**
 * Human-readable platform / device labels for operational telemetry
 * (the new-joiner Slack pings, and — since #98 — the diagnostic firehose via
 * `platformContext()` below). NOT user-facing UI — these strings go to
 * Slack/CloudWatch, so they are intentionally un-translated.
 *
 * Reuses the canonical platform seam in `services/sync/capabilities.ts`
 * (`isNative` / `getPlatform` / `isStandalone` / `isIosOrIpadOs`) — the ONE
 * place native↔web detection lives (ADR-029). This module only adds a light
 * UA parse for browser/OS names, which no existing helper provides.
 *
 * ONE UI CONSUMER (#128): `isDesktopBrowser()` below gates the creation flow's
 * "Use beanies on your phone too" line. It lives here, not in `capabilities.ts`,
 * because this module already imports from there (exporting it from
 * `capabilities.ts` would be a cycle), and because `formFactor` must stay the
 * ONLY UA form-factor regex in the app.
 */

import { getPlatform, isNative, isStandalone, isIosOrIpadOs } from '@/services/sync/capabilities';

/**
 * Coarse surface bucket for at-a-glance filtering.
 *
 * This is a SLACK-ONLY vocabulary. The analytics + registry vocabulary is
 * `getPlatform()`'s `'web' | 'ios' | 'android'` (see `track()` in
 * `services/analytics/plausible.ts` and `RegistryEntry.signupPlatform`) — do not
 * cross the two, and do not introduce a third.
 */
export type PlatformLabel = 'app' | 'pwa' | 'web';

/**
 * Coarse platform: the native shell (`app`), an installed/standalone PWA
 * (`pwa`), or an ordinary browser tab (`web`).
 */
export function getPlatformLabel(): PlatformLabel {
  try {
    if (isNative()) return 'app';
    if (isStandalone()) return 'pwa';
    return 'web';
  } catch {
    // Best-effort telemetry only: these labels ride a fire-and-forget Slack
    // ping in the pod-creation path, so a detection failure must never throw
    // into that critical flow. Fall back to a neutral bucket.
    return 'web';
  }
}

function userAgent(): string {
  return typeof navigator === 'undefined' ? '' : (navigator.userAgent ?? '');
}

/**
 * Best-effort browser family from the UA string. Order matters: Edge/Opera/
 * Samsung all also contain "Chrome", so they must be tested first.
 */
function browserName(ua: string): string {
  if (/Edg\//.test(ua)) return 'edge';
  if (/OPR\/|Opera/.test(ua)) return 'opera';
  if (/SamsungBrowser/.test(ua)) return 'samsung';
  if (/Firefox\/|FxiOS/.test(ua)) return 'firefox';
  // Chrome/Chromium (and Chrome on iOS, "CriOS") — after the Chromium-based
  // forks above have been ruled out.
  if (/Chrome\/|CriOS|Chromium/.test(ua)) return 'chrome';
  // Safari must come last: every iOS browser's UA contains "Safari".
  if (/Safari\//.test(ua)) return 'safari';
  return 'browser';
}

/**
 * Form factor / OS for the web + PWA case. Desktop OSes collapse to the single
 * token `desktop` (matches how these read in Slack: "chrome desktop"); mobile
 * OSes keep their name so "chrome android" / "safari ios" stay distinguishable.
 */
function formFactor(ua: string): string {
  if (/Android/.test(ua)) return 'android';
  if (isIosOrIpadOs()) return 'ios';
  if (/Windows|Macintosh|Mac OS X|Linux|CrOS/.test(ua)) return 'desktop';
  return 'device';
}

/**
 * True on an ordinary desktop browser (a tab or an installed desktop PWA), false in
 * the native shell and on any phone or tablet browser (`formFactor` already buckets
 * iPadOS as `ios`). Deliberately NOT viewport-width based: a narrow desktop window is
 * still a desktop with no phone in hand, which is the question the caller asks.
 * Never throws (a detection failure answers `false`, the safe "hide the extra" side).
 *
 * ⚠️ `console.warn`, NOT `logEvent`/`reportError`: telemetry imports this module
 * (`logEvent` → `diagnosticContext` → `platformLabel`), so reaching back would be a cycle.
 * Same pattern as `resumePaths.ts`.
 */
export function isDesktopBrowser(): boolean {
  try {
    return !isNative() && formFactor(userAgent()) === 'desktop';
  } catch (e) {
    console.warn('[platformLabel] desktop detection failed', e);
    return false;
  }
}

/**
 * Human-readable device label, e.g. `android app`, `iphone app`, `ipad app`
 * (native), `chrome android pwa`, `safari ios pwa` (installed PWA), or
 * `chrome desktop`, `safari ios`, `chrome android` (browser tab).
 */
export function getDeviceLabel(): string {
  try {
    const ua = userAgent();

    if (isNative()) {
      const platform = getPlatform();
      if (platform === 'android') return 'android app';
      if (platform === 'ios') return /iPad/.test(ua) ? 'ipad app' : 'iphone app';
      return 'app';
    }

    const label = `${browserName(ua)} ${formFactor(ua)}`;
    return isStandalone() ? `${label} pwa` : label;
  } catch {
    // See getPlatformLabel: never throw into the pod-creation flow.
    return 'unknown';
  }
}

/**
 * The platform pair that ships on telemetry: `os` is the analytics/registry
 * vocabulary, `detail` is the device label. Together they are the only way to
 * tell the installed app from Safari from an installed PWA.
 *
 * ⚠️ THE USER AGENT CANNOT ANSWER THIS, which is why the pair exists.
 * `enrichAndRedact` already stamps `browser = navigator.userAgent` on every
 * event, but `capacitor.config.ts` sets no `appendUserAgent`, so the WKWebView
 * UA *is* a Safari UA, and an installed PWA's UA is a tab's. That distinction is
 * exactly the one #98 needs: the native shell's document origin is
 * `capacitor://app.beanies.family` (which the Google Picker iframe cannot
 * validate) while Safari's is `https://`.
 *
 * Composes the two functions this module and `capabilities.ts` already own, so
 * it is NOT a fourth detector. One doc home for the pair, because three call
 * sites emit it (`recordError`, the drivePicker success event, and the
 * `pickerRedirect` events).
 */
export function platformContext(): { os: ReturnType<typeof getPlatform>; detail: string } {
  return { os: getPlatform(), detail: getDeviceLabel() };
}
