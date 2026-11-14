/**
 * The beanie wall's jobs rule — pure, store-free, Pinia-free.
 *
 * This is the part of the wall most likely to change: it sits on two models
 * that are mid-migration (`TodoItem.assigneeId` is deprecated in favour of
 * `assigneeIds`; list `lifecycle` already moved once). Keeping it as plain
 * functions over plain arrays means its tests need no store harness and no
 * fake timers, and a future change to the merge rule cannot break the write
 * path (which lives in `useWallJobs`).
 *
 * THE RULE, in one place:
 *   a bean's LISTS = every wall-safe list they are assigned to that is showing
 *                    today (`wallShowsList`), repeating or one-off, each rendered
 *                    whole under their name (a list for two beans is in both lanes)
 *   orphan lists   = showing lists none of whose assignees is a member we know about
 *   to-dos         = every to-do bar `someday`, surprise hints and those whose
 *                    "Show from" date is still ahead, tagged by their plate
 *                    (`utils/todoPlate`), assigned or not
 *   chore lanes    = each known bean's chore day (`beanChoreDay`, the choreboard's ONE read
 *                    model, #146) as wall jobs, the block happening now first. Passed in by
 *                    the caller, which passes nothing while the `choreboard` gate is off: this
 *                    rule never reads the flag.
 *
 * Lists are NOT split by lifecycle any more. A recurring "leo's jobs" and a
 * one-off "swim bag" are both Leo's list; parking one under his name and the
 * other in a strip along the bottom made half of them easy to miss.
 *
 * To-dos are not filtered to today either. Showing only today's made a family
 * with eight to-dos see one and assume the wall was broken; the rest are shown,
 * grouped by bucket, with today and overdue carrying the emphasis.
 *
 * Lists and to-dos are still deduped against each other: the same task written
 * in both places is one job, not two, and the dated to-do wins.
 */
import { todoCapabilities } from '@/utils/todoRecurrence';
import { assertNever } from '@/utils/assertNever';
import { blocksInDisplayOrder, type BeanChoreDay } from '@/utils/chores';
import type {
  Chore,
  ChoreBlock,
  FamilyList,
  FamilyListItem,
  ListCategory,
  TodoItem,
} from '@/types/models';
import { isSurpriseHint } from '@/constants/helpfulHints';
import { isKnownListCategory } from '@/constants/listCategories';
import type {
  WallChoreBlock,
  WallChoreLane,
  WallJob,
  WallJobsInput,
  WallJobsResult,
  WallListGroup,
  WallTodoBucket,
} from '@/types/wall';
import { listAssignees, normalizeAssignees } from '@/utils/assignees';
import { isFiled, isRecurring, listSubject } from '@/utils/listLifecycle';
import { daysBetweenYmd, extractDatePart } from '@/utils/date';
import { plateClock, plateOf, showRuleOf, todoPlate, type PlateClock } from '@/utils/todoPlate';

/**
 * Dedupe key. The same task legitimately exists as both a dated to-do and an
 * item on someone's repeating list ("feed the fish"), and showing it twice on
 * a wall makes the family think they have two jobs.
 */
/**
 * Categories whose CONTENTS must never appear on a shared screen.
 *
 * The wall hangs where children, guests, babysitters and cleaners read it at a
 * glance. A recurring health list spells out medication names; a `me` list is
 * personal by definition. The finance exclusion is enforced by a lint zone —
 * this is the same promise for the other sensitive categories, and it belongs
 * in the rule rather than in a component.
 */
const PRIVATE_LIST_CATEGORIES: readonly ListCategory[] = ['health', 'people', 'me'];

/**
 * A category this build doesn't know (synced from a newer client) fails CLOSED: the
 * wall is a shared screen, and an unknown category may well be a private one.
 */
export function isWallSafeList(list: FamilyList): boolean {
  return isKnownListCategory(list.category) && !PRIVATE_LIST_CATEGORIES.includes(list.category);
}

/**
 * Is the list on the wall today? The shared date rule (`listSubject` + `plateOf`, what the
 * briefing and the widget read), with one wall-only narrowing:
 *   - a one-off list shows unless it is `waiting` (its due date, or its "Show from" date,
 *     is still ahead; an undated one always shows);
 *   - a repeating list shows on its reset day (`today`), or between resets under Every Day
 *     (`upcoming` with the rule `now`). A Days Before window NEVER puts it on the wall: wall
 *     rows are the list's real items, so in the lead window they would be last round's ticks,
 *     and anything ticked there would be erased by the reset. Days Before is a heads-up on
 *     the briefing and widgets only. A repeating list with no resolvable reset day never shows.
 * Filing and the private categories are the caller's gates (`buildWallJobs`, `isWallSafeList`).
 */
export function wallShowsList(list: FamilyList, clock: PlateClock): boolean {
  const subject = listSubject(list, clock.ymd);
  if (!subject) return false;
  const plate = plateOf(subject, clock);
  if (!subject.repeating) return plate !== 'waiting';
  return plate === 'today' || (plate === 'upcoming' && showRuleOf(subject).kind === 'now');
}

/**
 * Owner id for work nobody has claimed. A real id can never be this, and it
 * keeps unassigned to-dos inside the same dedupe and keying machinery rather
 * than needing a parallel path.
 */
export const UNASSIGNED = '__unassigned__';

function dedupeKey(ownerId: string, title: string): string {
  return `${ownerId}::${title.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

/**
 * Which bucket a to-do falls in, or `null` when it does not belong on the wall
 * at all (a completion from an earlier day, or a to-do not showing yet).
 *
 * A completion stays until the end of the day it was made, in every bucket, so the row
 * never deletes itself out from under the finger and a mis-tick can be undone. Yesterday's
 * completions are history and drop off.
 */
function todoBucket(todo: TodoItem, clock: PlateClock): WallTodoBucket | null {
  // A completion stays put for the rest of the day it happened, whatever bucket it is in,
  // struck through and still tappable so a mis-tick can be undone. It drops off tomorrow,
  // when it is history rather than work.
  //
  // This used to key on the DUE date, so ticking an overdue job made the row vanish under
  // the finger while the celebration fired over an empty slot, whereas today's and undated
  // ones stayed and crossed out. Same gesture, two different outcomes.
  //
  // `completedAt` is always written by `todoStore.toggleTodo`, so a completed to-do
  // without one is pre-field history and correctly drops.
  // `extractDatePart`, NOT `.slice(0, 10)`: `completedAt` is a UTC ISO timestamp
  // (`toISODateString` is `toISOString()`) while `todayYmd` is the LOCAL day. Slicing
  // compares a UTC date to a local one, so east of UTC every morning tick and west of it
  // every evening tick reads as a different day — reinstating, for most of the world's
  // waking hours, the exact vanish-under-the-finger glitch this branch exists to remove.
  if (todo.completed && extractDatePart(todo.completedAt ?? '') !== clock.ymd) return null;

  // The one date rule (time-aware). `todoPlate` ignores `completed`, so a to-do ticked today
  // keeps its bucket; one not showing yet stays off the wall, ticked or not.
  // A ticked to-do is placed by the clock AT ITS COMPLETION: one done before its time must
  // not slide into Late when that time passes, and one done late must not jump from Late to
  // Today under the finger.
  const at = todo.completed && todo.completedAt ? new Date(todo.completedAt) : null;
  const placed =
    at && !Number.isNaN(at.getTime()) ? { ymd: clock.ymd, hhmm: plateClock(at).hhmm } : clock;
  const plate = todoPlate(todo, placed);
  return plate === 'waiting' ? null : plate;
}

function todoJob(
  todo: TodoItem,
  ownerId: string,
  bucket: WallTodoBucket,
  todayYmd: string
): WallJob {
  return {
    bucket,
    ...(bucket === 'overdue' && todo.dueDate
      ? { daysLate: daysBetweenYmd(todo.dueDate, todayYmd) }
      : {}),
    ...(todo.dueTime ? { dueTime: todo.dueTime } : {}),
    // The owner is part of the RENDER key: a to-do assigned to three beans becomes
    // three rows, which must not share a key. They are still ONE record, so writes
    // are guarded per to-do (`jobWriteKey`).
    key: `todo:${todo.id}:${ownerId}`,
    title: todo.title,
    done: todo.completed,
    ownerId,
    source: 'todo',
    todoId: todo.id,
    completedAt: todo.completedAt,
    // The same capability table the to-do page and drawer read (#123).
    ...(locked(todo) ? { locked: true } : {}),
  };
}

/** A to-do the wall must not rename or remove: one whose title or deletion belongs elsewhere. */
function locked(todo: TodoItem): boolean {
  const caps = todoCapabilities(todo);
  return !(caps.editTitle && caps.delete);
}

function listJob(list: FamilyList, item: FamilyListItem, ownerId: string): WallJob {
  return {
    // The lane owner is part of the RENDER key: a list for two beans renders in both lanes,
    // which must not share a key. Writes are guarded per item instead (`jobWriteKey`).
    key: `list:${list.id}:${item.id}:${ownerId}`,
    title: item.title,
    done: item.completed,
    ownerId,
    source: 'list',
    listId: list.id,
    itemId: item.id,
    listEmoji: list.emoji,
    completedAt: item.completedAt,
  };
}

/**
 * A chore as a wall job. Always `locked`: a chore is renamed, moved and deleted in the app (the
 * wall's one chore edit is adding one), and the tick still works. The owner is part of the key
 * because a shared chore is ticked separately per bean (one `done` mark each).
 */
function choreJob(chore: Chore, done: boolean, ownerId: string): WallJob {
  return {
    key: `chore:${chore.id}:${ownerId}`,
    title: chore.title,
    done,
    ownerId,
    source: 'chore',
    choreId: chore.id,
    ...(chore.emoji ? { listEmoji: chore.emoji } : {}),
    locked: true,
  };
}

/**
 * What a job's write touches, for the in-flight (`pending`) guard. A list item and a to-do are
 * each ONE record however many lanes show it (`toggleComplete` flips the to-do's own
 * `completed`), so the key leaves the lane out: a second tap in another assignee's lane while
 * the first write is in flight would toggle it again, overwriting `completedBy` or, for a
 * repeating to-do, rolling it past a second occurrence.
 *
 * A chore is the opposite: each bean's tick is its OWN record (a `done` mark keyed by member),
 * so the key keeps the owner. Without it every bean's copy of a shared chore would share one
 * pending key, and Pip's tick would block Juno's.
 */
export function jobWriteKey(job: WallJob): string {
  switch (job.source) {
    case 'list':
      return `list:${job.listId}:${job.itemId}`;
    case 'todo':
      return `todo:${job.todoId}`;
    case 'chore':
      return `chore:${job.choreId}:${job.ownerId}`;
    default:
      return assertNever(job.source, 'jobWriteKey');
  }
}

/**
 * One bean's chore day as a wall lane. Empty blocks are dropped; the order is the choreboard's
 * one display order (`blocksInDisplayOrder`): now, Anytime, still to come, passed.
 */
function choreLane(memberId: string, day: BeanChoreDay): WallChoreLane {
  const blocks = day.blocks;
  const current: ChoreBlock = blocks.find((b) => b.isNow)?.block ?? 'morning';
  const laneBlocks: WallChoreBlock[] = blocksInDisplayOrder(blocks.filter((b) => b.total > 0)).map(
    (b) => ({
      block: b.block,
      jobs: b.chores.map((item) => choreJob(item.chore, item.done, memberId)),
      done: b.done,
      total: b.total,
      allDone: b.allDone,
      celebrated: b.celebrated,
      isNow: b.isNow,
      ended: b.ended,
    })
  );
  return {
    memberId,
    current,
    blocks: laneBlocks,
    done: laneBlocks.reduce((n, b) => n + b.done, 0),
    total: laneBlocks.reduce((n, b) => n + b.total, 0),
  };
}

/**
 * Build every bean's jobs plus the shared lists.
 *
 * To-dos win a dedupe collision because they are the dated, explicitly
 * assigned one; the suppressed list item is a display-level omission only and
 * nothing is ever written to either store here.
 */
export function buildWallJobs(input: WallJobsInput): WallJobsResult {
  const { todos, lists, memberIds, clock, choreDays = {} } = input;
  const todayYmd = clock.ymd;

  const listsByMember: Record<string, WallListGroup[]> = {};
  const orphanLists: WallListGroup[] = [];
  const built: WallJob[] = [];
  /**
   * Owner+title of every to-do that is ACTIONABLE NOW.
   *
   * Dedupe has exactly one job: stop a single task appearing twice, once as a
   * dated to-do and once as an item on the owner's list. It deliberately does
   * NOT reach further —
   *   - a to-do due in three weeks must not delete today's chore of the same
   *     name off the board;
   *   - two to-dos that share a title on different days are two to-dos;
   *   - "milk" on the corner-shop list and on the big-shop list really is on
   *     both lists.
   * A single shared `seen` set started doing all three by accident the moment
   * to-dos stopped being filtered to today.
   */
  const suppress = new Set<string>();
  const known = new Set(memberIds);
  for (const id of memberIds) listsByMember[id] = [];

  // 1. To-dos first, so they win any dedupe collision with a list item: they
  //    are the dated, explicitly assigned form of the same task.
  for (const todo of todos) {
    // "Someday / maybe" stays off the wall: a deliberately unscheduled idea, not
    // work the family owes. Everything else reaches it (greg, 2026-10-10),
    // helpful hints and repeating reminders included, except the surprise hints.
    if (todo.someday) continue;
    // A surprise hint stays off a shared screen (`SURPRISE_HINT_TYPES`).
    if (isSurpriseHint(todo.hintType)) continue;

    const bucket = todoBucket(todo, clock);
    if (!bucket) continue;

    // Compare the raw date prefix, matching todoStore.dueTodayTodos and
    // listLifecycle. Converting to a LOCAL date here (extractDatePart) made the
    // wall disagree with the to-do list by a day for any timestamped dueDate.
    // Only work that is due now can stand in for a chore on today's board.
    const actionable = bucket === 'today' || bucket === 'overdue';

    const assignees = normalizeAssignees(todo).filter((id) => known.has(id));
    if (assignees.length === 0) {
      // Unassigned work is still the family's work. Dropping it was why to-dos
      // nobody had claimed never reached the wall at all.
      if (actionable) suppress.add(dedupeKey(UNASSIGNED, todo.title));
      built.push(todoJob(todo, UNASSIGNED, bucket, todayYmd));
      continue;
    }
    for (const ownerId of assignees) {
      if (actionable) suppress.add(dedupeKey(ownerId, todo.title));
      built.push(todoJob(todo, ownerId, bucket, todayYmd));
    }
  }

  // 2. Lists, whole, under each known assignee, while showing today.
  for (const list of lists) {
    if (!isWallSafeList(list)) continue;
    // A filed (completed) one-off list is done with; a recurring list resets
    // and is never filed, so this only ever removes finished shopping trips.
    if (!isRecurring(list) && isFiled(list)) continue;
    if (!wallShowsList(list, clock)) continue;

    // Dedupe and placement run per lane: a to-do of Leo's suppresses the item in Leo's
    // lane only. A list is an orphan only when none of its assignees is known; it then
    // renders once, faceless, under its first assignee's id.
    const owners = listAssignees(list).filter((id) => known.has(id));
    if (owners.length === 0) {
      orphanLists.push({ list, jobs: list.items.map((item) => listJob(list, item, list.ownerId)) });
      continue;
    }
    for (const ownerId of owners) {
      const jobs: WallJob[] = [];
      for (const item of list.items) {
        if (suppress.has(dedupeKey(ownerId, item.title))) continue;
        jobs.push(listJob(list, item, ownerId));
      }
      listsByMember[ownerId].push({ list, jobs });
    }
  }

  // 3. Chore lanes, one per KNOWN bean. A day for a member the wall does not know (removed, or
  //    a pet) is ignored; `beanChoreDay` already leaves a removed member's chores out of every
  //    living bean's day. Built only from what the caller passed, so an empty `choreDays`
  //    (the gate off) gives exactly the board this function built before chores existed.
  const choreLanesByMember: Record<string, WallChoreLane> = {};
  for (const id of memberIds) {
    const day = choreDays[id];
    if (day) choreLanesByMember[id] = choreLane(id, day);
  }

  return { listsByMember, orphanLists, todos: built, choreLanesByMember };
}

/** Done / total for the chores card and the chores view's header line. */
export interface WallChoreProgress {
  /** The block the count is for, or `null` when it counts the whole day. */
  block: ChoreBlock | null;
  done: number;
  total: number;
}

/**
 * How the visible beans are doing with their chores: the block happening now ("7 of 12 morning
 * chores done"), or the whole day when nobody has a chore in that block. Every lane shares one
 * clock, so they agree on which block is now.
 */
export function choreProgress(lanes: readonly WallChoreLane[]): WallChoreProgress {
  let done = 0;
  let total = 0;
  let dayDone = 0;
  let dayTotal = 0;
  for (const lane of lanes) {
    dayDone += lane.done;
    dayTotal += lane.total;
    const now = lane.blocks.find((b) => b.block === lane.current);
    if (now) {
      done += now.done;
      total += now.total;
    }
  }
  const current = lanes[0]?.current ?? null;
  if (total > 0 && current) return { block: current, done, total };
  return { block: null, done: dayDone, total: dayTotal };
}

/**
 * One group per list for a COMBINED view (the lists card, the list sheet).
 *
 * `buildWallJobs` emits a list once per known assignee on purpose, so a shared list shows
 * in each person's lane. A view that walks every lane (`beans.flatMap(listsFor)`) must not
 * inherit that, or a list for two beans renders as two cards with one `:key`. The first
 * group per `list.id` is kept, so the list is credited to the first visible assignee's
 * lane, as a combined to-do row is (`uniqueTodoJobs`).
 */
export function uniqueListGroups(groups: readonly WallListGroup[]): WallListGroup[] {
  const seen = new Set<string>();
  return groups.filter((group) => {
    if (seen.has(group.list.id)) return false;
    seen.add(group.list.id);
    return true;
  });
}

/** Outstanding-first, so what still needs doing is what you read first. */
export function sortJobs(jobs: readonly WallJob[]): WallJob[] {
  return [...jobs].sort((a, b) => Number(a.done) - Number(b.done));
}

/**
 * Who owes a row, without the unassigned sentinel: every owner on a combined row
 * (`uniqueTodoJobs`), the row's own owner otherwise. Empty means nobody has claimed it.
 */
export function jobOwnerIds(job: WallJob): string[] {
  return (job.ownerIds ?? [job.ownerId]).filter((id) => id !== UNASSIGNED);
}

/**
 * One row per to-do for a COMBINED view.
 *
 * `buildWallJobs` emits a to-do once per assignee on purpose, so a shared to-do
 * shows in each person's lane. A view that lists everyone together (the drawer,
 * the summary card) must not inherit that, or a to-do shared by two people is
 * listed and counted twice. Rows collapse by `todoId`, keeping the first row's
 * position and collecting every owner in `ownerIds`. When `allowed` is given
 * (the wall's person filter), owners outside it are dropped and a to-do none of
 * whose owners is visible disappears; unassigned work is always visible.
 * Non-to-do rows pass through untouched.
 */
export function uniqueTodoJobs(
  jobs: readonly WallJob[],
  allowed: ReadonlySet<string> | null = null
): WallJob[] {
  const visible = (ownerId: string) => !allowed || ownerId === UNASSIGNED || allowed.has(ownerId);
  const out: WallJob[] = [];
  const byTodo = new Map<string, WallJob>();
  for (const job of jobs) {
    if (!visible(job.ownerId)) continue;
    if (job.source !== 'todo' || !job.todoId) {
      out.push(job);
      continue;
    }
    const seen = byTodo.get(job.todoId);
    if (seen) {
      if (!seen.ownerIds?.includes(job.ownerId)) {
        seen.ownerIds = [...(seen.ownerIds ?? []), job.ownerId];
      }
      continue;
    }
    const first: WallJob = { ...job, ownerIds: [job.ownerId] };
    byTodo.set(job.todoId, first);
    out.push(first);
  }
  return out;
}

/**
 * Open to-dos that are not due yet (coming up, or with no date), one row per to-do.
 *
 * The wall's to-do card counts what is due NOW, but it is also the only way into the
 * to-do drawer, which lists everything. Gating the card on due-now work alone meant a
 * family whose to-dos were all undated or due later saw no card and could not reach
 * them from the wall at all. This is the rest of the open work, so the card can show
 * whenever anything is open. `allowed` is the wall's person filter, as in
 * `uniqueTodoJobs`.
 */
export function openLaterTodoJobs(
  jobs: readonly WallJob[],
  allowed: ReadonlySet<string> | null = null
): WallJob[] {
  return uniqueTodoJobs(
    jobs.filter(
      (j) => j.source === 'todo' && !j.done && (j.bucket === 'upcoming' || j.bucket === 'undated')
    ),
    allowed
  );
}

export function jobsProgress(jobs: readonly WallJob[]): { done: number; total: number } {
  return { done: jobs.filter((j) => j.done).length, total: jobs.length };
}

/**
 * What an undo needs to put ONE removed list item back where it was.
 *
 * Deliberately the item and its index, NOT a snapshot of the whole `items`
 * array. A whole-array restore looks simpler and is a data-loss bug: the wall
 * shows the undo for six seconds with an add row sitting directly under the
 * same list, so a family can add a row, tap Undo, and watch the new row vanish
 * because the array written back predates it. Restoring one item lets
 * `listStore.restoreItem` read the CURRENT array and splice into it.
 *
 * The list's FILED state does not need capturing either: `restoreItem` re-runs
 * completion derivation, which un-files a one-off list that had been filed for
 * losing its last open item. That mattered because the wall hides filed lists,
 * so getting it wrong would make an undo delete the whole list from the screen
 * rather than putting one row back.
 *
 * Pure on purpose: the highest-consequence rule in the wall's write path, and
 * here it is testable with no Pinia and no mocks.
 */
export function captureListRemoval(
  list: FamilyList,
  itemId: string
): { item: FamilyListItem; index: number } | null {
  const index = list.items.findIndex((i) => i.id === itemId);
  if (index === -1) return null;
  return { item: list.items[index], index };
}
