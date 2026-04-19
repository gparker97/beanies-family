<script setup lang="ts">
/**
 * Row of small About cards for the Bean Overview — replaces the
 * number-focused StatStrip on this surface. Matches the mockup's
 * `.about-stats` + `.about-stat` shape: label (uppercase micro) /
 * value (bold) / optional sub (muted caption).
 *
 * Dumb: callers pass the already-computed cards. Content varies by
 * consumer so we don't inline member → stat mapping here.
 */
export interface AboutStat {
  /** Uppercase micro-label shown at the top of the card. */
  label: string;
  /** Main value — Outfit bold. */
  value: string;
  /** Optional muted caption under the value. */
  sub?: string;
}

defineProps<{
  stats: AboutStat[];
}>();
</script>

<template>
  <div
    class="mb-5 grid gap-3.5"
    style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))"
  >
    <div
      v-for="(stat, i) in stats"
      :key="i"
      class="flex flex-col gap-1 rounded-[18px] bg-white px-4 py-3.5 shadow-[var(--card-shadow)] dark:bg-slate-800"
    >
      <span
        class="font-outfit text-secondary-500/60 text-[10px] font-semibold tracking-[0.08em] uppercase dark:text-gray-400"
      >
        {{ stat.label }}
      </span>
      <span class="font-outfit text-secondary-500 text-base font-bold dark:text-gray-100">
        {{ stat.value }}
      </span>
      <span v-if="stat.sub" class="text-secondary-500/60 text-[11px] dark:text-gray-400">
        {{ stat.sub }}
      </span>
    </div>
  </div>
</template>
