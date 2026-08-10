<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import ErrorBanner from '@/components/common/ErrorBanner.vue';
import { useTranslation } from '@/composables/useTranslation';
import { usePickBeanpodFile } from '@/composables/usePickBeanpodFile';
import { showToast } from '@/composables/useToast';
import { useSyncStore } from '@/stores/syncStore';
import { hardReload } from '@/utils/hardReload';
import { reportError } from '@/utils/errorReporter';
import { FAMILY_DATA_DEEP_LINK } from '@/constants/deepLinks';
import { POD_ACCESS_ERRORS } from '@/utils/podAccess';

const props = defineProps<{
  show: boolean;
  fileNotFound?: boolean;
}>();

const { t } = useTranslation();
const router = useRouter();
const syncStore = useSyncStore();
const { isPicking, pick } = usePickBeanpodFile();
const reselectError = ref<string | null>(null);

const emit = defineEmits<{
  reconnected: [];
}>();

const fileNotFoundBody = computed(() => {
  const email = syncStore.providerAccountEmail || t('googleDrive.thisAccount');
  return t('googleDrive.fileNotFoundBody').replace('{email}', email);
});

async function handleReselectFile() {
  reselectError.value = null;
  const result = await pick();
  if (result.kind !== 'picked') return; // cancelled, redirected, or pick failed
  const recovery = await syncStore.rebindPodFile(result.fileId, result.fileName);
  if (recovery.ok) {
    emit('reconnected');
  } else {
    // `rebindPodFile` now returns a typed code instead of raw English prose —
    // the message comes from the shared registry so it is translated like
    // everything else the user reads.
    reselectError.value = t(POD_ACCESS_ERRORS[recovery.code].messageKey);
  }
}

function handleRefresh(): void {
  // Fire-and-forget. hardReload navigates away on success; its internal
  // try/catch falls through to location.replace even on SW-cleanup error.
  // The only reachable rejection here is the unreachable case where
  // location.replace itself throws. Double-clicks are safe — every
  // operation in hardReload is idempotent.
  hardReload().catch((e) => {
    console.error('[SaveFailureBanner] hardReload threw unexpectedly', e);
    showToast('error', t('error.refreshFailed'), t('error.refreshFailedHelp'));
    reportError({
      surface: 'save-failure-banner',
      message: 'hardReload threw',
      error: e,
    });
  });
}

function goToSettings() {
  // Land directly inside the Family Data modal so the user can see their
  // current Google account + reconnect/switch options without hunting.
  router.push(FAMILY_DATA_DEEP_LINK);
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
      {{ props.fileNotFound ? fileNotFoundBody : t('googleDrive.saveFailureBody') }}
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
          class="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50"
          @click="handleRefresh"
        >
          {{ t('googleDrive.saveFailureRefresh') }}
        </button>
      </template>
    </template>
  </ErrorBanner>
</template>
