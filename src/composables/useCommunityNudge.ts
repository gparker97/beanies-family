/**
 * Recurring "community nudge" — a gentle, capped Discord invite surfaced in the
 * notification bell ~every 7-10 days. Mirrors the `useBeanTips` module-singleton
 * + per-member-localStorage idiom (state is per member, per device).
 *
 * The cadence/cap/rotation logic lives in the PURE `decideIssue(state, now,
 * intervalMs)` function so it's deterministically unit-testable with plain
 * inputs (no Date.now / localStorage). The composable does only I/O around it.
 *
 * State is intentionally minimal and non-contradicting:
 *   - `activeNudge`  : the one live nudge (null = none showing)
 *   - `nextDueAt`    : absolute epoch ms; the 7-10d interval is rolled ONCE into
 *                      here at issue/snooze, so the gate is a single comparison
 *   - `shownCount`   : lifetime shows (cap stops the funnel)
 *   - `joined`       : "I'm already there!" / Join → never nudge again (this device)
 */
import { computed } from 'vue';
import { useSettingsStore } from '@/stores/settingsStore';
import { showToast } from '@/composables/useToast';
import { reportError } from '@/utils/errorReporter';
import { openDiscord } from '@/utils/discord';
import { COMMUNITY_NUDGE_COUNT } from '@/content/communityNudges';
import { createPerMemberStore } from '@/composables/perMemberStore';

export interface ActiveNudge {
  messageIndex: number;
  issuedAt: number;
}

interface NudgeState {
  schemaVersion: 1;
  activeNudge: ActiveNudge | null;
  nextDueAt: number;
  shownCount: number;
  joined: boolean;
}

const SCHEMA_VERSION = 1 as const;
const CAP = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A fresh interval in [7,10] days (ms). Randomness lives here, OUTSIDE the pure core. */
function randomIntervalMs(): number {
  return (7 + Math.floor(Math.random() * 4)) * DAY_MS; // 7, 8, 9, or 10 days
}

function emptyState(): NudgeState {
  return {
    schemaVersion: SCHEMA_VERSION,
    activeNudge: null,
    nextDueAt: 0,
    shownCount: 0,
    joined: false,
  };
}

/** Validate a parsed-JSON blob into a `NudgeState`. Greenfield (no v1-in-the-
 *  wild), so anything unexpected (incl. unknown/missing schemaVersion) resets to
 *  a fresh seeded state, persisted to overwrite the bad blob. */
function fromParsed(parsed: unknown): { state: NudgeState; persist?: boolean } {
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    (parsed as { schemaVersion?: unknown }).schemaVersion === SCHEMA_VERSION
  ) {
    const obj = parsed as Record<string, unknown>;
    const active = obj.activeNudge;
    const activeNudge =
      active &&
      typeof active === 'object' &&
      typeof (active as ActiveNudge).messageIndex === 'number' &&
      typeof (active as ActiveNudge).issuedAt === 'number'
        ? {
            messageIndex: (active as ActiveNudge).messageIndex,
            issuedAt: (active as ActiveNudge).issuedAt,
          }
        : null;
    return {
      state: {
        schemaVersion: SCHEMA_VERSION,
        activeNudge,
        nextDueAt: typeof obj.nextDueAt === 'number' ? obj.nextDueAt : 0,
        shownCount: typeof obj.shownCount === 'number' ? obj.shownCount : 0,
        joined: typeof obj.joined === 'boolean' ? obj.joined : false,
      },
    };
  }
  return { state: emptyState(), persist: true };
}

/**
 * PURE cadence decision. Given the current state, the current time, and a freshly
 * rolled interval, return the next state + whether a NEW nudge was issued. No I/O,
 * no globals — the single most logic-dense piece, kept deterministic for tests.
 */
export function decideIssue(
  s: NudgeState,
  now: number,
  intervalMs: number
): { state: NudgeState; shown: boolean } {
  if (s.joined) return { state: s, shown: false };
  if (s.activeNudge) return { state: s, shown: false }; // one live nudge at a time
  if (!s.nextDueAt) {
    // First run: seed the first-due time and defer (never nudge right after onboarding).
    return { state: { ...s, nextDueAt: now + intervalMs }, shown: false };
  }
  if (s.shownCount >= CAP) return { state: s, shown: false };
  if (now < s.nextDueAt) return { state: s, shown: false };

  return {
    state: {
      ...s,
      activeNudge: { messageIndex: s.shownCount % COMMUNITY_NUDGE_COUNT, issuedAt: now },
      nextDueAt: now + intervalMs,
      shownCount: s.shownCount + 1,
    },
    shown: true,
  };
}

// ── Module singleton store (per member, swapped on member change) ─────────────
const store = createPerMemberStore<NudgeState>({
  prefix: 'bean-community-nudge',
  label: 'useCommunityNudge',
  saveSurface: 'community-nudge-save',
  saveMessage: 'localStorage write failed for community-nudge',
  empty: emptyState,
  fromParsed,
  persistOnCorrupt: true,
});

const state = store.state;

export function useCommunityNudge() {
  const settingsStore = useSettingsStore();

  store.useMemberSync();

  /** Persist `next`, rolling back + toasting on the (rare) failure. */
  function commit(next: NudgeState, errTitle: string): void {
    const prev = state.value;
    try {
      state.value = next;
      store.save(next);
    } catch (err) {
      state.value = prev;
      showToast('error', errTitle, err instanceof Error ? err.message : String(err), {
        surface: 'community-nudge',
        error: err,
      });
    }
  }

  /**
   * Issue a nudge if due. Idempotent (the `nextDueAt`/`activeNudge` gates make a
   * repeat call within the interval a no-op). Wrapped so a fault can never break
   * the notifications daemon. Called by `useNotifications` on session-ready + day-roll.
   */
  function ensureNudgeIssued(): void {
    try {
      if (!store.memberId()) return;
      if (!settingsStore.onboardingCompleted) return;
      const { state: next, shown } = decideIssue(state.value, Date.now(), randomIntervalMs());
      if (next !== state.value) {
        state.value = next;
        store.save(next);
      }
      if (shown) window.plausible?.('community_nudge_shown');
    } catch (err) {
      reportError({
        surface: 'community-nudge-issuance',
        message: 'ensureNudgeIssued threw',
        error: err,
        severity: 'error',
      });
    }
  }

  /** "Join us on Discord" — open Discord and stop nudging (they're joining). */
  function join(): void {
    openDiscord('nudge');
    commit(
      { ...state.value, joined: true, activeNudge: null },
      "Couldn't update community settings"
    );
  }

  /** "Not now" — dismiss this one; it reappears after the next interval. */
  function snooze(): void {
    commit(
      { ...state.value, activeNudge: null, nextDueAt: Date.now() + randomIntervalMs() },
      "Couldn't update community settings"
    );
    window.plausible?.('community_nudge_dismissed', { props: { action: 'snooze' } });
  }

  /** "I'm already there!" — already joined; stop nudging for good (this device). */
  function markJoined(): void {
    commit(
      { ...state.value, joined: true, activeNudge: null },
      "Couldn't update community settings"
    );
    window.plausible?.('community_nudge_dismissed', { props: { action: 'already_there' } });
  }

  return {
    activeNudge: computed<ActiveNudge | null>(() => state.value.activeNudge),
    ensureNudgeIssued,
    join,
    snooze,
    markJoined,
  };
}
