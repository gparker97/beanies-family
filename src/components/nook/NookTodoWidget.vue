<script setup lang="ts">
import { ref, computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useTodoStore } from '@/stores/todoStore';
import { useFamilyStore } from '@/stores/familyStore';
import { toAssigneePayload } from '@/utils/assignees';
import TodoViewEditModal from '@/components/todo/TodoViewEditModal.vue';
import TodoItemRow from '@/components/todo/TodoItemRow.vue';
import AssigneePickerButton from '@/components/ui/AssigneePickerButton.vue';

const { t } = useTranslation();
const todoStore = useTodoStore();
const familyStore = useFamilyStore();

// ── Quick-add state ─────────────────────────────────────────────────────────
const newTaskTitle = ref('');
const newTaskDate = ref('');
const newTaskAssignees = ref<string[]>([]);
const dateInputFocused = ref(false);

// ── Display ─────────────────────────────────────────────────────────────────
const MAX_VISIBLE = 8;
const openCount = computed(() => todoStore.filteredOpenTodos.length);
const displayTodos = computed(() => {
  const todos = [...todoStore.filteredOpenTodos];
  // Sort: overdue first, then by due date (soonest first), undated last
  todos.sort((a, b) => {
    const aDate = a.dueDate?.split('T')[0] ?? '';
    const bDate = b.dueDate?.split('T')[0] ?? '';
    // Both have dates: sort ascending (soonest first)
    if (aDate && bDate) return aDate.localeCompare(bDate);
    // Dated before undated
    if (aDate && !bDate) return -1;
    if (!aDate && bDate) return 1;
    return 0;
  });
  return todos.slice(0, MAX_VISIBLE);
});
const hasMore = computed(() => todoStore.filteredOpenTodos.length > MAX_VISIBLE);
const remainingCount = computed(() => todoStore.filteredOpenTodos.length - MAX_VISIBLE);

// ── View/edit modal ─────────────────────────────────────────────────────────
const selectedTodoId = ref<string | null>(null);
const selectedTodo = computed(() =>
  selectedTodoId.value ? (todoStore.todos.find((t) => t.id === selectedTodoId.value) ?? null) : null
);

// ── Helpers ─────────────────────────────────────────────────────────────────
async function addTask() {
  const title = newTaskTitle.value.trim();
  if (!title) return;
  await todoStore.createTodo({
    title,
    dueDate: newTaskDate.value || undefined,
    ...(newTaskAssignees.value.length ? toAssigneePayload(newTaskAssignees.value) : {}),
    completed: false,
    createdBy: familyStore.currentMember?.id || '',
  });
  newTaskTitle.value = '';
  newTaskDate.value = '';
  newTaskAssignees.value = [];
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    addTask();
  }
}

async function toggleComplete(todoId: string) {
  await todoStore.toggleComplete(todoId, familyStore.currentMember?.id || '');
}
</script>

<template>
  <div
    class="nook-todo-card nook-card-dark relative overflow-hidden rounded-[var(--sq)] border-l-4 border-[#9B59B6] p-6 shadow-[var(--card-shadow)]"
  >
    <!-- Watermark -->
    <div
      class="pointer-events-none absolute -top-[10px] -right-[10px] text-[4rem] opacity-[0.04]"
      style="transform: rotate(-15deg)"
    >
      📝
    </div>

    <!-- Header -->
    <div class="mb-4 flex items-center justify-between">
      <div class="flex items-center">
        <span class="nook-section-label text-secondary-500 dark:text-gray-400">
          ✅ {{ t('nook.familyTodo') }}
        </span>
        <span
          class="ml-2 rounded-full bg-[rgba(155,89,182,0.12)] px-2 py-0.5 text-xs font-semibold text-[#9B59B6]"
        >
          {{ t('nook.openCount').replace('{count}', String(openCount)) }}
        </span>
      </div>
      <router-link to="/todo" class="text-primary-500 text-xs font-medium hover:underline">
        {{ t('nook.viewAll') }} &rarr;
      </router-link>
    </div>

    <!-- Quick-add bar -->
    <div class="mb-4 space-y-2">
      <!-- Row 1: Input bar (+ date/assignee on desktop) -->
      <div class="flex gap-2">
        <div
          class="flex flex-1 items-center gap-2.5 rounded-2xl px-4 py-3"
          style="background: var(--tint-slate-5)"
        >
          <span class="text-base opacity-40">✏️</span>
          <input
            v-model="newTaskTitle"
            type="text"
            :placeholder="t('nook.addTaskPlaceholder')"
            class="font-outfit min-w-0 flex-1 bg-transparent text-sm font-medium text-[var(--color-text)] outline-none placeholder:opacity-40"
            @keydown="handleKeydown"
          />
          <button
            v-if="newTaskTitle.trim()"
            type="button"
            class="font-outfit shrink-0 rounded-xl px-4 py-1.5 text-xs font-semibold text-white transition-all hover:opacity-90"
            style="background: linear-gradient(135deg, #9b59b6, #8e44ad)"
            @click="addTask"
          >
            {{ t('action.add') }}
          </button>
        </div>
        <!-- Date picker (desktop) -->
        <div
          class="hidden shrink-0 items-center gap-1.5 rounded-2xl px-3 transition-colors sm:flex"
          :class="newTaskDate ? 'bg-[var(--tint-orange-8)]' : ''"
          :style="!newTaskDate ? 'background: var(--tint-slate-5)' : undefined"
        >
          <span class="text-base">📅</span>
          <div class="relative">
            <input
              v-model="newTaskDate"
              type="date"
              class="beanies-input font-outfit cursor-pointer border-none bg-transparent py-2.5 text-xs font-semibold shadow-none focus:shadow-none focus:ring-0"
              :style="{
                color: newTaskDate || dateInputFocused ? 'var(--color-primary)' : 'transparent',
              }"
              @focus="dateInputFocused = true"
              @blur="dateInputFocused = false"
            />
            <span
              v-if="!newTaskDate && !dateInputFocused"
              class="font-outfit pointer-events-none absolute inset-0 flex items-center pl-3 text-sm font-semibold text-[var(--color-text)]"
            >
              {{ t('todo.selectDueDate') }}
            </span>
          </div>
        </div>
        <!-- Assignee (desktop) -->
        <div class="hidden sm:flex">
          <AssigneePickerButton v-model="newTaskAssignees" size="sm" />
        </div>
      </div>
      <!-- Row 2: Date + Assignee on same line (mobile only) -->
      <div class="flex items-center gap-2 sm:hidden">
        <div
          class="flex min-w-0 flex-1 items-center gap-1.5 rounded-2xl px-3 transition-colors"
          :class="newTaskDate ? 'bg-[var(--tint-orange-8)]' : ''"
          :style="!newTaskDate ? 'background: var(--tint-slate-5)' : undefined"
        >
          <span class="text-sm">📅</span>
          <div class="relative min-w-0 flex-1">
            <input
              v-model="newTaskDate"
              type="date"
              class="beanies-input font-outfit w-full min-w-0 cursor-pointer border-none bg-transparent py-2 text-xs font-semibold shadow-none focus:shadow-none focus:ring-0"
              :style="{
                color: newTaskDate || dateInputFocused ? 'var(--color-primary)' : 'transparent',
              }"
              @focus="dateInputFocused = true"
              @blur="dateInputFocused = false"
            />
            <span
              v-if="!newTaskDate && !dateInputFocused"
              class="font-outfit pointer-events-none absolute inset-0 flex items-center pl-1 text-xs font-semibold text-[var(--color-text)]"
            >
              {{ t('todo.selectDueDate') }}
            </span>
          </div>
        </div>
        <AssigneePickerButton v-model="newTaskAssignees" size="sm" />
      </div>
    </div>

    <!-- Todo items -->
    <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <TodoItemRow
        v-for="todo in displayTodos"
        :key="todo.id"
        :todo="todo"
        compact
        @toggle="toggleComplete($event)"
        @view="selectedTodoId = $event.id"
      />
    </div>

    <!-- View more footer -->
    <router-link
      v-if="hasMore"
      to="/todo"
      class="text-primary-500 hover:text-primary-600 font-outfit mt-4 block text-center text-sm font-semibold transition-colors"
    >
      +{{ remainingCount }} {{ t('nook.moretasks') }} &rarr;
    </router-link>
  </div>

  <TodoViewEditModal :todo="selectedTodo" @close="selectedTodoId = null" />
</template>

<style scoped>
.nook-todo-card {
  background: linear-gradient(135deg, white 85%, rgb(155 89 182 / 6%));
}
</style>
