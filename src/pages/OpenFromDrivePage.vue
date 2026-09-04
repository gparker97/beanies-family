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
 *
 * ── UI hierarchy ──
 * Each non-loading state has ONE clear primary action (full-width gradient
 * button, the universal beanies CTA pattern) and a small text-link escape
 * hatch underneath. The previous side-by-side equal-weight buttons were
 * misleading — both looked equally important, but only the right-hand one
 * was the path the user actually wanted.
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
    <div
      class="dark:bg-surface-raised w-full max-w-[420px] rounded-3xl bg-white p-8 shadow-[0_4px_20px_rgba(44,62,80,0.05)]"
    >
      <!-- Beanie icon (consistent with LoadPodView's password-decrypt screen) -->
      <img
        src="/brand/beanies_family_icon_transparent_384x384.png"
        alt=""
        class="mx-auto mb-4 h-20 w-20"
      />

      <!-- Loading: download + decrypt envelope -->
      <template v-if="status === 'loading'">
        <div class="text-center">
          <BeanieSpinner size="md" class="mx-auto mb-3" />
          <h2 class="font-outfit text-secondary-500 dark:text-ink text-lg font-semibold">
            {{ t('openFromDrive.loading') }}
          </h2>
          <p class="text-secondary-500/60 dark:text-ink-soft mt-2 text-sm">
            {{ t('openFromDrive.loadingHint') }}
          </p>
        </div>
      </template>

      <!-- Popup blocked: requires a user-gesture click to proceed -->
      <template v-else-if="status === 'popup-blocked'">
        <div class="text-center">
          <h2 class="font-outfit text-secondary-500 dark:text-ink text-lg font-semibold">
            {{ t('openFromDrive.popupBlockedTitle') }}
          </h2>
          <p class="text-secondary-500/70 dark:text-ink-soft mt-2 text-sm leading-relaxed">
            {{ t('openFromDrive.popupBlockedHint') }}
          </p>
        </div>
        <BaseButton
          class="from-primary-500 to-terracotta-400 mt-6 w-full bg-gradient-to-r"
          @click="tryLoad"
        >
          {{ t('openFromDrive.continueWithGoogle') }}
        </BaseButton>
        <button
          type="button"
          class="text-secondary-500/55 hover:text-primary-500 font-outfit dark:text-ink-soft mt-4 block w-full text-center text-xs font-semibold transition-colors"
          @click="goToWelcome"
        >
          {{ t('openFromDrive.useDifferentFile') }}
        </button>
      </template>

      <!-- Error: download failed, file inaccessible, or invalid state -->
      <template v-else-if="status === 'error'">
        <div class="text-center">
          <h2 class="font-outfit text-secondary-500 dark:text-ink text-lg font-semibold">
            {{ t('openFromDrive.errorTitle') }}
          </h2>
          <p class="text-secondary-500/70 dark:text-ink-soft mt-2 text-sm leading-relaxed">
            {{ errorMessage }}
          </p>
        </div>
        <BaseButton
          class="from-primary-500 to-terracotta-400 mt-6 w-full bg-gradient-to-r"
          @click="tryLoad"
        >
          {{ t('openFromDrive.tryAgain') }}
        </BaseButton>
        <button
          type="button"
          class="text-secondary-500/55 hover:text-primary-500 font-outfit dark:text-ink-soft mt-4 block w-full text-center text-xs font-semibold transition-colors"
          @click="goToWelcome"
        >
          {{ t('openFromDrive.useDifferentFile') }}
        </button>
      </template>

      <!-- Unsupported: Drive sync not configured in this build -->
      <template v-else>
        <div class="text-center">
          <h2 class="font-outfit text-secondary-500 dark:text-ink text-lg font-semibold">
            {{ t('openFromDrive.unsupportedTitle') }}
          </h2>
          <p class="text-secondary-500/70 dark:text-ink-soft mt-2 text-sm leading-relaxed">
            {{ errorMessage }}
          </p>
        </div>
        <BaseButton
          class="from-primary-500 to-terracotta-400 mt-6 w-full bg-gradient-to-r"
          @click="goToWelcome"
        >
          {{ t('openFromDrive.signIn') }}
        </BaseButton>
      </template>
    </div>
  </div>
</template>
