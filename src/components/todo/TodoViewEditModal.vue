<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
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

type EditableField = 'title' | 'dueDate' | 'dueTime' | 'assignee' | 'description';

const props = defineProps<{
  todo: TodoItem | null;
}>();

const emit = defineEmits<{
  close: [];
  deleted: [id: string];
}>();

const { t } = useTranslation();
const { playWhoosh } = useSounds();
const todoStore = useTodoStore();
const familyStore = useFamilyStore();

// Which field is currently being inline-edited (null = none)
const editingField = ref<EditableField | null>(null);

// Per-field draft values
const draftTitle = ref('');
const draftDueDate = ref('');
const draftDueTime = ref('');
const draftAssigneeId = ref('');
const draftDescription = ref('');

// Template refs for auto-focus
const titleInputRef = ref<HTMLInputElement | null>(null);
const descriptionRef = ref<HTMLTextAreaElement | null>(null);

// Reset editing state when todo changes
watch(
  () => props.todo,
  () => {
    editingField.value = null;
  }
);

// Computed display values
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

// Inline editing functions
function startEdit(field: EditableField) {
  if (!props.todo) return;

  // Save current field first if switching
  if (editingField.value && editingField.value !== field) {
    saveField(editingField.value);
  }

  // Populate draft from current todo
  switch (field) {
    case 'title':
      draftTitle.value = props.todo.title;
      break;
    case 'dueDate':
      draftDueDate.value = props.todo.dueDate?.split('T')[0] ?? '';
      break;
    case 'dueTime':
      draftDueTime.value = props.todo.dueTime ?? '';
      break;
    case 'assignee':
      draftAssigneeId.value = props.todo.assigneeId ?? '';
      break;
    case 'description':
      draftDescription.value = props.todo.description ?? '';
      break;
  }

  editingField.value = field;

  // Auto-focus the input
  nextTick(() => {
    if (field === 'title') titleInputRef.value?.focus();
    if (field === 'description') descriptionRef.value?.focus();
  });
}

async function saveField(field: EditableField) {
  if (!props.todo) return;
  editingField.value = null;

  // Build update payload — only include the changed field.
  // Use `null` (not `undefined`) to clear optional fields, because the
  // Automerge repository's stripUndefined() treats `undefined` as "skip".
  const update: Record<string, string | boolean | null> = {};
  let changed = false;

  switch (field) {
    case 'title': {
      const trimmed = draftTitle.value.trim();
      // Title is required — revert if empty
      if (!trimmed) return;
      if (trimmed !== props.todo.title) {
        update.title = trimmed;
        changed = true;
      }
      break;
    }
    case 'dueDate': {
      const newDate = draftDueDate.value || null;
      const currentDate = props.todo.dueDate?.split('T')[0] ?? null;
      if (newDate !== currentDate) {
        update.dueDate = newDate;
        changed = true;
        // Clear time if date is cleared
        if (!newDate) {
          update.dueTime = null;
        }
      }
      break;
    }
    case 'dueTime': {
      const newTime = draftDueTime.value || null;
      const currentTime = props.todo.dueTime ?? null;
      if (newTime !== currentTime) {
        update.dueTime = newTime;
        changed = true;
      }
      break;
    }
    case 'assignee': {
      const newAssignee = draftAssigneeId.value || null;
      const currentAssignee = props.todo.assigneeId ?? null;
      if (newAssignee !== currentAssignee) {
        update.assigneeId = newAssignee;
        changed = true;
      }
      break;
    }
    case 'description': {
      const trimmed = draftDescription.value.trim() || null;
      const currentDesc = props.todo.description ?? null;
      if (trimmed !== currentDesc) {
        update.description = trimmed;
        changed = true;
      }
      break;
    }
  }

  if (changed) {
    await todoStore.updateTodo(props.todo.id, update);
  }
}

function cancelEdit() {
  editingField.value = null;
}

function handleTitleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault();
    saveField('title');
  } else if (e.key === 'Escape') {
    cancelEdit();
  }
}

function handleDescriptionKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    saveField('description');
  } else if (e.key === 'Escape') {
    cancelEdit();
  }
}

function handleDateKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    cancelEdit();
  }
}

// Auto-save handlers for picker components
function handleTimeChange(value: string) {
  draftDueTime.value = value;
  saveField('dueTime');
}

function handleAssigneeChange(value: string | string[]) {
  draftAssigneeId.value = value as string;
  saveField('assignee');
}

// Close modal — save any in-progress edit first
function handleClose() {
  if (editingField.value) {
    saveField(editingField.value);
  }
  emit('close');
}

// "Done" button — save current edit, close
function handleDone() {
  if (editingField.value) {
    saveField(editingField.value);
  }
  emit('close');
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
  <BeanieFormModal
    v-if="todo"
    :open="true"
    :title="t('todo.viewTask')"
    icon="✅"
    icon-bg="var(--tint-purple-12)"
    size="narrow"
    :save-label="t('action.done')"
    save-gradient="purple"
    :show-delete="true"
    @close="handleClose"
    @save="handleDone"
    @delete="handleDelete"
  >
    <div class="space-y-3">
      <!-- Task title — inline editable -->
      <div
        class="group/field rounded-lg px-1 py-0.5 transition-colors"
        :class="
          editingField === 'title'
            ? ''
            : 'cursor-pointer hover:bg-[var(--tint-purple-5)] [@media(hover:hover)]:cursor-pointer'
        "
        @click="editingField !== 'title' && startEdit('title')"
      >
        <!-- Display state -->
        <div v-if="editingField !== 'title'" class="relative flex items-center gap-2">
          <span
            class="font-outfit text-xl font-bold text-[var(--color-text)] dark:text-gray-100"
            :class="[
              todo.completed ? 'line-through opacity-50' : '',
              'border-b border-dotted border-transparent group-hover/field:border-[var(--color-text-muted)]',
            ]"
          >
            {{ todo.title }}
          </span>
          <svg
            class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)] opacity-0 [@media(hover:hover)]:group-hover/field:opacity-40"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            viewBox="0 0 24 24"
          >
            <path
              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
            />
          </svg>
        </div>
        <!-- Edit state -->
        <div v-else class="flex items-center gap-2">
          <input
            ref="titleInputRef"
            v-model="draftTitle"
            type="text"
            class="font-outfit w-full rounded-md border-none bg-transparent px-1 text-xl font-bold text-[var(--color-text)] ring-2 ring-purple-500/30 outline-none dark:text-gray-100"
            @keydown="handleTitleKeydown"
          />
          <button
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-purple-600 transition-colors hover:bg-purple-100 dark:hover:bg-purple-900/30"
            @click.stop="saveField('title')"
          >
            <svg
              class="h-4 w-4"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              viewBox="0 0 24 24"
            >
              <path d="M5 13l4 4L19 7" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Status — non-editable -->
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

      <!-- Due date — inline editable -->
      <FormFieldGroup :label="t('todo.dueDate')">
        <div
          class="group/field rounded-lg transition-colors"
          :class="
            editingField === 'dueDate'
              ? ''
              : 'cursor-pointer hover:bg-[var(--tint-purple-5)] [@media(hover:hover)]:cursor-pointer'
          "
          @click="editingField !== 'dueDate' && startEdit('dueDate')"
        >
          <!-- Display state -->
          <div v-if="editingField !== 'dueDate'" class="relative flex items-center gap-2">
            <span
              v-if="viewFormattedDate && viewIsOverdue"
              class="font-outfit inline-flex items-center gap-1.5 rounded-full bg-[var(--color-primary-500)] px-3 py-1.5 text-xs font-semibold text-white"
            >
              {{ viewFormattedDate }}
              <template v-if="todo.dueTime"> &middot; {{ todo.dueTime }}</template>
              <span class="rounded-full bg-white/25 px-1.5 py-px text-xs font-bold uppercase">
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
            <svg
              class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)] opacity-0 [@media(hover:hover)]:group-hover/field:opacity-40"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
              />
            </svg>
          </div>
          <!-- Edit state -->
          <div v-else class="flex items-center gap-2" @click.stop>
            <div class="flex-1">
              <BaseInput
                v-model="draftDueDate"
                type="date"
                class="rounded-[14px] ring-2 ring-purple-500/30"
                @keydown="handleDateKeydown"
              />
            </div>
            <button
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-purple-600 transition-colors hover:bg-purple-100 dark:hover:bg-purple-900/30"
              @click.stop="saveField('dueDate')"
            >
              <svg
                class="h-4 w-4"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                viewBox="0 0 24 24"
              >
                <path d="M5 13l4 4L19 7" />
              </svg>
            </button>
          </div>
        </div>
      </FormFieldGroup>

      <!-- Due time — only shown when date exists, inline editable -->
      <FormFieldGroup
        v-if="todo.dueDate || editingField === 'dueDate'"
        :label="t('modal.startTime')"
      >
        <div
          class="group/field rounded-lg transition-colors"
          :class="
            editingField === 'dueTime'
              ? ''
              : 'cursor-pointer hover:bg-[var(--tint-purple-5)] [@media(hover:hover)]:cursor-pointer'
          "
          @click="
            editingField !== 'dueTime' && (todo.dueDate || draftDueDate) && startEdit('dueTime')
          "
        >
          <!-- Display state -->
          <div v-if="editingField !== 'dueTime'" class="relative flex items-center gap-2">
            <span
              v-if="todo.dueTime"
              class="font-outfit text-sm font-semibold text-[var(--color-text)]"
            >
              {{ todo.dueTime }}
            </span>
            <span v-else class="text-sm text-[var(--color-text-muted)]">
              {{ t('modal.selectTime') }}
            </span>
            <svg
              class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)] opacity-0 [@media(hover:hover)]:group-hover/field:opacity-40"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
              />
            </svg>
          </div>
          <!-- Edit state -->
          <div v-else @click.stop>
            <TimePresetPicker :model-value="draftDueTime" @update:model-value="handleTimeChange" />
          </div>
        </div>
      </FormFieldGroup>

      <!-- Assignee — inline editable -->
      <FormFieldGroup :label="t('todo.assignTo')">
        <div
          class="group/field rounded-lg transition-colors"
          :class="
            editingField === 'assignee'
              ? ''
              : 'cursor-pointer hover:bg-[var(--tint-purple-5)] [@media(hover:hover)]:cursor-pointer'
          "
          @click="editingField !== 'assignee' && startEdit('assignee')"
        >
          <!-- Display state -->
          <div v-if="editingField !== 'assignee'" class="relative flex items-center gap-2">
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
            <svg
              class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)] opacity-0 [@media(hover:hover)]:group-hover/field:opacity-40"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
              />
            </svg>
          </div>
          <!-- Edit state -->
          <div v-else @click.stop>
            <FamilyChipPicker
              :model-value="draftAssigneeId"
              mode="single"
              compact
              @update:model-value="handleAssigneeChange"
            />
          </div>
        </div>
      </FormFieldGroup>

      <!-- Description — inline editable -->
      <FormFieldGroup :label="t('todo.description')">
        <div
          class="group/field rounded-lg transition-colors"
          :class="
            editingField === 'description'
              ? ''
              : 'cursor-pointer hover:bg-[var(--tint-purple-5)] [@media(hover:hover)]:cursor-pointer'
          "
          @click="editingField !== 'description' && startEdit('description')"
        >
          <!-- Display state -->
          <div v-if="editingField !== 'description'" class="relative flex items-start gap-2">
            <p
              v-if="todo.description"
              class="text-sm leading-relaxed whitespace-pre-line text-[var(--color-text)] dark:text-gray-300"
            >
              {{ todo.description }}
            </p>
            <p v-else class="text-sm text-[var(--color-text-muted)] italic">
              {{ t('todo.noDescription') }}
            </p>
            <svg
              class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)] opacity-0 [@media(hover:hover)]:group-hover/field:opacity-40"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
              />
            </svg>
          </div>
          <!-- Edit state -->
          <div v-else class="space-y-2" @click.stop>
            <textarea
              ref="descriptionRef"
              v-model="draftDescription"
              rows="3"
              class="w-full rounded-[14px] border-2 border-transparent bg-[var(--tint-slate-5)] px-4 py-2.5 text-sm text-[var(--color-text)] ring-2 ring-purple-500/30 transition-all focus:border-purple-500 focus:shadow-[0_0_0_3px_rgba(155,89,182,0.1)] focus:outline-none dark:bg-slate-700 dark:text-gray-200"
              :placeholder="t('todo.description')"
              @keydown="handleDescriptionKeydown"
            />
            <div class="flex items-center justify-between">
              <span class="text-xs text-[var(--color-text-muted)]">
                Ctrl+Enter {{ t('modal.toSave') }}
              </span>
              <button
                class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-purple-600 transition-colors hover:bg-purple-100 dark:hover:bg-purple-900/30"
                @click.stop="saveField('description')"
              >
                <svg
                  class="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  viewBox="0 0 24 24"
                >
                  <path d="M5 13l4 4L19 7" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </FormFieldGroup>

      <!-- Created by / Completed by — non-editable -->
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
</template>
