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

export const REDIRECT_STATE_VERSION = 1 as const;

export interface RedirectStatePayload {
  returnPath: string;
  mode: RedirectMode;
  v: typeof REDIRECT_STATE_VERSION;
}

const MODES: readonly RedirectMode[] = ['create', 'join', 'reconnect'];

/** Encode routing into a URL-safe `state` string. Pure; never throws. */
export function encodeRedirectState(payload: { returnPath: string; mode: RedirectMode }): string {
  const full: RedirectStatePayload = {
    returnPath: payload.returnPath,
    mode: payload.mode,
    v: REDIRECT_STATE_VERSION,
  };
  // btoa → URL-safe (canonical pattern, encoding.ts:31)
  return btoa(JSON.stringify(full)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode + validate a `state` string. Returns `null` on ANY failure (missing,
 * malformed, wrong/unknown version, non-relative `returnPath`) — NEVER throws.
 * Callers treat `null` as "state lost" and route to an actionable, reported
 * surface (never a silent drop).
 */
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
    // Same-origin relative path only: a single leading '/', not '//' (which a
    // browser treats as a protocol-relative absolute URL → open-redirect).
    if (
      typeof returnPath !== 'string' ||
      !returnPath.startsWith('/') ||
      returnPath.startsWith('//')
    ) {
      return null;
    }
    return { returnPath, mode: obj.mode as RedirectMode, v: REDIRECT_STATE_VERSION };
  } catch {
    return null;
  }
}
