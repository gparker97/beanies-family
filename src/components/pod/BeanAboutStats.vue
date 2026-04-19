<script setup lang="ts">
/**
 * Bean-overview "About" ribbon — a single flat info band that sits
 * above the clickable dashboard modules. The visual difference is the
 * whole point: shadowed/liftable tiles below signal "click me", this
 * flat divided strip signals "read-only facts about this bean."
 *
 * Content varies by consumer so we stay dumb — callers pass the
 * already-computed About entries.
 */
import { useTranslation } from '@/composables/useTranslation';

export interface AboutStat {
  /** Uppercase micro-label shown at the top of each cell. */
  label: string;
  /** Main value — Outfit bold. */
  value: string;
  /** Optional muted caption under the value. */
  sub?: string;
}

defineProps<{
  stats: AboutStat[];
}>();

const { t } = useTranslation();
</script>

<template>
  <section
    class="about-ribbon mb-5 overflow-hidden rounded-[var(--sq)] border border-[rgb(44_62_80_/_6%)] bg-gradient-to-br from-[var(--tint-slate-5)] to-[rgb(174_214_241_/_12%)] dark:border-white/5 dark:from-slate-700/40 dark:to-slate-700/20"
  >
    <!-- Kicker: explicit "About" label makes the ribbon's purpose
         unmissable + visually distinguishes the row from the dashboard
         modules below. -->
    <div class="flex items-center gap-1.5 px-5 pt-3 pb-1">
      <span class="text-xs leading-none" aria-hidden="true">🫘</span>
      <span
        class="font-outfit text-secondary-500/55 text-[10px] font-semibold tracking-[0.14em] uppercase dark:text-gray-400"
      >
        {{ t('bean.overview.about') }}
      </span>
    </div>
    <div
      class="about-ribbon-grid grid px-1 pb-3"
      :style="{
        gridTemplateColumns: `repeat(auto-fit, minmax(180px, 1fr))`,
      }"
    >
      <div v-for="(stat, i) in stats" :key="i" class="about-cell flex flex-col gap-0.5 px-4 py-2">
        <span
          class="font-outfit text-secondary-500/55 text-[10px] font-semibold tracking-[0.08em] uppercase dark:text-gray-400"
        >
          {{ stat.label }}
        </span>
        <span
          class="font-outfit text-secondary-500 text-base leading-tight font-bold dark:text-gray-100"
        >
          {{ stat.value }}
        </span>
        <span v-if="stat.sub" class="text-secondary-500/60 text-[11px] dark:text-gray-400">
          {{ stat.sub }}
        </span>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Thin vertical divider between cells, responsive: drops to a top
   border when cells wrap to a new row. `:not(:first-child)` skips
   the leftmost cell so the ribbon doesn't have a leading edge line. */
.about-cell {
  position: relative;
}

.about-cell:not(:first-child)::before {
  background: rgb(44 62 80 / 8%);
  bottom: 20%;
  content: '';
  left: 0;
  position: absolute;
  top: 20%;
  width: 1px;
}

/* When the auto-fit grid wraps to a new row, Tailwind's approach of
   :first-child won't re-target the first cell on each row — the
   divider remains on the LEFT of every non-first cell. That's fine
   at desktop where all cells stay on one row; at narrow widths the
   wrap adds minor visual variance but never doubles up. Acceptable
   for a 2–4 stat ribbon. */

:global(.dark) .about-cell:not(:first-child)::before {
  background: rgb(255 255 255 / 8%);
}
</style>
