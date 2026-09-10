/**
 * The board's job is to give its width to the beans who actually have jobs.
 *
 * The distinction these tests exist to protect is idle vs FINISHED: a bean with
 * nothing assigned is minimised to a chip, but a bean who has done everything
 * asked keeps a full column, a green ring and a row of stars. Collapsing the
 * second would punish the only bean who finished.
 */
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import WallChoreBoard from '../WallChoreBoard.vue';
import WallAddRow from '../WallAddRow.vue';
import { WALL_LOCK } from '../wallLockKey';
import { WALL_EDIT, type WallEditContext } from '../wallEditKey';
import type { FamilyList, FamilyMember } from '@/types/models';
import type { WallJob, WallListGroup } from '@/types/wall';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
  }),
}));

vi.mock('@/utils/listLifecycle', () => ({ isRecurring: () => false }));

function job(id: string, done: boolean): WallJob {
  return {
    key: `list:${id}`,
    title: `job ${id}`,
    done,
    ownerId: 'm1',
    source: 'list',
    listId: 'l1',
    itemId: id,
  };
}

function group(listId: string, jobs: WallJob[]): WallListGroup {
  return { list: { id: listId, title: 'Jobs', emoji: '🧹' } as FamilyList, jobs };
}

/**
 * `listsFor` decides who gets a COLUMN; `todosFor` decides who may be called
 * clear. They are not the same question — see the "All clear" test below.
 */
function mountBoard(
  byMember: Record<string, WallListGroup[]>,
  orphanLists: WallListGroup[] = [],
  todosByMember: Record<string, WallJob[]> = {},
  /** Provide the lock + write channel to render the board UNLOCKED. */
  edit?: Partial<WallEditContext> | null
) {
  return mount(WallChoreBoard, {
    props: {
      peripherals: {
        listsFor: (id: string) => byMember[id] ?? [],
        orphanLists,
        visibleMemberIds: null,
        todosFor: (id: string) => todosByMember[id] ?? [],
        unassignedTodos: [],
      },
      isPending: () => false,
      backLabel: 'week',
    },
    global: {
      stubs: { BeanieAvatar: true, WallJobList: true },
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

describe('WallChoreBoard', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('gives columns only to beans with jobs, and chips to the rest', () => {
    const w = mountBoard({ m1: [group('l1', [job('j1', false)])] });

    // One column for Leo; Milo and Ana are named in the strip, not given tracks.
    expect(w.findAll('[data-test="board-column"]')).toHaveLength(1);
    expect(w.find('[data-test="idle-strip"]').exists()).toBe(true);
    expect(w.find('[data-test="idle-strip"]').text()).toContain('Milo');
    expect(w.find('[data-test="idle-strip"]').text()).toContain('Ana');
    expect(w.find('[data-test="idle-strip"]').text()).not.toContain('Leo');
  });

  it('⭐ keeps a FINISHED bean’s full column, ring and stars', () => {
    // done === total, total > 0. This is the reward mechanic — it must not be
    // mistaken for "nothing on" and collapsed into a chip.
    const w = mountBoard({ m1: [group('l1', [job('j1', true), job('j2', true)])] });

    const columns = w.findAll('[data-test="board-column"]');
    expect(columns).toHaveLength(1);
    expect(columns[0]!.classes().join(' ')).toContain('ring-[#27AE60]');
    expect(columns[0]!.text()).toContain('⭐');
    expect(w.find('[data-test="idle-strip"]').text()).not.toContain('Leo');
  });

  it('gives every bean a column when they all have jobs, and shows no strip', () => {
    const w = mountBoard({
      m1: [group('l1', [job('j1', false)])],
      m2: [group('l2', [job('j2', false)])],
      m3: [group('l3', [job('j3', false)])],
    });

    expect(w.findAll('[data-test="board-column"]')).toHaveLength(3);
    expect(w.find('[data-test="idle-strip"]').exists()).toBe(false);
  });

  it('turns the strip into the board when nobody has anything on', () => {
    const w = mountBoard({});

    expect(w.findAll('[data-test="board-column"]')).toHaveLength(0);
    const strip = w.find('[data-test="idle-strip"]');
    expect(strip.exists()).toBe(true);
    // It fills the space rather than sitting as a thin bar under an empty grid.
    expect(strip.classes()).toContain('flex-1');
    for (const m of members) expect(strip.text()).toContain(m.name);
  });

  it('⚠️ still renders an orphan list when every bean is clear', () => {
    // Orphan lists live in the grid but are not a member. Hiding the grid on an
    // all-idle board would make an unowned list vanish — the exact failure the
    // orphan column exists to prevent.
    const w = mountBoard({}, [group('lx', [job('jx', false)])]);

    expect(w.find('[data-test="orphan-column"]').exists()).toBe(true);
    const strip = w.find('[data-test="idle-strip"]');
    expect(strip.exists()).toBe(true);
    // A grid is present, so the strip is a footer again, not the board.
    expect(strip.classes()).toContain('shrink-0');
  });

  it('treats a list whose items are all deduped away as no chore column', () => {
    // buildColumn skips empty groups, so there is nothing to put in a column.
    const w = mountBoard({ m1: [group('l1', [])] });

    expect(w.findAll('[data-test="board-column"]')).toHaveLength(0);
    expect(w.find('[data-test="idle-strip"]').text()).toContain('Leo');
  });

  it('⚠️ every bean lands in exactly one group — never in neither', () => {
    // An earlier fix excluded beans with outstanding to-dos from BOTH the
    // columns and the strip, to avoid calling them clear. That made them vanish
    // from the wall entirely, indistinguishable from having left the family —
    // and a family who keeps to-dos but no lists got a blank board.
    const w = mountBoard({ m1: [group('l1', [])] }, [], { m1: [job('t1', false)] });

    const named = w.find('[data-test="idle-strip"]').text();
    for (const m of members) expect(named).toContain(m.name);
    expect(w.findAll('[data-test="board-column"]')).toHaveLength(0);
  });

  it('never renders a board with nothing on it at all', () => {
    // The blank-board regression, stated directly: whatever the inputs, the
    // screen shows either columns or the strip.
    for (const w of [
      mountBoard({}),
      mountBoard({}, [], { m1: [job('t1', false)] }),
      mountBoard({ m1: [group('l1', [])] }, [], { m1: [job('t1', false)] }),
    ]) {
      const hasSomething =
        w.findAll('[data-test="board-column"]').length > 0 ||
        w.find('[data-test="idle-strip"]').exists() ||
        w.find('[data-test="orphan-column"]').exists();
      expect(hasSomething).toBe(true);
    }
  });

  it('scopes its claim to chores, since chores are all it knows about', () => {
    // The strip must not make a whole-person claim: this board never sees
    // to-dos, so "no chores today" is the most it can honestly say.
    const w = mountBoard({});
    expect(w.find('[data-test="idle-strip"]').text()).toContain('wall.jobs.allClear');
  });

  it('honours the wall’s person filter — a hidden bean is absent, not idle', () => {
    const w = mount(WallChoreBoard, {
      props: {
        peripherals: {
          listsFor: (id: string) => (id === 'm1' ? [group('l1', [job('j1', false)])] : []),
          orphanLists: [],
          visibleMemberIds: ['m1'],
          todosFor: () => [],
          unassignedTodos: [],
        },
        isPending: () => false,
        backLabel: 'week',
      },
      global: { stubs: { BeanieAvatar: true, WallJobList: true } },
    });

    expect(w.findAll('[data-test="board-column"]')).toHaveLength(1);
    // Milo and Ana are filtered out entirely; they must not reappear as chips.
    expect(w.find('[data-test="idle-strip"]').exists()).toBe(false);
  });

  /**
   * The column used to stop at seven rows and offer "+N more" into the ALL-lists
   * drawer, while the column body already scrolled. Nothing asserted the cap, so
   * the suite would have stayed green straight through a regression either way.
   */
  describe('nothing is hidden', () => {
    function manyJobs(n: number): WallJob[] {
      return Array.from({ length: n }, (_, i) => job(`j${i}`, false));
    }

    it('renders every item a bean has, far past the old seven-row budget', () => {
      const w = mountBoard({ m1: [group('l1', manyJobs(12))] });
      const passed = w.findComponent({ name: 'WallJobList' }).props('jobs') as WallJob[];
      expect(passed).toHaveLength(12);
    });

    it('renders every LIST, so a fourth list is not dropped for being "full"', () => {
      const w = mountBoard({
        m1: [
          group('l1', manyJobs(6)),
          group('l2', manyJobs(6)),
          group('l3', manyJobs(6)),
          group('l4', manyJobs(6)),
        ],
      });
      const lists = w.findAllComponents({ name: 'WallJobList' });
      expect(lists).toHaveLength(4);
      expect(lists.flatMap((l) => l.props('jobs') as WallJob[])).toHaveLength(24);
    });

    it('offers no overflow button at any length', () => {
      const w = mountBoard({ m1: [group('l1', manyJobs(30))] });
      expect(w.text()).not.toContain('wall.card.more');
      expect(w.find('[data-test="board-column"]').text()).not.toContain('more');
    });

    it('still counts the whole column in the tally', () => {
      const w = mountBoard({
        m1: [group('l1', [...manyJobs(9), job('done1', true), job('done2', true)])],
      });
      expect(w.find('[data-test="board-column"]').text()).toContain('2 / 11');
    });

    it('drops a list whose jobs were all deduped away, rather than showing an empty heading', () => {
      const w = mountBoard({ m1: [group('l1', manyJobs(2)), group('l2', [])] });
      expect(w.findAllComponents({ name: 'WallJobList' })).toHaveLength(1);
    });
  });

  describe('the add row', () => {
    it('is absent while the wall is locked', () => {
      const w = mountBoard({ m1: [group('l1', [job('j1', false)])] });
      expect(w.findComponent(WallAddRow).exists()).toBe(false);
    });

    it('appears under every list once unlocked', () => {
      const w = mountBoard(
        { m1: [group('l1', [job('j1', false)]), group('l2', [job('j2', false)])] },
        [],
        {},
        {}
      );
      expect(w.findAllComponents(WallAddRow)).toHaveLength(2);
    });

    it('adds to the list it sits under, not to whichever list was tapped last', async () => {
      const addListItem = vi.fn().mockResolvedValue(true);
      const w = mountBoard(
        { m1: [group('l1', [job('j1', false)]), group('l2', [job('j2', false)])] },
        [],
        {},
        { addListItem }
      );
      const second = w.findAllComponents(WallAddRow)[1];
      await second.props('submit')('bread');
      expect(addListItem).toHaveBeenCalledWith('l2', 'bread');
    });

    it('gives the orphan column no add row: nobody owns it, so "who is this for" has no answer', () => {
      const w = mountBoard({}, [group('lo', [job('jo', false)])], {}, {});
      expect(w.find('[data-test="orphan-column"]').findComponent(WallAddRow).exists()).toBe(false);
    });
  });
});
