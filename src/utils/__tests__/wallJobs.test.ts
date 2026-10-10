import { describe, expect, it } from 'vitest';
import {
  UNASSIGNED,
  buildWallJobs,
  captureListRemoval,
  jobOwnerIds,
  jobsProgress,
  openLaterTodoJobs,
  sortJobs,
  uniqueTodoJobs,
} from '@/utils/wallJobs';
import type { FamilyList, TodoItem, TodoRepeat } from '@/types/models';

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
  // greg, 2026-10-10: helpful hints reach the wall, except the surprise ones.
  it('shows helpful hint to-dos like any other to-do', () => {
    const hint = todo({ title: 'Pack for the trip', hintType: 'trip-packing' });
    expect(build([hint], []).todos.map((j) => j.todoId)).toEqual(['t1']);
  });

  it('keeps surprise hints off the wall: birthday presents and anniversary plans', () => {
    const present = todo({
      title: 'Plan a birthday present for Leo',
      hintType: 'birthday-present',
    });
    const anniversary = todo({
      id: 't2',
      title: 'Plan the anniversary',
      hintType: 'anniversary-plan',
    });
    const partyGift = todo({
      id: 't3',
      title: "Gift for Sam's party",
      hintType: 'birthday-party-gift',
    });
    expect(build([present, anniversary, partyGift], []).todos.map((j) => j.todoId)).toEqual(['t3']);
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

  it('keeps a "people we love" list off the wall', () => {
    const people = list({ id: 'lp', category: 'people', ownerId: 'greg' });
    expect(build([], [people]).listsByMember.greg).toEqual([]);
  });

  it('fails closed on a category this build does not know (a newer client)', () => {
    const future = list({ id: 'lf', category: 'pets' as never, ownerId: 'greg' });
    const result = build([], [future]);
    expect(result.listsByMember.greg).toEqual([]);
    expect(result.orphanLists).toEqual([]);
  });
});

/**
 * What an undo needs. This is the highest-consequence, lowest-visibility rule in
 * the wall's write path, and it has now been wrong twice in two different ways:
 * first by restoring only `items` (which left a one-off list FILED, so the undo
 * deleted the whole list from the wall instead of putting one row back), and
 * then by restoring the whole array (which destroyed anything added during the
 * six seconds the undo is on screen, with an add row sitting under that very
 * list). Capturing one item and its index is what makes both impossible.
 */
describe('to-do timing on wall rows', () => {
  it('says how many days late an overdue to-do is, and carries a due time', () => {
    const r = build(
      [
        todo({ id: 'late3', dueDate: '2026-08-28T00:00:00.000Z' }),
        todo({ id: 'late1', dueDate: '2026-08-30T00:00:00.000Z' }),
        todo({ id: 'now', dueTime: '17:00' }),
      ],
      []
    );
    const byId = Object.fromEntries(r.todos.map((j) => [j.todoId, j]));
    expect(byId.late3?.daysLate).toBe(3);
    expect(byId.late1?.daysLate).toBe(1);
    expect(byId.now?.daysLate).toBeUndefined();
    expect(byId.now?.dueTime).toBe('17:00');
  });
});

describe('jobOwnerIds', () => {
  it('names every owner of a combined row, its own owner otherwise, and nobody for unclaimed', () => {
    const r = build(
      [todo({ assigneeIds: ['greg', 'leo'] }), todo({ id: 't2', assigneeIds: [] })],
      []
    );
    const combined = uniqueTodoJobs(r.todos);
    expect(combined.map(jobOwnerIds)).toEqual([['greg', 'leo'], []]);
    expect(jobOwnerIds(r.todos[0])).toEqual(['greg']);
  });
});

describe('uniqueTodoJobs (combined views)', () => {
  it('lists a to-do shared by two people once, with both owners', () => {
    const r = build([todo({ assigneeIds: ['greg', 'leo'] })], []);
    // The lanes keep one row per person, by design.
    expect(r.todos).toHaveLength(2);
    const combined = uniqueTodoJobs(r.todos);
    expect(combined).toHaveLength(1);
    expect(combined[0].ownerIds).toEqual(['greg', 'leo']);
    expect(jobsProgress(combined).total).toBe(1);
  });

  it('keeps separate to-dos separate and leaves single-owner rows alone', () => {
    const r = build([todo(), todo({ id: 't2', title: 'feed the cat', assigneeIds: ['milo'] })], []);
    const combined = uniqueTodoJobs(r.todos);
    expect(combined.map((j) => j.todoId)).toEqual(['t1', 't2']);
    expect(combined.map((j) => j.ownerIds)).toEqual([['leo'], ['milo']]);
  });

  it('drops owners outside the person filter and hides a to-do with none visible', () => {
    const r = build(
      [todo({ assigneeIds: ['greg', 'leo'] }), todo({ id: 't2', assigneeIds: ['milo'] })],
      []
    );
    const combined = uniqueTodoJobs(r.todos, new Set(['leo']));
    expect(combined).toHaveLength(1);
    expect(combined[0].ownerIds).toEqual(['leo']);
  });

  it('always shows unassigned work, even under a person filter', () => {
    const r = build([todo({ assigneeIds: [] })], []);
    const combined = uniqueTodoJobs(r.todos, new Set(['leo']));
    expect(combined).toHaveLength(1);
    expect(combined[0].ownerId).toBe(UNASSIGNED);
  });

  it('does not mutate the per-person rows it was given', () => {
    const r = build([todo({ assigneeIds: ['greg', 'leo'] })], []);
    uniqueTodoJobs(r.todos);
    expect(r.todos.every((j) => j.ownerIds === undefined)).toBe(true);
  });
});

describe('captureListRemoval', () => {
  const threeItems = [
    { id: 'i1', title: 'goggles', completed: false },
    { id: 'i2', title: 'towel', completed: true, completedBy: 'leo' },
    { id: 'i3', title: 'cap', completed: false },
  ];

  it('captures the item and where it sat, so undo can put it back in place', () => {
    const l = list({ id: 'l1', items: threeItems } as never);

    expect(captureListRemoval(l, 'i2')).toEqual({ item: threeItems[1], index: 1 });
  });

  it('hands back the SAME item reference, so its completion state survives verbatim', () => {
    const l = list({ id: 'l1', items: threeItems } as never);

    expect(captureListRemoval(l, 'i2')?.item).toBe(threeItems[1]);
  });

  it('captures the first and last positions correctly', () => {
    const l = list({ id: 'l1', items: threeItems } as never);

    expect(captureListRemoval(l, 'i1')?.index).toBe(0);
    expect(captureListRemoval(l, 'i3')?.index).toBe(2);
  });

  it('returns null when the item is already gone, so no undo is offered for nothing', () => {
    const l = list({ id: 'l1', items: threeItems } as never);

    expect(captureListRemoval(l, 'nope')).toBeNull();
  });

  it('does NOT capture the items array, which is what made undo destructive', () => {
    const l = list({ id: 'l1', items: threeItems } as never);

    expect(captureListRemoval(l, 'i2')).not.toHaveProperty('items');
  });
});

describe('buildWallJobs: repeating and card-made to-dos (#123)', () => {
  // 2026-08-31 is a Monday.
  const repeat: TodoRepeat = {
    rule: { unit: 'week', interval: 1, weekdays: [1], end: { kind: 'never' } },
    anchor: TODAY,
  };

  it('locks a card-made to-do (no rename or remove on the wall)', () => {
    const result = build([todo({ repeat, cardId: 'trash', cardPartKey: 'main' })], []);
    expect(todosOf(result, 'leo')[0]).toMatchObject({ todoId: 't1', locked: true });
  });

  it('leaves a plain repeating to-do and a one-off to-do editable', () => {
    const result = build([todo({ repeat }), todo({ id: 't2', title: 'sign the slip' })], []);
    expect(todosOf(result, 'leo').every((j) => !j.locked)).toBe(true);
  });
});

describe('openLaterTodoJobs (keeps the to-do card reachable)', () => {
  it('counts open to-dos coming up or undated, never due-now, finished or someday ones', () => {
    const r = build(
      [
        todo({ id: 'today' }),
        todo({ id: 'late', dueDate: '2026-08-30T00:00:00.000Z' }),
        todo({ id: 'later', dueDate: '2026-09-05T00:00:00.000Z' }),
        todo({ id: 'undated', dueDate: undefined }),
        todo({
          id: 'later-done',
          dueDate: '2026-09-05T00:00:00.000Z',
          completed: true,
          completedAt: `${TODAY}T09:00:00.000Z`,
        }),
        todo({ id: 'someday', dueDate: undefined, someday: true }),
      ],
      []
    );
    expect(openLaterTodoJobs(r.todos).map((j) => j.todoId)).toEqual(['later', 'undated']);
  });

  it('counts a shared to-do once and respects the person filter, keeping unassigned work', () => {
    const r = build(
      [
        todo({ id: 'shared', assigneeIds: ['greg', 'leo'], dueDate: undefined }),
        todo({ id: 'milo', assigneeIds: ['milo'], dueDate: undefined }),
        todo({ id: 'nobody', assigneeIds: [], dueDate: undefined }),
      ],
      []
    );
    expect(openLaterTodoJobs(r.todos)).toHaveLength(3);
    expect(openLaterTodoJobs(r.todos, new Set(['leo'])).map((j) => j.todoId)).toEqual([
      'shared',
      'nobody',
    ]);
  });
});
