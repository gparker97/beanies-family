import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { celebrate } from '@/composables/useCelebration';
import { createMemberFiltered } from '@/composables/useMemberFiltered';
import { wrapAsync } from '@/composables/useStoreActions';
import * as todoRepo from '@/services/automerge/repositories/todoRepository';
import { normalizeAssignees } from '@/utils/assignees';
import type { TodoItem, CreateTodoInput, UpdateTodoInput } from '@/types/models';
import { toISODateString } from '@/utils/date';

// Sort comparators — newest-created first / most-recently-completed first.
const byCreatedDesc = (a: TodoItem, b: TodoItem) => b.createdAt.localeCompare(a.createdAt);
const byCompletedDesc = (a: TodoItem, b: TodoItem) =>
  (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt);

export const useTodoStore = defineStore('todos', () => {
  // State
  const todos = ref<TodoItem[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // Getters — to-dos live in one of three lanes: active (open, committed) /
  // someday (open, parked — "someday / maybe") / completed.
  const activeTodos = computed(() =>
    todos.value.filter((t) => !t.completed && !t.someday).sort(byCreatedDesc)
  );

  const somedayTodos = computed(() =>
    todos.value.filter((t) => !t.completed && t.someday).sort(byCreatedDesc)
  );

  const completedTodos = computed(() =>
    todos.value.filter((t) => t.completed).sort(byCompletedDesc)
  );

  const scheduledTodos = computed(() => activeTodos.value.filter((t) => t.dueDate));

  const undatedTodos = computed(() => activeTodos.value.filter((t) => !t.dueDate));

  // ========== FILTERED GETTERS (by global member filter) ==========

  const filteredTodos = createMemberFiltered(todos, (t) => normalizeAssignees(t));

  const filteredActiveTodos = computed(() =>
    filteredTodos.value.filter((t) => !t.completed && !t.someday).sort(byCreatedDesc)
  );

  const filteredSomedayTodos = computed(() =>
    filteredTodos.value.filter((t) => !t.completed && t.someday).sort(byCreatedDesc)
  );

  const filteredCompletedTodos = computed(() =>
    filteredTodos.value.filter((t) => t.completed).sort(byCompletedDesc)
  );

  const filteredScheduledTodos = computed(() => filteredActiveTodos.value.filter((t) => t.dueDate));

  const filteredUndatedTodos = computed(() => filteredActiveTodos.value.filter((t) => !t.dueDate));

  // Actions
  async function loadTodos() {
    await wrapAsync(
      isLoading,
      error,
      async () => {
        todos.value = await todoRepo.getAllTodos();
      },
      { action: 'todoStore:loadTodos' }
    );
  }

  async function createTodo(input: CreateTodoInput): Promise<TodoItem | null> {
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        const todo = await todoRepo.createTodo(input);
        // Immutable update: assign a new array so downstream computeds re-evaluate
        todos.value = [...todos.value, todo];
        return todo;
      },
      { action: 'todoStore:createTodo' }
    );
    return result ?? null;
  }

  async function updateTodo(id: string, input: UpdateTodoInput): Promise<TodoItem | null> {
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        const updated = await todoRepo.updateTodo(id, input);
        if (updated) {
          // Immutable update: assign a new array so downstream computeds re-evaluate
          todos.value = todos.value.map((t) => (t.id === id ? updated : t));
        }
        return updated;
      },
      { action: 'todoStore:updateTodo' }
    );
    return result ?? null;
  }

  async function deleteTodo(id: string): Promise<boolean> {
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        const success = await todoRepo.deleteTodo(id);
        if (success) {
          todos.value = todos.value.filter((t) => t.id !== id);
        }
        return success;
      },
      { action: 'todoStore:deleteTodo' }
    );
    return result ?? false;
  }

  async function toggleComplete(id: string, completedBy: string): Promise<TodoItem | null> {
    const existing = todos.value.find((t) => t.id === id);
    if (!existing) return null;

    const now = toISODateString(new Date());

    if (existing.completed) {
      // Undo complete
      return updateTodo(id, {
        completed: false,
        completedBy: undefined,
        completedAt: undefined,
      });
    } else {
      // Mark complete
      const result = await updateTodo(id, {
        completed: true,
        completedBy,
        completedAt: now,
      });
      if (result) {
        celebrate('goal-reached', {
          onUndo: () => {
            updateTodo(id, {
              completed: false,
              completedBy: undefined,
              completedAt: undefined,
            });
          },
        });
      }
      return result;
    }
  }

  /**
   * Move a to-do into / out of the "someday · maybe" lane. Going someday also
   * clears the due date/time (a someday item is deliberately unscheduled) —
   * this invariant lives only here. Reuses `updateTodo`'s error handling
   * (toast + telemetry via `wrapAsync`); not a silent-failure path.
   */
  async function setSomeday(id: string, someday: boolean): Promise<TodoItem | null> {
    return someday
      ? updateTodo(id, { someday: true, dueDate: undefined, dueTime: undefined })
      : updateTodo(id, { someday: false });
  }

  function resetState() {
    todos.value = [];
    isLoading.value = false;
    error.value = null;
  }

  return {
    // State
    todos,
    isLoading,
    error,
    // Getters — the three lanes: active / someday / completed
    activeTodos,
    somedayTodos,
    completedTodos,
    scheduledTodos,
    undatedTodos,
    // Filtered getters (by global member filter)
    filteredTodos,
    filteredActiveTodos,
    filteredSomedayTodos,
    filteredCompletedTodos,
    filteredScheduledTodos,
    filteredUndatedTodos,
    // Actions
    loadTodos,
    createTodo,
    updateTodo,
    deleteTodo,
    toggleComplete,
    setSomeday,
    resetState,
  };
});
