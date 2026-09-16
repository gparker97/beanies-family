import { watch, type Ref } from 'vue';
import { logEvent } from '@/services/telemetry/logEvent';
import type { JoinStep, AwaitingReason } from '@/composables/useJoinFlow';

const SURFACE = 'join-flow';

/**
 * Emit one event per join-flow step transition.
 *
 * ⚠️ THIS EXISTS BECAUSE A CLOSED LOOP RAN IN PRODUCTION AND EMITTED NOTHING. A joiner on iOS
 * could bounce between Google consent and the "we found your pod" card indefinitely: the step
 * regressed to `awaiting-auth` from two different places with no error recorded, so there was no
 * event, no alarm, and no way to tell it apart from someone simply not finishing. It took a user
 * writing in to find it, and the only reason we could confirm the platform afterwards was an
 * unrelated `OAUTH_REDIRECT_FAILED` that happened to fire twice.
 *
 * ⚠️ A WATCHER, NOT CALL-SITE EMITS, for a reason specific to this flow: `JoinPodView` writes
 * `flow.currentStep.value` DIRECTLY. A `setStep()` helper would miss those writes and the gap
 * would be invisible. A watcher on the ref cannot be bypassed by anything that can change it.
 *
 * ⚠️ MESSAGE CARDINALITY IS A CONSTRAINT, NOT A STYLE NOTE. `logEvent` rate-limits per
 * `${surface}::${normalizeMessage(message)}` at 50/min. The message is composed ONLY from the
 * closed `JoinStep` and `AwaitingReason` unions — never a file name, an email or an id — so the
 * bucket count stays bounded (~40) and a genuine loop still trips the same bucket 50 times
 * before suppression rather than scattering across thousands of unique buckets.
 *
 * Call from inside `useJoinFlow`'s setup scope so `watch` binds to the component effect scope;
 * outside one, a unit test calling `useJoinFlow()` would leak watchers.
 */
export function watchJoinSteps(
  currentStep: Ref<JoinStep>,
  awaitingReason: Ref<AwaitingReason>
): void {
  watch(currentStep, (to, from) => {
    // The reason only means anything for the step it belongs to.
    const reason = to === 'awaiting-auth' ? awaitingReason.value : undefined;

    // ⚠️ THE ALARM IS THE REPEAT, NOT THE EVENT. Landing on `awaiting-auth/needs-pick` once
    // is the EXPECTED first-join state: a fresh `drive.file` grant cannot reach the inviter's
    // file, so the 404 and the resulting "choose your file" card are how a correct join begins.
    // Levelling that at `warn` measured join VOLUME and called it breakage, which would have
    // made the one signal that matters unreadable at exactly the moment it fired.
    //
    // What breakage actually looks like is the SECOND arrival with no join in between: the
    // joiner tapped the CTA, went to Google, came back, and is being asked the same thing again.
    const isNeedsPick = to === 'awaiting-auth' && reason === 'needs-pick';
    const arrivals = isNeedsPick ? bumpNeedsPickCount() : 0;
    const level = arrivals >= 2 ? 'warn' : 'info';

    logEvent({
      level,
      surface: SURFACE,
      message: `join step ${from ?? 'none'} -> ${to}${reason ? ` (${reason})` : ''}`,
      context: { action: 'join_step', ...(isNeedsPick ? { count: arrivals } : {}) },
    });
  });
}

/**
 * How many times this tab has been asked to pick the file, across redirects.
 *
 * ⚠️ `sessionStorage`, NOT a closure variable, and that is the whole point. Each turn of the
 * loop is a FULL-PAGE navigation to Google and back, so a counter living in `useJoinFlow`'s
 * scope is reconstructed at one on every iteration and can never see the repeat it exists to
 * detect. `sessionStorage` is per-tab and survives the redirect, which matches the loop exactly.
 *
 * Returns the arrival number (1 for the first). Storage can throw or be absent in a private
 * window, so a failure degrades to "first arrival" — an under-report, never a false alarm, and
 * never an exception on a telemetry path.
 */
const NEEDS_PICK_COUNT_KEY = 'beanies.join.needsPickArrivals';

function bumpNeedsPickCount(): number {
  try {
    const next = Number(sessionStorage.getItem(NEEDS_PICK_COUNT_KEY) ?? '0') + 1;
    sessionStorage.setItem(NEEDS_PICK_COUNT_KEY, String(next));
    return Number.isFinite(next) ? next : 1;
  } catch {
    return 1;
  }
}

/** Clear the loop counter once a join actually completes. */
function clearNeedsPickCount(): void {
  try {
    sessionStorage.removeItem(NEEDS_PICK_COUNT_KEY);
  } catch {
    // Nothing to do and nothing at risk: a stale counter only affects the next join's level.
  }
}

/**
 * The denominator.
 *
 * Without a success event the firehose can only ever count failures, never the RATE — and a
 * failure count with no denominator cannot tell a broken release from a busy week.
 */
export function emitJoinCompleted(): void {
  clearNeedsPickCount();
  logEvent({
    level: 'info',
    surface: SURFACE,
    message: 'join completed',
    context: { action: 'join_completed' },
  });
}
