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
  if (!origin) return CANONICAL_WEB_ORIGIN;

  // A SCHEME TEST, not `new URL()`. An opaque origin serialises as the literal string
  // `"null"` (a sandboxed iframe, a `data:` document, `file://` in Firefox), and
  // `new URL('null')` THROWS — inside the unguarded computed that builds a share link, that
  // would kill the share modal outright. The one input the fallback exists for must not be
  // the one that defeats it. (`"null"` has no colon, so the slice below yields `''`.)
  //
  // ⚠️ The plain scheme is written WITHOUT its `//`, deliberately.
  // `@microsoft/sdl/no-insecure-url` is an eslint --fix rule and matches on `http://`: as a
  // prefix test it was silently rewritten to `https://`, which would have broken every
  // `http://localhost` dev server with no error anywhere. Keep it in this shape.
  const scheme = origin.slice(0, origin.indexOf(':') + 1).toLowerCase();

  // Only an http(s) origin can be opened by someone else's browser; `capacitor:`, `ionic:`,
  // `file:`, `"null"` and an absent `location` all fall back to the canonical one.
  return scheme === 'https:' || scheme === 'http:' ? origin : CANONICAL_WEB_ORIGIN;
}
