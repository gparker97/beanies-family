<script setup lang="ts">
/**
 * The single host for the step-up gate (#80).
 *
 * Mounted ONCE in App.vue beside `<ConfirmModal />`, exactly as `useConfirm` does it, so
 * the four call sites are one line each instead of four hand-rolled modal hosts.
 *
 * `layer="overlay"` is load-bearing, not a default. It must sit above the `base` modals
 * it can be invoked from (ResetMemberPinModal), while `ReauthChallenge`'s own
 * PasswordModal sub-flow is ALSO `overlay` — and because BaseModal teleports to body,
 * equal z resolves by open order, so the password sub-flow (opened later) paints on top.
 * `layer="top"` would bury it, breaking step-up for legacy password-only members.
 */
import BaseModal from '@/components/ui/BaseModal.vue';
import ReauthChallenge from '@/components/auth/ReauthChallenge.vue';
import { useReauth } from '@/composables/useReauth';
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();
const { state, handleVerified, handleCancelled } = useReauth();
</script>

<template>
  <BaseModal
    v-if="state.member"
    :open="state.open"
    :title="t((state.titleKey ?? 'transferOwnership.reauthTitle') as never)"
    size="sm"
    layer="overlay"
    @close="handleCancelled"
  >
    <!-- The caller's reason, when it gave one. Keeps an explanatory modal from needing to
         exist in front of this one just to say why the PIN is being asked for. -->
    <p v-if="state.reasonKey" class="dark:text-ink-soft mb-4 text-sm text-gray-600">
      {{ t(state.reasonKey as never) }}
    </p>
    <ReauthChallenge
      :member="state.member"
      :open="state.open"
      @verified="handleVerified"
      @cancelled="handleCancelled($event)"
    />
  </BaseModal>
</template>
