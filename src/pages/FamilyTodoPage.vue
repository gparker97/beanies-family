<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { confirm as showConfirm } from '@/composables/useConfirm';
import { useQuickAddIntent } from '@/composables/useQuickAddIntent';
import { usePermissions } from '@/composables/usePermissions';
import { useSounds } from '@/composables/useSounds';
import { normalizeAssignees, toAssigneePayload } from '@/utils/assignees';
import { useTodoStore } from '@/stores/todoStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useAuthStore } from '@/stores/authStore';
import EmptyStateIllustration from '@/components/ui/EmptyStateIllustration.vue';
import PageWelcomeSubtitle from '@/components/ui/PageWelcomeSubtitle.vue';
import TodoViewEditModal from '@/components/todo/TodoViewEditModal.vue';
import QuickAddBar from '@/components/todo/QuickAddBar.vue';
import TodoSection from '@/components/todo/TodoSection.vue';
import TodoSortMenu from '@/components/todo/TodoSortMenu.vue';
import type { TodoItem } from '@/types/models';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { useTodoSort } from '@/composables/useTodoSort';
import { useDeepLinkParam } from '@/composables/useDeepLinkParam';
import { sortTodos } from '@/utils/todo';

const { t } = useTranslation();
const { canEditActivities } = usePermissions();
const { playWhoosh } = useSounds();
const todoStore = useTodoStore();
const familyStore = useFamilyStore();
const authStore = useAuthStore();

const currentMemberId = computed(() => authStore.currentUser?.memberId ?? '');

// Local filter state — sort is a persisted, device-local preference (default
// 'dueDate'); member filter is page-local.
const { sortBy } = useTodoSort();
const memberFilter = ref('all');
const completedCollapsed = ref(true);

const { isDesktop } = useBreakpoint();

// Ref to QuickAddBar for auto-focus
const quickAddBar = ref<InstanceType<typeof QuickAddBar> | null>(null);

// View/edit modal — store ID, derive live object from store for reactivity
const selectedTodoId = ref<string | null>(null);
const selectedTodo = computed(() =>
  selectedTodoId.value ? (todoStore.todos.find((t) => t.id === selectedTodoId.value) ?? null) : null
);

// Todo member filter — humans only (pets can't be assignees).
const sortedMembers = computed(() => familyStore.sortedHumans);

// Apply the page-local member filter (by assignee) + the chosen sort. Shared
// by the Open and Someday sections — the Completed list has its own filter
// (it also matches `completedBy`).
function withMemberFilterAndSort(items: TodoItem[]): TodoItem[] {
  const filtered =
    memberFilter.value === 'all'
      ? items
      : items.filter((t) => normalizeAssignees(t).includes(memberFilter.value));
  return sortTodos(filtered, sortBy.value);
}

const displayedOpenTodos = computed(() => withMemberFilterAndSort(todoStore.filteredActiveTodos));
const displayedSomedayTodos = computed(() =>
  withMemberFilterAndSort(todoStore.filteredSomedayTodos)
);

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

async function handleSetSomeday(id: string, value: boolean) {
  await todoStore.setSomeday(id, value);
}

function openModal(todo: { id: string }) {
  selectedTodoId.value = todo.id;
}

// Open view modal from a deep link (?view=<id> — from Family Nook, global search,
// or an external link). Robust to cold-start: only clears the param once the todo
// is found, and retries when the store hydrates.
useDeepLinkParam({
  param: 'view',
  open: (id) => {
    const todo = todoStore.todos.find((t) => t.id === id);
    if (!todo) return false;
    openModal(todo);
    return true;
  },
  ready: () => todoStore.todos.length,
});
// Quick-add FAB → focus the QuickAddBar so the user can type a todo.
// There is no separate "add" modal for todos — adds happen inline.
useQuickAddIntent(async (action) => {
  if (action !== 'add-todo') return;
  if (!canEditActivities.value) return;
  await nextTick();
  quickAddBar.value?.focus();
});

onMounted(async () => {
  // Auto-focus the quick add bar (skip on mobile/tablet to avoid keyboard popup)
  if (isDesktop.value && canEditActivities.value) {
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
      <PageWelcomeSubtitle :text="t('todo.subtitle')" />
      <TodoSortMenu v-if="hasAnyTodos" v-model:sort-by="sortBy" />
    </div>

    <!-- Quick add bar -->
    <QuickAddBar v-if="canEditActivities" ref="quickAddBar" @add="handleQuickAdd" />

    <!-- Empty state -->
    <div v-if="!hasAnyTodos" class="py-12 text-center">
      <EmptyStateIllustration variant="goals" class="mb-4" />
      <p class="text-lg font-medium text-[var(--color-text)]">{{ t('todo.noTodos') }}</p>
      <p class="mt-1 text-sm text-[var(--color-text-muted)]">{{ t('todo.getStarted') }}</p>
    </div>

    <!-- Filters (only show when there are todos) -->
    <template v-if="hasAnyTodos">
      <!-- Member chip filter (desktop only, toggle to filter) -->
      <div v-if="sortedMembers.length > 1" class="hidden flex-wrap items-center gap-2 sm:flex">
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

      <!-- Open Tasks -->
      <TodoSection
        :label="t('todo.section.open')"
        label-class="text-purple-500"
        :todos="displayedOpenTodos"
        :empty-text="t('todo.noTodos')"
        @toggle="handleToggle"
        @view="openModal"
        @edit="openModal"
        @delete="handleDelete"
        @set-someday="handleSetSomeday"
      />

      <!-- Someday · Maybe — always visible (these aren't completed), hidden only when empty -->
      <TodoSection
        v-if="displayedSomedayTodos.length > 0"
        :label="t('todo.someday')"
        emoji="💭"
        label-class="text-sky-600 dark:text-sky-400"
        :todos="displayedSomedayTodos"
        @toggle="handleToggle"
        @view="openModal"
        @edit="openModal"
        @delete="handleDelete"
        @set-someday="handleSetSomeday"
      >
        <template #hint>{{ t('todo.somedayHint') }}</template>
      </TodoSection>

      <!-- Completed (collapsible) -->
      <TodoSection
        v-if="displayedCompletedTodos.length > 0"
        v-model:collapsed="completedCollapsed"
        :label="t('todo.section.completed')"
        label-class="text-green-600 dark:text-green-400"
        :todos="displayedCompletedTodos"
        collapsible
        @toggle="handleToggle"
        @view="openModal"
        @edit="openModal"
        @delete="handleDelete"
      />
    </template>

    <TodoViewEditModal :todo="selectedTodo" @close="selectedTodoId = null" />
  </div>
</template>
