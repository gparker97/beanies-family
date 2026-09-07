<script setup lang="ts">
/**
 * Copy one list to one or several beans.
 *
 * The whole feature is two controls: a title carrying a `{bean}` token, and a
 * multi-select of beans. Selecting N beans creates N independent lists in ONE atomic
 * write (see `listStore.copyListForMembers`), so there is no partial-success state to
 * design for — only "created" or "nothing happened, and you have been told why".
 *
 * MUST stay mounted while closed. `useFormModal`'s reset is a plain, non-immediate
 * `watch(open)`, so a `v-if`-gated instance would mount with `open` already true, never
 * fire, and open with an empty title and the previous selection still in place.
 */
import { computed, ref } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import { useFormModal } from '@/composables/useFormModal';
import { useTranslation } from '@/composables/useTranslation';
import { showToast } from '@/composables/useToast';
import { useListStore } from '@/stores/listStore';
import { fillTemplate } from '@/utils/fillTemplate';

const props = defineProps<{ open: boolean; sourceId: string | null }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useTranslation();
const listStore = useListStore();

const sourceList = computed(() => listStore.lists.find((l) => l.id === props.sourceId));

const title = ref('');
const selectedIds = ref<string[]>([]);

function reset(): void {
  const source = sourceList.value;
  // `{bean}` deliberately survives into the field: `fillTemplate` leaves unmatched
  // tokens alone, so filling only `{list}` here leaves `{bean}` for the per-copy
  // expansion in the store. Deleting it is allowed — every copy then shares one name.
  title.value = source ? fillTemplate(t('lists.copy.titleDefault'), { list: source.title }) : '';
  selectedIds.value = [];
}

const { isSubmitting } = useFormModal(
  () => sourceList.value,
  () => props.open,
  { onEdit: reset, onNew: reset }
);

const saveLabel = computed(() =>
  selectedIds.value.length === 1
    ? t('lists.copy.createOne')
    : fillTemplate(t('lists.copy.createOther'), { count: selectedIds.value.length })
);

// One rule only. A blank title is handled by the store's fallback to the source title,
// so it needs no second branch and no error state here.
const saveDisabled = computed(() => selectedIds.value.length === 0);

async function onSave(): Promise<void> {
  // Guard AND the bound `is-submitting` are both needed: the write is atomic, which
  // prevents a partial batch, not a second batch. Without this a double-tap on
  // "Create 3 Copies" makes six lists.
  if (isSubmitting.value || !props.sourceId) return;
  isSubmitting.value = true;
  try {
    const created = await listStore.copyListForMembers(
      props.sourceId,
      selectedIds.value,
      title.value
    );
    // Falsy, not `=== null`: the store folds a throw and a graceful stop into one
    // sentinel, and it has already toasted and reported either way. Toasting again
    // here would page Slack a second time.
    if (!created) return;
    showToast(
      'success',
      created.length === 1
        ? t('lists.copy.doneOne')
        : fillTemplate(t('lists.copy.doneOther'), { count: created.length })
    );
    emit('close');
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <BeanieFormModal
    :open="open"
    :title="t('lists.copy.title')"
    icon="📋"
    icon-bg="var(--tint-orange-8)"
    size="narrow"
    :save-label="saveLabel"
    :save-disabled="saveDisabled"
    :is-submitting="isSubmitting"
    @close="emit('close')"
    @save="onSave"
  >
    <div class="space-y-5">
      <FormFieldGroup :label="t('lists.copy.nameLabel')">
        <BaseInput v-model="title" :placeholder="t('lists.copy.namePlaceholder')" />
        <p class="dark:text-ink-faint mt-2 text-xs text-[var(--color-text-muted)]">
          {{ t('lists.copy.nameHint') }}
        </p>
      </FormFieldGroup>

      <FormFieldGroup :label="t('lists.copy.beansLabel')">
        <FamilyChipPicker v-model="selectedIds" mode="multi" />
      </FormFieldGroup>

      <p class="dark:text-ink-faint text-xs text-[var(--color-text-muted)]">
        <span aria-hidden="true">🌱</span> {{ t('lists.copy.notLinked') }}
      </p>
    </div>
  </BeanieFormModal>
</template>
