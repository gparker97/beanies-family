<script setup lang="ts">
/**
 * Resume-setup recovery screen.
 *
 * Reached at `/welcome?resume=setup` when an authenticated session exists but
 * no `.beanpod` file was ever written — a half-finished create-pod wizard
 * (e.g. a failed Drive connect) or an iOS Drive OAuth full-page redirect
 * mid-flight. The router guard + App.vue route here instead of letting an
 * empty `/nook` render.
 *
 * Two phases:
 *  1. **identity** — re-enter the owner's name + password (the full-page
 *     redirect, if that's how we got here, destroyed the in-memory Automerge
 *     doc + the password; the family itself still exists in IndexedDB). We
 *     rebuild the owner member via `authStore.rehydrateOwnerDoc`.
 *  2. **storage** — if we already hold a fresh Google token (we just came
 *     back from a Drive redirect), finish on Drive automatically; otherwise
 *     offer Google Drive / a local file. Either way: connect → write the pod
 *     file (`syncStore.createNewFile`, which also fires the "🎉 pod created"
 *     ping + flips `authStore.podCreated`) → `/nook`.
 *
 * Storage connect logic is shared with the create-pod wizard via
 * `@/services/sync/connectStorage`.
 */
import { ref, computed, onMounted } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import LocalFileSyncWarning from '@/components/login/LocalFileSyncWarning.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useAuthStore } from '@/stores/authStore';
import { useSyncStore } from '@/stores/syncStore';
import { useFamilyContextStore } from '@/stores/familyContextStore';
import { connectDriveStorage, connectLocalStorage } from '@/services/sync/connectStorage';
import { isTokenValid, isUserCancellation } from '@/services/google/googleAuth';
import { reportError } from '@/utils/errorReporter';

const { t } = useTranslation();
const authStore = useAuthStore();
const syncStore = useSyncStore();
const familyContextStore = useFamilyContextStore();

const emit = defineEmits<{
  'signed-in': [destination: string];
  /** "Start over instead" — sign out + return to the welcome gate. */
  'start-over': [];
}>();

type Phase = 'identity' | 'storage' | 'finishing';
const phase = ref<Phase>('identity');

const ownerName = ref('');
const password = ref('');
const confirmPassword = ref('');
const formError = ref<string | null>(null);
const busy = ref(false);
const showLocalFileWarning = ref(false);
// Set once we've kicked off navigation to /nook — keeps the `finally` blocks
// from flashing the storage picker back on during the route transition.
const navigatedAway = ref(false);

const familyName = computed(() => familyContextStore.activeFamilyName || 'your family');

onMounted(async () => {
  // The family itself still exists in IndexedDB even if the in-memory context
  // wasn't initialized (App.vue short-circuits before that for !podCreated).
  if (!familyContextStore.activeFamilyId && authStore.currentUser?.familyId) {
    try {
      await familyContextStore.switchFamily(authStore.currentUser.familyId);
    } catch (e) {
      // Degraded, not fatal — we fall back to a generic family name and the
      // user can still finish setup — but surface it; this shouldn't happen
      // (signUp registered the family in IndexedDB).
      console.warn('[ResumePodSetup] could not load family context for resume', e);
      reportError({
        surface: 'resumeSetup.loadFamilyContext',
        message: `Could not load family context during resume: ${e instanceof Error ? e.message : String(e)}`,
        error: e,
        severity: 'warning',
      });
    }
  }
  // Reasonable default for the name field — the email's local part. The user
  // can change it; the real owner name was lost with the in-memory doc.
  const email = authStore.currentUser?.email ?? '';
  ownerName.value = email.includes('@') ? email.slice(0, email.indexOf('@')) : '';
});

function validateIdentity(): boolean {
  formError.value = null;
  if (!ownerName.value || !password.value || !confirmPassword.value) {
    formError.value = t('auth.fillAllFields');
    return false;
  }
  if (password.value.length < 8) {
    formError.value = t('auth.passwordMinLength');
    return false;
  }
  if (password.value !== confirmPassword.value) {
    formError.value = t('auth.passwordsDoNotMatch');
    return false;
  }
  return true;
}

async function handleIdentityNext() {
  if (busy.value) return;
  if (!validateIdentity()) return;
  busy.value = true;
  try {
    const r = await authStore.rehydrateOwnerDoc(ownerName.value, password.value);
    if (!r.success) {
      formError.value = t('setup.fileCreateFailed');
      console.error('[ResumePodSetup] rehydrateOwnerDoc failed:', r.error);
      reportError({
        surface: 'resumeSetup.rehydrateOwner',
        message: r.error || 'Failed to rebuild owner member during resume',
        severity: 'error',
      });
      return;
    }
    // If we already hold a fresh Google token (just returned from a Drive
    // redirect), finish on Drive without bothering the user with a chooser.
    if (isTokenValid()) {
      phase.value = 'finishing';
      await finishOnDrive();
    } else {
      phase.value = 'storage';
    }
  } catch (e) {
    console.error('[ResumePodSetup] unexpected error resuming setup', e);
    reportError({
      surface: 'resumeSetup.rehydrateOwner',
      message: `Unexpected error resuming setup: ${e instanceof Error ? e.message : String(e)}`,
      error: e,
      severity: 'error',
    });
    formError.value = t('setup.fileCreateFailed');
    phase.value = 'storage';
  } finally {
    busy.value = false;
    if (!navigatedAway.value && phase.value === 'finishing') phase.value = 'storage';
  }
}

/** Step 2: write the pod file with the now-connected provider, then route to /nook. */
async function finalizePod(): Promise<boolean> {
  const user = authStore.currentUser;
  if (!user) {
    formError.value = t('setup.fileCreateFailed');
    reportError({
      surface: 'resumeSetup.finalize',
      message: 'finalizePod reached with no authenticated session',
      severity: 'error',
    });
    return false;
  }
  const podFileName = `${familyContextStore.activeFamilyName || 'my-family'}.beanpod`;
  const ok = await syncStore.createNewFile(
    podFileName,
    password.value,
    user.memberId,
    familyContextStore.activeFamilyId ?? user.familyId ?? '',
    familyContextStore.activeFamilyName ?? 'My Family'
  );
  if (!ok) {
    const msg = syncStore.error ?? t('setup.fileCreateFailed');
    formError.value = msg;
    console.error('[ResumePodSetup] createNewFile failed:', msg);
    reportError({
      surface: 'resumeSetup.finalize',
      message: `createNewFile failed during resume: ${msg}`,
      severity: 'error',
      context: { provider_type: syncStore.storageProviderType ?? null },
    });
    return false;
  }
  // setupAutoSync + ensureRegistered happen in LoginPage.handleSignedIn.
  navigatedAway.value = true;
  emit('signed-in', '/nook');
  return true;
}

async function finishOnDrive() {
  formError.value = null;
  const r = await connectDriveStorage(familyName.value, {
    googleEmail: authStore.currentUser?.email,
    activeFamilyId: familyContextStore.activeFamilyId,
  });
  if (r.status === 'redirecting') return; // page navigating to Google — nothing more to do
  if (r.status === 'failed') {
    const cancelled = r.cancelled || isUserCancellation(r.error);
    if (cancelled) console.warn('[ResumePodSetup] Drive connect cancelled:', r.error);
    else console.error('[ResumePodSetup] Drive connect failed:', r.error);
    reportError({
      surface: 'resumeSetup.connectDrive',
      message: r.error || 'Google Drive connect failed during resume',
      severity: cancelled ? 'warning' : 'error',
      context: { provider_type: 'google_drive' },
    });
    formError.value = r.error || t('googleDrive.authFailed');
    phase.value = 'storage';
    return;
  }
  await finalizePod();
}

async function handleConnectDrive() {
  if (busy.value) return;
  busy.value = true;
  phase.value = 'finishing';
  try {
    await finishOnDrive();
  } catch (e) {
    console.error('[ResumePodSetup] unexpected error connecting Drive', e);
    reportError({
      surface: 'resumeSetup.connectDrive',
      message: `Unexpected error connecting Drive during resume: ${e instanceof Error ? e.message : String(e)}`,
      error: e,
      severity: 'error',
    });
    formError.value = t('googleDrive.authFailed');
    phase.value = 'storage';
  } finally {
    busy.value = false;
    // Didn't navigate to /nook and didn't already drop back to the picker —
    // let the user retry.
    if (!navigatedAway.value && phase.value === 'finishing') phase.value = 'storage';
  }
}

function handleLocalFileClick() {
  showLocalFileWarning.value = true;
}

async function handleConnectLocal() {
  showLocalFileWarning.value = false;
  if (busy.value) return;
  busy.value = true;
  phase.value = 'finishing';
  try {
    const r = await connectLocalStorage();
    if (r.status === 'failed') {
      if (!r.cancelled) {
        console.error('[ResumePodSetup] local file selection failed:', r.error);
        reportError({
          surface: 'resumeSetup.selectLocalFile',
          message: r.error || 'Local file selection failed during resume',
          severity: 'error',
          context: { provider_type: 'local' },
        });
        formError.value = t('setup.fileCreateFailed');
      }
      phase.value = 'storage';
      return;
    }
    await finalizePod();
  } catch (e) {
    console.error('[ResumePodSetup] unexpected error with local file', e);
    reportError({
      surface: 'resumeSetup.selectLocalFile',
      message: `Unexpected error selecting a local file during resume: ${e instanceof Error ? e.message : String(e)}`,
      error: e,
      severity: 'error',
    });
    formError.value = t('setup.fileCreateFailed');
    phase.value = 'storage';
  } finally {
    busy.value = false;
    if (!navigatedAway.value && phase.value === 'finishing') phase.value = 'storage';
  }
}
</script>

<template>
  <div
    class="mx-auto max-w-[480px] rounded-3xl bg-gradient-to-b from-white to-[#fffaf3] p-8 shadow-xl dark:bg-slate-800 dark:from-slate-800 dark:to-slate-800"
  >
    <div class="mb-2 text-center">
      <img
        src="/brand/beanies_impact_bullet_transparent_192x192.png"
        alt=""
        class="mx-auto h-[80px] w-[80px]"
      />
    </div>

    <h2 class="font-outfit mb-1 text-center text-xl font-bold text-gray-900 dark:text-gray-100">
      {{ t('resumeSetup.title') }}
    </h2>
    <p class="mb-6 text-center text-sm text-gray-500 dark:text-gray-400">
      {{ t('resumeSetup.subtitle') }}
    </p>

    <div
      v-if="formError"
      class="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
    >
      {{ formError }}
    </div>

    <!-- Phase 1: re-enter identity -->
    <form v-if="phase === 'identity'" class="space-y-4" @submit.prevent="handleIdentityNext">
      <div
        class="rounded-xl bg-gray-50 p-3 text-sm text-gray-600 dark:bg-slate-700/50 dark:text-gray-300"
      >
        🫘 {{ familyName }}
      </div>
      <BaseInput
        v-model="ownerName"
        :label="t('setup.yourName')"
        :placeholder="t('family.enterName')"
        required
        @input="formError = null"
      />
      <BaseInput
        v-model="password"
        :label="t('loginV6.signInPasswordLabel')"
        type="password"
        :placeholder="t('auth.passwordPlaceholder')"
        required
        @input="formError = null"
      />
      <BaseInput
        v-model="confirmPassword"
        :label="t('auth.confirmPassword')"
        type="password"
        :placeholder="t('auth.confirmPasswordPlaceholder')"
        required
        @input="formError = null"
      />
      <BaseButton type="submit" class="w-full" :disabled="busy" :loading="busy">
        {{ t('action.continue') }}
      </BaseButton>
    </form>

    <!-- Phase 2: pick storage -->
    <div v-else-if="phase === 'storage'" class="space-y-3">
      <p class="font-outfit text-center text-sm font-semibold text-gray-700 dark:text-gray-300">
        {{ t('resumeSetup.storagePrompt') }}
      </p>
      <BaseButton
        v-if="syncStore.isGoogleDriveAvailable"
        class="w-full"
        :disabled="busy"
        @click="handleConnectDrive"
      >
        {{ t('storage.connectGoogleDrive') }}
      </BaseButton>
      <BaseButton variant="outline" class="w-full" :disabled="busy" @click="handleLocalFileClick">
        {{
          syncStore.isGoogleDriveAvailable ? t('storage.useLocalInstead') : t('storage.localFile')
        }}
      </BaseButton>
    </div>

    <!-- Phase 3: finishing -->
    <div v-else class="py-6 text-center">
      <BeanieSpinner size="md" class="mx-auto mb-3" />
      <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('resumeSetup.finishing') }}</p>
    </div>

    <!-- Start over -->
    <div class="mt-6 text-center">
      <button
        type="button"
        class="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        :disabled="busy"
        @click="emit('start-over')"
      >
        {{ t('resumeSetup.startOver') }}
      </button>
    </div>

    <LocalFileSyncWarning
      :open="showLocalFileWarning"
      :google-drive-available="syncStore.isGoogleDriveAvailable"
      @close="showLocalFileWarning = false"
      @proceed="handleConnectLocal"
      @use-google-drive="handleConnectDrive"
    />
  </div>
</template>
