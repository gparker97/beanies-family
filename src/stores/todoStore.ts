import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { celebrate } from '@/composables/useCelebration';
import { createMemberFiltered } from '@/composables/useMemberFiltered';
import { wrapAsync } from '@/composables/useStoreActions';
import { useToday } from '@/composables/useToday';
import * as todoRepo from '@/services/automerge/repositories/todoRepository';
import { normalizeAssignees } from '@/utils/assignees';
import { classifyAudience } from '@/utils/audience';
import { isTodoOverdue } from '@/utils/todo';
import { isHint, dedupeHintsByKey } from '@/utils/helpfulHints';
import type { TodoItem, CreateTodoInput, UpdateTodoInput, FamilyMember } from '@/types/models';
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

  // #40: the manual/hint boundary — the single place hints are split out of the
  // "family's own tasks" lanes. `activeTodos` deliberately KEEPS hints (so the
  // #55 reminder path still schedules their notifications); every attention /
  // open / scheduled lane derives from `manualActiveTodos` instead, so hints are
  // structurally excluded from those surfaces in exactly one place. Hints are
  // surfaced ONLY via `hintTodos` below.
  const manualActiveTodos = computed(() => activeTodos.value.filter((t) => !isHint(t)));

  const somedayTodos = computed(() =>
    todos.value.filter((t) => !t.completed && t.someday).sort(byCreatedDesc)
  );

  const completedTodos = computed(() =>
    todos.value.filter((t) => t.completed).sort(byCompletedDesc)
  );

  const scheduledTodos = computed(() => manualActiveTodos.value.filter((t) => t.dueDate));

  const undatedTodos = computed(() => manualActiveTodos.value.filter((t) => !t.dueDate));

  // Attention computeds — surfaced via the sidebar/mobile-nav attention
  // badges (see useNavBadges) and the daily briefing (useCriticalItems).
  // Single source of truth: anywhere that needs "what's overdue or due
  // today" reads from here, not from inline filters. Hint to-dos never appear
  // here (they derive from manualActiveTodos), so they stay gentle.
  const { today } = useToday();
  const overdueTodos = computed(() => manualActiveTodos.value.filter((t) => isTodoOverdue(t)));
  const dueTodayTodos = computed(() =>
    manualActiveTodos.value.filter((t) => {
      if (!t.dueDate || isTodoOverdue(t)) return false;
      // dueDate is an ISODateString; slice handles both date-only and
      // full datetime forms. Comparing as strings avoids re-parsing.
      return t.dueDate.slice(0, 10) === today.value;
    })
  );

  // #40: hint to-dos, deduped by hintKey (CRDT-merge collision resolver). The
  // ONLY getter that surfaces hints. `visibleHintTodos` additionally applies
  // audience-based visibility so a surprise-sensitive hint (e.g. a birthday
  // present) is hidden from the person it concerns.
  const hintTodos = computed(() => dedupeHintsByKey(activeTodos.value.filter(isHint)));
  // ALL hint to-dos incl. completed (NOT deduped) — the reconcile engine needs
  // completed hints (a completed hint blocks regeneration) and the raw duplicates
  // (to collapse CRDT-merge copies). Display uses `hintTodos`; reconcile uses this.
  const allHintTodos = computed(() => todos.value.filter(isHint));
  function visibleHintTodos(
    viewer: FamilyMember,
    resolveMember: (id: string) => FamilyMember | undefined
  ): TodoItem[] {
    return hintTodos.value.filter(
      (t) => classifyAudience(normalizeAssignees(t), viewer, resolveMember).kind !== 'hidden'
    );
  }

  // ========== FILTERED GETTERS (by global member filter) ==========

  const filteredTodos = createMemberFiltered(todos, (t) => normalizeAssignees(t));

  // #40: also excludes hints, so the Open section + every Nook widget / status
  // toast that reads this feed stays hint-free (children below inherit it).
  const filteredActiveTodos = computed(() =>
    filteredTodos.value.filter((t) => !t.completed && !t.someday && !isHint(t)).sort(byCreatedDesc)
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

  // #40: "keep" a hint — it becomes a permanent normal to-do (exempt from
  // auto-expiry + master-off cleanup) while retaining its subtle hint marker.
  async function acknowledgeHint(id: string): Promise<TodoItem | null> {
    return updateTodo(id, { hintAcknowledged: true });
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
    manualActiveTodos,
    somedayTodos,
    completedTodos,
    scheduledTodos,
    undatedTodos,
    // #40: Helpful Hints
    hintTodos,
    allHintTodos,
    visibleHintTodos,
    // Attention getters — drive sidebar/mobile badges + daily briefing
    overdueTodos,
    dueTodayTodos,
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
    acknowledgeHint,
    resetState,
  };
});
