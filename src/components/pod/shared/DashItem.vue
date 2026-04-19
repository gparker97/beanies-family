<script setup lang="ts">
/**
 * Compact list row used inside OverviewModule bodies — a colored
 * 28px squircle on the left, title + optional muted sub on the right.
 * Matches the `.dash-item` shape from the mockup so each module's
 * body reads consistently across types (favorites, sayings,
 * medications, notes, allergies).
 */
export type DashItemTone =
  | 'fav'
  | 'place'
  | 'book'
  | 'toy'
  | 'med'
  | 'note'
  | 'allergy'
  | 'allergy-mild';

const props = defineProps<{
  emoji: string;
  title: string;
  sub?: string;
  tone?: DashItemTone;
}>();

defineEmits<{
  click: [];
}>();

// Tint map mirrors the mockup's `.dash-item .ico.*` classes. Allergy
// gets the strong heritage-orange swatch (it's a safety surface); the
// "mild" allergy variant falls back to silk blue so severe entries
// visually dominate.
const TONE_BG: Record<DashItemTone, string> = {
  fav: 'bg-[var(--tint-orange-15)] text-secondary-500',
  place: 'bg-[rgb(174_214_241_/_35%)] text-secondary-500',
  book: 'bg-[var(--tint-purple-12)] text-secondary-500',
  toy: 'bg-[rgb(230_126_34_/_12%)] text-secondary-500',
  med: 'bg-[rgb(39_174_96_/_20%)] text-secondary-500',
  note: 'bg-[var(--tint-silk-20)] text-secondary-500',
  allergy: 'bg-[var(--color-primary)] text-white',
  'allergy-mild': 'bg-[rgb(174_214_241_/_35%)] text-secondary-500',
};

const toneClass = (): string => TONE_BG[props.tone ?? 'fav'];
</script>

<template>
  <button
    type="button"
    class="grid w-full items-start gap-2.5 rounded-xl bg-[var(--color-background)] px-2.5 py-2 text-left hover:bg-[var(--tint-orange-4)]"
    style="grid-template-columns: 28px 1fr"
    @click="$emit('click')"
  >
    <span
      class="flex h-7 w-7 items-center justify-center rounded-[10px] text-sm"
      :class="toneClass()"
      aria-hidden="true"
    >
      {{ emoji }}
    </span>
    <span class="flex min-w-0 flex-col gap-0.5">
      <span
        class="font-outfit text-secondary-500 truncate text-[13px] leading-tight font-semibold dark:text-gray-100"
      >
        {{ title }}
      </span>
      <span
        v-if="sub"
        class="font-inter text-secondary-500/60 truncate text-[11px] leading-tight dark:text-gray-400"
      >
        {{ sub }}
      </span>
    </span>
  </button>
</template>
