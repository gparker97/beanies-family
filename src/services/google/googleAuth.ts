/**
 * Google OAuth 2.0 via Authorization Code + PKCE.
 *
 * Replaces the GIS implicit grant flow with PKCE for long-lived refresh tokens.
 * Token exchange and refresh happen via a Lambda proxy at api.beanies.family
 * (keeps client_secret server-side). Refresh tokens are stored per-family in
 * IndexedDB and survive page refresh, browser restarts, and device reboots.
 *
 * Public API surface is intentionally preserved from the GIS implementation
 * to minimize downstream changes.
 */

import { generateCodeVerifier, generateCodeChallenge } from './pkce';
import { exchangeCodeForTokens, refreshAccessToken } from './oauthProxy';
import {
  storeGoogleRefreshToken,
  getGoogleRefreshToken,
  clearGoogleRefreshToken,
  type StoredRefreshToken,
} from '@/services/sync/fileHandleStore';
import { getActiveFamilyId } from '@/services/indexeddb/database';
import { reportError } from '@/utils/errorReporter';

const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const USERINFO_EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

// Key used to temporarily store a refresh token before a family is active
const PENDING_FAMILY_KEY = '__pending__';

// In-memory token state
let accessToken: string | null = null;
let expiresAt: number = 0;
// 2026-05-20: single-object structure (token + issuedAt) replaced a loose
// `refreshToken: string | null` + ad-hoc `tokenIssuedAt` pair. Coherence
// between the two fields must hold across 3 read sites, 4 write sites, and
// 2 in-memory clear sites — the compiler can't enforce a parallel pair, so
// the structural shape makes the invariant impossible to break.
let currentRefreshToken: StoredRefreshToken | null = null;
let currentFamilyId: string | null = null;

// Deduplication: only one popup auth flow runs at a time.
// Without this, concurrent calls each open the same popup (same window name),
// but generate different PKCE verifiers — the first listener catches the code
// meant for the second verifier, causing "Invalid code verifier" errors.
let pendingAuthPromise: Promise<string> | null = null;

// Cached Google account email
let cachedEmail: string | null = null;

// Expiry callbacks — fire from the scheduled-refresh timer when the
// pre-expiry refresh attempt fails AND the cause is permanent. Transient
// (network blip / 5xx / `pendingSilentRefresh` race) does NOT fire these
// — we let the next visibility wake or caller try again silently.
type ExpiryCallback = () => void;
const expiryCallbacks: ExpiryCallback[] = [];
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

// Permanent-failure callbacks — fire when the silent-refresh path is no
// longer recoverable on its own. Two trigger conditions:
//
//   1. `invalid_grant` — refresh token revoked by Google or the user at
//      accounts.google.com. Definitive, fires immediately.
//   2. Retry-exhaustion streak — `SILENT_REFRESH_FAILURE_ESCALATION_THRESHOLD`
//      consecutive `attemptSilentRefresh` calls have failed after exhausting
//      their internal 3-attempt retry budget. Catches the case where each
//      individual failure looks transient (network/5xx/proxy hiccup) but the
//      system as a whole isn't recovering — without this, the reconnect
//      surface never appears and the user has to discover the dead state
//      manually via Settings.
//
// Subscribers should be idempotent. Counter resets on any successful token
// acquisition (silent or interactive) via `notifyTokenAcquired`, and the
// reconnect surface auto-clears via the existing `onTokenAcquired` self-heal
// path — so a recovered transient blip doesn't leave a stale banner.
type PermanentFailureCallback = () => void;
const permanentFailureCallbacks: PermanentFailureCallback[] = [];

// Counter persistence — sessionStorage-backed (per-tab, survives reload,
// cleans up on tab close) so reload-loops accumulate failures correctly.
// Same persistence tier as the offline queue. If sessionStorage is
// unavailable (private mode, quota), we fall back to in-memory counting
// and warn once per session — never silently skip the escalation path.
const FAILURE_COUNTER_KEY = 'beanies_silent_refresh_failures';
let storageWarnedThisSession = false;

function loadFailureCounter(): number {
  try {
    const v =
      typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(FAILURE_COUNTER_KEY) : null;
    return v ? Math.max(0, parseInt(v, 10) || 0) : 0;
  } catch (e) {
    warnStorageOnce('read', e);
    return 0;
  }
}
function persistFailureCounter(n: number): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(FAILURE_COUNTER_KEY, String(n));
    }
  } catch (e) {
    warnStorageOnce('write', e);
  }
}
function warnStorageOnce(op: 'read' | 'write', err: unknown): void {
  if (storageWarnedThisSession) return;
  storageWarnedThisSession = true;
  console.warn(
    `[googleAuth] sessionStorage ${op} failed — silent-refresh failure counter ` +
      `will not survive page reloads. Falls back to in-memory counting.`,
    err
  );
  reportError({
    surface: 'silent-refresh-counter-storage',
    message: `sessionStorage ${op} failed; counter persistence unavailable`,
    error: err instanceof Error ? err : new Error(String(err)),
  });
}

let consecutiveSilentRefreshFailures = loadFailureCounter();
// 2 retry-exhausted failures = 6 OAuth proxy fetches across two
// `attemptSilentRefresh` calls. Plenty of patience for transients while
// reaching the user fast on real failures.
const SILENT_REFRESH_FAILURE_ESCALATION_THRESHOLD = 2;

function firePermanentFailureCallbacks(): void {
  permanentFailureCallbacks.forEach((cb) => {
    try {
      cb();
    } catch (err) {
      console.warn('[googleAuth] Permanent-failure callback error:', err);
    }
  });
}

// Token-acquisition callbacks. Fires after every successful access-token
// acquisition (popup, silent refresh, redirect). Subscribers receive the
// resolved Google account email (best-effort fetch), the token string,
// and an `interactive` flag indicating whether the acquisition came from
// a user-driven flow (popup / redirect) vs. a background silent refresh.
// The interactive flag lets the account-assertion subsystem distinguish
// a deliberate "switch account" acquisition from an incidental silent
// refresh that happened to fire during the switch flow.
type AcquiredCallback = (email: string | null, token: string, interactive: boolean) => void;
const acquiredCallbacks: AcquiredCallback[] = [];

/**
 * Check if Google Drive integration is configured (client ID set in env)
 */
export function isGoogleAuthConfigured(): boolean {
  return !!getClientId();
}

/**
 * Whether a thrown error represents the user backing out of an auth/picker
 * flow (closing the Google account chooser, dismissing the OS file picker,
 * a blocked popup, etc.) rather than a real failure. Callers use this to
 * treat the situation as a quiet "never mind" instead of an error to report.
 *
 * Covers the `AbortError` shape (`showSaveFilePicker` cancellation) by name
 * and the GIS / popup-blocked message shapes by substring.
 */
export function isUserCancellation(e: unknown): boolean {
  if ((e as { name?: string } | null)?.name === 'AbortError') return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /cancel|dismiss|popup_closed|user_cancel/i.test(msg);
}

/**
 * Whether the current browser should skip popup-based OAuth and use full-page
 * redirect auth instead. Two cases trigger this:
 *
 * **1. Any iOS / iPadOS WebKit browser** — Safari, Chrome-on-iOS,
 * Edge-on-iOS, etc. (they all run WebKit). A `window.open()` on iOS opens a
 * *new tab*, not a true popup, and `postMessage` from that tab back to the
 * opener is unreliable — worse, on a fresh tab the OAuth *continuation*
 * after the account chooser runs into iOS cookie / ITP partitioning and
 * Google returns a generic `invalid_request` 400 ("The server cannot
 * process the request because it is malformed"). Standalone-PWA iOS users
 * already worked because they were on the redirect path (case 2) — that's
 * the "works on some iPhones, not others" split a real user (Shaun, May
 * 2026) hit. Full-page redirect keeps everything in the one top-level
 * window, no cross-tab message, no fresh-tab cookie partition.
 *
 * **2. Any installed PWA in standalone display-mode** (Android Chrome,
 * Edge, …) — popups opened from a standalone PWA either fail to open or
 * open in a different browser context, so the `postMessage` bridge can't
 * reach back to the PWA window.
 *
 * History note: an earlier version routed *all* iOS through redirect, then
 * was narrowed to standalone-only because redirect-auth's ITP top-level
 * navigation was suspected of breaking the Google Picker iframe's auth
 * context (the cookie-consent → "API developer key invalid" chain). That
 * concern only ever affected the *load-existing-pod* picker, never
 * create-pod / connect-Drive; and the popup path's failure modes (above)
 * are worse and more common. If the Picker concern resurfaces on iOS it's
 * handled at the picker, not by reverting this. See ADR — iOS redirect OAuth.
 *
 * Safe to call at module/SSR time: returns false if `navigator`,
 * `window`, or `matchMedia` is missing.
 */
export function shouldUseRedirectAuth(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as
    | (Navigator & { standalone?: boolean; maxTouchPoints?: number })
    | undefined;
  if (!nav) return false;
  // iOS / iPadOS WebKit — popup/new-tab OAuth is fragile (see above).
  // iPadOS 13+ Safari reports a desktop UA, so also detect "Mac with a
  // touchscreen" (no real Mac has `maxTouchPoints > 1`).
  const ua = nav.userAgent ?? '';
  const isIOS =
    /iP(hone|od|ad)/.test(ua) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1);
  if (isIOS) return true;
  // Installed PWA in standalone mode — popup→postMessage bridge is broken.
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // iOS Safari "Add to Home Screen" PWAs use this older flag (kept for
  // belt-and-suspenders; the iOS check above already covers them).
  if (nav.standalone === true) return true;
  return false;
}

/**
 * Try to obtain a valid access token without any interactive UI (no popup,
 * no redirect). Returns the token if cached or recoverable via silent
 * refresh, or null if interactive auth is required. Safe to call from
 * non-gesture contexts (page mount, background tasks).
 */
export async function tryGetSilentToken(): Promise<string | null> {
  if (isTokenValid()) return accessToken;
  return attemptSilentRefresh();
}

function getClientId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
}

function getRedirectUri(): string {
  return `${window.location.origin}/oauth/callback`;
}

/**
 * Initialize auth for a family — loads stored refresh token from IndexedDB
 * AND installs the visibility-change wake listener (idempotent).
 * Call this once after login, before any Drive operations.
 */
export async function initializeAuth(familyId: string): Promise<void> {
  currentFamilyId = familyId;
  const stored = await getGoogleRefreshToken(familyId);
  if (stored) {
    currentRefreshToken = stored;
    console.warn('[googleAuth] Loaded refresh token for family', familyId);
  }
  installAuthWakeListener();
}

// Window of time before `expiresAt` that triggers a proactive refresh on
// tab-wake / page-mount. 2 min absorbs the typical 5–30s of wake-handler
// latency without refreshing more often than necessary.
const WAKE_REFRESH_THRESHOLD_MS = 120_000;
let wakeListenerInstalled = false;
let wakeListenerHandler: (() => void) | null = null;

// Wake events that should trigger a silent refresh if the access token is
// near or past expiry. Each event covers a real-world recovery path that
// the others miss:
//
//   - `visibilitychange` — tab becomes visible (the original handler).
//   - `focus`            — cross-window/cross-tab focus restore on
//                          Chrome desktop (visibilitychange doesn't always
//                          fire for window-to-window switches).
//   - `pageshow`         — BFCache restore on mobile Safari/Chrome after
//                          device sleep/wake (load-bearing on mobile —
//                          neither visibilitychange nor focus fires here).
//   - `online`           — network recovery after offline. Cheap;
//                          deduplicated via `pendingSilentRefresh`.
//
// All triggers funnel through the same `refreshIfStale` callback and are
// coalesced by the `pendingSilentRefresh` dedupe in `attemptSilentRefresh`.
type WakeEventBinding = readonly [target: EventTarget, event: string];
function getWakeEventBindings(): readonly WakeEventBinding[] {
  // Resolved at install/teardown time, not module-eval time, so we don't
  // crash in non-DOM contexts (vitest happy-dom, SSR).
  return [
    [document, 'visibilitychange'],
    [window, 'focus'],
    [window, 'pageshow'],
    [window, 'online'],
  ] as const;
}

/**
 * Install a `visibilitychange` listener that proactively refreshes the
 * access token when the tab becomes visible AND the token expires within
 * `WAKE_REFRESH_THRESHOLD_MS`. Idempotent — safe to call from every
 * `initializeAuth` invocation.
 *
 * Why this exists: the scheduled-refresh `setTimeout` is module-level
 * state that dies on full page reload AND is throttled while the tab is
 * hidden. A user who leaves the tab open overnight returns to an expired
 * access token; without this listener, the next sync attempt or file
 * poll fires `getValidTokenSilent`, which throws `TokenExpiredError`,
 * which bubbles up — and even though our refresh-token flow can recover
 * silently, the failure surfaces visibly to the user. This listener runs
 * the silent refresh **before** any sync code can race.
 *
 * Idempotency notes:
 *   - The `wakeListenerInstalled` guard prevents stacked listeners
 *   - `attemptSilentRefresh` is internally deduplicated via
 *     `pendingSilentRefresh`, so concurrent triggers (visibility +
 *     scheduled-timer) don't double-fetch
 *   - We also fire once at install time, which covers full page reload
 *     and the SW-update reload path ("get fresh beans" banner).
 */
function installAuthWakeListener(): void {
  if (wakeListenerInstalled) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  wakeListenerInstalled = true;

  const refreshIfStale = (): void => {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (!currentRefreshToken) return;
    const willExpireSoon = Date.now() + WAKE_REFRESH_THRESHOLD_MS >= expiresAt;
    if (!willExpireSoon) return;
    void attemptSilentRefresh().catch(() => {
      // Errors are already logged inside performSilentRefresh; swallow
      // so the listener never throws into the browser's event loop.
    });
  };

  wakeListenerHandler = refreshIfStale;
  for (const [target, event] of getWakeEventBindings()) {
    target.addEventListener(event, refreshIfStale);
  }
  // Fire once on install — covers cold boot / full reload / SW update,
  // where module state has been wiped and the access token is null.
  refreshIfStale();
}

/**
 * Test-only — remove all wake listeners and reset install state. Used by
 * vitest's `afterEach` to clean up before `vi.resetModules()` discards
 * the module, preventing stale listeners from accumulating across test
 * cases. Production code never calls this.
 */
export function __resetWakeListenerForTesting(): void {
  if (wakeListenerHandler && typeof document !== 'undefined' && typeof window !== 'undefined') {
    for (const [target, event] of getWakeEventBindings()) {
      target.removeEventListener(event, wakeListenerHandler);
    }
  }
  wakeListenerHandler = null;
  wakeListenerInstalled = false;
}

/**
 * Migrate a pending refresh token to a real family-scoped key.
 *
 * During login-page OAuth (no family yet), the refresh token is stored under
 * a temporary pending key. Once a family is adopted/created from the Drive
 * file, call this to move the token to the family-scoped key and update
 * in-memory state.
 */
export async function migratePendingRefreshToken(familyId: string): Promise<void> {
  const pending = await getGoogleRefreshToken(PENDING_FAMILY_KEY);
  if (!pending) return;

  // Move to the family-scoped key. Forward `pending.issuedAt` LITERALLY —
  // including `null` for legacy bare-string pending entries. Coercing to
  // `Date.now()` here would invent a fresh timestamp for a possibly-old
  // token and mask the revocation patterns the diagnostic is meant to
  // surface (2026-05-20).
  await storeGoogleRefreshToken(familyId, pending.token, { issuedAt: pending.issuedAt });
  await clearGoogleRefreshToken(PENDING_FAMILY_KEY);

  // Update in-memory state
  currentFamilyId = familyId;
  currentRefreshToken = pending;
  console.warn('[googleAuth] Migrated pending refresh token to family', familyId);
}

/**
 * Backward compatibility — no-op. Previously loaded the GIS script.
 * Consumers can safely call this; it does nothing in the PKCE flow.
 */
export async function loadGIS(): Promise<void> {
  // No-op — PKCE does not require external scripts
}

/**
 * Request an OAuth access token via PKCE popup flow.
 *
 * If a valid token exists, returns it immediately.
 * If a refresh token is available, tries silent refresh first.
 * Otherwise, opens the Google consent popup.
 *
 * Concurrent calls are deduplicated — only one popup auth flow runs at a time.
 * Additional callers receive the same promise. This prevents PKCE verifier
 * mismatches when the same popup window is reused by a second call.
 *
 * @param options.forceConsent - Force the account chooser / consent screen.
 * @param options.loginHint - Email to pre-fill Google's account chooser
 *   with (e.g. the user's expected Google account). Helps users with
 *   multiple Google accounts pick the right one and reduces account drift.
 */
export async function requestAccessToken(options?: {
  forceConsent?: boolean;
  loginHint?: string;
}): Promise<string> {
  // Fast paths that don't need deduplication
  const clientId = getClientId();
  if (!clientId) {
    throw new Error(
      'Google Client ID not configured. Set VITE_GOOGLE_CLIENT_ID in your .env file.'
    );
  }

  // If forcing consent, clear existing token so we don't short-circuit
  if (options?.forceConsent) {
    clearTokenState();
  }

  // Return cached token if still valid
  if (isTokenValid()) {
    return accessToken!;
  }

  // Deduplicate concurrent popup auth flows (check before opening popup)
  if (pendingAuthPromise) {
    console.warn('[googleAuth] Auth flow already in progress — joining existing request');
    return pendingAuthPromise;
  }

  // Open a blank popup IMMEDIATELY — before any async work — to preserve
  // the user-gesture context. Mobile browsers block window.open() calls
  // that happen inside async callbacks (the gesture is "consumed" by the
  // microtask). If silent refresh succeeds, we close the unused popup.
  // Only open when there's no cached token (checked above) and we may need
  // interactive auth. Throws synchronously if popup is blocked.
  const popup = openBlankPopup();

  // Try silent refresh first (if we have a refresh token)
  if (currentRefreshToken) {
    const silentToken = await attemptSilentRefresh();
    if (silentToken) {
      // Don't need the popup after all — close it
      if (!popup.closed) popup.close();
      return silentToken;
    }
  }

  // Try silent auth-code (handles the Marketplace-installed case where
  // scopes are pre-granted at install time). forceConsent skips this —
  // the caller is explicitly asking for a fresh consent flow.
  if (!options?.forceConsent) {
    const silentToken = await attemptSilentAuthCode(clientId);
    if (silentToken) {
      if (!popup.closed) popup.close();
      return silentToken;
    }
  }

  const promise = performPopupAuth(clientId, popup, options);
  pendingAuthPromise = promise;

  try {
    return await promise;
  } finally {
    // Only clear if this is still the active promise
    if (pendingAuthPromise === promise) {
      pendingAuthPromise = null;
    }
  }
}

/**
 * Attempt a fully-silent OAuth authorization-code flow via a hidden iframe.
 *
 * Used for the Marketplace-installed case: when a user installs beanies.family
 * from the Google Workspace Marketplace, Google grants the listing's scopes
 * (drive.file + userinfo.email) at install time. A subsequent OAuth call from
 * our app with prompt=none will then return an authorization code without
 * showing any consent UI — eliminating the "second SSO" Google's review team
 * flagged.
 *
 * Returns the access token on success, or null if silent auth is not possible
 * (no Google session, scopes not pre-granted, X-Frame blocked the iframe,
 * timed out, or any other failure mode). Callers fall back to interactive
 * popup auth on null.
 *
 * Listener model: the iframe's OAuthCallbackPage detects iframe context (no
 * window.opener, but window.parent !== window) and posts to window.parent.
 * We listen for the same `oauth-callback` message type as the popup flow;
 * timing is sequential (silent runs to completion before popup auth begins),
 * so the two listeners don't collide.
 */
async function attemptSilentAuthCode(clientId: string): Promise<string | null> {
  let codeVerifier: string;
  let codeChallenge: string;
  try {
    codeVerifier = generateCodeVerifier();
    codeChallenge = await generateCodeChallenge(codeVerifier);
  } catch (e) {
    console.warn('[googleAuth] silent: PKCE setup failed', e);
    return null;
  }

  const authUrl = buildAuthUrl(clientId, codeChallenge, 'none');

  const code = await new Promise<string | null>((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.setAttribute('aria-hidden', 'true');

    let resolved = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function cleanup() {
      window.removeEventListener('message', handler);
      if (timer) clearTimeout(timer);
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }

    function handler(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'oauth-callback') return;
      if (resolved) return;
      resolved = true;
      cleanup();
      if (event.data.error) {
        // Expected silent-fail signals: login_required, consent_required,
        // interaction_required. Logged at info level — they're normal for
        // direct-signup users who haven't pre-granted scopes.
        console.info('[googleAuth] silent auth-code returned non-fatal error:', event.data.error);
        resolve(null);
        return;
      }
      if (event.data.code) {
        resolve(event.data.code);
        return;
      }
      resolve(null);
    }

    window.addEventListener('message', handler);

    // Cap the wait. Silent flows resolve in ~1s typically; 5s leaves plenty
    // of headroom while keeping the about:blank popup visible only briefly
    // when silent is going to fail.
    timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      cleanup();
      console.info('[googleAuth] silent auth-code attempt timed out');
      resolve(null);
    }, 5000);

    iframe.src = authUrl;
    document.body.appendChild(iframe);
  });

  if (!code) return null;

  try {
    const tokens = await exchangeCodeForTokens({
      code,
      codeVerifier,
      redirectUri: getRedirectUri(),
      clientId,
    });

    if (tokens.scope && !tokens.scope.includes('drive.file')) {
      console.info('[googleAuth] silent auth-code returned without drive.file scope');
      return null;
    }

    accessToken = tokens.access_token;
    expiresAt = Date.now() + tokens.expires_in * 1000;

    if (tokens.refresh_token) {
      const issuedAt = Date.now();
      currentRefreshToken = { token: tokens.refresh_token, issuedAt };
      const storageKey = currentFamilyId ?? PENDING_FAMILY_KEY;
      try {
        await storeGoogleRefreshToken(storageKey, tokens.refresh_token, { issuedAt });
      } catch (e) {
        console.warn('[googleAuth] silent: failed to persist refresh token (non-critical)', e);
      }
    }

    scheduleAutoRefresh(tokens.expires_in);

    // interactive=false: this acquisition was fully silent. Subscribers
    // (e.g. account-assertion) use this flag to distinguish a deliberate
    // user-driven sign-in from an incidental background acquisition.
    notifyTokenAcquired(tokens.access_token, false).catch(() => {});

    console.info(
      `[googleAuth] silent auth-code succeeded — token acquired without consent prompt (expires in ${tokens.expires_in}s)`
    );
    return tokens.access_token;
  } catch (e) {
    console.warn('[googleAuth] silent auth-code token exchange failed (non-critical)', e);
    return null;
  }
}

/**
 * Internal: perform the actual popup OAuth flow. Callers should go through
 * requestAccessToken() which handles caching, silent refresh, and deduplication.
 */
async function performPopupAuth(
  clientId: string,
  popup: Window,
  options?: { forceConsent?: boolean; loginHint?: string }
): Promise<string> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const prompt = options?.forceConsent ? 'consent' : 'select_account';
  const authUrl = buildAuthUrl(clientId, codeChallenge, prompt, options?.loginHint);
  const code = await waitForAuthCode(popup, authUrl);

  const tokens = await exchangeCodeForTokens({
    code,
    codeVerifier,
    redirectUri: getRedirectUri(),
    clientId,
  });

  // Validate that Drive file scope was granted (Google granular consent lets users deselect it)
  if (tokens.scope && !tokens.scope.includes('drive.file')) {
    clearTokenState();
    throw new Error(
      'Google Drive file access was not granted. Please allow file access when prompted.'
    );
  }

  // Update in-memory state
  accessToken = tokens.access_token;
  expiresAt = Date.now() + tokens.expires_in * 1000;

  // Store refresh token if provided (Google only sends it on first consent).
  // When no family is active yet (login page), store under a pending key so
  // the token survives page refresh and can be migrated once a family is adopted.
  if (tokens.refresh_token) {
    const issuedAt = Date.now();
    currentRefreshToken = { token: tokens.refresh_token, issuedAt };
    const storageKey = currentFamilyId ?? PENDING_FAMILY_KEY;
    await storeGoogleRefreshToken(storageKey, tokens.refresh_token, { issuedAt });
  }

  // Schedule auto-refresh
  scheduleAutoRefresh(tokens.expires_in);

  // Notify subscribers (assertion + telemetry hooks). Fire-and-forget:
  // never block token return on subscriber work. interactive=true — the
  // user explicitly went through the chooser/consent flow.
  notifyTokenAcquired(tokens.access_token, true).catch(() => {});

  console.warn(`[googleAuth] Token acquired via PKCE, expires in ${tokens.expires_in}s`);
  return tokens.access_token;
}

/**
 * Check if the current token is still valid
 */
export function isTokenValid(): boolean {
  return !!accessToken && Date.now() < expiresAt;
}

/**
 * Get the current access token. Returns null if not valid.
 */
export function getAccessToken(): string | null {
  return isTokenValid() ? accessToken : null;
}

// Deduplication: only one silent refresh runs at a time.
let pendingSilentRefresh: Promise<string | null> | null = null;

// ─── Silent refresh diagnostic capture ───────────────────────────────────────
//
// The cold-start-reconnect-escalation surface only knows that silent refresh
// "failed" — not which failure mode (Lambda cold start, iOS wake-network race,
// refresh-token revocation that isn't classifying as invalid_grant, etc.).
// `performSilentRefresh` records each attempt's duration + error classification
// here so the escalation alert can attach the diagnostic context.
//
// Lifecycle: set on every full failure of `performSilentRefresh` (so the most
// recent attempt is what the next escalation reports). Cleared on success so
// stale diagnostics never get attached to a fresh failure.

export interface SilentRefreshAttemptDiagnostic {
  attempt: number;
  durationMs: number;
  classification: 'permanent' | 'timeout' | 'network' | 'http' | 'unknown';
  errorName: string;
  errorMessage: string;
}

export interface SilentRefreshDiagnostics {
  attempts: SilentRefreshAttemptDiagnostic[];
  hadRefreshToken: boolean;
  consecutiveFailures: number;
  // Age of the refresh token at the moment a permanent-failure (`invalid_grant`)
  // classification was recorded. Helps surface revocation patterns (Google
  // revoking after N days of disuse, password change, etc.). Null when the
  // failure was not permanent OR the token's `issuedAt` was unknown (legacy
  // bare-string IDB / localStorage entry). Always null for non-permanent
  // failures since those don't clear the token.
  refreshTokenAgeMs?: number | null;
}

let lastSilentRefreshDiagnostics: SilentRefreshDiagnostics | null = null;

/** Returns diagnostics for the most recent failed silent refresh, or null
 *  if the most recent attempt succeeded (or none has happened this session). */
export function getLastSilentRefreshDiagnostics(): SilentRefreshDiagnostics | null {
  return lastSilentRefreshDiagnostics;
}

/** Classify a refresh-attempt failure for the diagnostic alert. The labels
 *  guide the structural fix: 'timeout' → Lambda cold start / network too
 *  slow; 'network' → wake-time stack race; 'http' → proxy returned non-2xx
 *  (often invalid_grant or 5xx); 'permanent' → refresh token revoked. */
function classifySilentRefreshError(e: unknown): SilentRefreshAttemptDiagnostic['classification'] {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes('invalid_grant') || msg.includes('Token has been expired or revoked')) {
    return 'permanent';
  }
  if (msg.includes('timed out after') || msg.includes('AbortError')) return 'timeout';
  if (
    msg.includes('Failed to fetch') ||
    msg.includes('Load failed') ||
    msg.includes('NetworkError')
  ) {
    return 'network';
  }
  if (/HTTP [45]\d\d/.test(msg) || msg.includes('OAuth refresh failed')) return 'http';
  return 'unknown';
}

/**
 * Whether a silent token refresh is currently in flight. Read by callers
 * that want to coalesce or defer their own UI signals while recovery is
 * underway (e.g. the save-failure banner waits out this window before
 * alarming the user).
 */
export function isSilentRefreshPending(): boolean {
  return pendingSilentRefresh !== null;
}

/**
 * Attempt a silent token refresh using the stored refresh token.
 * Returns the new access token on success, or null if interactive auth is required.
 * Concurrent calls are deduplicated — only one refresh runs at a time.
 */
export async function attemptSilentRefresh(): Promise<string | null> {
  if (pendingSilentRefresh) return pendingSilentRefresh;

  const promise = performSilentRefresh();
  pendingSilentRefresh = promise;
  try {
    return await promise;
  } finally {
    if (pendingSilentRefresh === promise) pendingSilentRefresh = null;
  }
}

async function performSilentRefresh(): Promise<string | null> {
  const clientId = getClientId();

  // If in-memory refreshToken was lost (page reload / SW update), try loading
  // from IndexedDB before giving up. This closes the race window where
  // getValidToken() is called before initializeAuth() completes.
  //
  // Wrapped in try/catch: an IDB reject (corruption, schema upgrade race,
  // quota) used to throw past the wake listener's `.catch(() => {})`
  // boundary as a silent failure that prevented the counter from ever
  // incrementing. We now warn + report and continue with no stored token
  // (the caller chain still gets a clean null/`TokenExpiredError` signal).
  if (!currentRefreshToken) {
    const familyId = currentFamilyId ?? getActiveFamilyId();
    if (familyId) {
      try {
        const stored = await getGoogleRefreshToken(familyId);
        if (stored) {
          currentRefreshToken = stored;
          currentFamilyId = familyId;
          console.warn('[googleAuth] Recovered refresh token from IndexedDB during silent refresh');
        }
      } catch (e) {
        console.error('[googleAuth] Failed to read refresh token from IndexedDB:', e);
        reportError({
          surface: 'silent-refresh-idb-read',
          message: 'Failed to read refresh token from IndexedDB',
          error: e instanceof Error ? e : new Error(String(e)),
          context: { family_id: familyId },
        });
      }
    }
  }

  if (!clientId || !currentRefreshToken) {
    // Capture this failure mode too — "no refresh token" means IDB read
    // returned nothing OR session is uninitialised. Useful diagnostic in
    // its own right (it would otherwise show up as a silent null).
    lastSilentRefreshDiagnostics = {
      attempts: [],
      hadRefreshToken: !!currentRefreshToken,
      consecutiveFailures: consecutiveSilentRefreshFailures,
    };
    return null;
  }

  // Retry up to 5× on transient failures with stepped backoff. The total
  // patience window is ~22.5s (1.5 + 3 + 6 + 12 between attempts). Sized to
  // survive Chrome desktop wake-from-sleep on Windows, where the network
  // adapter takes 5–20s to reattach (DHCP renewal, WiFi reassociation, DNS
  // cache rebuild) while `fetch()` already returns `TypeError: Failed to
  // fetch` immediately. The 2026-05-19 cascade (CloudWatch: zero Lambda
  // invocations during two 5min failure windows on a Windows Chrome user
  // with a tab open overnight) confirmed the request never left the client
  // — exactly the wake-race shape. `invalid_grant` is permanent and
  // short-circuits — the refresh token has been revoked at Google's end.
  //
  // Cap protection: do not extend `RETRY_BACKOFF_MS` past 4 entries (5 total
  // attempts) without considering the user-visible "stuck" window. A unit
  // test asserts `MAX_ATTEMPTS <= 5` so a future maintainer doesn't quietly
  // lift this.
  const RETRY_BACKOFF_MS = [1500, 3000, 6000, 12000] as const;
  const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length + 1;
  const diagnosticAttempts: SilentRefreshAttemptDiagnostic[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const startMs = performance.now();
    try {
      console.warn(
        `[googleAuth] Attempting silent token refresh (attempt ${attempt}/${MAX_ATTEMPTS})...`
      );
      // Capture into a const so the await below can't lose TypeScript's
      // narrowing on the module-level `let currentRefreshToken`. The guard
      // above (line ~810) ensures we never enter the loop with null.
      const tokenAtAttempt = currentRefreshToken!.token;
      const tokens = await refreshAccessToken({
        refreshToken: tokenAtAttempt,
        clientId,
      });

      accessToken = tokens.access_token;
      expiresAt = Date.now() + tokens.expires_in * 1000;

      // Schedule next auto-refresh
      scheduleAutoRefresh(tokens.expires_in);

      // Notify subscribers (assertion + telemetry hooks). Fire-and-forget.
      // interactive=false — background refresh, no user gesture involved.
      notifyTokenAcquired(tokens.access_token, false).catch(() => {});

      console.warn('[googleAuth] Silent refresh succeeded');
      // Clear stale diagnostics so a later failure doesn't surface old data.
      lastSilentRefreshDiagnostics = null;
      return tokens.access_token;
    } catch (e) {
      const durationMs = Math.round(performance.now() - startMs);
      const errorName = e instanceof Error ? e.name : 'UnknownError';
      const errorMessage = e instanceof Error ? e.message : String(e);
      const classification = classifySilentRefreshError(e);
      // Truncate message to keep the Slack payload compact — full message
      // is still in the console log above.
      diagnosticAttempts.push({
        attempt,
        durationMs,
        classification,
        errorName,
        errorMessage: errorMessage.length > 120 ? errorMessage.slice(0, 120) + '…' : errorMessage,
      });

      const isPermanent = classification === 'permanent';

      if (isPermanent) {
        console.warn(
          '[googleAuth] Silent refresh failed (permanent — refresh token revoked):',
          errorMessage
        );
        // Capture age BEFORE clearing — `currentRefreshToken?.issuedAt` after
        // the assignment would always be null. Null = "unknown age" (legacy
        // bare-string entry that pre-dates issuedAt tracking); a number =
        // actual age in ms (helps surface revocation patterns).
        const refreshTokenAgeMs =
          currentRefreshToken?.issuedAt != null ? Date.now() - currentRefreshToken.issuedAt : null;
        currentRefreshToken = null;
        if (currentFamilyId) {
          await clearGoogleRefreshToken(currentFamilyId);
        }
        lastSilentRefreshDiagnostics = {
          attempts: diagnosticAttempts,
          hadRefreshToken: true,
          consecutiveFailures: consecutiveSilentRefreshFailures,
          refreshTokenAgeMs,
        };
        firePermanentFailureCallbacks();
        return null;
      }

      // Transient failure — retry if attempts remain.
      if (attempt < MAX_ATTEMPTS) {
        const backoffMs = RETRY_BACKOFF_MS[attempt - 1] ?? 3000;
        console.warn(
          `[googleAuth] Silent refresh failed (transient, retrying in ${backoffMs}ms): ${errorMessage}`
        );
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }

      // All retries exhausted. Increment the consecutive-failure counter
      // (persisted across reloads via sessionStorage); when the threshold
      // is crossed, escalate to permanent-failure even though no individual
      // attempt was classified as `invalid_grant`. The user's experience of
      // "silent refresh keeps failing forever" is the same regardless of
      // cause, and the reconnect surface auto-clears when a later refresh
      // succeeds via the `notifyTokenAcquired` path. `>=` (not `===`)
      // protects against a counter-overshoot race; the subscriber
      // (`syncStore.setupTokenExpiryHandler` ref-set) is idempotent.
      consecutiveSilentRefreshFailures++;
      persistFailureCounter(consecutiveSilentRefreshFailures);
      console.warn(
        `[googleAuth] Silent refresh failed after ${MAX_ATTEMPTS} attempts ` +
          `(consecutive: ${consecutiveSilentRefreshFailures}/${SILENT_REFRESH_FAILURE_ESCALATION_THRESHOLD}): ${errorMessage}`
      );
      lastSilentRefreshDiagnostics = {
        attempts: diagnosticAttempts,
        hadRefreshToken: true,
        consecutiveFailures: consecutiveSilentRefreshFailures,
      };
      if (consecutiveSilentRefreshFailures >= SILENT_REFRESH_FAILURE_ESCALATION_THRESHOLD) {
        console.warn(
          '[googleAuth] Escalating to permanent failure — silent refresh has not recovered'
        );
        firePermanentFailureCallbacks();
      }
      return null;
    }
  }
  return null;
}

/**
 * Check whether we currently hold a refresh token (in memory).
 * Used by other modules to decide whether to force consent on re-auth.
 */
export function hasRefreshToken(): boolean {
  return !!currentRefreshToken;
}

/**
 * Sentinel error thrown by silent-only token paths when the access token
 * has expired and silent refresh has failed. Callers should NOT respond
 * by opening a popup themselves — instead, surface the existing reconnect
 * banner (`syncStore.showGoogleReconnect`) so the user can re-auth via a
 * deliberate click. Background operations must never trigger an unsolicited
 * Google popup.
 */
export class TokenExpiredError extends Error {
  constructor(message = 'Google access token expired and silent refresh failed') {
    super(message);
    this.name = 'TokenExpiredError';
  }
}

/**
 * Get a valid access token, refreshing if needed.
 * Attempts silent refresh first; falls back to interactive auth.
 *
 * **For user-gesture-triggered call sites only** (button clicks, form
 * submissions). Background operations like sync, file polling, and
 * recurring refreshes must use `getValidTokenSilent()` instead — opening
 * an unsolicited popup mid-operation is the bug class this distinction
 * is here to prevent.
 *
 * When falling back to interactive auth without a refresh token,
 * forces consent so Google issues a new refresh token.
 */
export async function getValidToken(): Promise<string> {
  if (isTokenValid()) return accessToken!;

  // Try silent refresh first (no popup)
  const silentToken = await attemptSilentRefresh();
  if (silentToken) return silentToken;

  // Fall back to interactive auth.
  // Force consent when we have no refresh token — Google only issues
  // refresh tokens with prompt=consent, not prompt=select_account.
  return requestAccessToken({ forceConsent: !currentRefreshToken });
}

/**
 * Get a valid access token using silent refresh ONLY. Throws
 * `TokenExpiredError` if the token has expired and silent refresh fails —
 * never opens a Google popup, **and never directly surfaces the reconnect
 * banner**.
 *
 * Use this from any background/non-user-gesture context (Drive sync,
 * polling, recurring refreshes, the wake-time stale-tab refresh).
 *
 * **Banner-firing contract:** the reconnect banner is wired to
 * `onTokenPermanentlyExpired`, which fires in two cases: (1) Google has
 * revoked the refresh token (`invalid_grant`), or (2) silent refresh
 * has failed `SILENT_REFRESH_FAILURE_ESCALATION_THRESHOLD` consecutive
 * times — the system isn't recovering on its own and the user needs a
 * way to re-authenticate. Single transient blips (network jitter, brief
 * 5xx, mid-SW-activation hiccups) do NOT fire the banner; callers that
 * catch `TokenExpiredError` should treat it as "try again later". The
 * next successful silent refresh (auto-fired on `visibilitychange` via
 * `installAuthWakeListener`, or by the next caller through
 * `attemptSilentRefresh`) clears any banner that did appear via the
 * `onTokenAcquired` self-heal path AND resets the failure counter.
 *
 * Why this exists: an unsolicited popup that opens because we couldn't
 * silently refresh is the worst kind of UX — it appears without any
 * action by the user, often gets blocked by browsers (no user gesture in
 * the call stack), and feels like a bug even when auth is healthy.
 */
export async function getValidTokenSilent(): Promise<string> {
  if (isTokenValid()) return accessToken!;
  const silentToken = await attemptSilentRefresh();
  if (silentToken) return silentToken;
  throw new TokenExpiredError();
}

/**
 * Revoke the current tokens and clear all state.
 *
 * Prefer `clearGoogleSessionState()` for new call sites — it is more
 * thorough (also wipes the pending-family refresh token, which can leak
 * across sign-out cycles when a user signs in with a different account
 * before the previous family was fully adopted).
 */
export async function revokeToken(): Promise<void> {
  // Revoke access token via Google's endpoint
  if (accessToken) {
    try {
      await fetch(`${GOOGLE_REVOKE_URL}?token=${accessToken}`, { method: 'POST' });
    } catch {
      // Best-effort revocation
    }
  }

  // Clear stored refresh token
  if (currentFamilyId) {
    await clearGoogleRefreshToken(currentFamilyId);
  }

  clearTokenState();
}

/**
 * Wipe every layer of Google account session state. Safe to call when
 * no session is active (idempotent). Used by both `signOut` paths and
 * `googleDriveProvider.disconnect()` so the same cleanup runs whether
 * the user explicitly signs out or the storage provider is replaced.
 *
 * Local state is cleared synchronously and unconditionally. The network
 * revoke is best-effort and fire-and-forget — a failed revoke does not
 * leave state behind locally, and Google will expire the token on its
 * own anyway. The load-bearing step is removing the refresh token from
 * our storage so subsequent silent-refresh attempts cannot pick it up.
 *
 * Why both keys are cleared: the `__pending__` family slot is used
 * during login-page OAuth before a family is adopted. If a user signs
 * in with account B (joins/creates a different family) and signs out
 * mid-flow, account B's refresh token can survive under `__pending__`
 * and silently log them in as B on the next session. Always clear it.
 */
export async function clearGoogleSessionState(): Promise<void> {
  const tokenSnapshot = accessToken;
  const familyIdSnapshot = currentFamilyId;

  // 1. Clear in-memory state immediately (synchronous, fast).
  clearTokenState();
  currentFamilyId = null;

  // 2. Best-effort fire-and-forget network revoke. Never await.
  if (tokenSnapshot) {
    fetch(`${GOOGLE_REVOKE_URL}?token=${tokenSnapshot}`, { method: 'POST' }).catch(() => {
      // Network errors are expected (offline, slow, etc.) — best-effort.
    });
  }

  // 3. Clear persisted refresh tokens for both the active family AND the
  //    pending-family slot. Promise.allSettled so one failure doesn't
  //    leave the other layer dirty.
  await Promise.allSettled([
    familyIdSnapshot ? clearGoogleRefreshToken(familyIdSnapshot) : Promise.resolve(),
    clearGoogleRefreshToken(PENDING_FAMILY_KEY),
  ]);
}

/**
 * Register a callback to be notified when the token is about to expire
 * and automatic refresh has failed (the scheduled-timer pre-expiry path,
 * after its own retry budget is exhausted with a transient cause). Most
 * consumers want `onTokenPermanentlyExpired` instead — this hook fires
 * for transients too and should not surface user-visible UI on its own.
 * Returns an unsubscribe function.
 */
export function onTokenExpired(callback: ExpiryCallback): () => void {
  expiryCallbacks.push(callback);
  return () => {
    const index = expiryCallbacks.indexOf(callback);
    if (index > -1) expiryCallbacks.splice(index, 1);
  };
}

/**
 * Register a callback for **permanent** silent-refresh failure — fires
 * only when Google returns `invalid_grant` (the refresh token has been
 * revoked, expired permanently, or the user removed app access at
 * accounts.google.com). This is the only legitimate trigger for the
 * reconnect banner — the user must re-auth interactively because no
 * credential we have can recover. Returns an unsubscribe function.
 */
export function onTokenPermanentlyExpired(callback: PermanentFailureCallback): () => void {
  permanentFailureCallbacks.push(callback);
  return () => {
    const index = permanentFailureCallbacks.indexOf(callback);
    if (index > -1) permanentFailureCallbacks.splice(index, 1);
  };
}

/**
 * Register a callback to be notified after every successful access-token
 * acquisition (popup, silent refresh, redirect). Receives the resolved
 * Google account email (best-effort) and the token string.
 *
 * Used by the account-assertion subsystem to verify the acquired token
 * belongs to the expected member's Google account. Subscribers should
 * be idempotent — the same acquisition may fire callbacks more than
 * once if it's part of a forced re-consent loop.
 *
 * Returns an unsubscribe function.
 */
export function onTokenAcquired(callback: AcquiredCallback): () => void {
  acquiredCallbacks.push(callback);
  return () => {
    const index = acquiredCallbacks.indexOf(callback);
    if (index > -1) acquiredCallbacks.splice(index, 1);
  };
}

/**
 * Internal: notify all token-acquisition subscribers. Fires once per
 * successful acquisition. Email is fetched best-effort; null is passed
 * if userinfo cannot be resolved. The `interactive` flag distinguishes
 * user-driven acquisitions (popup, redirect) from background ones
 * (silent refresh). Subscriber errors are logged but never rethrown —
 * one bad subscriber must not break others.
 */
async function notifyTokenAcquired(token: string, interactive: boolean): Promise<void> {
  // Any successful acquisition — silent refresh, popup, redirect — breaks
  // the silent-refresh failure streak. Reset before subscribers run so any
  // future refresh failure starts counting fresh from 0.
  consecutiveSilentRefreshFailures = 0;
  persistFailureCounter(0);

  if (acquiredCallbacks.length === 0) return;
  const email = await fetchGoogleUserEmail(token);
  for (const cb of acquiredCallbacks) {
    try {
      cb(email, token, interactive);
    } catch (e) {
      console.warn('[googleAuth] tokenAcquired callback error:', e);
    }
  }
}

// --- Internal helpers ---

function clearTokenState(): void {
  accessToken = null;
  expiresAt = 0;
  currentRefreshToken = null;
  cachedEmail = null;
  consecutiveSilentRefreshFailures = 0;
  persistFailureCounter(0);

  // Clean up legacy localStorage token (from GIS flow)
  try {
    localStorage.removeItem('gis_token');
  } catch {
    // Ignore
  }

  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function buildAuthUrl(
  clientId: string,
  codeChallenge: string,
  prompt: string,
  loginHint?: string
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: `${DRIVE_FILE_SCOPE} ${USERINFO_EMAIL_SCOPE}`,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt,
  });
  if (loginHint) params.set('login_hint', loginHint);
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Open a blank centered popup synchronously. Must be called in the direct
 * call stack of a user gesture (click/tap) — before any `await` — so that
 * mobile browsers don't block it.
 */
function openBlankPopup(): Window {
  const width = 500;
  const height = 600;
  const left = window.screenX + (window.outerWidth - width) / 2;
  const top = window.screenY + (window.outerHeight - height) / 2;
  const features = `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`;

  const popup = window.open('about:blank', 'beanies-oauth', features);

  if (!popup) {
    throw new Error('Popup blocked — please allow popups for this site');
  }

  return popup;
}

// Hard cap on how long we wait for the OAuth popup to post its code back.
// Popups can navigate to Google, fail, and never post a message — and on
// some browsers `popup.closed` never flips for a popup-blocked-then-orphaned
// window — so without this the promise (and the caller's "connecting…"
// state) would hang forever. 2 minutes is generous for a real user typing
// their Google password.
const POPUP_AUTH_TIMEOUT_MS = 120_000;

/**
 * Navigate an already-open popup to the auth URL and wait for the auth code.
 * Returns the authorization code received via postMessage from the callback
 * page. Rejects if the user closes the popup (`Authentication cancelled`) or
 * if no message arrives within `POPUP_AUTH_TIMEOUT_MS` — the caller surfaces
 * + reports that, rather than wedging.
 */
function waitForAuthCode(popup: Window, url: string): Promise<string> {
  // Navigate the pre-opened blank popup to Google's auth URL
  popup.location.href = url;

  return new Promise((resolve, reject) => {
    // Listen for the callback message
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== 'oauth-callback') return;

      cleanup();

      if (event.data.error) {
        reject(new Error(event.data.error));
        return;
      }

      if (event.data.code) {
        resolve(event.data.code);
        return;
      }

      reject(new Error('No authorization code received'));
    }

    // Poll for popup close (user closed it without completing)
    const pollTimer = setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new Error('Authentication cancelled'));
      }
    }, 500);

    // Hard timeout — never let a stuck/orphaned popup hang the flow.
    const timeoutTimer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Google sign-in didn't return after ${POPUP_AUTH_TIMEOUT_MS / 1000}s — the sign-in window may have been closed or blocked. Try again, or use a local file instead.`
        )
      );
    }, POPUP_AUTH_TIMEOUT_MS);

    function cleanup() {
      window.removeEventListener('message', onMessage);
      clearInterval(pollTimer);
      clearTimeout(timeoutTimer);
      if (!popup.closed) popup.close();
    }

    window.addEventListener('message', onMessage);
  });
}

/**
 * Schedule automatic token refresh 5 minutes before expiry.
 * On failure, fires expiry callbacks as fallback (e.g., show reconnect toast).
 */
function scheduleAutoRefresh(expiresInSeconds: number): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }

  // Refresh 5 minutes before expiry, or immediately if less than 5 min remaining
  const refreshMs = Math.max(0, (expiresInSeconds - 300) * 1000);

  refreshTimer = setTimeout(async () => {
    const refreshed = await attemptSilentRefresh();
    if (refreshed) return;

    // Silent refresh failed — notify subscribers (e.g., show reconnect toast)
    expiryCallbacks.forEach((cb) => {
      try {
        cb();
      } catch (e) {
        console.warn('[googleAuth] Expiry callback error:', e);
      }
    });
  }, refreshMs);
}

/**
 * Fetch the Google account email for the authenticated user.
 * Caches the result in-memory so subsequent calls don't hit the network.
 */
export async function fetchGoogleUserEmail(token: string): Promise<string | null> {
  if (cachedEmail) return cachedEmail;

  try {
    const res = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { email?: string };
    cachedEmail = data.email ?? null;
    return cachedEmail;
  } catch {
    return null;
  }
}

/**
 * Get the cached Google account email. Returns null if not yet fetched.
 */
export function getGoogleAccountEmail(): string | null {
  return cachedEmail;
}

/**
 * Set the cached Google account email (used when restoring from persisted config).
 */
export function setGoogleAccountEmail(email: string | null): void {
  cachedEmail = email;
}

// --- Redirect-based OAuth (mobile fallback) ---

const REDIRECT_AUTH_KEY = 'beanies_redirect_auth';

interface RedirectAuthState {
  codeVerifier: string;
  returnPath: string;
}

/**
 * Start a redirect-based OAuth flow (for mobile where popups are blocked).
 * Saves PKCE state to sessionStorage and redirects the full page to Google.
 * After auth, OAuthCallbackPage redirects back to `returnPath`.
 *
 * @param loginHint Optional email to pre-fill Google's chooser with.
 */
export async function startRedirectAuth(returnPath: string, loginHint?: string): Promise<void> {
  const clientId = getClientId();
  if (!clientId) throw new Error('Google Client ID not configured');

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // Save state for when we come back
  sessionStorage.setItem(
    REDIRECT_AUTH_KEY,
    JSON.stringify({ codeVerifier, returnPath } satisfies RedirectAuthState)
  );

  const authUrl = buildAuthUrl(clientId, codeChallenge, 'select_account', loginHint);
  window.location.href = authUrl;
}

/**
 * Complete a redirect-based OAuth flow. Call on page mount to check if we're
 * returning from a redirect auth. Returns the access token if a pending auth
 * was completed, or null if there was no pending auth.
 */
export async function completeRedirectAuth(): Promise<string | null> {
  const code = sessionStorage.getItem('beanies_redirect_auth_code');
  const stateJson = sessionStorage.getItem(REDIRECT_AUTH_KEY);

  if (!code || !stateJson) return null;

  // Clean up immediately to prevent re-processing
  sessionStorage.removeItem('beanies_redirect_auth_code');
  sessionStorage.removeItem(REDIRECT_AUTH_KEY);

  const clientId = getClientId();
  if (!clientId) throw new Error('Google Client ID not configured');

  const state: RedirectAuthState = JSON.parse(stateJson);

  const tokens = await exchangeCodeForTokens({
    code,
    codeVerifier: state.codeVerifier,
    redirectUri: getRedirectUri(),
    clientId,
  });

  if (tokens.scope && !tokens.scope.includes('drive.file')) {
    throw new Error('Google Drive file access was not granted.');
  }

  // Update in-memory state
  accessToken = tokens.access_token;
  expiresAt = Date.now() + tokens.expires_in * 1000;

  if (tokens.refresh_token) {
    const issuedAt = Date.now();
    currentRefreshToken = { token: tokens.refresh_token, issuedAt };
    const storageKey = currentFamilyId ?? PENDING_FAMILY_KEY;
    await storeGoogleRefreshToken(storageKey, tokens.refresh_token, { issuedAt });
  }

  scheduleAutoRefresh(tokens.expires_in);
  // interactive=true — user just returned from a full-page redirect to
  // Google's consent/chooser screen.
  notifyTokenAcquired(tokens.access_token, true).catch(() => {});

  console.warn(`[googleAuth] Token acquired via redirect PKCE, expires in ${tokens.expires_in}s`);
  return tokens.access_token;
}
