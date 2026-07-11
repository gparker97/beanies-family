<script setup lang="ts">
/**
 * Google Drive reconnect toast. Thin binding of `useGoogleReconnect` to the
 * shared, presentational `ReconnectToast` — behaviour unchanged from the
 * pre-shared version (same strings, same reconnect ladder, same `reconnected`
 * emit); only the styling moved to the CIG Heritage-Orange shared component.
 */
import { useTranslation } from '@/composables/useTranslation';
import { useGoogleReconnect } from '@/composables/useGoogleReconnect';
import ReconnectToast from '@/components/common/ReconnectToast.vue';

const { t } = useTranslation();
const { isReconnecting, reconnectError, reconnect } = useGoogleReconnect();

const emit = defineEmits<{
  reconnected: [];
}>();

async function handleReconnect() {
  const success = await reconnect();
  if (success) emit('reconnected');
}
</script>

<template>
  <ReconnectToast
    :title="t('googleDrive.sessionExpired')"
    :subtitle="reconnectError ? t('googleDrive.reconnectFailed') : undefined"
    subtitle-is-error
    :busy="isReconnecting"
    :reconnect-label="t('googleDrive.reconnect')"
    @reconnect="handleReconnect"
  />
</template>
