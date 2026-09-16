/**
 * OAuth redirect routing carried through the provider `state` parameter.
 *
 * WHY THIS EXISTS (ADR-026 amendment, 2026-06-20): on iOS Safari, WebKit's
 * bounce-tracking protection clears the initiating site's script-writable
 * storage across the cross-site OAuth redirect (app → accounts.google.com →
 * app), *independently of the "Prevent Cross-Site Tracking" toggle*. So the
 * pre-redirect `sessionStorage['beanies_redirect_auth']` is gone on return.
 * The fix: carry the non-secret routing in the OAuth `state` param, which
 * round-trips through Google in the URL and is immune to storage clearing.
 *
 * SECURITY:
 *  - `state` is NON-SECRET — it transits Google + URLs + logs. Only put routing
 *    here: `returnPath`, a `mode` enum, and a version tag. NEVER a password,
 *    token, family key, email, or name.
 *  - `returnPath` is validated as a SAME-ORIGIN relative path on decode (starts
 *    with a single `/`, never `//`), so a maliciously-crafted echoed `state`
 *    can't drive an open redirect.
 *
 * FORWARD-COMPAT: `v` is an EXACT-MATCH gate, not `>=`. A payload whose version
 * is unknown to the running build decodes to `null` (reported "state lost" →
 * the user retries on whatever build now serves them). An old client must never
 * best-effort-parse a newer shape it doesn't understand. To add a field later,
 * bump to `v:2` and — for one release — accept both versions (a small
 * allow-set). Until then `decode` branches on nothing but equality.
 *
 * The base64url transform mirrors EXACTLY the canonical replace-pattern in
 * `src/utils/encoding.ts:31` (`bufferToBase64url`) / `:36-41` (`base64urlToBuffer`)
 * — kept inline (string path, not the buffer helpers) so the routing contract
 * lives in this one file; it is NOT a third divergent base64 impl.
 */

export type RedirectMode = 'create' | 'join' | 'reconnect';

/**
 * Which Google grant a redirect belongs to, so the completion routes to the
 * right subsystem (Drive token commit vs. CalendarConnection update). ADDITIVE +
 * OPTIONAL on the wire (P2): `'drive'` is omitted from the encoded payload so a
 * Drive `state` is byte-identical to the pre-P2 build, and an absent `grant`
 * decodes as `'drive'`. This is safe WITHOUT a version bump because decode
 * ignores unknown fields and defaults absent→drive: a pre-P2 build reading a
 * calendar state still parses returnPath/mode (and does drive-only, all it
 * supports), and a P2 build reading a pre-P2 state defaults to drive correctly.
 */
export type RedirectGrant = 'drive' | 'calendar';

export const REDIRECT_STATE_VERSION = 1 as const;

export interface RedirectStatePayload {
  returnPath: string;
  mode: RedirectMode;
  /** Always resolved (absent on the wire ⇒ `'drive'`). */
  grant: RedirectGrant;
  v: typeof REDIRECT_STATE_VERSION;
}

const MODES: readonly RedirectMode[] = ['create', 'join', 'reconnect'];

/** Encode routing into a URL-safe `state` string. Pure; never throws. */
export function encodeRedirectState(payload: {
  returnPath: string;
  mode: RedirectMode;
  grant?: RedirectGrant;
}): string {
  // Omit `grant` for Drive so the encoded state stays byte-identical to pre-P2.
  const full: Record<string, unknown> = {
    returnPath: payload.returnPath,
    mode: payload.mode,
    v: REDIRECT_STATE_VERSION,
  };
  if (payload.grant === 'calendar') full.grant = 'calendar';
  // btoa → URL-safe (canonical pattern, encoding.ts:31)
  return btoa(JSON.stringify(full)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode + validate a `state` string. Returns `null` on ANY failure (missing,
 * malformed, wrong/unknown version, non-relative `returnPath`) — NEVER throws.
 * Callers treat `null` as "state lost" and route to an actionable, reported
 * surface (never a silent drop).
 */
/**
 * A throwaway origin to resolve `returnPath` against. Never navigated to; it exists only so the
 * real browser URL parser can tell us whether the path escapes its origin. `.invalid` is
 * reserved by RFC 2606 and can never resolve to a real host.
 */
const PROBE_ORIGIN = 'https://beanies.invalid';

/**
 * Is this a same-origin relative path, judged by the BROWSER'S OWN PARSER?
 *
 * ⚠️ EXPORTED BECAUSE THERE ARE THREE SINKS, NOT ONE. `decodeRedirectState` was the only place
 * this check lived, while `OAuthCallbackPage`'s legacy sessionStorage transport and
 * `App.vue`'s native `installNativeAuthListener` callback both navigate to a stored
 * `returnPath` without it. Both sources are app-written today, so neither is a live exploit —
 * but a guard that protects one of three doors is the shape a future change widens by
 * accident, and this class of bug has already shipped once here.
 *
 * ⚠️ RESOLVE, DO NOT PATTERN-MATCH. A prefix test on `/` and `//` looks sufficient and is not:
 * the WHATWG parser reads a BACKSLASH as a slash in the authority position for special
 * schemes, and strips tabs, newlines and carriage returns BEFORE parsing. So `/\evil.com`,
 * `/\/x`, `/\<tab>\evil.com`, `/<newline>/evil.com` and `/<cr>\evil.com` all begin with a
 * single slash, are not `//`, and still resolve clean off-origin. Verified against the same
 * parser the browser uses:
 *
 *     new URL('/\evil.com', 'https://app.beanies.family').href === 'https://evil.com/'
 *
 * Enumerating spellings is how this was got wrong; comparing origins covers the class.
 */
export function isSameOriginReturnPath(returnPath: unknown): returnPath is string {
  if (typeof returnPath !== 'string') return false;
  if (!returnPath.startsWith('/') || returnPath.startsWith('//')) return false;
  try {
    return new URL(returnPath, PROBE_ORIGIN).origin === PROBE_ORIGIN;
  } catch {
    return false;
  }
}

export function decodeRedirectState(raw: string | null | undefined): RedirectStatePayload | null {
  if (!raw) return null;
  try {
    // reverse URL-safe + restore padding (canonical pattern, encoding.ts:36-41)
    let b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    const parsed: unknown = JSON.parse(atob(b64));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    if (obj.v !== REDIRECT_STATE_VERSION) return null;
    if (typeof obj.mode !== 'string' || !MODES.includes(obj.mode as RedirectMode)) return null;
    const returnPath = obj.returnPath;
    // Same-origin relative path only. One implementation, shared by all three sinks.

    // ⚠️ THE PREFIX CHECKS ABOVE ARE NOT ENOUGH, and believing they were left an open
    // redirect. `/\evil.com` starts with a single '/' and passes both — but the WHATWG parser
    // treats a BACKSLASH as a slash in the authority position for special schemes, so
    // `new URL('/\evil.com', 'https://app.beanies.family').href` is `https://evil.com/`.
    // `state` is unsigned, non-secret base64 JSON, so anyone can craft one: a victim tapping
    // `…/oauth/callback?error=access_denied&state=<crafted>` leaves the real origin carrying
    // the error. Aimed squarely at the join flow, where tapping an unfamiliar link IS the
    // expected behaviour.
    //
    // Resolve it the way a browser will and demand the origin come back unchanged. That closes
    // the whole class — backslashes, embedded tabs and newlines (which `new URL` strips),
    // anything else a hand-written prefix test will not think of — rather than one spelling.
    if (!isSameOriginReturnPath(returnPath)) return null;
    // `grant` is optional on the wire; anything other than an explicit
    // 'calendar' (absent, unknown, malformed) resolves to the 'drive' default.
    const grant: RedirectGrant = obj.grant === 'calendar' ? 'calendar' : 'drive';
    return { returnPath, mode: obj.mode as RedirectMode, grant, v: REDIRECT_STATE_VERSION };
  } catch {
    return null;
  }
}
