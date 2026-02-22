<script setup lang="ts">
import { ref } from 'vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useAuthStore } from '@/stores/authStore';

const { t } = useTranslation();
const authStore = useAuthStore();

const emit = defineEmits<{
  back: [];
  'signed-in': [destination: string];
}>();

const familyName = ref('');
const name = ref('');
const email = ref('');
const password = ref('');
const confirmPassword = ref('');
const formError = ref<string | null>(null);

async function handleSubmit() {
  formError.value = null;

  if (!familyName.value || !name.value || !email.value || !password.value) {
    formError.value = t('auth.fillAllFields');
    return;
  }

  if (password.value !== confirmPassword.value) {
    formError.value = t('auth.passwordsDoNotMatch');
    return;
  }

  if (password.value.length < 8) {
    formError.value = t('auth.passwordMinLength');
    return;
  }

  const result = await authStore.signUp({
    email: email.value,
    password: password.value,
    familyName: familyName.value,
    memberName: name.value,
  });

  if (result.success) {
    emit('signed-in', '/setup');
  } else {
    formError.value = result.error ?? t('auth.signUpFailed');
  }
}
</script>

<template>
  <div>
    <div class="mb-4 flex items-center gap-2">
      <button
        class="rounded-lg p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-slate-700 dark:hover:text-gray-300"
        @click="$emit('back')"
      >
        <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M15 19l-7-7 7-7"
          />
        </svg>
      </button>
      <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {{ t('login.createPod') }}
      </h2>
    </div>

    <div
      v-if="formError"
      class="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
    >
      {{ formError }}
    </div>

    <form @submit.prevent="handleSubmit">
      <div class="space-y-4">
        <BaseInput
          v-model="familyName"
          :label="t('auth.familyName')"
          :placeholder="t('auth.familyNamePlaceholder')"
          required
        />
        <BaseInput
          v-model="name"
          :label="t('setup.yourName')"
          :placeholder="t('auth.yourNamePlaceholder')"
          required
        />
        <BaseInput
          v-model="email"
          label="Email"
          type="email"
          placeholder="you@example.com"
          required
        />
        <BaseInput
          v-model="password"
          :label="t('auth.password')"
          type="password"
          :placeholder="t('auth.passwordPlaceholder')"
          required
        />
        <BaseInput
          v-model="confirmPassword"
          :label="t('auth.confirmPassword')"
          type="password"
          :placeholder="t('auth.confirmPasswordPlaceholder')"
          required
        />
      </div>

      <BaseButton type="submit" class="mt-6 w-full" :disabled="authStore.isLoading">
        {{ authStore.isLoading ? t('auth.creatingAccount') : t('login.createPod') }}
      </BaseButton>
    </form>
  </div>
</template>
