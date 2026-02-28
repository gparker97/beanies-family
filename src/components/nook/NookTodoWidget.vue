<script setup lang="ts">
import { ref, computed } from 'vue';
import { useTranslation } from '@/composables/useTranslation';
import { useTodoStore } from '@/stores/todoStore';
import { useFamilyStore } from '@/stores/familyStore';
import TodoViewEditModal from '@/components/todo/TodoViewEditModal.vue';
import type { TodoItem } from '@/types/models';

const { t } = useTranslation();
const todoStore = useTodoStore();
const familyStore = useFamilyStore();

// ── Quick-add state ─────────────────────────────────────────────────────────
const newTaskTitle = ref('');
const newTaskDate = ref('');
const newTaskAssignee = ref('');

// ── Display ─────────────────────────────────────────────────────────────────
const MAX_VISIBLE = 8;
const openCount = computed(() => todoStore.filteredOpenTodos.length);
const displayTodos = computed(() => todoStore.filteredOpenTodos.slice(0, MAX_VISIBLE));
const hasMore = computed(() => todoStore.filteredOpenTodos.length > MAX_VISIBLE);
const remainingCount = computed(() => todoStore.filteredOpenTodos.length - MAX_VISIBLE);

// ── View/edit modal ─────────────────────────────────────────────────────────
const selectedTodo = ref<TodoItem | null>(null);

// ── Helpers ─────────────────────────────────────────────────────────────────
function getMember(id: string) {
  return familyStore.members.find((m) => m.id === id);
}

function isOverdue(todo: TodoItem): boolean {
  if (todo.completed || !todo.dueDate) return false;
  const now = new Date();
  const dueDate = new Date(todo.dueDate);
  if (todo.dueTime) {
    const parts = todo.dueTime.split(':').map(Number);
    dueDate.setHours(parts[0] ?? 23, parts[1] ?? 59, 0, 0);
  } else {
    dueDate.setHours(23, 59, 59, 999);
  }
  return now > dueDate;
}

function formattedDate(dueDate: string): string {
  const date = new Date(dueDate);
  const weekday = date.toLocaleDateString(undefined, { weekday: 'short' });
  const day = date.getDate();
  const month = date.toLocaleDateString(undefined, { month: 'short' });
  return `${weekday} ${day} ${month}`;
}

async function addTask() {
  const title = newTaskTitle.value.trim();
  if (!title) return;
  await todoStore.createTodo({
    title,
    dueDate: newTaskDate.value || undefined,
    assigneeId: newTaskAssignee.value || undefined,
    completed: false,
    createdBy: familyStore.currentMember?.id || '',
  });
  newTaskTitle.value = '';
  newTaskDate.value = '';
  newTaskAssignee.value = '';
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
    class="nook-todo-card relative overflow-hidden rounded-[var(--sq)] border-l-4 border-[#9B59B6] p-6 shadow-[var(--card-shadow)]"
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
        <span
          class="font-outfit text-secondary-500/45 text-[0.75rem] font-semibold tracking-[0.08em] uppercase dark:text-gray-400"
        >
          ✅ {{ t('nook.familyTodo') }}
        </span>
        <span
          class="ml-2 rounded-full bg-[rgba(155,89,182,0.12)] px-2 py-0.5 text-[0.65rem] font-semibold text-[#9B59B6]"
        >
          {{ t('nook.openCount').replace('{count}', String(openCount)) }}
        </span>
      </div>
      <router-link to="/todo" class="text-primary-500 text-[0.75rem] font-medium hover:underline">
        {{ t('nook.viewAll') }} &rarr;
      </router-link>
    </div>

    <!-- Quick-add bar -->
    <div class="mb-4 flex gap-2">
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
      <div
        class="hidden shrink-0 items-center gap-1.5 rounded-2xl px-3 transition-colors sm:flex"
        :class="newTaskDate ? 'bg-[var(--tint-orange-8)]' : ''"
        :style="!newTaskDate ? 'background: var(--tint-slate-5)' : undefined"
      >
        <span class="text-base">📅</span>
        <input
          v-model="newTaskDate"
          type="date"
          class="beanies-input font-outfit cursor-pointer border-none bg-transparent py-2.5 text-xs font-semibold shadow-none focus:shadow-none focus:ring-0"
          :style="{ color: newTaskDate ? 'var(--color-primary)' : 'var(--color-text)' }"
        />
      </div>
      <div
        class="hidden shrink-0 items-center gap-1.5 rounded-2xl px-3 transition-colors sm:flex"
        :class="newTaskAssignee ? 'bg-[var(--tint-purple-8)]' : ''"
        :style="!newTaskAssignee ? 'background: var(--tint-slate-5)' : undefined"
      >
        <span class="text-base">👤</span>
        <select
          v-model="newTaskAssignee"
          class="beanies-input font-outfit cursor-pointer border-none bg-transparent py-2.5 text-xs font-semibold text-[var(--color-text)] shadow-none focus:shadow-none focus:ring-0"
        >
          <option value="">{{ t('todo.assignTo') }}</option>
          <option v-for="member in familyStore.members" :key="member.id" :value="member.id">
            {{ member.name }}
          </option>
        </select>
      </div>
    </div>

    <!-- Todo items -->
    <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <div
        v-for="todo in displayTodos"
        :key="todo.id"
        class="group flex cursor-pointer items-center gap-3 rounded-2xl border p-3.5 transition-all"
        :class="
          isOverdue(todo)
            ? 'border-red-200 bg-red-50 hover:bg-red-100 dark:border-red-800/40 dark:bg-red-950/30 dark:hover:bg-red-950/50'
            : 'border-[var(--tint-slate-10)] bg-white hover:bg-[var(--tint-orange-8)] dark:bg-slate-700 dark:hover:bg-slate-600'
        "
        @click="selectedTodo = todo"
      >
        <button
          type="button"
          class="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-[2.5px] transition-colors"
          :class="
            isOverdue(todo)
              ? 'border-red-400 hover:bg-red-100 dark:border-red-500'
              : 'border-[var(--color-primary-500)] hover:bg-[var(--tint-orange-8)]'
          "
          @click.stop="toggleComplete(todo.id)"
        />
        <div class="min-w-0 flex-1">
          <p class="font-outfit truncate text-sm font-semibold text-[var(--color-text)]">
            {{ todo.title }}
          </p>
          <p
            v-if="todo.description"
            class="mt-0.5 line-clamp-2 text-xs leading-relaxed text-[var(--color-text-muted)]"
          >
            {{ todo.description }}
          </p>
          <div class="mt-1 flex flex-wrap items-center gap-2">
            <span
              v-if="todo.dueDate && isOverdue(todo)"
              class="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-primary-500)] px-2.5 py-0.5 text-xs font-semibold text-white"
            >
              ⏰{{ formattedDate(todo.dueDate) }}
              <span
                class="rounded-full bg-white/25 px-1.5 py-px text-[0.55rem] font-bold uppercase"
              >
                {{ t('todo.overdue') }}
              </span>
            </span>
            <span
              v-else-if="todo.dueDate"
              class="text-xs font-semibold"
              :style="{ color: 'var(--color-primary-500)' }"
            >
              📅 {{ formattedDate(todo.dueDate) }}
            </span>
            <span
              v-if="todo.assigneeId && getMember(todo.assigneeId)"
              class="rounded-md px-2 py-0.5 text-[0.65rem] font-medium text-white"
              :style="{
                background: `linear-gradient(135deg, ${getMember(todo.assigneeId)!.color || '#3b82f6'}, ${getMember(todo.assigneeId)!.color || '#3b82f6'}cc)`,
              }"
            >
              {{ getMember(todo.assigneeId)!.name }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- View more footer -->
    <router-link
      v-if="hasMore"
      to="/todo"
      class="text-primary-500 hover:text-primary-600 font-outfit mt-4 block text-center text-[0.8rem] font-semibold transition-colors"
    >
      +{{ remainingCount }} {{ t('nook.moretasks') }} &rarr;
    </router-link>
  </div>

  <TodoViewEditModal :todo="selectedTodo" @close="selectedTodo = null" />
</template>

<style scoped>
.nook-todo-card {
  background: linear-gradient(135deg, white 85%, rgb(155 89 182 / 6%));
}

:global(.dark) .nook-todo-card {
  background: rgb(30 41 59);
}
</style>
