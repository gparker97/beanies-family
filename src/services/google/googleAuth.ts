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
import { encodeRedirectState, type RedirectMode } from './redirectState';
import {
  storeGoogleRefreshToken,
  getGoogleRefreshToken,
  clearGoogleRefreshToken,
  type StoredRefreshToken,
} from '@/services/sync/fileHandleStore';
import { getActiveFamilyId } from '@/services/indexeddb/database';
import { reportError } from '@/utils/errorReporter';
import { logEvent } from '@/services/telemetry';
import { DriveConsentDeniedError } from '@/types/sync';
import { Browser } from '@capacitor/browser';
import { App as CapacitorApp, type URLOpenListenerEvent } from '@capacitor/app';
import { isNative, isIosOrIpadOs, isStandalone } from '@/services/sync/capabilities';

const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const USERINFO_EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

// Key used to temporarily store a refresh token before a family is active
const PENDING_FAMILY_KEY = '__pending__';

// Native OAuth redirect — a verified https App Link, NOT a custom scheme. The
// existing OAuth client is a Web-application type, which rejects custom schemes
// ("must use either http or https"); the App Link is routed back into the app
// via a hosted /.well-known/assetlinks.json. See ADR-029.
const NATIVE_REDIRECT_URI = 'https://beanies.family/oauth/native';

// Shared sessionStorage key for the one-time OAuth code, written by the web
// callback (OAuthCallbackPage) AND the native deep-link handler, and read+cleared
// by completeRedirectAuth. One named symbol so the two transports can't drift.
export const REDIRECT_AUTH_CODE_KEY = 'beanies_redirect_auth_code';

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

// Session-epoch guard. Bumped exactly once per session teardown
// (`clearGoogleSessionState` / `revokeToken`). Each async token-acquisition seam
// snapshots it at the start and discards its result if the epoch advanced while
// the network round-trip was in flight — so a token that resolves AFTER a
// sign-out can never be committed into the cleared (or next) session. See
// docs/plans/2026-06-14-session-epoch-guard-google-token.md.
let sessionEpoch = 0;

/** Current session epoch — consumed by driveTokenRecovery to guard its
 *  doc→local adopt boundary across an async read. */
export function getSessionEpoch(): number {
  return sessionEpoch;
}

/**
 * True if the session that started an acquisition (its `epochAtStart`) is still
 * current. On a stale epoch (a sign-out/teardown interleaved): best-effort revoke
 * the just-issued access token — a live Google credential that must die with the
 * session — and return false so the caller discards WITHOUT committing. The
 * `logEvent` (level 'info' — an EXPECTED discard) makes it observable, never a
 * silent drop. (The level 'error' `auth-epoch-leak` backstop in
 * `notifyTokenAcquired` is the separate "a guard was MISSED" signal.)
 */
function isSessionStillCurrent(epochAtStart: number, accessTokenToRevoke: string): boolean {
  if (epochAtStart === sessionEpoch) return true;
  fetch(`${GOOGLE_REVOKE_URL}?token=${accessTokenToRevoke}`, { method: 'POST' }).catch(() => {});
  logEvent({
    level: 'info',
    surface: 'auth-epoch-discard',
    message: 'discarded a Google token that resolved after sign-out (session epoch advanced)',
  });
  return false;
}

/**
 * Cancellation-shaped message used when an interactive acquisition is discarded
 * because the session was torn down mid-flow. `performPopupAuth` returns `string`
 * (string-or-throw), so it routes a discard through this channel; `isUserCancellation`
 * matches `user_cancel`, so callers treat it as benign abandonment. Centralized here
 * (one named constant) rather than re-derived as an inline literal at the throw site.
 */
const SESSION_DISCARDED_CANCEL = 'user_cancel: signed out during sign-in — token discarded';

/**
 * The single token-commit chokepoint shared by the three *persisting* acquisition
 * seams (silent auth-code, popup, redirect). Centralizes, in one place a future
 * seam can't skip: the pre-commit epoch re-check, the in-memory + IndexedDB writes,
 * the POST-PERSIST epoch re-check + rollback, the auto-refresh schedule, and the
 * subscriber notify.
 *
 * Post-persist rollback closes a TOCTOU: `storeGoogleRefreshToken` (db.put) and a
 * concurrent sign-out's `clearGoogleRefreshToken` (db.delete) are independent
 * auto-committing IDB ops on the same key, so a sign-out landing *during* the put
 * could leave a refresh token on disk for a torn-down session (a cold-start zombie).
 * Re-checking the epoch after the await and clearing on a stale epoch prevents that.
 *
 * Behaviour keyed on `interactive`:
 *  - interactive (popup/redirect, prompt=consent): a persist failure THROWS (the
 *    caller surfaces it); a missing refresh token is reported (consent should yield one).
 *  - silent (auth-code): a persist failure is swallowed + logged (non-critical — the
 *    next cold start just can't silent-refresh); a missing refresh token is expected.
 *
 * The seam still owns its own pre-exchange scope check and `epochAtStart` snapshot —
 * this helper is the commit step only.
 *
 * @returns `{ committed: true, token }` on success, or `{ committed: false }` when the
 *   session was torn down (the access token was best-effort revoked by
 *   `isSessionStillCurrent`/the rollback, and any persisted refresh token rolled back).
 */
async function commitAcquiredToken(args: {
  tokens: { access_token: string; expires_in: number; refresh_token?: string };
  interactive: boolean;
  epochAtStart: number;
  storageKey: string;
}): Promise<{ committed: true; token: string } | { committed: false }> {
  const { tokens, interactive, epochAtStart, storageKey } = args;

  // Pre-commit guard: discard if a sign-out cleared the session while the exchange
  // was in flight (best-effort revoke + info log happen inside isSessionStillCurrent).
  if (!isSessionStillCurrent(epochAtStart, tokens.access_token)) return { committed: false };

  accessToken = tokens.access_token;
  expiresAt = Date.now() + tokens.expires_in * 1000;

  let wrotePersisted = false;
  if (tokens.refresh_token) {
    const issuedAt = Date.now();
    currentRefreshToken = { token: tokens.refresh_token, issuedAt };
    try {
      await storeGoogleRefreshToken(storageKey, tokens.refresh_token, { issuedAt });
      wrotePersisted = true;
    } catch (e) {
      if (interactive) throw e; // surface to the caller (existing popup/redirect behaviour)
      // Silent: non-critical — the next cold start just can't silent-refresh. Surface
      // to the firehose to catch IDB-write regressions before reconnect-banner cascades.
      console.warn('[googleAuth] silent: failed to persist refresh token (non-critical)', e);
      logEvent({
        level: 'warn',
        surface: 'refresh-token-persist',
        message: `silent: failed to persist refresh token: ${e instanceof Error ? e.message : String(e)}`,
        error: e,
        context: { action: 'persist-refresh-token' },
      });
    }
  } else if (interactive) {
    // Consent should have returned a refresh token; if not, offline access wasn't
    // established. Surface instead of silently continuing.
    reportError({
      surface: 'auth-no-refresh-token',
      severity: 'warning',
      message: 'interactive auth returned no refresh token; offline access not established',
    });
  }

  // Post-persist re-check (closes the persist-ordering TOCTOU). An advanced epoch
  // means a sign-out interleaved during the IDB write above — roll back: revoke the
  // live access token, clear the just-written refresh token, and null in-memory. No
  // subscriber/email side-effects have run yet, so there is nothing else to undo.
  if (epochAtStart !== sessionEpoch) {
    fetch(`${GOOGLE_REVOKE_URL}?token=${tokens.access_token}`, { method: 'POST' }).catch(() => {});
    if (wrotePersisted) {
      try {
        await clearGoogleRefreshToken(storageKey);
      } catch (e) {
        console.warn('[googleAuth] post-persist rollback: failed to clear refresh token', e);
      }
    }
    accessToken = null;
    expiresAt = 0;
    currentRefreshToken = null;
    logEvent({
      level: 'info',
      surface: 'auth-epoch-discard',
      message:
        'discarded a Google token whose session was torn down during the refresh-token persist (post-persist rollback)',
    });
    return { committed: false };
  }

  scheduleAutoRefresh(tokens.expires_in);
  // Fire-and-forget: never block token return on subscriber work. The epoch-leak
  // backstop inside notifyTokenAcquired stays as the "a guard was MISSED" signal.
  notifyTokenAcquired(tokens.access_token, interactive, epochAtStart).catch(() => {});

  return { committed: true, token: tokens.access_token };
}

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
  // Native (Capacitor): popups can't bridge postMessage back into the WebView,
  // and Google redirects to the verified App Link which the OS routes into the
  // app (appUrlOpen) — never to a popup. iOS/iPadOS WebKit: popup/new-tab OAuth
  // is fragile. Installed/standalone PWA: the popup→postMessage bridge is broken.
  // This is the single source of truth for "use redirect auth"; callers must not
  // re-test these separately. Detection primitives live in capabilities.ts.
  // See ADR-029.
  return isNative() || isIosOrIpadOs() || isStandalone();
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

/**
 * Prime the in-memory refresh token (and family id) so the next
 * `attemptSilentRefresh()` uses it. Pure state setter — no I/O, no recovery
 * logic — exposed so `driveTokenRecovery` can seed a refresh token recovered
 * from the encrypted beanpod before a silent refresh, without reaching into
 * this module's private state. The caller is responsible for also persisting it
 * to the local store (`storeGoogleRefreshToken`) if it should survive a reload.
 */
export function primeRefreshToken(familyId: string, stored: StoredRefreshToken): void {
  currentFamilyId = familyId;
  currentRefreshToken = stored;
}

function getClientId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
}

function getRedirectUri(): string {
  // Native uses the verified App Link (registered on the Web OAuth client);
  // both buildAuthUrl and the token exchange call this, so they always agree
  // (a mismatch ⇒ redirect_uri_mismatch). See ADR-029.
  if (isNative()) return NATIVE_REDIRECT_URI;
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
  } else {
    // Family key empty — rescue a token orphaned under __pending__ by a
    // redirect-auth reconnect (completeRedirectAuth stores under __pending__
    // when the family isn't bound yet at App-init Step 2b). This is the
    // self-heal path; it runs on every cold boot via syncStore.initialize().
    // Wrap ONLY the migrate call: `getGoogleRefreshToken` above already reports
    // its own IDB read errors, and syncStore.initialize() only console.warns an
    // initializeAuth rejection — without this we'd lose the firehose signal.
    try {
      const rescued = await migratePendingRefreshToken(familyId);
      if (rescued) {
        logEvent({
          level: 'info',
          surface: 'auth-init',
          message: 'rescued orphaned pending refresh token → family key',
          context: { family_id: familyId },
        });
      } else {
        logEvent({
          level: 'warn',
          surface: 'auth-init',
          message: 'startup: no refresh token under family or pending key',
          context: { family_id: familyId },
        });
      }
    } catch (e) {
      reportError({
        surface: 'auth-init',
        message: 'pending-token rescue failed',
        error: e,
      });
    }
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
export async function migratePendingRefreshToken(familyId: string): Promise<boolean> {
  const pending = await getGoogleRefreshToken(PENDING_FAMILY_KEY);
  if (!pending) return false;

  // INVARIANT: migrate ONLY when the family key is empty — never clobber a good
  // family token with a (possibly stale) pending one. A redirect-auth reconnect
  // writes a FRESH token under __pending__ while the family key is empty (the
  // bad token, if any, was already cleared on invalid_grant), so this guard
  // still migrates the case that matters. See the 2026-05-20 plan.
  const existing = await getGoogleRefreshToken(familyId);
  if (existing) return false;

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
  return true;
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
  const epochAtStart = sessionEpoch;
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

    // Commit via the shared chokepoint (epoch re-check → persist → post-persist
    // rollback → schedule → notify). interactive=false: a missing refresh token is
    // expected for silent flows and a persist failure is non-fatal.
    const result = await commitAcquiredToken({
      tokens,
      interactive: false,
      epochAtStart,
      storageKey: currentFamilyId ?? PENDING_FAMILY_KEY,
    });
    if (!result.committed) return null;

    console.info(
      `[googleAuth] silent auth-code succeeded — token acquired without consent prompt (expires in ${tokens.expires_in}s)`
    );
    return result.token;
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
  const epochAtStart = sessionEpoch;
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
    // Typed so callers branch on `instanceof` and route the user to a clear
    // "allow file access" reconnect prompt rather than a silent dead-end
    // (2026-06-19, finding 3).
    throw new DriveConsentDeniedError(
      'Google Drive file access was not granted. Please allow file access when prompted.'
    );
  }

  // Commit via the shared chokepoint. interactive=true: a persist failure throws
  // (surfaced to the caller) and a missing refresh token is reported. Interactive
  // connect/reconnect callers force prompt=consent, so Google returns a
  // refresh_token; when no family is active yet (login page) it is stored under the
  // pending key so it survives the page refresh (see `initializeAuth`).
  const result = await commitAcquiredToken({
    tokens,
    interactive: true,
    epochAtStart,
    storageKey: currentFamilyId ?? PENDING_FAMILY_KEY,
  });
  if (!result.committed) {
    // Signed out mid-flow — benign. This function's contract is string-or-throw, so
    // route the discard through the shared cancellation channel (isUserCancellation
    // matches SESSION_DISCARDED_CANCEL); callers treat it as abandonment. The access
    // token was already best-effort revoked inside commitAcquiredToken.
    throw new Error(SESSION_DISCARDED_CANCEL);
  }

  console.warn(`[googleAuth] Token acquired via PKCE, expires in ${tokens.expires_in}s`);
  return result.token;
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
  const epochAtStart = sessionEpoch;
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
      // Re-check per attempt: a concurrent sign-out / clearTokenState() can null
      // `currentRefreshToken` DURING a backoff sleep between attempts (2026-06-19,
      // finding 10). The pre-loop guard only covers attempt 1; without this, a
      // later iteration would dereference null via the `!` below, throw a
      // TypeError, and get MISCLASSIFIED as a transient failure — inflating the
      // consecutive-failure counter toward a false reconnect-banner escalation
      // for a session that no longer exists. A torn-down session is not a
      // refresh failure: bail cleanly.
      if (!currentRefreshToken) {
        console.warn('[googleAuth] Silent refresh aborted: session torn down mid-retry');
        return null;
      }
      const tokenAtAttempt = currentRefreshToken.token;
      const tokens = await refreshAccessToken({
        refreshToken: tokenAtAttempt,
        clientId,
      });

      // Discard if a sign-out cleared the session while the refresh was in flight.
      if (!isSessionStillCurrent(epochAtStart, tokens.access_token)) return null;

      accessToken = tokens.access_token;
      expiresAt = Date.now() + tokens.expires_in * 1000;

      // Schedule next auto-refresh
      scheduleAutoRefresh(tokens.expires_in);

      // Notify subscribers (assertion + telemetry hooks). Fire-and-forget.
      // interactive=false — background refresh, no user gesture involved.
      notifyTokenAcquired(tokens.access_token, false, epochAtStart).catch(() => {});

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
  // CLASSIFICATION CONTRACT: the message must contain "silent refresh failed".
  // syncStore's `isAuthTransientSyncError` (/silent refresh failed/i) matches it
  // to classify a failed `loadFromFile()` as a token-expiry so the sign-in flow
  // can offer a focused reconnect. The explicit-message variant in
  // googleDriveProvider.read() ("…token rejected and silent refresh failed")
  // shares the phrase. Keep the phrase if you change this message.
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
  // Session teardown: bump the epoch so any in-flight acquisition discards its
  // result, and clear any pending redirect-auth intent (Req 6).
  sessionEpoch++;
  clearRedirectIntent();

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
export async function clearGoogleSessionState(
  options: { preserveRefreshToken?: boolean } = {}
): Promise<void> {
  // `preserveRefreshToken` keeps the ACTIVE family's persisted refresh token so
  // a re-login on the same device can silently reconnect to Drive without an
  // interactive reauth prompt. Used for trusted-device sign-out (mirrors the
  // IndexedDB cache, which is likewise preserved on trusted devices). The
  // pending-family slot is ALWAYS cleared and the network revoke is skipped
  // when preserving, so the surviving grant stays valid. Default (false) is the
  // full teardown used by shared-device sign-out and `disconnect()`.
  const { preserveRefreshToken = false } = options;

  // Session teardown: bump the epoch FIRST so any acquisition in flight discards
  // its result, and clear any pending redirect-auth intent (Req 6).
  sessionEpoch++;
  clearRedirectIntent();

  const tokenSnapshot = accessToken;
  const familyIdSnapshot = currentFamilyId;

  // 1. Clear in-memory state immediately (synchronous, fast).
  clearTokenState();
  currentFamilyId = null;

  // 2. Best-effort fire-and-forget network revoke. Never await. Skipped when
  //    preserving — revoking the grant would invalidate the refresh token we
  //    are deliberately keeping for a silent reconnect.
  //
  //    SECURITY NOTE (2026-06-19, finding 8 — reviewed, intended): on a trusted
  //    device this leaves the OAuth grant LIVE at Google after sign-out. That is
  //    deliberate — it's the whole point of trusted-device preservation (commit
  //    1e8090f7) and mirrors the preserved IndexedDB cache. The user-facing
  //    "revoke everything" escape hatch is `authStore.signOutAndClearData()`,
  //    which calls this WITHOUT preserveRefreshToken (full network revoke) AND
  //    deletes the local cache + resets the trust flag. See ADR-031.
  if (tokenSnapshot && !preserveRefreshToken) {
    fetch(`${GOOGLE_REVOKE_URL}?token=${tokenSnapshot}`, { method: 'POST' }).catch(() => {
      // Network errors are expected (offline, slow, etc.) — best-effort.
    });
  }

  // 3. Clear persisted refresh tokens. The pending-family slot is ALWAYS
  //    cleared (it can hold a wrong account mid-login — see header). The active
  //    family's token is cleared unless we're preserving the connection.
  //    Promise.allSettled so one failure doesn't leave the other layer dirty.
  await Promise.allSettled([
    familyIdSnapshot && !preserveRefreshToken
      ? clearGoogleRefreshToken(familyIdSnapshot)
      : Promise.resolve(),
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
async function notifyTokenAcquired(
  token: string,
  interactive: boolean,
  expectedEpoch: number
): Promise<void> {
  // Single-chokepoint backstop: every guarded seam returns BEFORE reaching here
  // when its epoch went stale, so a stale epoch observed here means a commit path
  // skipped its `isSessionStillCurrent` guard (e.g. a future 5th acquisition seam
  // added without it). Log loudly and return immediately — before the
  // failure-counter reset and subscriber fan-out below — so a leaked stale
  // acquisition has no side effects beyond this error signal. By design
  // unreachable; reaching it IS the regression signal.
  if (expectedEpoch !== sessionEpoch) {
    logEvent({
      level: 'error',
      surface: 'auth-epoch-leak',
      message:
        'a Google token reached notifyTokenAcquired with a stale session epoch — a commit path is missing its guard',
    });
    return;
  }

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

/** Test-only: exercise `notifyTokenAcquired`'s epoch-leak backstop directly
 *  (the branch is unreachable via the guarded seams by design). */
export function __notifyTokenAcquiredForTesting(
  token: string,
  interactive: boolean,
  expectedEpoch: number
): Promise<void> {
  return notifyTokenAcquired(token, interactive, expectedEpoch);
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
  codeChallenge: string | undefined,
  prompt: string,
  loginHint?: string,
  state?: string
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: `${DRIVE_FILE_SCOPE} ${USERINFO_EMAIL_SCOPE}`,
    access_type: 'offline',
    prompt,
  });
  // PKCE challenge — set for popup / silent / native (they always pass one).
  // The iOS web redirect passes NONE: the confidential OAuth proxy adds
  // `client_secret` server-side, so PKCE is not load-bearing there, and the
  // verifier can't survive WebKit bounce-tracking storage clearing anyway.
  // See ADR-026 amendment (2026-06-20).
  if (codeChallenge) {
    params.set('code_challenge', codeChallenge);
    params.set('code_challenge_method', 'S256');
  }
  if (loginHint) params.set('login_hint', loginHint);
  // `state` — carries the NATIVE CSRF token, OR the WEB routing payload
  // (returnPath+mode, encoded via redirectState.ts). The two transports never
  // collide: native sets a CSRF nonce + writes its own sessionStorage stash;
  // web sets the routing payload + writes NO stash.
  if (state) params.set('state', state);
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

/**
 * Clear any pending redirect-auth intent. Called on session teardown so an
 * abandoned/signed-out redirect finds no intent when it returns post-reload and
 * `completeRedirectAuth` no-ops — the redirect equivalent of the in-memory epoch
 * guard, which cannot bridge a full page reload.
 *
 * Residual limitation (by design, not a regression): the `sessionEpoch` counter is
 * in-memory and resets to 0 on a full reload, so it cannot guard a redirect that
 * returns *after* a reload. Clearing the intent keys here is the only bridge. If the
 * removal itself fails (private-mode / disabled storage), an abandoned intent can
 * survive the reload and be completed into a torn-down session — so we surface the
 * failure (warn + reportError) rather than swallowing it. This reduces, but cannot
 * fully eliminate, the cross-reload window.
 */
function clearRedirectIntent(): void {
  try {
    sessionStorage.removeItem(REDIRECT_AUTH_CODE_KEY);
    sessionStorage.removeItem(REDIRECT_AUTH_KEY);
  } catch (e) {
    console.warn('[googleAuth] failed to clear redirect-auth intent on teardown', e);
    reportError({
      surface: 'redirect-intent-clear',
      severity: 'warning',
      message:
        'Failed to clear pending redirect-auth intent on teardown; an abandoned redirect could complete after a reload',
      error: e instanceof Error ? e : new Error(String(e)),
    });
  }
}

interface RedirectAuthState {
  codeVerifier: string;
  returnPath: string;
  /** CSRF state — present only for the native deep-link transport (absent on web). */
  state?: string;
}

/**
 * Start a redirect-based OAuth flow (for mobile where popups are blocked).
 * After auth, OAuthCallbackPage redirects back to `returnPath`.
 *
 * INVARIANT: redirect auth ALWAYS forces `prompt=consent`. Every caller
 * establishes offline Drive access (reconnect, connect-pod, switch-account,
 * re-pick a .beanpod), and Google only returns a refresh_token with
 * prompt=consent + access_type=offline. Do not change to 'select_account'
 * without an explicit non-offline caller.
 * See docs/plans/2026-05-20-google-refresh-token-persistence-fix.md.
 *
 * @param returnPath Same-origin relative path to land on after the redirect.
 * @param loginHint  Optional email to pre-fill Google's chooser with.
 * @param mode       Which onboarding flow this is (create/join/reconnect).
 *                   REQUIRED so the compiler flags every call site; carried in
 *                   the web `state` payload (ignored for native routing).
 */
export async function startRedirectAuth(
  returnPath: string,
  loginHint: string | undefined,
  mode: RedirectMode
): Promise<void> {
  const clientId = getClientId();
  if (!clientId) throw new Error('Google Client ID not configured');

  if (isNative()) {
    // NATIVE: opens the system browser and returns via a verified App Link deep
    // link. Native storage is NOT bounce-cleared (the OS routes the deep-link
    // back into this WebView), so it keeps PKCE + a CSRF `state` nonce
    // (defense-in-depth atop the verified link; ADR-029) + the sessionStorage
    // stash. `mode` is not used for native routing — `returnPath` rides in the
    // stash. `generateCodeVerifier()` is a CSPRNG high-entropy string.
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateCodeVerifier();
    sessionStorage.setItem(
      REDIRECT_AUTH_KEY,
      JSON.stringify({ codeVerifier, returnPath, state } satisfies RedirectAuthState)
    );
    const authUrl = buildAuthUrl(clientId, codeChallenge, 'consent', loginHint, state);
    // Resolves immediately; the redirect returns via the appUrlOpen listener.
    await Browser.open({ url: authUrl });
    return;
  }

  // WEB (iOS Safari / installed PWA): carry the routing through the OAuth
  // `state` param so it survives WebKit bounce-tracking storage clearing across
  // the cross-site redirect (app → accounts.google.com → app). Write NO
  // sessionStorage stash and use NO PKCE verifier.
  //
  // INVARIANT (do not break): no `code_verifier` on this path is safe ONLY
  // because the confidential OAuth proxy adds `client_secret` server-side, so an
  // intercepted code can't be redeemed. If any token exchange ever bypasses that
  // proxy, PKCE MUST return here. See ADR-026 amendment (2026-06-20).
  const stateParam = encodeRedirectState({ returnPath, mode });
  const authUrl = buildAuthUrl(clientId, undefined, 'consent', loginHint, stateParam);
  window.location.href = authUrl;
}

/**
 * Complete a redirect-based OAuth flow. Call on page mount to check if we're
 * returning from a redirect auth. Returns the access token if a pending auth
 * was completed, or null if there was no pending auth.
 */
export async function completeRedirectAuth(): Promise<string | null> {
  // Snapshot captures a same-page-load teardown during the code exchange below.
  // (The cross-reload orphan case — sign-out before the redirect returns — is
  // handled separately: teardown clears the intent keys, so the read above
  // finds nothing and we no-op.)
  const epochAtStart = sessionEpoch;
  const code = sessionStorage.getItem(REDIRECT_AUTH_CODE_KEY);
  const stateJson = sessionStorage.getItem(REDIRECT_AUTH_KEY);

  // The new web transport carries routing in the OAuth `state` param (consumed
  // by OAuthCallbackPage) and leaves NO sessionStorage stash, so a present
  // `code` with no stash is the happy path — not a no-op. Only a missing `code`
  // means "nothing to complete."
  if (!code) return null;

  // Clean up immediately to prevent re-processing
  sessionStorage.removeItem(REDIRECT_AUTH_CODE_KEY);
  sessionStorage.removeItem(REDIRECT_AUTH_KEY);

  const clientId = getClientId();
  if (!clientId) throw new Error('Google Client ID not configured');

  // Two arms (there is no third):
  //  - LEGACY web (pre-bounce-fix, one release) OR NATIVE hand-off — a stash
  //    with a `codeVerifier` is present → exchange WITH the verifier (PKCE).
  //  - NEW web — no stash → exchange WITHOUT a verifier (the confidential proxy
  //    secures the code via client_secret).
  // LEGACY (remove after 2026-09-30): the `stateJson`/`codeVerifier` arm exists
  // only to complete in-flight redirects started by the pre-bounce-fix build.
  // The NATIVE hand-off ALSO uses this stash, so removing it must keep the
  // native arm — see redirectState tripwire test.
  let codeVerifier: string | undefined;
  if (stateJson) {
    try {
      const state: RedirectAuthState = JSON.parse(stateJson);
      codeVerifier = state.codeVerifier;
    } catch (e) {
      // A corrupt stash must not strand the user — fall through to the
      // no-verifier exchange (the confidential proxy still secures the code).
      console.warn('[googleAuth] redirect-auth stash unparseable; exchanging without verifier', e);
    }
  }

  const tokens = await exchangeCodeForTokens({
    code,
    codeVerifier,
    redirectUri: getRedirectUri(),
    clientId,
  });

  if (tokens.scope && !tokens.scope.includes('drive.file')) {
    // Typed so the App.vue boot redirect-completion path can branch on
    // `instanceof` and route to the consent-denied reconnect screen
    // (2026-06-19, finding 3) instead of a silent dead-end.
    throw new DriveConsentDeniedError('Google Drive file access was not granted.');
  }

  // Commit via the shared chokepoint. interactive=true: a persist failure throws and
  // a missing refresh token is reported (`startRedirectAuth` forces prompt=consent, so
  // a refresh_token should be present).
  const result = await commitAcquiredToken({
    tokens,
    interactive: true,
    epochAtStart,
    storageKey: currentFamilyId ?? PENDING_FAMILY_KEY,
  });
  if (!result.committed) return null;

  console.warn(`[googleAuth] Token acquired via redirect PKCE, expires in ${tokens.expires_in}s`);
  return result.token;
}

// ─── Native (Capacitor) deep-link OAuth completion ──────────────────────────
// On native, startRedirectAuth opens the system browser; Google redirects to
// the verified App Link (NATIVE_REDIRECT_URI), which the OS routes back into the
// app as an `appUrlOpen` event. This listener validates the CSRF `state`, hands
// the code to the shared completeRedirectAuth(), then asks the host (App.vue) to
// navigate to the stored returnPath — the same resume-setup continuation the web
// full-page redirect produces. The @capacitor/browser + @capacitor/app plugin
// usage is confined to this module (ADR-029).

let nativeAuthListenerInstalled = false;
let nativeAuthListenerHandle: { remove: () => Promise<void> } | null = null;

/**
 * Install the native OAuth deep-link listener. Idempotent (mirrors
 * `installAuthWakeListener`'s guard, so a future `App.vue` remount can't stack a
 * second listener that double-consumes the code). `onComplete(returnPath)` runs
 * after a successful exchange so the host can navigate — kept out of this
 * service to avoid a router import / layering cycle. No-op on web.
 */
export function installNativeAuthListener(onComplete: (returnPath: string) => void): void {
  if (nativeAuthListenerInstalled) return;
  if (!isNative()) return;
  nativeAuthListenerInstalled = true;

  void CapacitorApp.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
    void handleNativeAuthRedirect(event.url, onComplete);
  }).then((handle) => {
    nativeAuthListenerHandle = handle;
  });
}

/** Handle one `appUrlOpen`. Exported for unit tests; not part of the public API. */
export async function handleNativeAuthRedirect(
  url: string,
  onComplete: (returnPath: string) => void
): Promise<void> {
  // Only our OAuth redirect; ignore any other deep link.
  if (!url.startsWith(NATIVE_REDIRECT_URI)) return;

  let params: URLSearchParams;
  try {
    params = new URL(url).searchParams;
  } catch {
    return; // malformed URL — nothing actionable
  }
  const code = params.get('code');
  const error = params.get('error');
  const returnedState = params.get('state');

  const stateJson = sessionStorage.getItem(REDIRECT_AUTH_KEY);
  // Close the system browser tab (best-effort — it may already be gone).
  await Browser.close().catch(() => {});

  // No native auth in flight (cold-launch by a stray/duplicate/spoofed link):
  // benign — never drive an exchange off an unexpected link.
  if (!stateJson) {
    logEvent({
      level: 'info',
      surface: 'native-oauth',
      message: 'deep link with no pending auth — ignored',
    });
    return;
  }

  // OAuth error on the redirect (most commonly access_denied = user declined
  // consent): benign — clear pending state, no reportError.
  if (error) {
    await clearGoogleSessionState();
    logEvent({
      level: 'info',
      surface: 'native-oauth',
      message: `oauth declined/error on deep link: ${error}`,
    });
    return;
  }

  const stored: RedirectAuthState = JSON.parse(stateJson);

  // CSRF: the echoed state must match what we stored. Mismatch ⇒ discard.
  if (!stored.state || stored.state !== returnedState) {
    await clearGoogleSessionState();
    reportError({
      surface: 'native-oauth-state-mismatch',
      severity: 'error',
      message: 'native OAuth deep-link state mismatch — code discarded',
    });
    return;
  }

  if (!code) {
    await clearGoogleSessionState();
    reportError({
      surface: 'native-oauth',
      severity: 'error',
      message: 'native OAuth deep link had neither code nor error',
    });
    return;
  }

  // Hand the code to the shared completion (the same exchange the web flow runs).
  sessionStorage.setItem(REDIRECT_AUTH_CODE_KEY, code);
  try {
    await completeRedirectAuth();
    onComplete(stored.returnPath);
  } catch (e) {
    reportError({
      surface: 'native-oauth',
      severity: 'error',
      message: 'native OAuth code exchange failed',
      error: e,
    });
    // Land on the recovery surface so the user can retry — matches web, which
    // always returns to returnPath after the full-page redirect.
    onComplete(stored.returnPath);
  }
}

/** Test-only — remove the native auth listener + reset install state. */
export function __resetNativeAuthForTesting(): void {
  void nativeAuthListenerHandle?.remove();
  nativeAuthListenerHandle = null;
  nativeAuthListenerInstalled = false;
}
