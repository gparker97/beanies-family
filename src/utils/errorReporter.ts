/**
 * `reportError`: the typed severity gate in front of the diagnostic firehose.
 *
 * Every caught failure in the app is reported here. Three layers of capture flow in:
 *   A. `showToast('error', ...)` (auto, unless `{ silent: true }`)
 *   B. Vue render errors via `app.config.errorHandler`
 *   C. Unhandled JS errors (window listener)
 *
 * Every report, at every severity, becomes ONE `logEvent` firehose record (CloudWatch) carrying
 * its severity in `context.severity`. This module does not talk to Slack. Paging is the telemetry
 * Lambda's decision: it pages `#beanies-errors` when and only when a record is
 * `severity: 'critical'` AND its surface is on `SLACK_ESCALATE_SURFACES`.
 *
 * The type is the gate's client half. `ErrorReportInput` accepts `severity: 'critical'` only with
 * a `surface` that is a `PagingSurface` (`utils/pagingPolicy.ts`, the typed mirror of the
 * Lambda's set), so a critical on a non-paging surface is a `vue-tsc` error rather than a page
 * that silently never arrives. Registry-driven sites pair surface and severity through
 * `severityFor(surface, impact)`.
 *
 * Critical reports also flush immediately (so a hang-then-force-quit still lands the record) and
 * carry `family_name`, so the page can name the family. Nothing here reads an email.
 *
 * Failure contract: never throws, never blocks render, never breaks the toast. Every internal
 * failure logs `[errorReporter] <reason>` to console.warn.
 */

import { logEvent } from '@/services/telemetry';
import { ReadOnlyError } from '@/services/automerge/worker/writeGate';
import type { PagingSurface } from '@/utils/pagingPolicy';

// ─── Public API ──────────────────────────────────────────────────────────────

export type ErrorSeverity = 'critical' | 'error' | 'warning';

interface ErrorReportBase {
  /** User-facing or system error message. */
  message: string;
  /** Error object; stack and name extracted, the object itself is not sent. */
  error?: unknown;
  /** Structured context, filtered through the allowlist before send. */
  context?: Record<string, unknown>;
}

/**
 * `severity` is the telemetry level AND the paging request.
 *
 * `'critical'` asks the Lambda to page, and is legal only on a `PagingSurface`: reserve it for "a
 * user's data is at risk, or a journey failed and will not recover by itself". `'error'` (the
 * default) and `'warning'` are firehose-only. `surface` is kebab-case and greppable, e.g.
 * `'create-activity'`.
 */
export type ErrorReportInput = ErrorReportBase &
  (
    | { severity: 'critical'; surface: PagingSurface }
    | {
        severity?: 'error' | 'warning';
        surface: string;
        /** Set by `severityFor` when a paging impact landed on a non-paging surface. */
        demoted?: true;
      }
  );

/**
 * Fire-and-forget. Returns synchronously; never blocks, never throws.
 */
export function reportError(input: ErrorReportInput): void {
  // #95: an expected refusal, not a failure. The write gate has already logged it as
  // `read-only-gate blocked` (and shown its info toast); reporting it again at error severity
  // from every store's own catch would be noise. No firehose event, no console error.
  if (input.error instanceof ReadOnlyError) return;
  if (reentryGuard) {
    console.warn('[errorReporter] re-entry blocked', input.surface);
    return;
  }
  reentryGuard = true;
  try {
    const severity: ErrorSeverity = input.severity ?? 'error';
    const critical = severity === 'critical';
    const context: Record<string, unknown> = { ...input.context, severity };
    // `severityFor` demoted a paging impact on a non-allowlisted surface. Its console warning
    // never reaches CloudWatch, so stamp it where a filter can find it.
    if ('demoted' in input && input.demoted) {
      const prior = typeof context.detail === 'string' && context.detail ? context.detail : null;
      context.detail = prior ? `${prior},paging-demoted` : 'paging-demoted';
    }
    logEvent({
      // LogLevel has no 'critical', so it maps to 'error' for the level; the real severity
      // rides in context so the firehose stays filterable and the Lambda can gate on it.
      level: severity === 'warning' ? 'warn' : 'error',
      surface: input.surface,
      message: input.message,
      error: input.error,
      context,
      // Critical reports flush immediately so a hang-then-force-quit (the onboarding-stall
      // case) still lands the record in CloudWatch, and the Lambda can page promptly.
      flush: critical,
      // The page names the family; the high-volume non-critical stream stays name-free.
      includeFamilyName: critical,
    });
  } catch (e) {
    console.warn('[errorReporter] reportError itself threw', e);
  } finally {
    reentryGuard = false;
  }
}

let reentryGuard = false;

// ─── Test-only reset ─────────────────────────────────────────────────────────

/** Test-only: resets the re-entry guard. Production code never calls this. */
export function __resetErrorReporterForTesting(): void {
  reentryGuard = false;
}
