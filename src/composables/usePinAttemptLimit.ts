import { computed, onBeforeUnmount, ref, unref, type Ref } from 'vue';
import { MAX_PIN_ATTEMPTS } from '@/services/auth/deviceUnlock';
import { logEvent } from '@/services/telemetry/logEvent';

/**
 * Brute-force limit for a PIN entry surface — attempts and cooldown that OUTLIVE the
 * component.
 *
 * Two surfaces need this and both got it wrong in the same way (#80 review). The wall pad
 * kept `failures`/`lockedUntil` in component refs while `BaseModal` renders its slot under
 * `v-if="open"` — so closing the challenge unmounted the pad and reset the count to zero,
 * making the limit ~2 extra taps per 5 guesses on the product's one physically-exposed
 * always-on screen. The step-up challenge, described in `useReauth` as "the actual
 * security boundary of #80", had no limit at all: unlimited guesses at
 * transfer-ownership, remove-member, reset-another-member's-PIN and clear-all-data, with
 * no failure telemetry to notice it happening.
 *
 * The state therefore lives in a MODULE-level map keyed by `scope`, mirrored into
 * `localStorage` so a reload does not hand back a fresh budget either. Neither store is a
 * cryptographic boundary — anything with the page's origin can clear both — but that is
 * true of every client-side limit here, and `sessionSeal`'s own header says as much: what
 * this defeats is a person tapping guesses at a keypad, which is the realistic attacker.
 *
 * `scope` names what is being guarded, not the component instance: `reauth:<memberId>` so
 * a per-member budget cannot be reset by switching members and back, and `wall-unlock` for
 * the pad, whose candidate list is the family's adults rather than one person.
 */

/** How long a surface stays shut after exhausting its attempts. */
export const PIN_COOLDOWN_MS = 60_000;

const STORAGE_KEY = 'beanies_pin_attempts';

interface AttemptState {
  failures: number;
  lockedUntil: number;
}

const states = new Map<string, AttemptState>();

/** Shared 1Hz clock. One interval for the whole app rather than one per mounted pad. */
const now = ref(Date.now());
let tickerRefs = 0;
let ticker: ReturnType<typeof setInterval> | null = null;

function readPersisted(): Record<string, AttemptState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, AttemptState>) : {};
  } catch {
    // Private browsing, blocked storage, or a corrupt blob. In-memory state still
    // applies — a reload just starts from a clean budget, which is the pre-existing
    // behaviour rather than a regression.
    return {};
  }
}

function persist(): void {
  try {
    const out: Record<string, AttemptState> = {};
    for (const [key, state] of states) {
      // Only a LIVE cooldown is worth keeping. Persisting spent entries would grow the
      // blob without bound on a wall that runs for months.
      if (state.lockedUntil > Date.now()) out[key] = state;
    }
    if (Object.keys(out).length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  } catch {
    // Best-effort: an unpersisted cooldown is still enforced for this page load.
  }
}

function stateFor(scope: string): AttemptState {
  let state = states.get(scope);
  if (!state) {
    const persisted = readPersisted()[scope];
    state = {
      failures: persisted?.failures ?? 0,
      // A stored cooldown that has already elapsed, or one implausibly far in the future
      // (a clock moved backwards since it was written), is discarded rather than trusted.
      lockedUntil:
        typeof persisted?.lockedUntil === 'number' &&
        persisted.lockedUntil > Date.now() &&
        persisted.lockedUntil <= Date.now() + PIN_COOLDOWN_MS
          ? persisted.lockedUntil
          : 0,
    };
    states.set(scope, state);
  }
  return state;
}

/**
 * @param scope What is being guarded. A ref is accepted so a surface whose target member
 *              changes (the step-up challenge) re-scopes without remounting. NEVER
 *              logged — it embeds a member id, and the firehose context is allowlisted.
 * @param surface Telemetry surface, so a run of failures is greppable in CloudWatch.
 * @param kind Fixed enum naming WHICH pad this is, reusing the already-declared `kind`
 *             context key rather than shipping a new one.
 */
export function usePinAttemptLimit(
  scope: string | Ref<string>,
  surface: string,
  kind: 'reauth' | 'wall-unlock'
) {
  // Reactive revision so the computeds below re-evaluate when the plain-object state
  // mutates — the Map holds POJOs deliberately, to survive unmount.
  const revision = ref(0);

  tickerRefs += 1;
  ticker ??= setInterval(() => (now.value = Date.now()), 1000);
  onBeforeUnmount(() => {
    tickerRefs -= 1;
    if (tickerRefs <= 0 && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  });

  const current = computed(() => {
    void revision.value;
    return stateFor(unref(scope));
  });

  const cooldownSeconds = computed(() =>
    Math.max(0, Math.ceil((current.value.lockedUntil - now.value) / 1000))
  );
  const inCooldown = computed(() => cooldownSeconds.value > 0);
  const attemptsRemaining = computed(() => Math.max(0, MAX_PIN_ATTEMPTS - current.value.failures));

  /**
   * Count a wrong PIN. Returns true when THIS failure started a cooldown, so the caller
   * can choose the "too many attempts" wording over the plain "incorrect" one.
   */
  function recordFailure(): boolean {
    const key = unref(scope);
    const state = stateFor(key);
    state.failures += 1;
    const exhausted = state.failures >= MAX_PIN_ATTEMPTS;
    if (exhausted) {
      state.failures = 0;
      state.lockedUntil = Date.now() + PIN_COOLDOWN_MS;
      now.value = Date.now();
    }
    revision.value += 1;
    persist();
    // Emitted on EVERY failure, not just the lockout, so the failure RATE is measurable —
    // a run of wrong PINs at a step-up is the signal that somebody is guessing, and before
    // this neither surface left any trace of one at all.
    logEvent({
      level: exhausted ? 'warn' : 'info',
      surface,
      message: exhausted ? 'pin_attempts_exhausted' : 'pin_attempt_failed',
      context: { action: exhausted ? 'pin_locked_out' : 'pin_failed', kind },
    });
    return exhausted;
  }

  /** A correct PIN clears the budget for this scope. */
  function recordSuccess(): void {
    const key = unref(scope);
    states.delete(key);
    revision.value += 1;
    persist();
  }

  return { inCooldown, cooldownSeconds, attemptsRemaining, recordFailure, recordSuccess };
}

/** Test-only: forget every scope's attempts. */
export function __resetPinAttemptsForTests(): void {
  states.clear();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing to clear
  }
}
