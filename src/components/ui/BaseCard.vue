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
    class="dark:bg-surface-raised rounded-3xl bg-white shadow-[var(--card-shadow)] transition-[transform,box-shadow] duration-200"
    :class="{
      'cursor-pointer hover:-translate-y-0.5 hover:shadow-[var(--card-hover-shadow)]': hoverable,
    }"
  >
    <div v-if="title || $slots.header" class="dark:border-line border-b border-gray-100 px-6 py-4">
      <slot name="header">
        <h3 class="dark:text-ink text-lg font-semibold text-gray-900">
          {{ title }}
        </h3>
        <p v-if="subtitle" class="dark:text-ink-soft mt-1 text-sm text-gray-500">
          {{ subtitle }}
        </p>
      </slot>
    </div>

    <div :class="{ 'p-6': padding }">
      <slot />
    </div>

    <div
      v-if="$slots.footer"
      class="dark:border-line dark:bg-surface-ground rounded-b-3xl border-t border-gray-100 bg-gray-50 px-6 py-4"
    >
      <slot name="footer" />
    </div>
  </div>
</template>
