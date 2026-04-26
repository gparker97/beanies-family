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
} from '@/services/sync/fileHandleStore';
import { getActiveFamilyId } from '@/services/indexeddb/database';

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
let refreshToken: string | null = null;
let currentFamilyId: string | null = null;

// Deduplication: only one popup auth flow runs at a time.
// Without this, concurrent calls each open the same popup (same window name),
// but generate different PKCE verifiers — the first listener catches the code
// meant for the second verifier, causing "Invalid code verifier" errors.
let pendingAuthPromise: Promise<string> | null = null;

// Cached Google account email
let cachedEmail: string | null = null;

// Expiry callbacks
type ExpiryCallback = () => void;
const expiryCallbacks: ExpiryCallback[] = [];
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

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
 * Whether the current browser should skip popup-based OAuth and use full-page
 * redirect auth instead. Only one case triggers this:
 *
 * **Installed PWA in standalone display-mode** (Chrome on Android, Edge,
 * iOS Safari "Add to Home Screen", etc.). Popups opened from a standalone
 * PWA either fail to open or open in a different browser context —
 * `postMessage` from the OAuth callback can't reach back to the PWA
 * window, so the popup auth flow hangs silently. Redirect auth keeps
 * everything in the PWA's own window.
 *
 * **Why not iOS regular Safari?** A previous version of this function
 * routed all iOS UAs through redirect because the original `/join` page
 * auto-fired OAuth on mount, with no user gesture in the call stack —
 * iOS Safari's popup blocker rejected it. The fix to that was to defer
 * auth to a user-gesture button tap (already shipped). With a real
 * gesture in place, iOS regular Safari allows popups synchronously, and
 * popups don't introduce the ITP top-level navigation that was breaking
 * the Google Picker iframe's auth context after redirect-auth (the
 * cookie-consent → "API developer key invalid" chain). So iOS regular
 * Safari is back on the popup path; only standalone PWAs need redirect.
 *
 * Safe to call at module/SSR time: returns false if `navigator`,
 * `window`, or `matchMedia` is missing.
 */
export function shouldUseRedirectAuth(): boolean {
  if (typeof window === 'undefined') return false;
  // Installed PWA in standalone mode — popup→postMessage bridge is broken.
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // iOS Safari "Add to Home Screen" PWAs use this older flag.
  if ((window.navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
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
 * Initialize auth for a family — loads stored refresh token from IndexedDB.
 * Call this once after login, before any Drive operations.
 */
export async function initializeAuth(familyId: string): Promise<void> {
  currentFamilyId = familyId;
  const stored = await getGoogleRefreshToken(familyId);
  if (stored) {
    refreshToken = stored;
    console.warn('[googleAuth] Loaded refresh token for family', familyId);
  }
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

  // Move to the family-scoped key
  await storeGoogleRefreshToken(familyId, pending);
  await clearGoogleRefreshToken(PENDING_FAMILY_KEY);

  // Update in-memory state
  currentFamilyId = familyId;
  refreshToken = pending;
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
  if (refreshToken) {
    const silentToken = await attemptSilentRefresh();
    if (silentToken) {
      // Don't need the popup after all — close it
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
    refreshToken = tokens.refresh_token;
    const storageKey = currentFamilyId ?? PENDING_FAMILY_KEY;
    await storeGoogleRefreshToken(storageKey, tokens.refresh_token);
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
  if (!refreshToken) {
    const familyId = currentFamilyId ?? getActiveFamilyId();
    if (familyId) {
      const stored = await getGoogleRefreshToken(familyId);
      if (stored) {
        refreshToken = stored;
        currentFamilyId = familyId;
        console.warn('[googleAuth] Recovered refresh token from IndexedDB during silent refresh');
      }
    }
  }

  if (!clientId || !refreshToken) return null;

  try {
    console.warn('[googleAuth] Attempting silent token refresh...');
    const tokens = await refreshAccessToken({
      refreshToken,
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
    return tokens.access_token;
  } catch (e) {
    console.warn('[googleAuth] Silent refresh failed:', (e as Error).message);

    // If the refresh token is revoked/invalid, clear it
    if (
      (e as Error).message.includes('invalid_grant') ||
      (e as Error).message.includes('Token has been expired or revoked')
    ) {
      refreshToken = null;
      if (currentFamilyId) {
        await clearGoogleRefreshToken(currentFamilyId);
      }
    }

    return null;
  }
}

/**
 * Check whether we currently hold a refresh token (in memory).
 * Used by other modules to decide whether to force consent on re-auth.
 */
export function hasRefreshToken(): boolean {
  return !!refreshToken;
}

/**
 * Get a valid access token, refreshing if needed.
 * Attempts silent refresh first; falls back to interactive auth.
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
  return requestAccessToken({ forceConsent: !refreshToken });
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
 * and automatic refresh has failed.
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
  refreshToken = null;
  cachedEmail = null;

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

/**
 * Navigate an already-open popup to the auth URL and wait for the auth code.
 * Returns the authorization code received via postMessage from the callback page.
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

    function cleanup() {
      window.removeEventListener('message', onMessage);
      clearInterval(pollTimer);
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
    refreshToken = tokens.refresh_token;
    const storageKey = currentFamilyId ?? PENDING_FAMILY_KEY;
    await storeGoogleRefreshToken(storageKey, tokens.refresh_token);
  }

  scheduleAutoRefresh(tokens.expires_in);
  // interactive=true — user just returned from a full-page redirect to
  // Google's consent/chooser screen.
  notifyTokenAcquired(tokens.access_token, true).catch(() => {});

  console.warn(`[googleAuth] Token acquired via redirect PKCE, expires in ${tokens.expires_in}s`);
  return tokens.access_token;
}
