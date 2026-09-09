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
  /**
   * Phase 4 straggler signal: a WEB passkey registration exists for the member but
   * the retired method was withheld. Rides `detail` (allowlisted) — measures how
   * many users still lean on the deleted PRF path.
   */
  prfWithheld?: boolean;
  /**
   * Cold credential offers withheld because the envelope could not prove they would
   * work (`'password'` / `'passphrase'`). The counter that says the fail-closed rule is
   * doing something — a non-zero rate alongside zero unlock failures is the fix working.
   */
  suppressed?: string[];
  /** Whether the envelope's capabilities were readable at decision time. */
  capsKnown?: boolean;
}): void {
  const suppressed = payload.suppressed?.length
    ? payload.suppressed.map((k) => `+suppressed:${k}`).join('')
    : '';
  const caps =
    payload.capsKnown === undefined ? '' : `+caps:${payload.capsKnown ? 'known' : 'unknown'}`;
  emit('info', 'prove_methods_resolved', {
    action: 'resolved',
    detail:
      (payload.methods.join(',') || 'none') +
      (payload.prfWithheld ? '+prf-withheld' : '') +
      suppressed +
      caps,
    kind: payload.rosterSource,
    ...(payload.errorCode ? { error_code: payload.errorCode } : {}),
  });
}

/**
 * The envelope's capabilities could not be read, so every credential-specific offer
 * failed closed. Distinguishes "we never tried" from "we tried and it failed" — without
 * it the fail-closed path is invisible and looks identical to a family that genuinely
 * has no password.
 */
export function emitEnvelopeCapabilitiesUnknown(reason: 'not-staged' | 'stage-failed'): void {
  emit('warn', 'envelope_capabilities_unknown', {
    action: 'caps_unknown',
    error_code: reason,
  });
}

/**
 * A re-read changed what the envelope can be opened with — i.e. a credential written on
 * another device was not visible here until now. A DIAGNOSTIC, not a correctness
 * mechanism: capabilities are derived, so the re-read is already reflected.
 *
 * ⚠️ `detail` carries THREE BOOLEANS and nothing else. No kit ids, no member ids, no
 * family id, no counts. This surface fires pre-auth and `detail` is unstructured, so the
 * encoding is fixed here and must not grow a field.
 */
export function emitEnvelopeCapabilitiesChanged(payload: {
  before: { password: boolean; passphrase: boolean; kit: boolean };
  after: { password: boolean; passphrase: boolean; kit: boolean };
}): void {
  const enc = (c: { password: boolean; passphrase: boolean; kit: boolean }) =>
    `p${+c.password}f${+c.passphrase}k${+c.kit}`;
  emit('warn', 'envelope_capabilities_changed', {
    action: 'caps_changed',
    detail: `${enc(payload.before)}->${enc(payload.after)}`,
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

/** Phase 4 device linking: a mint attempt — ok=false means the invite key never
 *  reached the durable file and the link was withheld (R2-F15). */
export function emitDeviceLinkMinted(ok: boolean): void {
  emit(ok ? 'info' : 'warn', 'device_link_minted', { action: ok ? 'minted' : 'publish_failed' });
}

/** Phase 4 device linking: a link was redeemed on the receiving device. */
export function emitDeviceLinkRedeemed(ok: boolean, errorCode?: string): void {
  emit(ok ? 'info' : 'warn', 'device_link_redeemed', {
    action: ok ? 'ok' : 'failed',
    ...(errorCode ? { error_code: errorCode } : {}),
  });
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
