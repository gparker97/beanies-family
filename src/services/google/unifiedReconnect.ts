/**
 * Unified Drive + Calendar reconnect (tracker #62, commit 5).
 *
 * When both the Drive grant and one or more same-account Calendar connections are
 * disconnected, a single Google consent for the UNION of scopes restores both in
 * one round-trip — one grant against Google's per-account token cap, one screen.
 *
 * Design (see docs/plans/2026-08-14-unified-drive-calendar-reconnect.md):
 *  - The unified consent is an ordinary **Drive** grant that carries calendar
 *    scopes. It rides the existing Drive transport (popup / redirect / native)
 *    unchanged — no new grant tag, no new OAuth routing, and the existing Drive
 *    revoke-before-mint revokes the shared grant exactly once.
 *  - Calendar is restored by a **post-completion fan-out**: after the Drive
 *    completion commits the refresh token, we read it back from the Drive home and
 *    write it into every same-account `needs_reconnect` CalendarConnection. There
 *    is exactly ONE code exchange (inside the Drive completion) and N CRDT writes.
 */

import {
  DRIVE_SCOPES,
  requestAccessToken,
  shouldUseRedirectAuth,
  startRedirectAuth,
  ensureVerifiedGoogleAccountEmail,
} from '@/services/google/googleAuth';
import { CALENDAR_SCOPES } from '@/services/calendar/calendarAuth';
import { getGoogleRefreshToken } from '@/services/sync/fileHandleStore';
import { getActiveFamilyId } from '@/services/indexeddb/database';
import { useCalendarSyncStore } from '@/stores/calendarSyncStore';
import { logEvent } from '@/services/telemetry';
import { reportError } from '@/utils/errorReporter';

/** Deduped union of the Drive + Calendar scope sets for one combined consent. */
export const UNIFIED_SCOPES = Array.from(
  new Set([...DRIVE_SCOPES.split(' '), ...CALENDAR_SCOPES])
).join(' ');

/** Query flag on the post-redirect `returnPath` that tells the unified resume to
 *  fan the just-restored Drive token out to calendar. */
export const UNIFIED_RESUME_KEY = 'unifiedResume';

/** The current location, marked so the unified resume watcher fires on return. */
function buildUnifiedReturnPath(): string {
  const params = new URLSearchParams(window.location.search);
  params.set(UNIFIED_RESUME_KEY, '1');
  return `${window.location.pathname}?${params.toString()}`;
}

export type UnifiedReconnectOutcome = 'redirecting' | 'connected' | 'failed';

/**
 * Run one unified consent for the Drive+Calendar scope union.
 * - Redirect surfaces (iOS / PWA / native): hands off to the Drive redirect
 *   transport carrying the union scope + the `unifiedResume` marker, and returns
 *   `'redirecting'` (the page is navigating away; the resume completes it).
 * - Desktop: opens one popup consent, then fans the restored token out to
 *   calendar inline. Returns `'connected'` on success, `'failed'` on error.
 *
 * The Drive transport's existing revoke-before-mint revokes the shared grant once;
 * the calendar-specific revoke is never invoked on this path.
 */
export async function startUnifiedReconnect(driveEmail?: string): Promise<UnifiedReconnectOutcome> {
  const transport = shouldUseRedirectAuth() ? 'redirect' : 'popup';
  logEvent({
    level: 'info',
    surface: 'unified-reconnect',
    message: 'unified reconnect started',
    context: { action: `start:drive+calendar:${transport}` },
  });
  try {
    if (transport === 'redirect') {
      await startRedirectAuth(buildUnifiedReturnPath(), driveEmail, 'reconnect', {
        scope: UNIFIED_SCOPES,
      });
      return 'redirecting'; // navigating away; useUnifiedRedirectResume finishes it
    }
    // Desktop popup: one consent for the union, then restore calendar inline.
    await requestAccessToken({ forceConsent: true, loginHint: driveEmail, scope: UNIFIED_SCOPES });
    await fanOutCalendarAfterUnifiedConsent();
    return 'connected';
  } catch (error) {
    reportError({
      surface: 'unified-reconnect',
      severity: 'warning',
      message: 'unified reconnect consent failed',
      error: error instanceof Error ? error : new Error(String(error)),
    });
    return 'failed';
  }
}

/**
 * Restore calendar from the refresh token the unified Drive consent just committed.
 * Reads the token back from the Drive home (single source — the consent minted one
 * grant), resolves the OAuth-verified account, and applies it to every same-account
 * `needs_reconnect` connection. Gated on the READ-BACK TOKEN's presence, never on a
 * settle-memo return value (which is null on native by design — ADR-029). If Drive
 * did not commit a token, calendar is left down (partial-failure honesty). Never
 * throws — a failure here must not break the Drive restore that already succeeded.
 */
export async function fanOutCalendarAfterUnifiedConsent(): Promise<void> {
  try {
    const familyId = getActiveFamilyId();
    if (!familyId) return; // no family loaded to write into

    const stored = await getGoogleRefreshToken(familyId);
    if (!stored?.token) {
      // Drive did not commit a token → keep calendar down; the prompt stays honest.
      logEvent({
        level: 'warn',
        surface: 'unified-reconnect',
        message: 'unified reconnect: no committed Drive token — calendar fan-out skipped',
        context: { action: 'fanout-skipped-no-drive-token' },
      });
      return;
    }

    const email = await ensureVerifiedGoogleAccountEmail();
    if (!email) {
      logEvent({
        level: 'warn',
        surface: 'unified-reconnect',
        message: 'unified reconnect: no verified account — calendar fan-out skipped',
        context: { action: 'fanout-skipped-no-verified-email' },
      });
      return;
    }

    const outcome = await useCalendarSyncStore().applyUnifiedRefreshToken({
      refreshToken: stored.token,
      grantedScopes: [...CALENDAR_SCOPES],
      email,
    });
    logEvent({
      level: outcome.failed > 0 ? 'warn' : 'info',
      surface: 'unified-reconnect',
      message: 'unified reconnect: calendar fan-out complete',
      context: { action: `restored-calendar:${outcome.restored}/${outcome.matched}` },
    });
  } catch (error) {
    reportError({
      surface: 'unified-reconnect',
      severity: 'warning',
      message: 'unified reconnect: calendar fan-out failed',
      error: error instanceof Error ? error : new Error(String(error)),
    });
  }
}
