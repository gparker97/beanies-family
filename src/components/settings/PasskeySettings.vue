<script setup lang="ts">
import { ref, onMounted } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import {
  isWebAuthnSupported,
  isPlatformAuthenticatorAvailable,
  listRegisteredPasskeys,
  removePasskey,
} from '@/services/auth/passkeyService';
import { getSessionFileHandle } from '@/services/sync/syncService';
import { useAuthStore } from '@/stores/authStore';
import { useSyncStore } from '@/stores/syncStore';
import { confirm as showConfirm } from '@/composables/useConfirm';
import { useTranslation } from '@/composables/useTranslation';
import type { PasskeyRegistration } from '@/types/models';

const { t } = useTranslation();
const authStore = useAuthStore();
const syncStore = useSyncStore();

const supported = ref(false);
const platformAvailable = ref(false);
const passkeys = ref<PasskeyRegistration[]>([]);
const statusMessage = ref<{ text: string; type: 'success' | 'error' } | null>(null);
const isRegistering = ref(false);
const showPasswordInput = ref(false);
const registrationPassword = ref('');

onMounted(async () => {
  supported.value = isWebAuthnSupported();
  if (supported.value) {
    platformAvailable.value = await isPlatformAuthenticatorAvailable();
  }
  await loadPasskeys();
});

async function loadPasskeys() {
  if (authStore.currentUser?.memberId) {
    passkeys.value = await listRegisteredPasskeys(authStore.currentUser.memberId);
  }
}

function handleStartRegister() {
  if (!syncStore.isEncryptionEnabled) {
    statusMessage.value = { text: t('passkey.needsEncryption'), type: 'error' };
    return;
  }
  showPasswordInput.value = true;
  registrationPassword.value = '';
  statusMessage.value = null;
}

async function handleRegister() {
  if (!registrationPassword.value) return;

  isRegistering.value = true;
  statusMessage.value = null;

  try {
    // Get the encrypted file blob
    const encryptedBlob = await getEncryptedFileBlob();
    if (!encryptedBlob) {
      statusMessage.value = { text: t('passkey.registerError'), type: 'error' };
      return;
    }

    const result = await authStore.registerPasskeyForCurrentUser(
      registrationPassword.value,
      encryptedBlob
    );

    if (result.success) {
      statusMessage.value = { text: t('passkey.registerSuccess'), type: 'success' };
      showPasswordInput.value = false;
      registrationPassword.value = '';
      await loadPasskeys();
    } else {
      statusMessage.value = { text: result.error ?? t('passkey.registerError'), type: 'error' };
    }
  } catch {
    statusMessage.value = { text: t('passkey.registerError'), type: 'error' };
  } finally {
    isRegistering.value = false;
  }
}

async function handleRemove(credentialId: string) {
  if (
    await showConfirm({ title: 'confirm.removePasskeyTitle', message: 'passkey.removeConfirm' })
  ) {
    await removePasskey(credentialId);
    await loadPasskeys();
  }
}

async function getEncryptedFileBlob(): Promise<string | null> {
  try {
    // First try to get from session password — use it to read the file
    const handle = getSessionFileHandle();
    if (!handle) return null;
    const file = await handle.getFile();
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (parsed.encrypted && typeof parsed.data === 'string') {
      return parsed.data;
    }
    return null;
  } catch {
    return null;
  }
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString();
}
</script>

<template>
  <BaseCard :title="t('passkey.settingsTitle')">
    <div v-if="!supported" class="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
      {{ t('passkey.unsupported') }}
    </div>

    <div v-else class="space-y-4">
      <p class="text-sm text-gray-500 dark:text-gray-400">
        {{ t('passkey.settingsDescription') }}
      </p>

      <!-- Platform authenticator status -->
      <div
        class="flex items-center gap-2 text-sm"
        :class="
          platformAvailable
            ? 'text-green-600 dark:text-green-400'
            : 'text-amber-600 dark:text-amber-400'
        "
      >
        <svg
          v-if="platformAvailable"
          class="h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M5 13l4 4L19 7"
          />
        </svg>
        <svg v-else class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
          />
        </svg>
        {{ platformAvailable ? t('passkey.settingsDescription') : t('passkey.noAuthenticator') }}
      </div>

      <!-- Registered passkeys -->
      <div v-if="passkeys.length > 0" class="space-y-2">
        <h4 class="text-sm font-medium text-gray-900 dark:text-gray-100">
          {{ t('passkey.registeredPasskeys') }}
        </h4>
        <div
          v-for="passkey in passkeys"
          :key="passkey.credentialId"
          class="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 dark:border-slate-700"
        >
          <div>
            <div class="flex items-center gap-2">
              <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
                {{ passkey.label }}
              </p>
              <span
                class="rounded-full px-2 py-0.5 text-xs"
                :class="
                  passkey.prfSupported && passkey.wrappedDEK
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                "
              >
                {{
                  passkey.prfSupported && passkey.wrappedDEK
                    ? t('passkey.prfFull')
                    : t('passkey.prfCached')
                }}
              </span>
            </div>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {{ formatDate(passkey.createdAt) }}
              <template v-if="passkey.lastUsedAt">
                &middot; {{ t('passkey.lastUsed') }} {{ formatDate(passkey.lastUsedAt) }}
              </template>
              <template v-else> &middot; {{ t('passkey.neverUsed') }} </template>
            </p>
          </div>
          <button
            class="text-sm text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
            @click="handleRemove(passkey.credentialId)"
          >
            {{ t('action.delete') }}
          </button>
        </div>
      </div>

      <div v-else class="py-2 text-sm text-gray-400 dark:text-gray-500">
        {{ t('passkey.noPasskeys') }}
      </div>

      <!-- Registration form -->
      <div v-if="showPasswordInput" class="space-y-3">
        <p class="text-sm text-gray-600 dark:text-gray-400">
          {{ t('passkey.enterEncryptionPassword') }}
        </p>
        <form class="flex gap-2" @submit.prevent="handleRegister">
          <BaseInput
            v-model="registrationPassword"
            type="password"
            :placeholder="t('passkey.enterEncryptionPassword')"
            class="flex-1"
          />
          <BaseButton
            type="submit"
            variant="primary"
            :disabled="!registrationPassword || isRegistering"
          >
            {{ isRegistering ? t('passkey.authenticating') : t('action.confirm') }}
          </BaseButton>
          <BaseButton variant="ghost" @click="showPasswordInput = false">
            {{ t('action.cancel') }}
          </BaseButton>
        </form>
      </div>

      <!-- Register button -->
      <BaseButton
        v-else
        variant="secondary"
        :disabled="!platformAvailable"
        @click="handleStartRegister"
      >
        {{ t('passkey.registerButton') }}
      </BaseButton>

      <!-- Status message -->
      <div
        v-if="statusMessage"
        class="rounded-lg p-3 text-sm"
        :class="
          statusMessage.type === 'success'
            ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
            : 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400'
        "
      >
        {{ statusMessage.text }}
      </div>
    </div>
  </BaseCard>
</template>
