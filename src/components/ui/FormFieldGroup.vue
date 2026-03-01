<script setup lang="ts">
interface Props {
  label: string;
  optional?: boolean;
  required?: boolean;
}

withDefaults(defineProps<Props>(), {
  optional: false,
  required: false,
});
</script>

<template>
  <div class="space-y-2">
    <label
      class="font-outfit text-[0.6rem] font-semibold tracking-[0.1em] text-[var(--color-text)] uppercase opacity-35 dark:text-gray-300"
    >
      {{ label }}
      <span v-if="required" class="text-primary-500">*</span>
      <span v-if="optional" class="opacity-50">(optional)</span>
    </label>
    <slot />
  </div>
</template>
