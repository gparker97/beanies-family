<script setup lang="ts">
/**
 * Placeholder tab body for content that ships in a later phase (P3 for
 * allergies/medications) or is still empty for this bean. Wraps
 * EmptyState in a tab-height card so the layout shell is stable.
 */
import EmptyState from '@/components/pod/shared/EmptyState.vue';

defineProps<{
  emoji: string;
  message: string;
}>();
</script>

<template>
  <div
    class="rounded-[var(--sq)] bg-white px-6 py-10 shadow-[var(--card-shadow)] dark:bg-slate-800"
  >
    <EmptyState :emoji="emoji" :message="message" />
  </div>
</template>
