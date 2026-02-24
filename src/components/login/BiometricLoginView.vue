<script setup lang="ts">
import { ref } from 'vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import { useAuthStore } from '@/stores/authStore';
import { useSyncStore } from '@/stores/syncStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';

const props = defineProps<{
  familyId: string;
  familyName?: string;
}>();

const emit = defineEmits<{
  'signed-in': [destination: string];
  'use-password': [];
}>();

const { t } = useTranslation();
const authStore = useAuthStore();
const syncStore = useSyncStore();
const familyStore = useFamilyStore();

const isAuthenticating = ref(false);
const errorMessage = ref<string | null>(null);

async function handleBiometricLogin() {
  isAuthenticating.value = true;
  errorMessage.value = null;

  try {
    const result = await authStore.signInWithPasskey(props.familyId);

    if (!result.success) {
      errorMessage.value = result.error ?? t('passkey.signInError');
      return;
    }

    // Try decryption: DEK first (PRF path), then cached password as fallback.
    // The DEK can become stale if the file was re-encrypted with a new PBKDF2 salt
    // (e.g. by auto-sync or sign-out flush). Cached password always works.
    let decryptSuccess = false;

    if (result.dek) {
      const dekResult = await syncStore.decryptPendingFileWithDEK(result.dek);
      if (dekResult.success) {
        decryptSuccess = true;
      } else if (result.cachedPassword) {
        // DEK stale — fall back to cached password
        console.warn('[BiometricLogin] DEK decrypt failed, trying cached password');
        // Need to reload the pending file since decryptPendingFileWithDEK may have cleared it
        if (!syncStore.hasPendingEncryptedFile) {
          await syncStore.loadFromFile();
        }
        const pwResult = await syncStore.decryptPendingFile(result.cachedPassword);
        decryptSuccess = pwResult.success;
        if (!decryptSuccess) {
          errorMessage.value = t('passkey.dekAndPasswordFailed');
        }
      } else {
        errorMessage.value = t('passkey.dekStale');
      }
    } else if (result.cachedPassword) {
      // Non-PRF path: decrypt with cached password
      const pwResult = await syncStore.decryptPendingFile(result.cachedPassword);
      decryptSuccess = pwResult.success;
      if (!decryptSuccess) {
        errorMessage.value = t('passkey.passwordChanged');
      }
    } else {
      errorMessage.value = t('passkey.signInError');
      return;
    }

    if (decryptSuccess) {
      // Update session with full member data now that file is decrypted
      authStore.updateSessionWithMemberData();

      // Set current member
      const member = familyStore.members.find((m) => m.id === authStore.currentUser?.memberId);
      if (member) {
        familyStore.setCurrentMember(member.id);
      }

      syncStore.setupAutoSync();
      await syncStore.syncNow(true);
      emit('signed-in', '/dashboard');
    }
  } catch (err) {
    errorMessage.value = err instanceof Error ? err.message : t('passkey.signInError');
  } finally {
    isAuthenticating.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col items-center">
    <!-- Family name -->
    <div class="mb-6 text-center">
      <img
        src="/brand/beanies_logo_transparent_logo_only_192x192.png"
        alt=""
        class="mx-auto mb-3 h-16 w-16"
      />
      <h2 class="font-outfit text-lg font-bold text-gray-900 dark:text-gray-100">
        {{ familyName || t('passkey.welcomeBack') }}
      </h2>
    </div>

    <!-- Biometric button -->
    <div class="w-full space-y-4">
      <button
        :disabled="isAuthenticating"
        class="group flex w-full items-center justify-center gap-3 rounded-2xl bg-[#2C3E50] px-6 py-4 text-white shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl disabled:opacity-50 dark:bg-slate-700"
        @click="handleBiometricLogin"
      >
        <template v-if="isAuthenticating">
          <BeanieSpinner size="sm" />
          <span class="font-outfit font-semibold">{{ t('passkey.authenticating') }}</span>
        </template>
        <template v-else>
          <!-- Fingerprint icon -->
          <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4"
            />
          </svg>
          <span class="font-outfit font-semibold">{{ t('passkey.signInButton') }}</span>
        </template>
      </button>

      <!-- Error message -->
      <div
        v-if="errorMessage"
        class="rounded-xl bg-red-50 p-3 text-center text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400"
      >
        {{ errorMessage }}
        <button
          class="mt-2 block w-full text-center text-xs font-medium text-red-700 underline dark:text-red-300"
          @click="handleBiometricLogin"
        >
          {{ t('action.tryAgain') }}
        </button>
      </div>

      <!-- Password fallback -->
      <button
        class="w-full text-center text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
        @click="emit('use-password')"
      >
        {{ t('passkey.usePassword') }}
      </button>
    </div>
  </div>
</template>
