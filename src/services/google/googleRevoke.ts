/**
 * Single entry point for revoking a Google authorization GRANT (a refresh token).
 *
 * Part of the token-churn fix (Notion #62, plan 2026-08-13): the app used to mint
 * a new refresh token on every interactive reconnect and never revoke the one it
 * replaced, so a heavy user accumulated live tokens until Google's 100-per-account
 * FIFO cap silently revoked the *working* one. Making every reconnect revoke the
 * token it replaces keeps the pool from growing.
 *
 * This is the ONE place callers go to revoke a grant. It is:
 *   - **Idempotent**: a null/empty token, or a token Google already considers
 *     dead, resolves as success — so the sign-out revoke and revoke-before-mint
 *     can both target the same token without coordination or a marker map.
 *   - **Offline-durable**: a transient failure (offline / network / 5xx) is
 *     handed to `revokeQueue` (IndexedDB-persisted) for retry, never dropped.
 *   - **Observable**: every attempt emits a `google-token-lifecycle` event.
 *
 * SCOPE: grant revokes only. The two epoch-discard *access-token* revokes in
 * `googleAuth.ts` (`isSessionStillCurrent`, the `commitAcquiredToken` rollback)
 * are a different concern and deliberately do NOT route through here.
 */
import { logEvent } from '@/services/telemetry';
import type { LogLevel } from '@/services/telemetry/logEvent';
import { postRevoke, enqueueRevoke } from '@/services/sync/revokeQueue';

export type TokenGrant = 'drive' | 'calendar';
export type TokenOp = 'mint' | 'revoke' | 'recovery';
/** `skipped` = deliberately not attempted (e.g. a shared live Drive grant guard). */
export type TokenOutcome = 'ok' | 'queued' | 'failed' | 'skipped';

export interface TokenLifecycleMeta {
  grant: TokenGrant;
  op: TokenOp;
  outcome: TokenOutcome;
  /** Why this outcome — a short enum-ish string, never user content. */
  reason?: string;
  /** What drove the op: 'reconnect' | 'recovery' | 'connect' | 'signout' | 'disconnect' | 'enqueue' | 'queue-drain'. */
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

export interface RevokeGrantMeta {
  grant: TokenGrant;
  /** What drove the revoke: 'reconnect' | 'recovery' | 'signout' | 'disconnect' | ... */
  trigger: string;
}

/**
 * Revoke a grant. Attempts the network revoke once; on a transient failure the
 * token is queued for durable retry. Always resolves (never throws) with a
 * structured outcome the caller can log or act on — but callers on the
 * revoke-before-mint path do NOT need to await it; it is safe fire-and-forget.
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

  // Transient — persist for retry on the next recovery trigger. `enqueueRevoke`
  // emits its own `queued` (or `failed`) lifecycle event.
  await enqueueRevoke(token, meta.grant);
  return { ok: false, reason: 'queued' };
}
