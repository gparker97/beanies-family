/**
 * The wall is locked by default: anyone can tick a job, nobody can create,
 * edit, delete — or leave.
 *
 * TWO CAPABILITIES, GATED DIFFERENTLY. The padlock used to gate both behind the
 * session member's PIN, which is wrong in both directions: the other parent
 * could not unlock the family calendar they co-own, and if we had simply let
 * any adult's PIN through, their PIN would also have opened the full app AS the
 * logged-in member.
 *
 *  1. UNLOCK EDITS — a FAMILY capability. Any adult's PIN. Nothing behind it is
 *     member-specific: it is the household's shared calendar and lists, which
 *     every claimed member can already decrypt (one family key, no per-member
 *     confidentiality boundary). Ticks are credited to the job's OWNER, not to
 *     whoever unlocked, so attribution does not blur either.
 *
 *  2. LEAVE THE WALL — an IDENTITY capability. It resumes the signed-in
 *     member's session, with their privileges (transfer ownership, delete pod,
 *     change their own credentials) and their name on every subsequent write.
 *     That still requires the SESSION member's own credential.
 *
 * So another adult can run the wall without being able to act as you. The
 * distinction is attribution and privilege, not secrecy.
 *
 * Entry is gated separately (see `WallSetupCard`).
 */
import { computed, onScopeDispose, ref } from 'vue';
import { useFamilyStore } from '@/stores/familyStore';
import { logEvent } from '@/services/telemetry/logEvent';
import type { FamilyMember } from '@/types/models';

const SURFACE = 'beanie-wall';
/** Long enough to finish a task, short enough that a walk-away re-locks. */
export const RELOCK_AFTER_MS = 120_000;

export function useWallLock() {
  const familyStore = useFamilyStore();

  const isLocked = ref(true);
  const challengeOpen = ref(false);
  /** Whose session this is. The only identity `leave` will resume. */
  const member = computed(() => familyStore.currentMember ?? null);

  /**
   * Every grown-up with a PIN. `ageGroup` is required on `FamilyMember`, so
   * this is a reliable gate — and it is the right one: a child being unable to
   * unlock edits is the entire point of the padlock.
   */
  const unlockCandidates = computed<FamilyMember[]>(() =>
    familyStore.members.filter((m) => !m.isPet && m.ageGroup === 'adult' && !!m.pinHash)
  );

  /** Can ANYBODY unlock edits here? */
  const canUnlock = computed(
    () => unlockCandidates.value.length > 0 || !!member.value?.passwordHash
  );

  /** Can the signed-in member prove who they are, in order to leave? */
  const canVerifyIdentity = computed(() => !!(member.value?.pinHash || member.value?.passwordHash));

  /** Who actually unlocked — recorded so an unexpected edit can be traced. */
  const unlockedBy = ref<FamilyMember | null>(null);

  let relockTimer: ReturnType<typeof setTimeout> | undefined;

  function clearTimer() {
    if (relockTimer) clearTimeout(relockTimer);
    relockTimer = undefined;
  }

  function lock(reason: 'timeout' | 'manual') {
    clearTimer();
    if (isLocked.value) return;
    isLocked.value = true;
    unlockedBy.value = null;
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'wall_relocked',
      context: { action: 'relocked', kind: reason },
    });
  }

  /** Any interaction while unlocked pushes the relock further out. */
  function noteActivity() {
    if (isLocked.value) return;
    clearTimer();
    relockTimer = setTimeout(() => lock('timeout'), RELOCK_AFTER_MS);
  }

  function requestUnlock() {
    if (!canUnlock.value) return;
    challengeOpen.value = true;
  }

  function onVerified(by?: FamilyMember | null) {
    challengeOpen.value = false;
    isLocked.value = false;
    unlockedBy.value = by ?? member.value;
    noteActivity();
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'wall_unlock_result',
      context: {
        action: 'unlock',
        kind: unlockedBy.value?.id === member.value?.id ? 'ok_self' : 'ok_other_adult',
        member_id_tail: unlockedBy.value?.id.slice(-8),
      },
    });
  }

  function onCancelled() {
    challengeOpen.value = false;
    logEvent({
      level: 'info',
      surface: SURFACE,
      message: 'wall_unlock_result',
      context: { action: 'unlock', kind: 'cancelled' },
    });
  }

  onScopeDispose(clearTimer);

  return {
    isLocked,
    canUnlock,
    canVerifyIdentity,
    unlockCandidates,
    unlockedBy,
    challengeOpen,
    member,
    requestUnlock,
    onVerified,
    onCancelled,
    noteActivity,
    lock,
  };
}
