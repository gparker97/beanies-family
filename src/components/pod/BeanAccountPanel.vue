<script setup lang="ts">
/**
 * Bean Detail → Account Access panel.
 *
 * Admin-only recovery surface for resetting another member's sign-in
 * password. Only renders when the viewing admin actually has the
 * permission for *this* specific member; otherwise nothing is shown
 * (no inert panel — discoverability without clutter).
 *
 * Gate mirrors `authStore.resetMemberPassword`'s authz layer exactly so
 * the UI never offers an action the backend will reject. The backend
 * keeps its closed-union `ResetError` checks regardless.
 *
 * Replaces the old 🔒 icon on `BeanCard` that was too cramped and used
 * a semantically wrong icon ("lock" reads as "lock/unlock state", not
 * "reset credentials"). Now lives where users come to *manage* a bean.
 */
import { ref, computed } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import ResetMemberPinModal from '@/components/family/ResetMemberPinModal.vue';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { usePermissions } from '@/composables/usePermissions';
import { useTranslation } from '@/composables/useTranslation';
import { confirm } from '@/composables/useConfirm';
import { showToast } from '@/composables/useToast';
import { isTemporaryEmail } from '@/utils/email';
import type { FamilyMember } from '@/types/models';

const { t } = useTranslation();
const authStore = useAuthStore();
const familyStore = useFamilyStore();
const { canManagePod } = usePermissions();

const props = defineProps<{
  member: FamilyMember;
}>();

const showResetModal = ref(false);

/**
 * Authz gate — mirrors `authStore.resetMemberPassword`. Returns false on
 * the first failed condition so the panel disappears entirely when not
 * applicable, instead of rendering a disabled affordance.
 */
const canReset = computed<boolean>(() => {
  if (!canManagePod.value) return false;
  if (props.member.isPet) return false;
  if (props.member.role === 'owner') return false;
  // Phase 4 (review R2-F12): `requiresPassword` now means "no credential at all",
  // which includes deliberately PIN-less tap-through kids added at setup — exactly
  // who the parent-initiated PIN reset exists for. Exclude only a genuinely INVITED
  // pending member (real email, hasn't claimed via join yet): setting their PIN here
  // would silently "claim" them and hide them from the join flow. Members added in
  // the wizard carry a synthetic `…@setup.local` placeholder (or no email).
  if (
    props.member.requiresPassword &&
    props.member.email &&
    !isTemporaryEmail(props.member.email)
  ) {
    return false; // pending invitee — use the invite flow
  }
  const myId = authStore.currentUser?.memberId;
  if (!myId || props.member.id === myId) return false; // Settings → self-serve PIN change
  return true;
});

/**
 * Can this member's claim be cleared so they can be invited again?
 *
 * ⚠️ Near the COMPLEMENT of `canReset` above, and deliberately so. That one excludes a pending
 * invitee because setting their PIN would silently claim them. This one applies only to someone
 * who IS claimed — `requiresPassword === false` — because a claim is the only thing there is to
 * clear.
 *
 * Why it needs to exist: "joined" is derived (`!passwordHash && !pinHash`), so the moment a
 * `pinHash` lands the invite UI stops offering that person a link. A join that fell over after
 * the PIN write, or someone who lost their link half way through, was previously un-invitable
 * for good — the only remedies were setting their PIN and reading it out, or deleting the bean
 * and losing its id and history.
 */
const canUnclaim = computed<boolean>(() => {
  if (!canManagePod.value) return false;
  if (props.member.isPet) return false;
  if (props.member.role === 'owner') return false;
  // Nothing to clear — they have never claimed.
  if (props.member.requiresPassword) return false;
  const myId = authStore.currentUser?.memberId;
  if (!myId || props.member.id === myId) return false;
  return true;
});

const unclaiming = ref(false);

async function handleUnclaim(): Promise<void> {
  // ⚠️ `variant: 'info'`, NOT `'danger'`. `'danger'` paints a red slab with a TRASH icon and
  // labels the confirm button "Delete", which is the CIG's reserved language for destroying
  // something. Here nothing is destroyed: the bean, its photos and its history all stay. Red is
  // for delete and leave only. An explicit `confirmLabel` because the default on a cancellable
  // confirm is "Delete" regardless of variant.
  const ok = await confirm({
    title: 'bean.unclaim.confirm.title',
    message: 'bean.unclaim.confirm.message',
    variant: 'info',
    confirmLabel: 'bean.unclaim.confirm.action',
  });
  if (!ok) return;

  unclaiming.value = true;
  try {
    const result = await authStore.unclaimMember(props.member.id);
    if (result.success) {
      showToast('success', fmt('bean.unclaim.done', { name: props.member.name }));
    } else {
      // The store returns a typed `ResetError`; never a raw string in front of a family.
      showToast('error', t('bean.unclaim.failed'));
    }
  } catch (e) {
    // Never silent: the family tapped a button and must be told it did not work.
    console.error('[BeanAccountPanel] unclaim failed', e);
    showToast('error', t('bean.unclaim.failed'));
  } finally {
    unclaiming.value = false;
  }
}

function fmt(key: string, replacements: Record<string, string>): string {
  let out = t(key as never);
  for (const [k, v] of Object.entries(replacements)) {
    out = out.replace(`{${k}}`, v);
  }
  return out;
}

// Look up the live member reference so the modal always sees the freshest
// name/role (e.g. if it changes elsewhere during the session). The
// component prop is a snapshot, but `familyStore.members` is reactive.
const liveMember = computed<FamilyMember | null>(
  () => familyStore.members.find((m) => m.id === props.member.id) ?? props.member
);
</script>

<template>
  <section
    v-if="canReset || canUnclaim"
    class="dark:bg-surface-raised rounded-[var(--sq)] bg-white p-6 shadow-[var(--card-shadow)]"
    aria-labelledby="bean-account-title"
  >
    <div class="flex items-start gap-4">
      <!-- Squircle key-icon container in Heritage Orange tint — same
           shape language as the rest of the Pod surfaces. -->
      <div
        class="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[14px]"
        style="background: var(--tint-orange-8)"
        aria-hidden="true"
      >
        <BeanieIcon name="lock" size="md" class="text-primary-500 dark:text-accent-lift" />
      </div>
      <div class="min-w-0 flex-1">
        <h2
          id="bean-account-title"
          class="font-outfit text-secondary-500 dark:text-ink text-lg font-bold"
        >
          {{ t('bean.account.title') }}
        </h2>
        <p class="font-inter text-secondary-500/70 dark:text-ink-soft mt-1 text-sm">
          {{ fmt('bean.account.description', { name: props.member.name }) }}
        </p>
        <div v-if="canReset" class="mt-4">
          <BaseButton variant="primary" size="md" @click="showResetModal = true">
            {{ fmt('bean.account.resetButton', { name: props.member.name }) }}
          </BaseButton>
        </div>

        <!-- Clearing a claim so the person can be invited again. Only ever shown for someone
             who IS claimed, which is why it does not overlap the reset button above. -->
        <div v-if="canUnclaim" class="mt-4">
          <p class="font-inter text-secondary-500/70 dark:text-ink-soft mb-3 text-sm">
            {{ fmt('bean.unclaim.description', { name: props.member.name }) }}
          </p>
          <BaseButton variant="secondary" size="md" :disabled="unclaiming" @click="handleUnclaim">
            {{ fmt('bean.unclaim.button', { name: props.member.name }) }}
          </BaseButton>
        </div>
      </div>
    </div>

    <ResetMemberPinModal
      :open="showResetModal"
      :member="liveMember"
      @close="showResetModal = false"
    />
  </section>
</template>
