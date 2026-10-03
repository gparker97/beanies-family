/**
 * Cross-tab "this family's session ended here" signal (C10, 2026-10-03).
 *
 * The worker's cache-release signal (#100) only fires when another tab actually DELETES
 * the family's cache. An untrusted sign-out that KEEPS the cache (unpushed work, an
 * unreadable remote, a delete another tab blocked) used to leave every other tab signed in
 * with the family key in memory: on a shared device, the person who signed out was still
 * signed in next door. So every non-trusted sign-out tier announces the end on
 * `BroadcastChannel('beanies-session:<familyId>')` WHETHER OR NOT the delete ran, and every
 * tab holding that family's session answers with the existing cleared-elsewhere teardown.
 *
 * One listening channel per tab, bound to the signed-in family by the auth store. An
 * announcement from this tab goes out on the listening instance (BroadcastChannel never
 * delivers to the posting object), and carries this tab's id as a second guard.
 */
import { logEvent } from '@/services/telemetry/logEvent';

export const SESSION_ENDED_MESSAGE = 'session-ended';

interface SessionEndedMessage {
  type: typeof SESSION_ENDED_MESSAGE;
  familyId: string;
  from: string;
}

const TAB_ID =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tab-${Math.random().toString(36).slice(2)}`;

let bound: { familyId: string; channel: BroadcastChannel } | null = null;
let handler: ((familyId: string) => void) | null = null;

export function sessionChannelName(familyId: string): string {
  return `beanies-session:${familyId}`;
}

function channelSupported(): boolean {
  return typeof BroadcastChannel !== 'undefined';
}

/** Who answers an announcement from another tab (`useSignOut` registers it). */
export function setSessionEndedHandler(fn: ((familyId: string) => void) | null): void {
  handler = fn;
}

/**
 * Listen for this family (or stop, with `null`). Idempotent for the same family; switching
 * families closes the old channel first, so a tab never answers for a family it left.
 */
export function bindSessionChannel(familyId: string | null): void {
  if (bound?.familyId === familyId) return;
  if (bound) {
    bound.channel.close();
    bound = null;
  }
  if (!familyId || !channelSupported()) return;
  const channel = new BroadcastChannel(sessionChannelName(familyId));
  // Node (tests, SSR tooling) keeps the process alive on an open channel; browsers have no
  // `unref`, so this is a no-op there.
  (channel as { unref?: () => void }).unref?.();
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const msg = event.data as Partial<SessionEndedMessage> | null;
    if (msg?.type !== SESSION_ENDED_MESSAGE || msg.familyId !== familyId) return;
    if (msg.from === TAB_ID) return;
    logEvent({
      level: 'info',
      surface: 'sign-out',
      message: 'session ended in another tab',
      context: {
        action: 'session_ended_elsewhere_received',
        detail: handler ? 'handled' : 'no-handler',
      },
    });
    handler?.(familyId);
  };
  bound = { familyId, channel };
}

/**
 * Tell every other tab this family's session ended here. Never throws: a tab that misses
 * it keeps its session, which is the pre-existing behaviour, not a new failure.
 */
export function announceSessionEnded(familyId: string): void {
  if (!channelSupported()) return;
  const msg: SessionEndedMessage = { type: SESSION_ENDED_MESSAGE, familyId, from: TAB_ID };
  try {
    if (bound?.familyId === familyId) {
      bound.channel.postMessage(msg);
    } else {
      const once = new BroadcastChannel(sessionChannelName(familyId));
      once.postMessage(msg);
      once.close();
    }
    logEvent({
      level: 'info',
      surface: 'sign-out',
      message: 'session end announced to other tabs',
      context: { action: 'session_ended_announced' },
    });
  } catch (e) {
    logEvent({
      level: 'warn',
      surface: 'sign-out',
      message: 'session end announcement failed',
      error: e,
      context: {
        action: 'session_ended_announce_failed',
        error_code: e instanceof Error ? e.name : 'unknown',
      },
    });
  }
}

/** Test-only: close the bound channel and forget the handler. */
export function __resetSessionChannelForTests(): void {
  bound?.channel.close();
  bound = null;
  handler = null;
}
