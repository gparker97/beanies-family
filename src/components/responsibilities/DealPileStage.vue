<script setup lang="ts">
/**
 * Who Owns What (#109, round 7): the deal pile's stage. The back arrow, the pile (two card
 * backs with the live card on top) and the forward arrow. Presentational: `DealPile` owns
 * the cursor and the flights, and reads `cardEl` (exposed) as the flight's source.
 *
 * The card is about 300px wide at md+ and 196px on a phone; the arrows are 48px / 40px
 * squircles with translated aria-labels.
 *
 * Also the Card Details drawer's "card in hand" (`size="hand"`, `testid="card-view"`): 15rem
 * at md+, and the card grows with its content instead of clipping it (a long custom done
 * line, a split card's holder lines in the default slot, under the category chip). The pile
 * passes nothing new: fixed 5:7, `deal-pile-*` test ids, arrows on.
 */
import { computed, nextTick, useTemplateRef, watch } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useListCategoryLabel } from '@/composables/useListCategoryLabel';
import { useResponsibilityCardLabel } from '@/composables/useResponsibilityCardLabel';
import { categoryTint, getListCategory } from '@/constants/listCategories';
import type { ResolvedCard } from '@/utils/responsibilityDeck';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import CardArt from '@/components/responsibilities/CardArt.vue';
import CardBack from '@/components/responsibilities/CardBack.vue';

const props = withDefaults(
  defineProps<{
    card: ResolvedCard;
    /** Hidden after its flight so it can't flash back before the next card replaces it. */
    leaving?: boolean;
    canPrev: boolean;
    canNext: boolean;
    /** `pile`: the deal pile. `hand`: the Card Details drawer (smaller, grows with content). */
    size?: 'pile' | 'hand';
    /** Test id prefix: `${testid}-card-<id>`, `${testid}-prev` / `-next`, `${testid}-name`. */
    testid?: string;
    arrows?: boolean;
  }>(),
  { leaving: false, size: 'pile', testid: 'deal-pile', arrows: true }
);
const emit = defineEmits<{ step: [dir: -1 | 1] }>();

const { t } = useTranslation();
const { categoryLabel } = useListCategoryLabel();
const { cardName, cardDone } = useResponsibilityCardLabel();

const tint = computed(() => categoryTint(props.card.category));
const isHand = computed(() => props.size === 'hand');
/** A category from a newer client reads "Other", never its raw id. */
const categoryText = computed(() =>
  getListCategory(props.card.category)
    ? categoryLabel(props.card.category)
    : t('lists.category.other')
);

const cardEl = useTemplateRef<HTMLElement>('cardEl');
defineExpose({ cardEl });

// Stepping to an end disables the arrow just pressed; a disabled button drops focus to the
// page (out of a drawer, for a screen reader and the next Tab). Hand it to the other arrow,
// or to the card when both are off (the pile while busy, a list that shrank to one).
const prevEl = useTemplateRef<HTMLButtonElement>('prevEl');
const nextEl = useTemplateRef<HTMLButtonElement>('nextEl');
function keepFocus(
  can: () => boolean,
  self: () => HTMLButtonElement | null,
  other: () => HTMLButtonElement | null
): void {
  watch(
    can,
    (enabled) => {
      if (enabled || document.activeElement !== self()) return;
      void nextTick(() => {
        const next = other();
        if (next && !next.disabled) next.focus();
        else cardEl.value?.focus({ preventScroll: true });
      });
    },
    { flush: 'pre' }
  );
}
keepFocus(
  () => props.canPrev,
  () => prevEl.value,
  () => nextEl.value
);
keepFocus(
  () => props.canNext,
  () => nextEl.value,
  () => prevEl.value
);
</script>

<template>
  <div class="flex items-center justify-center gap-2.5 md:gap-7">
    <button
      v-if="arrows"
      ref="prevEl"
      type="button"
      class="arrow"
      :disabled="!canPrev"
      :aria-label="t('whoOwnsWhat.pile.prev')"
      aria-keyshortcuts="ArrowLeft"
      :data-testid="`${testid}-prev`"
      @click="emit('step', -1)"
    >
      <BeanieIcon name="chevron-left" size="md" />
    </button>
    <div class="pile relative shrink-0" :class="{ 'is-hand': isHand }">
      <CardBack class="back back-2" />
      <CardBack class="back back-1" />
      <article
        ref="cardEl"
        :key="card.id"
        tabindex="-1"
        class="pile-card dark:bg-surface-raised dark:border-line-strong flex flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-white outline-none"
        :class="[isHand ? 'relative' : 'absolute inset-0', { 'is-leaving': leaving }]"
        :style="{ '--cat': tint }"
        :data-testid="`${testid}-card-${card.id}`"
      >
        <div class="slab relative grid place-items-center overflow-hidden">
          <CardArt
            :card="card"
            :img-class="isHand ? 'h-24 w-24 md:h-28 md:w-28' : 'h-24 w-24 md:h-36 md:w-36'"
            class="text-6xl leading-none"
            :class="{ 'md:text-7xl': !isHand }"
          />
          <span
            class="pointer-events-none absolute -right-1.5 -bottom-3.5 text-6xl leading-none opacity-[0.07] md:text-7xl"
            aria-hidden="true"
            >{{ card.emoji }}</span
          >
        </div>
        <div class="flex flex-1 flex-col gap-1 p-3" :class="{ 'md:gap-1.5 md:p-4': !isHand }">
          <p
            class="font-outfit dark:text-ink text-lg leading-tight font-semibold text-[var(--color-text)]"
            :class="{ 'md:text-xl': !isHand }"
            :data-testid="`${testid}-name`"
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
            <i class="h-2 w-2 rounded-full" :style="{ background: tint }" />{{ categoryText }}
          </span>
          <slot />
        </div>
      </article>
    </div>
    <button
      v-if="arrows"
      ref="nextEl"
      type="button"
      class="arrow"
      :disabled="!canNext"
      :aria-label="t('whoOwnsWhat.pile.next')"
      aria-keyshortcuts="ArrowRight"
      :data-testid="`${testid}-next`"
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

.back {
  inset: 0;
  position: absolute;
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

/* The card in hand grows with its content: a grid item in flow at least 5:7 tall, with a
   fixed-height slab (a percentage of a content-sized card would hug the art or push the
   text under the clip). */
.pile.is-hand {
  aspect-ratio: auto;
  display: grid;
  min-height: 17.15rem;
}

.pile.is-hand .slab {
  flex: none;
  height: 7.2rem;
}

@media (width >= 48rem) {
  .pile.is-hand {
    min-height: 21rem;
    width: 15rem;
  }

  .pile.is-hand .slab {
    height: 8.8rem;
  }
}
</style>
