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
 *   - REPLACED by a "done" record (`markPodSetupDone`) by `completePodSetup` once the completion
 *     has been sent (wizard or late path). The done record is what makes "sent once" hold across
 *     tabs and reloads: every path checks it first and sends nothing when it is there. It
 *     expires like the marker does.
 *   - CLEARED (marker or done record) by `familyContext.deleteLocalFamily` when the family is
 *     forgotten on this device (the "sign out and clear all data" sweep, an eviction). A plain
 *     sign-out keeps it on purpose: the marker names the creating member, so only that person
 *     signing back in on this device can act on it, and that is exactly the completion still owed.
 *
 * ⚠️ ONE SENDER AT A TIME, ACROSS TABS. localStorage is shared by every tab of the profile, the
 * per-tab latch in `syncStore` is not. So the wizard HOLDS a Web Lock named for the family
 * (`holdPodSetupLock`) from the pod write until its completion returns or it unmounts, and the
 * late path asks for the same lock with `ifAvailable` (`withPodSetupLockIfAvailable`): while the
 * wizard (or another tab's late send) owns it, the late path skips. Where `navigator.locks` is
 * unavailable (or refuses), both fall back to running unlocked, the pre-lock behaviour; the done
 * record still stops any send that starts after another one finished.
 *
 * ⚠️ localStorage, one key per family (`beanies:setup-pending:<familyId>`), through `storedJson`,
 * which never throws: storage being unavailable can never break the wizard or the sign-in. The
 * record holds random ids, a step name from a closed set and a timestamp. Nothing a person typed.
 *
 * Firehose (`surface: 'onboarding'`, message `setup-marker`, allowlisted keys only):
 *   - `{ action: 'set', detail: <step> }`        the marker was written at the pod write;
 *   - `{ action: 'done' }`                       the completion was sent, the done record written;
 *   - `{ action: 'cleared', detail: <reason> }`  family-forgotten | corrupt | expired | done-expired;
 *   - `{ action: 'storage-failed', stage }`      set | step | done | clear refused by storage (`warn`);
 *   - `{ action: 'lock-failed' }`                the Web Lock request was refused (`warn`), unlocked.
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
  /** The completion was sent (on this device, from any tab): nothing more to send. */
  | { kind: 'done' }
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
 * login flow knows it, else no method (a load or join surface that signs in directly).
 */
export type SetupReturnVia =
  { kind: 'restored'; native: boolean } | { kind: 'signed-in'; method?: SignInVia };

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

/**
 * The ONE place a way back is spelled: the telemetry `kind` string and the Slack words, together,
 * so the two cannot drift.
 */
function describeReturn(via: SetupReturnVia): { kind: string; words: string } {
  if (via.kind === 'restored') {
    return via.native
      ? { kind: 'app-restarted', words: 'app restarted' }
      : { kind: 'page-reloaded', words: 'page reloaded' };
  }
  if (!via.method) return { kind: 'signed-in', words: 'signed in' };
  return {
    kind: `signed-in-${via.method}`,
    words: `signed in with ${SIGN_IN_WORDS[via.method]}`,
  };
}

/** The firehose `kind` for a way back: `app-restarted`, `page-reloaded`, `signed-in[-<method>]`. */
export function setupReturnKind(via: SetupReturnVia): string {
  return describeReturn(via).kind;
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
  return `\n*Setup:* left at the ${STEP_WORDS[late.leftAt]} step, finished on next open (${describeReturn(late.via).words})`;
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

/** The record that replaces the marker once the completion was sent: when, nothing else. */
interface PodSetupDone {
  done: true;
  /** `Date.now()` when the completion was sent; it expires like the marker does. */
  doneAt: number;
}

function parseDone(value: unknown): PodSetupDone | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.done !== true || typeof v.doneAt !== 'number' || !Number.isFinite(v.doneAt)) return null;
  return { done: true, doneAt: v.doneAt };
}

/** Older than the max age, or from the future (the clock moved back): untrustworthy either way. */
function isStale(at: number, now: number): boolean {
  const age = now - at;
  return age > POD_SETUP_PENDING_MAX_AGE_MS || age < 0;
}

/**
 * Read the marker for a family. A corrupt or expired record is removed here (and logged), so the
 * next open classifies the same way at most once more if the removal is refused. An expired done
 * record is removed too and reads as `missing`: its job (stopping a second send) is long over.
 */
export function readPodSetupPending(
  familyId: string,
  now: number = Date.now()
): PodSetupPendingRead {
  const read = readStoredJson(podSetupPendingKey(familyId), LABEL);
  if (read.kind === 'missing') return { kind: 'missing' };
  const done = read.kind === 'ok' ? parseDone(read.value) : null;
  if (done) {
    if (!isStale(done.doneAt, now)) return { kind: 'done' };
    remove(familyId, 'done-expired');
    return { kind: 'missing' };
  }
  const value = read.kind === 'ok' ? parse(read.value) : null;
  if (!value) {
    remove(familyId, 'corrupt');
    return { kind: 'corrupt' };
  }
  if (isStale(value.createdAt, now)) {
    remove(familyId, 'expired');
    return { kind: 'expired' };
  }
  return { kind: 'ok', value };
}

/**
 * The completion was sent: replace the marker (or nothing) with the done record, in one write,
 * so no reader in another tab ever sees neither. Never throws; a refused write is logged at
 * `warn` (the marker may then still be there, and the next open could send once more).
 */
export function markPodSetupDone(familyId: string, now: number = Date.now()): void {
  const record: PodSetupDone = { done: true, doneAt: now };
  const written = writeStoredJson(podSetupPendingKey(familyId), record, LABEL);
  if (written.ok) log('info', { action: 'done' });
  else log('warn', { action: 'storage-failed', stage: 'done' }, written.error);
}

/**
 * Remove the marker or the done record: the family left this device. Silent when there is none,
 * so the family-delete sweep adds no line for the families that never had one.
 */
export function clearPodSetupPending(familyId: string, reason: 'family-forgotten'): void {
  if (readStoredJson(podSetupPendingKey(familyId), LABEL).kind === 'missing') return;
  remove(familyId, reason);
}

/** The Web Lock that says "this context is sending (or about to send) the family's completion". */
export function podSetupLockName(familyId: string): string {
  return `beanies-pod-setup:${familyId}`;
}

function lockManager(): LockManager | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  return typeof locks?.request === 'function' ? locks : undefined;
}

/**
 * The wizard's hold on the family's setup lock, from the pod write until its completion returns
 * or it unmounts. Requested at once and never awaited (the wizard must not wait on it); the
 * returned function lets it go, and is safe to call more than once or before the grant.
 *
 * Fallback: no Web Locks (or a refused request, logged `lock-failed`) means no hold, the pre-lock
 * behaviour; the done record still stops a late send that starts after the wizard's.
 */
export function holdPodSetupLock(familyId: string): () => void {
  const locks = lockManager();
  if (!locks) return () => {};
  let release: () => void = () => {};
  const untilReleased = new Promise<void>((r) => {
    release = r;
  });
  // Not `ifAvailable`: nothing else holds a brand-new family's lock for more than a send, and
  // queueing behind one is right. Returning the pending promise HOLDS the lock.
  locks
    .request(podSetupLockName(familyId), () => untilReleased)
    .catch((e: unknown) => log('warn', { action: 'lock-failed', stage: 'hold' }, e));
  return release;
}

/**
 * Run `fn` holding the family's setup lock, only if no other context holds (or waits for) it:
 * `{ granted: false }` at once otherwise, and `fn` never runs. With no Web Locks, or a request
 * refused before `fn` started, `fn` runs unlocked (the pre-lock behaviour). A throw from `fn`
 * itself is passed through.
 */
export async function withPodSetupLockIfAvailable<T>(
  familyId: string,
  fn: () => Promise<T>
): Promise<{ granted: true; value: T } | { granted: false }> {
  const locks = lockManager();
  if (!locks) return { granted: true, value: await fn() };
  let started = false;
  let result: { granted: true; value: T } | { granted: false } = { granted: false };
  try {
    await locks.request(podSetupLockName(familyId), { ifAvailable: true }, async (lock) => {
      if (!lock) return;
      started = true;
      result = { granted: true, value: await fn() };
    });
  } catch (e) {
    if (started) throw e;
    log('warn', { action: 'lock-failed', stage: 'request' }, e);
    return { granted: true, value: await fn() };
  }
  return result;
}
