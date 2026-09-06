/**
 * The board's job is to give its width to the beans who actually have jobs.
 *
 * The distinction these tests exist to protect is idle vs FINISHED: a bean with
 * nothing assigned is minimised to a chip, but a bean who has done everything
 * asked keeps a full column, a green ring and a row of stars. Collapsing the
 * second would punish the only bean who finished.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import WallChoreBoard from '../WallChoreBoard.vue';
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
  todosByMember: Record<string, WallJob[]> = {}
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

  it('⚠️ never calls a bean clear who still has to-dos outstanding', () => {
    // `wallJobs` suppresses a list item when a to-do of the same owner and title
    // is due today, so a bean's whole list can dedupe away to `total === 0` while
    // the to-dos card beside them shows the work. "All clear" is a claim about a
    // PERSON, by name, on a kitchen wall — it has to be true of everything they
    // owe, not just of the chore column.
    const w = mountBoard({ m1: [group('l1', [])] }, [], { m1: [job('t1', false)] });

    expect(w.find('[data-test="idle-strip"]').text()).not.toContain('Leo');
    // Milo and Ana genuinely have nothing, so they are still named.
    expect(w.find('[data-test="idle-strip"]').text()).toContain('Milo');
  });

  it('does call a bean clear once their to-dos are done', () => {
    const w = mountBoard({}, [], { m1: [job('t1', true)] });
    expect(w.find('[data-test="idle-strip"]').text()).toContain('Leo');
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
});
