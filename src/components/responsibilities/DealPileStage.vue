<script setup lang="ts">
/**
 * Who Owns What (#109, round 7): the deal pile's stage. The back arrow, the pile (two card
 * backs with the live card on top) and the forward arrow. Presentational: `DealPile` owns
 * the cursor and the flights, and reads `cardEl` (exposed) as the flight's source.
 *
 * On the pile the card is the page's hero, up to 18.75rem wide. Its geometry lives in two
 * custom properties on `.stage` (see the style block), so the pile's width, the art band's
 * share and the phone arrows' height cannot drift apart. Widths come from the stage's own
 * box, never the viewport, so Large reading mode never scrolls sideways. The arrows are
 * 2.5rem / 3rem squircles with translated aria-labels; below 48rem they overlap the pile's
 * edges in flow, and a disabled one stays opaque with a muted icon (they are also disabled
 * while busy, so hiding them would flicker).
 *
 * The stage also owns the **swipe** (touch and pen only, `useHorizontalSwipe` on the stable
 * root, since only the card is keyed): left steps forward, right steps back, whenever the
 * arrows are on and exactly when the matching arrow could (`canPrev` / `canNext`). It emits
 * `step(dir, via)` so a host can tell swipes from arrows in its telemetry.
 *
 * With `count` set (the pile, while the card is counted), the category chip reads
 * "{category} · n of total" below 48rem, where the pile hides its position line.
 *
 * Also the Card Details drawer's "card in hand" (`size="hand"`, `testid="card-view"`):
 * 12.25rem on a phone and 15rem at md+, and the card grows with its content instead of
 * clipping it (a long custom done line, a split card's holder lines in the default slot,
 * under the category chip). Swipe works there the same way.
 */
import { computed, nextTick, useTemplateRef, watch } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useHorizontalSwipe } from '@/composables/useHorizontalSwipe';
import { useListCategoryLabel } from '@/composables/useListCategoryLabel';
import { useResponsibilityCardLabel } from '@/composables/useResponsibilityCardLabel';
import { categoryTint } from '@/constants/listCategories';
import { fillTemplate } from '@/utils/fillTemplate';
import type { ResolvedCard } from '@/utils/responsibilityDeck';
import BeanieIcon from '@/components/ui/BeanieIcon.vue';
import CardArt from '@/components/responsibilities/CardArt.vue';
import CardBack from '@/components/responsibilities/CardBack.vue';

/** How a step was asked for: an arrow (click or tap) or a swipe on the stage. */
export type StageStepVia = 'arrow' | 'swipe';

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
    /** The card's place in the pile, shown on the chip below 48rem; null when not counted. */
    count?: { n: number; total: number } | null;
  }>(),
  { leaving: false, size: 'pile', testid: 'deal-pile', arrows: true, count: null }
);

const emit = defineEmits<{ step: [dir: -1 | 1, via: StageStepVia] }>();

const { t } = useTranslation();
const { categoryLabelOrOther } = useListCategoryLabel();
const { cardName, cardDone } = useResponsibilityCardLabel();

const tint = computed(() => categoryTint(props.card.category));
const isHand = computed(() => props.size === 'hand');
const categoryText = computed(() => categoryLabelOrOther(props.card.category));

const cardEl = useTemplateRef<HTMLElement>('cardEl');
defineExpose({ cardEl });

const chipCount = computed(() =>
  props.count
    ? fillTemplate(t('whoOwnsWhat.pile.positionChip'), {
        category: categoryText.value,
        n: props.count.n,
        total: props.count.total,
      })
    : ''
);

// Swipe on the stable root (the card is keyed per card). Touch and pen only: a mouse drag
// on a desktop selects text. The same guards as the arrows.
const rootEl = useTemplateRef<HTMLElement>('rootEl');
useHorizontalSwipe(rootEl, {
  onSwipeLeft: () => {
    if (props.canNext) emit('step', 1, 'swipe');
  },
  onSwipeRight: () => {
    if (props.canPrev) emit('step', -1, 'swipe');
  },
  enabled: computed(() => props.arrows),
  ignoreMouse: true,
});

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
  <div ref="rootEl" class="stage flex items-center justify-center" :class="`is-${size}`">
    <button
      v-if="arrows"
      ref="prevEl"
      type="button"
      class="arrow"
      :disabled="!canPrev"
      :aria-label="t('whoOwnsWhat.pile.prev')"
      aria-keyshortcuts="ArrowLeft"
      :data-testid="`${testid}-prev`"
      @click="emit('step', -1, 'arrow')"
    >
      <BeanieIcon name="chevron-left" size="md" />
    </button>
    <div class="pile relative shrink-0">
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
            :img-class="isHand ? 'h-24 w-24 md:h-28 md:w-28' : 'pile-art'"
            class="leading-none"
            :class="isHand ? 'text-6xl' : 'text-7xl'"
          />
          <span
            class="pointer-events-none absolute -right-1.5 -bottom-3.5 text-6xl leading-none opacity-[0.07] md:text-7xl"
            aria-hidden="true"
            >{{ card.emoji }}</span
          >
        </div>
        <div class="flex flex-1 flex-col" :class="isHand ? 'gap-1 p-3' : 'gap-1.5 p-4'">
          <p
            class="font-outfit dark:text-ink leading-tight font-semibold text-[var(--color-text)]"
            :class="isHand ? 'text-lg' : 'text-xl'"
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
            <i class="h-2 w-2 shrink-0 rounded-full" :style="{ background: tint }" />
            <template v-if="count">
              <span class="md:hidden" :data-testid="`${testid}-position-chip`">{{
                chipCount
              }}</span>
              <span class="hidden md:inline">{{ categoryText }}</span>
            </template>
            <template v-else>{{ categoryText }}</template>
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
      @click="emit('step', 1, 'arrow')"
    >
      <BeanieIcon name="chevron-right" size="md" />
    </button>
  </div>
</template>

<style scoped>
/* The pile's geometry, in one place:
   --pile-w  the pile's width. `100%` is substituted where it is used: the pile's width and
             the phone arrows' margin-top both resolve it against the stage's width, so they
             agree at every width. Phones: the pile leaves 1.25rem each side for half an
             overlapping arrow. md+: two 3rem arrows and two 1.75rem gaps (9.5rem) beside it.
   --slab    the art band's share of the card's height.
   The hand (the Card Details drawer) sets its own sizes below.
   Swipe target: vertical scroll and pinch-zoom stay with the browser, horizontal is ours. */
.stage {
  --pile-w: min(18.75rem, 100% - 2.5rem);
  --slab: 0.42;

  gap: 0.625rem;
  touch-action: pan-y pinch-zoom;
  width: 100%;
}

/* A size container, so the pile's art can size from the pile itself (`cqi`): a `100%` in
   `--pile-w` would resolve against the art's own box there. */
.pile {
  aspect-ratio: 5 / 7;
  container-type: inline-size;
  width: var(--pile-w);
}

/* About half the pile's width (9rem at full size), always under the art band's height
   (1.4 x --slab = 0.588 of the pile's width), so the art never clips at any width or
   text size. The hand keeps its own fixed art sizes. */
.pile-art {
  height: 9rem;
  width: 9rem;
}

/* WKWebView before iOS 16 has no container units (the app still targets iOS 15), so the
   plain 9rem above is the fallback and the pile-relative size applies where supported. */
@supports (width: 1cqi) {
  .pile-art {
    height: min(9rem, 48cqi);
    width: min(9rem, 48cqi);
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
  .stage {
    --pile-w: min(18.75rem, 100% - 9.5rem);

    gap: 1.75rem;
  }

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

/* Phones, the pile only: the arrows overlap the pile's edges in flow (half on the card,
   half in the 1.25rem the pile's width leaves each side), above the card. A disabled one
   stays opaque over the card with a muted icon. `--card-shadow` carries its own dark value and `line-strong` reads in both
   carry their own dark values. */
@media (width < 48rem) {
  .is-pile {
    gap: 0;
  }

  /* Centred on the card's art band (the card is 7/5 as tall as wide, the band its top
     --slab), so an arrow never sits on the title or description. */
  .is-pile .arrow {
    align-self: flex-start;
    box-shadow: var(--card-shadow);
    margin-inline: -1.25rem;
    margin-top: calc(var(--pile-w) * 1.4 * var(--slab) / 2 - 1.25rem);
    position: relative;
    z-index: 1;
  }

  /* `line-strong` has one value that reads on both the white and the dark arrow (checked
     in both modes), so this one rule serves both. */
  .is-pile .arrow:disabled {
    color: var(--color-line-strong);
    opacity: 1;
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
  flex: 0 0 calc(var(--slab) * 100%);
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
.is-hand .pile {
  aspect-ratio: auto;
  display: grid;
  min-height: 17.15rem;
  width: 12.25rem;
}

.is-hand .pile .slab {
  flex: none;
  height: 7.2rem;
}

@media (width >= 48rem) {
  .is-hand .pile {
    min-height: 21rem;
    width: 15rem;
  }

  .is-hand .pile .slab {
    height: 8.8rem;
  }
}
</style>
