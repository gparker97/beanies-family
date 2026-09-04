/**
 * A stable identifier for THIS BROWSER PROFILE on THIS DEVICE.
 *
 * Extracted from `calendarSyncStore` so the Automerge actor derivation can share
 * it: a second device identity would be a second thing to lose, and two devices
 * that disagreed about who they are would defeat both consumers at once.
 *
 * ⚠️ NEVER returns a shared constant. The original returned `'unknown-device'`
 * when localStorage threw, which for calendar reconciliation is merely lossy —
 * but this value now derives an Automerge ACTOR, and a shared constant would put
 * every private-mode device in the fleet into ONE actor lane, interleaving their
 * changes into a single sequence. The fallback mints a per-session id instead:
 * the same failure DIRECTION as before (an id that does not persist), never a
 * shared one, and never silent.
 */
import { generateUUID } from '@/utils/id';
import { logEvent } from '@/services/telemetry/logEvent';

const STORAGE_KEY = 'beanies:device-id';

/** Set only when localStorage is unusable, so the id is stable for the session. */
let sessionFallbackId: string | null = null;

export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = generateUUID();
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch {
    if (!sessionFallbackId) {
      sessionFallbackId = generateUUID();
      // Never silent: this degrades the actor pinning to per-session, so the
      // fleet-wide rate of it is worth knowing before reading the actor counts.
      logEvent({
        level: 'warn',
        surface: 'device-actor',
        message: 'localStorage unavailable — device id is per-session only',
        context: { action: 'unstable' },
      });
    }
    return sessionFallbackId;
  }
}

/** Test seam: forget the session fallback so a suite can re-exercise the path. */
export function __resetDeviceIdForTesting(): void {
  sessionFallbackId = null;
}
