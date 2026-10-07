/**
 * The one-bit hand-off between a passphrase unlock and the nudge UI (#81, ADR-041).
 *
 * `authStore.afterPassphraseUnlock` arms it when the typed phrase has the retired
 * 4-word generated shape; `usePassphraseNudge` consumes it once a member exists (no
 * member exists at unlock time, so it cannot be persisted there). It is a plain module
 * so the STORE never imports a COMPOSABLE (MVO), and so nothing reachable from the doc
 * worker (familyKeyService → kdfParams → logEvent → stores) can pull `@/router` and
 * every page into the worker bundle, which is exactly what importing the composable did.
 */
import { logEvent } from '@/services/telemetry/logEvent';

const SURFACE = 'passphrase-nudge';

let armed = false;

/** The typed unlock phrase had the legacy generated shape; the toast waits for sign-in. */
export function armLegacyPassphraseSignal(): void {
  armed = true;
  logEvent({
    level: 'info',
    surface: SURFACE,
    message: 'legacy_shape',
    context: { action: 'armed' },
  });
}

export function isLegacyPassphraseSignalArmed(): boolean {
  return armed;
}

/** Consumed by the nudge once shown, and cleared on sign-out: an arm never outlives a session. */
export function clearLegacyPassphraseSignal(): void {
  armed = false;
}
