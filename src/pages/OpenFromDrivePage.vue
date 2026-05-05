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
 * Drive auto-handles OAuth before redirecting (per the SDK's auto-OAuth
 * checkbox), so users coming through the genuine "Open with" gesture have
 * already granted `drive.file` scope on the target file by the time we land
 * here. We:
 *
 * 1. Parse the `state` JSON
 * 2. Call `syncStore.loadFromGoogleDrive(fileId, ...)` — same code path as
 *    the in-app Drive picker, just bypassing the picker UI
 * 3. Route to /login once the encrypted envelope is loaded — LoginPage
 *    detects `hasPendingEncryptedFile` and jumps straight into the
 *    password-decrypt UI (no file picker)
 *
 * ── Popup-blocker handling ──
 * `loadFromGoogleDrive` calls `requestAccessToken()`, which under the hood
 * uses Google's identity-services library. If we don't have a cached token
 * (fresh Incognito, direct entry to /open without going through Drive's
 * auto-OAuth), the library opens a popup to get one — and browsers block
 * popups fired automatically on page load (no user gesture).
 *
 * In practice the genuine Drive flow won't hit this because Drive's
 * auto-OAuth pre-warms the grant before redirect. But for direct-entry
 * scenarios (bookmarks, copy-pasted URLs, dev testing), we detect the
 * popup-blocked failure and switch into a "popup-blocked" state with a
 * Continue button. Clicking the button satisfies the popup-blocker's
 * gesture requirement, and the retry succeeds.
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

type Status = 'loading' | 'error' | 'popup-blocked' | 'unsupported';
const status = ref<Status>('loading');
const errorMessage = ref<string>('');
const fileId = ref<string | null>(null);

/**
 * Heuristic — the gtag identity-services library wraps popup-block
 * failures with a few different messages depending on the browser, so we
 * match on the substring 'popup' to catch all variants.
 */
function isPopupBlockedError(msg: string): boolean {
  return msg.toLowerCase().includes('popup');
}

async function tryLoad(): Promise<void> {
  if (!fileId.value) return;
  status.value = 'loading';
  errorMessage.value = '';

  try {
    const result = await syncStore.loadFromGoogleDrive(fileId.value, '.beanpod');
    if (result.needsPassword || result.success) {
      router.replace('/login');
      return;
    }
    handleFailure(syncStore.error ?? t('openFromDrive.loadFailed'));
  } catch (e) {
    handleFailure((e as Error).message || t('openFromDrive.loadFailed'));
  }
}

function handleFailure(msg: string): void {
  errorMessage.value = msg;
  status.value = isPopupBlockedError(msg) ? 'popup-blocked' : 'error';
}

onMounted(async () => {
  // Path-A self-host builds without Drive sync configured can't handle this
  // entry point — bail with a clear message before triggering any API calls.
  if (!features.drive) {
    status.value = 'unsupported';
    errorMessage.value = t('openFromDrive.driveNotConfigured');
    return;
  }

  const id = parseDriveOpenState(route.query.state);
  if (!id) {
    status.value = 'error';
    errorMessage.value = t('openFromDrive.invalidState');
    return;
  }
  fileId.value = id;

  await tryLoad();
});

function goToWelcome(): void {
  router.replace('/welcome');
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

      <!-- Popup blocked: requires a user-gesture click to proceed -->
      <template v-else-if="status === 'popup-blocked'">
        <div class="mb-3 text-4xl">🪟</div>
        <h2 class="font-outfit text-secondary-500 text-lg font-semibold dark:text-gray-100">
          {{ t('openFromDrive.popupBlockedTitle') }}
        </h2>
        <p class="text-secondary-500/70 mt-2 text-sm dark:text-gray-300">
          {{ t('openFromDrive.popupBlockedHint') }}
        </p>
        <div class="mt-6 flex justify-center gap-2">
          <BaseButton variant="secondary" @click="goToWelcome">
            {{ t('openFromDrive.goToSignIn') }}
          </BaseButton>
          <BaseButton @click="tryLoad">
            {{ t('openFromDrive.continue') }}
          </BaseButton>
        </div>
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
          <BaseButton @click="tryLoad">
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
