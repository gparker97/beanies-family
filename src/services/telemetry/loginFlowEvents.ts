/**
 * Typed telemetry facade for the `login-flow` surface (2026-08-28 login rethink).
 *
 * One narrow function per event name, wrapping `logEvent`. No view or service calls
 * `logEvent` with a hand-typed `login-flow` event string — the headline metric
 * (first-try prove success rate) is only trustworthy if payload shapes can't drift per
 * call site.
 *
 * Context discipline: every field below rides on ALREADY-ALLOWLISTED context keys
 * (`action`, `kind`, `detail`, `error_code`, `stage` — see ALLOWED_CONTEXT_KEYS in
 * diagnosticContext.ts), so no store-declaration change ships with this surface. Member
 * NAMES never appear here — ids are truncated to tails where needed, names not at all.
 */

import { logEvent, type LogLevel } from '@/services/telemetry/logEvent';

const SURFACE = 'login-flow';

function emit(level: LogLevel, message: string, context: Record<string, unknown>): void {
  logEvent({ level, surface: SURFACE, message, context });
}

/** Which prove methods the single decision engine resolved for a member, and from what. */
export function emitProveMethodsResolved(payload: {
  /** Ordered method kinds, e.g. ['biometric','password']. */
  methods: string[];
  /** Where the person list came from: 'roster' | 'credential-records' | 'open-pod'. */
  rosterSource: string;
  /** Probe failures that degraded a method away (empty when all probes ran clean). */
  errorCode?: string;
}): void {
  emit('info', 'prove_methods_resolved', {
    action: 'resolved',
    detail: payload.methods.join(',') || 'none',
    kind: payload.rosterSource,
    ...(payload.errorCode ? { error_code: payload.errorCode } : {}),
  });
}

/** Outcome of one prove attempt — emitted on success too, so the RATE is measurable. */
export function emitProveOutcome(payload: {
  method: string; // 'biometric' | 'password' | 'tap-through' | ...
  ok: boolean;
  /** 'cancelled' for a user-dismissed prompt; an error name otherwise. */
  errorCode?: string;
  /** 0 = first-offered method; >0 = the user fell back N times before this attempt. */
  fallbackDepth: number;
}): void {
  emit(payload.ok ? 'info' : 'warn', 'prove_outcome', {
    action: payload.ok ? 'ok' : (payload.errorCode ?? 'error'),
    kind: payload.method,
    detail: `depth=${payload.fallbackDepth}`,
    ...(payload.errorCode && !payload.ok ? { error_code: payload.errorCode } : {}),
  });
}

/** The `open` state entered its recovery sub-state instead of a credential surface. */
export function emitOpenFetchRecovery(payload: {
  reason: string; // 'auth' | 'permission' | 'not-found' | 'network' | ...
}): void {
  emit('info', 'open_fetch_recovery', { action: 'recovery', kind: payload.reason });
}

/** The person picker rendered from credential records because the roster was missing. */
export function emitRosterFallbackUsed(): void {
  emit('warn', 'roster_fallback_used', { action: 'fallback' });
}

/** One sign-out ran. Confirms no tier ever revokes; local token deletion only on 2-untrusted/3. */
export function emitSignoutTier(payload: {
  tier: 'switch-person' | 'sign-out' | 'sign-out-clear';
  trusted: boolean;
  tokensKept: boolean;
}): void {
  emit('info', 'signout_tier', {
    action: payload.tier,
    kind: payload.trusted ? 'trusted' : 'untrusted',
    detail: payload.tokensKept ? 'tokens-kept' : 'tokens-cleared',
  });
}

/** The Settings "Disconnect Google everywhere" action ran — the ONLY revoke site left. */
export function emitExplicitRevokeUsed(): void {
  emit('warn', 'explicit_revoke_used', { action: 'explicit_revoke' });
}

/** The roster-cache refresh failed (non-fatal; picker degrades to credential records). */
export function emitRosterRefreshFailed(errorCode: string): void {
  emit('warn', 'roster_cache_refresh_failed', {
    action: 'refresh_failed',
    error_code: errorCode,
  });
}
