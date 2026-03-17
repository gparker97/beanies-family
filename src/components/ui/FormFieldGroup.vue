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
      class="font-outfit text-xs font-semibold tracking-[0.1em] uppercase"
      :class="
        error
          ? 'text-primary-500 opacity-100'
          : 'text-[var(--color-text)] opacity-35 dark:text-gray-300'
      "
    >
      {{ label }}
      <span v-if="required" class="text-primary-500">*</span>
      <span v-if="optional" class="opacity-50">(optional)</span>
    </label>
    <div :class="error ? 'ring-primary-500/40 rounded-2xl ring-2' : ''">
      <slot />
    </div>
  </div>
</template>
