<script setup lang="ts">
/**
 * Who Owns What (#109): one card on the deal board's lanes (and in the open Skipped row). A
 * small card, not a pill: the art in its category-tinted thumb, the name, and one caption
 * line (the split part in the accent colour, otherwise what "done" looks like).
 *
 * Presentational and drag-agnostic: the board owns the click, the drag payload and the
 * test id, which fall through to the root `<button>`. `muted` draws a skipped card: a
 * greyscale thumb and a dashed, shadowless edge; the text itself is never faded.
 */
import { useResponsibilityCardLabel } from '@/composables/useResponsibilityCardLabel';
import { categoryTint } from '@/constants/listCategories';
import type { ResolvedCard } from '@/utils/responsibilityDeck';
import CardArt from '@/components/responsibilities/CardArt.vue';

withDefaults(
  defineProps<{ card: ResolvedCard; caption: string; accent?: boolean; muted?: boolean }>(),
  { accent: false, muted: false }
);

const { cardName } = useResponsibilityCardLabel();
</script>

<template>
  <button
    type="button"
    draggable="true"
    class="mini dark:bg-surface-overlay dark:border-line dark:hover:bg-surface-hover dark:hover:border-line-strong flex min-w-0 cursor-grab items-center gap-2.5 rounded-xl border border-[rgb(44_62_80/9%)] bg-white py-1.5 pr-2.5 pl-1.5 text-left transition-colors hover:border-[rgb(241_93_34/38%)]"
    :class="{ 'is-muted': muted }"
    :style="{ '--cat': categoryTint(card.category) }"
  >
    <span
      class="thumb grid h-[2.625rem] w-[2.625rem] flex-none place-items-center rounded-[10px] text-xl"
      aria-hidden="true"
      ><CardArt :card="card" img-class="h-full w-full"
    /></span>
    <span class="min-w-0">
      <b
        class="font-outfit dark:text-ink block truncate text-sm leading-tight font-semibold text-[var(--color-text)]"
        >{{ cardName(card) }}</b
      >
      <small
        v-if="caption"
        class="block truncate text-xs"
        :class="
          accent
            ? 'font-outfit text-primary-500 dark:text-accent-lift font-semibold'
            : 'dark:text-ink-faint text-[var(--color-text-muted)]'
        "
        >{{ caption }}</small
      >
    </span>
  </button>
</template>

<style scoped>
.mini {
  box-shadow: var(--card-shadow);
}

.thumb {
  background: color-mix(in srgb, var(--cat) 14%, transparent);
}

html.dark .thumb {
  background: color-mix(in srgb, var(--cat) 24%, transparent);
}

.mini.is-muted {
  border-style: dashed;
  box-shadow: none;
}

.mini.is-muted .thumb {
  filter: grayscale(1);
}
</style>
