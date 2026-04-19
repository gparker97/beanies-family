<script setup lang="ts">
/**
 * Shell for a single tile in the Bean Overview dashboard — header with
 * emoji + title, optional count chip, optional "view all →" link, and
 * a body slot for whatever tile-specific content the caller renders.
 *
 * The plan calls for six of these on the overview tab (About,
 * Favorites, Sayings, Allergies, Medications, Notes). Shell stays dumb;
 * each module supplies its own data from its own store, so this
 * component stays free of domain imports.
 */
defineProps<{
  title: string;
  emoji: string;
  /** Count chip shown next to the title. Omit for modules without a count. */
  count?: number | null;
  /** When set, renders a "View all →" action that the parent handles. */
  viewAllLabel?: string;
  /**
   * Visual tone. `safety` tints the card orange + orange title — used
   * on the Allergies tile so safety info stands out from the rest of
   * the grid (matches the mockup's `.dash-module.safety` rule).
   */
  tone?: 'default' | 'safety';
  /** Optional inline chip shown next to the title (e.g. "1 severe"). */
  headerChip?: { label: string; variant?: 'danger' | 'success' } | null;
}>();

defineEmits<{
  'view-all': [];
}>();
</script>

<template>
  <section
    class="flex flex-col rounded-[var(--sq)] p-5 shadow-[var(--card-shadow)]"
    :class="
      tone === 'safety'
        ? 'border border-[rgb(241_93_34_/_15%)] bg-[rgb(241_93_34_/_4%)]'
        : 'bg-white dark:bg-slate-800'
    "
  >
    <header class="flex items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-2">
        <span class="text-xl" aria-hidden="true">{{ emoji }}</span>
        <h3
          class="font-outfit truncate text-sm font-bold"
          :class="tone === 'safety' ? 'text-primary-500' : 'text-secondary-500 dark:text-gray-100'"
        >
          {{ title }}
        </h3>
        <span
          v-if="headerChip"
          class="font-outfit inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase"
          :class="
            headerChip.variant === 'success'
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
              : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
          "
        >
          {{ headerChip.label }}
        </span>
        <span
          v-else-if="count !== null && count !== undefined"
          class="font-outfit text-secondary-500/60 inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-[var(--tint-slate-5)] px-2 py-0.5 text-xs font-semibold dark:bg-slate-700 dark:text-gray-400"
        >
          {{ count }}
        </span>
      </div>
      <button
        v-if="viewAllLabel"
        type="button"
        class="font-outfit text-primary-500 text-xs font-semibold transition-opacity hover:opacity-80"
        @click="$emit('view-all')"
      >
        {{ viewAllLabel }}
      </button>
    </header>
    <div class="mt-3 flex-1">
      <slot />
    </div>
  </section>
</template>
