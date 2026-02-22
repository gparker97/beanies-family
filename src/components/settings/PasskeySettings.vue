<script setup lang="ts">
import { ref, onMounted } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import {
  isWebAuthnSupported,
  isPlatformAuthenticatorAvailable,
  listRegisteredPasskeys,
  removePasskey,
  type PasskeyInfo,
} from '@/services/auth/passkeyService';
import { confirm as showConfirm } from '@/composables/useConfirm';

const supported = ref(false);
const platformAvailable = ref(false);
const passkeys = ref<PasskeyInfo[]>([]);
const statusMessage = ref<string | null>(null);

onMounted(async () => {
  supported.value = isWebAuthnSupported();
  if (supported.value) {
    platformAvailable.value = await isPlatformAuthenticatorAvailable();
  }
  passkeys.value = listRegisteredPasskeys();
});

function handleRegister() {
  statusMessage.value =
    'Passkey registration requires server-side infrastructure (AWS Cognito WebAuthn challenge). This will be available once the backend is deployed.';
}

async function handleRemove(credentialId: string) {
  if (
    await showConfirm({ title: 'confirm.removePasskeyTitle', message: 'passkey.removeConfirm' })
  ) {
    removePasskey(credentialId);
    passkeys.value = listRegisteredPasskeys();
  }
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString();
}
</script>

<template>
  <BaseCard title="Passkeys">
    <div v-if="!supported" class="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
      Your browser does not support passkeys (WebAuthn).
    </div>

    <div v-else class="space-y-4">
      <p class="text-sm text-gray-500 dark:text-gray-400">
        Passkeys let you sign in using your fingerprint, face, or device PIN instead of a password.
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
        <img
          v-else
          src="/brand/beanies_impact_bullet_transparent_192x192.png"
          alt=""
          class="h-4 w-4 flex-shrink-0"
        />
        {{
          platformAvailable
            ? 'Biometric authenticator available'
            : 'No platform authenticator detected'
        }}
      </div>

      <!-- Registered passkeys -->
      <div v-if="passkeys.length > 0" class="space-y-2">
        <h4 class="text-sm font-medium text-gray-900 dark:text-gray-100">Registered Passkeys</h4>
        <div
          v-for="passkey in passkeys"
          :key="passkey.credentialId"
          class="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 dark:border-slate-700"
        >
          <div>
            <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
              {{ passkey.label }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              Added {{ formatDate(passkey.createdAt) }}
            </p>
          </div>
          <button
            class="text-sm text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
            @click="handleRemove(passkey.credentialId)"
          >
            Remove
          </button>
        </div>
      </div>

      <!-- Register button -->
      <BaseButton variant="secondary" :disabled="!platformAvailable" @click="handleRegister">
        Register New Passkey
      </BaseButton>

      <!-- Status message -->
      <div
        v-if="statusMessage"
        class="rounded-lg bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
      >
        {{ statusMessage }}
      </div>
    </div>
  </BaseCard>
</template>
