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

// NOTE: `openCycle` is deliberately NOT re-exported here. A dozen test files
// mock this barrel with `{ logEvent }` alone, so anything added to it silently
// breaks them (and every future test that mocks it the same way). Import the
// counters from '@/services/telemetry/openCycle' directly — the same convention
// `syncStore` already uses for `@/services/telemetry/logEvent`.
