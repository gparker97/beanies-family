/**
 * The pod-creation funnel (#128): the orchestrator that opens, advances and ends a create
 * attempt and emits the `onboarding` firehose events.
 *
 * The attempt itself (`{ id, startedAt, step }`) lives in the state holder
 * `src/utils/createAttemptState.ts`, which `enrichAndRedact` reads to stamp
 * `create_attempt_id` on every event while an attempt is open. This module is the only writer
 * of that state and the only place that logs about it. It imports `logEvent` directly, never
 * the `@/services/telemetry` barrel (see the note in `telemetry/index.ts`).
 *
 * Lifecycle:
 *   - `installOnboardingAttempt()` once at boot from `main.ts`: hydrate, report a dropped
 *     attempt, register the pre-beacon `pagehide` hook. No module-init side effects.
 *   - `beginCreateAttempt()` on the Create tap (`WelcomeGate`).
 *   - `trackOnboardingStep()` / `trackStorageChoice()` from the wizard's steps.
 *   - `endCreateAttempt()` at setup completion (`done`), Start over (`start-over`), another
 *     sign-in completing or a second Create tap (`superseded`).
 *
 * Firehose (`surface: 'onboarding'`, level `info`, allowlisted keys only; every event also
 * carries `create_attempt_id` through `enrichAndRedact`):
 *   - `step`           `{ action: shown|submitted|back, detail: <step>, error_code? }`
 *   - `storage`        `{ action: 'chosen', detail: drive|local }`
 *   - `abandon`        `{ action: 'pagehide', detail: <step> }`, enqueued before the unload
 *                      beacon; never at `drive-consent` (the Drive redirect unloads the page by
 *                      design; that step's exits are its own `submitted`/`back`) or `done`.
 *   - `attempt-ended`  `{ action: done|start-over|superseded, detail: <last shown step> }`
 *   - `attempt-expired` / `attempt-corrupt` at boot, `{ detail: <step> }` when known; the
 *                      expired one names the stale id explicitly (the cache is already clear).
 *   - `attempt-storage-failed` (`reportError`, `warning`): localStorage refused the record; the
 *                      attempt carries on in memory for this page.
 */

import { logEvent } from '@/services/telemetry/logEvent';
import { registerPageHideHook } from '@/services/telemetry/logQueue';
import { reportError } from '@/utils/errorReporter';
import { generateUUID } from '@/utils/id';
import {
  currentCreateAttempt,
  hydrateCreateAttempt,
  setCreateAttempt,
  type CreateAttempt,
  type OnboardingStep,
} from '@/utils/createAttemptState';

export type { OnboardingStep } from '@/utils/createAttemptState';

const SURFACE = 'onboarding';

export type OnboardingStepAction = 'shown' | 'submitted' | 'back';
export type CreateAttemptEndReason = 'done' | 'start-over' | 'superseded';

let installed = false;

/**
 * Write the attempt (or clear it) and report a refusal once per call at `warning`. The cache
 * is already updated by `setCreateAttempt`, so the attempt keeps tagging this page's events;
 * only a cross-page hop (the Drive redirect, a reload) loses it.
 */
function persist(attempt: CreateAttempt | null, stage: 'begin' | 'step' | 'end'): void {
  const result = setCreateAttempt(attempt);
  if (result.ok) return;
  reportError({
    surface: SURFACE,
    severity: 'warning',
    message: 'attempt-storage-failed',
    error: result.error,
    context: { action: 'storage-failed', stage },
  });
}

/**
 * The pre-beacon `pagehide` hook. Logs through `logEvent` (synchronous through to the
 * enqueue, and enriched with `create_attempt_id`) so the event rides the unload beacon.
 */
function logAbandonOnPageHide(): void {
  const attempt = currentCreateAttempt();
  if (!attempt) return;
  if (attempt.step === 'done' || attempt.step === 'drive-consent') return;
  logEvent({
    level: 'info',
    surface: SURFACE,
    message: 'abandon',
    context: { action: 'pagehide', detail: attempt.step },
  });
}

/**
 * Boot entry point, called once from `main.ts`. Idempotent: a second call does nothing, so
 * the pagehide hook is never registered twice.
 */
export function installOnboardingAttempt(): void {
  if (installed) return;
  installed = true;

  const hydrated = hydrateCreateAttempt();
  if (hydrated.kind === 'expired') {
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'attempt-expired',
      context: { detail: hydrated.attempt.step, create_attempt_id: hydrated.attempt.id },
    });
  } else if (hydrated.kind === 'corrupt') {
    logEvent({ level: 'info', surface: SURFACE, message: 'attempt-corrupt' });
  }

  registerPageHideHook(logAbandonOnPageHide);
}

/**
 * Open a new attempt on the Create tap and return its id. An attempt already open (a second
 * tap, or a create abandoned earlier in this browser) is ended as `superseded` first, so its
 * last step is recorded rather than overwritten.
 */
export function beginCreateAttempt(): string {
  if (currentCreateAttempt()) endCreateAttempt('superseded');
  const attempt: CreateAttempt = { id: generateUUID(), startedAt: Date.now(), step: 'welcome' };
  persist(attempt, 'begin');
  return attempt.id;
}

/**
 * One funnel step transition. A no-op when no attempt is open, so a returning user passing
 * through `/welcome` emits nothing. `shown` also records the step as the attempt's current
 * one (the abandon and attempt-ended events report it); `submitted` and `back` do not.
 */
export function trackOnboardingStep(
  step: OnboardingStep,
  action: OnboardingStepAction,
  extra?: { error_code?: string }
): void {
  const attempt = currentCreateAttempt();
  if (!attempt) return;
  if (action === 'shown' && attempt.step !== step) persist({ ...attempt, step }, 'step');
  logEvent({
    level: 'info',
    surface: SURFACE,
    message: 'step',
    context: { action, detail: step, ...extra },
  });
}

/**
 * The storage choice on the storage step. Logged whether or not an attempt is open: it is a
 * real choice made only inside the create wizard, and the event without an id still counts.
 */
export function trackStorageChoice(choice: 'drive' | 'local'): void {
  logEvent({
    level: 'info',
    surface: SURFACE,
    message: 'storage',
    context: { action: 'chosen', detail: choice },
  });
}

/**
 * End the open attempt (a no-op when none is open). Logged BEFORE the state is cleared, so the
 * event still carries the attempt's id.
 */
export function endCreateAttempt(reason: CreateAttemptEndReason): void {
  const attempt = currentCreateAttempt();
  if (!attempt) return;
  logEvent({
    level: 'info',
    surface: SURFACE,
    message: 'attempt-ended',
    context: { action: reason, detail: attempt.step },
  });
  persist(null, 'end');
}

/** Test-only: allow `installOnboardingAttempt` to run again. */
export function __resetOnboardingAttemptForTesting(): void {
  installed = false;
}
