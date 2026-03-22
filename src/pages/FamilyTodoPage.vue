<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSyncHighlight } from '@/composables/useSyncHighlight';
import { useTranslation } from '@/composables/useTranslation';
import { confirm as showConfirm } from '@/composables/useConfirm';
import { useSounds } from '@/composables/useSounds';
import { normalizeAssignees, toAssigneePayload } from '@/utils/assignees';
import { useTodoStore } from '@/stores/todoStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useAuthStore } from '@/stores/authStore';
import EmptyStateIllustration from '@/components/ui/EmptyStateIllustration.vue';
import TodoViewEditModal from '@/components/todo/TodoViewEditModal.vue';
import QuickAddBar from '@/components/todo/QuickAddBar.vue';
import TodoItemCard from '@/components/todo/TodoItemCard.vue';
import type { TodoSort } from '@/components/todo/FilterBar.vue';
import type { TodoItem } from '@/types/models';
import { useBreakpoint } from '@/composables/useBreakpoint';

const route = useRoute();
const router = useRouter();
const { t } = useTranslation();
const { syncHighlightClass } = useSyncHighlight();
const { playWhoosh } = useSounds();
const todoStore = useTodoStore();
const familyStore = useFamilyStore();
const authStore = useAuthStore();

const currentMemberId = computed(() => authStore.currentUser?.memberId ?? '');

// Local filter state
const sortBy = ref<TodoSort>('newest');
const memberFilter = ref('all');
const showCompletedSection = ref(false);

const { isDesktop } = useBreakpoint();

// Ref to QuickAddBar for auto-focus
const quickAddBar = ref<InstanceType<typeof QuickAddBar> | null>(null);

// View/edit modal — store ID, derive live object from store for reactivity
const selectedTodoId = ref<string | null>(null);
const selectedTodo = computed(() =>
  selectedTodoId.value ? (todoStore.todos.find((t) => t.id === selectedTodoId.value) ?? null) : null
);

// Sorted members for chip filter
const sortedMembers = computed(() =>
  [...familyStore.members].sort((a, b) => a.name.localeCompare(b.name))
);

// Computed: filtered + sorted todos
const displayedOpenTodos = computed(() => {
  let items = todoStore.filteredOpenTodos;

  // Apply page-local member filter
  if (memberFilter.value !== 'all') {
    items = items.filter((t) => normalizeAssignees(t).includes(memberFilter.value));
  }

  // Apply sort
  return applySorting(items);
});

const displayedCompletedTodos = computed(() => {
  let items = todoStore.filteredCompletedTodos;

  // Apply page-local member filter
  if (memberFilter.value !== 'all') {
    items = items.filter(
      (t) =>
        normalizeAssignees(t).includes(memberFilter.value) || t.completedBy === memberFilter.value
    );
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
async function handleQuickAdd(payload: {
  title: string;
  dueDate?: string;
  assigneeIds?: string[];
}) {
  await todoStore.createTodo({
    title: payload.title,
    dueDate: payload.dueDate,
    ...(payload.assigneeIds?.length ? toAssigneePayload(payload.assigneeIds) : {}),
    completed: false,
    createdBy: currentMemberId.value,
  });
}

async function handleToggle(id: string) {
  await todoStore.toggleComplete(id, currentMemberId.value);
}

function openModal(todo: { id: string }) {
  selectedTodoId.value = todo.id;
}

// Open view modal from query param (e.g. navigated from Family Nook or global search)
function handleTodoQueryParam() {
  const viewId = route.query.view as string | undefined;
  if (viewId) {
    const todo = todoStore.todos.find((t) => t.id === viewId);
    if (todo) openModal(todo);
    router.replace({ query: {} });
  }
}
watch(
  () => route.query.view,
  (val) => {
    if (val) handleTodoQueryParam();
  }
);
onMounted(async () => {
  handleTodoQueryParam();

  // Auto-focus the quick add bar (skip on mobile/tablet to avoid keyboard popup)
  if (isDesktop.value) {
    await nextTick();
    quickAddBar.value?.focus();
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
    <!-- Page header with sort -->
    <div class="flex items-center justify-between">
      <p class="text-sm text-[var(--color-text-muted)]">
        {{ t('todo.subtitle') }}
      </p>
      <div v-if="hasAnyTodos" class="flex items-center gap-1.5">
        <span class="font-outfit text-xs font-medium text-[var(--color-text)] opacity-50">
          {{ t('todo.sortLabel') }}
        </span>
        <select
          v-model="sortBy"
          class="beanies-input font-outfit cursor-pointer rounded-lg border-gray-200 py-1.5 pr-7 pl-2 text-xs font-semibold text-[var(--color-text)] dark:border-slate-600"
        >
          <option value="newest">{{ t('todo.sort.newest') }}</option>
          <option value="oldest">{{ t('todo.sort.oldest') }}</option>
          <option value="dueDate">{{ t('todo.sort.dueDate') }}</option>
        </select>
      </div>
    </div>

    <!-- Quick add bar -->
    <QuickAddBar ref="quickAddBar" @add="handleQuickAdd" />

    <!-- Empty state -->
    <div v-if="!hasAnyTodos" class="py-12 text-center">
      <EmptyStateIllustration variant="goals" class="mb-4" />
      <p class="text-lg font-medium text-[var(--color-text)]">{{ t('todo.noTodos') }}</p>
      <p class="mt-1 text-sm text-[var(--color-text-muted)]">{{ t('todo.getStarted') }}</p>
    </div>

    <!-- Filters (only show when there are todos) -->
    <template v-if="hasAnyTodos">
      <!-- Member chip filter (desktop only, toggle to filter) -->
      <div
        v-if="familyStore.members.length > 1"
        class="hidden flex-wrap items-center gap-2 sm:flex"
      >
        <button
          v-for="member in sortedMembers"
          :key="member.id"
          type="button"
          class="inline-flex cursor-pointer items-center gap-1.5 rounded-[20px] px-3 py-1.5 text-sm font-medium transition-all"
          :class="
            memberFilter === member.id
              ? 'from-secondary-500 bg-gradient-to-r to-[#3D5368] text-white'
              : 'bg-[var(--tint-slate-5)] text-[var(--color-text)]/65 dark:bg-slate-700 dark:text-gray-400'
          "
          @click="memberFilter = memberFilter === member.id ? 'all' : member.id"
        >
          <span
            class="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-xs font-bold text-white"
            :style="{
              background: `linear-gradient(135deg, ${member.color}, ${member.color}dd)`,
            }"
          >
            {{ member.name.charAt(0).toUpperCase() }}
          </span>
          {{ member.name }}
        </button>
      </div>

      <!-- Open Tasks Section -->
      <div>
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
              @view="openModal"
              @edit="openModal"
              @delete="handleDelete"
            />
          </div>
        </div>
      </div>

      <!-- Completed Section -->
      <div v-if="displayedCompletedTodos.length > 0">
        <button
          class="flex items-center gap-2 text-sm text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
          @click="showCompletedSection = !showCompletedSection"
        >
          <span class="text-xs opacity-50">{{ showCompletedSection ? '▲' : '▼' }}</span>
          <span class="nook-section-label text-green-600 dark:text-green-400">
            {{ t('todo.section.completed') }} ({{ displayedCompletedTodos.length }})
          </span>
        </button>

        <div v-if="showCompletedSection" class="mt-2 space-y-2">
          <div
            v-for="todo in displayedCompletedTodos"
            :key="todo.id"
            :class="syncHighlightClass(todo.id)"
          >
            <TodoItemCard
              :todo="todo"
              @toggle="handleToggle"
              @view="openModal"
              @edit="openModal"
              @delete="handleDelete"
            />
          </div>
        </div>
      </div>
    </template>

    <TodoViewEditModal :todo="selectedTodo" @close="selectedTodoId = null" />
  </div>
</template>
