<script setup lang="ts">
/**
 * Where a reviewed ingredient checklist goes (#116): a New List, or Add to a List the
 * family already has. One control, shared by the recipe sheet (also opened from the
 * edit-meal drawer) and the meal planner's week list.
 *
 * v-model is a `ShoppingDestination`; the caller seeds it (usually with
 * `newListDestination(currentMember)`) and hands it to `useShoppingListCommit`.
 *
 * New List asks who shops and by when (moved here from `RecipeListSheet`, #88): the person
 * building a list from a recipe usually knows both, and the due date is what arms the
 * reminder. The name is editable; blank falls back to `defaultTitle`.
 *
 * Add to a List offers `listStore.shoppingDestinations`: the family's one-off, unfiled
 * lists, shopping lists first, newest first. Recurring lists are left out on purpose, or
 * a week's ingredients would become permanent weekly staples. It reads the UNFILTERED
 * lists, so the global member filter never hides the family's grocery list. With none,
 * the option is disabled and says so.
 *
 * Switching modes and back keeps what was typed in each (a local memory, never persisted).
 */
import { computed, ref, useId, watch } from 'vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import InferredHint from '@/components/ui/InferredHint.vue';
import ListChoiceRow from '@/components/lists/ListChoiceRow.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useMemberInfo } from '@/composables/useMemberInfo';
import { useFamilyStore } from '@/stores/familyStore';
import { useListStore } from '@/stores/listStore';
import { fillTemplate } from '@/utils/fillTemplate';
import { newListDestination, type ShoppingDestination } from '@/composables/useShoppingListCommit';

const props = defineProps<{
  modelValue: ShoppingDestination;
  /** The New List name used when the field is left blank (shown as its placeholder). */
  defaultTitle: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: ShoppingDestination] }>();

const { t } = useTranslation();
const { getMemberName } = useMemberInfo();
const familyStore = useFamilyStore();
const listStore = useListStore();

/** For `aria-describedby`: unique per instance, since two can be on screen at once. */
const noneId = `shopping-destination-none-${useId()}`;

const lists = computed(() => listStore.shoppingDestinations);
const hasLists = computed(() => lists.value.length > 0);

/** What each mode last held, so New List → Add to a List → New List keeps the name typed. */
const lastNew = ref<Extract<ShoppingDestination, { mode: 'new' }> | null>(null);
const lastListId = ref('');
watch(
  () => props.modelValue,
  (d) => {
    if (d.mode === 'new') lastNew.value = d;
    else lastListId.value = d.listId;
  },
  { immediate: true }
);

const newState = computed(() => (props.modelValue.mode === 'new' ? props.modelValue : null));
const existingId = computed(() =>
  props.modelValue.mode === 'existing' ? props.modelValue.listId : ''
);

function pickNew(): void {
  if (props.modelValue.mode === 'new') return;
  emit(
    'update:modelValue',
    lastNew.value ?? newListDestination(familyStore.currentMember?.id ?? '')
  );
}

function pickExisting(): void {
  if (props.modelValue.mode === 'existing' || !hasLists.value) return;
  const remembered = lists.value.some((l) => l.id === lastListId.value) ? lastListId.value : '';
  emit('update:modelValue', { mode: 'existing', listId: remembered || lists.value[0]!.id });
}

function patchNew(patch: Partial<Extract<ShoppingDestination, { mode: 'new' }>>): void {
  if (!newState.value) return;
  emit('update:modelValue', { ...newState.value, ...patch });
}

/** `FamilyChipPicker` emits `string | string[]`; single mode gives a string. */
function setOwner(value: string | string[]): void {
  const id = Array.isArray(value) ? value[0] : value;
  if (id) patchNew({ ownerId: id });
}

/**
 * Says out loud what a due date actually does, and only once one is set. Names the OWNER,
 * not "you": the whole point of the picker is that those are often different people.
 *
 * ⚠️ It names no literal time ("9am" would duplicate `ALL_DAY_REMINDER_HOUR` across
 * locales), and it is ONE wording for every platform (greg's call, 2026-09-13), which
 * overstates on web and the PWA until lists get a `list-due` bell entry (see the key's
 * note in `uiStrings.ts`).
 */
const dueHint = computed(() => {
  if (!newState.value?.dueDate) return '';
  return fillTemplate(t('lists.fromRecipe.dueHint'), {
    name: getMemberName(newState.value.ownerId, t('lists.fromRecipe.someone')),
  });
});

const segClass = (on: boolean) =>
  on
    ? 'dark:bg-surface-hover dark:text-ink bg-white text-[var(--color-text)] shadow-sm'
    : 'dark:text-ink-soft text-[var(--color-text-muted)] disabled:cursor-not-allowed';
</script>

<template>
  <div
    class="dark:border-line dark:bg-surface-overlay space-y-3 rounded-2xl border border-[var(--tint-slate-10)] bg-white p-3"
  >
    <div
      class="dark:bg-surface-raised grid grid-cols-2 gap-1 rounded-[14px] bg-[var(--tint-slate-5)] p-1"
      role="group"
      :aria-label="t('lists.destination.heading')"
    >
      <button
        type="button"
        class="font-outfit rounded-[11px] px-2 py-2 text-sm font-bold transition-colors"
        :class="segClass(modelValue.mode === 'new')"
        :aria-pressed="modelValue.mode === 'new'"
        data-testid="destination-new"
        @click="pickNew"
      >
        {{ t('lists.destination.newList') }}
      </button>
      <button
        type="button"
        class="font-outfit rounded-[11px] px-2 py-2 text-sm font-bold transition-colors"
        :class="segClass(modelValue.mode === 'existing')"
        :aria-pressed="modelValue.mode === 'existing'"
        :disabled="!hasLists"
        :aria-describedby="hasLists ? undefined : noneId"
        data-testid="destination-existing"
        @click="pickExisting"
      >
        {{ t('lists.destination.addToList') }}
      </button>
    </div>
    <p
      v-if="!hasLists"
      :id="noneId"
      class="font-inter dark:text-ink-faint text-xs text-[var(--color-text-muted)]"
      data-testid="destination-none"
    >
      {{ t('lists.destination.noLists') }}
    </p>

    <!-- New List: its name, who shops and by when. -->
    <div v-if="newState" class="space-y-3">
      <BaseInput
        :model-value="newState.title"
        :label="t('lists.destination.nameLabel')"
        :placeholder="defaultTitle"
        data-testid="destination-name"
        @update:model-value="patchNew({ title: String($event) })"
      />
      <div class="space-y-1.5">
        <p
          class="font-inter dark:text-ink-faint text-xs font-semibold text-[var(--color-text-muted)] uppercase"
        >
          {{ t('lists.fromRecipe.ownerLabel') }}
        </p>
        <FamilyChipPicker
          :model-value="newState.ownerId"
          mode="single"
          compact
          @update:model-value="setOwner"
        />
      </div>
      <!-- ⚠️ NO sibling <p> label: `BeanieDatePicker` renders its own visible <label>
           from `:label` (a second one stacked the words twice and announced them twice).
           The key is `lists.detail.dueDateLabel`, the same field's label in the list
           drawer. ⚠️ NO `:min`: a list due TODAY is the most common case, back-dating
           is legitimate, and `ListDetailModal` has never had a floor. -->
      <div class="space-y-1.5">
        <BeanieDatePicker
          :model-value="newState.dueDate"
          :label="t('lists.detail.dueDateLabel')"
          :placeholder="t('lists.fromRecipe.dueDatePlaceholder')"
          @update:model-value="patchNew({ dueDate: $event })"
        />
        <InferredHint :text="dueHint" />
      </div>
    </div>

    <!-- Add to a List: one row per one-off, unfiled list. -->
    <div v-else class="space-y-1.5">
      <ListChoiceRow
        v-for="l in lists"
        :key="l.id"
        :list="l"
        selectable
        :selected="l.id === existingId"
        @click="emit('update:modelValue', { mode: 'existing', listId: l.id })"
      />
    </div>
  </div>
</template>
