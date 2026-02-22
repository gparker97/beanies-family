<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();
const route = useRoute();

const emit = defineEmits<{
  back: [];
  'signed-in': [destination: string];
}>();

const familyCode = ref('');
const formError = ref<string | null>(null);
const roleParam = ref<'parent' | 'child'>('parent');

onMounted(() => {
  // Pre-fill family code from query param
  const code = route.query.code;
  if (typeof code === 'string' && code) {
    familyCode.value = code;
  }
  const role = route.query.role;
  if (role === 'child') {
    roleParam.value = 'child';
  }
});

async function handleSubmit() {
  formError.value = null;

  if (!familyCode.value) {
    formError.value = t('auth.fillAllFields');
    return;
  }

  // For now, joining a pod means navigating to setup with the family code
  // The full magic link flow (DynamoDB registry + file reference) is a future issue
  emit('signed-in', `/setup?code=${familyCode.value.trim()}&role=${roleParam.value}`);
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
        {{ t('login.joinPod') }}
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
        <div>
          <BaseInput
            v-model="familyCode"
            :label="t('login.familyCode')"
            :placeholder="t('login.familyCodePlaceholder')"
            required
          />
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {{ t('login.familyCodeHelp') }}
          </p>
        </div>
        <!-- Role indicator (read-only, determined by invite link) -->
        <div class="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 dark:bg-slate-800">
          <span class="text-sm text-gray-500 dark:text-gray-400">{{ t('login.joiningAs') }}:</span>
          <span class="text-sm font-medium text-gray-900 dark:text-gray-100">
            {{ roleParam === 'child' ? t('login.inviteAsChild') : t('login.inviteAsParent') }}
          </span>
        </div>
      </div>

      <BaseButton type="submit" class="mt-6 w-full">
        {{ t('login.joinPod') }}
      </BaseButton>
    </form>
  </div>
</template>
