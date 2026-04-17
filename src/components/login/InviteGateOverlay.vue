<script setup lang="ts">
import { ref, onMounted } from 'vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import { useTranslation } from '@/composables/useTranslation';
import { validateInviteToken } from '@/utils/inviteToken';
import { isValidEmail } from '@/utils/email';
import { MARKETING_URL } from '@/utils/marketing';

const emit = defineEmits<{ unlocked: [] }>();
const { t } = useTranslation();

function goToMarketingHome() {
  window.location.href = `${MARKETING_URL}/`;
}

type Mode = 'token' | 'request' | 'confirmed';
const mode = ref<Mode>('token');

// Token mode
const token = ref('');
const tokenError = ref('');
const tokenLoading = ref(false);

// Request mode
const reqName = ref('');
const reqEmail = ref('');
const reqMessage = ref('');
const reqError = ref('');
const reqLoading = ref(false);

// E2E bypass (same pattern as TrustDeviceModal)
onMounted(() => {
  if (import.meta.env.DEV && sessionStorage.getItem('e2e_auto_auth') === 'true') {
    emit('unlocked');
  }
});

async function handleUnlock() {
  tokenError.value = '';
  if (!token.value.trim()) {
    tokenError.value = t('inviteGate.tokenRequired');
    return;
  }

  tokenLoading.value = true;
  try {
    const valid = await validateInviteToken(token.value);
    if (valid) {
      emit('unlocked');
    } else {
      tokenError.value = t('inviteGate.tokenInvalid');
    }
  } finally {
    tokenLoading.value = false;
  }
}

async function handleRequest() {
  reqError.value = '';

  if (!reqName.value.trim() || !reqEmail.value.trim()) {
    reqError.value = t('inviteGate.fieldsRequired');
    return;
  }
  if (!isValidEmail(reqEmail.value)) {
    reqError.value = t('inviteGate.emailInvalid');
    return;
  }

  const webhookUrl = import.meta.env.VITE_INVITE_WEBHOOK_URL;
  if (!webhookUrl) {
    reqError.value = t('inviteGate.requestError');
    return;
  }

  reqLoading.value = true;
  try {
    // Slack webhooks don't support CORS, so use no-cors mode.
    // The response is opaque (status 0), but the request goes through.
    await fetch(webhookUrl, {
      method: 'POST',
      mode: 'no-cors',
      body: JSON.stringify({
        text: `*New Invite Request*\n*Name:* ${reqName.value.trim()}\n*Email:* ${reqEmail.value.trim()}${reqMessage.value.trim() ? `\n*Message:* ${reqMessage.value.trim()}` : ''}`,
      }),
    });
    mode.value = 'confirmed';
  } catch {
    reqError.value = t('inviteGate.requestError');
  } finally {
    reqLoading.value = false;
  }
}
</script>

<template>
  <div
    class="absolute inset-0 z-10 flex items-center justify-center bg-white/80 backdrop-blur-sm dark:bg-slate-900/80"
  >
    <div class="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl dark:bg-slate-800">
      <!-- Token mode -->
      <template v-if="mode === 'token'">
        <img
          src="/brand/beanies_family_icon_transparent_384x384.png"
          alt="beanies family"
          class="mx-auto mb-3 h-28 w-28"
        />
        <h2 class="font-outfit mb-1 text-center text-xl font-bold text-gray-900 dark:text-gray-100">
          {{ t('inviteGate.title') }}
        </h2>
        <p class="mb-4 text-center text-sm text-gray-500 dark:text-gray-400">
          {{ t('inviteGate.description') }}
        </p>

        <BaseInput
          v-model="token"
          :label="t('inviteGate.tokenLabel')"
          :placeholder="t('inviteGate.tokenPlaceholder')"
          :error="tokenError"
          @keyup.enter="handleUnlock"
        />

        <BaseButton
          class="mt-4 w-full"
          :loading="tokenLoading"
          :disabled="!token.trim()"
          @click="handleUnlock"
        >
          {{ t('inviteGate.unlock') }}
        </BaseButton>

        <p class="mt-4 text-center text-sm text-gray-400 dark:text-gray-500">
          {{ t('inviteGate.noToken') }}
          <button
            class="text-primary-500 hover:text-primary-600 font-medium"
            @click="mode = 'request'"
          >
            {{ t('inviteGate.requestOne') }}
          </button>
        </p>
      </template>

      <!-- Request mode -->
      <template v-else-if="mode === 'request'">
        <h2 class="font-outfit mb-1 text-xl font-bold text-gray-900 dark:text-gray-100">
          {{ t('inviteGate.requestTitle') }}
        </h2>
        <p class="mb-4 text-sm text-gray-500 dark:text-gray-400">
          {{ t('inviteGate.requestDescription') }}
        </p>

        <div class="space-y-3">
          <BaseInput
            v-model="reqName"
            :label="t('inviteGate.nameLabel')"
            :placeholder="t('inviteGate.namePlaceholder')"
            required
          />
          <BaseInput
            v-model="reqEmail"
            type="email"
            :label="t('inviteGate.emailLabel')"
            :placeholder="t('inviteGate.emailPlaceholder')"
            required
          />
          <BaseInput
            v-model="reqMessage"
            :label="t('inviteGate.messageLabel')"
            :placeholder="t('inviteGate.messagePlaceholder')"
          />
        </div>

        <p v-if="reqError" class="mt-2 text-sm text-red-600 dark:text-red-400">
          {{ reqError }}
        </p>

        <BaseButton
          class="mt-4 w-full"
          :loading="reqLoading"
          :disabled="!reqName.trim() || !reqEmail.trim()"
          @click="handleRequest"
        >
          {{ t('inviteGate.sendRequest') }}
        </BaseButton>

        <p class="mt-3 text-center">
          <button
            class="text-sm text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
            @click="mode = 'token'"
          >
            {{ t('inviteGate.haveToken') }}
          </button>
        </p>
      </template>

      <!-- Confirmed mode -->
      <template v-else>
        <div class="py-4 text-center">
          <p class="mb-2 text-3xl">🫘</p>
          <h2 class="font-outfit mb-2 text-xl font-bold text-gray-900 dark:text-gray-100">
            {{ t('inviteGate.confirmedTitle') }}
          </h2>
          <p class="mb-6 text-sm text-gray-500 dark:text-gray-400">
            {{ t('inviteGate.confirmedDescription') }}
          </p>
          <BaseButton variant="secondary" class="w-full" @click="goToMarketingHome">
            {{ t('inviteGate.backToHome') }}
          </BaseButton>
        </div>
      </template>
    </div>
  </div>
</template>
