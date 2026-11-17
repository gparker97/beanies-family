// The pending calendar credential (view-only calendars plan 2026-11-17, A2).
//
// A fresh consent yields a refresh token BEFORE the member has picked a calendar,
// and nothing may be written to the family file until they do. This module is the
// one place that token waits: a single in-memory slot, read by the token
// provider's credential resolver (so the add step's `listCalendars` works against
// it) and cleared on sign-out. `listEventsForView` never reads with it: the client
// refuses any (credential, calendar) pair that is not in `viewedCalendars`, and a
// pending credential has no calendar yet. No store, modal or composable keeps its own
// copy, so there is exactly one thing to clear.
//
// Memory only, never persisted: after a redirect return it lives for that page
// session, and a closed app simply drops it.
//
// The slot is a `shallowRef`, so a computed that reads `peek()` re-evaluates when
// the slot changes (the settings drawer opens the add step when a redirect return
// fills it). Readers still get the credential only through `peek`/`take`.

import { shallowRef } from 'vue';
import type { CalendarGrantKind } from './calendarAuth';

export interface PendingCalendarCredential {
  /** Opaque id the token provider is asked for. Never a record id in the doc. */
  id: string;
  kind: CalendarGrantKind;
  /** The consenting account's email, when Google's userinfo returned one. */
  accountEmail: string | null;
  refreshToken: string;
  grantedScopes: string[];
}

const slot = shallowRef<PendingCalendarCredential | null>(null);

export const pendingCredential = {
  /** Hold a fresh consent's credential, replacing any earlier one. */
  set(credential: PendingCalendarCredential): void {
    slot.value = { ...credential, grantedScopes: [...credential.grantedScopes] };
  },
  /** The held credential, left in place. Reactive. */
  peek(): PendingCalendarCredential | null {
    return slot.value;
  },
  /** The held credential, removing it (the add step confirming a calendar). */
  take(): PendingCalendarCredential | null {
    const held = slot.value;
    slot.value = null;
    return held;
  },
  /** Drop the held credential (sign-out, family switch, add step abandoned). */
  clear(): void {
    slot.value = null;
  },
};
