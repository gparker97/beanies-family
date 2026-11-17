// Holding and abandoning a fresh calendar consent (view-only calendars plan
// 2026-11-17, A2). The one copy of what the sync store and the view store both do
// with the pending slot, so neither store imports the other. Each store passes its
// own `consent-outcome` logger (they log on their own surfaces).
//
// A separate module from `pendingCredential.ts` on purpose: the token provider in
// `googleCalendarClient.ts` reads the slot, so the slot module must not import the
// client (that would be an import cycle).

import { getCalendarClient } from './clientInstance';
import { pendingCredential } from './pendingCredential';
import { revokeCalendarGrantGuarded } from './guardedRevoke';
import type {
  CalendarConnectFailure,
  CalendarConnectRedirecting,
  CalendarConnectResult,
  CalendarGrantKind,
} from './calendarAuth';
import { logTokenLifecycle } from '@/services/google/googleRevoke';
import { generateUUID } from '@/utils/id';

/** A store's `consent-outcome` logger. */
export type ConsentOutcomeLogger = (detail: string, stage?: 'popup' | 'redirect') => void;

/** What holding a consent produced: the credential is pending, a redirect is under way, or it failed. */
export type HoldConsentResult =
  { status: 'pending' } | CalendarConnectRedirecting | CalendarConnectFailure;

/**
 * Put a fresh consent's credential into the pending slot (popup and redirect share
 * this). Nothing is written to the family file. A failure is logged and passed back.
 */
export function holdConsent(
  kind: CalendarGrantKind,
  result: CalendarConnectResult,
  stage: 'popup' | 'redirect',
  logOutcome: ConsentOutcomeLogger
): HoldConsentResult {
  if (result.status === 'redirecting') return result;
  if (result.status !== 'connected') {
    logOutcome(result.code, stage);
    return result;
  }
  pendingCredential.set({
    id: `pending-${generateUUID()}`,
    kind,
    accountEmail: result.email,
    refreshToken: result.refreshToken,
    grantedScopes: result.grantedScopes,
  });
  logTokenLifecycle({ grant: 'calendar', op: 'mint', outcome: 'ok', trigger: 'connect' });
  logOutcome('consented', stage);
  return { status: 'pending' };
}

/**
 * Drop an unconfirmed consent of this kind: clear the slot and revoke its token
 * unless something else on the same Google account would die with it (the shared
 * guard). A no-op when no consent of this kind is pending, so every close path may
 * call it.
 */
export function abandonPendingConsent(
  kind: CalendarGrantKind,
  logOutcome: ConsentOutcomeLogger
): void {
  const held = pendingCredential.peek();
  if (!held || held.kind !== kind) return;
  pendingCredential.clear();
  getCalendarClient().invalidateConnection(held.id);
  revokeCalendarGrantGuarded({
    refreshToken: held.refreshToken,
    accountEmail: held.accountEmail,
    trigger: 'abandon',
  });
  logOutcome('abandoned');
}
