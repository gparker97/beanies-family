// Shared alert-context builder for silent-refresh failures.
//
// Two surfaces fire when silent refresh fails: `cold-start-reconnect-escalation`
// (the boot-time path, from `syncStore.ts`) and `offline-queue-flush` (a
// queued save's write rejects with `TokenExpiredError` after the wake-time
// race; from `offlineQueue.ts`). Both want the same diagnostic blob:
// per-attempt classification, hidden-duration, visibility state, refresh-token
// age. This builder is the single source of truth — call it from both surfaces.
//
// Co-located with `googleAuth.ts` (the owner of the diagnostic data) but kept
// in its own file to avoid growing `googleAuth.ts`'s concern surface and to
// stay testable in isolation.

import {
  getLastSilentRefreshDiagnostics,
  type SilentRefreshDiagnostics,
  type SilentRefreshReason,
} from '@/services/google/googleAuth';
import { getHiddenDurationMs } from '@/utils/visibilityTracker';

export interface SilentRefreshAlertContext {
  silent_refresh_attempts: SilentRefreshDiagnostics['attempts'] | null;
  silent_refresh_had_refresh_token: boolean | null;
  silent_refresh_consecutive_failures: number | null;
  page_hidden_for_ms: number | null;
  visibility_state: DocumentVisibilityState | null;
  refresh_token_age_ms: number | null;
  /**
   * The silent-refresh failure reason, namespaced as `silent-refresh:<reason>`.
   *
   * Carried on the shared, already-allowlisted `error_code` key rather than a
   * new field: widening `ALLOWED_CONTEXT_KEYS` is a three-place coupled change
   * (the set, `infrastructure/lambda/telemetry/index.mjs`, and the app-store
   * privacy declarations) — disproportionate for a PII-free fixed enum. The
   * `silent-refresh:` prefix keeps the value self-describing so a reader of a
   * Slack payload can tell which producer set the key.
   *
   * Consumers branch on this to tell a genuine revocation apart from the
   * by-design "user never connected Drive" state. See `SilentRefreshReason`.
   */
  error_code: `silent-refresh:${SilentRefreshReason}` | null;
}

/**
 * Build the silent-refresh diagnostic context block for a `reportError` call.
 * Returns null fields when data is unavailable (e.g. running in a test env
 * without `document`, or no refresh attempt has happened this session) so
 * callers never have to branch — pass the whole object as `context`.
 */
export function buildSilentRefreshAlertContext(): SilentRefreshAlertContext {
  const diag = getLastSilentRefreshDiagnostics();
  const visibilityState = typeof document !== 'undefined' ? document.visibilityState : null;
  return {
    silent_refresh_attempts: diag?.attempts ?? null,
    silent_refresh_had_refresh_token: diag?.hadRefreshToken ?? null,
    silent_refresh_consecutive_failures: diag?.consecutiveFailures ?? null,
    page_hidden_for_ms: getHiddenDurationMs(),
    visibility_state: visibilityState,
    refresh_token_age_ms: diag?.refreshTokenAgeMs ?? null,
    error_code: diag?.reason ? (`silent-refresh:${diag.reason}` as const) : null,
  };
}
