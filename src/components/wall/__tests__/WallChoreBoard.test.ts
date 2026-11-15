/**
 * The Lists board: one card per list, after one card for the family's due to-dos.
 *
 * The distinction these tests exist to protect is idle vs FINISHED: a list with nothing on it
 * today gets no card, but a list whose every item is done keeps its card and the green ring.
 * Dropping the second would punish the only bean who finished. The other thing they pin is
 * that a second list is a second card, never a block under the first, which is the bug the
 * per-bean columns had.
 */
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import WallChoreBoard from '../WallChoreBoard.vue';
import WallAddRow from '../WallAddRow.vue';
import WallBoardCard from '../WallBoardCard.vue';
import ActivityOwnerStack from '@/components/ui/ActivityOwnerStack.vue';
import { WALL_LOCK } from '../wallLockKey';
import { WALL_EDIT, type WallEditContext } from '../wallEditKey';
import { UNASSIGNED } from '@/utils/wallJobs';
import type { FamilyList, FamilyMember } from '@/types/models';
import type { WallJob, WallListGroup } from '@/types/wall';

const STRINGS: Record<string, string> = {
  'wall.list.progress': '{done} of {total} done',
  'wall.jobsBoard.progress': '{done} of {total} done today',
};
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => STRINGS[key] ?? key }),
}));

vi.mock('@/composables/useMemberAvatar', () => ({
  useMemberAvatarBindings: () => ({ memberAvatarBindings: () => ({}) }),
}));

const members: FamilyMember[] = [
  { id: 'm1', name: 'Leo', color: '#F15D22' } as FamilyMember,
  { id: 'm2', name: 'Milo', color: '#AED6F1' } as FamilyMember,
  { id: 'm3', name: 'Ana', color: '#E67E22' } as FamilyMember,
];

vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    get sortedHumans() {
      return members;
    },
    get members() {
      return members;
    },
  }),
}));

vi.mock('@/utils/listLifecycle', () => ({ isRecurring: () => false }));

/** A list item in `ownerId`'s lane (the lane owner is part of the render key). */
function job(id: string, done: boolean, listId = 'l1', ownerId = 'm1'): WallJob {
  return {
    key: `list:${listId}:${id}:${ownerId}`,
    title: `job ${id}`,
    done,
    ownerId,
    source: 'list',
    listId,
    itemId: id,
  };
}

function group(listId: string, jobs: WallJob[], over: Partial<FamilyList> = {}): WallListGroup {
  return {
    list: {
      id: listId,
      title: `List ${listId}`,
      emoji: '🧹',
      ownerId: 'm1',
      ...over,
    } as FamilyList,
    jobs,
  };
}

/** A to-do row as `todosFor` / `unassignedTodos` hand it over: one row per owner. */
function todo(id: string, ownerId: string, over: Partial<WallJob> = {}): WallJob {
  return {
    key: `todo:${id}:${ownerId}`,
    title: `todo ${id}`,
    done: false,
    ownerId,
    source: 'todo',
    todoId: id,
    bucket: 'today',
    ...over,
  };
}

interface MountOptions {
  /** `listsFor`, by member: decides which lists get a card. */
  lists?: Record<string, WallListGroup[]>;
  orphans?: WallListGroup[];
  /** `todosFor`, by member: the due to-dos. */
  todos?: Record<string, WallJob[]>;
  unassigned?: WallJob[];
  visible?: string[] | null;
  /** Provide the lock + write channel to render the board UNLOCKED. */
  edit?: Partial<WallEditContext>;
  /** Render the real job rows, for what a row shows (faces). Stubbed otherwise. */
  realRows?: boolean;
}

function mountBoard(opts: MountOptions = {}) {
  const { lists = {}, todos = {}, edit } = opts;
  return mount(WallChoreBoard, {
    props: {
      peripherals: {
        listsFor: (id: string) => lists[id] ?? [],
        orphanLists: opts.orphans ?? [],
        visibleMemberIds: opts.visible ?? null,
        todosFor: (id: string) => todos[id] ?? [],
        unassignedTodos: opts.unassigned ?? [],
        allTodos: [],
      },
      isPending: () => false,
      backLabel: 'week',
    },
    global: {
      stubs: { BeanieAvatar: true, ...(opts.realRows ? {} : { WallJobList: true }) },
      provide: edit
        ? {
            [WALL_LOCK as symbol]: { isLocked: ref(false), noteActivity: () => {} },
            [WALL_EDIT as symbol]: {
              addListItem: async () => true,
              addTodo: async () => true,
              renameJob: async () => true,
              removeJob: async () => true,
              ...edit,
            },
          }
        : {},
    },
  });
}

type Board = ReturnType<typeof mountBoard>;
const cards = (w: Board) => w.findAll('[data-test="board-card"]');
const todosCard = (w: Board) => w.find('[data-test="todos-card"]');
/** The cards in grid order, by kind. */
const gridKinds = (w: Board) =>
  Array.from(w.find('.wall-chore-grid').element.children).map((el) => el.getAttribute('data-test'));
const heading = (w: Board) => w.find('.wall-board-sum');

describe('WallChoreBoard', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('a card per list', () => {
    it('draws one card per list, and spends none on a bean with nothing on', () => {
      const w = mountBoard({ lists: { m1: [group('l1', [job('j1', false)])] } });

      // One card for Leo's list. Milo and Ana have nothing today and are not named on the
      // board (the wall's footer chips name every bean).
      expect(cards(w)).toHaveLength(1);
      expect(cards(w)[0]!.text()).toContain('List l1');
      expect(cards(w)[0]!.text()).toContain('Leo');
      expect(w.text()).not.toContain('Milo');
      expect(w.text()).not.toContain('Ana');
      expect(w.find('[data-test="board-empty"]').exists()).toBe(false);
    });

    it('gives a bean’s two lists two cards, side by side, in the family’s order', () => {
      // The bug this layout fixes: a second list stacked under the first in one column.
      const w = mountBoard({
        lists: {
          m2: [group('l3', [job('j3', false, 'l3', 'm2')], { ownerId: 'm2' })],
          m1: [group('l1', [job('j1', false)]), group('l2', [job('j2', false, 'l2')])],
        },
      });

      expect(cards(w).map((c) => c.find('.wall-bean-name.truncate').text())).toEqual([
        'List l1',
        'List l2',
        'List l3',
      ]);
    });

    it('draws a shared list once, with both faces and names, in the first bean’s colour', () => {
      const shared = { ownerId: 'm1', assigneeIds: ['m1', 'm2'] };
      const w = mountBoard({
        lists: {
          m1: [group('l1', [job('j1', false)], shared)],
          m2: [group('l1', [job('j1', false, 'l1', 'm2')], shared)],
        },
      });

      expect(cards(w)).toHaveLength(1);
      const faces = cards(w)[0]!.findComponent(ActivityOwnerStack);
      expect((faces.props('members') as FamilyMember[]).map((m) => m.name)).toEqual([
        'Leo',
        'Milo',
      ]);
      // The stack names them for a screen reader, and so does the text after it: hidden once.
      expect(faces.element.parentElement?.getAttribute('aria-hidden')).toBe('true');
      expect(cards(w)[0]!.text()).toContain('Leo & Milo');
      expect(w.findComponent(WallBoardCard).props('color')).toBe('#F15D22');
    });

    it('keeps a FINISHED list’s card, with the green ring and its tally', () => {
      // done === total, total > 0. This is the reward mechanic: it must not be mistaken for
      // "nothing on" and dropped.
      const w = mountBoard({ lists: { m1: [group('l1', [job('j1', true), job('j2', true)])] } });

      expect(cards(w)).toHaveLength(1);
      expect(cards(w)[0]!.classes().join(' ')).toContain('ring-[#27AE60]');
      expect(cards(w)[0]!.find('[data-test="card-tally"]').text()).toBe('2 of 2 done');
    });

    it('honours the wall’s person filter: a hidden bean’s cards are absent', () => {
      const w = mountBoard({
        lists: {
          m1: [group('l1', [job('j1', false)])],
          m2: [group('l2', [job('j2', false, 'l2', 'm2')], { ownerId: 'm2' })],
        },
        visible: ['m1'],
      });

      expect(cards(w)).toHaveLength(1);
      expect(w.text()).toContain('List l1');
      expect(w.text()).not.toContain('List l2');
      expect(w.text()).not.toContain('Milo');
    });

    it('gives a list whose items were all deduped away no card', () => {
      // The items are all to-dos due today, shown on the to-dos card instead.
      const w = mountBoard({ lists: { m1: [group('l1', [])] } });

      expect(cards(w)).toHaveLength(0);
      expect(w.find('[data-test="board-empty"]').exists()).toBe(true);
    });

    it('keeps a shared list that is empty in one bean’s lane but not in the other’s', () => {
      const shared = { ownerId: 'm1', assigneeIds: ['m1', 'm2'] };
      const w = mountBoard({
        lists: {
          m1: [group('l1', [], shared)],
          m2: [group('l1', [job('j1', false, 'l1', 'm2')], shared)],
        },
      });

      expect(cards(w)).toHaveLength(1);
      expect(w.findComponent(WallBoardCard).props('color')).toBe('#AED6F1');
    });

    it('opens the list’s own sheet from its head', async () => {
      const w = mountBoard({
        lists: { m1: [group('l1', [job('j1', false)]), group('l2', [job('j2', false, 'l2')])] },
      });

      await cards(w)[1]!.find('[data-test="board-card-head"]').trigger('click');
      expect(w.emitted('open')).toEqual([[{ kind: 'list', listId: 'l2' }]]);
    });

    it('counts a shared list once in the heading', () => {
      const shared = { ownerId: 'm1', assigneeIds: ['m1', 'm2'] };
      const w = mountBoard({
        lists: {
          m1: [group('l1', [job('a', true), job('b', false), job('c', false)], shared)],
          m2: [
            group(
              'l1',
              [
                job('a', true, 'l1', 'm2'),
                job('b', false, 'l1', 'm2'),
                job('c', false, 'l1', 'm2'),
              ],
              shared
            ),
          ],
        },
      });

      expect(heading(w).text()).toBe('1 of 3 done today');
    });
  });

  describe('the empty board', () => {
    it('says so in one line when nobody has anything on', () => {
      const w = mountBoard();

      expect(cards(w)).toHaveLength(0);
      expect(w.find('[data-test="board-empty"]').exists()).toBe(true);
    });

    it('never renders a board with nothing on it at all', () => {
      // The blank-board regression, stated directly: whatever the inputs, the screen shows a
      // card or the one-line empty state.
      for (const w of [
        mountBoard(),
        mountBoard({ todos: { m1: [todo('t1', 'm1')] } }),
        mountBoard({ lists: { m1: [group('l1', [])] }, todos: { m1: [todo('t1', 'm1')] } }),
        mountBoard({ orphans: [group('lx', [job('jx', false, 'lx')])] }),
      ]) {
        const hasSomething =
          w.find('[data-test$="-card"]').exists() || w.find('[data-test="board-empty"]').exists();
        expect(hasSomething).toBe(true);
      }
    });

    it('names what is empty: chores on the chore board, lists on the Lists board', async () => {
      // The empty line must not say "chores" once the page has made this the Lists board (#146).
      const chores = mountBoard();
      expect(chores.find('[data-test="board-empty"]').text()).toBe('wall.jobs.allClear');

      const lists = mountBoard();
      await lists.setProps({ boardTitle: 'Lists' });
      expect(lists.find('[data-test="board-empty"]').text()).toBe('wall.lists.allClear');
    });
  });

  describe('orphan lists', () => {
    it('⚠️ still renders an orphan list when every bean is clear', () => {
      // Orphan lists live in the grid but are not a member. Hiding the grid when no bean has
      // a card would make an unowned list vanish, the exact failure the orphan card prevents.
      const w = mountBoard({ orphans: [group('lx', [job('jx', false, 'lx')])] });

      expect(w.find('[data-test="orphan-card"]').exists()).toBe(true);
      expect(w.find('[data-test="board-empty"]').exists()).toBe(false);
    });

    it('names each orphan card with its own list, and offers no head to open', () => {
      const w = mountBoard({
        orphans: [
          group('lx', [job('jx', false, 'lx')], { title: 'Camping' }),
          group('ly', [job('jy', true, 'ly')], { title: 'Library' }),
        ],
      });

      const orphans = w.findAll('[data-test="orphan-card"]');
      expect(orphans.map((c) => c.find('.wall-bean-name.truncate').text())).toEqual([
        'Camping',
        'Library',
      ]);
      expect(orphans[1]!.text()).toContain('wall.orphanLists');
      expect(orphans[1]!.find('[data-test="card-tally"]').text()).toBe('1 of 1 done');
      expect(orphans[0]!.find('button').exists()).toBe(false);
    });
  });

  /**
   * The column used to stop at seven rows and offer "+N more" into the ALL-lists
   * drawer, while the column body already scrolled. Nothing asserted the cap, so
   * the suite would have stayed green straight through a regression either way.
   */
  describe('nothing is hidden', () => {
    function manyJobs(n: number, listId = 'l1'): WallJob[] {
      return Array.from({ length: n }, (_, i) => job(`j${i}`, false, listId));
    }

    it('renders every item a list has, far past the old seven-row budget', () => {
      const w = mountBoard({ lists: { m1: [group('l1', manyJobs(12))] } });
      const passed = w.findComponent({ name: 'WallJobList' }).props('jobs') as WallJob[];
      expect(passed).toHaveLength(12);
    });

    it('renders every LIST as a card, so a fourth list is not dropped for being "full"', () => {
      const w = mountBoard({
        lists: {
          m1: ['l1', 'l2', 'l3', 'l4'].map((id) => group(id, manyJobs(6, id))),
        },
      });
      expect(cards(w)).toHaveLength(4);
      const lists = w.findAllComponents({ name: 'WallJobList' });
      expect(lists.flatMap((l) => l.props('jobs') as WallJob[])).toHaveLength(24);
    });

    it('offers no overflow button at any length', () => {
      const w = mountBoard({ lists: { m1: [group('l1', manyJobs(30))] } });
      expect(w.text()).not.toContain('wall.card.more');
      expect(cards(w)[0]!.text()).not.toContain('more');
    });

    it('counts the whole list in its card’s tally', () => {
      const w = mountBoard({
        lists: { m1: [group('l1', [...manyJobs(9), job('done1', true), job('done2', true)])] },
      });
      expect(cards(w)[0]!.find('[data-test="card-tally"]').text()).toBe('2 of 11 done');
    });
  });

  describe('the add row', () => {
    it('is absent while the wall is locked', () => {
      const w = mountBoard({ lists: { m1: [group('l1', [job('j1', false)])] } });
      expect(w.findComponent(WallAddRow).exists()).toBe(false);
    });

    it('sits on every card once unlocked', () => {
      const w = mountBoard({
        lists: { m1: [group('l1', [job('j1', false)]), group('l2', [job('j2', false, 'l2')])] },
        edit: {},
      });
      expect(cards(w).map((c) => c.findComponent(WallAddRow).exists())).toEqual([true, true]);
    });

    it('adds to its own card’s list, not to whichever list was tapped last', async () => {
      const addListItem = vi.fn().mockResolvedValue(true);
      const w = mountBoard({
        lists: { m1: [group('l1', [job('j1', false)]), group('l2', [job('j2', false, 'l2')])] },
        edit: { addListItem },
      });
      await cards(w)[1]!.findComponent(WallAddRow).props('submit')('bread');
      expect(addListItem).toHaveBeenCalledWith('l2', 'bread');
    });

    it('gives an orphan card no add row: nobody owns it, so "who is this for" has no answer', () => {
      const w = mountBoard({ orphans: [group('lo', [job('jo', false, 'lo')])], edit: {} });
      expect(w.find('[data-test="orphan-card"]').findComponent(WallAddRow).exists()).toBe(false);
    });

    it('gives the to-dos card no add row (the to-do sheet has one)', () => {
      const w = mountBoard({ todos: { m1: [todo('t1', 'm1')] }, edit: {} });
      expect(todosCard(w).findComponent(WallAddRow).exists()).toBe(false);
    });
  });

  describe('the family to-dos card', () => {
    it('comes first while something is due, and is absent when nothing is', () => {
      const lists = { m1: [group('l1', [job('j1', false)])] };
      const due = mountBoard({ lists, todos: { m1: [todo('t1', 'm1')] } });
      expect(gridKinds(due)).toEqual(['todos-card', 'board-card']);

      const none = mountBoard({ lists });
      expect(todosCard(none).exists()).toBe(false);
      expect(gridKinds(none)).toEqual(['board-card']);
    });

    it('shows a to-do shared by two beans as one row with both faces', () => {
      const w = mountBoard({
        todos: { m1: [todo('t1', 'm1')], m2: [todo('t1', 'm2')] },
        realRows: true,
      });

      const rows = todosCard(w).findAllComponents({ name: 'WallJobRow' });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.find('[role="img"]').attributes('aria-label')).toBe('Leo, Milo');
    });

    it('shows an unclaimed to-do with the "?" face', () => {
      const w = mountBoard({ unassigned: [todo('t9', UNASSIGNED)], realRows: true });

      const face = todosCard(w).find('[role="img"]');
      expect(face.text()).toBe('?');
      expect(face.attributes('aria-label')).toBe('wall.todo.anyone');
    });

    it('passes a tick straight up', () => {
      const t1 = todo('t1', 'm1');
      const w = mountBoard({ todos: { m1: [t1] } });

      todosCard(w).findComponent({ name: 'WallJobList' }).vm.$emit('toggle', t1);
      expect(w.emitted('toggle')).toEqual([[t1]]);
    });

    it('opens the to-do sheet from its head', async () => {
      const w = mountBoard({ todos: { m1: [todo('t1', 'm1')] } });

      await todosCard(w).find('[data-test="board-card-head"]').trigger('click');
      expect(w.emitted('open')).toEqual([[{ kind: 'todos' }]]);
    });

    it('is not counted in the heading, which counts lists only', () => {
      const w = mountBoard({
        lists: { m1: [group('l1', [job('j1', true), job('j2', false)])] },
        todos: { m1: [todo('t1', 'm1'), todo('t2', 'm1', { done: true })] },
      });

      expect(heading(w).text()).toBe('1 of 2 done today');
    });

    it('is a board on its own: only to-dos due is not the empty line', () => {
      const w = mountBoard({ todos: { m1: [todo('t1', 'm1')] } });

      expect(todosCard(w).exists()).toBe(true);
      expect(w.find('[data-test="board-empty"]').exists()).toBe(false);
      expect(heading(w).exists()).toBe(false);
    });

    it('keeps a done to-do, last, and rings the card when every one is done', () => {
      const done = todo('t1', 'm1', { done: true });
      const open = todo('t2', 'm1');
      const some = mountBoard({ todos: { m1: [done, open] } });
      const jobs = todosCard(some)
        .findComponent({ name: 'WallJobList' })
        .props('jobs') as WallJob[];
      expect(jobs.map((j) => j.todoId)).toEqual(['t2', 't1']);
      expect(todosCard(some).classes().join(' ')).not.toContain('ring-[#27AE60]');
      expect(todosCard(some).find('[data-test="card-tally"]').text()).toBe('1 of 2 done');

      const all = mountBoard({ todos: { m1: [done] } });
      expect(todosCard(all).classes().join(' ')).toContain('ring-[#27AE60]');
    });

    it('follows the person filter: a hidden bean’s to-dos drop out, unclaimed ones stay', () => {
      const w = mountBoard({
        todos: { m1: [todo('t1', 'm1')], m2: [todo('t2', 'm2')] },
        unassigned: [todo('t9', UNASSIGNED)],
        visible: ['m1'],
      });

      const jobs = todosCard(w).findComponent({ name: 'WallJobList' }).props('jobs') as WallJob[];
      expect(jobs.map((j) => j.todoId)).toEqual(['t1', 't9']);
    });
  });
});
