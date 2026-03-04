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

/**
 * Check if Google Drive integration is configured (client ID set in env)
 */
export function isGoogleAuthConfigured(): boolean {
  return !!getClientId();
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
 */
export async function requestAccessToken(options?: { forceConsent?: boolean }): Promise<string> {
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

  // Try silent refresh first (if we have a refresh token)
  if (refreshToken) {
    const silentToken = await attemptSilentRefresh();
    if (silentToken) return silentToken;
  }

  // Deduplicate concurrent popup auth flows
  if (pendingAuthPromise) {
    console.warn('[googleAuth] Auth flow already in progress — joining existing request');
    return pendingAuthPromise;
  }

  const promise = performPopupAuth(clientId, options);
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
  options?: { forceConsent?: boolean }
): Promise<string> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const prompt = options?.forceConsent ? 'consent' : 'select_account';
  const authUrl = buildAuthUrl(clientId, codeChallenge, prompt);
  const code = await openAuthPopup(authUrl);

  const tokens = await exchangeCodeForTokens({
    code,
    codeVerifier,
    redirectUri: getRedirectUri(),
    clientId,
  });

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

  // Fire-and-forget: fetch account email
  fetchGoogleUserEmail(tokens.access_token).catch(() => {});

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

/**
 * Attempt a silent token refresh using the stored refresh token.
 * Returns the new access token on success, or null if interactive auth is required.
 */
export async function attemptSilentRefresh(): Promise<string | null> {
  const clientId = getClientId();
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

    // Fetch email if not cached
    fetchGoogleUserEmail(tokens.access_token).catch(() => {});

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
 * Get a valid access token, refreshing if needed.
 * Attempts silent refresh first; falls back to interactive auth.
 */
export async function getValidToken(): Promise<string> {
  if (isTokenValid()) return accessToken!;

  // Try silent refresh first (no popup)
  const silentToken = await attemptSilentRefresh();
  if (silentToken) return silentToken;

  // Fall back to interactive auth
  return requestAccessToken();
}

/**
 * Revoke the current tokens and clear all state.
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

function buildAuthUrl(clientId: string, codeChallenge: string, prompt: string): string {
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
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Open a centered popup for Google OAuth and wait for the auth code.
 * Returns the authorization code received via postMessage from the callback page.
 */
function openAuthPopup(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const width = 500;
    const height = 600;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const features = `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes`;

    const popup = window.open(url, 'beanies-oauth', features);

    if (!popup) {
      reject(new Error('Popup blocked — please allow popups for this site'));
      return;
    }

    // Non-null reference for closures (popup is confirmed non-null above)
    const win = popup;

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
      if (win.closed) {
        cleanup();
        reject(new Error('Authentication cancelled'));
      }
    }, 500);

    function cleanup() {
      window.removeEventListener('message', onMessage);
      clearInterval(pollTimer);
      if (!win.closed) win.close();
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
