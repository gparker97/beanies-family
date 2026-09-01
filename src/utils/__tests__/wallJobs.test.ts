import { describe, expect, it } from 'vitest';
import { UNASSIGNED, buildWallJobs, jobsProgress, sortJobs } from '@/utils/wallJobs';
import type { FamilyList, TodoItem } from '@/types/models';

const TODAY = '2026-08-31';

function todo(over: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 't1',
    title: 'bins out',
    assigneeIds: ['leo'],
    dueDate: `${TODAY}T00:00:00.000Z`,
    completed: false,
    createdBy: 'greg',
    createdAt: '',
    updatedAt: '',
    ...over,
  } as TodoItem;
}

function list(over: Partial<FamilyList> = {}): FamilyList {
  return {
    id: 'l1',
    title: "leo's jobs",
    emoji: '🧹',
    category: 'kids',
    ownerId: 'leo',
    lifecycle: 'recurring',
    items: [{ id: 'i1', title: 'hoover the stairs', completed: false }],
    completed: false,
    createdAt: '',
    updatedAt: '',
    ...over,
  } as FamilyList;
}

const members = ['greg', 'leo', 'milo'];
const build = (todos: TodoItem[], lists: FamilyList[]) =>
  buildWallJobs({ todos, lists, memberIds: members, todayYmd: TODAY });

/** Every job on a bean's lists, flattened. */
const choresOf = (r: ReturnType<typeof build>, id: string) =>
  (r.listsByMember[id] ?? []).flatMap((g) => g.jobs);
/** This bean's to-dos, whatever bucket they fall in. */
const todosOf = (r: ReturnType<typeof build>, id: string) =>
  r.todos.filter((j) => j.ownerId === id);

describe('buildWallJobs', () => {
  it("puts a today to-do in its assignee's column", () => {
    const result = build([todo()], []);
    expect(todosOf(result, 'leo').map((j) => j.title)).toEqual(['bins out']);
    expect(choresOf(result, 'leo')).toEqual([]);
  });

  it('folds a list into its OWNER, since items have no assignee', () => {
    const result = build([], [list()]);
    expect(choresOf(result, 'leo')[0]).toMatchObject({
      title: 'hoover the stairs',
      source: 'list',
      listId: 'l1',
      itemId: 'i1',
      listEmoji: '🧹',
    });
  });

  /**
   * One-off and repeating lists are no longer split. Parking one under a name
   * and the other in a strip made half the family's lists easy to miss.
   */
  it('gives a one-off list the same home as a repeating one', () => {
    const grocery = list({ id: 'l2', title: 'grocery run', lifecycle: 'oneoff', ownerId: 'greg' });
    const result = build([], [grocery]);
    expect(result.listsByMember.greg.map((g) => g.list.id)).toEqual(['l2']);
    expect(result.orphanLists).toEqual([]);
  });

  it('drops a FILED one-off list — a finished shopping trip is done with', () => {
    const done = list({ id: 'l2', lifecycle: 'oneoff', ownerId: 'greg', completed: true } as never);
    expect(build([], [done]).listsByMember.greg).toEqual([]);
  });

  it('keeps a list whose owner is unknown, rather than dropping it', () => {
    const orphan = list({ id: 'l9', title: 'garage', ownerId: 'ghost' });
    const result = build([], [orphan]);
    expect(result.orphanLists.map((g) => g.list.id)).toEqual(['l9']);
  });

  /**
   * Lists and to-dos are separate sets, but they still dedupe ACROSS each
   * other — the same task written in both places is one job, and the dated,
   * explicitly assigned to-do is the one that survives.
   */
  it('shows a task once when it is BOTH a to-do and a list item, to-do winning', () => {
    const dupe = list({ items: [{ id: 'i9', title: '  Bins   Out ', completed: true }] });
    const result = build([todo()], [dupe]);
    expect(todosOf(result, 'leo')).toHaveLength(1);
    expect(todosOf(result, 'leo')[0].source).toBe('todo');
    expect(choresOf(result, 'leo')).toEqual([]);
  });

  /**
   * Dedupe exists to stop ONE task showing twice as both a to-do and a list
   * item. It must not reach further than that — these two cases are what it
   * started catching by accident once to-dos stopped being filtered to today.
   */
  it('does NOT let a future to-do suppress a chore that is due today', () => {
    const soon = todo({
      id: 't9',
      title: 'hoover the stairs',
      dueDate: '2026-09-20T00:00:00.000Z',
    });
    const result = build([soon], [list()]);
    expect(choresOf(result, 'leo').map((j) => j.title)).toEqual(['hoover the stairs']);
  });

  it('keeps two to-dos that happen to share a title on different days', () => {
    const a = todo({ id: 'ta', title: 'call the plumber' });
    const b = todo({ id: 'tb', title: 'call the plumber', dueDate: '2026-09-20T00:00:00.000Z' });
    expect(build([a, b], []).todos).toHaveLength(2);
  });

  it('keeps the same item on two different lists — it really is on both', () => {
    const shop = list({
      id: 'la',
      title: 'corner shop',
      items: [{ id: 'x', title: 'milk', completed: false }],
    });
    const big = list({
      id: 'lb',
      title: 'big shop',
      items: [{ id: 'y', title: 'milk', completed: false }],
    });
    expect(choresOf(build([], [shop, big]), 'leo')).toHaveLength(2);
  });

  it('excludes someday to-dos — they are deliberately not today', () => {
    expect(build([todo({ someday: true, dueDate: undefined })], []).todos).toEqual([]);
  });

  /**
   * The fixture above cannot fail on its own: with no `dueDate` the bucket rule
   * would have called it `undated`. A "someday · maybe" item CAN carry a due
   * date, and every one of them would have flooded the children's columns.
   */
  it('excludes a someday to-do even when it is dated today', () => {
    expect(build([todo({ someday: true })], []).todos).toEqual([]);
  });

  it('reads the deprecated singular assigneeId via normalizeAssignees', () => {
    const legacy = todo({ assigneeIds: undefined, assigneeId: 'milo' });
    expect(todosOf(build([legacy], []), 'milo')).toHaveLength(1);
  });

  it('gives each assignee of a shared to-do its own key, so ticking one does not lock the others', () => {
    const result = build([todo({ assigneeIds: ['leo', 'milo'] })], []);
    expect(todosOf(result, 'leo')[0].key).not.toBe(todosOf(result, 'milo')[0].key);
  });

  it('fans a multi-assignee to-do out to every member', () => {
    const result = build([todo({ assigneeIds: ['leo', 'milo'] })], []);
    expect(todosOf(result, 'leo')).toHaveLength(1);
    expect(todosOf(result, 'milo')).toHaveLength(1);
  });

  it('gives every known member a column even when they have nothing', () => {
    expect(Object.keys(build([], []).listsByMember).sort()).toEqual(['greg', 'leo', 'milo']);
  });

  it('carries the completion timestamp through, so the wall can show when', () => {
    const done = list({
      items: [
        { id: 'i1', title: 'bins out', completed: true, completedAt: '2026-09-01T07:30:00.000Z' },
      ],
    });
    expect(choresOf(build([], [done]), 'leo')[0].completedAt).toBe('2026-09-01T07:30:00.000Z');
  });
});

/**
 * The wall used to show ONLY to-dos due today, so a family with eight of them
 * saw one and reasonably concluded it was broken.
 */
describe('to-do buckets', () => {
  const bucketOf = (t: Partial<TodoItem>) => build([todo(t)], []).todos[0]?.bucket;

  it('tags today, late, upcoming and undated', () => {
    expect(bucketOf({})).toBe('today');
    expect(bucketOf({ dueDate: '2026-08-24T00:00:00.000Z' })).toBe('overdue');
    expect(bucketOf({ dueDate: '2026-09-08T00:00:00.000Z' })).toBe('upcoming');
    expect(bucketOf({ dueDate: undefined })).toBe('undated');
  });

  it('shows a future-dated to-do at all — the bug that hid eight of nine', () => {
    const result = build([todo({ id: 't2', dueDate: '2026-09-20T00:00:00.000Z' })], []);
    expect(result.todos).toHaveLength(1);
  });

  it('keeps unassigned work, under a sentinel owner rather than dropped', () => {
    const result = build([todo({ assigneeIds: [] })], []);
    expect(result.todos).toHaveLength(1);
    expect(result.todos[0].ownerId).toBe(UNASSIGNED);
  });

  it("keeps today's completions visible, so a tick does not vanish", () => {
    expect(bucketOf({ completed: true, completedAt: `${TODAY}T09:00:00.000Z` })).toBe('today');
  });

  it('keeps an OVERDUE completion visible too — the same gesture, the same outcome', () => {
    // This is the inconsistency users hit: ticking an overdue job made the row vanish
    // under the finger, while ticking today's or an undated one crossed it out.
    expect(
      bucketOf({
        completed: true,
        completedAt: `${TODAY}T09:00:00.000Z`,
        dueDate: '2026-08-20T00:00:00.000Z',
      })
    ).toBe('overdue');
  });

  it('drops a completion made on an EARLIER day, in every bucket', () => {
    // Built from a LOCAL time, not a hand-written `Z` literal. `completedAt` is a UTC
    // timestamp compared against the local day, so a fixture written as `…T18:00:00.000Z`
    // is yesterday only for a machine at or near UTC — under CI it passed while the
    // shipped code was dropping today's completions for most of the world.
    const yesterday = new Date('2026-08-30T18:00:00').toISOString();
    // `bucketOf` optional-chains, so a dropped to-do reads as undefined.
    expect(bucketOf({ completed: true, completedAt: yesterday })).toBeUndefined();
    expect(
      bucketOf({ completed: true, completedAt: yesterday, dueDate: undefined })
    ).toBeUndefined();
    expect(
      bucketOf({ completed: true, completedAt: yesterday, dueDate: '2026-08-20T00:00:00.000Z' })
    ).toBeUndefined();
  });

  /**
   * Every bucket keeps its completions for the rest of the day, so a tick behaves the same
   * wherever it happens and a mis-tick can be undone.
   */
  it('keeps an undated to-do visible after it is ticked', () => {
    expect(
      bucketOf({ completed: true, completedAt: `${TODAY}T09:00:00.000Z`, dueDate: undefined })
    ).toBe('undated');
  });

  it('ignores work assigned to somebody who is not a family member', () => {
    // It becomes unassigned rather than vanishing: the task is still real.
    const result = build([todo({ assigneeIds: ['ghost'] })], []);
    expect(result.todos[0].ownerId).toBe(UNASSIGNED);
  });
});

describe('sortJobs / jobsProgress', () => {
  /** Both helpers are generic over any job array — a lane mixes the two sets. */
  function leosWork() {
    const built = build(
      [todo({ completed: true, completedAt: `${TODAY}T09:00:00.000Z` })],
      [list()]
    );
    return [...todosOf(built, 'leo'), ...choresOf(built, 'leo')];
  }

  it('puts outstanding work first', () => {
    expect(sortJobs(leosWork()).map((j) => j.done)).toEqual([false, true]);
  });

  it('counts done against total', () => {
    expect(jobsProgress(leosWork())).toEqual({ done: 1, total: 2 });
  });
});

describe('what a shared screen must never show', () => {
  it('hides auto-generated hint to-dos, including surprise-sensitive ones', () => {
    const hint = todo({ title: 'Plan a birthday present for Leo', hintType: 'birthday' } as never);
    expect(build([hint], []).todos).toEqual([]);
  });

  it('keeps a health list off the wall entirely', () => {
    const meds = list({
      id: 'lh',
      category: 'health',
      items: [{ id: 'm1', title: 'sertraline 50mg', completed: false }],
    });
    const result = build([], [meds]);
    expect(choresOf(result, 'leo')).toEqual([]);
    expect(result.orphanLists).toEqual([]);
  });

  it('keeps a personal "me" list off the wall', () => {
    const mine = list({ id: 'lm', category: 'me', ownerId: 'greg' });
    expect(build([], [mine]).listsByMember.greg).toEqual([]);
  });
});
