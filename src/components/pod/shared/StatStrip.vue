<script setup lang="ts">
/**
 * Compact horizontal row of at-a-glance stat cards. Used at the top of
 * Bean overview, Cookbook hero, Cook Log stats, Care & Safety hero —
 * anywhere a page wants a quick "here are the key numbers" band.
 *
 * Pure-presentational; each caller massages their store into a `stats`
 * array so this component stays domain-free.
 */
interface Stat {
  /** Large number / headline string (e.g. `"12"`, `"3 days"`). */
  value: string | number;
  /** Short label under the value (e.g. `"favorites"`). */
  label: string;
  /** Optional emoji shown above the value. */
  emoji?: string;
  /** Optional color hint — defaults to brand primary orange. */
  accent?: 'primary' | 'secondary' | 'success' | 'silk' | 'terracotta';
}

withDefaults(
  defineProps<{
    stats: Stat[];
    /** Grid column count — defaults to `stats.length` capped at 4. */
    columns?: number;
  }>(),
  { columns: 0 }
);

const ACCENT_CLASS: Record<NonNullable<Stat['accent']>, string> = {
  primary: 'text-primary-500',
  secondary: 'text-secondary-500',
  success: 'text-[#27AE60]',
  silk: 'text-[#3498DB]',
  terracotta: 'text-[#E67E22]',
};
</script>

<template>
  <div
    class="grid gap-3"
    :style="{
      gridTemplateColumns: `repeat(${columns || Math.min(stats.length, 4)}, minmax(0, 1fr))`,
    }"
  >
    <div
      v-for="(stat, i) in stats"
      :key="i"
      class="flex flex-col items-center gap-0.5 rounded-2xl bg-[var(--tint-slate-5)] px-4 py-3 text-center dark:bg-slate-700/40"
    >
      <span v-if="stat.emoji" class="text-lg leading-none" aria-hidden="true">{{
        stat.emoji
      }}</span>
      <span
        class="font-outfit text-xl leading-tight font-bold"
        :class="ACCENT_CLASS[stat.accent ?? 'primary']"
      >
        {{ stat.value }}
      </span>
      <span
        class="font-outfit text-secondary-500/60 text-[11px] leading-tight font-medium dark:text-gray-400"
      >
        {{ stat.label }}
      </span>
    </div>
  </div>
</template>
