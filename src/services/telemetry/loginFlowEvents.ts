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

/**
 * A link was minted. ONE emitter for both kinds — the 15-minute device link and the
 * 7-day magic link — because they share a funnel and a second emitter is a second shape
 * that can drift.
 *
 * `ok=false` means the wrap never reached the durable file and the link was WITHHELD
 * (the R2-F15 rule: a QR whose key is not on Drive is a dead QR).
 *
 * ⚠️ RENAMED from `device_link_minted` to `link_minted`. A deliberate, one-time break in
 * event continuity, safe only because the measured baseline was ZERO — the device-link
 * path had never been used in production, not once, so nothing is lost. Any saved
 * CloudWatch query or dashboard on `device_link_*` must move to `link_*`.
 */
export function emitLinkMinted(payload: {
  kind: 'device' | 'magic';
  ok: boolean;
  errorCode?: string;
  /**
   * Where the mint came from, as `origin=<where>` — `creation`, `join`, `settings`,
   * `profile-menu`. For a magic link it may also record whether it replaced one.
   *
   * Applies to BOTH kinds. It said "magic links only" until the device link gained its
   * own entry points; a device mint now carries an origin too, which is what makes
   * "where do people actually add a device from" answerable.
   */
  detail?: string;
}): void {
  emit(payload.ok ? 'info' : 'warn', 'link_minted', {
    action: payload.ok ? 'minted' : 'publish_failed',
    kind: payload.kind,
    ...(payload.errorCode ? { error_code: payload.errorCode } : {}),
    ...(payload.detail ? { detail: payload.detail } : {}),
  });
}

/**
 * A link was redeemed — or refused — on the receiving device.
 *
 * ⚠️ `ok: true` fires from the login machine's single `done` branch, NOT from the
 * redeem itself. `useJoinFlow`'s own comment explains why: `link-ready` hands off to the
 * standard login machine, which still has to show a picker and prove a PIN, so counting
 * a success there "would look healthy during exactly the failure it exists to surface".
 * That is also what finally gives the DEVICE link a denominator, which it has never had.
 */
export function emitLinkRedeemed(payload: {
  kind: 'device' | 'magic';
  ok: boolean;
  errorCode?: string;
}): void {
  emit(payload.ok ? 'info' : 'warn', 'link_redeemed', {
    action: payload.ok ? 'ok' : 'failed',
    kind: payload.kind,
    ...(payload.errorCode ? { error_code: payload.errorCode } : {}),
  });
}

/**
 * ⚠️ NO join-started / join-completed emitter here, deliberately. `joinStepEvents.ts`
 * already owns the join funnel on the `join-flow` surface: `watchJoinSteps` emits EVERY
 * step transition and `emitJoinCompleted` is already called at the end of a successful
 * join. A CloudWatch sweep that looked only at `login-flow` concluded the join funnel
 * was uninstrumented; it is not, it is on the other surface. Adding a parallel pair here
 * would have been two shapes for one funnel — the exact drift this facade exists to stop.
 * Magic-link vs device-link vs invite is distinguished by `kind` on `emitLinkRedeemed`.
 */

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

/**
 * A recovery-kit redemption reached a terminal state.
 *
 * Moved onto the facade because it had been hand-typed at three `logEvent` call sites in
 * `LoadPodView` — and, more to the point, TWO of its terminal branches emitted nothing at
 * all: the decrypt failure after a kit that unwrapped fine, and the handler's outer
 * `catch`, which was `console.error` only. So a kit that opened the envelope and then
 * failed to open the pod was invisible in the firehose, which is precisely the case this
 * issue exists to understand.
 *
 * Emitted on the SUCCESS path too, so a redemption *rate* is measurable rather than a
 * failure count.
 */
export function emitKitRedeemed(payload: {
  outcome: 'ok' | 'accepted-pod-open' | 'failed' | 'decrypt-failed' | 'redeem-threw';
  errorCode?: string;
}): void {
  const ok = payload.outcome === 'ok' || payload.outcome === 'accepted-pod-open';
  emit(ok ? 'info' : 'warn', 'kit_redeemed', {
    action: payload.outcome,
    ...(payload.errorCode ? { error_code: payload.errorCode } : {}),
  });
}

/**
 * Someone arrived on a cold surface that asks them to get back into a beanpod.
 *
 * This is the DENOMINATOR the headline metric has never had. `magicLink.ts:5-9` records
 * that 6 of 22 families redeemed a kit on a cold device — but with no count of how many
 * families reached a cold surface at all, "27%" cannot be compared before and after this
 * change. `kind` carries which surface, which is what separates the cold-phone case from
 * the cold-laptop one.
 */
export function emitColdUnlockStarted(payload: { surface: string }): void {
  emit('info', 'cold_unlock_started', { action: 'started', kind: payload.surface });
}

/** They left a cold surface without getting in. The other half of the denominator. */
export function emitColdUnlockAbandoned(payload: { surface: string }): void {
  emit('warn', 'cold_unlock_abandoned', { action: 'abandoned', kind: payload.surface });
}

/**
 * A device-approval request was displayed by a cold device (W4 / pull mode).
 *
 * Paired with `emitDeviceApprovalOutcome` so the drop-off between "showed a code" and
 * "was let in" is measurable — that gap is the whole question for this flow.
 */
export function emitDeviceApprovalRequested(): void {
  emit('info', 'device_approval_requested', { action: 'requested' });
}

/** How a device-approval attempt ended. Emitted on success too, so rates are measurable. */
export function emitDeviceApprovalOutcome(payload: {
  outcome: 'ok' | 'rejected' | 'expired' | 'failed';
  errorCode?: string;
}): void {
  emit(payload.outcome === 'ok' ? 'info' : 'warn', 'device_approval_outcome', {
    action: payload.outcome,
    ...(payload.errorCode ? { error_code: payload.errorCode } : {}),
  });
}
