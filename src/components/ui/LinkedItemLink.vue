<script setup lang="ts">
/**
 * The presentational shell of a "linked item" link: a tappable chip or row that names
 * another record (an activity, a card, a to-do) and opens it. Markup and tokens are
 * `LinkedActivityChip`'s two looks, lifted unchanged:
 *   - `chip`: the to-do row's metadata line ("{icon} {title}, {sub} ›").
 *   - `row`: a drawer field (icon box, title, sub line, chevron).
 *
 * Purely presentational: the caller resolves the record, renders nothing on a miss, and
 * routes on `click`. The click does not propagate, so a link inside a clickable row never
 * also opens that row.
 */
withDefaults(
  defineProps<{
    /** Decorative glyph (emoji) for the linked record. */
    icon: string;
    title: string;
    /** Secondary text: after a comma on the chip, a second line on the row. */
    sub?: string;
    /** Accessible name of the link (what a tap does). */
    ariaLabel: string;
    variant?: 'chip' | 'row';
  }>(),
  { sub: '', variant: 'chip' }
);

const emit = defineEmits<{ click: [] }>();
</script>

<template>
  <button
    v-if="variant === 'chip'"
    type="button"
    class="font-outfit dark:text-ink inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-[var(--tint-orange-15)] bg-[var(--tint-orange-8)] py-0.5 pr-2 pl-1.5 text-xs font-semibold text-[var(--color-text)] transition-colors hover:bg-[var(--tint-orange-15)]"
    :aria-label="ariaLabel"
    :title="title"
    data-testid="linked-item-chip"
    @click.stop="emit('click')"
  >
    <span aria-hidden="true">{{ icon }}</span>
    <span class="min-w-0 truncate"
      >{{ title }}<template v-if="sub">, {{ sub }}</template></span
    >
    <svg
      class="text-primary-500 dark:text-accent-lift h-2.5 w-2.5 shrink-0"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="M4.5 3l3 3-3 3" />
    </svg>
  </button>

  <button
    v-else
    type="button"
    class="dark:bg-surface-overlay dark:border-line dark:hover:bg-surface-hover flex w-full min-w-0 items-center gap-2.5 rounded-[14px] border border-[var(--tint-slate-10)] bg-white px-3 py-2.5 text-left shadow-sm transition-colors hover:bg-[var(--tint-orange-8)]"
    :aria-label="ariaLabel"
    data-testid="linked-item-row"
    @click.stop="emit('click')"
  >
    <span
      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--tint-orange-8)] text-base"
      aria-hidden="true"
    >
      {{ icon }}
    </span>
    <span class="min-w-0 flex-1">
      <span
        class="font-outfit dark:text-ink block truncate text-sm font-semibold text-[var(--color-text)]"
      >
        {{ title }}
      </span>
      <span
        v-if="sub"
        class="dark:text-ink-soft block truncate text-xs text-[var(--color-text-muted)]"
      >
        {{ sub }}
      </span>
    </span>
    <svg
      class="text-primary-500 dark:text-accent-lift h-3 w-3 shrink-0"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="M4.5 3l3 3-3 3" />
    </svg>
  </button>
</template>
