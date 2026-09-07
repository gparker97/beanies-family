/**
 * The origin a link may be SENT TO someone else.
 *
 * ⚠️ NOT `window.location.origin`, and this is the whole reason the file exists.
 *
 * Inside the iOS shell the document origin is `capacitor://app.beanies.family` — stated
 * outright in `capacitor.config.ts` and in `services/appUpdate/versionPolicy.ts`, and
 * deliberate: it is what keeps the native WebView serving LOCAL content. It is a private
 * scheme that exists only inside that app. A link built from it and sent to a friend opens
 * nothing at all: an unknown-scheme error, or silence.
 *
 * That is invisible in every environment a developer tests in. The browser and Android
 * (`androidScheme: 'https'`) both give the right answer from `location.origin`, so the bug
 * appears only on a device, only in a message that has already been sent, and only to the
 * person on the other end — who has no way to report it.
 *
 * So: anything that builds a URL for someone ELSE to open must come through here. A URL for
 * THIS app to navigate to itself should keep using `location.origin` or a plain path.
 */

/** Where the app lives on the web. The native shells are wrappers around this same app. */
const CANONICAL_WEB_ORIGIN = 'https://app.beanies.family';

export function shareableOrigin(): string {
  const origin = globalThis.location?.origin;
  // Only an http(s) origin can be opened by someone else's browser. `capacitor:`,
  // `ionic:`, `file:` and an absent `location` all fall back to the canonical one.
  if (origin && /^https?:$/.test(new URL(origin).protocol)) return origin;
  return CANONICAL_WEB_ORIGIN;
}
