/**
 * Beanie wall — the stable contracts components type against.
 *
 * Declared here rather than inferred from a composable's return type so a view
 * can be built (and tested) without importing the composable that produces it.
 */
import type { ChoreBlock, FamilyList, TodoItem } from '@/types/models';
import type { BeanChoreDay } from '@/utils/chores';
import type { PlateClock, ShownPlate } from '@/utils/todoPlate';

/**
 * `chores` is the choreboard's lanes (#146), offered only while the `choreboard` gate is on
 * (`wallViewsFor`); `jobs` is the lists board, titled "Lists" while the gate is on.
 */
export type WallViewId = 'days' | 'lanes' | 'today' | 'jobs' | 'chores';

/**
 * Where a job came from. Drives the write path in `useWallJobs.toggle`. Every branch on it is
 * an exhaustive `switch`: a third source used to be silently treated as a list or a to-do.
 */
export type WallJobSource = 'todo' | 'list' | 'chore';

/**
 * One tickable thing belonging to one bean.
 *
 * A child never learns whether this arrived as a dated to-do or as an item on
 * their own repeating list — that distinction is plumbing, and flattening it
 * here is the whole point of the wall's "my jobs" idea.
 */
/**
 * Where a to-do sits on today's plate (`utils/todoPlate`, the rule every surface shares).
 * Drives both grouping and emphasis: the wall leads with what is due now and still shows
 * what is coming up, unless the to-do's "Show from" date is still ahead (a repeating chore
 * waits for its due date by default). Those wait on the To-Dos page, never here.
 */
export type WallTodoBucket = ShownPlate;

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
  /** Present when `source === 'chore'`. The row's bean is `ownerId` (a shared chore is ticked per bean). */
  choreId?: string;
  /** The owning list's emoji, or a chore's own picture, shown as a quiet tag after the title. */
  listEmoji?: string;
  /** When it was ticked — the wall shows it, because a wall has the room. */
  completedAt?: string;
  /** Set on to-dos only. */
  bucket?: WallTodoBucket;
  /** Whole days past the due date, on an overdue to-do only (1 = due yesterday). */
  daysLate?: number;
  /** The to-do's own due time ("17:00"), when it has one. */
  dueTime?: string;
  /**
   * The row cannot be renamed or removed here (a card-made to-do is the card's, #123). The tick
   * still works: ticking a repeating to-do rolls it to its next date.
   */
  locked?: boolean;
  /**
   * Every owner of a to-do row that stands for several assignees. Set only by
   * `uniqueTodoJobs`, for the combined views (the drawer and the summary card);
   * the per-person lanes keep one row per owner and never carry it.
   */
  ownerIds?: string[];
}

/** A short chip on a drawer row: how late it is, or the time it is due by. */
export interface WallJobNote {
  text: string;
  tone: 'late' | 'time';
}

/** One list and its items, ready to render as a titled block. */
export interface WallListGroup {
  list: FamilyList;
  jobs: WallJob[];
}

export interface WallJobsResult {
  /**
   * EVERY wall-safe list a bean is assigned to that is showing today (`wallShowsList`),
   * repeating or one-off, each with its items. A list for two beans is under both; a view
   * that walks every lane collapses it with `uniqueListGroups`.
   *
   * Lists are no longer split by lifecycle for display. A recurring "leo's jobs"
   * and a one-off "swim bag" are both Leo's list; parking one under his name and
   * the other in a strip along the bottom made half of them easy to miss and
   * implied a distinction the family does not think in.
   */
  listsByMember: Record<string, WallListGroup[]>;
  /**
   * Lists none of whose assignees is a member the wall knows about (deleted, or not yet
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
  /**
   * One chore lane per known (human) bean, keyed by member id: the choreboard's read model
   * (`beanChoreDay`) turned into wall jobs. Empty when the caller passes no chore days, which
   * is what it does while the `choreboard` gate is off.
   */
  choreLanesByMember: Record<string, WallChoreLane>;
}

/** One time-of-day block of a bean's chore lane, its chores as wall jobs. */
export interface WallChoreBlock {
  block: ChoreBlock;
  /** In chore order. A done chore stays where it is, so a child sees what they did. */
  jobs: WallJob[];
  done: number;
  total: number;
  /** Every chore done. False for a block with no chores. */
  allDone: boolean;
  /** The block's once-only celebration has played today (absent = not yet). */
  celebrated?: boolean;
  isNow: boolean;
  /** The block's window has passed. */
  ended: boolean;
}

/** A bean's chores today, as the wall's chore lanes draw them. */
export interface WallChoreLane {
  memberId: string;
  /** The timed block happening now (never `anytime`), whether or not this bean has chores in it. */
  current: ChoreBlock;
  /**
   * Blocks with at least one chore today: the block happening now first, then Anytime, then
   * the blocks still to come, then the ones whose window has passed.
   */
  blocks: WallChoreBlock[];
  done: number;
  total: number;
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
  /**
   * Every to-do on the wall, in every bucket. The to-do card counts due-now work, but it
   * is also the drawer's only door, so it shows whenever anything here is still open.
   */
  allTodos: WallJob[];
  listsFor: (memberId: string) => WallListGroup[];
  orphanLists: WallListGroup[];
  /**
   * A bean's chore lane (#146). ABSENT while the `choreboard` gate is off: the page reads the
   * flag once and leaves this out, so every card and view below keeps today's behaviour.
   */
  choreLaneFor?: (memberId: string) => WallChoreLane | null;
  /** The wall's person filter, so a card agrees with the view above it. */
  /**
   * Who the wall is showing; `null` is "everyone", kept distinct from an empty list so a view
   * can tell it apart from "a filter that matches nobody".
   *
   * ⚠️ `readonly`. Every view is handed the SAME array — `useWallMemberFocus` returns a cached
   * computed — so one view sorting or pushing to its own prop would poison the filter for all
   * of them. The type is the guard; nothing copies per consumer.
   */
  visibleMemberIds: readonly string[] | null;
}

export interface WallJobsInput {
  todos: TodoItem[];
  lists: FamilyList[];
  memberIds: string[];
  /** Now, device-local (`plateClock`): the day, and the minute a timed to-do turns overdue. */
  clock: PlateClock;
  /**
   * Each bean's chore day (`choreStore.choreDayFor`), keyed by member id. Omitted or empty
   * while the `choreboard` gate is off: the rule itself never reads the flag.
   */
  choreDays?: Readonly<Record<string, BeanChoreDay>>;
}

/**
 * What a detail sheet is showing. `kind` selects the renderer.
 *
 * Every tap target on the wall resolves to one of these, so "what happens when
 * you touch this" is answered in one type rather than per component. A day, an
 * activity and a card all open the SAME sheet with different content.
 */
export type WallSheetTarget =
  | { kind: 'activity'; activityId: string; ymd: string }
  | { kind: 'todos' }
  | { kind: 'list'; listId: string }
  | { kind: 'trip' }
  | { kind: 'meals'; ymd: string };

export type WallNightBehaviour = 'clock' | 'stay-on';
