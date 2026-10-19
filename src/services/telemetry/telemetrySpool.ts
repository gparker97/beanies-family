/**
 * Boot entry point for the offline spool (`logSpool.ts`): puts diagnostics that an earlier
 * session could not deliver back in the queue, and logs what it found. Lives apart from
 * `logQueue` because the queue never logs about itself (and `logEvent` already imports it).
 *
 * `telemetry-spool` `restored` fires only when a spool was found, so its rate is how often
 * devices end a session with undelivered diagnostics. `count` is the events put back; `detail`
 * carries what was dropped and why.
 */

import { logEvent } from '@/services/telemetry/logEvent';
import { restoreSpooledEvents } from '@/services/telemetry/logQueue';

let installed = false;

/** Called once from `main.ts`, after `installOnboardingAttempt`. Idempotent. */
export function installTelemetrySpool(): void {
  if (installed) return;
  installed = true;

  const r = restoreSpooledEvents();
  if (r.keys === 0) return;
  logEvent({
    level: 'info',
    surface: 'telemetry-spool',
    message: 'restored',
    context: {
      action: 'restored',
      count: r.restored,
      detail: `stale=${r.stale},malformed=${r.malformed},unremovable=${r.unremovable},capped=${r.capped},keys=${r.keys}`,
    },
  });
}

/** Test-only: allow `installTelemetrySpool` to run again. */
export function __resetTelemetrySpoolForTesting(): void {
  installed = false;
}
