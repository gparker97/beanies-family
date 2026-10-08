/**
 * The device-side holder for the open pod-creation attempt (#128).
 *
 * A create attempt opens on the Create tap (`WelcomeGate`) and ends at setup completion, on
 * Start over, or when another sign-in path completes. Its random id (`create_attempt_id`)
 * is stamped onto EVERY firehose event while it is open by `enrichAndRedact`
 * (`diagnosticContext.ts`), and onto the registry rows the create writes, so one CloudWatch
 * query grouped by the id returns each attempt's funnel.
 *
 * ⚠️ STATE ONLY, NO TELEMETRY. `diagnosticContext.ts` reads `currentCreateAttempt()` and must
 * stay import-free from `services/telemetry` (`logEvent` imports `enrichAndRedact`, so a module
 * that both logs and is read there is an import cycle). Everything that logs lives in the
 * orchestrator, `src/services/telemetry/onboardingAttempt.ts`; this module imports only
 * `storedJson` and never logs (`storedJson` itself console-warns with the key on a refused
 * read, write or removal).
 *
 * ⚠️ localStorage, NOT sessionStorage. The iOS/PWA Drive redirect may return in a new tab
 * and the native OAuth round trip leaves the webview entirely; `sessionStorage` would lose the
 * id on both. Same reasoning, same mechanism as `attributionStash.ts`.
 *
 * ⚠️ AN IN-MEMORY CACHE IS THE READ PATH. `enrichAndRedact` runs on every firehose event, so
 * `currentCreateAttempt()` must not read and parse localStorage per call. The cache is filled
 * once by `hydrateCreateAttempt()` at boot and updated by every `setCreateAttempt()`. A refused
 * write keeps the cache (the attempt still tags this page's events); the caller reports it.
 * There is no cross-tab sync: a second tab's Create tap supersedes the first's stored record,
 * and the first tab keeps its cached id.
 *
 * The stored record is only `{ id, startedAt, step }`: a random UUID, a timestamp and a step
 * name from a closed set. Nothing a person typed.
 */

import { readStoredJson, removeStoredJson, writeStoredJson } from '@/utils/storedJson';
import type { StoredJsonWrite } from '@/utils/storedJson';

const STORAGE_KEY = 'beanies:create-attempt';
const LABEL = 'createAttempt';

/** An attempt older than this is dropped at boot (`expired`), never resumed. */
export const CREATE_ATTEMPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Every step the onboarding funnel names, in the order a person meets them. The firehose
 * `detail` of every `onboarding` event is one of these, so the set is closed by construction.
 */
export const ONBOARDING_STEPS = [
  'welcome',
  'about-you',
  'storage',
  'drive-consent',
  'resume-probe',
  'drive-declined',
  'pin',
  'kit',
  'members',
  'survey',
  'done',
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

const STEP_SET: ReadonlySet<string> = new Set(ONBOARDING_STEPS);

export interface CreateAttempt {
  /** Random UUID, minted on the Create tap. */
  id: string;
  /** `Date.now()` at the Create tap. */
  startedAt: number;
  /** The last step that was SHOWN (`trackOnboardingStep(step, 'shown')`). */
  step: OnboardingStep;
}

/**
 * The outcome of the boot read.
 *   - `ok`      a live attempt; `attempt` is it, and it is now the cached open attempt.
 *   - `missing` nothing stored (or the read was refused); `attempt` is null.
 *   - `corrupt` unparseable or the wrong shape; removed; `attempt` is null.
 *   - `expired` older than 24 h (or stamped in the future); removed; `attempt` is the STALE
 *     record, returned only so the caller can log the step it stopped at. It is NOT open.
 */
export type CreateAttemptHydration =
  | { kind: 'ok'; attempt: CreateAttempt }
  | { kind: 'missing'; attempt: null }
  | { kind: 'corrupt'; attempt: null }
  | { kind: 'expired'; attempt: CreateAttempt };

let cached: CreateAttempt | null = null;

function parseAttempt(value: unknown): CreateAttempt | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id.length === 0 || v.id.length > 64) return null;
  if (typeof v.startedAt !== 'number' || !Number.isFinite(v.startedAt)) return null;
  if (typeof v.step !== 'string' || !STEP_SET.has(v.step)) return null;
  return { id: v.id, startedAt: v.startedAt, step: v.step as OnboardingStep };
}

/**
 * Read the stored attempt into the cache. Called once at boot by `installOnboardingAttempt`.
 * Never logs and never throws; a corrupt or expired record is removed (a refused removal is
 * console-warned by `storedJson` and is harmless: the next boot classifies it the same way).
 */
export function hydrateCreateAttempt(now: number = Date.now()): CreateAttemptHydration {
  cached = null;
  const read = readStoredJson(STORAGE_KEY, LABEL);
  if (read.kind === 'missing') return { kind: 'missing', attempt: null };

  const attempt = read.kind === 'ok' ? parseAttempt(read.value) : null;
  if (!attempt) {
    removeStoredJson(STORAGE_KEY, LABEL);
    return { kind: 'corrupt', attempt: null };
  }

  const age = now - attempt.startedAt;
  // A record from the future (clock moved back) is as untrustworthy as an old one.
  if (age > CREATE_ATTEMPT_MAX_AGE_MS || age < 0) {
    removeStoredJson(STORAGE_KEY, LABEL);
    return { kind: 'expired', attempt };
  }

  cached = attempt;
  return { kind: 'ok', attempt };
}

/** The open attempt, from the in-memory cache. Cheap; safe to call on every firehose event. */
export function currentCreateAttempt(): CreateAttempt | null {
  return cached;
}

/**
 * Replace (or, with `null`, clear) the open attempt. The cache is updated first and kept
 * whatever the storage does; the storage result is returned, never thrown, so the caller can
 * report a refused write.
 */
export function setCreateAttempt(attempt: CreateAttempt | null): StoredJsonWrite {
  if (attempt === null) {
    cached = null;
    return removeStoredJson(STORAGE_KEY, LABEL);
  }
  cached = { id: attempt.id, startedAt: attempt.startedAt, step: attempt.step };
  return writeStoredJson(STORAGE_KEY, cached, LABEL);
}

/** Test-only: drop the cache without touching storage. */
export function __resetCreateAttemptForTesting(): void {
  cached = null;
}
