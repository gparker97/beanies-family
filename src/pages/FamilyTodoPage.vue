<script setup lang="ts">
import { ref, computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { confirm as showConfirm } from '@/composables/useConfirm';
import { useSounds } from '@/composables/useSounds';
import { useTodoStore } from '@/stores/todoStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useAuthStore } from '@/stores/authStore';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import EmptyStateIllustration from '@/components/ui/EmptyStateIllustration.vue';
import QuickAddBar from '@/components/todo/QuickAddBar.vue';
import TodoItemCard from '@/components/todo/TodoItemCard.vue';
import FilterBar from '@/components/todo/FilterBar.vue';
import MemberFilterChips from '@/components/todo/MemberFilterChips.vue';
import type { TodoFilter, TodoSort } from '@/components/todo/FilterBar.vue';
import type { TodoItem } from '@/types/models';

const { t } = useTranslation();
const { playWhoosh } = useSounds();
const todoStore = useTodoStore();
const familyStore = useFamilyStore();
const authStore = useAuthStore();

const currentMemberId = computed(() => authStore.currentUser?.memberId ?? '');

const memberOptions = computed(() =>
  familyStore.members.map((m) => ({ value: m.id, label: m.name }))
);

// Local filter state
const activeFilter = ref<TodoFilter>('all');
const sortBy = ref<TodoSort>('newest');
const memberFilter = ref('all');
const showCompletedSection = ref(false);

// View modal state
const showViewModal = ref(false);
const viewingTodo = ref<TodoItem | null>(null);

// Edit modal state
const showEditModal = ref(false);
const editingTodo = ref<TodoItem | null>(null);
const editForm = ref({
  title: '',
  description: '',
  assigneeId: '',
  dueDate: '',
  dueTime: '',
});
const isSubmitting = ref(false);

// Computed: filtered + sorted todos
const displayedOpenTodos = computed(() => {
  let items = todoStore.filteredOpenTodos;

  // Apply page-local member filter
  if (memberFilter.value !== 'all') {
    if (memberFilter.value === 'unassigned') {
      items = items.filter((t) => !t.assigneeId);
    } else {
      items = items.filter((t) => t.assigneeId === memberFilter.value);
    }
  }

  // Apply status filter
  if (activeFilter.value === 'scheduled') {
    items = items.filter((t) => t.dueDate);
  } else if (activeFilter.value === 'noDate') {
    items = items.filter((t) => !t.dueDate);
  }

  // Apply sort
  return applySorting(items);
});

const displayedCompletedTodos = computed(() => {
  let items = todoStore.filteredCompletedTodos;

  // Apply page-local member filter
  if (memberFilter.value !== 'all') {
    if (memberFilter.value === 'unassigned') {
      items = items.filter((t) => !t.assigneeId);
    } else {
      items = items.filter(
        (t) => t.assigneeId === memberFilter.value || t.completedBy === memberFilter.value
      );
    }
  }

  return items;
});

const hasAnyTodos = computed(() => todoStore.todos.length > 0);

function applySorting(items: TodoItem[]): TodoItem[] {
  const sorted = [...items];
  switch (sortBy.value) {
    case 'newest':
      return sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case 'oldest':
      return sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    case 'dueDate':
      return sorted.sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      });
    default:
      return sorted;
  }
}

// Actions
async function handleQuickAdd(payload: { title: string; dueDate?: string; assigneeId?: string }) {
  await todoStore.createTodo({
    title: payload.title,
    dueDate: payload.dueDate,
    assigneeId: payload.assigneeId,
    completed: false,
    createdBy: currentMemberId.value,
  });
}

async function handleToggle(id: string) {
  await todoStore.toggleComplete(id, currentMemberId.value);
}

// View modal helpers
const viewAssignee = computed(() => {
  if (!viewingTodo.value?.assigneeId) return null;
  return familyStore.members.find((m) => m.id === viewingTodo.value!.assigneeId);
});

const viewCompletedBy = computed(() => {
  if (!viewingTodo.value?.completedBy) return null;
  return familyStore.members.find((m) => m.id === viewingTodo.value!.completedBy);
});

const viewCreatedBy = computed(() => {
  if (!viewingTodo.value?.createdBy) return null;
  return familyStore.members.find((m) => m.id === viewingTodo.value!.createdBy);
});

const viewFormattedDate = computed(() => {
  if (!viewingTodo.value?.dueDate) return null;
  const date = new Date(viewingTodo.value.dueDate);
  return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
});

function openViewModal(todo: TodoItem) {
  viewingTodo.value = todo;
  showViewModal.value = true;
}

function closeViewModal() {
  showViewModal.value = false;
  viewingTodo.value = null;
}

function viewToDelete() {
  if (!viewingTodo.value) return;
  const id = viewingTodo.value.id;
  closeViewModal();
  handleDelete(id);
}

function viewToEdit() {
  if (!viewingTodo.value) return;
  const todo = viewingTodo.value;
  closeViewModal();
  openEditModal(todo);
}

function openEditModal(todo: TodoItem) {
  editingTodo.value = todo;
  editForm.value = {
    title: todo.title,
    description: todo.description ?? '',
    assigneeId: todo.assigneeId ?? '',
    dueDate: todo.dueDate?.split('T')[0] ?? '',
    dueTime: todo.dueTime ?? '',
  };
  showEditModal.value = true;
}

function closeEditModal() {
  showEditModal.value = false;
  editingTodo.value = null;
}

async function saveEdit() {
  if (!editingTodo.value || !editForm.value.title.trim()) return;
  isSubmitting.value = true;
  try {
    await todoStore.updateTodo(editingTodo.value.id, {
      title: editForm.value.title.trim(),
      description: editForm.value.description.trim() || undefined,
      assigneeId: editForm.value.assigneeId || undefined,
      dueDate: editForm.value.dueDate || undefined,
      dueTime: editForm.value.dueTime || undefined,
    });
    closeEditModal();
  } finally {
    isSubmitting.value = false;
  }
}

async function handleDelete(id: string) {
  if (
    await showConfirm({
      title: 'confirm.deleteTodoTitle',
      message: 'todo.deleteConfirm',
      variant: 'danger',
    })
  ) {
    await todoStore.deleteTodo(id);
    playWhoosh();
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Page header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="font-outfit text-[1.6rem] font-extrabold text-[var(--color-text)]">
          ✅ {{ t('todo.title') }}
        </h1>
        <p class="mt-0.5 text-sm text-[var(--color-text-muted)]">
          {{ t('todo.subtitle') }}
        </p>
      </div>
    </div>

    <!-- Quick add bar -->
    <QuickAddBar @add="handleQuickAdd" />

    <!-- Empty state -->
    <div v-if="!hasAnyTodos" class="py-12 text-center">
      <EmptyStateIllustration variant="goals" class="mb-4" />
      <p class="text-lg font-medium text-[var(--color-text)]">{{ t('todo.noTodos') }}</p>
      <p class="mt-1 text-sm text-[var(--color-text-muted)]">{{ t('todo.getStarted') }}</p>
    </div>

    <!-- Filters (only show when there are todos) -->
    <template v-if="hasAnyTodos">
      <FilterBar
        :active-filter="activeFilter"
        :sort-by="sortBy"
        @update:active-filter="activeFilter = $event"
        @update:sort-by="sortBy = $event"
      />

      <MemberFilterChips
        v-if="familyStore.members.length > 1"
        :selected="memberFilter"
        @update:selected="memberFilter = $event"
      />

      <!-- Open Tasks Section -->
      <div v-if="activeFilter !== 'done'">
        <p class="nook-section-label mb-2 text-purple-500">
          {{ t('todo.section.open') }} ({{ displayedOpenTodos.length }})
        </p>

        <div v-if="displayedOpenTodos.length === 0" class="py-6 text-center">
          <p class="text-sm text-[var(--color-text-muted)]">{{ t('todo.noTodos') }}</p>
        </div>

        <div class="space-y-2">
          <TodoItemCard
            v-for="todo in displayedOpenTodos"
            :key="todo.id"
            :todo="todo"
            @toggle="handleToggle"
            @view="openViewModal"
            @edit="openEditModal"
            @delete="handleDelete"
          />
        </div>
      </div>

      <!-- Completed Section -->
      <div v-if="activeFilter === 'done' || activeFilter === 'all'">
        <button
          v-if="activeFilter === 'all' && displayedCompletedTodos.length > 0"
          class="flex items-center gap-2 text-sm text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
          @click="showCompletedSection = !showCompletedSection"
        >
          <span class="text-xs opacity-50">{{ showCompletedSection ? '▲' : '▼' }}</span>
          <span class="nook-section-label text-green-600 dark:text-green-400">
            {{ t('todo.section.completed') }} ({{ displayedCompletedTodos.length }})
          </span>
        </button>

        <div v-if="activeFilter === 'done' || showCompletedSection" class="mt-2 space-y-2">
          <p
            v-if="activeFilter === 'done'"
            class="nook-section-label mb-2 text-green-600 dark:text-green-400"
          >
            {{ t('todo.section.completed') }} ({{ displayedCompletedTodos.length }})
          </p>
          <TodoItemCard
            v-for="todo in displayedCompletedTodos"
            :key="todo.id"
            :todo="todo"
            @toggle="handleToggle"
            @view="openViewModal"
            @edit="openEditModal"
            @delete="handleDelete"
          />
        </div>
      </div>
    </template>

    <!-- View Modal -->
    <BaseModal :open="showViewModal" :title="t('todo.viewTask')" @close="closeViewModal">
      <div v-if="viewingTodo" class="space-y-5">
        <!-- Title -->
        <h3
          class="font-outfit text-lg font-bold text-[var(--color-text)]"
          :class="{ 'line-through opacity-50': viewingTodo.completed }"
        >
          {{ viewingTodo.title }}
        </h3>

        <!-- Description -->
        <div>
          <p
            class="mb-1 text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase"
          >
            {{ t('todo.description') }}
          </p>
          <p
            v-if="viewingTodo.description"
            class="text-sm leading-relaxed text-[var(--color-text)]"
          >
            {{ viewingTodo.description }}
          </p>
          <p v-else class="text-sm text-[var(--color-text-muted)] italic">
            {{ t('todo.noDescription') }}
          </p>
        </div>

        <!-- Details grid -->
        <div class="grid grid-cols-2 gap-4">
          <!-- Status -->
          <div>
            <p
              class="mb-1 text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase"
            >
              {{ t('todo.status') }}
            </p>
            <span
              v-if="viewingTodo.completed"
              class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold text-green-700"
              style="background: var(--tint-success-10)"
            >
              ✅ {{ t('todo.status.completed') }}
            </span>
            <span
              v-else
              class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold text-purple-700"
              style="background: var(--tint-purple-15)"
            >
              {{ t('todo.status.open') }}
            </span>
          </div>

          <!-- Assignee -->
          <div>
            <p
              class="mb-1 text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase"
            >
              {{ t('todo.assignTo') }}
            </p>
            <span
              v-if="viewAssignee"
              class="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold text-white"
              :style="{
                background: `linear-gradient(135deg, ${viewAssignee.color}, ${viewAssignee.color}cc)`,
              }"
            >
              {{ viewAssignee.name }}
            </span>
            <span v-else class="text-sm text-[var(--color-text-muted)]">
              {{ t('todo.unassigned') }}
            </span>
          </div>

          <!-- Due date -->
          <div>
            <p
              class="mb-1 text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase"
            >
              {{ t('todo.dueDate') }}
            </p>
            <span
              v-if="viewFormattedDate"
              class="text-sm font-semibold"
              style="color: var(--color-primary)"
            >
              📅 {{ viewFormattedDate }}
              <template v-if="viewingTodo.dueTime"> &middot; {{ viewingTodo.dueTime }}</template>
            </span>
            <span v-else class="text-sm text-[var(--color-text-muted)]">
              {{ t('todo.noDueDate') }}
            </span>
          </div>

          <!-- Created by -->
          <div>
            <p
              class="mb-1 text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase"
            >
              {{ t('todo.createdBy') }}
            </p>
            <span v-if="viewCreatedBy" class="text-sm text-[var(--color-text)]">
              {{ viewCreatedBy.name }}
            </span>
            <span v-else class="text-sm text-[var(--color-text-muted)]">—</span>
          </div>
        </div>

        <!-- Completed by (if done) -->
        <div v-if="viewingTodo.completed && viewCompletedBy">
          <p
            class="mb-1 text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase"
          >
            {{ t('todo.doneBy') }}
          </p>
          <span class="text-sm text-[var(--color-text)]"> ✅ {{ viewCompletedBy.name }} </span>
        </div>
      </div>

      <template #footer>
        <div class="flex justify-between">
          <BaseButton @click="viewToEdit"> ✏️ {{ t('action.edit') }} </BaseButton>
          <BaseButton variant="secondary" class="text-red-500" @click="viewToDelete">
            🗑️ {{ t('action.delete') }}
          </BaseButton>
        </div>
      </template>
    </BaseModal>

    <!-- Edit Modal -->
    <BaseModal :open="showEditModal" :title="t('todo.editTask')" @close="closeEditModal">
      <form class="space-y-4" @submit.prevent="saveEdit">
        <BaseInput v-model="editForm.title" :label="t('todo.taskTitle')" required />

        <div class="space-y-1">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
            {{ t('todo.description') }}
          </label>
          <textarea v-model="editForm.description" rows="2" class="beanies-input w-full" />
        </div>

        <BaseSelect
          :model-value="editForm.assigneeId"
          :options="memberOptions"
          :label="t('todo.assignTo')"
          :placeholder="t('todo.unassigned')"
          @update:model-value="editForm.assigneeId = String($event)"
        />

        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ t('todo.dueDate') }}
            </label>
            <input v-model="editForm.dueDate" type="date" class="beanies-input w-full" />
          </div>
          <div class="space-y-1">
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {{ t('todo.dueTime') }}
            </label>
            <input v-model="editForm.dueTime" type="time" class="beanies-input w-full" />
          </div>
        </div>
      </form>

      <template #footer>
        <div class="flex justify-end gap-2">
          <BaseButton variant="secondary" @click="closeEditModal">
            {{ t('action.cancel') }}
          </BaseButton>
          <BaseButton :disabled="!editForm.title.trim() || isSubmitting" @click="saveEdit">
            {{ t('action.save') }}
          </BaseButton>
        </div>
      </template>
    </BaseModal>
  </div>
</template>
