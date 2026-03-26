<script setup lang="ts">
interface Props {
  label: string;
  optional?: boolean;
  required?: boolean;
  error?: boolean;
}

withDefaults(defineProps<Props>(), {
  optional: false,
  required: false,
  error: false,
});
</script>

<template>
  <div class="space-y-2">
    <label
      class="font-outfit flex items-center gap-1.5 text-xs font-semibold tracking-[0.1em] whitespace-nowrap uppercase"
      :class="
        error
          ? 'text-primary-500 opacity-100'
          : 'text-[var(--color-text)] opacity-35 dark:text-gray-300'
      "
    >
      {{ label }}
      <span v-if="required" class="text-primary-500 text-sm font-bold opacity-100">*</span>
      <slot name="label-extra" />
    </label>
    <div :class="error ? 'ring-primary-500/40 rounded-2xl ring-2' : ''">
      <slot />
    </div>
  </div>
</template>
