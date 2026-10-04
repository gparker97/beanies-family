import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { celebrate } from '@/composables/useCelebration';
import { createMemberFiltered } from '@/composables/useMemberFiltered';
import { wrapAsync } from '@/composables/useStoreActions';
import { useToday } from '@/composables/useToday';
import * as todoRepo from '@/services/automerge/repositories/todoRepository';
import { normalizeAssignees } from '@/utils/assignees';
import { classifyAudience } from '@/utils/audience';
import { isTodoOverdue, sortTodos } from '@/utils/todo';
import {
  itemsForSession,
  todoLink,
  todoLinkPatch,
  type ActivityLink,
  type SessionItem,
} from '@/utils/activityLinks';
import { isHint, dedupeHintsByKey, type HintTodo } from '@/utils/helpfulHints';
import type {
  TodoItem,
  CreateTodoInput,
  UpdateTodoInput,
  FamilyMember,
  FamilyActivity,
} from '@/types/models';
import { toISODateString } from '@/utils/date';
import { trackFeature } from '@/services/analytics/plausible';
import { logEvent } from '@/services/telemetry/logEvent';
import { useActivityStore } from '@/stores/activityStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslationStore } from '@/stores/translationStore';
import { showToast } from '@/composables/useToast';

// Sort comparators — newest-created first / most-recently-completed first.
const byCreatedDesc = (a: TodoItem, b: TodoItem) => b.createdAt.localeCompare(a.createdAt);
const byCompletedDesc = (a: TodoItem, b: TodoItem) =>
  (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt);

// #40: the ONE consumption counter for hints, emitted from `toggleComplete` so
// every surface (briefing tick, to-do row, modal, Nook widget, wall job) is
// covered by one implementation. It counts TICKS, not net completions: an
// undo-then-retick logs twice and un-completing logs nothing (deliberate).
// `hint_op` is a closed enum: 'complete' (here), 'dismiss' and 'undo' (`discardTodo`).
// `route_path` says which surface ticked it (`/nook` = the briefing, `/todo` = the to-do page) — it is not
// auto-enriched, so it is read here exactly as OAuthNativeBridgePage does.
// Pairs with the `reconcile` generation event on the same surface. No emit
// gate: a tick is a discrete user action, not a re-emitted watcher outcome.
function logHintCompleted(todo: TodoItem): void {
  if (!isHint(todo)) return;
  logEvent({
    level: 'info',
    surface: 'helpful-hints',
    message: 'hint completed',
    context: {
      hint_type: todo.hintType,
      hint_op: 'complete',
      route_path: window.location.pathname,
    },
  });
}

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
  // #55 reminder path still schedules their notifications); every open /
  // scheduled / overdue lane and nav badge derives from `manualActiveTodos`
  // instead, so hints are structurally excluded from those surfaces in exactly
  // one place. Hints are surfaced ONLY via `hintTodos` / `visibleHintTodos`
  // below — on the to-do page's Helpful Hints section and, with their own fixed
  // framing, in the daily briefing (`useCriticalItems`).
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
  // ONLY getter that surfaces hints (to-do page + daily briefing).
  // `visibleHintTodos` additionally applies audience-based visibility so a
  // surprise-sensitive hint (e.g. a birthday present) is hidden from the person
  // it concerns. Typed `HintTodo[]`: the `filter(isHint)` narrowing survives the
  // generic dedupe, so consumers read `hintType` without a guard.
  const hintTodos = computed(() => dedupeHintsByKey(activeTodos.value.filter(isHint)));
  // ALL hint to-dos incl. completed (NOT deduped) — the reconcile engine needs
  // completed hints (a completed hint blocks regeneration) and the raw duplicates
  // (to collapse CRDT-merge copies). Display uses `hintTodos`; reconcile uses this.
  const allHintTodos = computed(() => todos.value.filter(isHint));
  function visibleHintTodos(
    viewer: FamilyMember,
    resolveMember: (id: string) => FamilyMember | undefined
  ): HintTodo[] {
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
      { action: 'todoStore:createTodo', surface: 'todos' }
    );
    return trackFeature(result ?? null, 'todo');
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

  /**
   * A person removing a to-do (the to-do page, its drawer, the daily briefing). For a
   * Helpful Hint (#40) the key is recorded first, family-wide, so the engine never
   * regenerates it: deleting alone is not enough, because the next reconcile sees a
   * desired key with no to-do and recreates it. The engine's own expiry/stale removals
   * call `deleteTodo` directly and must not come through here.
   *
   * If recording fails (already toasted + reported by the settings chain) the hint is
   * still deleted, and may come back on a later reconcile.
   */
  async function discardTodo(id: string): Promise<boolean> {
    const todo = todos.value.find((t) => t.id === id);
    if (!todo || !isHint(todo) || !todo.hintKey) return deleteTodo(id);

    let recorded = true;
    try {
      // The value is the event date, so the engine can prune the entry once it passes.
      await useSettingsStore().recordDismissedHint(
        todo.hintKey,
        todo.hintEventDate ?? todo.dueDate?.slice(0, 10) ?? ''
      );
    } catch {
      recorded = false; // already toasted + reported by the settings chain
    }
    const deleted = await deleteTodo(id);
    // One event, after the outcome: `recorded` false = it may regenerate; `deleted` false
    // = it is still on screen (deleteTodo has toasted).
    logEvent({
      level: recorded && deleted ? 'info' : 'warn',
      surface: 'helpful-hints',
      message: !deleted
        ? 'hint dismiss failed'
        : recorded
          ? 'hint dismissed'
          : 'hint dismissed; dismissal not recorded',
      context: {
        hint_type: todo.hintType,
        hint_op: 'dismiss',
        route_path: window.location.pathname,
      },
    });
    // The house Undo toast (6s, like every other undoable removal). The snapshot is the
    // hint as it was, so Undo restores it under the same id.
    if (deleted) {
      const t = useTranslationStore().t;
      showToast('info', t('todo.hint.dismissedToast'), undefined, {
        actionLabel: t('action.undo'),
        actionFn: () => undoHintDismiss(todo),
        durationMs: 6000,
      });
    }
    return deleted;
  }

  /**
   * Undo a hint dismissal. The dismissed key is forgotten FIRST: while it is recorded,
   * the reconcile engine treats any copy of the hint as one to remove, so restoring
   * first would have the restored hint deleted again on the next reconcile.
   */
  async function undoHintDismiss(snapshot: HintTodo): Promise<void> {
    let forgotten = true;
    try {
      await useSettingsStore().forgetDismissedHint(snapshot.hintKey!);
    } catch {
      forgotten = false; // already toasted + reported by the settings chain
    }
    const restored = forgotten ? await restoreTodo(snapshot) : null;
    logEvent({
      level: restored ? 'info' : 'warn',
      surface: 'helpful-hints',
      message: restored ? 'hint dismiss undone' : 'hint dismiss undo failed',
      context: {
        hint_type: snapshot.hintType,
        hint_op: 'undo',
        route_path: window.location.pathname,
      },
    });
  }

  /**
   * Create several to-dos in ONE write (all or nothing), under ids the caller minted.
   *
   * The ids come from the magic beans review drafts, so a retry after a failure rewrites the
   * same records instead of duplicating them. Failures toast + report once through
   * `wrapAsync`; the caller keeps its drafts. `trackFeature` counts the batch as one use.
   */
  async function createTodos(
    inputs: readonly (CreateTodoInput & { id: string })[]
  ): Promise<TodoItem[] | null> {
    if (!inputs.length) return [];
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        const created = await todoRepo.createTodosWithIds(
          inputs.map(({ id, ...input }) => ({ id, input }))
        );
        const ids = new Set(created.map((t) => t.id));
        // Replace-by-id so a retried batch never leaves two copies in memory either.
        todos.value = [...todos.value.filter((t) => !ids.has(t.id)), ...created];
        return created;
      },
      { action: 'todoStore:createTodos', surface: 'todos' }
    );
    return trackFeature(result ?? null, 'todo');
  }

  /**
   * Link (or, for `null`, unlink) to-dos to an activity in ONE write, always writing the id and
   * the session date together (`todoLinkPatch`), so a relink never leaves a stale date. A to-do
   * deleted meanwhile (here or on another device) is skipped, never a failure. Returns the
   * linked to-dos, or null when the write failed (already toasted + reported by `wrapAsync`).
   */
  async function linkTodosToActivity(
    ids: readonly string[],
    link: ActivityLink | null
  ): Promise<TodoItem[] | null> {
    if (!ids.length) return [];
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        const linked = await todoRepo.patchTodos(ids, todoLinkPatch(link), {
          onMissing: 'skip',
        });
        const byId = new Map(linked.map((t) => [t.id, t]));
        todos.value = todos.value.map((t) => byId.get(t.id) ?? t);
        return linked;
      },
      { action: 'todoStore:linkTodosToActivity', surface: 'todos' }
    );
    return result ?? null;
  }

  /**
   * Delete several to-dos in ONE write. An id that is already gone is a no-op. Returns
   * false when the write failed (already toasted + reported by `wrapAsync`).
   */
  async function deleteTodos(ids: readonly string[]): Promise<boolean> {
    if (!ids.length) return true;
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        await todoRepo.deleteTodos(ids);
        const gone = new Set(ids);
        todos.value = todos.value.filter((t) => !gone.has(t.id));
        return true;
      },
      { action: 'todoStore:deleteTodos', surface: 'todos' }
    );
    return result ?? false;
  }

  /**
   * Open (not completed) to-dos linked to an activity. `activityId` is a soft reference, so
   * an activity that no longer resolves in `activityStore` has no linked to-dos.
   */
  function openTodosForActivity(activityId: string): TodoItem[] {
    if (!useActivityStore().activities.some((a) => a.id === activityId)) return [];
    return todos.value.filter((t) => !t.completed && t.activityId === activityId);
  }

  /**
   * The to-dos that belong to `activity`'s `sessionYmd` session (see `utils/activityLinks`),
   * split for display: open ones by due date (undated last), then done ones most recently
   * completed first. Each carries its scope (`'every-session'` = linked to the whole of a
   * repeating activity).
   */
  function todosForActivitySession(
    activity: FamilyActivity,
    sessionYmd: string
  ): { open: SessionItem<TodoItem>[]; done: SessionItem<TodoItem>[] } {
    const matched = itemsForSession(todos.value, todoLink, activity, sessionYmd);
    const scopeOf = new Map(matched.map((m) => [m.item.id, m.scope]));
    const withScope = (list: TodoItem[]) =>
      list.map((item) => ({ item, scope: scopeOf.get(item.id)! }));
    const openItems = matched.filter((m) => !m.item.completed).map((m) => m.item);
    const doneItems = matched.filter((m) => m.item.completed).map((m) => m.item);
    return {
      open: withScope(sortTodos(openItems, 'dueDate')),
      done: withScope(doneItems.sort(byCompletedDesc)),
    };
  }

  /**
   * Put a deleted to-do back exactly as it was, for the wall's undo.
   *
   * `CreateTodoInput` is `Omit<TodoItem, 'id' | 'createdAt' | 'updatedAt'>`, so
   * every other field round-trips: `completed`, `completedAt`, `someday`,
   * `dueTime`, `description` and the hint markers all survive. Only the two
   * repository-stamped timestamps are lost.
   *
   * TWO deliberate differences from `createTodo`, both load-bearing:
   *
   * 1. No `trackFeature`. A restore is not a new feature use, and counting it
   *    would inflate the to-do adoption metric by one for every undo.
   * 2. An idempotence guard. `createWithId` is a `set` that re-stamps
   *    `createdAt`, so a double-invoke would silently rewrite the record.
   *    `invokeToastAction` dismisses the toast before invoking, so this should
   *    be unreachable; one line makes it unreachable by construction rather
   *    than by timing.
   */
  async function restoreTodo(todo: TodoItem): Promise<TodoItem | null> {
    const existing = todos.value.find((t) => t.id === todo.id);
    if (existing) return existing;

    const { id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = todo;
    const result = await wrapAsync(
      isLoading,
      error,
      async () => {
        const restored = await todoRepo.createTodoWithId(id, rest);
        todos.value = [...todos.value, restored];
        return restored;
      },
      { action: 'todoStore:restoreTodo' }
    );
    return result ?? null;
  }

  async function toggleComplete(id: string, completedBy: string): Promise<TodoItem | null> {
    const existing = todos.value.find((t) => t.id === id);
    if (!existing) {
      // Never silent: every caller funnels here, so one warn covers them all.
      // Mirrors listStore.setAllItemsCompleted.
      logEvent({
        level: 'warn',
        surface: 'todos',
        message: 'toggleComplete: to-do not found',
        context: { action: 'toggle_complete_missing_todo' },
      });
      return null;
    }

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
        logHintCompleted(existing);
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
    createTodos,
    linkTodosToActivity,
    deleteTodos,
    openTodosForActivity,
    todosForActivitySession,
    updateTodo,
    deleteTodo,
    discardTodo,
    restoreTodo,
    toggleComplete,
    setSomeday,
    acknowledgeHint,
    resetState,
  };
});
