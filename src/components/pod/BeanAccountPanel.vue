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
import ResetMemberPasswordModal from '@/components/family/ResetMemberPasswordModal.vue';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyStore } from '@/stores/familyStore';
import { usePermissions } from '@/composables/usePermissions';
import { useTranslation } from '@/composables/useTranslation';
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
  if (props.member.requiresPassword) return false; // not joined yet — use the invite flow
  const myId = authStore.currentUser?.memberId;
  if (!myId || props.member.id === myId) return false; // Settings → Change Password for self
  return true;
});

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
    v-if="canReset"
    class="rounded-[var(--sq)] bg-white p-6 shadow-[var(--card-shadow)] dark:bg-slate-800"
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
        <BeanieIcon name="lock" size="md" class="text-primary-500" />
      </div>
      <div class="min-w-0 flex-1">
        <h2
          id="bean-account-title"
          class="font-outfit text-secondary-500 text-lg font-bold dark:text-gray-100"
        >
          {{ t('bean.account.title') }}
        </h2>
        <p class="font-inter text-secondary-500/70 mt-1 text-sm dark:text-gray-300">
          {{ fmt('bean.account.description', { name: props.member.name }) }}
        </p>
        <div class="mt-4">
          <BaseButton variant="primary" size="md" @click="showResetModal = true">
            {{ fmt('bean.account.resetButton', { name: props.member.name }) }}
          </BaseButton>
        </div>
      </div>
    </div>

    <ResetMemberPasswordModal
      :open="showResetModal"
      :member="liveMember"
      @close="showResetModal = false"
    />
  </section>
</template>
