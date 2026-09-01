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
 *   a bean's LISTS = every wall-safe list they own, repeating or one-off,
 *                    each rendered whole under their name
 *   orphan lists   = lists whose owner is not a member we know about
 *   to-dos         = every to-do bar `someday` and hints, tagged by when it is
 *                    due, assigned or not
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
import type { FamilyList, FamilyListItem, ListCategory, TodoItem } from '@/types/models';
import type {
  WallJob,
  WallJobsInput,
  WallJobsResult,
  WallListGroup,
  WallTodoBucket,
} from '@/types/wall';
import { normalizeAssignees } from '@/utils/assignees';
import { isFiled, isRecurring } from '@/utils/listLifecycle';
import { extractDatePart } from '@/utils/date';

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
const PRIVATE_LIST_CATEGORIES: readonly ListCategory[] = ['health', 'me'];

export function isWallSafeList(list: FamilyList): boolean {
  return !PRIVATE_LIST_CATEGORIES.includes(list.category);
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
 * at all.
 *
 * A completion stays until the end of the day it was made, in every bucket, so the row
 * never deletes itself out from under the finger and a mis-tick can be undone. Yesterday's
 * completions are history and drop off.
 */
function todoBucket(todo: TodoItem, todayYmd: string): WallTodoBucket | null {
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
  if (todo.completed && extractDatePart(todo.completedAt ?? '') !== todayYmd) return null;

  const due = todo.dueDate?.slice(0, 10);
  if (!due) return 'undated';
  if (due === todayYmd) return 'today';
  return due < todayYmd ? 'overdue' : 'upcoming';
}

function todoJob(todo: TodoItem, ownerId: string, bucket: WallTodoBucket): WallJob {
  return {
    bucket,
    // The owner is part of the key: a to-do assigned to three beans becomes
    // three rows, and a bare `todo:${id}` made them ONE key — so the `pending`
    // guard disabled all three when any one was tapped.
    key: `todo:${todo.id}:${ownerId}`,
    title: todo.title,
    done: todo.completed,
    ownerId,
    source: 'todo',
    todoId: todo.id,
    completedAt: todo.completedAt,
  };
}

function listJob(list: FamilyList, item: FamilyListItem): WallJob {
  return {
    key: `list:${list.id}:${item.id}`,
    title: item.title,
    done: item.completed,
    ownerId: list.ownerId,
    source: 'list',
    listId: list.id,
    itemId: item.id,
    listEmoji: list.emoji,
    completedAt: item.completedAt,
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
  const { todos, lists, memberIds, todayYmd } = input;

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
    if (todo.someday) continue;
    // Auto-generated hints are excluded at the manual/hint boundary everywhere
    // else in the app; some carry audience rules precisely so a surprise stays
    // hidden from the person it concerns. A shared wall must respect that.
    if (todo.hintType) continue;

    const bucket = todoBucket(todo, todayYmd);
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
      built.push(todoJob(todo, UNASSIGNED, bucket));
      continue;
    }
    for (const ownerId of assignees) {
      if (actionable) suppress.add(dedupeKey(ownerId, todo.title));
      built.push(todoJob(todo, ownerId, bucket));
    }
  }

  // 2. Lists, whole, under their owner.
  for (const list of lists) {
    if (!isWallSafeList(list)) continue;
    // A filed (completed) one-off list is done with; a recurring list resets
    // and is never filed, so this only ever removes finished shopping trips.
    if (!isRecurring(list) && isFiled(list)) continue;

    const jobs: WallJob[] = [];
    for (const item of list.items) {
      if (suppress.has(dedupeKey(list.ownerId, item.title))) continue;
      jobs.push(listJob(list, item));
    }
    const group: WallListGroup = { list, jobs };
    if (known.has(list.ownerId)) listsByMember[list.ownerId].push(group);
    else orphanLists.push(group);
  }

  return { listsByMember, orphanLists, todos: built };
}

/** Outstanding-first, so what still needs doing is what you read first. */
export function sortJobs(jobs: readonly WallJob[]): WallJob[] {
  return [...jobs].sort((a, b) => Number(a.done) - Number(b.done));
}

export function jobsProgress(jobs: readonly WallJob[]): { done: number; total: number } {
  return { done: jobs.filter((j) => j.done).length, total: jobs.length };
}
