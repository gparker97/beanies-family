<script setup lang="ts">
// Themed account picker — the standard beanies select chrome (squircle, tinted
// fill, Heritage-Orange focus, chevron). Extracted so the transaction modal's
// source AND destination pickers share one implementation. Generic on options;
// callers build the labels (e.g. name · currency).
interface Option {
  value: string;
  label: string;
}

defineProps<{
  modelValue: string | undefined;
  options: Option[];
  placeholder?: string;
  ariaLabel?: string;
}>();

defineEmits<{ 'update:modelValue': [value: string] }>();
</script>

<template>
  <div class="relative">
    <select
      :value="modelValue ?? ''"
      :aria-label="ariaLabel"
      class="focus:border-primary-500 font-outfit w-full cursor-pointer appearance-none rounded-[16px] border-2 border-transparent bg-[var(--tint-slate-5)] px-4 py-3 pr-10 text-base font-semibold text-[var(--color-text)] transition-all duration-200 focus:shadow-[0_0_0_3px_rgba(241,93,34,0.1)] focus:outline-none dark:bg-slate-700 dark:text-gray-100"
      @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option v-if="placeholder" value="" disabled>{{ placeholder }}</option>
      <option v-for="opt in options" :key="opt.value" :value="opt.value">
        {{ opt.label }}
      </option>
    </select>
    <div class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
      <svg
        class="h-4 w-4 text-[var(--color-text)] opacity-35"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </div>
  </div>
</template>
