<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();
const route = useRoute();

type LoginView = 'create';

const emit = defineEmits<{
  back: [];
  'signed-in': [destination: string];
  navigate: [view: LoginView];
}>();

const familyCode = ref('');
const formError = ref<string | null>(null);

onMounted(() => {
  const code = route.query.code;
  if (typeof code === 'string' && code) {
    familyCode.value = code;
  }
});

async function handleSubmit() {
  formError.value = null;

  if (!familyCode.value) {
    formError.value = t('auth.fillAllFields');
    return;
  }

  // Join pod requires a server-side registry to validate family codes.
  // This feature is not yet implemented — show an informative error.
  formError.value = t('loginV6.joinNotAvailable');
}
</script>

<template>
  <div class="mx-auto max-w-[440px] rounded-3xl bg-white p-8 shadow-xl dark:bg-slate-800">
    <!-- Back button -->
    <button
      class="mb-4 flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
      @click="$emit('back')"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      {{ t('action.back') }}
    </button>

    <!-- Header -->
    <div class="mb-6 text-center">
      <h2 class="font-outfit text-xl font-bold text-gray-900 dark:text-gray-100">
        {{ t('loginV6.joinTitle') }}
      </h2>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {{ t('loginV6.joinSubtitle') }}
      </p>
    </div>

    <!-- Error -->
    <div
      v-if="formError"
      class="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
    >
      {{ formError }}
    </div>

    <form @submit.prevent="handleSubmit">
      <!-- Family code input -->
      <BaseInput
        v-model="familyCode"
        :label="t('loginV6.joinInput')"
        :placeholder="t('login.familyCodePlaceholder')"
        required
      />

      <!-- What happens next card -->
      <div class="mt-6 rounded-2xl bg-[#2C3E50] p-5 dark:bg-slate-700">
        <p class="mb-3 text-sm font-semibold text-white">
          {{ t('loginV6.whatsNext') }}
        </p>
        <div class="space-y-2.5">
          <div class="flex items-start gap-3">
            <div
              class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white"
            >
              1
            </div>
            <p class="text-sm text-white/80">{{ t('loginV6.joinStep1') }}</p>
          </div>
          <div class="flex items-start gap-3">
            <div
              class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white"
            >
              2
            </div>
            <p class="text-sm text-white/80">{{ t('loginV6.joinStep2') }}</p>
          </div>
          <div class="flex items-start gap-3">
            <div
              class="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white"
            >
              3
            </div>
            <p class="text-sm text-white/80">{{ t('loginV6.joinStep3') }}</p>
          </div>
        </div>
      </div>

      <!-- Submit button -->
      <BaseButton type="submit" class="mt-6 w-full">
        {{ t('loginV6.joinButton') }}
      </BaseButton>
    </form>

    <!-- Footer link -->
    <div class="mt-6 text-center">
      <span class="text-sm text-gray-500 dark:text-gray-400">
        {{ t('loginV6.wantYourOwn') }}
      </span>
      {{ ' ' }}
      <button
        type="button"
        class="text-sm font-medium text-[#F15D22] hover:text-[#E67E22]"
        @click="emit('navigate', 'create')"
      >
        {{ t('loginV6.createLink') }}
      </button>
    </div>
  </div>
</template>
