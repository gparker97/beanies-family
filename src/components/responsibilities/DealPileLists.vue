<script setup lang="ts">
/**
 * Who Owns What (#109, round 7): the two quiet lists under the deal pile (Requirement 7).
 * **Kept** (held and waiting, with who has it) and **Skipped** (with Bring back), newest
 * change first, from the whole deck in the store (`keptAndSkipped`), so they are right
 * after a reload or a change on another device.
 *
 * Each list shows its first 6 (3 on a phone) and expands in place (ADR-025). Clicking a row
 * asks the pile to jump to that card (`jump`); Bring back is its own button beside the row
 * (never nested inside it) and goes straight through `useDealActions`, as on the Deck.
 *
 * The Skipped heading is the skip flight's landing spot, so it is exposed to `DealPile`.
 */
import { computed, useTemplateRef } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { useExpandableList } from '@/composables/useExpandableList';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { useResponsibilityCardLabel } from '@/composables/useResponsibilityCardLabel';
import { useResponsibilityStore } from '@/stores/responsibilityStore';
import { getListCategory } from '@/constants/listCategories';
import { logEvent } from '@/services/telemetry/logEvent';
import { fillTemplate } from '@/utils/fillTemplate';
import { keptAndSkipped, type ResolvedCard } from '@/utils/responsibilityDeck';
import MemberChip from '@/components/ui/MemberChip.vue';
import ShowMoreToggle from '@/components/ui/ShowMoreToggle.vue';
import { useDealActions } from './useDealActions';

const props = withDefaults(defineProps<{ currentId?: string | null; disabled?: boolean }>(), {
  currentId: null,
  disabled: false,
});
const emit = defineEmits<{ jump: [cardId: string] }>();

const FALLBACK_TINT = '#94A3B8';

const { t } = useTranslation();
const store = useResponsibilityStore();
const { isMobile } = useBreakpoint();
const { getMemberById } = useMemberInfo();
const { cardName, cardEmoji } = useResponsibilityCardLabel();
const { bringBack } = useDealActions();

const lists = computed(() => keptAndSkipped(store.resolved));
const initial = isMobile.value ? 3 : 6;
const kept = useExpandableList(() => lists.value.kept, { initial });
const skipped = useExpandableList(() => lists.value.skipped, { initial });

const skippedHeadingEl = useTemplateRef<HTMLElement>('skippedHeadingEl');
defineExpose({ skippedHeadingEl });

function tint(card: ResolvedCard): string {
  return getListCategory(card.category)?.color ?? FALLBACK_TINT;
}

/** Who has it: the holder's face and name, "Split by …", or "Nobody yet". */
function owner(card: ResolvedCard): { memberId?: string; label: string } {
  if (card.splitMode === 'child') return { label: t('whoOwnsWhat.card.splitChild') };
  if (card.splitMode === 'label') return { label: t('whoOwnsWhat.card.splitLabel') };
  const member = getMemberById(card.parts[0]?.holderId);
  return member
    ? { memberId: member.id, label: member.name }
    : { label: t('whoOwnsWhat.deck.nobody') };
}

function showAll(which: 'kept' | 'skipped'): void {
  (which === 'kept' ? kept : skipped).showMore();
  logEvent({
    level: 'info',
    surface: 'responsibilities',
    message: 'pile_lists_show_all',
    context: { detail: which },
  });
}

function onBringBack(cardId: string): void {
  if (!props.disabled) void bringBack(cardId);
}

function jump(cardId: string): void {
  if (!props.disabled) emit('jump', cardId);
}
</script>

<template>
  <div
    class="dark:border-line grid w-full gap-4 border-t border-[var(--color-border)] pt-4 md:grid-cols-2 md:gap-7"
    data-testid="deal-lists"
  >
    <!-- Kept -->
    <section>
      <h3 class="font-outfit dark:text-ink mb-2 text-base font-bold text-[var(--color-text)]">
        {{ t('whoOwnsWhat.pile.listKept') }}
        <small
          class="dark:text-ink-faint ml-1 text-sm font-semibold text-[var(--color-text-muted)]"
          >{{ kept.total.value }}</small
        >
      </h3>
      <ul class="flex flex-col gap-1">
        <li v-for="card in kept.visible.value" :key="card.id">
          <button
            type="button"
            class="row dark:text-ink flex w-full items-center gap-2.5 rounded-xl px-1.5 py-1 text-left text-sm text-[var(--color-text)]"
            :class="{ 'is-current': card.id === currentId }"
            :aria-current="card.id === currentId ? 'true' : undefined"
            :disabled="disabled"
            :style="{ '--cat': tint(card) }"
            :data-testid="`deal-list-kept-${card.id}`"
            @click="jump(card.id)"
          >
            <span class="thumb" aria-hidden="true">{{ cardEmoji(card) }}</span>
            <span class="min-w-0 flex-1 truncate">{{ cardName(card) }}</span>
            <span
              class="font-outfit dark:text-ink-soft inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-[var(--color-text-muted)]"
            >
              <MemberChip
                v-if="owner(card).memberId"
                :member-id="owner(card).memberId!"
                size="dot"
              />
              {{ owner(card).label }}
            </span>
          </button>
        </li>
      </ul>
      <ShowMoreToggle
        :can-show-more="kept.canShowMore.value"
        :more-label="fillTemplate(t('action.showAllN'), { count: kept.total.value })"
        @show-more="showAll('kept')"
      />
    </section>

    <!-- Skipped -->
    <section>
      <h3
        ref="skippedHeadingEl"
        class="font-outfit dark:text-ink mb-2 text-base font-bold text-[var(--color-text)]"
        data-testid="deal-lists-skipped-heading"
      >
        {{ t('whoOwnsWhat.pile.skipped') }}
        <small
          class="dark:text-ink-faint ml-1 text-sm font-semibold text-[var(--color-text-muted)]"
          >{{ skipped.total.value }}</small
        >
      </h3>
      <ul class="flex flex-col gap-1">
        <li v-for="card in skipped.visible.value" :key="card.id" class="flex items-center gap-2">
          <button
            type="button"
            class="row dark:text-ink-soft flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1.5 py-1 text-left text-sm text-[var(--color-text-muted)]"
            :class="{ 'is-current': card.id === currentId }"
            :aria-current="card.id === currentId ? 'true' : undefined"
            :disabled="disabled"
            :style="{ '--cat': tint(card) }"
            :data-testid="`deal-list-skipped-${card.id}`"
            @click="jump(card.id)"
          >
            <span class="thumb" aria-hidden="true">{{ cardEmoji(card) }}</span>
            <span class="min-w-0 flex-1 truncate">{{ cardName(card) }}</span>
          </button>
          <button
            type="button"
            class="font-outfit text-primary-500 dark:text-accent-lift shrink-0 rounded-lg px-1.5 py-1 text-xs font-bold whitespace-nowrap"
            :disabled="disabled"
            :data-testid="`deal-list-bring-back-${card.id}`"
            @click="onBringBack(card.id)"
          >
            <span aria-hidden="true">↩</span> {{ t('whoOwnsWhat.deck.bringBack') }}
          </button>
        </li>
      </ul>
      <ShowMoreToggle
        :can-show-more="skipped.canShowMore.value"
        :more-label="fillTemplate(t('action.showAllN'), { count: skipped.total.value })"
        @show-more="showAll('skipped')"
      />
    </section>
  </div>
</template>

<style scoped>
.thumb {
  background: color-mix(in srgb, var(--cat) 14%, transparent);
  border-radius: 0.5625rem;
  display: grid;
  flex: none;
  font-size: 1rem;
  height: 1.875rem;
  place-items: center;
  width: 1.875rem;
}

html.dark .thumb {
  background: color-mix(in srgb, var(--cat) 22%, transparent);
}

.row {
  background: transparent;
}

.row:disabled {
  cursor: default;
}

@media (hover: hover) {
  .row:hover:not(:disabled) {
    background: var(--tint-slate-5);
  }

  html.dark .row:hover:not(:disabled) {
    background: var(--color-surface-hover);
  }
}

.row:focus-visible {
  outline: 2px solid #aed6f1;
  outline-offset: 2px;
}

.row.is-current {
  background: var(--tint-orange-8);
  outline: 1.5px solid #f15d22;
  outline-offset: 2px;
}

html.dark .row.is-current {
  background: var(--tint-orange-8);
  outline-color: var(--color-accent-lift);
}
</style>
