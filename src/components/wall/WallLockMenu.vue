<script setup lang="ts">
/**
 * An icon, not a labelled button — adults know a padlock, and the label was
 * costing prime wall real estate for a control kids must not use.
 *
 * The menu holds every privileged action, including LEAVING. But the two are
 * NOT the same challenge: unlocking edits takes any grown-up's PIN, while
 * leaving resumes the signed-in member's session and therefore takes theirs.
 * See `useWallLock` for the reasoning. A visible unguarded "leave" would let a
 * bored seven-year-old turn the wall back into the full app.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import ReauthChallenge from '@/components/auth/ReauthChallenge.vue';
import WallUnlockPad from '@/components/wall/WallUnlockPad.vue';
import { useTranslation } from '@/composables/useTranslation';
import type { FamilyMember } from '@/types/models';

const props = defineProps<{
  isLocked: boolean;
  /** Can anybody unlock edits here? */
  canUnlock: boolean;
  /** Can the signed-in member prove who they are, in order to leave? */
  canVerifyIdentity: boolean;
  challengeOpen: boolean;
  /** Every grown-up whose PIN unlocks edits. */
  unlockCandidates: FamilyMember[];
  /** The signed-in member — the only identity `leave` will resume. */
  member: FamilyMember | null;
}>();
const emit = defineEmits<{
  // The INTENT travels with both events. The host gates on a different predicate per
  // intent, and grants a different capability per intent — neither of which it can infer
  // from lock state (#80 review).
  requestUnlock: ['unlock' | 'leave'];
  relock: [];
  verified: [FamilyMember | null, 'unlock' | 'leave'];
  cancelled: [];
  nightNow: [];
  leave: [];
}>();

const { t } = useTranslation();
const open = ref(false);
/**
 * What the PIN is being asked FOR. Without it, unlocking in order to leave
 * simply unlocked and dropped you back on the wall with no explanation — the
 * leave intent was discarded the moment the challenge opened.
 */
const pendingAction = ref<'unlock' | 'leave'>('unlock');

/**
 * Who this particular challenge will accept. Unlocking edits accepts every
 * grown-up; leaving accepts only the member whose session it would resume.
 */
const candidates = computed<FamilyMember[]>(() =>
  pendingAction.value === 'leave' ? (props.member ? [props.member] : []) : props.unlockCandidates
);

/**
 * A PIN gets the pad straight away — no choice screen, no OS keyboard. Legacy
 * password-only members still get the full challenge, so shortcutting the
 * common path costs nobody their way in.
 */
const usePinPad = computed(() => candidates.value.some((m) => !!m.pinHash));
const root = ref<HTMLElement | null>(null);

function choose(action: 'unlock' | 'relock' | 'night' | 'leave') {
  open.value = false;
  if (action === 'unlock') {
    pendingAction.value = 'unlock';
    emit('requestUnlock', 'unlock');
  }
  // Locking again needs no challenge — giving up a capability never does, and
  // an adult who unlocked to add one item should not have to wait out the
  // two-minute timeout to hand the wall back to the children.
  if (action === 'relock') emit('relock');
  if (action === 'night') emit('nightNow');
  // Leaving is a privileged action: it drops the family into the full app.
  // While locked it must go through the PIN, not straight out — otherwise the
  // padlock is decorative and `wall.setup.needsPin.message` is a false promise.
  if (action === 'leave') {
    // A member who CANNOT satisfy the challenge (no PIN, no password) must
    // still be able to get out: the wall is a chrome-free route, so gating the
    // only exit behind an unsatisfiable prompt would strand them in it. Note
    // this is `canVerifyIdentity`, not `canUnlock` — another adult having a PIN
    // does not help you prove that you are you.
    //
    // Deliberately NOT conditioned on `isLocked`. Unlocking edits is a FAMILY
    // capability any grown-up's PIN opens; leaving is an IDENTITY one that
    // resumes the session member's privileges. Tying the challenge to the lock
    // meant that once either parent unlocked to add a job, anyone at the wall
    // — including the children it exists to gate — could tap Leave and land in
    // the full app as the signed-in member, with transfer-ownership,
    // remove-member and clear-all-data reachable. The 2-minute relock never
    // intervened either, because every tick the children are allowed to make
    // re-arms it (#80 review).
    if (props.canVerifyIdentity) {
      pendingAction.value = 'leave';
      emit('requestUnlock', 'leave');
    } else {
      emit('leave');
    }
  }
}

function onVerified(by?: FamilyMember) {
  const action = pendingAction.value;
  pendingAction.value = 'unlock';
  emit('verified', by ?? null, action);
  if (action === 'leave') emit('leave');
}

function onCancelled() {
  pendingAction.value = 'unlock';
  emit('cancelled');
}

/**
 * A dropdown on an unattended wall must not camp: a stray tap anywhere else,
 * or Escape, closes it. Without this a 256px panel sat over the last day
 * column until somebody thought to re-tap the padlock.
 */
function onDocumentPointer(event: PointerEvent) {
  if (!open.value) return;
  if (root.value && !root.value.contains(event.target as Node)) open.value = false;
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false;
}
onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointer);
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointer);
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div ref="root" class="relative shrink-0">
    <button
      type="button"
      class="wall-lock-btn grid place-items-center rounded-[18px] bg-white shadow-[var(--card-shadow)] dark:bg-slate-800"
      :aria-label="isLocked ? t('wall.lock.locked') : t('wall.lock.unlocked')"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span aria-hidden="true">{{ isLocked ? '🔒' : '🔓' }}</span>
    </button>

    <div
      v-if="open"
      class="absolute top-16 right-0 z-50 w-64 rounded-[20px] bg-white p-2 text-left shadow-[var(--card-hover-shadow)] dark:bg-slate-800"
    >
      <p
        class="font-outfit wall-lock-heading px-3 pt-2 pb-1 font-bold tracking-[0.1em] text-[var(--muted-text,#4d5d6c)] uppercase"
      >
        {{ isLocked ? t('wall.lock.locked') : t('wall.lock.unlocked') }}
      </p>
      <button
        v-if="isLocked && canUnlock"
        type="button"
        class="font-inter text-secondary-500 flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left hover:bg-[var(--tint-slate-5)] dark:text-gray-100"
        @click="choose('unlock')"
      >
        <span aria-hidden="true">🔓</span>{{ t('wall.lock.unlock') }}
      </button>
      <button
        v-if="!isLocked"
        type="button"
        class="font-inter text-secondary-500 flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left hover:bg-[var(--tint-slate-5)] dark:text-gray-100"
        @click="choose('relock')"
      >
        <span aria-hidden="true">🔒</span>{{ t('wall.lock.relock') }}
      </button>
      <button
        type="button"
        class="font-inter text-secondary-500 flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left hover:bg-[var(--tint-slate-5)] dark:text-gray-100"
        @click="choose('night')"
      >
        <span aria-hidden="true">🌙</span>{{ t('wall.lock.nightNow') }}
      </button>
      <button
        type="button"
        class="font-inter text-secondary-500 flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left hover:bg-[var(--tint-slate-5)] dark:text-gray-100"
        @click="choose('leave')"
      >
        <span aria-hidden="true">↩️</span>{{ t('wall.lock.leave') }}
      </button>
    </div>

    <BaseModal :open="challengeOpen" size="sm" @close="onCancelled">
      <WallUnlockPad
        v-if="usePinPad"
        :candidates="candidates"
        :open="challengeOpen"
        :hint="pendingAction === 'leave' ? t('wall.unlock.leaveHint') : undefined"
        @verified="onVerified"
        @cancelled="onCancelled"
      />
      <ReauthChallenge
        v-else-if="member"
        :member="member"
        :open="challengeOpen"
        @verified="onVerified"
        @cancelled="onCancelled"
      />
    </BaseModal>
  </div>
</template>
