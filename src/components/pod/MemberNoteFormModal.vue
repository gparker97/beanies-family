<script setup lang="ts">
/**
 * Add/edit a MemberNote — title + multi-line body. Kept deliberately
 * plain: no rich text, no tags, no pinning. If those ever land they
 * live on MemberNote itself, not this form.
 */
import { computed, ref } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import { useFormModal } from '@/composables/useFormModal';
import { useTranslation } from '@/composables/useTranslation';
import { useMemberNotesStore } from '@/stores/memberNotesStore';
import { confirm } from '@/composables/useConfirm';
import type { MemberNote, UUID } from '@/types/models';

const props = defineProps<{
  open: boolean;
  memberId: UUID;
  note?: MemberNote | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { t } = useTranslation();
const notesStore = useMemberNotesStore();

const title = ref('');
const body = ref('');

const { isEditing, isSubmitting } = useFormModal(
  () => props.note,
  () => props.open,
  {
    onEdit: (n) => {
      title.value = n.title;
      body.value = n.body;
    },
    onNew: () => {
      title.value = '';
      body.value = '';
    },
  }
);

const canSave = computed(() => title.value.trim().length > 0 && body.value.trim().length > 0);

const modalTitle = computed(() =>
  isEditing.value ? t('memberNotes.editTitle') : t('memberNotes.addTitle')
);

async function handleSave(): Promise<void> {
  if (!canSave.value) return;
  isSubmitting.value = true;
  try {
    const payload = {
      memberId: props.memberId,
      title: title.value.trim(),
      body: body.value.trim(),
    };
    if (isEditing.value && props.note) {
      await notesStore.updateMemberNote(props.note.id, payload);
    } else {
      await notesStore.createMemberNote(payload);
    }
    emit('close');
  } finally {
    isSubmitting.value = false;
  }
}

async function handleDelete(): Promise<void> {
  if (!props.note) return;
  const ok = await confirm({
    title: 'memberNotes.deleteConfirm.title',
    message: 'memberNotes.deleteConfirm.body',
    variant: 'danger',
  });
  if (!ok) return;
  await notesStore.deleteMemberNote(props.note.id);
  emit('close');
}
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    :open="open"
    :title="modalTitle"
    icon="📝"
    icon-bg="var(--tint-terracotta-5)"
    size="narrow"
    :save-disabled="!canSave"
    :is-submitting="isSubmitting"
    :show-delete="isEditing"
    @close="emit('close')"
    @save="handleSave"
    @delete="handleDelete"
  >
    <FormFieldGroup :label="t('memberNotes.field.title')" required>
      <BaseInput v-model="title" :placeholder="t('memberNotes.placeholder.title')" />
    </FormFieldGroup>

    <FormFieldGroup :label="t('memberNotes.field.body')" required>
      <textarea
        v-model="body"
        rows="6"
        class="focus:border-primary-500 focus:ring-primary-500 font-outfit w-full rounded-xl border-2 border-[var(--tint-slate-10)] bg-white px-4 py-3 text-sm leading-relaxed text-[var(--color-text)] outline-none focus:ring-1 dark:border-slate-600 dark:bg-slate-700 dark:text-gray-100"
        :placeholder="t('memberNotes.placeholder.body')"
      />
    </FormFieldGroup>
  </BeanieFormModal>
</template>
