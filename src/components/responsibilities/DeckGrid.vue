<script setup lang="ts">
/**
 * Who Owns What (#109): the Deck view. Category pills (all nine plus "Nobody Yet",
 * "Skipped · N" and "By Person") over shelves of portrait card tiles.
 *
 *  - All / a category: every card that isn't skipped, one shelf per category. Unsorted
 *    cards show too (so "Browse the deck first" has something to browse), marked
 *    "Not Sorted Yet".
 *  - Nobody Yet: kept cards with at least one part nobody holds.
 *  - Skipped: the skipped pile, with "Bring Back" for grown-ups (through
 *    `useDealActions`, so it gets the one deck undo toast).
 *  - By Person: `DeckByBean`.
 *
 * The filter is a `v-model` owned by the page, so the ⋯ menu and the Overview's "See the
 * skipped pile" can open this view already filtered.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useListCategoryLabel } from '@/composables/useListCategoryLabel';
import { getListCategory } from '@/constants/listCategories';
import { fillTemplate } from '@/utils/fillTemplate';
import { groupByCategory, type ResolvedCard } from '@/utils/responsibilityDeck';
import type { ListCategory } from '@/types/models';
import ListCategoryPills from '@/components/lists/ListCategoryPills.vue';
import ResponsibilityCardTile from './ResponsibilityCardTile.vue';
import DeckByBean from './DeckByBean.vue';
import { useDealActions } from './useDealActions';

export type DeckExtraFilter = 'nobody' | 'skipped' | 'byBean';
export type DeckFilter = ListCategory | DeckExtraFilter | null;

const props = withDefaults(
  defineProps<{
    cards: readonly ResolvedCard[];
    filter: DeckFilter;
    canEdit?: boolean;
    /** Hide the pill row (used where the caller has already chosen the cards). */
    showPills?: boolean;
  }>(),
  { canEdit: false, showPills: true }
);
const emit = defineEmits<{
  'update:filter': [value: DeckFilter];
  open: [cardId: string];
}>();

const { t } = useTranslation();
const { categoryLabel } = useListCategoryLabel();
const { bringBack } = useDealActions();

const skipped = computed(() => props.cards.filter((c) => c.status === 'skipped'));

const extras = computed<{ id: DeckExtraFilter; label: string; emoji: string }[]>(() => [
  { id: 'nobody', label: t('whoOwnsWhat.deck.nobody'), emoji: '🫥' },
  {
    id: 'skipped',
    label: fillTemplate(t('whoOwnsWhat.deck.skippedPill'), { count: skipped.value.length }),
    emoji: '⏭️',
  },
  { id: 'byBean', label: t('whoOwnsWhat.deck.byBean'), emoji: '👥' },
]);

interface Shelf {
  key: string;
  title: string;
  emoji: string;
  cards: ResolvedCard[];
}

/** The cards the current filter shows, before shelving. */
const visible = computed(() => {
  const f = props.filter;
  if (f === 'skipped') return skipped.value;
  if (f === 'nobody')
    return props.cards.filter((c) => c.status === 'waiting' && c.parts.some((p) => !p.holderId));
  const live = props.cards.filter((c) => c.status !== 'skipped');
  return f && f !== 'byBean' ? live.filter((c) => c.category === f) : live;
});

const shelves = computed<Shelf[]>(() =>
  groupByCategory(visible.value).map(({ category, cards }) => {
    const def = category ? getListCategory(category) : undefined;
    return category && def
      ? { key: category, title: categoryLabel(category), emoji: def.emoji, cards }
      : { key: '__other', title: t('lists.category.other'), emoji: '📁', cards };
  })
);

const emptyMessage = computed(() =>
  props.filter === 'skipped' ? t('whoOwnsWhat.deck.noSkipped') : t('whoOwnsWhat.deck.emptyFilter')
);

function onBringBack(cardId: string): void {
  void bringBack(cardId);
}
</script>

<template>
  <div class="space-y-5">
    <ListCategoryPills
      v-if="showPills"
      :model-value="filter"
      :extras="extras"
      tone="filter"
      show-all
      short
      @update:model-value="emit('update:filter', $event)"
    />

    <DeckByBean v-if="filter === 'byBean'" :cards="cards" @open="emit('open', $event)" />

    <template v-else>
      <!-- The skipped pile: a calm explainer above the cards. -->
      <div
        v-if="filter === 'skipped' && skipped.length"
        class="skipped-banner dark:border-line flex items-center gap-3 rounded-2xl border border-[var(--tint-silk-30)] px-4 py-3 text-sm"
      >
        <span class="text-lg" aria-hidden="true">🙅</span>
        <p class="dark:text-ink-soft text-[var(--color-text-muted)]">
          <strong class="font-outfit dark:text-ink text-[var(--color-text)]">{{
            fillTemplate(
              t(
                skipped.length === 1
                  ? 'whoOwnsWhat.deck.skippedBanner.one'
                  : 'whoOwnsWhat.deck.skippedBanner.other'
              ),
              { count: skipped.length }
            )
          }}</strong>
          {{ t('whoOwnsWhat.deck.skippedBannerBody') }}
        </p>
      </div>

      <p
        v-if="!visible.length"
        class="dark:text-ink-soft py-10 text-center text-sm text-[var(--color-text-muted)]"
        data-testid="deck-empty"
      >
        {{ emptyMessage }}
      </p>

      <section v-for="shelf in shelves" :key="shelf.key" :data-testid="`deck-shelf-${shelf.key}`">
        <h3
          class="font-outfit dark:text-ink-faint mb-2 text-xs font-semibold tracking-[0.08em] text-[var(--color-text-muted)] uppercase"
        >
          <span aria-hidden="true">{{ shelf.emoji }}</span> {{ shelf.title }} ({{
            shelf.cards.length
          }})
        </h3>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(9.25rem,1fr))]">
          <ResponsibilityCardTile
            v-for="card in shelf.cards"
            :key="card.id"
            :card="card"
            :can-edit="canEdit"
            @open="emit('open', $event)"
            @bring-back="onBringBack"
          />
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.skipped-banner {
  background: var(--tint-silk-10);
}

html.dark .skipped-banner {
  background: var(--color-surface-raised);
}
</style>
