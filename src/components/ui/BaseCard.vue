<script setup lang="ts">
interface Props {
  title?: string;
  subtitle?: string;
  padding?: boolean;
  hoverable?: boolean;
}

withDefaults(defineProps<Props>(), {
  title: undefined,
  subtitle: undefined,
  padding: true,
  hoverable: false,
});
</script>

<template>
  <div
    class="rounded-3xl bg-white shadow-[var(--card-shadow)] transition-[transform,box-shadow] duration-200 dark:bg-slate-800"
    :class="{
      'cursor-pointer hover:-translate-y-0.5 hover:shadow-[var(--card-hover-shadow)]': hoverable,
    }"
  >
    <div
      v-if="title || $slots.header"
      class="border-b border-gray-100 px-6 py-4 dark:border-slate-700"
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
      class="rounded-b-3xl border-t border-gray-100 bg-gray-50 px-6 py-4 dark:border-slate-700 dark:bg-slate-900"
    >
      <slot name="footer" />
    </div>
  </div>
</template>
