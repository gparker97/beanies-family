// BYOK key connectivity check (#133, Phase 4). The "test key" button in AI settings calls this
// to give the user immediate, definitive feedback that their key works — before they rely on it
// for a real extraction. Scoped to OpenAI (the one working BYOK target today); claude/gemini are
// honest `not_available` seams and the UI hides the button for them.
//
// NEVER throws — every failure is classified and returned, mirroring the no-throw discipline of
// DocumentExtractionResult. The upstream body is never surfaced (no key/secret leakage).

import { OPENAI_BASE_URL, type ByokConfig } from './byokProvider';

/** Short reachability check — this is a HEAD-weight GET, not a billable inference call. */
const VALIDATE_TIMEOUT_MS = 10_000;

export interface ByokKeyValidation {
  ok: boolean;
  /** Why it failed (absent on success): bad/revoked key, a network/transport problem,
   *  or a provider we can't validate yet. The UI maps each to a specific toast. */
  reason?: 'invalid_key' | 'network' | 'unsupported';
}

/**
 * Validate a BYOK key by hitting the provider's cheapest authenticated endpoint.
 * For OpenAI that is `GET /v1/models`:
 *   • 200            → the key works
 *   • 401 | 403      → the key is missing/invalid/revoked
 *   • other non-2xx / network / timeout → a transport problem (retryable)
 * Non-OpenAI providers return `unsupported` (the button isn't shown for them, but the
 * function stays honest if called).
 */
export async function validateByokKey(config: ByokConfig): Promise<ByokKeyValidation> {
  if (config.provider !== 'openai') {
    return { ok: false, reason: 'unsupported' };
  }
  if (!config.apiKey) {
    return { ok: false, reason: 'invalid_key' };
  }

  try {
    const res = await fetch(`${OPENAI_BASE_URL}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
    });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'invalid_key' };
    // Any other non-2xx (rate limit, 5xx, etc.) is a transport-class problem, not a verdict
    // on the key — surface it as retryable. Status kept for diagnostics only, body never read.
    console.warn(`[validateByokKey] openai /models returned HTTP ${res.status}`);
    return { ok: false, reason: 'network' };
  } catch (err) {
    // Abort/timeout or a fetch/network failure — never a key verdict.
    console.warn('[validateByokKey] openai /models request failed', err);
    return { ok: false, reason: 'network' };
  }
}
