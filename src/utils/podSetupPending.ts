/**
 * The device-side marker for "this pod exists but its setup was never completed" (#128 follow-up,
 * 2026-11-16).
 *
 * The create wizard writes the pod, then shows the recovery kit, the members step and the survey,
 * and only after the last of those does `syncStore.completePodSetup` run (the registry write with
 * the survey answer, the "Family pod created!" Slack post, `pod_created`, the funnel's `done`). A
 * reload or an app restart after the pod write signs the person straight into the app and the
 * wizard never resumes, so the completion never ran: 3 of 24 pods created between 2026-11-02 and
 * 2026-11-16 ended that way, all at the kit step. This marker survives that reload, and the next
 * signed-in open for the same family and member finishes the setup late
 * (`syncStore.finishPendingPodSetup`).
 *
 * Lifecycle:
 *   - SET by `syncStore.createNewFile` at the pod write's point of no return (never for the demo
 *     seed). The creating device is the only one that ever writes it, which is what makes "only
 *     the owner's device that created the pod sends the late completion" true by construction.
 *   - STEP updated by `ResumePodSetup`'s phase watcher with each post-write step SHOWN.
 *   - CLEARED by `completePodSetup` once its Slack post has gone out (normal and late path), and
 *     by `familyContext.deleteLocalFamily` when the family is forgotten on this device (the
 *     "sign out and clear all data" sweep, an eviction). A plain sign-out keeps it on purpose:
 *     the marker names the creating member, so only that person signing back in on this device
 *     can act on it, and that is exactly the completion still owed.
 *
 * ⚠️ localStorage, one key per family (`beanies:setup-pending:<familyId>`), through `storedJson`,
 * which never throws: storage being unavailable can never break the wizard or the sign-in. The
 * record holds random ids, a step name from a closed set and a timestamp. Nothing a person typed.
 *
 * Firehose (`surface: 'onboarding'`, message `setup-marker`, allowlisted keys only):
 *   - `{ action: 'set', detail: <step> }`        the marker was written at the pod write;
 *   - `{ action: 'cleared', detail: <reason> }`  completed | family-forgotten | corrupt | expired;
 *   - `{ action: 'storage-failed', stage }`      set | step | clear refused by storage (`warn`).
 * A step update logs nothing on success: the wizard's own `step shown` events already record it.
 */

import type { HeardVia } from '@beanies/brand/heardVia';
import { logEvent } from '@/services/telemetry/logEvent';
import type { OnboardingStep } from '@/utils/createAttemptState';
import { readStoredJson, removeStoredJson, writeStoredJson } from '@/utils/storedJson';

const LABEL = 'setupPending';
const SURFACE = 'onboarding';

/** A marker older than this is dropped rather than acted on: a "pod created" post months late misleads. */
export const POD_SETUP_PENDING_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** The wizard steps shown AFTER the pod write, in order; the funnel's own ids for them. */
export const POD_SETUP_STEPS = [
  'kit',
  'members',
  'survey',
] as const satisfies readonly OnboardingStep[];
export type PodSetupStep = (typeof POD_SETUP_STEPS)[number];

export function isPodSetupStep(step: string): step is PodSetupStep {
  return (POD_SETUP_STEPS as readonly string[]).includes(step);
}

export interface PodSetupPending {
  /** The member who created the pod; only their signed-in open finishes it. */
  memberId: string;
  /** The create attempt open at the pod write, so the late completion closes THAT funnel. */
  attemptId: string | null;
  /** The last post-write step shown. */
  step: PodSetupStep;
  /** `Date.now()` at the pod write. */
  createdAt: number;
}

export type PodSetupPendingRead =
  | { kind: 'ok'; value: PodSetupPending }
  | { kind: 'missing' }
  | { kind: 'corrupt' }
  | { kind: 'expired' };

/**
 * The survey's outcome, three states told apart where the fact is known, never inferred from a
 * null answer: `answered` and `skipped` come from the wizard's survey step (the person saw it),
 * `not-seen` from a setup finished late (the wizard was left before or at the survey).
 */
export type SetupSurveyOutcome =
  { kind: 'answered'; heardVia: HeardVia } | { kind: 'skipped' } | { kind: 'not-seen' };

/** How a sign-in proved the person, as the login flow knows it (`login-flow` `prove_outcome`). */
export type SignInVia =
  | 'pin'
  | 'biometric'
  | 'tap-through'
  | 'password'
  | 'passphrase'
  | 'recovery-kit'
  | 'recovery-passphrase';

/**
 * How the person came back to a pod whose setup was left unfinished. A restored session is told
 * apart by platform only (the code cannot know more); a fresh sign-in by its method when the
 * login flow knows it, else plain `signed-in` (a load or join surface that signs in directly).
 */
export type SetupReturnVia =
  'app-restarted' | 'page-reloaded' | 'signed-in' | `signed-in-${SignInVia}`;

/** A setup finished on a later open rather than in the wizard. */
export interface LateSetupFinish {
  leftAt: PodSetupStep;
  via: SetupReturnVia;
  attemptId: string | null;
}

const STEP_WORDS: Record<PodSetupStep, string> = {
  kit: 'recovery kit',
  members: 'add members',
  survey: 'survey',
};

const SIGN_IN_WORDS: Record<SignInVia, string> = {
  pin: 'PIN',
  biometric: 'biometrics',
  'tap-through': 'a tap on their name',
  password: 'password',
  passphrase: 'passphrase',
  'recovery-kit': 'recovery kit',
  'recovery-passphrase': 'recovery passphrase',
};

function viaWords(via: SetupReturnVia): string {
  if (via === 'app-restarted') return 'app restarted';
  if (via === 'page-reloaded') return 'page reloaded';
  if (via === 'signed-in') return 'signed in';
  return `signed in with ${SIGN_IN_WORDS[via.slice('signed-in-'.length) as SignInVia]}`;
}

/**
 * The "Heard via" line of the pod-created Slack post. Always present, so a skip and a survey
 * never reached each read differently from a missing line.
 */
export function heardViaSlackLine(survey: SetupSurveyOutcome): string {
  const value =
    survey.kind === 'answered'
      ? survey.heardVia.label || '(skipped)'
      : survey.kind === 'skipped'
        ? '(skipped)'
        : '(not seen)';
  return `\n*Heard via:* ${value}`;
}

/** The "Setup" line, present ONLY when setup finished on a later open. Internal ops copy. */
export function setupSlackLine(late: LateSetupFinish | undefined): string {
  if (!late) return '';
  return `\n*Setup:* left at the ${STEP_WORDS[late.leftAt]} step, finished on next open (${viaWords(late.via)})`;
}

export function podSetupPendingKey(familyId: string): string {
  return `beanies:setup-pending:${familyId}`;
}

function log(level: 'info' | 'warn', context: Record<string, string>, error?: unknown): void {
  logEvent({
    level,
    surface: SURFACE,
    message: 'setup-marker',
    context,
    ...(error === undefined ? {} : { error }),
  });
}

function parse(value: unknown): PodSetupPending | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.memberId !== 'string' || v.memberId.length === 0 || v.memberId.length > 128) {
    return null;
  }
  if (v.attemptId !== null && (typeof v.attemptId !== 'string' || v.attemptId.length > 64)) {
    return null;
  }
  if (typeof v.step !== 'string' || !isPodSetupStep(v.step)) return null;
  if (typeof v.createdAt !== 'number' || !Number.isFinite(v.createdAt)) return null;
  return { memberId: v.memberId, attemptId: v.attemptId, step: v.step, createdAt: v.createdAt };
}

function remove(familyId: string, reason: string): void {
  const removed = removeStoredJson(podSetupPendingKey(familyId), LABEL);
  if (removed.ok) log('info', { action: 'cleared', detail: reason });
  else log('warn', { action: 'storage-failed', stage: 'clear', detail: reason }, removed.error);
}

/**
 * Write the marker at the pod write. The first step is `kit`: the wizard shows it next, with
 * only the PIN wrap enrolment in between. Never throws; a refused write means no late
 * completion can ever come for this pod, so it is logged at `warn`.
 */
export function markPodSetupPending(
  familyId: string,
  memberId: string,
  attemptId: string | null,
  now: number = Date.now()
): void {
  const record: PodSetupPending = { memberId, attemptId, step: 'kit', createdAt: now };
  const written = writeStoredJson(podSetupPendingKey(familyId), record, LABEL);
  if (written.ok) log('info', { action: 'set', detail: record.step });
  else log('warn', { action: 'storage-failed', stage: 'set' }, written.error);
}

/** Record the last post-write step shown. A no-op with no marker (or an unreadable one). */
export function notePodSetupStep(familyId: string, step: PodSetupStep): void {
  const read = readStoredJson(podSetupPendingKey(familyId), LABEL);
  if (read.kind !== 'ok') return;
  const current = parse(read.value);
  if (!current || current.step === step) return;
  const written = writeStoredJson(podSetupPendingKey(familyId), { ...current, step }, LABEL);
  if (!written.ok)
    log('warn', { action: 'storage-failed', stage: 'step', detail: step }, written.error);
}

/**
 * Read the marker for a family. A corrupt or expired record is removed here (and logged), so the
 * next open classifies the same way at most once more if the removal is refused.
 */
export function readPodSetupPending(
  familyId: string,
  now: number = Date.now()
): PodSetupPendingRead {
  const read = readStoredJson(podSetupPendingKey(familyId), LABEL);
  if (read.kind === 'missing') return { kind: 'missing' };
  const value = read.kind === 'ok' ? parse(read.value) : null;
  if (!value) {
    remove(familyId, 'corrupt');
    return { kind: 'corrupt' };
  }
  const age = now - value.createdAt;
  // A record from the future (clock moved back) is as untrustworthy as an old one.
  if (age > POD_SETUP_PENDING_MAX_AGE_MS || age < 0) {
    remove(familyId, 'expired');
    return { kind: 'expired' };
  }
  return { kind: 'ok', value };
}

/**
 * Remove the marker. `completed`: the completion's Slack post has gone out. `family-forgotten`:
 * the family left this device. Silent when there is none, so the family-delete sweep adds no
 * line for the families that never had one.
 */
export function clearPodSetupPending(
  familyId: string,
  reason: 'completed' | 'family-forgotten'
): void {
  if (readStoredJson(podSetupPendingKey(familyId), LABEL).kind === 'missing') return;
  remove(familyId, reason);
}
