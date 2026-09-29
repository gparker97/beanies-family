<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { confirm as showConfirm } from '@/composables/useConfirm';
import { useSounds } from '@/composables/useSounds';
import { useInlineEdit } from '@/composables/useInlineEdit';
import { useTodoStore } from '@/stores/todoStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useActivityStore } from '@/stores/activityStore';
import BeanieFormModal from '@/components/ui/BeanieFormModal.vue';
import InlineEditField from '@/components/ui/InlineEditField.vue';
import FrequencyChips from '@/components/ui/FrequencyChips.vue';
import FamilyChipPicker from '@/components/ui/FamilyChipPicker.vue';
import MemberChip from '@/components/ui/MemberChip.vue';
import FormFieldGroup from '@/components/ui/FormFieldGroup.vue';
import CreatedMeta from '@/components/common/CreatedMeta.vue';
import BeanieDatePicker from '@/components/ui/BeanieDatePicker.vue';
import TimePresetPicker from '@/components/ui/TimePresetPicker.vue';
import LinkList from '@/components/ui/LinkList.vue';
import LinkedActivityChip from '@/components/todo/LinkedActivityChip.vue';
import { todoLink } from '@/utils/activityLinks';
import { extractUrls } from '@/utils/url';
import { formatDateWithDay } from '@/utils/date';
import { normalizeAssignees, toAssigneePayload } from '@/utils/assignees';
import { isTodoOverdue, isTodoDueToday } from '@/utils/todo';
import type { TodoItem } from '@/types/models';

type EditableField = 'title' | 'dueDate' | 'dueTime' | 'assignee' | 'description';

const props = defineProps<{
  todo: TodoItem | null;
  /** Opened over another drawer (e.g. an activity's, #114): sits on the overlay layer. */
  stacked?: boolean;
  /** Opened from inside the linked activity itself: hide the row pointing back at it. */
  hideActivityLink?: boolean;
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

const viewIsOverdue = computed(() => (todo.value ? isTodoOverdue(todo.value) : false));
const viewIsDueToday = computed(() => (todo.value ? isTodoDueToday(todo.value) : false));

const viewFormattedDate = computed(() => {
  if (!todo.value?.dueDate) return null;
  const dateStr = todo.value.dueDate.split('T')[0] ?? todo.value.dueDate;
  return formatDateWithDay(dateStr);
});

// The field hides with the chip: `activityId` is a soft reference that may point at a
// deleted activity or a cancelled session. Same resolver as the chip, so the label and
// its body can never disagree (#114).
const activityStore = useActivityStore();
const linkedActivityShown = computed(() => {
  const link = todo.value ? todoLink(todo.value) : null;
  return !props.hideActivityLink && !!link && !!activityStore.resolveActivityLink(link);
});

// Detected links from title + description (rendered, with safe hrefs, by LinkList)
const detectedLinks = computed(() => {
  if (!todo.value) return [];
  return extractUrls([todo.value.title, todo.value.description ?? ''].join(' '));
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

// Auto-save handlers for picker components
function handleTimeChange(value: string) {
  draftDueTime.value = value;
  saveField('dueTime');
}

function handleAssigneeChange(value: string | string[]) {
  draftAssigneeIds.value = Array.isArray(value) ? value : value ? [value] : [];
}

// "Track as" — to-do vs. someday/maybe. Going someday clears the due date/time
// (handled in `todoStore.setSomeday`); the live `todo` re-renders. Errors
// surface via `updateTodo`'s toast path; this never rejects.
const kindOptions = computed(() => [
  { value: 'todo', label: t('todo.kind.todo'), icon: '📋' },
  { value: 'someday', label: t('todo.someday'), icon: '💭' },
]);
function handleKindChange(value: string) {
  if (todo.value) void todoStore.setSomeday(todo.value.id, value === 'someday');
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
    variant="drawer"
    :open="true"
    :layer="stacked ? 'overlay' : 'base'"
    :title="t('todo.viewTask')"
    icon="✅"
    icon-bg="var(--tint-purple-12)"
    size="narrow"
    :save-label="t('action.close')"
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
            class="font-outfit dark:text-ink text-xl font-bold text-[var(--color-text)]"
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
              class="font-outfit dark:text-ink w-full rounded-md border-none bg-transparent px-1 text-xl font-bold text-[var(--color-text)] ring-2 ring-purple-500/30 outline-none"
              @keydown="handleTitleKeydown"
            />
            <button
              class="dark:text-purple-lift flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-purple-600 transition-colors hover:bg-purple-100 dark:hover:bg-purple-900/30"
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

      <!-- Track as: To-do vs. Someday · Maybe (hidden once completed) -->
      <FormFieldGroup v-if="!todo.completed" :label="t('todo.kind')">
        <FrequencyChips
          :model-value="todo.someday ? 'someday' : 'todo'"
          :options="kindOptions"
          @update:model-value="handleKindChange"
        />
      </FormFieldGroup>

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
          v-else-if="todo.someday"
          class="font-outfit inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-sky-700 dark:text-sky-300"
          style="background: var(--tint-silk-20)"
        >
          <!-- eslint-disable-next-line vue/no-bare-strings-in-template -->
          <span aria-hidden="true">💭</span> {{ t('todo.someday') }}
        </span>
        <span
          v-else
          class="font-outfit inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold text-purple-700"
          style="background: var(--tint-purple-15)"
        >
          {{ t('todo.status.open') }}
        </span>
      </FormFieldGroup>

      <!-- Due date — inline editable (hidden for someday · maybe items) -->
      <FormFieldGroup v-if="!todo.someday" :label="t('todo.dueDate')">
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
              v-else-if="viewFormattedDate && viewIsDueToday"
              class="font-outfit dark:text-accent-lift inline-flex items-center gap-1.5 rounded-full bg-[var(--tint-orange-15)] px-3 py-1.5 text-xs font-semibold text-[var(--color-primary-500)]"
            >
              {{ t('date.today') }}
              <template v-if="todo.dueTime"> &middot; {{ todo.dueTime }}</template>
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
                <BeanieDatePicker v-model="draftDueDate" />
              </div>
              <button
                class="dark:text-purple-lift flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-purple-600 transition-colors hover:bg-purple-100 dark:hover:bg-purple-900/30"
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

      <!-- Due time — only shown when a date exists (never for someday · maybe), inline editable -->
      <FormFieldGroup
        v-if="!todo.someday && (todo.dueDate || editingField === 'dueDate')"
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
                class="dark:bg-surface-hover dark:text-ink-soft dark:hover:bg-surface-hover rounded-lg bg-gray-200 px-3 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-300"
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
              class="dark:text-ink-soft text-sm leading-relaxed whitespace-pre-line text-[var(--color-text)]"
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
                class="dark:bg-surface-overlay dark:text-ink w-full rounded-[14px] border-2 border-transparent bg-[var(--tint-slate-5)] px-4 py-2.5 text-base text-[var(--color-text)] ring-2 ring-purple-500/30 transition-all focus:border-purple-500 focus:shadow-[0_0_0_3px_rgba(155,89,182,0.1)] focus:outline-none"
                :placeholder="t('todo.description')"
                @keydown="handleDescriptionKeydown"
              />
              <div class="flex items-center justify-between">
                <span class="text-xs text-[var(--color-text-muted)]">
                  Ctrl+Enter {{ t('modal.toSave') }}
                </span>
                <button
                  class="dark:text-purple-lift flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-purple-600 transition-colors hover:bg-purple-100 dark:hover:bg-purple-900/30"
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

      <!-- Linked activity (magic beans shared result). LinkedActivityChip renders nothing
           when the activity no longer resolves, so the field hides with it. -->
      <FormFieldGroup v-if="linkedActivityShown" :label="t('todo.linkedActivity')">
        <LinkedActivityChip
          :activity-id="todo.activityId!"
          :activity-date="todo.activityDate"
          variant="row"
          @open="handleClose"
        />
      </FormFieldGroup>

      <!-- Detected links -->
      <FormFieldGroup v-if="detectedLinks.length > 0" :label="t('todo.links')">
        <LinkList :urls="detectedLinks" />
      </FormFieldGroup>

      <!-- Done by — non-editable (only once completed) -->
      <FormFieldGroup v-if="todo.completed && viewCompletedBy" :label="t('todo.doneBy')">
        <span class="dark:text-ink-soft text-sm text-[var(--color-text)]">
          {{ viewCompletedBy.name }}
        </span>
      </FormFieldGroup>

      <!-- Created by + when — shared subtle footer (standard convention) -->
      <CreatedMeta :created-by="todo.createdBy" :created-at="todo.createdAt" />
    </div>

    <!-- Complete / Reopen button in the footer, next to close -->
    <template #footer-start>
      <button
        v-if="!todo.completed"
        type="button"
        class="font-outfit flex flex-1 items-center justify-center gap-2 rounded-[16px] py-3.5 text-sm font-bold text-white shadow-sm transition-all duration-200 hover:shadow-md active:scale-[0.98]"
        style="background: linear-gradient(135deg, #27ae60, #2ecc71)"
        @click="handleToggleComplete"
      >
        <span>✓</span>
        {{ t('action.markCompleted') }}
      </button>
      <button
        v-else
        type="button"
        class="font-outfit dark:text-purple-lift flex flex-1 items-center justify-center gap-2 rounded-[16px] py-3.5 text-sm font-semibold text-purple-600 transition-colors hover:bg-purple-50 active:bg-purple-100 dark:hover:bg-purple-900/20"
        @click="handleToggleComplete"
      >
        {{ t('todo.reopenTask') }}
      </button>
    </template>
  </BeanieFormModal>
</template>
