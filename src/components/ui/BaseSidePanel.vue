<script setup lang="ts">
import { toRef } from 'vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useFullscreenOverlay } from '@/composables/useFullscreenOverlay';

interface Props {
  open: boolean;
  title?: string;
  side?: 'left' | 'right';
  size?: 'narrow' | 'medium' | 'wide' | 'full';
  closable?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  side: 'right',
  size: 'narrow',
  closable: true,
});

const sizeClasses: Record<string, string> = {
  narrow: 'max-w-md',
  medium: 'max-w-lg',
  wide: 'max-w-xl',
  full: 'max-w-3xl',
};

const emit = defineEmits<{
  close: [];
}>();

function close() {
  if (props.closable) {
    emit('close');
  }
}

useFullscreenOverlay(toRef(props, 'open'), close);
</script>

<template>
  <Teleport to="body">
    <!-- Backdrop fade -->
    <Transition
      appear
      enter-active-class="transition-opacity duration-200"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-200"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="fixed inset-0 z-40 bg-black/50" @click="close" />
    </Transition>

    <!-- Panel slide -->
    <Transition
      appear
      enter-active-class="transition-transform duration-300 ease-out"
      :enter-from-class="side === 'right' ? 'translate-x-full' : '-translate-x-full'"
      enter-to-class="translate-x-0"
      leave-active-class="transition-transform duration-200 ease-in"
      leave-from-class="translate-x-0"
      :leave-to-class="side === 'right' ? 'translate-x-full' : '-translate-x-full'"
    >
      <div
        v-if="open"
        role="dialog"
        aria-modal="true"
        class="fixed inset-y-0 z-40 flex w-full flex-col overflow-y-auto bg-white shadow-xl dark:bg-slate-800"
        :class="[sizeClasses[size], side === 'right' ? 'right-0' : 'left-0']"
      >
        <!-- Header -->
        <div
          v-if="title || $slots.header"
          class="flex shrink-0 items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-slate-700"
        >
          <slot name="header">
            <h2 class="font-outfit text-secondary-500 text-lg font-semibold dark:text-gray-100">
              {{ title }}
            </h2>
          </slot>

          <button
            type="button"
            class="rounded-xl p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-slate-700 dark:hover:text-gray-300"
            :disabled="!closable"
            :class="{ 'cursor-not-allowed opacity-50': !closable }"
            @click="close"
          >
            <BeanieIcon name="close" size="md" />
          </button>
        </div>

        <!-- Body -->
        <div class="flex-1 overflow-y-auto p-6">
          <slot />
        </div>

        <!-- Footer -->
        <div
          v-if="$slots.footer"
          class="shrink-0 border-t border-gray-200 bg-gray-50 px-6 py-4 dark:border-slate-700 dark:bg-slate-900"
        >
          <slot name="footer" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
