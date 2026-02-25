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

// Local filter state
const activeFilter = ref<TodoFilter>('all');
const sortBy = ref<TodoSort>('newest');
const memberFilter = ref('all');
const showCompletedSection = ref(false);

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
  <div class="mx-auto max-w-3xl space-y-5">
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
            @edit="openEditModal"
            @delete="handleDelete"
          />
        </div>
      </div>
    </template>

    <!-- Edit Modal -->
    <BaseModal :open="showEditModal" :title="t('todo.editTask')" @close="closeEditModal">
      <form class="space-y-4" @submit.prevent="saveEdit">
        <BaseInput v-model="editForm.title" :label="t('todo.taskTitle')" required />

        <div>
          <label class="mb-1 block text-sm font-medium text-[var(--color-text)]">
            {{ t('todo.description') }}
          </label>
          <textarea
            v-model="editForm.description"
            rows="2"
            class="w-full rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm transition-colors outline-none focus:border-purple-400 dark:text-white"
          />
        </div>

        <div>
          <label class="mb-1 block text-sm font-medium text-[var(--color-text)]">
            {{ t('todo.assignTo') }}
          </label>
          <select
            v-model="editForm.assigneeId"
            class="w-full rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm transition-colors outline-none focus:border-purple-400 dark:text-white"
          >
            <option value="">{{ t('todo.unassigned') }}</option>
            <option v-for="member in familyStore.members" :key="member.id" :value="member.id">
              {{ member.name }}
            </option>
          </select>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-1 block text-sm font-medium text-[var(--color-text)]">
              {{ t('todo.dueDate') }}
            </label>
            <input
              v-model="editForm.dueDate"
              type="date"
              class="w-full rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm transition-colors outline-none focus:border-purple-400 dark:text-white"
            />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium text-[var(--color-text)]">
              {{ t('todo.dueTime') }}
            </label>
            <input
              v-model="editForm.dueTime"
              type="time"
              class="w-full rounded-lg border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm transition-colors outline-none focus:border-purple-400 dark:text-white"
            />
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
