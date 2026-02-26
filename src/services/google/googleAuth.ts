/**
 * Google OAuth 2.0 via Google Identity Services (GIS).
 *
 * Uses the implicit grant flow to obtain an access token with `drive.file` scope.
 * Token is stored in memory only (never persisted — security requirement).
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

// In-memory token state
let accessToken: string | null = null;
let expiresAt: number = 0;
let tokenClient: TokenClient | null = null;

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
 */
export async function requestAccessToken(): Promise<string> {
  const clientId = getClientId();
  if (!clientId) {
    throw new Error(
      'Google Client ID not configured. Set VITE_GOOGLE_CLIENT_ID in your .env file.'
    );
  }

  if (!window.google?.accounts?.oauth2) {
    throw new Error('Google Identity Services not loaded. Call loadGIS() first.');
  }

  // If we have a valid token, return it
  if (isTokenValid()) {
    return accessToken!;
  }

  return new Promise((resolve, reject) => {
    tokenClient = window.google!.accounts!.oauth2!.initTokenClient({
      client_id: clientId,
      scope: DRIVE_FILE_SCOPE,
      callback: (response: TokenResponse) => {
        if (response.error) {
          reject(new Error(response.error_description ?? response.error));
          return;
        }

        accessToken = response.access_token;
        expiresAt = Date.now() + response.expires_in * 1000;

        // Schedule expiry warning (5 min before expiry)
        scheduleExpiryWarning(response.expires_in);

        resolve(response.access_token);
      },
      error_callback: (error) => {
        reject(new Error(error.message ?? 'Google sign-in failed'));
      },
    });

    // Try silent auth first, fall back to consent prompt
    tokenClient.requestAccessToken({ prompt: '' });
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
 * Get a valid access token, refreshing if needed.
 * Use this for API calls that need a guaranteed-valid token.
 */
export async function getValidToken(): Promise<string> {
  if (isTokenValid()) return accessToken!;
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
  if (expiryTimer) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
}

function scheduleExpiryWarning(expiresInSeconds: number): void {
  if (expiryTimer) {
    clearTimeout(expiryTimer);
  }

  // Fire 5 minutes before expiry, or immediately if less than 5 min remaining
  const warningMs = Math.max(0, (expiresInSeconds - 300) * 1000);

  expiryTimer = setTimeout(() => {
    expiryCallbacks.forEach((cb) => {
      try {
        cb();
      } catch (e) {
        console.warn('[googleAuth] Expiry callback error:', e);
      }
    });
  }, warningMs);
}
