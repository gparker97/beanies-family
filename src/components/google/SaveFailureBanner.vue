<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import ErrorBanner from '@/components/common/ErrorBanner.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useGoogleReconnect } from '@/composables/useGoogleReconnect';
import { usePickBeanpodFile } from '@/composables/usePickBeanpodFile';
import { showToast } from '@/composables/useToast';
import { reEncryptEnvelope, downloadAsFile } from '@/services/sync/fileSync';
import { getFamilyKey, getEnvelope } from '@/services/sync/syncService';
import { useSyncStore } from '@/stores/syncStore';

const props = defineProps<{
  show: boolean;
  fileNotFound?: boolean;
}>();

const { t } = useTranslation();
const router = useRouter();
const syncStore = useSyncStore();
const { isReconnecting, reconnect } = useGoogleReconnect();
const { isPicking, pick } = usePickBeanpodFile();
const isDownloading = ref(false);
const reselectError = ref<string | null>(null);

const emit = defineEmits<{
  reconnected: [];
}>();

async function handleReconnect() {
  const success = await reconnect();
  if (success) emit('reconnected');
}

async function handleReselectFile() {
  reselectError.value = null;
  const picked = await pick();
  if (!picked) return; // user cancelled, redirected, or pick failed (error in composable)
  const result = await syncStore.recoverFromMissingFile(picked.fileId, picked.fileName);
  if (result.success) {
    emit('reconnected');
  } else {
    reselectError.value = result.error ?? t('googleDrive.fileNotFoundReselectFailed');
  }
}

async function handleDownloadBackup() {
  isDownloading.value = true;
  try {
    const fk = getFamilyKey();
    const env = getEnvelope();
    if (!fk || !env) {
      showToast(
        'error',
        t('googleDrive.downloadBackupUnavailableTitle'),
        t('googleDrive.downloadBackupUnavailableBody')
      );
      console.warn('[SaveFailureBanner] backup unavailable — missing key or envelope', {
        hasKey: !!fk,
        hasEnvelope: !!env,
      });
      return;
    }
    const envelopeJson = await reEncryptEnvelope(env, fk);
    downloadAsFile(envelopeJson, 'beanies-backup');
  } catch (e) {
    showToast(
      'error',
      t('googleDrive.downloadBackupFailedTitle'),
      t('googleDrive.downloadBackupFailedBody')
    );
    console.error('[SaveFailureBanner] backup download failed', e);
  } finally {
    isDownloading.value = false;
  }
}

function goToSettings() {
  router.push('/settings');
}
</script>

<template>
  <ErrorBanner :show="props.show" severity="critical">
    <template #title>
      {{
        props.fileNotFound ? t('googleDrive.fileNotFoundTitle') : t('googleDrive.saveFailureTitle')
      }}
    </template>
    <template #message>
      {{
        props.fileNotFound ? t('googleDrive.fileNotFoundBody') : t('googleDrive.saveFailureBody')
      }}
    </template>
    <template #actions>
      <template v-if="props.fileNotFound">
        <button
          :disabled="isPicking"
          class="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
          @click="handleReselectFile"
        >
          {{ isPicking ? '...' : t('googleDrive.fileNotFoundReselect') }}
        </button>
        <button
          class="rounded-lg bg-white/20 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/30"
          @click="goToSettings"
        >
          {{ t('googleDrive.goToSettings') }}
        </button>
        <p v-if="reselectError" class="basis-full text-xs text-white/80">
          {{ reselectError }}
        </p>
      </template>
      <template v-else>
        <button
          :disabled="isDownloading"
          class="rounded-lg bg-white/20 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/30 disabled:opacity-50"
          @click="handleDownloadBackup"
        >
          {{ isDownloading ? '...' : t('googleDrive.downloadBackup') }}
        </button>
        <button
          :disabled="isReconnecting"
          class="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
          @click="handleReconnect"
        >
          {{ isReconnecting ? '...' : t('googleDrive.saveFailureReconnect') }}
        </button>
      </template>
    </template>
  </ErrorBanner>
</template>
