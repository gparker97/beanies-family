<script setup lang="ts">
/**
 * Who Owns What (#109, round 7): the deal pile's stage. The back arrow, the pile (two card
 * backs with the live card on top) and the forward arrow. Presentational: `DealPile` owns
 * the cursor and the flights, and reads `cardEl` (exposed) as the flight's source.
 *
 * The card is about 300px wide at md+ and 196px on a phone; the arrows are 48px / 40px
 * squircles with translated aria-labels.
 */
import { computed, useTemplateRef } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useListCategoryLabel } from '@/composables/useListCategoryLabel';
import { useResponsibilityCardLabel } from '@/composables/useResponsibilityCardLabel';
import { categoryTint } from '@/constants/listCategories';
import type { ResolvedCard } from '@/utils/responsibilityDeck';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';

const props = defineProps<{
  card: ResolvedCard;
  /** Hidden after its flight so it can't flash back before the next card replaces it. */
  leaving: boolean;
  canPrev: boolean;
  canNext: boolean;
}>();
const emit = defineEmits<{ step: [dir: -1 | 1] }>();

const { t } = useTranslation();
const { categoryLabel } = useListCategoryLabel();
const { cardName, cardDone, cardEmoji } = useResponsibilityCardLabel();

const tint = computed(() => categoryTint(props.card.category));

const cardEl = useTemplateRef<HTMLElement>('cardEl');
defineExpose({ cardEl });
</script>

<template>
  <div class="flex items-center justify-center gap-2.5 md:gap-7">
    <button
      type="button"
      class="arrow"
      :disabled="!canPrev"
      :aria-label="t('whoOwnsWhat.pile.prev')"
      aria-keyshortcuts="ArrowLeft"
      data-testid="deal-pile-prev"
      @click="emit('step', -1)"
    >
      <BeanieIcon name="chevron-left" size="md" />
    </button>
    <div class="pile relative shrink-0">
      <div class="card-back back-2" aria-hidden="true">
        <img src="/brand/beanies_logo_transparent_logo_only_192x192.png" alt="" />
      </div>
      <div class="card-back back-1" aria-hidden="true">
        <img src="/brand/beanies_logo_transparent_logo_only_192x192.png" alt="" />
      </div>
      <article
        ref="cardEl"
        :key="card.id"
        class="pile-card dark:bg-surface-raised dark:border-line-strong absolute inset-0 flex flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white"
        :class="{ 'is-leaving': leaving }"
        :style="{ '--cat': tint }"
        :data-testid="`deal-pile-card-${card.id}`"
      >
        <div class="slab relative grid place-items-center overflow-hidden">
          <span class="text-6xl leading-none md:text-7xl" aria-hidden="true">{{
            cardEmoji(card)
          }}</span>
          <span
            class="pointer-events-none absolute -right-1.5 -bottom-3.5 text-6xl leading-none opacity-[0.07] md:text-7xl"
            aria-hidden="true"
            >{{ cardEmoji(card) }}</span
          >
        </div>
        <div class="flex flex-1 flex-col gap-1 p-3 md:gap-1.5 md:p-4">
          <p
            class="font-outfit dark:text-ink text-lg leading-tight font-semibold text-[var(--color-text)] md:text-xl"
          >
            {{ cardName(card) }}
          </p>
          <p
            v-if="cardDone(card)"
            class="dark:text-ink-faint text-sm leading-snug text-[var(--color-text-muted)]"
          >
            {{ cardDone(card) }}
          </p>
          <span
            class="cat-chip font-outfit dark:text-ink-soft mt-auto inline-flex items-center gap-1.5 self-start rounded-full px-2 py-0.5 text-xs font-semibold text-[var(--color-text)]"
          >
            <i class="h-2 w-2 rounded-full" :style="{ background: tint }" />{{
              categoryLabel(card.category)
            }}
          </span>
        </div>
      </article>
    </div>
    <button
      type="button"
      class="arrow"
      :disabled="!canNext"
      :aria-label="t('whoOwnsWhat.pile.next')"
      aria-keyshortcuts="ArrowRight"
      data-testid="deal-pile-next"
      @click="emit('step', 1)"
    >
      <BeanieIcon name="chevron-right" size="md" />
    </button>
  </div>
</template>

<style scoped>
.pile {
  aspect-ratio: 5 / 7;
  width: 12.25rem;
}

@media (width >= 48rem) {
  .pile {
    width: 18.75rem;
  }
}

.arrow {
  background: #fff;
  border: 1.5px solid var(--color-border-strong);
  border-radius: 0.875rem;
  color: var(--color-text);
  display: grid;
  flex: none;
  height: 2.5rem;
  place-items: center center;
  width: 2.5rem;
}

@media (width >= 48rem) {
  .arrow {
    border-radius: 1rem;
    height: 3rem;
    width: 3rem;
  }
}

.arrow:disabled {
  cursor: default;
  opacity: 0.4;
}

.arrow:focus-visible {
  outline: 2px solid #aed6f1;
  outline-offset: 2px;
}

html.dark .arrow {
  background: var(--color-surface-raised);
  color: var(--color-ink);
}

@media (hover: hover) {
  .arrow:hover:not(:disabled) {
    background: var(--tint-slate-5);
  }

  html.dark .arrow:hover:not(:disabled) {
    background: var(--color-surface-hover);
  }
}

.card-back {
  background: linear-gradient(155deg, #f15d22, #e67e22);
  border: 4px solid #fff;
  border-radius: 1rem;
  box-shadow: var(--card-shadow);
  display: grid;
  inset: 0;
  place-items: center;
  position: absolute;
}

html.dark .card-back {
  border-color: var(--color-surface-raised);
}

.card-back img {
  opacity: 0.9;
  width: 35%;
}

.back-1 {
  transform: rotate(5deg) translate(0.625rem, 0.25rem);
}

.back-2 {
  transform: rotate(-4deg) translate(-0.5625rem, 0.375rem);
}

.pile-card {
  animation: pile-enter 280ms ease-out;
  box-shadow: var(--card-hover-shadow);
  transform: rotate(-1.5deg);
}

/* After its flight the card stays hidden until the next one replaces it. The flight's own
   keyframes set opacity, so this has no effect while it is in the air. */
.pile-card.is-leaving {
  opacity: 0;
}

@keyframes pile-enter {
  from {
    opacity: 0.5;
    transform: rotate(5deg) translate(0.625rem, 0.5rem);
  }

  to {
    opacity: 1;
    transform: rotate(-1.5deg);
  }
}

.slab {
  background: color-mix(in srgb, var(--cat) 12%, transparent);
  flex: 0 0 42%;
}

html.dark .slab {
  background: color-mix(in srgb, var(--cat) 18%, transparent);
}

.cat-chip {
  background: color-mix(in srgb, var(--cat) 12%, transparent);
}

html.dark .cat-chip {
  background: color-mix(in srgb, var(--cat) 22%, transparent);
}
</style>
