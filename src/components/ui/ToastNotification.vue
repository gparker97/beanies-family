<script setup lang="ts">
interface Props {
  icon?: string;
  title: string;
  message: string;
  visible?: boolean;
}

withDefaults(defineProps<Props>(), {
  icon: '🎉',
  visible: true,
});

const emit = defineEmits<{
  dismiss: [];
}>();
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-300 ease-out"
    enter-from-class="translate-y-[-10px] opacity-0"
    enter-to-class="translate-y-0 opacity-100"
    leave-active-class="transition-all duration-200 ease-in"
    leave-from-class="translate-y-0 opacity-100"
    leave-to-class="translate-y-[-10px] opacity-0"
  >
    <div
      v-if="visible"
      class="from-primary-500 to-terracotta-400 flex items-center gap-3.5 rounded-[18px] bg-gradient-to-r px-6 py-4 text-white shadow-[0_8px_32px_rgba(241,93,34,0.2)]"
    >
      <div
        class="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-[14px] bg-white/20 text-xl"
      >
        {{ icon }}
      </div>
      <div class="min-w-0 flex-1">
        <div class="font-outfit text-sm font-semibold">{{ title }}</div>
        <div class="mt-0.5 text-xs opacity-70">{{ message }}</div>
      </div>
      <button
        type="button"
        class="flex-shrink-0 rounded-full p-1 opacity-60 transition-opacity hover:opacity-100"
        aria-label="Dismiss"
        @click="emit('dismiss')"
      >
        <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  </Transition>
</template>
