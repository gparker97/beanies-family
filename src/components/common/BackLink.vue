<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import { useAppBack } from '@/composables/useAppBack';

/**
 * The breadcrumb-style "Back to ..." link above a page title. Goes back in history when the
 * previous entry is in the app (so the list you came from keeps its place), else to `fallback`.
 * `label` arrives translated; per-site spacing falls through via `class`.
 */
const props = defineProps<{
  fallback: RouteLocationRaw;
  label: string;
  /** Go back only to exactly this full path, else to `fallback` (see `GoBackOptions.onlyTo`). */
  onlyTo?: string;
}>();

const { goBack } = useAppBack();
</script>

<template>
  <button
    type="button"
    class="font-outfit text-secondary-500 hover:text-primary-500 dark:text-ink-soft dark:hover:text-accent-lift flex items-center gap-1 text-xs font-semibold transition-colors"
    @click="goBack(props.fallback, { onlyTo: props.onlyTo })"
  >
    <BeanieIcon name="chevron-left" size="xs" />
    <span>{{ label }}</span>
  </button>
</template>
