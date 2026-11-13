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
import { useChoreStore } from '@/stores/choreStore';
import { useToday } from '@/composables/useToday';
import { useChoreClock } from '@/composables/useChoreClock';
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
import { buildWallJobs, captureListRemoval, jobWriteKey, sortJobs } from '@/utils/wallJobs';
import { plateClock } from '@/utils/todoPlate';
import { assertNever } from '@/utils/assertNever';
import { currentBlock, isChoreRefusal, type BeanChoreDay } from '@/utils/chores';
import { DEFAULT_CHORE_EMOJI } from '@/constants/choreBlocks';
import { useAuthStore } from '@/stores/authStore';
import { UNASSIGNED } from '@/utils/wallJobs';
import type { WallChoreLane, WallJob, WallListGroup } from '@/types/wall';

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
 *
 * `run` may instead answer `'handled'`: the store REFUSED the write and has
 * already told the family and logged why (the chore store's tagged refusal,
 * `isChoreRefusal`). That is not a failure, so it is neither reported nor
 * paged a second time, and it is not a success either: `write` answers false.
 */
type RunOutcome = boolean | 'handled';

async function write(
  op: WriteOp,
  kind: WallJob['source'],
  run: () => Promise<RunOutcome>,
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
    const outcome = await run();
    if (outcome === 'handled') return false;
    if (!outcome) return fail();
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

export interface UseWallJobsOptions {
  /**
   * Build the chore lanes (#146). The PAGE reads the `choreboard` gate once and passes it here;
   * off (the default), no chore day is read and the result is exactly the pre-chores board.
   */
  chores?: boolean;
}

export function useWallJobs(options: UseWallJobsOptions = {}) {
  const familyStore = useFamilyStore();
  const listStore = useListStore();
  const todoStore = useTodoStore();
  const choreStore = useChoreStore();
  const authStore = useAuthStore();
  const { today } = useToday();
  const { choreClock } = useChoreClock();
  const choresOn = options.chores === true;

  /** Rows mid-write, so a double-tap cannot fire two writes for one job. */
  const pending = ref<Set<string>>(new Set());

  const result = computed(() => {
    // HUMANS only, matching every renderer. Passing all members meant a
    // pet-owned list was filed under the pet — a key nothing iterates — so it
    // appeared in no column, no orphan block and no drawer. As an orphan it is
    // at least findable. (`ListDetailModal`'s picker does let you hand a list
    // to the dog.)
    const memberIds = familyStore.sortedHumans.map((m) => m.id);
    // Each bean's chore day from the store's ONE getter (the page, the briefing and the widget
    // read the same one), so the wall cannot count a chore differently. Not read at all while
    // the gate is off.
    const choreDays: Record<string, BeanChoreDay> = {};
    if (choresOn) for (const id of memberIds) choreDays[id] = choreStore.choreDayFor(id);
    return buildWallJobs({
      todos: todoStore.todos,
      lists: listStore.lists,
      memberIds,
      // The day is the reactive `today` (so the board recomputes at midnight); the clock adds
      // the minute a timed to-do turns overdue at.
      clock: { ...plateClock(), ymd: today.value },
      choreDays,
    });
  });

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

  /** A bean's chore lane, or `null` (the gate is off, or the wall does not know the bean). */
  const choreLaneFor = (memberId: string): WallChoreLane | null =>
    result.value.choreLanesByMember[memberId] ?? null;

  /**
   * Tick a job, whichever store it actually lives in. `actor` is who is credited.
   *
   * A map rather than an if/else: a new job source is one more entry, and the
   * `Record` type refuses to compile until it has one.
   *
   * A chore is ticked FOR the lane's bean (`ownerId`: a shared chore is one mark per bean) and
   * credited to `actor`, the same crediting rule as the other two. The store passes
   * `errorToast: false` for the wall, because `write()` below reports a failed toggle.
   */
  const writers: Record<WallJob['source'], (job: WallJob, actor: string) => Promise<unknown>> = {
    todo: (job, actor) => todoStore.toggleComplete(job.todoId as string, actor),
    list: (job, actor) => listStore.toggleItem(job.listId as string, job.itemId as string, actor),
    chore: (job, actor) =>
      choreStore.toggleChore(job.choreId as string, job.ownerId, { surface: 'wall', by: actor }),
  };

  async function toggle(job: WallJob): Promise<void> {
    const writeKey = jobWriteKey(job);
    if (pending.value.has(writeKey)) return;
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

    pending.value = new Set(pending.value).add(writeKey);
    // `write` never throws, so the pending cleanup below needs no `finally`.
    await write(
      'job_toggle',
      job.source,
      // `!== null` deliberately, matching the previous behaviour exactly: the
      // stores normalise a swallowed failure to null. A chore tick the store
      // refused (already toasted and logged) is `'handled'`, never a failure.
      () =>
        writers[job.source](job, actor).then((written) =>
          isChoreRefusal(written) ? 'handled' : written !== null
        ),
      () => reportJobToggleFailed(job.source, job.choreId ?? job.todoId ?? job.listId ?? job.key)
    );
    const next = new Set(pending.value);
    next.delete(writeKey);
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
   * Add a chore for `memberId` from an unlocked wall (#146): the block happening now, every
   * day, credited to `actorId` (the grown-up who unlocked). The wall's ONE chore edit;
   * anything richer (a picture, the days, who else) belongs in the app.
   *
   * Not routed through `write()`: `createChore` already toasts and logs its own refusal (not
   * an adult, no title) and its own write failure (`wrapAsync`), so a second report here would
   * double the toast. Only a throw escaping the store is reported here.
   */
  async function addChore(memberId: string, title: string, actorId: string): Promise<boolean> {
    const trimmed = title.trim();
    if (!trimmed) return false;
    const block = currentBlock(choreClock.value.hhmm, choreStore.starts);
    try {
      const created = await choreStore.createChore(
        { title: trimmed, emoji: DEFAULT_CHORE_EMOJI, assigneeIds: [memberId], block },
        actorId
      );
      if (!created) return false;
      logEvent({
        level: 'info',
        surface: SURFACE,
        message: 'wall_chore_added',
        context: { action: 'chore_add', kind: 'chore', slot: block },
      });
      return true;
    } catch (error) {
      reportError({
        surface: SURFACE,
        message: 'wall_chore_add_failed',
        severity: 'critical',
        error: error instanceof Error ? error : new Error(String(error)),
        context: { action: 'chore_add', kind: 'chore', slot: block },
      });
      return false;
    }
  }

  /**
   * A chore row is built `locked` (`wallJobs.choreJob`): chores are renamed and deleted in the
   * app. A rename or remove that reaches here anyway is refused BEFORE any store is touched,
   * told to the family and logged, never passed to the list store with undefined ids.
   * A warning, not a page: nothing was written and no data is at risk.
   */
  function refuseChoreEdit(op: 'rename' | 'remove', job: WallJob): false {
    try {
      logEvent({
        level: 'warn',
        surface: SURFACE,
        message: 'wall_chore_edit_refused',
        context: { action: op === 'rename' ? 'job_rename' : 'job_remove', kind: 'chore' },
      });
      reportJobEditFailed(op, 'chore', job.choreId ?? job.key);
    } catch (reportingError) {
      console.error(`[${SURFACE}] could not report a refused chore ${op}`, reportingError);
    }
    return false;
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
    let run: () => Promise<unknown>;
    switch (job.source) {
      case 'todo':
        run = () => todoStore.updateTodo(job.todoId as string, { title: trimmed });
        break;
      case 'list':
        run = () => listStore.updateItemText(job.listId as string, job.itemId as string, trimmed);
        break;
      case 'chore':
        return refuseChoreEdit('rename', job);
      default:
        return assertNever(job.source, 'useWallJobs.renameJob');
    }
    return write(
      'job_rename',
      job.source,
      () => run().then((written) => written !== null),
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

    /**
     * Per source: the delete, and the undo for it (captured up front; `null` if the record is
     * already gone, in which case the delete below will refuse and report before undo is ever
     * offered). For a list that is ONE item and its position, never a snapshot of the whole
     * array: the undo is offered for six seconds while an add row sits under the same list,
     * and writing a pre-delete array back would destroy anything added in between.
     */
    let remove: () => Promise<boolean>;
    let restore: (() => Promise<unknown>) | null;
    switch (job.source) {
      case 'list': {
        const list = listStore.lists.find((l) => l.id === job.listId);
        const removal = list ? captureListRemoval(list, job.itemId as string) : null;
        remove = () =>
          listStore
            .removeItem(job.listId as string, job.itemId as string)
            .then((written) => written !== null);
        restore = removal
          ? () => listStore.restoreItem(job.listId as string, removal.item, removal.index)
          : null;
        break;
      }
      case 'todo': {
        const snapshot = todoStore.todos.find((td) => td.id === job.todoId);
        // `deleteTodo` answers with a bare boolean, and returns false for a
        // throw as well as a refusal, so that branch is the whole failure
        // signal on this path.
        remove = () => todoStore.deleteTodo(job.todoId as string);
        restore = snapshot ? () => todoStore.restoreTodo(snapshot) : null;
        break;
      }
      case 'chore':
        return refuseChoreEdit('remove', job);
      default:
        return assertNever(job.source, 'useWallJobs.removeJob');
    }

    const removed = await write('job_remove', job.source, remove, () =>
      reportJobEditFailed('remove', job.source, job.todoId ?? job.itemId ?? job.key)
    );
    if (!removed) return false;

    // Nothing to offer if the snapshot could not be taken. Say so rather than
    // showing an Undo that would do nothing.
    if (!restore) return true;
    const undo = restore;

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
          () => undo().then((written) => written !== null),
          () => reportJobEditFailed('undo', job.source, job.todoId ?? job.itemId ?? job.key)
        );
      },
    });
    return true;
  }

  const isPending = (job: WallJob) => pending.value.has(jobWriteKey(job));

  return {
    /** The `choreboard` gate as the page passed it. */
    choresOn,
    jobsFor,
    choreLaneFor,
    listsFor,
    orphanLists,
    choresFor,
    todosFor,
    unassignedTodos,
    allTodos,
    toggle,
    addListItem,
    addTodo,
    addChore,
    renameJob,
    removeJob,
    isPending,
  };
}
