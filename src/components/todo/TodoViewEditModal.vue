<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { confirm as showConfirm } from '@/composables/useConfirm';
import { useSounds } from '@/composables/useSounds';
import { useInlineEdit } from '@/composables/useInlineEdit';
import { useTodoStore } from '@/stores/todoStore';
import { useFamilyStore } from '@/stores/familyStore';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import InlineEditField from '@/components/ui/InlineEditField.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import MemberChip from '@/components/ui/MemberChip.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import TimePresetPicker from '@/components/ui/TimePresetPicker.vue';
import { extractUrls, getUrlDomain, getUrlLabel, getFaviconUrl } from '@/utils/url';
import { normalizeAssignees, toAssigneePayload } from '@/utils/assignees';
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
const { playWhoosh, playPop } = useSounds();
const todoStore = useTodoStore();
const familyStore = useFamilyStore();

// Live-lookup from store so display stays reactive after inline edits
const todo = computed(() =>
  props.todo ? (todoStore.todos.find((t) => t.id === props.todo!.id) ?? props.todo) : null
);

// Per-field draft values
const draftTitle = ref('');
const draftDueDate = ref('');
const draftDueTime = ref('');
const draftAssigneeIds = ref<string[]>([]);
const draftDescription = ref('');

// Template refs for auto-focus
const titleInputRef = ref<HTMLInputElement | null>(null);
const descriptionRef = ref<HTMLTextAreaElement | null>(null);

const { editingField, startEdit, saveField, cancelEdit, saveAndClose } =
  useInlineEdit<EditableField>({
    populateDraft(field) {
      if (!todo.value) return;
      switch (field) {
        case 'title':
          draftTitle.value = todo.value.title;
          break;
        case 'dueDate':
          draftDueDate.value = todo.value.dueDate?.split('T')[0] ?? '';
          break;
        case 'dueTime':
          draftDueTime.value = todo.value.dueTime ?? '';
          break;
        case 'assignee':
          draftAssigneeIds.value = [...normalizeAssignees(todo.value)];
          break;
        case 'description':
          draftDescription.value = todo.value.description ?? '';
          break;
      }
      nextTick(() => {
        if (field === 'title') titleInputRef.value?.focus();
        if (field === 'description') descriptionRef.value?.focus();
      });
    },
    async saveDraft(field) {
      if (!todo.value) return;
      const update: Record<string, string | boolean | null> = {};
      let changed = false;

      switch (field) {
        case 'title': {
          const trimmed = draftTitle.value.trim();
          if (!trimmed) return;
          if (trimmed !== todo.value.title) {
            update.title = trimmed;
            changed = true;
          }
          break;
        }
        case 'dueDate': {
          const newDate = draftDueDate.value || null;
          const currentDate = todo.value.dueDate?.split('T')[0] ?? null;
          if (newDate !== currentDate) {
            update.dueDate = newDate;
            changed = true;
            if (!newDate) update.dueTime = null;
          }
          break;
        }
        case 'dueTime': {
          const newTime = draftDueTime.value || null;
          const currentTime = todo.value.dueTime ?? null;
          if (newTime !== currentTime) {
            update.dueTime = newTime;
            changed = true;
          }
          break;
        }
        case 'assignee': {
          const current = normalizeAssignees(todo.value);
          const draft = draftAssigneeIds.value;
          if (JSON.stringify(draft) !== JSON.stringify(current)) {
            const payload = toAssigneePayload(draft);
            update.assigneeIds = payload.assigneeIds as any;
            update.assigneeId = (payload.assigneeId ?? null) as any;
            changed = true;
          }
          break;
        }
        case 'description': {
          const trimmed = draftDescription.value.trim() || null;
          const currentDesc = todo.value.description ?? null;
          if (trimmed !== currentDesc) {
            update.description = trimmed;
            changed = true;
          }
          break;
        }
      }

      if (changed) {
        await todoStore.updateTodo(todo.value.id, update);
      }
    },
  });

// Reset editing state when todo changes
watch(
  () => props.todo,
  () => {
    editingField.value = null;
  }
);

// Computed display values
const viewAssigneeIds = computed(() => (todo.value ? normalizeAssignees(todo.value) : []));

const viewCompletedBy = computed(() => {
  if (!todo.value?.completedBy) return null;
  return familyStore.members.find((m) => m.id === todo.value!.completedBy);
});

const viewCreatedBy = computed(() => {
  if (!todo.value?.createdBy) return null;
  return familyStore.members.find((m) => m.id === todo.value!.createdBy);
});

const viewIsOverdue = computed(() => {
  if (!todo.value || todo.value.completed || !todo.value.dueDate) return false;
  const now = new Date();
  const dueDate = new Date(todo.value.dueDate);
  if (todo.value.dueTime) {
    const parts = todo.value.dueTime.split(':').map(Number);
    dueDate.setHours(parts[0] ?? 23, parts[1] ?? 59, 0, 0);
  } else {
    dueDate.setHours(23, 59, 59, 999);
  }
  return now > dueDate;
});

const viewFormattedDate = computed(() => {
  if (!todo.value?.dueDate) return null;
  const date = new Date(todo.value.dueDate);
  return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
});

// Detected links from title + description
const detectedLinks = computed(() => {
  if (!todo.value) return [];
  const texts = [todo.value.title, todo.value.description ?? ''].join(' ');
  return extractUrls(texts).map((url) => ({
    url,
    domain: getUrlDomain(url),
    label: getUrlLabel(url),
    favicon: getFaviconUrl(url),
  }));
});

// Keyboard handlers
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
  draftAssigneeIds.value = Array.isArray(value) ? value : value ? [value] : [];
}

// Toggle complete/reopen
async function handleToggleComplete() {
  if (!todo.value) return;
  const wasOpen = !todo.value.completed;
  await todoStore.toggleComplete(todo.value.id, familyStore.currentMember?.id ?? '');
  playPop();
  // If completing (not reopening), close modal after a short delay
  // to let the celebration animation start
  if (wasOpen) {
    setTimeout(() => emit('close'), 300);
  }
}

// Close/Done/Delete handlers
function handleClose() {
  saveAndClose();
  emit('close');
}

function handleDone() {
  saveAndClose();
  emit('close');
}

async function handleDelete() {
  if (!todo.value) return;
  const id = todo.value.id;
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
      <InlineEditField
        :editing="editingField === 'title'"
        tint-color="purple"
        @start-edit="startEdit('title')"
      >
        <template #view>
          <span
            class="font-outfit text-xl font-bold text-[var(--color-text)] dark:text-gray-100"
            :class="[
              todo.completed ? 'line-through opacity-50' : '',
              'border-b border-dotted border-transparent group-hover/field:border-[var(--color-text-muted)]',
            ]"
          >
            {{ todo.title }}
          </span>
        </template>
        <template #edit>
          <div class="flex items-center gap-2">
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
        </template>
      </InlineEditField>

      <!-- Status badge -->
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
        <InlineEditField
          :editing="editingField === 'dueDate'"
          tint-color="purple"
          @start-edit="startEdit('dueDate')"
        >
          <template #view>
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
          </template>
          <template #edit>
            <div class="flex items-center gap-2">
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
          </template>
        </InlineEditField>
      </FormFieldGroup>

      <!-- Due time — only shown when date exists, inline editable -->
      <FormFieldGroup
        v-if="todo.dueDate || editingField === 'dueDate'"
        :label="t('modal.startTime')"
      >
        <InlineEditField
          :editing="editingField === 'dueTime'"
          tint-color="purple"
          @start-edit="(todo.dueDate || draftDueDate) && startEdit('dueTime')"
        >
          <template #view>
            <span
              v-if="todo.dueTime"
              class="font-outfit text-sm font-semibold text-[var(--color-text)]"
            >
              {{ todo.dueTime }}
            </span>
            <span v-else class="text-sm text-[var(--color-text-muted)]">
              {{ t('modal.selectTime') }}
            </span>
          </template>
          <template #edit>
            <TimePresetPicker :model-value="draftDueTime" @update:model-value="handleTimeChange" />
          </template>
        </InlineEditField>
      </FormFieldGroup>

      <!-- Assignee — inline editable -->
      <FormFieldGroup :label="t('todo.assignTo')">
        <InlineEditField
          :editing="editingField === 'assignee'"
          tint-color="purple"
          @start-edit="startEdit('assignee')"
        >
          <template #view>
            <div v-if="viewAssigneeIds.length" class="flex flex-wrap gap-1">
              <MemberChip v-for="mid in viewAssigneeIds" :key="mid" :member-id="mid" size="md" />
            </div>
            <span v-else class="text-sm text-[var(--color-text-muted)]">
              {{ t('todo.unassigned') }}
            </span>
          </template>
          <template #edit>
            <FamilyChipPicker
              :model-value="draftAssigneeIds"
              mode="multi"
              compact
              @update:model-value="handleAssigneeChange"
            />
            <div class="mt-1.5 flex gap-1.5">
              <button
                class="rounded-lg bg-[var(--color-primary-500)] px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-[var(--color-primary-600)]"
                @click="saveField('assignee')"
              >
                ✓
              </button>
              <button
                class="rounded-lg bg-gray-200 px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-300 dark:bg-gray-600 dark:text-gray-300 dark:hover:bg-gray-500"
                @click="cancelEdit"
              >
                ✕
              </button>
            </div>
          </template>
        </InlineEditField>
      </FormFieldGroup>

      <!-- Description — inline editable -->
      <FormFieldGroup :label="t('todo.description')">
        <InlineEditField
          :editing="editingField === 'description'"
          tint-color="purple"
          align-items="start"
          @start-edit="startEdit('description')"
        >
          <template #view>
            <p
              v-if="todo.description"
              class="text-sm leading-relaxed whitespace-pre-line text-[var(--color-text)] dark:text-gray-300"
            >
              {{ todo.description }}
            </p>
            <p v-else class="text-sm text-[var(--color-text-muted)] italic">
              {{ t('todo.noDescription') }}
            </p>
          </template>
          <template #edit>
            <div class="space-y-2">
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
          </template>
        </InlineEditField>
      </FormFieldGroup>

      <!-- Detected links -->
      <FormFieldGroup v-if="detectedLinks.length > 0" :label="t('todo.links')">
        <div class="space-y-1.5">
          <a
            v-for="link in detectedLinks"
            :key="link.url"
            :href="link.url"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-[var(--tint-purple-8)] dark:hover:bg-purple-900/20"
            @click.stop
          >
            <img
              :src="link.favicon"
              :alt="link.domain"
              width="16"
              height="16"
              class="h-4 w-4 shrink-0 rounded-sm"
              loading="lazy"
            />
            <span class="min-w-0 flex-1 truncate font-medium text-purple-600 dark:text-purple-400">
              {{ link.label }}
            </span>
            <svg
              class="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path
                d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"
              />
            </svg>
          </a>
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

      <!-- Complete / Reopen action (bottom of modal) -->
      <div class="border-t border-gray-100 pt-3 dark:border-slate-700">
        <button
          v-if="!todo.completed"
          type="button"
          class="font-outfit flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold text-white transition-all duration-150 hover:opacity-90 active:scale-[0.98]"
          style="background: linear-gradient(135deg, #27ae60, #2ecc71)"
          @click="handleToggleComplete"
        >
          <span>✓</span>
          {{ t('action.markCompleted') }}
        </button>
        <button
          v-else
          type="button"
          class="font-outfit flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold text-purple-600 transition-colors hover:bg-purple-50 active:bg-purple-100 dark:hover:bg-purple-900/20"
          @click="handleToggleComplete"
        >
          {{ t('todo.reopenTask') }}
        </button>
      </div>
    </div>
  </BeanieFormModal>
</template>
