<script setup lang="ts">
interface Props {
  title?: string;
  subtitle?: string;
  padding?: boolean;
  hoverable?: boolean;
}

withDefaults(defineProps<Props>(), {
  padding: true,
  hoverable: false,
});
</script>

<template>
  <div
    class="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800"
    :class="{
      'cursor-pointer transition-shadow hover:shadow-md': hoverable,
    }"
  >
    <div
      v-if="title || $slots.header"
      class="border-b border-gray-200 px-6 py-4 dark:border-slate-700"
    >
      <slot name="header">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {{ title }}
        </h3>
        <p v-if="subtitle" class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {{ subtitle }}
        </p>
      </slot>
    </div>

    <div :class="{ 'p-6': padding }">
      <slot />
    </div>

    <div
      v-if="$slots.footer"
      class="rounded-b-2xl border-t border-gray-200 bg-gray-50 px-6 py-4 dark:border-slate-700 dark:bg-slate-900"
    >
      <slot name="footer" />
    </div>
  </div>
</template>
