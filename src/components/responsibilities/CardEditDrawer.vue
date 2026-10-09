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
 * Card reminders (#123, existing cards only): the draft carries the whole `reminders` map,
 * keyed like the parts, and `saveCard` receives it in the same one draft. A single card gets
 * one Reminder field after the done line; a split card gets one control per part through the
 * split editor's `#part` slot, only one open at a time (`expandedReminderKey`). A mode switch
 * carries the reminders by the same rule as the holders (`draftRemindersForMode`).
 *
 * Mounted unconditionally by the page (never `v-if`-gated) so `useFormModal` seeds it.
 */
import { computed, ref } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import EmojiPicker from '@/components/ui/EmojiPicker.vue';
import ToggleRow from '@/components/ui/ToggleRow.vue';
import ListCategoryPills from '@/components/lists/ListCategoryPills.vue';
import CardArt from '@/components/responsibilities/CardArt.vue';
import CardReminderField from '@/components/responsibilities/CardReminderField.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFormModal } from '@/composables/useFormModal';
import { useFormValidation } from '@/composables/useFormValidation';
import { isAdultMember, useMemberInfo } from '@/composables/useMemberInfo';
import { useResponsibilityCardLabel } from '@/composables/useResponsibilityCardLabel';
import { showToast } from '@/composables/useToast';
import { useFamilyStore } from '@/stores/familyStore';
import { useResponsibilityStore } from '@/stores/responsibilityStore';
import { MAIN_PART_KEY, type ResolvedCard } from '@/utils/responsibilityDeck';
import { fillTemplate } from '@/utils/fillTemplate';
import { draftRemindersForMode, type CardDraft } from '@/utils/responsibilityOps';
import type { CardPart, CardReminder, ListCategory } from '@/types/models';
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
const { getMemberName, getMemberById } = useMemberInfo();
const { cardName, cardEmoji, partCaption } = useResponsibilityCardLabel();

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
/** #123: the card's reminders, keyed like `split.parts` (the whole map goes in the draft). */
const reminders = ref<Record<string, CardReminder>>({});
/** The one reminder control that is open (a split card opens one part at a time). */
const expandedReminderKey = ref<string | null>(null);
/** The holder the card had when the drawer opened (for the re-deal note). */
const openedHolderId = ref<string | undefined>();
/** The header icon: the live-picked emoji while editing a custom card's identity, else the card's art. */
const headerArt = computed(() => (editsIdentity.value ? { emoji: emoji.value } : card.value));

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
      reminders.value = Object.fromEntries(
        c.parts.flatMap((p) => (p.reminder ? [[p.key, { ...p.reminder }]] : []))
      );
      expandedReminderKey.value = c.splitMode === 'single' ? MAIN_PART_KEY : null;
    },
    onNew: () => {
      name.value = '';
      emoji.value = EMOJI_CHOICES[0]!.emoji;
      category.value = 'home';
      split.value = { splitMode: 'single', parts: [{ key: MAIN_PART_KEY }] };
      done.value = '';
      skipped.value = false;
      openedHolderId.value = undefined;
      reminders.value = {};
      expandedReminderKey.value = null;
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

/** The split editor's update: a mode switch carries the reminders like it carries holders. */
function onSplit(next: SplitDraft): void {
  if (next.splitMode !== split.value.splitMode) {
    reminders.value = draftRemindersForMode(
      reminders.value,
      split.value.parts,
      next.parts,
      next.splitMode
    );
    expandedReminderKey.value = next.splitMode === 'single' ? MAIN_PART_KEY : null;
  }
  split.value = next;
}

// ── Reminders (#123) ─────────────────────────────────────────────────────────
/** What a blank What to Say saves: the card's name (a custom card's draft name, if typed). */
const reminderFallbackSay = computed(() => {
  const typed = editsIdentity.value ? name.value.trim() : '';
  return typed || (card.value ? cardName(card.value) : '');
});

/** Who a part's reminder goes to today, for the control's copy. */
function reminderHolder(part: CardPart): { name: string | null; child: boolean } {
  const member = getMemberById(part.holderId);
  return { name: member ? member.name : null, child: !!member && !isAdultMember(member) };
}

function setReminder(key: string, value: CardReminder | null): void {
  const { [key]: _drop, ...rest } = reminders.value;
  reminders.value = value ? { ...rest, [key]: value } : rest;
}

function setReminderExpanded(key: string, open: boolean): void {
  if (open) expandedReminderKey.value = key;
  else if (expandedReminderKey.value === key) expandedReminderKey.value = null;
}

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
    reminders: { ...reminders.value },
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
    <template v-if="headerArt" #icon><CardArt :card="headerArt" img-class="h-9 w-9" /></template>
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
      :model-value="split"
      :members="familyStore.members"
      :holders="holders"
      :allow-split="!isNew"
      :holder-optional="isNew"
      :parts-bind="v.bind('parts', t('whoOwnsWhat.edit.partNames'))"
      @update:model-value="onSplit"
    >
      <template v-if="!isNew" #parts-intro>
        <p
          class="dark:text-ink-faint mb-2.5 text-xs text-[var(--color-text-muted)]"
          data-testid="card-reminder-per-part-hint"
        >
          {{ t('whoOwnsWhat.reminder.perPartHint') }}
        </p>
      </template>
      <template v-if="!isNew" #part="{ part }">
        <div class="dark:border-line border-t border-[var(--tint-slate-10)] pt-2.5">
          <CardReminderField
            :key="`${cardId}:${part.key}`"
            :model-value="reminders[part.key] ?? null"
            :holder-name="reminderHolder(part).name"
            :child-holder="reminderHolder(part).child"
            :card-name="reminderFallbackSay"
            :part-label="partCaption(split, part)"
            :expanded="expandedReminderKey === part.key"
            @update:model-value="setReminder(part.key, $event)"
            @update:expanded="setReminderExpanded(part.key, $event)"
          />
        </div>
      </template>
    </CardSplitEditor>
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

    <FormFieldGroup
      v-if="!isNew && split.splitMode === 'single' && split.parts[0]"
      :label="t('whoOwnsWhat.reminder.field')"
    >
      <CardReminderField
        :key="`${cardId}:${MAIN_PART_KEY}`"
        :model-value="reminders[MAIN_PART_KEY] ?? null"
        :holder-name="reminderHolder(split.parts[0]).name"
        :child-holder="reminderHolder(split.parts[0]).child"
        :card-name="reminderFallbackSay"
        :expanded="expandedReminderKey === MAIN_PART_KEY"
        @update:model-value="setReminder(MAIN_PART_KEY, $event)"
        @update:expanded="setReminderExpanded(MAIN_PART_KEY, $event)"
      />
    </FormFieldGroup>

    <ToggleRow
      v-if="!isNew"
      v-model="skipped"
      :title="t('whoOwnsWhat.edit.skip')"
      :hint="t('whoOwnsWhat.edit.skipHint')"
      testid="card-edit-skip"
    />
  </BeanieFormModal>
</template>
