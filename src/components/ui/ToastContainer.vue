<script setup lang="ts">
import { useToast, type ToastType } from '@/composables/useToast';

const { toasts, dismissToast } = useToast();

const typeConfig: Record<ToastType, { icon: string; bgClass: string; borderClass: string }> = {
  success: {
    icon: '✓',
    bgClass: 'bg-emerald-50 dark:bg-emerald-950/50',
    borderClass: 'border-emerald-200 dark:border-emerald-800',
  },
  error: {
    icon: '✕',
    bgClass: 'bg-red-50 dark:bg-red-950/50',
    borderClass: 'border-red-200 dark:border-red-800',
  },
  warning: {
    icon: '!',
    bgClass: 'bg-amber-50 dark:bg-amber-950/50',
    borderClass: 'border-amber-200 dark:border-amber-800',
  },
  info: {
    icon: 'i',
    bgClass: 'bg-sky-50 dark:bg-sky-950/50',
    borderClass: 'border-sky-200 dark:border-sky-800',
  },
};

const iconColorClass: Record<ToastType, string> = {
  success: 'bg-emerald-500 text-white',
  error: 'bg-red-500 text-white',
  warning: 'bg-amber-500 text-white',
  info: 'bg-sky-500 text-white',
};

const titleColorClass: Record<ToastType, string> = {
  success: 'text-emerald-800 dark:text-emerald-200',
  error: 'text-red-800 dark:text-red-200',
  warning: 'text-amber-800 dark:text-amber-200',
  info: 'text-sky-800 dark:text-sky-200',
};
</script>

<template>
  <TransitionGroup
    tag="div"
    class="fixed right-4 bottom-20 z-[200] flex flex-col items-end gap-2 md:right-6 md:bottom-6"
    enter-active-class="transition-all duration-300 ease-out"
    leave-active-class="transition-all duration-200 ease-in"
    enter-from-class="translate-y-4 opacity-0"
    enter-to-class="translate-y-0 opacity-100"
    leave-from-class="translate-y-0 opacity-100"
    leave-to-class="translate-x-8 opacity-0"
  >
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="flex w-80 max-w-[calc(100vw-2rem)] items-start gap-3 rounded-2xl border p-3 shadow-lg backdrop-blur-sm"
      :class="[typeConfig[toast.type].bgClass, typeConfig[toast.type].borderClass]"
    >
      <div
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
        :class="iconColorClass[toast.type]"
      >
        {{ typeConfig[toast.type].icon }}
      </div>
      <div class="min-w-0 flex-1">
        <p class="font-outfit text-sm font-semibold" :class="titleColorClass[toast.type]">
          {{ toast.title }}
        </p>
        <p v-if="toast.message" class="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
          {{ toast.message }}
        </p>
      </div>
      <button
        class="shrink-0 rounded-lg p-1 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
        @click="dismissToast(toast.id)"
      >
        <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path
            fill-rule="evenodd"
            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
            clip-rule="evenodd"
          />
        </svg>
      </button>
    </div>
  </TransitionGroup>
</template>
