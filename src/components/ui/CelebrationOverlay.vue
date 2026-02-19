<script setup lang="ts">
import { useCelebration } from '@/composables/useCelebration';

const { toasts, activeModal, dismissModal } = useCelebration();
</script>

<template>
  <Teleport to="body">
    <!-- Modal celebration -->
    <Transition
      enter-active-class="transition-all duration-300"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-all duration-200"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="activeModal"
        class="fixed inset-0 z-[200] flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
      >
        <div class="absolute inset-0 bg-black/40" @click="dismissModal" />
        <Transition
          enter-active-class="transition-all duration-300"
          enter-from-class="opacity-0 scale-90"
          enter-to-class="opacity-100 scale-100"
        >
          <div
            v-if="activeModal"
            class="relative w-full max-w-sm rounded-3xl bg-white px-8 py-10 text-center shadow-2xl dark:bg-slate-800"
          >
            <img
              :src="activeModal.asset"
              :alt="activeModal.message"
              class="mx-auto mb-6 h-36 w-36 object-contain"
            />
            <p class="font-outfit text-secondary-500 text-xl font-bold dark:text-gray-100">
              {{ activeModal.message }}
            </p>
            <button
              class="bg-primary-500 hover:bg-primary-600 mt-6 rounded-2xl px-8 py-2.5 font-medium text-white transition-colors"
              @click="dismissModal"
            >
              Let's go!
            </button>
          </div>
        </Transition>
      </div>
    </Transition>

    <!-- Toast notifications - bottom center, bounce-in -->
    <div
      class="fixed bottom-6 left-1/2 z-[200] flex -translate-x-1/2 flex-col items-center gap-2"
      style="pointer-events: none"
    >
      <TransitionGroup
        enter-active-class="transition-all duration-400"
        enter-from-class="opacity-0 translate-y-4 scale-95"
        enter-to-class="opacity-100 translate-y-0 scale-100"
        leave-active-class="transition-all duration-300"
        leave-from-class="opacity-100 translate-y-0 scale-100"
        leave-to-class="opacity-0 translate-y-4 scale-95"
      >
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 shadow-lg dark:bg-slate-800"
          style="pointer-events: auto"
        >
          <img :src="toast.asset" :alt="toast.message" class="h-10 w-10 object-contain" />
          <p class="text-secondary-500 font-medium dark:text-gray-100">{{ toast.message }}</p>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
