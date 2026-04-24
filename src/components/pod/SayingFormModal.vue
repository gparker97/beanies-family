<script setup lang="ts">
/**
 * Add/edit a SayingItem — the quote string plus optional date, place,
 * and free-text context. Defaults `saidOn` to today on new entries per
 * the plan's form-defaults table.
 */
import { computed, ref } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import { useFormModal } from '@/composables/useFormModal';
import { useTranslation } from '@/composables/useTranslation';
import { useSayingsStore } from '@/stores/sayingsStore';
import { confirm } from '@/composables/useConfirm';
import { toDateInputValue } from '@/utils/date';
import type { SayingItem, UUID } from '@/types/models';

const props = defineProps<{
  open: boolean;
  memberId: UUID;
  saying?: SayingItem | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useTranslation();
const sayingsStore = useSayingsStore();

const words = ref('');
const saidOn = ref('');
const place = ref('');
const context = ref('');

const { isEditing, isSubmitting } = useFormModal(
  () => props.saying,
  () => props.open,
  {
    onEdit: (s) => {
      words.value = s.words;
      saidOn.value = s.saidOn ?? '';
      place.value = s.place ?? '';
      context.value = s.context ?? '';
    },
    onNew: () => {
      words.value = '';
      saidOn.value = toDateInputValue(new Date());
      place.value = '';
      context.value = '';
    },
  }
);

const canSave = computed(() => words.value.trim().length > 0);

const title = computed(() => (isEditing.value ? t('sayings.editTitle') : t('sayings.addTitle')));

async function handleSave(): Promise<void> {
  if (!canSave.value) return;
  isSubmitting.value = true;
  try {
    const payload = {
      memberId: props.memberId,
      words: words.value.trim(),
      ...(saidOn.value ? { saidOn: saidOn.value } : {}),
      ...(place.value.trim() ? { place: place.value.trim() } : {}),
      ...(context.value.trim() ? { context: context.value.trim() } : {}),
    };
    if (isEditing.value && props.saying) {
      await sayingsStore.updateSaying(props.saying.id, payload);
    } else {
      await sayingsStore.createSaying(payload);
    }
    emit('close');
  } finally {
    isSubmitting.value = false;
  }
}

async function handleDelete(): Promise<void> {
  if (!props.saying) return;
  const ok = await confirm({
    title: 'sayings.deleteConfirm.title',
    message: 'sayings.deleteConfirm.body',
    variant: 'danger',
  });
  if (!ok) return;
  await sayingsStore.deleteSaying(props.saying.id);
  emit('close');
}
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    :open="open"
    :title="title"
    icon="💬"
    icon-bg="var(--tint-silk-20)"
    size="narrow"
    :save-disabled="!canSave"
    :is-submitting="isSubmitting"
    :show-delete="isEditing"
    @close="emit('close')"
    @save="handleSave"
    @delete="handleDelete"
  >
    <FormFieldGroup :label="t('sayings.field.words')" required>
      <textarea
        v-model="words"
        rows="3"
        class="focus:border-primary-500 focus:ring-primary-500 font-caveat w-full rounded-xl border-2 border-[var(--tint-slate-10)] bg-white px-4 py-3 text-lg leading-snug text-[var(--color-text)] outline-none focus:ring-1 dark:border-slate-600 dark:bg-slate-700 dark:text-gray-100"
        :placeholder="t('sayings.placeholder.words')"
      />
    </FormFieldGroup>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <FormFieldGroup :label="t('sayings.field.saidOn')" optional>
        <BeanieDatePicker v-model="saidOn" />
      </FormFieldGroup>

      <FormFieldGroup :label="t('sayings.field.place')" optional>
        <BaseInput v-model="place" :placeholder="t('sayings.placeholder.place')" />
      </FormFieldGroup>
    </div>

    <FormFieldGroup :label="t('sayings.field.context')" optional>
      <BaseInput v-model="context" :placeholder="t('sayings.placeholder.context')" />
    </FormFieldGroup>
  </BeanieFormModal>
</template>
