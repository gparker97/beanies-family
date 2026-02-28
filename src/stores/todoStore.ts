import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { celebrate } from '@/composables/useCelebration';
import { useMemberFilterStore } from './memberFilterStore';
import { useTombstoneStore } from './tombstoneStore';
import * as todoRepo from '@/services/indexeddb/repositories/todoRepository';
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

  const filteredTodos = computed(() => {
    const memberFilter = useMemberFilterStore();
    if (!memberFilter.isInitialized || memberFilter.isAllSelected) {
      return todos.value;
    }
    return todos.value.filter((t) => {
      // Unassigned todos always show
      if (!t.assigneeId) return true;
      return memberFilter.isMemberSelected(t.assigneeId);
    });
  });

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
    isLoading.value = true;
    error.value = null;
    try {
      todos.value = await todoRepo.getAllTodos();
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load todos';
    } finally {
      isLoading.value = false;
    }
  }

  async function createTodo(input: CreateTodoInput): Promise<TodoItem | null> {
    isLoading.value = true;
    error.value = null;
    try {
      const todo = await todoRepo.createTodo(input);
      todos.value.push(todo);
      return todo;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create todo';
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  async function updateTodo(id: string, input: UpdateTodoInput): Promise<TodoItem | null> {
    isLoading.value = true;
    error.value = null;
    try {
      const updated = await todoRepo.updateTodo(id, input);
      if (updated) {
        const index = todos.value.findIndex((t) => t.id === id);
        if (index !== -1) {
          todos.value[index] = updated;
        }
      }
      return updated ?? null;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update todo';
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  async function deleteTodo(id: string): Promise<boolean> {
    isLoading.value = true;
    error.value = null;
    try {
      const success = await todoRepo.deleteTodo(id);
      if (success) {
        useTombstoneStore().recordDeletion('todo', id);
        todos.value = todos.value.filter((t) => t.id !== id);
      }
      return success;
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete todo';
      return false;
    } finally {
      isLoading.value = false;
    }
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
        celebrate('goal-reached');
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
