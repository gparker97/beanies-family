<script setup lang="ts">
/**
 * The To-Dos page's "Add To-do" sidebar: a new to-do with its details (who, when, notes).
 *
 * CREATE ONLY. Editing stays per-field inline in `TodoViewEditModal`; this drawer never takes
 * an existing to-do. Opened by the page header's "+ Add To-do" and the quick-add sheet's
 * To-do tile.
 *
 * The create itself (author, payload rules, write) is `useTodoCreate().createTodoFrom`, shared
 * with the quick-add bar and the Nook widget, so this view only holds the draft. A `null` create
 * keeps the drawer open with the draft (the missing author or the failed write is already
 * toasted). It emits `created(id)` and never logs: `createTodoFrom` counts the create and the page
 * owns the reveal.
 *
 * A save still in flight when the drawer is closed and reopened belongs to the OLD draft: the
 * to-do exists, but it must not report `created` (the page would close the new draft), so each
 * open is a generation and a stale save does nothing more.
 *
 * The magic beans quick card at the top routes its result through the page's `todo` consumer,
 * which closes this drawer before the review drawer opens.
 */
import { nextTick, ref, watch } from 'vue';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseTextarea from '@/components/ui/BaseTextarea.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import TimePresetPicker from '@/components/ui/TimePresetPicker.vue';
import MagicBeansQuickCard from '@/components/ai/MagicBeansQuickCard.vue';
import { useTranslation } from '@/composables/useTranslation';
import { useFormModal } from '@/composables/useFormModal';
import { useFormValidation } from '@/composables/useFormValidation';
import { useTodoCreate } from '@/composables/useTodoCreate';
import { useBreakpoint } from '@/composables/useBreakpoint';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
  created: [id: string];
}>();

const { t } = useTranslation();
const { createTodoFrom } = useTodoCreate();
const { isDesktop } = useBreakpoint();

const title = ref('');
const description = ref('');
const assigneeIds = ref<string[]>([]);
const dueDate = ref('');
const dueTime = ref('');
const titleField = ref<InstanceType<typeof BaseInput> | null>(null);

/** Bumped on every open, so a save from an earlier open never reports into this one. */
let generation = 0;

// A cleared date takes its time with it, so an old time never comes back with a new date.
watch(dueDate, (date) => {
  if (!date) dueTime.value = '';
});

const { isSubmitting } = useFormModal(
  () => null,
  () => props.open,
  { onEdit: () => {}, onNew: reset }
);

const v = useFormValidation('todo', () => ({ title: () => title.value.trim().length > 0 }), {
  open: () => props.open,
});

function reset(): void {
  generation++;
  // A save from the previous open may still be in flight; it must not lock this one's Save.
  isSubmitting.value = false;
  title.value = '';
  description.value = '';
  assigneeIds.value = [];
  dueDate.value = '';
  dueTime.value = '';
  // Desktop only: on a phone the keyboard would cover the drawer as it slides in.
  if (isDesktop.value) void focusTitle();
}

async function focusTitle(): Promise<void> {
  await nextTick();
  (titleField.value?.$el as HTMLElement | undefined)?.querySelector('input')?.focus();
}

function onAssigneesChange(value: string | string[]): void {
  assigneeIds.value = Array.isArray(value) ? value : [value];
}

async function handleSave(): Promise<void> {
  if (isSubmitting.value) return;
  const session = generation;
  isSubmitting.value = true;
  try {
    const created = await createTodoFrom(
      {
        title: title.value,
        description: description.value,
        dueDate: dueDate.value,
        dueTime: dueTime.value,
        assigneeIds: assigneeIds.value,
      },
      'TodoFormModal',
      'sidebar'
    );
    // null: already toasted. Stay open with the draft so it can be retried.
    // A newer open: the to-do exists, and this drawer now holds someone else's draft.
    if (!created || session !== generation) return;
    emit('created', created.id);
  } finally {
    if (session === generation) isSubmitting.value = false;
  }
}
</script>

<template>
  <BeanieFormModal
    variant="drawer"
    size="narrow"
    :open="open"
    :title="t('todo.newTask')"
    icon="✅"
    icon-bg="var(--tint-purple-12)"
    :save-label="t('todo.addTodo')"
    save-gradient="purple"
    :save-ready="v.canSave.value"
    :is-submitting="isSubmitting"
    @close="emit('close')"
    @save="v.attemptSave(handleSave)"
  >
    <MagicBeansQuickCard hint="todo" :subtitle="t('todo.magicHint')" />

    <FormFieldGroup :label="t('todo.field.title')" v-bind="v.bind('title')">
      <BaseInput ref="titleField" v-model="title" :placeholder="t('todo.quickAddPlaceholder')" />
    </FormFieldGroup>

    <FormFieldGroup :label="t('todo.description')" optional>
      <BaseTextarea v-model="description" :rows="3" />
    </FormFieldGroup>

    <FormFieldGroup :label="t('todo.who')" optional>
      <FamilyChipPicker
        :model-value="assigneeIds"
        mode="multi"
        @update:model-value="onAssigneesChange"
      />
    </FormFieldGroup>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <FormFieldGroup :label="t('todo.dueDate')" optional>
        <BeanieDatePicker v-model="dueDate" />
      </FormFieldGroup>
      <!-- A time only means something with a date; `toCreateTodoInput` also drops an orphan. -->
      <FormFieldGroup v-if="dueDate" :label="t('todo.dueTime')" optional>
        <TimePresetPicker v-model="dueTime" clearable />
      </FormFieldGroup>
    </div>
  </BeanieFormModal>
</template>
