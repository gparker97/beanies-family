/**
 * Single entry point for revoking a Google authorization GRANT (a refresh token).
 *
 * Part of the token-churn fix (Notion #62, plan 2026-08-13): the app used to mint
 * a new refresh token on every interactive reconnect and never revoke the one it
 * replaced, so a heavy user accumulated live tokens until Google's 100-per-account
 * FIFO cap silently revoked the *working* one. Revoking the token BEFORE minting
 * its replacement keeps the pool from growing.
 *
 * REVOKE IS WHOLE-GRANT (empirically confirmed for our client, 2026-08-13 via
 * `scripts/revoke-breadth-check.mjs`): revoking ANY token for a (user, client)
 * kills EVERY token for that pair — Drive and Calendar "die together"
 * (`refreshFailure.ts`). Two consequences shape this helper:
 *   1. Revoke-before-mint MUST run before the consent that re-mints — never after
 *      (a post-mint revoke would kill the token just minted). Enforced by callers.
 *   2. A failed revoke is NOT durably retried. By the time a retry ran, a
 *      replacement token would exist, and revoking the old one would kill the
 *      whole grant — including that new token. So a transient failure is dropped:
 *      the orphaned token is bounded (a healthy reconnect's SUCCESSFUL revoke
 *      resets the entire pool to one; stragglers FIFO-evict or expire in ~6mo).
 *
 * This is the ONE place callers go to revoke a grant. It is idempotent (a
 * null/empty or already-dead token resolves as success, so revoke-before-mint and
 * the sign-out revoke can both target the same token without coordination) and
 * observable (every attempt emits a `google-token-lifecycle` event).
 *
 * SCOPE: grant revokes only. The two epoch-discard *access-token* revokes in
 * `googleAuth.ts` (`isSessionStillCurrent`, the `commitAcquiredToken` rollback)
 * are a different concern and deliberately do NOT route through here.
 */
import { logEvent } from '@/services/telemetry';
import type { LogLevel } from '@/services/telemetry/logEvent';

const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

export type TokenGrant = 'drive' | 'calendar';
export type TokenOp = 'mint' | 'revoke' | 'recovery';
/** `skipped` = deliberately not attempted (e.g. a shared live Drive grant guard). */
export type TokenOutcome = 'ok' | 'failed' | 'skipped';

export interface TokenLifecycleMeta {
  grant: TokenGrant;
  op: TokenOp;
  outcome: TokenOutcome;
  /** Why this outcome — a short enum-ish string, never user content. */
  reason?: string;
  /** What drove the op: 'reconnect' | 'recovery' | 'connect' | 'signout' | 'disconnect'. */
  trigger: string;
  error?: Error;
}

/**
 * The single emitter for token-pressure telemetry. Mint AND revoke paths call
 * this (success and failure) so `surface = "google-token-lifecycle"` measures
 * both token-pressure and revoke success-rate fleet-wide. Enum-valued context
 * only — never a token value or any PII.
 */
export function logTokenLifecycle(meta: TokenLifecycleMeta): void {
  const level: LogLevel = meta.outcome === 'failed' ? 'warn' : 'info';
  logEvent({
    level,
    surface: 'google-token-lifecycle',
    message: `${meta.grant} ${meta.op} ${meta.outcome}${meta.reason ? ` (${meta.reason})` : ''}`,
    context: {
      token_grant: meta.grant,
      token_op: meta.op,
      token_outcome: meta.outcome,
      token_trigger: meta.trigger,
      ...(meta.reason ? { token_reason: meta.reason } : {}),
    },
    error: meta.error,
  });
}

/**
 * The raw revoke against Google's public revoke endpoint. Classifies the outcome:
 *   - `'ok'`        — the grant is gone (2xx), OR Google already considers the
 *                     token invalid/expired (400) → done.
 *   - `'transient'` — offline / network throw / 403 (rate) / 429 / 5xx. The token
 *                     may still be live, but we do NOT retry (see the module doc).
 *
 * No `client_secret` is needed — `/revoke` accepts a bare token (matching the two
 * long-standing access-token revoke sites in `googleAuth.ts`). `keepalive` lets
 * the request survive a synchronous navigation that may follow immediately (the
 * web-redirect reconnect arm does `window.location.href = …` right after firing
 * revoke-before-mint). Never throws — this runs on fire-and-forget paths.
 */
async function postRevoke(token: string): Promise<'ok' | 'transient'> {
  let res: Response | undefined;
  try {
    res = await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      keepalive: true,
    });
  } catch {
    return 'transient';
  }
  if (!res) return 'transient';
  if (res.ok) return 'ok';
  if (res.status === 429 || res.status === 403 || res.status >= 500) return 'transient';
  return 'ok'; // 400 etc. — already invalid; the grant is gone.
}

export interface RevokeGrantMeta {
  grant: TokenGrant;
  /** What drove the revoke: 'reconnect' | 'recovery' | 'signout' | 'disconnect' | ... */
  trigger: string;
}

/**
 * Revoke a grant, immediate best-effort. Always resolves (never throws) with a
 * structured outcome; safe to fire-and-forget. A transient failure is dropped
 * (NOT durably retried — see the module doc on whole-grant revoke), leaving a
 * bounded orphaned token rather than risking a later revoke that kills a live
 * grant.
 *
 * @param token The refresh token to revoke. Null/empty ⇒ idempotent no-op.
 */
export async function revokeGrant(
  token: string | null | undefined,
  meta: RevokeGrantMeta
): Promise<{ ok: boolean; reason: string }> {
  if (!token) return { ok: true, reason: 'no-token' };

  const result = await postRevoke(token);
  if (result === 'ok') {
    logTokenLifecycle({ grant: meta.grant, op: 'revoke', outcome: 'ok', trigger: meta.trigger });
    return { ok: true, reason: 'revoked' };
  }
  // Transient — dropped on purpose. Observable so revoke success-rate + stragglers
  // are measurable fleet-wide.
  logTokenLifecycle({
    grant: meta.grant,
    op: 'revoke',
    outcome: 'failed',
    reason: 'transient-dropped',
    trigger: meta.trigger,
  });
  return { ok: false, reason: 'failed' };
}
