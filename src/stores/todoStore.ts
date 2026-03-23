import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { celebrate } from '@/composables/useCelebration';
import { createMemberFiltered } from '@/composables/useMemberFiltered';
import { wrapAsync } from '@/composables/useStoreActions';
import * as todoRepo from '@/services/automerge/repositories/todoRepository';
import { normalizeAssignees } from '@/utils/assignees';
import type { TodoItem, CreateTodoInput, UpdateTodoInput } from '@/types/models';
import { toISODateString } from '@/utils/date';

export const useTodoStore = defineStore('todos', () => {
  // State
  const todos = ref<TodoItem[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // Getters
  const openTodos = computed(() => {
    return todos.value
      .filter((t) => !t.completed)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });

  const completedTodos = computed(() => {
    return todos.value
      .filter((t) => t.completed)
      .sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt));
  });

  const scheduledTodos = computed(() => openTodos.value.filter((t) => t.dueDate));

  const undatedTodos = computed(() => openTodos.value.filter((t) => !t.dueDate));

  // ========== FILTERED GETTERS (by global member filter) ==========

  const filteredTodos = createMemberFiltered(todos, (t) => normalizeAssignees(t));

  const filteredOpenTodos = computed(() => {
    return filteredTodos.value
      .filter((t) => !t.completed)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });

  const filteredCompletedTodos = computed(() => {
    return filteredTodos.value
      .filter((t) => t.completed)
      .sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt));
  });

  const filteredScheduledTodos = computed(() => filteredOpenTodos.value.filter((t) => t.dueDate));

  const filteredUndatedTodos = computed(() => filteredOpenTodos.value.filter((t) => !t.dueDate));

  // Actions
  async function loadTodos() {
    await wrapAsync(isLoading, error, async () => {
      todos.value = await todoRepo.getAllTodos();
    });
  }

  async function createTodo(input: CreateTodoInput): Promise<TodoItem | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const todo = await todoRepo.createTodo(input);
      // Immutable update: assign a new array so downstream computeds re-evaluate
      todos.value = [...todos.value, todo];
      return todo;
    });
    return result ?? null;
  }

  async function updateTodo(id: string, input: UpdateTodoInput): Promise<TodoItem | null> {
    const result = await wrapAsync(isLoading, error, async () => {
      const updated = await todoRepo.updateTodo(id, input);
      if (updated) {
        // Immutable update: assign a new array so downstream computeds re-evaluate
        todos.value = todos.value.map((t) => (t.id === id ? updated : t));
      }
      return updated;
    });
    return result ?? null;
  }

  async function deleteTodo(id: string): Promise<boolean> {
    const result = await wrapAsync(isLoading, error, async () => {
      const success = await todoRepo.deleteTodo(id);
      if (success) {
        todos.value = todos.value.filter((t) => t.id !== id);
      }
      return success;
    });
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
    // Getters
    openTodos,
    completedTodos,
    scheduledTodos,
    undatedTodos,
    // Filtered getters (by global member filter)
    filteredTodos,
    filteredOpenTodos,
    filteredCompletedTodos,
    filteredScheduledTodos,
    filteredUndatedTodos,
    // Actions
    loadTodos,
    createTodo,
    updateTodo,
    deleteTodo,
    toggleComplete,
    resetState,
  };
});
