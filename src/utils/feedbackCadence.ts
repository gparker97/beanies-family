/**
 * #45 — pure cadence brain for the periodic in-app feedback / NPS prompt.
 *
 * Deterministic and side-effect-free so it can be unit-tested in isolation
 * (mirrors `useCommunityNudge`'s `decideIssue`). The composable layer
 * (`useFeedbackModal.maybeAutoPromptFeedback`) owns the I/O; this only decides.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Don't prompt until the family account is at least this old (engagement proxy). */
export const FEEDBACK_MIN_ACCOUNT_AGE_MS = 7 * DAY_MS;

/** Re-ask this long after the last prompt, whether or not the user responded. */
export const FEEDBACK_INTERVAL_MS = 30 * DAY_MS;

export interface FeedbackCadenceState {
  /** Family-scoped opt-out — when true the periodic prompt never fires. */
  optOut: boolean;
  /** ISO timestamp the prompt was last shown / a submission last stamped it. Absent until first use. */
  lastPromptedAt?: string;
  /** ISO timestamp the family account was created (`Settings.createdAt`). */
  accountCreatedAt?: string;
}

export interface FeedbackCadenceConfig {
  minAccountAgeMs: number;
  intervalMs: number;
}

export const DEFAULT_FEEDBACK_CADENCE: FeedbackCadenceConfig = {
  minAccountAgeMs: FEEDBACK_MIN_ACCOUNT_AGE_MS,
  intervalMs: FEEDBACK_INTERVAL_MS,
};

/** Parse an ISO string to epoch ms; returns null for missing / unparseable input. */
function parseMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Should the periodic feedback prompt auto-open right now?
 *
 * Gates (all must pass): not opted out; account age ≥ minAccountAgeMs; and either
 * never prompted before, or ≥ intervalMs since the last prompt. A missing/invalid
 * `accountCreatedAt` fails closed (never prompt) — we can't verify the engagement gate.
 */
export function decideFeedbackPrompt(
  state: FeedbackCadenceState,
  nowMs: number,
  config: FeedbackCadenceConfig = DEFAULT_FEEDBACK_CADENCE
): boolean {
  if (state.optOut) return false;

  const createdMs = parseMs(state.accountCreatedAt);
  if (createdMs === null || nowMs - createdMs < config.minAccountAgeMs) return false;

  const lastMs = parseMs(state.lastPromptedAt);
  if (lastMs !== null && nowMs - lastMs < config.intervalMs) return false;

  return true;
}

export type NpsBand = 'detractor' | 'passive' | 'promoter';

/** Map a 0–10 NPS score to its band. */
export function npsBand(score: number): NpsBand {
  if (score <= 6) return 'detractor';
  if (score <= 8) return 'passive';
  return 'promoter';
}
