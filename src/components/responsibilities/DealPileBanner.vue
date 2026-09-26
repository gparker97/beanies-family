<script setup lang="ts">
/**
 * Who Owns What (#109, round 7): what the deal pile says about a card that is already
 * decided, and the changes it offers (Requirement 6). Presentational: it emits intents and
 * `DealPile` runs them through `useDealActions`, so every change gets the one undo toast.
 *
 *  - held: "With Sofia since Sep 12" (one line per part on a split card, each starting with
 *    its part caption). An unsplit card offers Give it to someone else (when there is
 *    someone), Skip instead and Split it; a split card offers Split it (the edit drawer is
 *    the per-part change) and Skip instead.
 *  - waiting: "Waiting for a holder"; the faces follow below it, in `DealPile`. A split
 *    card with some parts already held lists those parts first, as on a held card.
 *  - skipped: "Skipped" with Bring back.
 */
import { computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useResponsibilityCardLabel } from '@/composables/useResponsibilityCardLabel';
import { fillTemplate } from '@/utils/fillTemplate';
import type { ResolvedCard } from '@/utils/responsibilityDeck';
import MemberChip from '@/components/ui/MemberChip.vue';
import DeckActionButton from './DeckActionButton.vue';

const props = withDefaults(
  defineProps<{
    card: ResolvedCard;
    view: 'held' | 'waiting' | 'skipped';
    /** Someone other than the holder exists to give the card to. */
    canGive?: boolean;
    disabled?: boolean;
  }>(),
  { canGive: false, disabled: false }
);
const emit = defineEmits<{ give: []; 'skip-instead': []; split: []; 'bring-back': [] }>();

const { t } = useTranslation();
const { heldSince, partCaption } = useResponsibilityCardLabel();

const isSplit = computed(() => props.card.splitMode !== 'single');

const lines = computed(() =>
  props.card.parts.flatMap((part) => {
    const held = heldSince(props.card, part);
    if (!held || !part.holderId) return [];
    return [
      {
        key: part.key,
        memberId: part.holderId,
        caption: isSplit.value ? partCaption(props.card, part) : '',
        text: held.date ? fillTemplate(t('whoOwnsWhat.pile.withSince'), held) : held.name,
      },
    ];
  })
);
</script>

<template>
  <div class="flex w-full flex-col gap-2.5" data-testid="deal-pile-banner">
    <div
      class="banner dark:border-line dark:text-ink flex flex-col gap-1.5 rounded-2xl border px-3 py-2.5 text-sm text-[var(--color-text)]"
    >
      <template v-if="view === 'held' || view === 'waiting'">
        <p v-for="line in lines" :key="line.key" class="flex items-center gap-2.5">
          <MemberChip :member-id="line.memberId" size="dot" />
          <span class="min-w-0">
            <b v-if="line.caption" class="font-outfit font-semibold">{{ line.caption }} · </b>
            {{ line.text }}
          </span>
        </p>
        <p v-if="view === 'waiting'" class="font-outfit font-semibold">
          {{ t('whoOwnsWhat.pile.waitingBanner') }}
        </p>
      </template>
      <p v-else class="font-outfit font-semibold">
        <span aria-hidden="true">⏭️</span> {{ t('whoOwnsWhat.pile.skipped') }}
      </p>
    </div>

    <template v-if="view === 'held'">
      <DeckActionButton
        v-if="!isSplit && canGive"
        variant="choice"
        class="w-full"
        :disabled="disabled"
        data-testid="deal-banner-give"
        @click="emit('give')"
      >
        {{ t('whoOwnsWhat.pile.giveToSomeoneElse') }}
      </DeckActionButton>
      <div class="grid grid-cols-2 gap-2.5">
        <DeckActionButton
          variant="choice"
          :disabled="disabled"
          data-testid="deal-banner-skip-instead"
          @click="emit('skip-instead')"
        >
          {{ t('whoOwnsWhat.pile.skipInstead') }}
        </DeckActionButton>
        <DeckActionButton
          variant="choice"
          :disabled="disabled"
          data-testid="deal-banner-split"
          @click="emit('split')"
        >
          <span aria-hidden="true">✂️</span> {{ t('whoOwnsWhat.pile.split') }}
        </DeckActionButton>
      </div>
    </template>

    <DeckActionButton
      v-else-if="view === 'skipped'"
      variant="choice"
      class="w-full"
      :disabled="disabled"
      data-testid="deal-banner-bring-back"
      @click="emit('bring-back')"
    >
      <span aria-hidden="true">↩</span> {{ t('whoOwnsWhat.deck.bringBack') }}
    </DeckActionButton>
  </div>
</template>

<style scoped>
.banner {
  background: var(--tint-silk-20);
  border-color: var(--tint-silk-30);
}

html.dark .banner {
  background: var(--color-surface-raised);
  border-color: var(--color-line);
}
</style>
