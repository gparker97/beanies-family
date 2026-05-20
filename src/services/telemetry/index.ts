/**
 * Diagnostic telemetry — the firehose companion to `errorReporter`.
 *
 * Public surface:
 *   - `logEvent({ level, surface, message, context?, error? })` — capture a
 *     diagnostic event (fire-and-forget, never throws).
 *
 * See `src/utils/diagnosticContext.ts` for the shared enrichment/redaction core
 * and `docs/adr/027-diagnostic-logging-telemetry.md` for the design.
 */

export { logEvent } from './logEvent';
export type { LogEventInput, LogLevel, LogRecord } from './logEvent';
