<script setup lang="ts">
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();

type LoginView = 'signin' | 'create' | 'join';

const emit = defineEmits<{
  navigate: [view: LoginView];
}>();
</script>

<template>
  <div class="space-y-4">
    <div class="mb-2 text-center">
      <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {{ t('login.welcomeTitle') }}
      </h2>
      <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
        {{ t('login.welcomeSubtitle') }}
      </p>
    </div>

    <!-- Sign In -->
    <button
      class="hover:border-primary-300 dark:hover:border-primary-600 w-full rounded-lg border border-gray-200 p-4 text-left transition-colors hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-800"
      @click="emit('navigate', 'signin')"
    >
      <div class="flex items-center gap-3">
        <div
          class="bg-primary-100 dark:bg-primary-900/30 flex h-10 w-10 items-center justify-center rounded-full"
        >
          <svg
            class="text-primary-600 dark:text-primary-400 h-5 w-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"
            />
          </svg>
        </div>
        <div>
          <p class="font-medium text-gray-900 dark:text-gray-100">{{ t('login.signIn') }}</p>
        </div>
      </div>
    </button>

    <!-- Create Pod -->
    <button
      class="hover:border-primary-300 dark:hover:border-primary-600 w-full rounded-lg border border-gray-200 p-4 text-left transition-colors hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-800"
      @click="emit('navigate', 'create')"
    >
      <div class="flex items-center gap-3">
        <div
          class="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30"
        >
          <svg
            class="h-5 w-5 text-green-600 dark:text-green-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 6v6m0 0v6m0-6h6m-6 0H6"
            />
          </svg>
        </div>
        <div>
          <p class="font-medium text-gray-900 dark:text-gray-100">{{ t('login.createPod') }}</p>
          <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('login.createPodDesc') }}</p>
        </div>
      </div>
    </button>

    <!-- Join Pod -->
    <button
      class="hover:border-primary-300 dark:hover:border-primary-600 w-full rounded-lg border border-gray-200 p-4 text-left transition-colors hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-800"
      @click="emit('navigate', 'join')"
    >
      <div class="flex items-center gap-3">
        <div
          class="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30"
        >
          <svg
            class="h-5 w-5 text-blue-600 dark:text-blue-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </div>
        <div>
          <p class="font-medium text-gray-900 dark:text-gray-100">{{ t('login.joinPod') }}</p>
          <p class="text-sm text-gray-500 dark:text-gray-400">{{ t('login.joinPodDesc') }}</p>
        </div>
      </div>
    </button>
  </div>
</template>
