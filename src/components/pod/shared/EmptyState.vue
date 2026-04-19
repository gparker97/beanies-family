<script setup lang="ts">
/**
 * Friendly empty-state prompt. Used inside OverviewModule bodies and
 * tab contents when no data exists yet — gives the user a hint of
 * what to do next plus an optional CTA.
 */
defineProps<{
  emoji?: string;
  message: string;
  /** Optional CTA label — when set, renders a primary-styled button. */
  actionLabel?: string;
}>();

defineEmits<{
  action: [];
}>();
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-2 py-6 text-center">
    <span v-if="emoji" class="text-3xl leading-none" aria-hidden="true">{{ emoji }}</span>
    <p class="font-outfit text-secondary-500/60 text-sm dark:text-gray-400">
      {{ message }}
    </p>
    <button
      v-if="actionLabel"
      type="button"
      class="font-outfit text-primary-500 mt-1 text-xs font-semibold hover:underline"
      @click="$emit('action')"
    >
      {{ actionLabel }}
    </button>
  </div>
</template>
