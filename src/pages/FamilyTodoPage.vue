<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useSyncHighlight } from '@/composables/useSyncHighlight';
import { useTranslation } from '@/composables/useTranslation';
import { confirm as showConfirm } from '@/composables/useConfirm';
import { useSounds } from '@/composables/useSounds';
import { useTodoStore } from '@/stores/todoStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useAuthStore } from '@/stores/authStore';
import EmptyStateIllustration from '@/components/ui/EmptyStateIllustration.vue';
import TodoViewEditModal from '@/components/todo/TodoViewEditModal.vue';
import QuickAddBar from '@/components/todo/QuickAddBar.vue';
import TodoItemCard from '@/components/todo/TodoItemCard.vue';
import FilterBar from '@/components/todo/FilterBar.vue';
import MemberChipFilter from '@/components/common/MemberChipFilter.vue';
import type { TodoFilter, TodoSort } from '@/components/todo/FilterBar.vue';
import type { TodoItem } from '@/types/models';

const route = useRoute();
const { t } = useTranslation();
const { syncHighlightClass } = useSyncHighlight();
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

// View/edit modal
const selectedTodo = ref<TodoItem | null>(null);
const startInEditMode = ref(false);

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

function openViewModal(todo: TodoItem) {
  startInEditMode.value = false;
  selectedTodo.value = todo;
}

function openEditModal(todo: TodoItem) {
  startInEditMode.value = true;
  selectedTodo.value = todo;
}

// Open view modal from query param (e.g. navigated from Family Nook)
onMounted(() => {
  const viewId = route.query.view as string | undefined;
  if (viewId) {
    const todo = todoStore.todos.find((t) => t.id === viewId);
    if (todo) openViewModal(todo);
  }
});

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

      <MemberChipFilter
        v-if="familyStore.members.length > 1"
        :is-all-active="memberFilter === 'all'"
        :is-member-active="(id: string) => memberFilter === id"
        show-unassigned
        :is-unassigned-active="memberFilter === 'unassigned'"
        :all-label="t('todo.allBeans')"
        @select-all="memberFilter = 'all'"
        @select-member="memberFilter = $event"
        @select-unassigned="memberFilter = 'unassigned'"
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
          <div
            v-for="todo in displayedOpenTodos"
            :key="todo.id"
            :class="syncHighlightClass(todo.id)"
          >
            <TodoItemCard
              :todo="todo"
              @toggle="handleToggle"
              @view="openViewModal"
              @edit="openEditModal"
              @delete="handleDelete"
            />
          </div>
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
          <div
            v-for="todo in displayedCompletedTodos"
            :key="todo.id"
            :class="syncHighlightClass(todo.id)"
          >
            <TodoItemCard
              :todo="todo"
              @toggle="handleToggle"
              @view="openViewModal"
              @edit="openEditModal"
              @delete="handleDelete"
            />
          </div>
        </div>
      </div>
    </template>

    <TodoViewEditModal
      :todo="selectedTodo"
      :start-in-edit-mode="startInEditMode"
      @close="selectedTodo = null"
    />
  </div>
</template>
