<script setup lang="ts">
/**
 * Drive "Open with" landing page.
 *
 * Drive sends users here from the right-click "Open with beanies.family"
 * gesture (registered via the Google Workspace Marketplace SDK's Drive
 * integration). The URL looks like:
 *
 *     https://app.beanies.family/open?state={"ids":["FILE_ID"],"action":"open","userId":"..."}
 *
 * Drive auto-handles OAuth before redirecting, so by the time we land here
 * the user has already granted `drive.file` scope on the target file. We:
 *
 * 1. Parse the `state` JSON
 * 2. Call `syncStore.loadFromGoogleDrive(fileId, ...)` — same code path as
 *    the in-app Drive picker, just bypassing the picker UI
 * 3. Route to /login once the encrypted envelope is loaded — LoginPage
 *    detects `hasPendingEncryptedFile` and jumps straight into the
 *    password-decrypt UI (no file picker)
 *
 * On error, show a recovery UI rather than dumping the user on a blank page.
 */
import { ref, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useSyncStore } from '@/stores/syncStore';
import { features } from '@/config/features';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import { useTranslation } from '@/composables/useTranslation';
import { parseDriveOpenState } from '@/utils/driveOpenState';

const route = useRoute();
const router = useRouter();
const syncStore = useSyncStore();
const { t } = useTranslation();

type Status = 'loading' | 'error' | 'unsupported';
const status = ref<Status>('loading');
const errorMessage = ref<string>('');

onMounted(async () => {
  // Path-A self-host builds without Drive sync configured can't handle this
  // entry point — bail with a clear message before triggering any API calls.
  if (!features.drive) {
    status.value = 'unsupported';
    errorMessage.value = t('openFromDrive.driveNotConfigured');
    return;
  }

  const fileId = parseDriveOpenState(route.query.state);

  if (!fileId) {
    status.value = 'error';
    errorMessage.value = t('openFromDrive.invalidState');
    return;
  }

  try {
    // loadFromGoogleDrive handles the silent token grab + Drive download +
    // V4 envelope parse, and sets `pendingEncryptedFile` in the store.
    // The fallback name here is cosmetic; the provider records the real
    // Drive file name from metadata once the read completes.
    const result = await syncStore.loadFromGoogleDrive(fileId, '.beanpod');

    if (result.needsPassword || result.success) {
      // Hand off to LoginPage. Its onMounted detects `hasPendingEncryptedFile`
      // and jumps straight to LoadPodView's password-decrypt UI — no file
      // picker, no welcome gate.
      router.replace('/login');
      return;
    }

    status.value = 'error';
    errorMessage.value = syncStore.error ?? t('openFromDrive.loadFailed');
  } catch (e) {
    status.value = 'error';
    errorMessage.value = (e as Error).message || t('openFromDrive.loadFailed');
  }
});

function goToWelcome() {
  router.replace('/welcome');
}

function retry() {
  // Simplest retry: full reload re-runs onMounted with the same `state`.
  window.location.reload();
}
</script>

<template>
  <div
    class="bg-cloud-white dark:bg-secondary-900 flex min-h-screen items-center justify-center p-4"
  >
    <div class="max-w-md text-center">
      <!-- Loading: download + decrypt envelope -->
      <template v-if="status === 'loading'">
        <BeanieSpinner size="lg" class="mx-auto mb-4" />
        <h2 class="font-outfit text-secondary-500 text-lg font-semibold dark:text-gray-100">
          {{ t('openFromDrive.loading') }}
        </h2>
        <p class="text-secondary-500/60 mt-2 text-sm dark:text-gray-400">
          {{ t('openFromDrive.loadingHint') }}
        </p>
      </template>

      <!-- Error: download failed, file inaccessible, or invalid state -->
      <template v-else-if="status === 'error'">
        <div class="mb-3 text-4xl">😕</div>
        <h2 class="font-outfit text-secondary-500 text-lg font-semibold dark:text-gray-100">
          {{ t('openFromDrive.errorTitle') }}
        </h2>
        <p class="text-secondary-500/70 mt-2 text-sm dark:text-gray-300">{{ errorMessage }}</p>
        <div class="mt-6 flex justify-center gap-2">
          <BaseButton variant="secondary" @click="goToWelcome">
            {{ t('openFromDrive.goToSignIn') }}
          </BaseButton>
          <BaseButton @click="retry">
            {{ t('openFromDrive.tryAgain') }}
          </BaseButton>
        </div>
      </template>

      <!-- Unsupported: Drive sync not configured in this build -->
      <template v-else>
        <h2 class="font-outfit text-secondary-500 text-lg font-semibold dark:text-gray-100">
          {{ t('openFromDrive.unsupportedTitle') }}
        </h2>
        <p class="text-secondary-500/70 mt-2 text-sm dark:text-gray-300">{{ errorMessage }}</p>
        <BaseButton class="mt-6" @click="goToWelcome">
          {{ t('openFromDrive.goToSignIn') }}
        </BaseButton>
      </template>
    </div>
  </div>
</template>
