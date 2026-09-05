<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { confirm as showConfirm } from '@/composables/useConfirm';
import { useQuickAddIntent } from '@/composables/useQuickAddIntent';
import { usePermissions } from '@/composables/usePermissions';
import { useSounds } from '@/composables/useSounds';
import { matchesAssigneeFilter, toAssigneePayload } from '@/utils/assignees';
import { useTodoStore } from '@/stores/todoStore';
import { useFamilyStore } from '@/stores/familyStore';
import { useAuthStore } from '@/stores/authStore';
import EmptyStateIllustration from '@/components/ui/EmptyStateIllustration.vue';
import PageWelcomeSubtitle from '@/components/ui/PageWelcomeSubtitle.vue';
import TodoViewEditModal from '@/components/todo/TodoViewEditModal.vue';
import QuickAddBar from '@/components/todo/QuickAddBar.vue';
import TodoSection from '@/components/todo/TodoSection.vue';
import SortMenu from '@/components/ui/SortMenu.vue';
import TodoMemberFilter from '@/components/todo/TodoMemberFilter.vue';
import type { TodoItem } from '@/types/models';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { useTodoSort, SORT_OPTIONS } from '@/composables/useTodoSort';
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
  // `matchesAssigneeFilter`, not `.includes()`: an UNASSIGNED to-do is the family's work
  // and belongs to whoever you lens on, and `.includes()` on an empty array is false, so
  // the plain form hid every wall quick-add (which creates to-dos unassigned by design)
  // the moment you tapped a bean. Every other surface routes through this predicate.
  const filtered =
    memberFilter.value === 'all'
      ? items
      : items.filter((t) => matchesAssigneeFilter(t, (id) => id === memberFilter.value));
  return sortTodos(filtered, sortBy.value);
}

const displayedOpenTodos = computed(() => withMemberFilterAndSort(todoStore.filteredActiveTodos));
const displayedSomedayTodos = computed(() =>
  withMemberFilterAndSort(todoStore.filteredSomedayTodos)
);

// #40: Helpful Hints visible to the current member (audience-hidden hints — e.g.
// a birthday person's own present hint — are filtered out in the store), then the
// page's own member-lens + sort applied like the other lanes.
const displayedHintTodos = computed(() => {
  const me = familyStore.currentMember;
  if (!me) return [];
  const resolve = (id: string) => familyStore.members.find((m) => m.id === id);
  return withMemberFilterAndSort(todoStore.visibleHintTodos(me, resolve));
});

const displayedCompletedTodos = computed(() => {
  let items = todoStore.filteredCompletedTodos;

  // Apply page-local member filter
  if (memberFilter.value !== 'all') {
    items = items.filter(
      (t) =>
        matchesAssigneeFilter(t, (id) => id === memberFilter.value) ||
        t.completedBy === memberFilter.value
    );
  }

  return items;
});

// #40: count only what the viewer can actually SEE — audience-hidden hints (e.g.
// a birthday person's own present hint) must not suppress the empty state. Hints
// live in their own section, so the family's own lanes exclude them.
const hasAnyTodos = computed(
  () =>
    todoStore.manualActiveTodos.length > 0 ||
    todoStore.somedayTodos.length > 0 ||
    todoStore.completedTodos.length > 0 ||
    displayedHintTodos.value.length > 0
);

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

// #40: hints dismiss in ONE tap (no confirm — they're suggestions, not the
// family's own data), and "keep" promotes a hint to a permanent normal to-do.
async function handleHintDismiss(id: string) {
  await todoStore.deleteTodo(id);
  playWhoosh();
}

async function handleAcknowledge(id: string) {
  await todoStore.acknowledgeHint(id);
}
</script>

<template>
  <div class="space-y-6">
    <!-- Page header with view controls (filter + sort grouped as siblings) -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <PageWelcomeSubtitle :text="t('todo.subtitle')" />
      <div v-if="hasAnyTodos" class="flex flex-wrap items-center justify-end gap-2">
        <!-- Member view-filter (desktop/tablet only) — a lens, not an assignee control -->
        <TodoMemberFilter
          v-if="sortedMembers.length > 1"
          v-model="memberFilter"
          :members="sortedMembers"
          class="hidden sm:flex"
        />
        <SortMenu v-model="sortBy" :options="SORT_OPTIONS" trigger-label-key="todo.sortLabel" />
      </div>
    </div>

    <!-- Quick add bar -->
    <QuickAddBar v-if="canEditActivities" ref="quickAddBar" @add="handleQuickAdd" />

    <!-- #40: Helpful Hints — gentle auto-suggested prep to-dos, shown above the
         family's own tasks. One-tap Keep (acknowledge) or Dismiss on each row. -->
    <TodoSection
      v-if="displayedHintTodos.length > 0"
      :label="t('todo.hint.section')"
      emoji="💡"
      label-class="text-[var(--color-primary-500)]"
      :todos="displayedHintTodos"
      @toggle="handleToggle"
      @view="openModal"
      @edit="openModal"
      @delete="handleHintDismiss"
      @acknowledge="handleAcknowledge"
    >
      <template #hint>{{ t('todo.hint.sectionHint') }}</template>
    </TodoSection>

    <!-- Empty state -->
    <div v-if="!hasAnyTodos" class="py-12 text-center">
      <EmptyStateIllustration variant="goals" class="mb-4" />
      <p class="text-lg font-medium text-[var(--color-text)]">{{ t('todo.noTodos') }}</p>
      <p class="mt-1 text-sm text-[var(--color-text-muted)]">{{ t('todo.getStarted') }}</p>
    </div>

    <!-- Sections (only show when there are todos) -->
    <template v-if="hasAnyTodos">
      <!-- Open Tasks -->
      <TodoSection
        :label="t('todo.section.open')"
        label-class="text-purple-500 dark:text-purple-lift"
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
        label-class="text-green-600 dark:text-success-lift"
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
