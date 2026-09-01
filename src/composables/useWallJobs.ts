/**
 * The wall's single source of "whose jobs are these".
 *
 * A thin reactive wrapper over the pure `buildWallJobs` plus the write path —
 * a query/command split, so a future change to the merge rule cannot break
 * toggling and vice-versa. All four screens read from ONE instance of this,
 * created by `BeanieWallPage`, so no screen can re-derive the rule differently.
 */
import { computed, ref } from 'vue';
import { useFamilyStore } from '@/stores/familyStore';
import { useListStore } from '@/stores/listStore';
import { useTodoStore } from '@/stores/todoStore';
import { useToday } from '@/composables/useToday';
import { logEvent } from '@/services/telemetry/logEvent';
import { reportError } from '@/utils/errorReporter';
import {
  reportJobToggleFailed,
  reportListAddFailed,
  reportTodoAddFailed,
} from '@/utils/actionFailure';
import { buildWallJobs, sortJobs } from '@/utils/wallJobs';
import { useAuthStore } from '@/stores/authStore';
import { UNASSIGNED } from '@/utils/wallJobs';
import type { WallJob, WallListGroup } from '@/types/wall';

const SURFACE = 'beanie-wall';

export function useWallJobs() {
  const familyStore = useFamilyStore();
  const listStore = useListStore();
  const todoStore = useTodoStore();
  const authStore = useAuthStore();
  const { today } = useToday();

  /** Rows mid-write, so a double-tap cannot fire two writes for one job. */
  const pending = ref<Set<string>>(new Set());

  const result = computed(() =>
    buildWallJobs({
      todos: todoStore.todos,
      lists: listStore.lists,
      // HUMANS only, matching every renderer. Passing all members meant a
      // pet-owned list was filed under the pet — a key nothing iterates — so it
      // appeared in no column, no orphan block and no drawer. As an orphan it is
      // at least findable. (`ListDetailModal`'s picker does let you hand a list
      // to the dog.)
      memberIds: familyStore.sortedHumans.map((m) => m.id),
      todayYmd: today.value,
    })
  );

  /** Every wall-safe list this bean owns, whole, in list order. */
  const listsFor = (memberId: string): WallListGroup[] =>
    (result.value.listsByMember[memberId] ?? []).map((group) => ({
      ...group,
      jobs: sortJobs(group.jobs),
    }));

  /** Lists whose owner the wall does not know — shown, never dropped. */
  const orphanLists = computed(() =>
    result.value.orphanLists.map((group) => ({ ...group, jobs: sortJobs(group.jobs) }))
  );

  /** Everything on this bean's lists, flattened — for a card's summary line. */
  const choresFor = (memberId: string): WallJob[] =>
    sortJobs((result.value.listsByMember[memberId] ?? []).flatMap((g) => g.jobs));

  /**
   * The ACTIONABLE to-dos for a bean: due today or already late. A lane and a
   * summary card answer "what now?", so they deliberately exclude what is
   * merely coming up — the drawer is where the full list lives.
   */
  const todosFor = (memberId: string): WallJob[] =>
    sortJobs(
      result.value.todos.filter(
        (j) => j.ownerId === memberId && (j.bucket === 'today' || j.bucket === 'overdue')
      )
    );

  /**
   * To-dos due now that belong to NOBODY.
   *
   * Surfaced separately because every other accessor is keyed by member, so
   * unassigned work counted towards nothing and gated nothing — and the card
   * that opens the drawer is gated on a count. The wall's own quick-add creates
   * to-dos unassigned by design, so without this a family whose only to-do was
   * added at the wall had no route back to it from any view.
   */
  const unassignedTodos = computed(() =>
    sortJobs(
      result.value.todos.filter(
        (j) => j.ownerId === UNASSIGNED && (j.bucket === 'today' || j.bucket === 'overdue')
      )
    )
  );

  /** Every to-do, for the drawer. */
  const allTodos = computed(() => result.value.todos);

  /** Everything this bean owes today — what a lane shows. */
  const jobsFor = (memberId: string): WallJob[] => todosFor(memberId);

  /**
   * Tick a job, whichever store it actually lives in.
   *
   * A two-entry map rather than an if/else: a third job source later is one
   * more entry, not a third arm grafted onto a branch.
   */
  const writers: Record<WallJob['source'], (job: WallJob, memberId: string) => Promise<unknown>> = {
    todo: (job, memberId) => todoStore.toggleComplete(job.todoId as string, memberId),
    list: (job, memberId) =>
      listStore.toggleItem(job.listId as string, job.itemId as string, memberId),
  };

  async function toggle(job: WallJob): Promise<void> {
    if (pending.value.has(job.key)) return;
    // Credit the job's OWNER, not whoever's session opened the wall. The wall
    // is a shared screen: the child standing at it is the one doing the chore,
    // and `completedBy` is rendered as "Done by {name}" across the app.
    // Unassigned work has no owner to credit, so the person standing at the
    // wall takes it. Everything else still credits the job's OWNER, not the
    // session — the child doing the chore is who did it.
    // Also covers an ORPHAN list's owner: a deleted or unsynced member id
    // written to `completedBy` renders as "Done by " with a hole in it.
    const known = familyStore.members.some((m) => m.id === job.ownerId);
    const actor = known ? job.ownerId : (authStore.currentUser?.memberId ?? '');

    pending.value = new Set(pending.value).add(job.key);
    try {
      const written = await writers[job.source](job, actor);
      if (written === null) {
        // The store did not write. `wrapAsync` swallows real failures and
        // returns undefined (normalised to null) just as a not-found refusal
        // does, so this branch — not the catch below — is where EVERY
        // store-originated failure actually lands. It therefore has to carry
        // the paging signal: a tick that looks done and isn't is data loss
        // from the family's point of view.
        reportJobToggleFailed(job.source, job.todoId ?? job.listId ?? job.key);
        reportError({
          surface: SURFACE,
          message: 'wall_job_toggle_failed',
          severity: 'critical',
          context: { action: 'job_toggle', kind: job.source },
        });
        return;
      }
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'wall_job_toggled',
        context: { action: 'job_toggled', kind: job.source },
      });
    } catch (error) {
      // wrapAsync already toasted; this adds the paging signal, because a lost
      // tick is user-visible data loss from the family's point of view.
      reportError({
        surface: SURFACE,
        message: 'wall_job_toggle_failed',
        severity: 'critical',
        error: error instanceof Error ? error : new Error(String(error)),
        context: { action: 'job_toggle', kind: job.source },
      });
    } finally {
      const next = new Set(pending.value);
      next.delete(job.key);
      pending.value = next;
    }
  }

  /**
   * Add an item to a list — the ONE thing unlocking the wall actually enables.
   *
   * Standing at the kitchen screen, "put bread on the shopping list" is the
   * natural action after ticking; editing an activity is not, which is why
   * activities stay read-only here and live in the app. Same write discipline
   * as `toggle`: a refused write is never silent.
   */
  async function addListItem(listId: string, title: string): Promise<boolean> {
    const trimmed = title.trim();
    if (!trimmed) return false;
    try {
      const written = await listStore.addItem(listId, trimmed);
      if (written === null) {
        reportListAddFailed(listId);
        reportError({
          surface: SURFACE,
          message: 'wall_list_add_failed',
          severity: 'critical',
          context: { action: 'list_add' },
        });
        return false;
      }
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'wall_list_item_added',
        context: { action: 'list_add', kind: 'ok' },
      });
      return true;
    } catch (error) {
      reportError({
        surface: SURFACE,
        message: 'wall_list_add_failed',
        severity: 'critical',
        error: error instanceof Error ? error : new Error(String(error)),
        context: { action: 'list_add' },
      });
      return false;
    }
  }

  /**
   * Capture a to-do from the wall: unassigned, due today. Anything richer (who,
   * when, a note) belongs in the app — this exists so "remember the passports"
   * can be said out loud and typed once, standing at the screen.
   */
  async function addTodo(title: string): Promise<boolean> {
    const trimmed = title.trim();
    if (!trimmed) return false;
    try {
      const written = await todoStore.createTodo({
        title: trimmed,
        dueDate: today.value,
        assigneeIds: [],
        completed: false,
        // Created BY whoever's session is running the wall — that is a fact
        // about provenance, not a claim about who has to do it.
        createdBy: authStore.currentUser?.memberId ?? '',
      });
      if (written === null) {
        reportTodoAddFailed();
        reportError({
          surface: SURFACE,
          message: 'wall_todo_add_failed',
          severity: 'critical',
          context: { action: 'todo_add' },
        });
        return false;
      }
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'wall_todo_added',
        context: { action: 'todo_add', kind: 'ok' },
      });
      return true;
    } catch (error) {
      reportError({
        surface: SURFACE,
        message: 'wall_todo_add_failed',
        severity: 'critical',
        error: error instanceof Error ? error : new Error(String(error)),
        context: { action: 'todo_add' },
      });
      return false;
    }
  }

  const isPending = (job: WallJob) => pending.value.has(job.key);

  return {
    jobsFor,
    listsFor,
    orphanLists,
    choresFor,
    todosFor,
    unassignedTodos,
    allTodos,
    toggle,
    addListItem,
    addTodo,
    isPending,
  };
}
