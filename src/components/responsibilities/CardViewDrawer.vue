<script setup lang="ts">
/**
 * Who Owns What (#109): the card's view drawer (Requirement 12), the same view-first
 * pattern as activities and transactions. Shows only what is filled in: name and
 * category, who holds it (since when, and before that), split parts, the done line and
 * what beanies uses the card for.
 *
 * Footer for grown-ups: the delete tile (family-made cards) or the DISABLED tile with its
 * (i) reason (built-in cards, which are skipped rather than deleted), an outlined Edit,
 * and Close. Children get Close only: the drawer is view-only for them.
 *
 * If the card disappears while open (deleted or restored on another device) the drawer
 * says so and closes, rather than rendering an empty shell. A delete from this drawer's
 * own tile is not a surprise: it has its own success toast, so the notice is skipped.
 */
import { computed, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import ModalSecondaryButton from '@/components/ui/ModalSecondaryButton.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import MemberChip from '@/components/ui/MemberChip.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useListCategoryLabel } from '@/composables/useListCategoryLabel';
import { useResponsibilityCardLabel } from '@/composables/useResponsibilityCardLabel';
import { showToast } from '@/composables/useToast';
import { useResponsibilityStore } from '@/stores/responsibilityStore';
import { cardUsesFor } from '@/constants/responsibilityCards';
import { categoryTint, getListCategory } from '@/constants/listCategories';
import { getListTemplateByKey } from '@/constants/listTemplates';
import { SLOT_LABEL_KEYS } from '@/constants/mealSlots';
import { fillTemplate } from '@/utils/fillTemplate';
import { formatNookDate } from '@/utils/date';
import { ymdOf, type ResolvedPart } from '@/utils/responsibilityDeck';
import { useCardDeletion } from './useCardDeletion';

const props = withDefaults(
  defineProps<{
    open: boolean;
    cardId: string | null;
    /** Grown-ups can edit and delete; children view only. */
    canEdit?: boolean;
  }>(),
  { canEdit: false }
);
const emit = defineEmits<{ close: []; edit: [cardId: string] }>();

const { t } = useTranslation();
const store = useResponsibilityStore();
const { categoryLabel } = useListCategoryLabel();
const { cardName, cardDone, cardEmoji, partCaption } = useResponsibilityCardLabel();
const { confirmAndDeleteCard } = useCardDeletion();

const card = computed(() => (props.cardId ? store.cardById(props.cardId) : undefined));
const category = computed(() => (card.value ? getListCategory(card.value.category) : undefined));
const isKept = computed(() => card.value?.status === 'held' || card.value?.status === 'waiting');

const statusLabel = computed(() => {
  if (card.value?.status === 'skipped') return t('whoOwnsWhat.card.skipped');
  if (card.value?.status === 'unsorted') return t('whoOwnsWhat.card.unsorted');
  return '';
});

function since(part: ResolvedPart): string {
  return part.since
    ? fillTemplate(t('whoOwnsWhat.card.since'), { date: formatNookDate(ymdOf(part.since)) })
    : '';
}

/** "beanies uses this card for": one line per default target; hint targets collapse to one. */
const uses = computed(() => {
  if (!card.value || card.value.isCustom) return [];
  const lines: string[] = [];
  let hint = false;
  for (const target of cardUsesFor(card.value.id)) {
    if (target.kind === 'mealSlot') {
      lines.push(
        fillTemplate(t('whoOwnsWhat.details.useMeal'), {
          slot: t(SLOT_LABEL_KEYS[target.slot]).toLocaleLowerCase(),
        })
      );
    } else if (target.kind === 'listTemplate') {
      const tpl = getListTemplateByKey(target.key);
      if (tpl) lines.push(fillTemplate(t('whoOwnsWhat.details.useList'), { list: t(tpl.nameKey) }));
    } else if (!hint) {
      hint = true;
      lines.push(t('whoOwnsWhat.details.useHint'));
    }
  }
  return lines;
});

/**
 * True only while THIS drawer's confirmed delete is being written, so that disappearance
 * is expected. Not during the confirm itself: a card deleted elsewhere while the confirm
 * is up still gets the notice and the close below.
 */
let deleting = false;

async function onDelete(): Promise<void> {
  if (!card.value) return;
  let deleted = false;
  try {
    deleted = await confirmAndDeleteCard(card.value, { onConfirmed: () => (deleting = true) });
  } finally {
    deleting = false;
  }
  // Never leave an empty drawer: close on our delete, and also when the card is gone
  // however the delete ended (the store refused it because another device deleted it
  // first, and has said so).
  if (deleted || (props.open && !card.value)) emit('close');
}

watch(card, (next, prev) => {
  if (props.open && prev && !next && !deleting) {
    console.warn('[CardViewDrawer] card disappeared while the drawer was open:', prev.id);
    showToast('info', t('whoOwnsWhat.error.cardGone'), t('whoOwnsWhat.error.cardGoneHelp'));
    emit('close');
  }
});
</script>

<template>
  <BeanieFormModal
    :open="open && !!card"
    variant="drawer"
    :title="t('whoOwnsWhat.details.title')"
    :icon="card ? cardEmoji(card) : undefined"
    :save-label="t('action.close')"
    :show-delete="canEdit && !!card?.isCustom"
    :delete-disabled-reason="
      canEdit && card && !card.isCustom ? t('whoOwnsWhat.details.builtInDelete') : undefined
    "
    @close="emit('close')"
    @save="emit('close')"
    @delete="onDelete"
  >
    <template v-if="card">
      <div class="space-y-2">
        <p
          class="font-outfit dark:text-ink text-xl font-bold text-[var(--color-text)]"
          data-testid="card-view-name"
        >
          {{ cardName(card) }}
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <span
            class="font-outfit dark:bg-surface-overlay dark:text-ink inline-flex items-center gap-1.5 rounded-full bg-[var(--tint-slate-5)] px-3 py-1 text-xs font-semibold text-[var(--color-text)]"
          >
            <span
              class="h-2 w-2 rounded-full"
              :style="{ backgroundColor: categoryTint(card.category) }"
              aria-hidden="true"
            />
            {{ category ? categoryLabel(category.id) : t('lists.category.other') }}
          </span>
          <span
            v-if="statusLabel"
            class="font-outfit dark:bg-surface-overlay dark:text-ink-soft rounded-full bg-[var(--tint-slate-5)] px-3 py-1 text-xs font-semibold text-[var(--color-text-muted)]"
            >{{ statusLabel }}</span
          >
        </div>
      </div>

      <!-- One holder -->
      <div v-if="isKept && card.splitMode === 'single'" class="space-y-3">
        <FormFieldGroup :label="t('whoOwnsWhat.details.heldBy')">
          <div class="flex flex-wrap items-center gap-2">
            <template v-if="card.parts[0]?.holderId">
              <MemberChip :member-id="card.parts[0].holderId" size="md" />
              <span
                v-if="since(card.parts[0])"
                class="dark:text-ink-faint text-xs text-[var(--color-text-muted)]"
                >{{ since(card.parts[0]) }}</span
              >
            </template>
            <span v-else class="nobody-chip">{{ t('whoOwnsWhat.deck.nobody') }}</span>
          </div>
        </FormFieldGroup>
        <FormFieldGroup
          v-if="card.parts[0]?.previousHolderId"
          :label="t('whoOwnsWhat.details.beforeThat')"
        >
          <MemberChip :member-id="card.parts[0].previousHolderId" size="sm" />
        </FormFieldGroup>
      </div>

      <!-- Split parts -->
      <FormFieldGroup v-else-if="isKept" :label="t('whoOwnsWhat.details.parts')">
        <ul class="space-y-2">
          <li
            v-for="part in card.parts"
            :key="part.key"
            class="dark:bg-surface-overlay flex flex-wrap items-center gap-2 rounded-xl bg-white px-3 py-2"
          >
            <span
              class="font-outfit dark:text-ink-soft text-sm font-semibold text-[var(--color-text)]"
            >
              {{ partCaption(card, part) }}
            </span>
            <span class="ml-auto flex items-center gap-2">
              <template v-if="part.holderId">
                <MemberChip :member-id="part.holderId" size="sm" />
                <span
                  v-if="since(part)"
                  class="dark:text-ink-faint text-xs text-[var(--color-text-muted)]"
                >
                  {{ since(part) }}
                </span>
              </template>
              <span v-else class="nobody-chip">{{ t('whoOwnsWhat.deck.nobody') }}</span>
            </span>
          </li>
        </ul>
      </FormFieldGroup>

      <FormFieldGroup v-if="cardDone(card)" :label="t('whoOwnsWhat.details.done')">
        <p class="dark:text-ink text-sm text-[var(--color-text)]">{{ cardDone(card) }}</p>
      </FormFieldGroup>

      <FormFieldGroup v-if="uses.length" :label="t('whoOwnsWhat.details.usesFor')">
        <ul class="space-y-2">
          <li
            v-for="line in uses"
            :key="line"
            class="dark:bg-surface-overlay dark:text-ink-soft rounded-xl bg-[var(--tint-silk-10)] px-3 py-2 text-sm text-[var(--color-text)]"
          >
            {{ line }}
          </li>
        </ul>
      </FormFieldGroup>
    </template>

    <template #footer-start>
      <ModalSecondaryButton
        v-if="canEdit && card"
        data-testid="card-view-edit"
        @click="emit('edit', card.id)"
      >
        ✏️ {{ t('action.edit') }}
      </ModalSecondaryButton>
    </template>
  </BeanieFormModal>
</template>

<style scoped>
.nobody-chip {
  background: var(--tint-orange-8);
  border-radius: 9999px;
  color: var(--color-primary-500);
  font-family: Outfit, sans-serif;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.125rem 0.625rem;
}

html.dark .nobody-chip {
  color: var(--color-accent-lift);
}
</style>
