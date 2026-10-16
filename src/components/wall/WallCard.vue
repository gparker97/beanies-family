<script setup lang="ts">
/**
 * The shell every peripheral card shares: an uppercase orange heading, a
 * chevron that promises a drill-in, and the lift-on-press affordance.
 *
 * A shell rather than four hand-rolled cards, because the mockup's band and
 * rail render the SAME cards in two different containers — any styling that
 * lived in one of them would drift the moment the other changed.
 *
 * `displayOnly` (#134, the weather card) is the one card with no drill-in. It
 * renders a `div` with the same shell classes, so the card family stays one
 * design, but drops everything that promises a tap: no chevron, no press
 * scale, no `open`. A card that looks tappable and is not was the wall's
 * loudest complaint. Named `displayOnly` rather than `static`, a strict-mode
 * reserved word that is awkward as a template identifier.
 */
withDefaults(
  defineProps<{
    /**
     * The heading. Omitted only by the weather card's one-line form, which
     * gives the heading's row back to the Tonight card on a short wall; a
     * titleless card also drops to a slimmer vertical padding.
     */
    title?: string;
    dark?: boolean;
    /**
     * `chores` gives the band's most important card its own identity, the way
     * `dark` does for the trip. Without it the anchor of the wall was one white
     * card among four.
     */
    tone?: 'chores' | 'todos';
    /** Not interactive: a `div`, no chevron, no press scale, no `open`. */
    displayOnly?: boolean;
  }>(),
  { title: undefined, tone: undefined }
);
const emit = defineEmits<{ open: [] }>();
</script>

<template>
  <component
    :is="displayOnly ? 'div' : 'button'"
    :type="displayOnly ? undefined : 'button'"
    class="wall-card block w-full rounded-[26px] px-4 text-left"
    :class="[
      title ? 'py-3.5' : 'py-2',
      displayOnly ? '' : 'transition-transform active:scale-[0.99]',
      dark
        ? 'bg-gradient-to-br from-[#33475b] to-[var(--deep-slate,#2C3E50)] text-[#ecf0f1] shadow-[var(--card-shadow)]'
        : tone === 'chores'
          ? 'dark:from-surface-raised dark:to-surface-raised dark:ring-surface-hover bg-gradient-to-br from-[#eaf4fc] to-white shadow-[var(--card-shadow)] ring-1 ring-[rgba(174,214,241,0.9)]'
          : 'dark:bg-surface-raised bg-white shadow-[var(--card-shadow)]',
    ]"
    v-on="displayOnly ? {} : { click: () => emit('open') }"
  >
    <span
      v-if="title"
      class="font-outfit wall-card-title mb-2 flex items-center gap-1.5 font-bold tracking-[0.09em] uppercase"
      :class="dark ? 'text-[var(--sky-silk,#AED6F1)]' : 'text-primary-500 dark:text-accent-lift'"
    >
      {{ title }}
      <slot name="aside" />
      <span v-if="!displayOnly" class="ml-auto opacity-50" aria-hidden="true">›</span>
    </span>
    <slot />
  </component>
</template>
