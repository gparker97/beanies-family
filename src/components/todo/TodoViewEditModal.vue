<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { confirm as showConfirm } from '@/composables/useConfirm';
import { useSounds } from '@/composables/useSounds';
import { useTodoStore } from '@/stores/todoStore';
import { useFamilyStore } from '@/stores/familyStore';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import TimePresetPicker from '@/components/ui/TimePresetPicker.vue';
import type { TodoItem } from '@/types/models';

const props = defineProps<{
  todo: TodoItem | null;
  startInEditMode?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
  deleted: [id: string];
}>();

const { t } = useTranslation();
const { playWhoosh } = useSounds();
const todoStore = useTodoStore();
const familyStore = useFamilyStore();

const mode = ref<'view' | 'edit'>('view');
const editForm = ref({
  title: '',
  description: '',
  assigneeId: '' as string,
  dueDate: '',
  dueTime: '',
});
const isSubmitting = ref(false);

// Reset mode when todo prop changes
watch(
  () => props.todo,
  (newTodo) => {
    if (newTodo && props.startInEditMode) {
      editForm.value = {
        title: newTodo.title,
        description: newTodo.description ?? '',
        assigneeId: newTodo.assigneeId ?? '',
        dueDate: newTodo.dueDate?.split('T')[0] ?? '',
        dueTime: newTodo.dueTime ?? '',
      };
      mode.value = 'edit';
    } else {
      mode.value = 'view';
    }
  }
);

const viewAssignee = computed(() => {
  if (!props.todo?.assigneeId) return null;
  return familyStore.members.find((m) => m.id === props.todo!.assigneeId);
});

const viewCompletedBy = computed(() => {
  if (!props.todo?.completedBy) return null;
  return familyStore.members.find((m) => m.id === props.todo!.completedBy);
});

const viewCreatedBy = computed(() => {
  if (!props.todo?.createdBy) return null;
  return familyStore.members.find((m) => m.id === props.todo!.createdBy);
});

const viewIsOverdue = computed(() => {
  if (!props.todo || props.todo.completed || !props.todo.dueDate) return false;
  const now = new Date();
  const dueDate = new Date(props.todo.dueDate);
  if (props.todo.dueTime) {
    const parts = props.todo.dueTime.split(':').map(Number);
    dueDate.setHours(parts[0] ?? 23, parts[1] ?? 59, 0, 0);
  } else {
    dueDate.setHours(23, 59, 59, 999);
  }
  return now > dueDate;
});

const viewFormattedDate = computed(() => {
  if (!props.todo?.dueDate) return null;
  const date = new Date(props.todo.dueDate);
  return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
});

const hasDate = computed(() => !!editForm.value.dueDate);

const saveLabel = computed(() => {
  if (props.startInEditMode && !props.todo?.id) {
    return hasDate.value ? t('modal.addToCalendar') : t('modal.addTask');
  }
  return t('modal.saveTask');
});

function switchToEdit() {
  if (!props.todo) return;
  editForm.value = {
    title: props.todo.title,
    description: props.todo.description ?? '',
    assigneeId: props.todo.assigneeId ?? '',
    dueDate: props.todo.dueDate?.split('T')[0] ?? '',
    dueTime: props.todo.dueTime ?? '',
  };
  mode.value = 'edit';
}

function cancelEdit() {
  mode.value = 'view';
}

async function saveEdit() {
  if (!props.todo || !editForm.value.title.trim()) return;
  isSubmitting.value = true;
  try {
    await todoStore.updateTodo(props.todo.id, {
      title: editForm.value.title.trim(),
      description: editForm.value.description.trim() || undefined,
      assigneeId: editForm.value.assigneeId || undefined,
      dueDate: editForm.value.dueDate || undefined,
      dueTime: editForm.value.dueTime || undefined,
    });
    emit('saved');
    emit('close');
  } finally {
    isSubmitting.value = false;
  }
}

async function handleDelete() {
  if (!props.todo) return;
  const id = props.todo.id;
  emit('close');
  if (
    await showConfirm({
      title: 'confirm.deleteTodoTitle',
      message: 'todo.deleteConfirm',
      variant: 'danger',
    })
  ) {
    await todoStore.deleteTodo(id);
    playWhoosh();
    emit('deleted', id);
  }
}
</script>

<template>
  <!-- View mode — BeanieFormModal, "Edit" as save action -->
  <BeanieFormModal
    v-if="todo && mode === 'view'"
    :open="true"
    :title="t('todo.viewTask')"
    icon="✅"
    icon-bg="var(--tint-purple-12)"
    size="narrow"
    :save-label="t('action.edit')"
    save-gradient="purple"
    :show-delete="true"
    @close="emit('close')"
    @save="switchToEdit"
    @delete="handleDelete"
  >
    <div class="space-y-3">
      <!-- Task title -->
      <div>
        <span
          class="font-outfit text-[1.2rem] font-bold text-[var(--color-text)] dark:text-gray-100"
          :class="{ 'line-through opacity-50': todo.completed }"
        >
          {{ todo.title }}
        </span>
      </div>

      <!-- Status -->
      <FormFieldGroup :label="t('todo.status')">
        <span
          v-if="todo.completed"
          class="font-outfit inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-green-700"
          style="background: var(--tint-success-10)"
        >
          ✓ {{ t('todo.status.completed') }}
        </span>
        <span
          v-else
          class="font-outfit inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-purple-700"
          style="background: var(--tint-purple-15)"
        >
          {{ t('todo.status.open') }}
        </span>
      </FormFieldGroup>

      <!-- Due date -->
      <FormFieldGroup :label="t('todo.dueDate')">
        <span
          v-if="viewFormattedDate && viewIsOverdue"
          class="font-outfit inline-flex items-center gap-1.5 rounded-full bg-[var(--color-primary-500)] px-3 py-1.5 text-xs font-semibold text-white"
        >
          {{ viewFormattedDate }}
          <template v-if="todo.dueTime"> &middot; {{ todo.dueTime }}</template>
          <span class="rounded-full bg-white/25 px-1.5 py-px text-[0.6rem] font-bold uppercase">
            {{ t('todo.overdue') }}
          </span>
        </span>
        <span
          v-else-if="viewFormattedDate"
          class="font-outfit text-primary-500 text-sm font-semibold"
        >
          {{ viewFormattedDate }}
          <template v-if="todo.dueTime"> &middot; {{ todo.dueTime }}</template>
        </span>
        <span v-else class="text-sm text-[var(--color-text-muted)]">
          {{ t('todo.noDueDate') }}
        </span>
      </FormFieldGroup>

      <!-- Assignee -->
      <FormFieldGroup :label="t('todo.assignTo')">
        <span
          v-if="viewAssignee"
          class="font-outfit inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-white"
          :style="{
            background: `linear-gradient(135deg, ${viewAssignee.color}, ${viewAssignee.color}cc)`,
          }"
        >
          {{ viewAssignee.name }}
        </span>
        <span v-else class="text-sm text-[var(--color-text-muted)]">
          {{ t('todo.unassigned') }}
        </span>
      </FormFieldGroup>

      <!-- Description -->
      <FormFieldGroup :label="t('todo.description')">
        <p
          v-if="todo.description"
          class="text-sm leading-relaxed whitespace-pre-line text-[var(--color-text)] dark:text-gray-300"
        >
          {{ todo.description }}
        </p>
        <p v-else class="text-sm text-[var(--color-text-muted)] italic">
          {{ t('todo.noDescription') }}
        </p>
      </FormFieldGroup>

      <!-- Created by / Completed by -->
      <div class="grid grid-cols-2 gap-4">
        <FormFieldGroup :label="t('todo.createdBy')">
          <span v-if="viewCreatedBy" class="text-sm text-[var(--color-text)] dark:text-gray-300">
            {{ viewCreatedBy.name }}
          </span>
          <span v-else class="text-sm text-[var(--color-text-muted)]">&mdash;</span>
        </FormFieldGroup>
        <FormFieldGroup v-if="todo.completed && viewCompletedBy" :label="t('todo.doneBy')">
          <span class="text-sm text-[var(--color-text)] dark:text-gray-300">
            {{ viewCompletedBy.name }}
          </span>
        </FormFieldGroup>
      </div>
    </div>
  </BeanieFormModal>

  <!-- Edit mode — BeanieFormModal with purple accent -->
  <BeanieFormModal
    v-if="todo && mode === 'edit'"
    :open="true"
    :title="t('todo.editTask')"
    icon="✅"
    icon-bg="var(--tint-purple-12)"
    size="narrow"
    :save-label="saveLabel"
    save-gradient="purple"
    :save-disabled="!editForm.title.trim()"
    :is-submitting="isSubmitting"
    :show-delete="!!todo.id"
    @close="cancelEdit"
    @save="saveEdit"
    @delete="handleDelete"
  >
    <!-- 1. Task name — extra large -->
    <div>
      <input
        v-model="editForm.title"
        type="text"
        class="font-outfit w-full border-none bg-transparent text-[1.3rem] font-bold text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-muted)] placeholder:opacity-30 dark:text-gray-100"
        :placeholder="t('modal.whatNeedsDoing')"
      />
    </div>

    <!-- 2. Date + Time -->
    <div>
      <div class="grid grid-cols-2 gap-4">
        <FormFieldGroup :label="t('todo.dueDate')" optional>
          <BaseInput v-model="editForm.dueDate" type="date" />
        </FormFieldGroup>
        <FormFieldGroup :label="t('modal.startTime')" optional>
          <TimePresetPicker v-model="editForm.dueTime" />
        </FormFieldGroup>
      </div>
      <!-- Calendar hint badge -->
      <div
        v-if="editForm.dueDate"
        class="font-outfit text-sky-silk-300 mt-2 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold"
        style="background: var(--tint-silk-20)"
      >
        <span>📅</span>
        {{ t('modal.willShowOnCalendar') }}
      </div>
    </div>

    <!-- 3. Family chip picker (multi-select, compact) -->
    <FormFieldGroup :label="t('todo.assignTo')">
      <FamilyChipPicker v-model="editForm.assigneeId" mode="single" compact />
    </FormFieldGroup>

    <!-- 4. Notes (optional) -->
    <FormFieldGroup :label="t('todo.description')" optional>
      <textarea
        v-model="editForm.description"
        rows="3"
        class="w-full rounded-[14px] border-2 border-transparent bg-[var(--tint-slate-5)] px-4 py-2.5 text-sm text-[var(--color-text)] transition-all focus:border-purple-500 focus:shadow-[0_0_0_3px_rgba(155,89,182,0.1)] focus:outline-none dark:bg-slate-700 dark:text-gray-200"
        :placeholder="t('todo.description')"
      />
    </FormFieldGroup>
  </BeanieFormModal>
</template>
