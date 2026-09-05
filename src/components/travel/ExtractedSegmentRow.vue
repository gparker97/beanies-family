<script setup lang="ts">
// Presentational summary row for ONE extracted travel segment in the review modal (#30).
// Display-only — it does NOT edit fields (corrections happen in the existing segment edit
// drawers after save). The parent passes a precomputed view-model so this stays dumb.
defineProps<{
  emoji: string;
  title: string;
  /** Short secondary line (route/dates), or '' to hide it. */
  detail: string;
  /** Localized kind/type label chip (e.g. "Flight", "Hotel"). */
  typeLabel: string;
}>();
</script>

<template>
  <div
    class="dark:bg-surface-raised flex items-center gap-3 rounded-2xl border border-[var(--tint-slate-5)] bg-white px-3 py-2.5"
  >
    <span class="text-xl leading-none" aria-hidden="true">{{ emoji }}</span>
    <div class="min-w-0 flex-1">
      <div class="font-outfit dark:text-ink truncate text-sm font-semibold text-gray-900">
        {{ title }}
      </div>
      <div v-if="detail" class="font-inter mt-0.5 truncate text-xs text-gray-400">
        {{ detail }}
      </div>
    </div>
    <span
      class="font-outfit dark:text-silk-lift flex-shrink-0 rounded-full bg-[rgba(0,180,216,0.1)] px-2.5 py-0.5 text-[0.625rem] font-semibold text-[#0077B6]"
    >
      {{ typeLabel }}
    </span>
  </div>
</template>
