/**
 * The native OAuth return contract — the URLs Google redirects to and the rules
 * for recognising them. Owned here so the app, the router backstop and the Astro
 * interstitial cannot disagree about what the OAuth return looks like.
 *
 * ZERO IMPORTS IS A HARD CONSTRAINT, NOT A PREFERENCE. The Astro marketing site
 * imports this module, so it must not drag in Vue, Capacitor or vue-router types.
 * That is why these constants do NOT live in `src/constants/deepLinks.ts`, which
 * imports `RouteLocationRaw`. A tripwire test asserts the constraint.
 */

/**
 * The https Universal Link / App Link Google redirects to. Registered on the Web
 * OAuth client — this is the value that must match at token exchange, which is
 * why `getRedirectUri()` keeps returning exactly this and nothing else.
 */
export const NATIVE_REDIRECT_URI = 'https://beanies.family/oauth/native';

/**
 * Custom-scheme bridge target. The scheme IS the bundle id (family.beanies.app),
 * declared in `ios/App/App/Info.plist` (CFBundleURLTypes) and in
 * `android/app/src/main/AndroidManifest.xml`.
 *
 * Exists because Apple fires Universal Links only on user-initiated TAPS — a
 * server-side OAuth redirect to one inside SFSafariViewController just loads the
 * page in the browser sheet and never hands off to the app. Custom schemes do
 * escape the sheet. See ADR-029 and
 * docs/plans/2026-08-06-ios-oauth-custom-scheme-bridge.md.
 *
 * DRIFT GUARD: the two native manifests can't import this. A tripwire test
 * (`nativeOAuth.manifests.test.ts`) reads both files and asserts they declare
 * exactly this scheme.
 */
export const NATIVE_BRIDGE_URI = 'family.beanies.app://oauth/native';

/**
 * The query params that mean "an OAuth result actually arrived". Shared with the
 * Astro interstitial via `define:vars` so the two can't disagree.
 */
export const OAUTH_RESULT_PARAMS = ['code', 'error'] as const;

/** Which transport a native-OAuth return arrived on. */
export type NativeOAuthTransport = 'universal' | 'custom_scheme';

/**
 * Exact-match on a base URL plus an optional query or fragment. A plain
 * `startsWith` would also match a look-alike such as `.../oauth/nativexyz`.
 */
function matchesBase(url: string, base: string): boolean {
  if (!url.startsWith(base)) return false;
  const next = url.charAt(base.length);
  return next === '' || next === '?' || next === '#';
}

/**
 * Single matcher AND classifier: `null` means "not our OAuth return" (use it as
 * the guard), a non-null value is the transport (use it as the `action`
 * telemetry value). One function, so a guard and a label can never disagree
 * about what counts as our URL.
 *
 * Takes a FULL URL (an inbound deep link) — not a search string.
 */
export function nativeOAuthTransport(url: string): NativeOAuthTransport | null {
  if (matchesBase(url, NATIVE_REDIRECT_URI)) return 'universal';
  if (matchesBase(url, NATIVE_BRIDGE_URI)) return 'custom_scheme';
  return null;
}

/**
 * Query extraction that works identically for both schemes.
 *
 * Deliberately does NOT use `new URL()`: for the custom scheme that yields
 * host='oauth', pathname='/native' — nothing like the https form — which is a
 * trap for anyone who later reaches for `.pathname`. Slicing the substring is
 * both simpler and total: this cannot throw.
 *
 * Takes a FULL URL (an inbound deep link) — not a search string.
 */
export function nativeOAuthParams(url: string): URLSearchParams {
  const hashIndex = url.indexOf('#');
  const withoutHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const queryIndex = withoutHash.indexOf('?');
  if (queryIndex === -1) return new URLSearchParams();
  return new URLSearchParams(withoutHash.slice(queryIndex + 1));
}

/**
 * `?code=…&state=…` → `family.beanies.app://oauth/native?code=…&state=…`.
 * Verbatim pass-through — never re-encoded, because the values must reach the
 * app byte-identical to what Google issued.
 *
 * Takes a SEARCH STRING (leading '?' optional) — not a URL. That asymmetry with
 * the two functions above is inherent: those inspect an inbound deep link, this
 * builds an outbound hop from `location.search`.
 */
export function nativeBridgeUrl(search: string): string {
  if (!search || search === '?') return NATIVE_BRIDGE_URI;
  return NATIVE_BRIDGE_URI + (search.startsWith('?') ? search : `?${search}`);
}

/**
 * True when a search string carries an OAuth result worth delivering.
 *
 * A bare visit (no code, no error) must NOT hop: it would arrive at the app with
 * no `state` and fire a spurious `native-oauth-state-mismatch` error report.
 *
 * Takes a SEARCH STRING (leading '?' optional) — not a URL.
 */
export function hasOAuthResult(search: string): boolean {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return OAUTH_RESULT_PARAMS.some((param) => params.has(param));
}
