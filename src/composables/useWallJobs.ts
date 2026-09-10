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
  reportJobEditFailed,
  reportJobToggleFailed,
  reportListAddFailed,
  reportTodoAddFailed,
} from '@/utils/actionFailure';
import { showToast } from '@/composables/useToast';
import { useTranslationStore } from '@/stores/translationStore';
import { fillTemplate } from '@/utils/fillTemplate';
import { buildWallJobs, captureListRemoval, sortJobs } from '@/utils/wallJobs';
import { useAuthStore } from '@/stores/authStore';
import { UNASSIGNED } from '@/utils/wallJobs';
import type { WallJob, WallListGroup } from '@/types/wall';
import type { FamilyListItem, TodoItem } from '@/types/models';

const SURFACE = 'beanie-wall';

/**
 * Every write the wall can make. The key IS the `action` context value, so no
 * lookup table carries one.
 */
type WriteOp =
  'job_toggle' | 'list_add' | 'todo_add' | 'job_rename' | 'job_remove' | 'job_remove_undo';

/**
 * Literal message strings only, never built by interpolation: a CloudWatch
 * filter is worth exactly as much as `grep` finding the string in this file.
 */
const WRITE_OPS: Record<WriteOp, { ok: string; failed: string }> = {
  job_toggle: { ok: 'wall_job_toggled', failed: 'wall_job_toggle_failed' },
  list_add: { ok: 'wall_list_item_added', failed: 'wall_list_add_failed' },
  todo_add: { ok: 'wall_todo_added', failed: 'wall_todo_add_failed' },
  job_rename: { ok: 'wall_job_renamed', failed: 'wall_job_rename_failed' },
  job_remove: { ok: 'wall_job_removed', failed: 'wall_job_remove_failed' },
  job_remove_undo: { ok: 'wall_job_remove_undone', failed: 'wall_job_remove_undo_failed' },
};

/**
 * ONE error contract for every wall write.
 *
 * This file used to carry three hand-copied try/catch/report/log blocks, which
 * had already drifted from each other (the toggle logged `action: 'job_toggled'`
 * on success but `'job_toggle'` on failure; the two adds carried `kind: 'ok'` on
 * success and no `kind` at all on failure). Six operations written that way
 * would be six chances to drift. Adding a seventh is now one `write()` call.
 *
 * `run` returns "did the store actually write". Normalising the stores' two
 * return conventions is the caller's job precisely because this is the only
 * place that has to know the difference: the list actions, `updateTodo` and
 * `createTodo` answer with an entity or `null`, while `deleteTodo` answers with
 * a bare boolean — and returns `false` for a throw as well as a refusal, so on
 * that path the `false` branch is the entire failure signal.
 *
 * `onRefused` is the user-facing half: `actionFailure`'s reporters toast the
 * family in their own language and print a cause plus a fix to the console.
 * Nothing here can fail silently — a refusal and a throw take the same path.
 */
async function write(
  op: WriteOp,
  kind: WallJob['source'],
  run: () => Promise<boolean>,
  onRefused: () => void
): Promise<boolean> {
  // One definition of "this write failed", so a refusal and a throw cannot
  // drift into reporting different things.
  //
  // Its OWN try/catch, because both halves can throw: `onRefused` reaches the
  // translation store and the toast queue, and `reportError` reaches the
  // telemetry queue. Without this, a throw from inside `fail` on the refusal
  // path would fall into the outer catch and report a SECOND time with the
  // toast's error instead of the real refusal — and a throw on the catch path
  // would escape `write` entirely, which callers are promised cannot happen.
  const fail = (error?: unknown): false => {
    try {
      onRefused();
    } catch (reportingError) {
      console.error(`[${SURFACE}] could not report a failed ${op} to the user`, reportingError);
    }
    try {
      reportError({
        surface: SURFACE,
        message: WRITE_OPS[op].failed,
        severity: 'critical',
        ...(error === undefined
          ? {}
          : { error: error instanceof Error ? error : new Error(String(error)) }),
        context: { action: op, kind },
      });
    } catch (reportingError) {
      console.error(`[${SURFACE}] could not report a failed ${op} to telemetry`, reportingError);
    }
    return false;
  };

  try {
    // `wrapAsync` swallows real store failures and answers the same way a
    // not-found refusal does, so this branch — not the catch — is where most
    // store-originated failures actually land. It carries the paging signal too.
    if (!(await run())) return fail();
  } catch (error) {
    return fail(error);
  }
  logEvent({
    level: 'info',
    surface: SURFACE,
    message: WRITE_OPS[op].ok,
    context: { action: op, kind },
  });
  return true;
}

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
    // `write` never throws, so the pending cleanup below needs no `finally`.
    await write(
      'job_toggle',
      job.source,
      // `!== null` deliberately, matching the previous behaviour exactly: the
      // stores normalise a swallowed failure to null.
      () => writers[job.source](job, actor).then((written) => written !== null),
      () => reportJobToggleFailed(job.source, job.todoId ?? job.listId ?? job.key)
    );
    const next = new Set(pending.value);
    next.delete(job.key);
    pending.value = next;
  }

  /**
   * Add an item to a list — the ONE thing unlocking the wall actually enables.
   *
   * Standing at the kitchen screen, "put bread on the shopping list" is the
   * natural action after ticking; editing an activity is not, which is why
   * activities stay read-only here and live in the app.
   */
  async function addListItem(listId: string, title: string): Promise<boolean> {
    const trimmed = title.trim();
    if (!trimmed) return false;
    return write(
      'list_add',
      'list',
      () => listStore.addItem(listId, trimmed).then((written) => written !== null),
      () => reportListAddFailed(listId)
    );
  }

  /**
   * Capture a to-do from the wall: unassigned, due today. Anything richer (who,
   * when, a note) belongs in the app — this exists so "remember the passports"
   * can be said out loud and typed once, standing at the screen.
   */
  async function addTodo(title: string): Promise<boolean> {
    const trimmed = title.trim();
    if (!trimmed) return false;
    return write(
      'todo_add',
      'todo',
      () =>
        todoStore
          .createTodo({
            title: trimmed,
            dueDate: today.value,
            assigneeIds: [],
            completed: false,
            // Created BY whoever's session is running the wall — that is a fact
            // about provenance, not a claim about who has to do it.
            createdBy: authStore.currentUser?.memberId ?? '',
          })
          .then((written) => written !== null),
      () => reportTodoAddFailed()
    );
  }

  /**
   * Rename a job in place, whichever store it lives in.
   *
   * Both stores no-op an empty or unchanged title, which is what lets the row's
   * "clear the field and press Enter" revert cleanly instead of deleting.
   * Deletion is the trash button's job, never an emptied edit.
   */
  async function renameJob(job: WallJob, title: string): Promise<boolean> {
    const trimmed = title.trim();
    if (!trimmed || trimmed === job.title) return false;
    return write(
      'job_rename',
      job.source,
      () =>
        (job.source === 'todo'
          ? todoStore.updateTodo(job.todoId as string, { title: trimmed })
          : listStore.updateItemText(job.listId as string, job.itemId as string, trimmed)
        ).then((written) => written !== null),
      () => reportJobEditFailed('rename', job.source, job.todoId ?? job.itemId ?? job.key)
    );
  }

  /**
   * Remove a job, and offer to put it back.
   *
   * The snapshot is taken BEFORE the delete, because after it the record is
   * gone and there is nothing left to copy. For a list that snapshot is not
   * just `items`: removing the last open item on a one-off list files it, and
   * the wall hides filed lists, so restoring items alone would make the whole
   * list vanish instead of putting one row back. `captureListRestore` owns that
   * rule.
   *
   * Undo rather than a confirm dialog: the wall has never opened a modal, a
   * dialog on a screen the whole family can see is intrusive, and a mis-tap
   * standing at a wall is common enough that reversal beats interrogation.
   */
  async function removeJob(job: WallJob): Promise<boolean> {
    const { t } = useTranslationStore();

    // Captured up front; `undefined` if the record is already gone, in which
    // case the delete below will refuse and report before undo is ever offered.
    // ONE item and its position, never a snapshot of the whole array: the undo
    // is offered for six seconds while an add row sits under the same list, and
    // writing a pre-delete array back would destroy anything added in between.
    const listRemoval: { item: FamilyListItem; index: number } | null =
      job.source === 'list'
        ? (() => {
            const list = listStore.lists.find((l) => l.id === job.listId);
            return list ? captureListRemoval(list, job.itemId as string) : null;
          })()
        : null;
    const todoSnapshot: TodoItem | undefined =
      job.source === 'todo' ? todoStore.todos.find((td) => td.id === job.todoId) : undefined;

    const removed = await write(
      'job_remove',
      job.source,
      () =>
        job.source === 'todo'
          ? // `deleteTodo` answers with a bare boolean, and returns false for a
            // throw as well as a refusal, so that branch is the whole failure
            // signal on this path.
            todoStore.deleteTodo(job.todoId as string)
          : listStore
              .removeItem(job.listId as string, job.itemId as string)
              .then((written) => written !== null),
      () => reportJobEditFailed('remove', job.source, job.todoId ?? job.itemId ?? job.key)
    );
    if (!removed) return false;

    // Nothing to offer if the snapshot could not be taken. Say so rather than
    // showing an Undo that would do nothing.
    if (!listRemoval && !todoSnapshot) return true;

    showToast('info', fillTemplate(t('wall.job.removed'), { title: job.title }), undefined, {
      surface: SURFACE,
      // 6s, matching `useGiveDose` and `useContributeToGoal`. Toasts carrying an
      // `actionFn` are exempt from dedupe, so two quick removes each keep their
      // own closure.
      durationMs: 6000,
      actionLabel: t('wall.job.undo'),
      actionFn: async () => {
        await write(
          'job_remove_undo',
          job.source,
          () =>
            (todoSnapshot
              ? todoStore.restoreTodo(todoSnapshot)
              : listStore.restoreItem(
                  job.listId as string,
                  (listRemoval as { item: FamilyListItem; index: number }).item,
                  (listRemoval as { item: FamilyListItem; index: number }).index
                )
            ).then((written) => written !== null),
          () => reportJobEditFailed('undo', job.source, job.todoId ?? job.itemId ?? job.key)
        );
      },
    });
    return true;
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
    renameJob,
    removeJob,
    isPending,
  };
}
