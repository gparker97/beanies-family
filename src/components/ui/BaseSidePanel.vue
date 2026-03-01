<script setup lang="ts">
import { watch, onMounted, onUnmounted } from 'vue';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';

interface Props {
  open: boolean;
  title?: string;
  side?: 'left' | 'right';
}

const props = withDefaults(defineProps<Props>(), {
  side: 'right',
});

const emit = defineEmits<{
  close: [];
}>();

function close() {
  emit('close');
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.open) {
    close();
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
  }
);

onMounted(() => {
  document.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
  document.body.style.overflow = '';
});
</script>

<template>
  <Teleport to="body">
    <!-- Backdrop fade -->
    <Transition
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
      enter-active-class="transition-transform duration-300 ease-out"
      :enter-from-class="side === 'right' ? 'translate-x-full' : '-translate-x-full'"
      enter-to-class="translate-x-0"
      leave-active-class="transition-transform duration-200 ease-in"
      leave-from-class="translate-x-0"
      :leave-to-class="side === 'right' ? 'translate-x-full' : '-translate-x-full'"
    >
      <div
        v-if="open"
        class="fixed inset-y-0 z-40 flex w-full max-w-md flex-col overflow-y-auto bg-white shadow-xl dark:bg-slate-800"
        :class="side === 'right' ? 'right-0' : 'left-0'"
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
