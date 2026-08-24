/**
 * Human-readable platform / device labels for operational telemetry
 * (e.g. the new-joiner Slack pings). NOT user-facing UI — these strings go to
 * Slack/CloudWatch, so they are intentionally un-translated.
 *
 * Reuses the canonical platform seam in `services/sync/capabilities.ts`
 * (`isNative` / `getPlatform` / `isStandalone` / `isIosOrIpadOs`) — the ONE
 * place native↔web detection lives (ADR-029). This module only adds a light
 * UA parse for browser/OS names, which no existing helper provides.
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
