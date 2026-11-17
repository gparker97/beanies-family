// The one guarded revoke for calendar refresh tokens (view-only calendars plan
// 2026-11-17). Lifted out of the sync store so the view-only store can call it
// without either store importing the other.
//
// Google's revoke is whole-grant per (user, client id), and Drive, every calendar
// sync connection and every view-only account share this client id. So revoking is
// SKIPPED (and the skip logged) when anything else on the same Google account would
// die with it. The decision is the pure `anotherGrantSharesAccount`, which fails
// safe on every uncertainty; this module only gathers what it needs to know.

import { isDocLoaded } from '@/services/automerge/docService';
import { list as projectionList } from '@/services/automerge/projection';
import { getGoogleAccountEmail } from '@/services/google/googleAuth';
import { revokeGrant, logTokenLifecycle } from '@/services/google/googleRevoke';
import { anotherGrantSharesAccount } from '@/utils/calendar/grantGuard';

/** Why a calendar token is being revoked (the `token_trigger` telemetry value). */
export type CalendarRevokeTrigger = 'reconnect' | 'disconnect' | 'abandon';

/**
 * Revoke a calendar refresh token unless another holder shares its Google account.
 *
 * `exceptId` is the connection or view account being removed or reconnected; it
 * never counts as sharing with itself. Fire-and-forget: `revokeGrant` logs its own
 * outcome and never throws.
 */
export function revokeCalendarGrantGuarded(input: {
  refreshToken: string | undefined;
  accountEmail: string | null | undefined;
  trigger: CalendarRevokeTrigger;
  exceptId?: string;
}): void {
  // The lists are only trustworthy once the doc is loaded; an empty projection must
  // never read as "nothing else uses this account".
  const shared =
    !isDocLoaded() ||
    anotherGrantSharesAccount({
      email: input.accountEmail,
      exceptId: input.exceptId,
      // ⚠️ No `hasRefreshToken()` shortcut (removed 2026-09-08): that only knows
      // THIS device's Drive token, and a sibling device's live Drive grant for the
      // same account dies with a revoke too.
      driveEmail: getGoogleAccountEmail(),
      connections: projectionList('calendarConnections'),
      viewAccounts: projectionList('calendarViewAccounts'),
    });
  if (shared) {
    logTokenLifecycle({
      grant: 'calendar',
      op: 'revoke',
      outcome: 'skipped',
      reason: 'shared-account-grant',
      trigger: input.trigger,
    });
    return;
  }
  // ✅ SURVIVING REVOKE 5 of 5, the only one outside googleAuth (audit 2026-09-08).
  // Guarded above: it must never fire while anything else depends on the same
  // account. Drive no longer needs the symmetric guard, because Drive no longer
  // revokes on reconnect at all (see googleAuth.ts, both reconnect seams).
  void revokeGrant(input.refreshToken, { grant: 'calendar', trigger: input.trigger });
}
