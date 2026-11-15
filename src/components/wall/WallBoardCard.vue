<script setup lang="ts">
/**
 * One card on the Lists board: a tinted head that opens the card's sheet, and a body that
 * scrolls. The board draws three kinds with it (the family's to-dos, each list, each list
 * nobody the wall knows owns), so the frame, the ring and the tint live in one place.
 *
 * `color` is a member's hex; the head and body take it as an alpha tint (`2e`, `0d`) over the
 * card's own `surface-raised`, so the tint needs no dark partner of its own. With no colour the
 * head is the neutral slate tint, which has a dark value.
 *
 * The head is two lines, the same on every card: an emoji, the title and an optional pill
 * (`pill` slot); then an optional picture (`who` slot: faces), a subtitle and the tally. It is
 * a `<button>` unless `displayOnly` (the `WallCard` convention), so the two slots take phrasing
 * content and pictures only, never another control.
 */
import { computed } from 'vue';

const props = defineProps<{
  /** Decorative; the title names the card. */
  emoji: string;
  title: string;
  /** Line two's words: who the list is for, or what the card holds. */
  subtitle: string;
  /** "2 of 5 done", already translated. */
  tally: string;
  color?: string;
  /** `done`: every row is ticked (the green ring). `neutral`: an unowned list's plain ring. */
  ring?: 'done' | 'neutral';
  /** No sheet to open: the head is a `div` and emits nothing. */
  displayOnly?: boolean;
}>();
const emit = defineEmits<{ open: [] }>();

const RING: Record<'done' | 'neutral', string> = {
  done: 'ring-[2.5px] ring-[#27AE60]',
  neutral: 'ring-1 ring-[rgba(44,62,80,0.18)] dark:ring-line-strong',
};

const ringClass = computed(() => (props.ring ? RING[props.ring] : ''));
const headStyle = computed(() => (props.color ? { background: `${props.color}2e` } : undefined));
const bodyStyle = computed(() => (props.color ? { background: `${props.color}0d` } : undefined));
</script>

<template>
  <div
    class="dark:bg-surface-raised flex min-h-0 w-full max-w-[420px] flex-col overflow-hidden rounded-[22px] bg-white shadow-[var(--card-shadow)]"
    :class="ringClass"
  >
    <component
      :is="displayOnly ? 'div' : 'button'"
      :type="displayOnly ? undefined : 'button'"
      class="dark:border-line flex w-full shrink-0 flex-col gap-0.5 border-b border-[rgba(44,62,80,0.06)] px-3 py-2 text-left"
      :class="[
        color ? '' : 'bg-[var(--tint-slate-10)]',
        displayOnly
          ? ''
          : 'cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#AED6F1]',
      ]"
      :style="headStyle"
      data-test="board-card-head"
      v-on="displayOnly ? {} : { click: () => emit('open') }"
    >
      <span class="flex min-w-0 items-center gap-1.5">
        <span class="wall-bean-name shrink-0" aria-hidden="true">{{ emoji }}</span>
        <span
          class="font-outfit text-secondary-500 wall-bean-name dark:text-ink min-w-0 truncate font-bold"
        >
          {{ title }}
        </span>
        <slot name="pill" />
      </span>
      <span class="flex min-w-0 items-center gap-1.5">
        <slot name="who" />
        <span
          class="font-inter wall-bean-count dark:text-ink-soft min-w-0 flex-1 truncate text-[var(--muted-text,#4d5d6c)]"
        >
          {{ subtitle }}
        </span>
        <span
          class="font-inter wall-bean-count text-secondary-500 dark:text-ink shrink-0 font-semibold"
          data-test="card-tally"
        >
          {{ tally }}
        </span>
      </span>
    </component>

    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2" :style="bodyStyle">
      <slot />
    </div>
  </div>
</template>
