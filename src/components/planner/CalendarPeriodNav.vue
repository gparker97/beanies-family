<script setup lang="ts">
/**
 * `‹ Today ›` — the period navigator, extracted so it can sit in two places at once.
 *
 * WHY IT IS A COMPONENT RATHER THAN MARKUP IN THE BAR
 * It is mounted TWICE by `CalendarCommandBar`, with responsive visibility, because the right
 * home for it differs by breakpoint:
 *   · phone — it stays in the identity row, after the flexible title. That row has always been
 *     stable (the title absorbs the slack) and there is no reason to move it.
 *   · sm and up — it joins the view controls, where the things to its right have fixed widths.
 * Two mounts of one component beats two copies of the same four buttons, and it cannot drift
 * into two slightly different navigators.
 *
 * ⚠️ THE CALENDAR ARROW RULE, which is the whole reason this moved. Stepping a calendar is a
 * REPEATED tap, so an arrow that moves between presses gets tapped where it used to be. On
 * desktop the label sized its own slot, so the cluster slid left as "September 2026" became
 * "May 2026" — measured at 473 → 438px across six presses, and up to 98px of drift in day view.
 *
 * A reserved label width was tried first and rejected by measurement: no single number serves
 * "April 2026" and "Wednesday, 25 February 2026", and every candidate was one long locale or
 * one Large-reading-mode step from being wrong again. Position by STRUCTURE instead — put the
 * cluster where only fixed-width controls sit to its right — and there is nothing to keep in
 * step. Apple Calendar and Fantastical do exactly this; Google, Outlook and Notion get the same
 * guarantee by putting the cluster BEFORE the label, which beanies cannot do because the month
 * name belongs in the top-left corner.
 *
 * Mockup + the industry survey: `docs/mockups/calendar-nav-stability-2026-09-14.html`.
 */
import { useTranslation } from '@/composables/useTranslation';

defineEmits<{ prev: []; today: []; next: [] }>();
const { t } = useTranslation();
</script>

<template>
  <div class="flex flex-shrink-0 items-center gap-0.5">
    <button
      type="button"
      class="text-secondary-500/50 dark:text-ink-soft dark:hover:bg-surface-hover flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-gray-100"
      :aria-label="t('planner.prevPeriod')"
      @click="$emit('prev')"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
    </button>
    <button
      type="button"
      class="font-outfit text-primary-500 dark:text-accent-lift hover:bg-primary-500/10 cursor-pointer rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors"
      @click="$emit('today')"
    >
      {{ t('planner.today') }}
    </button>
    <button
      type="button"
      class="text-secondary-500/50 dark:text-ink-soft dark:hover:bg-surface-hover flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-gray-100"
      :aria-label="t('planner.nextPeriod')"
      @click="$emit('next')"
    >
      <svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  </div>
</template>
