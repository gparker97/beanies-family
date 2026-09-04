<script setup lang="ts">
/**
 * The ONE user-facing whole-grant revoke (login rethink Phase 5): Settings →
 * "Disconnect Google Everywhere". For the my-tokens-were-stolen emergency — no sign-out
 * tier revokes any more, because revoke is whole-grant per (user, client) and kills
 * every device on the account. The copy says exactly that; a danger-variant confirm
 * gates it; afterwards this device signs out fully (its connection is dead anyway).
 */
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import { useAuthStore } from '@/stores/authStore';
import { useTranslation } from '@/composables/useTranslation';
import { confirm as showConfirm } from '@/composables/useConfirm';
import { disconnectGoogleEverywhere } from '@/services/google/googleAuth';
import { emitExplicitRevokeUsed } from '@/services/telemetry/loginFlowEvents';
import { showToast } from '@/composables/useToast';
import { reportError } from '@/utils/errorReporter';

const { t } = useTranslation();
const router = useRouter();
const authStore = useAuthStore();
const isDisconnecting = ref(false);

async function handleDisconnect() {
  const confirmed = await showConfirm({
    title: 'googleDisconnect.confirmTitle',
    message: 'googleDisconnect.confirmMessage',
    variant: 'danger',
  });
  if (!confirmed) return;

  isDisconnecting.value = true;
  try {
    emitExplicitRevokeUsed();
    await disconnectGoogleEverywhere();
    // This device's connection is gone — complete the sign-out so the user lands on a
    // truthful surface instead of an app that can no longer reach its file.
    await authStore.signOut();
    router.replace('/login');
  } catch (e) {
    reportError({
      surface: 'login-flow',
      message: 'explicit Google disconnect failed',
      error: e,
      severity: 'warning',
      context: { action: 'explicit_revoke_failed' },
    });
    showToast('error', t('googleDrive.reconnectFailed'));
  } finally {
    isDisconnecting.value = false;
  }
}
</script>

<template>
  <BaseCard :title="t('googleDisconnect.title')">
    <p class="dark:text-ink-soft mb-4 text-sm text-gray-600">
      {{ t('googleDisconnect.description') }}
    </p>
    <BaseButton variant="danger" :disabled="isDisconnecting" @click="handleDisconnect">
      {{ t('googleDisconnect.action') }}
    </BaseButton>
  </BaseCard>
</template>
