<script setup lang="ts">
/**
 * Who Owns What (#109): the card edit drawer (Requirement 13), also the "New Card" form.
 *
 * Edits ONE local draft and saves it ONCE: `store.saveCard(cardId, draft)` for an existing
 * card (holders, split, done line and the skip toggle in one batch), `store.createCustom`
 * for a new one. It never calls several store actions in sequence, so a save can't land
 * half-written. It closes only on a truthy store result; every falsy result has already
 * been shown and logged by the store.
 *
 * Built-in cards keep their name, emoji and category (shown, not editable); family-made
 * cards edit all three. The done line is an override on built-ins: blank restores the
 * default. Delete (family-made cards only) goes through the shared `useCardDeletion`;
 * built-ins show the disabled tile with its reason. A card that disappears while open says
 * so and closes (shared with the view drawer via `useCardDrawerEnd`).
 *
 * Mounted unconditionally by the page (never `v-if`-gated) so `useFormModal` seeds it.
 */
import { computed, ref } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import EmojiPicker from '@/components/ui/EmojiPicker.vue';
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue';
import ListCategoryPills from '@/components/lists/ListCategoryPills.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFormModal } from '@/composables/useFormModal';
import { useFormValidation } from '@/composables/useFormValidation';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { useResponsibilityCardLabel } from '@/composables/useResponsibilityCardLabel';
import { showToast } from '@/composables/useToast';
import { useFamilyStore } from '@/stores/familyStore';
import { useResponsibilityStore } from '@/stores/responsibilityStore';
import { MAIN_PART_KEY, type ResolvedCard } from '@/utils/responsibilityDeck';
import { fillTemplate } from '@/utils/fillTemplate';
import type { CardDraft } from '@/utils/responsibilityOps';
import type { ListCategory } from '@/types/models';
import type { UIStringKey } from '@/services/translation/uiStrings';
import CardSplitEditor, { type SplitDraft } from './CardSplitEditor.vue';
import { useCardDrawerEnd } from './useCardDeletion';

const props = defineProps<{
  open: boolean;
  /** The card to edit; `null` creates a new, family-made card. */
  cardId: string | null;
}>();
const emit = defineEmits<{ close: []; saved: [cardId: string] }>();

const { t } = useTranslation();
const store = useResponsibilityStore();
const familyStore = useFamilyStore();
const { getMemberName } = useMemberInfo();
const { cardName, cardEmoji } = useResponsibilityCardLabel();

/** The curated emoji for a family-made card. Labels are translation keys. */
const EMOJI_CHOICES: { emoji: string; labelKey: UIStringKey }[] = [
  { emoji: '🧹', labelKey: 'whoOwnsWhat.emoji.cleaning' },
  { emoji: '🍳', labelKey: 'whoOwnsWhat.emoji.cooking' },
  { emoji: '🧺', labelKey: 'whoOwnsWhat.emoji.laundry' },
  { emoji: '🛒', labelKey: 'whoOwnsWhat.emoji.shopping' },
  { emoji: '🚗', labelKey: 'whoOwnsWhat.emoji.driving' },
  { emoji: '🧒', labelKey: 'whoOwnsWhat.emoji.kids' },
  { emoji: '🐾', labelKey: 'whoOwnsWhat.emoji.pets' },
  { emoji: '🌱', labelKey: 'whoOwnsWhat.emoji.garden' },
  { emoji: '🔧', labelKey: 'whoOwnsWhat.emoji.fixing' },
  { emoji: '📋', labelKey: 'whoOwnsWhat.emoji.paperwork' },
  { emoji: '🎉', labelKey: 'whoOwnsWhat.emoji.party' },
  { emoji: '⚽', labelKey: 'whoOwnsWhat.emoji.sports' },
  { emoji: '🩺', labelKey: 'whoOwnsWhat.emoji.health' },
  { emoji: '🧳', labelKey: 'whoOwnsWhat.emoji.travel' },
  { emoji: '💞', labelKey: 'whoOwnsWhat.emoji.people' },
  { emoji: '✨', labelKey: 'whoOwnsWhat.emoji.me' },
];
const emojiOptions = computed(() =>
  EMOJI_CHOICES.map((c) => ({ emoji: c.emoji, label: t(c.labelKey) }))
);

const card = computed<ResolvedCard | undefined>(() =>
  props.cardId ? store.cardById(props.cardId) : undefined
);
const isNew = computed(() => !props.cardId);
/** Name, emoji and category are editable on new and family-made cards only. */
const editsIdentity = computed(() => isNew.value || !!card.value?.isCustom);

// ── The draft ────────────────────────────────────────────────────────────────
const name = ref('');
const emoji = ref(EMOJI_CHOICES[0]!.emoji);
const category = ref<ListCategory>('home');
const split = ref<SplitDraft>({ splitMode: 'single', parts: [{ key: MAIN_PART_KEY }] });
const done = ref('');
const skipped = ref(false);
/** The holder the card had when the drawer opened (for the re-deal note). */
const openedHolderId = ref<string | undefined>();

const { isSubmitting } = useFormModal(
  () => card.value,
  () => props.open,
  {
    onEdit: (c) => {
      name.value = c.custom?.name ?? '';
      emoji.value = c.custom?.emoji ?? cardEmoji(c);
      category.value = c.category;
      split.value = {
        splitMode: c.splitMode,
        // Only what is stored: `since` / `previousHolderId` are derived.
        parts: c.parts.map((p) => ({
          key: p.key,
          ...(p.label !== undefined ? { label: p.label } : {}),
          ...(p.holderId ? { holderId: p.holderId } : {}),
        })),
      };
      done.value = c.doneOverride ?? '';
      skipped.value = c.status === 'skipped';
      openedHolderId.value = c.splitMode === 'single' ? c.parts[0]?.holderId : undefined;
    },
    onNew: () => {
      name.value = '';
      emoji.value = EMOJI_CHOICES[0]!.emoji;
      category.value = 'home';
      split.value = { splitMode: 'single', parts: [{ key: MAIN_PART_KEY }] };
      done.value = '';
      skipped.value = false;
      openedHolderId.value = undefined;
    },
    // Retargeted while open (Edit on another card, or New): refill for the new target.
    entityKey: () => props.cardId,
  }
);

const v = useFormValidation(
  'responsibility-card',
  () => ({
    ...(editsIdentity.value ? { name: () => name.value.trim().length > 0 } : {}),
    // A split needs at least one part (a child split with no children has none), and every
    // label part needs a name. Save stays disabled rather than reaching the builder.
    ...(split.value.splitMode !== 'single'
      ? {
          parts: () =>
            split.value.parts.length > 0 &&
            (split.value.splitMode !== 'label' ||
              split.value.parts.every((p) => !!p.label?.trim())),
        }
      : {}),
  }),
  { open: () => props.open }
);

const holders = computed(() => familyStore.sortedHumans);

/** "greg holds this card now…": shown when the drawer is about to move an unsplit card. */
const redealNote = computed(() => {
  if (isNew.value || split.value.splitMode !== 'single') return '';
  const next = split.value.parts[0]?.holderId;
  if (!openedHolderId.value || !next || next === openedHolderId.value) return '';
  return fillTemplate(t('whoOwnsWhat.edit.redealNote'), {
    name: getMemberName(openedHolderId.value, ''),
  });
});

const title = computed(() =>
  isNew.value ? t('whoOwnsWhat.edit.newTitle') : t('whoOwnsWhat.edit.title')
);
const saveLabel = computed(() => (isNew.value ? t('whoOwnsWhat.edit.create') : t('action.save')));
const donePlaceholder = computed(() =>
  card.value && !card.value.isCustom && card.value.def
    ? t(card.value.def.doneKey)
    : t('whoOwnsWhat.edit.donePlaceholder')
);

/** The ONE draft `saveCard` receives. */
function buildDraft(): CardDraft {
  const draft: CardDraft = {
    splitMode: split.value.splitMode,
    parts: split.value.parts.map((p) => ({ ...p })),
    doneOverride: done.value.trim() || undefined,
    skipped: skipped.value,
  };
  if (card.value?.isCustom) {
    draft.custom = { name: name.value.trim(), emoji: emoji.value, category: category.value };
  }
  return draft;
}

async function handleSave(): Promise<void> {
  if (isSubmitting.value) return;
  isSubmitting.value = true;
  try {
    if (isNew.value) {
      const created = await store.createCustom({
        name: name.value.trim(),
        emoji: emoji.value,
        category: category.value,
        done: done.value.trim() || undefined,
        holderId: split.value.parts[0]?.holderId,
      });
      if (!created) return;
      showToast('success', t('whoOwnsWhat.toast.created'));
      emit('saved', created.id);
    } else {
      if (!card.value || !props.cardId) return;
      const saved = await store.saveCard(props.cardId, buildDraft());
      if (!saved) return;
      showToast('success', t('whoOwnsWhat.toast.saved'));
      emit('saved', saved.id);
    }
    emit('close');
  } finally {
    isSubmitting.value = false;
  }
}

// A card that vanishes while open (deleted elsewhere, or a delete refused because it is
// already gone) closes the drawer through the page, so `editOpen` resets and the next Edit
// seeds fresh rather than showing, and saving, this card's stale form.
const { onDelete } = useCardDrawerEnd({
  card,
  isOpen: () => props.open,
  close: () => emit('close'),
  source: 'CardEditDrawer',
});
</script>

<template>
  <BeanieFormModal
    :open="open && (isNew || !!card)"
    variant="drawer"
    :title="title"
    :icon="editsIdentity ? emoji : card ? cardEmoji(card) : undefined"
    :save-label="saveLabel"
    :save-ready="v.canSave.value"
    :is-submitting="isSubmitting"
    :show-delete="!!card?.isCustom"
    :delete-disabled-reason="
      card && !card.isCustom ? t('whoOwnsWhat.details.builtInDelete') : undefined
    "
    @close="emit('close')"
    @save="v.attemptSave(handleSave)"
    @delete="onDelete"
  >
    <!-- A built-in card keeps its name, emoji and category. -->
    <p
      v-if="!editsIdentity && card"
      class="font-outfit dark:text-ink text-xl font-bold text-[var(--color-text)]"
      data-testid="card-edit-name"
    >
      {{ cardName(card) }}
    </p>

    <template v-if="editsIdentity">
      <FormFieldGroup
        :label="t('whoOwnsWhat.edit.name')"
        v-bind="v.bind('name', t('whoOwnsWhat.edit.nameNoun'))"
      >
        <BaseInput
          v-model="name"
          :placeholder="t('whoOwnsWhat.edit.namePlaceholder')"
          data-testid="card-edit-name-input"
        />
      </FormFieldGroup>
      <FormFieldGroup :label="t('whoOwnsWhat.edit.emoji')">
        <EmojiPicker v-model="emoji" :options="emojiOptions" />
      </FormFieldGroup>
      <FormFieldGroup :label="t('whoOwnsWhat.edit.category')">
        <ListCategoryPills
          :model-value="category"
          tone="edit"
          short
          @update:model-value="category = $event ?? category"
        />
      </FormFieldGroup>
    </template>

    <CardSplitEditor
      v-model="split"
      :members="familyStore.members"
      :holders="holders"
      :allow-split="!isNew"
      :holder-optional="isNew"
      :parts-bind="v.bind('parts', t('whoOwnsWhat.edit.partNames'))"
    />
    <p
      v-if="redealNote"
      class="dark:text-ink-soft -mt-3 text-xs text-[var(--color-text-muted)]"
      data-testid="card-edit-redeal-note"
    >
      {{ redealNote }}
    </p>

    <FormFieldGroup :label="t('whoOwnsWhat.edit.done')">
      <textarea
        v-model="done"
        rows="2"
        maxlength="140"
        :placeholder="donePlaceholder"
        class="dark:border-line-strong dark:bg-surface-raised dark:text-ink dark:placeholder:text-ink-faint w-full rounded-xl border border-[var(--color-border)] bg-white px-3 py-2 text-base text-[var(--color-text)] focus:ring-2 focus:ring-[#AED6F1] focus:outline-none"
        data-testid="card-edit-done"
      />
      <p
        v-if="card && !card.isCustom"
        class="dark:text-ink-faint text-xs text-[var(--color-text-muted)]"
      >
        {{ t('whoOwnsWhat.edit.doneDefaultHint') }}
      </p>
    </FormFieldGroup>

    <div v-if="!isNew" class="flex items-center justify-between gap-4">
      <div class="min-w-0">
        <p class="font-outfit dark:text-ink text-sm font-semibold text-[var(--color-text)]">
          {{ t('whoOwnsWhat.edit.skip') }}
        </p>
        <p class="dark:text-ink-faint text-xs text-[var(--color-text-muted)]">
          {{ t('whoOwnsWhat.edit.skipHint') }}
        </p>
      </div>
      <ToggleSwitch
        v-model="skipped"
        :aria-label="t('whoOwnsWhat.edit.skip')"
        data-testid="card-edit-skip"
      />
    </div>
  </BeanieFormModal>
</template>
