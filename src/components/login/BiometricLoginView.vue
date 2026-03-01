<script setup lang="ts">
import { ref } from 'vue';
import BeanieSpinner from '@/components/ui/BeanieSpinner.vue';
import CloudProviderBadge from '@/components/ui/CloudProviderBadge.vue';
import { useAuthStore } from '@/stores/authStore';
import { useSyncStore } from '@/stores/syncStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useTranslation } from '@/composables/useTranslation';

const props = defineProps<{
  familyId: string;
  familyName?: string;
  showNotYouLink?: boolean;
}>();

const emit = defineEmits<{
  'signed-in': [destination: string];
  'use-password': [];
  back: [];
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
      if (result.error === 'CROSS_DEVICE_NO_CACHE') {
        errorMessage.value = t('passkey.crossDeviceNoCache');
      } else if (result.error === 'WRONG_FAMILY_CREDENTIAL') {
        errorMessage.value = t('passkey.wrongFamilyError');
      } else {
        errorMessage.value = result.error ?? t('passkey.signInError');
      }
      return;
    }

    // Decrypt with cached password
    let decryptSuccess = false;

    if (result.cachedPassword) {
      const pwResult = await syncStore.decryptPendingFile(result.cachedPassword);
      decryptSuccess = pwResult.success;
      if (!decryptSuccess) {
        console.warn('[BiometricLoginView] decryptPendingFile failed:', pwResult.error);
        // Distinguish: file never loaded vs wrong password
        if (pwResult.error?.includes('No pending')) {
          errorMessage.value = t('passkey.fileLoadError');
        } else {
          errorMessage.value = t('passkey.passwordChanged');
        }
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
      emit('signed-in', '/nook');
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
    <!-- Back button -->
    <button
      class="mb-4 flex w-full items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
      @click="emit('back')"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      {{ showNotYouLink ? t('fastLogin.notYou') : t('action.back') }}
    </button>

    <!-- Family name -->
    <div class="mb-6 text-center">
      <img
        src="/brand/beanies_logo_transparent_logo_only_192x192.png"
        alt=""
        class="mx-auto mb-3 h-16 w-16"
      />
      <h2 class="font-outfit text-xl font-bold text-gray-900 dark:text-gray-100">
        {{
          showNotYouLink && familyName
            ? t('fastLogin.welcomeBackName').replace('{name}', familyName)
            : familyName || t('passkey.welcomeBack')
        }}
      </h2>
      <!-- File/provider context -->
      <CloudProviderBadge
        v-if="syncStore.fileName"
        class="mt-1"
        :provider-type="syncStore.storageProviderType"
        :file-name="syncStore.fileName"
        :account-email="syncStore.providerAccountEmail"
        size="sm"
      />
    </div>

    <!-- Biometric button -->
    <div class="w-full space-y-4">
      <button
        :disabled="isAuthenticating"
        class="group bg-secondary-500 flex w-full items-center justify-center gap-3 rounded-2xl px-6 py-4 text-white shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl disabled:opacity-50 dark:bg-slate-700"
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
