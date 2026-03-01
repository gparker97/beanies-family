/**
 * Google OAuth 2.0 via Google Identity Services (GIS).
 *
 * Uses the implicit grant flow to obtain an access token with `drive.file` scope.
 * Token is cached in localStorage so it survives page refreshes and tab
 * close/reopen within the ~1 hour token lifetime. The expiry check
 * (`expires > Date.now()`) handles stale tokens automatically.
 * Dynamically loads the GIS library on first use (zero bundle impact).
 */

// GIS type declarations (minimal — we only use what we need)
interface TokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}

interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type: string; message?: string }) => void;
  }): TokenClient;
  revoke(token: string, callback?: () => void): void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: GoogleOAuth2;
      };
    };
  }
}

const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const USERINFO_EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo';
const SESSION_TOKEN_KEY = 'gis_token';

// In-memory token state (hydrated from sessionStorage on load)
let accessToken: string | null = null;
let expiresAt: number = 0;
let tokenClient: TokenClient | null = null;

// Cached Google account email (fetched after OAuth, cleared on revoke)
let cachedEmail: string | null = null;

// Restore token from localStorage on module load
try {
  const cached = localStorage.getItem(SESSION_TOKEN_KEY);
  if (cached) {
    const { token, expires } = JSON.parse(cached) as { token: string; expires: number };
    if (token && expires > Date.now()) {
      accessToken = token;
      expiresAt = expires;
      // Schedule expiry warning for remaining lifetime
      const remainingSec = Math.floor((expires - Date.now()) / 1000);
      scheduleExpiryWarning(remainingSec);
    } else {
      localStorage.removeItem(SESSION_TOKEN_KEY);
    }
  }
} catch {
  // Ignore parse errors — start fresh
}

// Expiry callbacks
type ExpiryCallback = () => void;
const expiryCallbacks: ExpiryCallback[] = [];
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Check if Google Drive integration is configured (client ID set in env)
 */
export function isGoogleAuthConfigured(): boolean {
  return !!getClientId();
}

function getClientId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
}

/**
 * Load the Google Identity Services script dynamically.
 * No-ops if already loaded.
 */
export async function loadGIS(): Promise<void> {
  if (window.google?.accounts?.oauth2) {
    return; // Already loaded
  }

  return new Promise((resolve, reject) => {
    // Check if script tag already exists
    const existing = document.querySelector(`script[src="${GIS_SCRIPT_URL}"]`);
    if (existing) {
      // Script is loading — wait for it
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () =>
        reject(new Error('Failed to load Google Identity Services'))
      );
      return;
    }

    const script = document.createElement('script');
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
}

/**
 * Request an OAuth access token. Shows Google sign-in prompt if needed.
 * Must be called after loadGIS().
 * Returns the access token or throws on error/cancel.
 *
 * @param options.forceConsent - When true, clears cached token and forces the
 *   Google account chooser (prompt: 'consent'). Use when loading a different
 *   file to let the user pick a different Google account.
 */
export async function requestAccessToken(options?: { forceConsent?: boolean }): Promise<string> {
  const clientId = getClientId();
  if (!clientId) {
    throw new Error(
      'Google Client ID not configured. Set VITE_GOOGLE_CLIENT_ID in your .env file.'
    );
  }

  if (!window.google?.accounts?.oauth2) {
    throw new Error('Google Identity Services not loaded. Call loadGIS() first.');
  }

  // If forcing consent, clear existing token so we don't short-circuit
  if (options?.forceConsent) {
    clearTokenState();
  }

  // If we have a valid token, return it
  if (isTokenValid()) {
    console.warn('[googleAuth] Using cached valid token');
    return accessToken!;
  }

  console.warn(`[googleAuth] Requesting access token (forceConsent=${!!options?.forceConsent})`);

  return new Promise((resolve, reject) => {
    tokenClient = window.google!.accounts!.oauth2!.initTokenClient({
      client_id: clientId,
      scope: `${DRIVE_FILE_SCOPE} ${USERINFO_EMAIL_SCOPE}`,
      callback: (response: TokenResponse) => {
        if (response.error) {
          console.warn(`[googleAuth] Token request error: ${response.error}`);
          reject(new Error(response.error_description ?? response.error));
          return;
        }

        accessToken = response.access_token;
        expiresAt = Date.now() + response.expires_in * 1000;
        console.warn(`[googleAuth] Token acquired, expires in ${response.expires_in}s`);

        // Cache in localStorage so it survives page refreshes and tab close
        persistToken();

        // Schedule expiry warning (5 min before expiry)
        scheduleExpiryWarning(response.expires_in);

        // Fire-and-forget: fetch account email for display purposes
        fetchGoogleUserEmail(response.access_token).catch(() => {});

        resolve(response.access_token);
      },
      error_callback: (error) => {
        console.warn(`[googleAuth] Token error callback: ${error.message ?? error.type}`);
        reject(new Error(error.message ?? 'Google sign-in failed'));
      },
    });

    // Force consent prompt to show account chooser, or try silent auth
    const prompt = options?.forceConsent ? 'consent' : '';
    tokenClient.requestAccessToken({ prompt });
  });
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
 * Attempt a silent token refresh (no popup).
 * Uses GIS `requestAccessToken({ prompt: '' })` which succeeds when the
 * Google session is still active (cookie alive). Returns the new token
 * on success, or `null` if interactive auth is required.
 *
 * Wrapped in a 5-second timeout — silent auth that hangs is treated as failure.
 */
export async function attemptSilentRefresh(): Promise<string | null> {
  const clientId = getClientId();
  if (!clientId || !window.google?.accounts?.oauth2) return null;

  try {
    console.warn('[googleAuth] Attempting silent token refresh...');
    const token = await Promise.race([
      new Promise<string>((resolve, reject) => {
        const client = window.google!.accounts!.oauth2!.initTokenClient({
          client_id: clientId,
          scope: `${DRIVE_FILE_SCOPE} ${USERINFO_EMAIL_SCOPE}`,
          callback: (response: TokenResponse) => {
            if (response.error) {
              reject(new Error(response.error_description ?? response.error));
              return;
            }
            // Update in-memory state
            accessToken = response.access_token;
            expiresAt = Date.now() + response.expires_in * 1000;
            persistToken();
            scheduleExpiryWarning(response.expires_in);
            fetchGoogleUserEmail(response.access_token).catch(() => {});
            resolve(response.access_token);
          },
          error_callback: (error) => {
            reject(new Error(error.message ?? 'Silent refresh failed'));
          },
        });
        client.requestAccessToken({ prompt: '' });
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Silent refresh timeout')), 5000)
      ),
    ]);
    console.warn('[googleAuth] Silent refresh succeeded');
    return token;
  } catch {
    console.warn('[googleAuth] Silent refresh failed');
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
 * Revoke the current access token and clear state.
 */
export function revokeToken(): void {
  if (accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(accessToken, () => {
      // Revocation complete
    });
  }
  clearTokenState();
}

/**
 * Register a callback to be notified when the token is about to expire.
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
  tokenClient = null;
  cachedEmail = null;
  try {
    localStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    // Ignore — localStorage may not be available
  }
  if (expiryTimer) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
}

function persistToken(): void {
  if (!accessToken || !expiresAt) return;
  try {
    localStorage.setItem(
      SESSION_TOKEN_KEY,
      JSON.stringify({ token: accessToken, expires: expiresAt })
    );
  } catch {
    // Ignore — localStorage may not be available (private browsing, etc.)
  }
}

function scheduleExpiryWarning(expiresInSeconds: number): void {
  if (expiryTimer) {
    clearTimeout(expiryTimer);
  }

  // Fire 5 minutes before expiry, or immediately if less than 5 min remaining
  const warningMs = Math.max(0, (expiresInSeconds - 300) * 1000);

  expiryTimer = setTimeout(async () => {
    // Try silent refresh before notifying subscribers
    const refreshed = await attemptSilentRefresh();
    if (refreshed) {
      // Silent refresh succeeded — no need to bother the user
      return;
    }

    // Silent refresh failed — fire expiry callbacks (e.g., show reconnect toast)
    expiryCallbacks.forEach((cb) => {
      try {
        cb();
      } catch (e) {
        console.warn('[googleAuth] Expiry callback error:', e);
      }
    });
  }, warningMs);
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
