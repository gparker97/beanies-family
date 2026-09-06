/**
 * Beanie wall — the stable contracts components type against.
 *
 * Declared here rather than inferred from a composable's return type so a view
 * can be built (and tested) without importing the composable that produces it.
 */
import type { FamilyList, TodoItem } from '@/types/models';

export type WallViewId = 'days' | 'lanes' | 'today' | 'jobs';

/** Where a job came from. Drives the write path in `useWallJobs.toggle`. */
export type WallJobSource = 'todo' | 'list';

/**
 * One tickable thing belonging to one bean.
 *
 * A child never learns whether this arrived as a dated to-do or as an item on
 * their own repeating list — that distinction is plumbing, and flattening it
 * here is the whole point of the wall's "my jobs" idea.
 */
/**
 * When a to-do is due, relative to today. Drives both grouping and emphasis:
 * the wall leads with what is due now and still SHOWS what is coming, rather
 * than hiding it — a to-do list that only ever shows today looks broken to
 * anyone who knows they have eight of them.
 */
export type WallTodoBucket = 'overdue' | 'today' | 'upcoming' | 'undated';

export interface WallJob {
  /** Stable within a render; `${source}:${id}` (list items add the list id). */
  key: string;
  title: string;
  done: boolean;
  ownerId: string;
  source: WallJobSource;
  /** Present when `source === 'todo'`. */
  todoId?: string;
  /** Both present when `source === 'list'`. */
  listId?: string;
  itemId?: string;
  /** The owning list's emoji, shown as a quiet provenance tag. */
  listEmoji?: string;
  /** When it was ticked — the wall shows it, because a wall has the room. */
  completedAt?: string;
  /** Set on to-dos only. */
  bucket?: WallTodoBucket;
}

/** One list and its items, ready to render as a titled block. */
export interface WallListGroup {
  list: FamilyList;
  jobs: WallJob[];
}

export interface WallJobsResult {
  /**
   * EVERY wall-safe list a bean owns, repeating or one-off, each with its items.
   *
   * Lists are no longer split by lifecycle for display. A recurring "leo's jobs"
   * and a one-off "swim bag" are both Leo's list; parking one under his name and
   * the other in a strip along the bottom made half of them easy to miss and
   * implied a distinction the family does not think in.
   */
  listsByMember: Record<string, WallListGroup[]>;
  /**
   * Lists whose owner is not a member the wall knows about (deleted, or not yet
   * synced). They still have to be findable — silently dropping a list is worse
   * than showing it without a face.
   */
  orphanLists: WallListGroup[];
  /**
   * To-dos, ALL of them (bar `someday` and hints), each tagged with its bucket.
   * Kept separate from lists: merging them made the wall's main board a to-do
   * board with chores mixed in, when a chore board is the point.
   */
  todos: WallJob[];
}

/**
 * The job/list bundle every peripheral surface needs, and which always travels
 * together: all five come from one `useWallJobs()` and are never sourced apart.
 *
 * Grouped because spelling them out individually meant a TEN-prop
 * `WallPeripheralCards` invocation written out once per calendar view — the real
 * duplication behind those three views, and one that a shared shell alone would
 * have left standing.
 */
export interface WallPeripheralData {
  todosFor: (memberId: string) => WallJob[];
  /** Due-now work nobody has claimed — counted and shown like anyone else's. */
  unassignedTodos: WallJob[];
  listsFor: (memberId: string) => WallListGroup[];
  orphanLists: WallListGroup[];
  /** The wall's person filter, so a card agrees with the view above it. */
  visibleMemberIds: string[] | null;
}

export interface WallJobsInput {
  todos: TodoItem[];
  lists: FamilyList[];
  memberIds: string[];
  todayYmd: string;
}

/**
 * What a detail sheet is showing. `kind` selects the renderer.
 *
 * Every tap target on the wall resolves to one of these, so "what happens when
 * you touch this" is answered in one type rather than per component. A day, an
 * activity and a card all open the SAME sheet with different content.
 */
export type WallSheetTarget =
  | { kind: 'day'; ymd: string }
  | { kind: 'activity'; activityId: string; ymd: string }
  | { kind: 'lists' }
  | { kind: 'todos' }
  | { kind: 'list'; listId: string }
  | { kind: 'trip' }
  | { kind: 'meals'; ymd: string };

export type WallNightBehaviour = 'clock' | 'stay-on';
