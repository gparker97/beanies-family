<script setup lang="ts">
import { useTranslation } from '@/composables/useTranslation';

const { t } = useTranslation();

type LoginView = 'load-pod' | 'create' | 'join';

const emit = defineEmits<{
  navigate: [view: LoginView];
}>();
</script>

<template>
  <div class="space-y-6">
    <div class="text-center">
      <p class="text-sm text-gray-500 dark:text-gray-400">
        {{ t('loginV6.welcomePrompt') }}
      </p>
    </div>

    <div class="flex flex-col gap-4 sm:flex-row">
      <!-- Sign in to your pod -->
      <button
        class="flex-1 rounded-3xl bg-white p-6 text-left shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl dark:bg-slate-800"
        @click="emit('navigate', 'load-pod')"
      >
        <div
          class="bg-secondary-500 mb-4 flex h-12 w-12 items-center justify-center rounded-2xl dark:bg-slate-600"
        >
          <svg class="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"
            />
          </svg>
        </div>
        <p class="font-outfit text-base font-bold text-gray-900 dark:text-gray-100">
          {{ t('loginV6.signInTitle') }}
        </p>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {{ t('loginV6.signInSubtitle') }}
        </p>
      </button>

      <!-- Create a new pod -->
      <button
        class="from-primary-500 to-terracotta-400 flex-1 rounded-3xl bg-gradient-to-br p-6 text-left shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl"
        @click="emit('navigate', 'create')"
      >
        <div class="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white/20">
          <svg class="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 6v6m0 0v6m0-6h6m-6 0H6"
            />
          </svg>
        </div>
        <p class="font-outfit text-base font-bold text-white">
          {{ t('loginV6.createTitle') }}
        </p>
        <p class="mt-1 text-sm text-white/80">
          {{ t('loginV6.createSubtitle') }}
        </p>
      </button>

      <!-- Join an existing pod -->
      <button
        class="flex-1 rounded-3xl bg-white p-6 text-left shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl dark:bg-slate-800"
        @click="emit('navigate', 'join')"
      >
        <div
          class="bg-sky-silk-300/30 dark:bg-sky-silk-300/10 mb-4 flex h-12 w-12 items-center justify-center rounded-2xl"
        >
          <svg
            class="text-secondary-500 dark:text-sky-silk-300 h-6 w-6"
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
        <p class="font-outfit text-base font-bold text-gray-900 dark:text-gray-100">
          {{ t('loginV6.joinTitle') }}
        </p>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {{ t('loginV6.joinSubtitle') }}
        </p>
      </button>
    </div>
  </div>
</template>
