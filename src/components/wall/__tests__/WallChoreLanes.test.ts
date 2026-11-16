/**
 * The wall's chore lanes (#146). What these pin: the block happening now is open (rows, ring,
 * "Now" tag), later blocks are quiet coloured counts, a finished block folds to the all-done
 * strip with its stars, there is no running star row, and the one edit (add a chore) appears
 * only while the wall is unlocked.
 */
import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import { describe, it, expect, vi } from 'vitest';
import WallChoreLanes from '../WallChoreLanes.vue';
import WallJobList from '../WallJobList.vue';
import WallAddRow from '../WallAddRow.vue';
import CelebrationBanner from '@/components/ui/CelebrationBanner.vue';
import { WALL_LOCK } from '../wallLockKey';
import { WALL_EDIT, type WallEditContext } from '../wallEditKey';
import { WALL_BURST } from '../wallBurstKey';
import type { ChoreBlock, FamilyMember } from '@/types/models';
import type { WallChoreBlock, WallChoreLane, WallJob, WallPeripheralData } from '@/types/wall';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/composables/useMemberAvatar', () => ({
  useMemberAvatarBindings: () => ({ memberAvatarBindings: () => ({}) }),
}));
vi.mock('@/stores/choreStore', () => ({
  useChoreStore: () => ({
    starts: { morning: '06:00', afternoon: '12:00', evening: '17:00' },
    tickWillCelebrate: (memberId: string, choreId: string) => willCelebrate(memberId, choreId),
  }),
}));
/** The store's finishing-tick decision, as the test sets it. */
const willCelebrate = vi.hoisted(() => vi.fn((_m: string, _c: string) => false));

const members: FamilyMember[] = [
  { id: 'pip', name: 'Pip', color: '#F15D22' } as FamilyMember,
  { id: 'juno', name: 'Juno', color: '#AED6F1' } as FamilyMember,
];
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    get sortedHumans() {
      return members;
    },
  }),
}));

function job(choreId: string, ownerId: string, done = false): WallJob {
  return {
    key: `chore:${choreId}:${ownerId}`,
    title: choreId,
    done,
    ownerId,
    source: 'chore',
    choreId,
    locked: true,
  };
}

function block(
  name: ChoreBlock,
  jobs: WallJob[],
  over: Partial<WallChoreBlock> = {}
): WallChoreBlock {
  const done = jobs.filter((j) => j.done).length;
  return {
    block: name,
    jobs,
    done,
    total: jobs.length,
    allDone: jobs.length > 0 && done === jobs.length,
    isNow: false,
    ended: false,
    ...over,
  };
}

function lane(memberId: string, blocks: WallChoreBlock[]): WallChoreLane {
  return {
    memberId,
    current: 'morning',
    blocks,
    done: blocks.reduce((n, b) => n + b.done, 0),
    total: blocks.reduce((n, b) => n + b.total, 0),
  };
}

function mountLanes(
  lanes: Record<string, WallChoreLane | null> | null,
  opts: { unlocked?: boolean; edit?: Partial<WallEditContext> } = {}
) {
  const peripherals: WallPeripheralData = {
    todosFor: () => [],
    unassignedTodos: [],
    allTodos: [],
    listsFor: () => [],
    orphanLists: [],
    visibleMemberIds: null,
    ...(lanes ? { choreLaneFor: (id: string) => lanes[id] ?? null } : {}),
  };
  return mount(WallChoreLanes, {
    props: { peripherals, isPending: () => false, backLabel: 'week' },
    global: {
      stubs: { BeanieAvatar: true, WallJobList: true },
      provide: opts.unlocked
        ? {
            [WALL_LOCK as symbol]: { isLocked: ref(false), noteActivity: () => {} },
            [WALL_EDIT as symbol]: {
              addListItem: async () => true,
              addTodo: async () => true,
              renameJob: async () => true,
              removeJob: async () => true,
              ...opts.edit,
            },
          }
        : {},
    },
  });
}

const pipMorning = () =>
  lane('pip', [
    block('morning', [job('bed', 'pip', true), job('teeth', 'pip')], { isNow: true }),
    block('afternoon', [job('toys', 'pip'), job('homework', 'pip')]),
    block('evening', [job('bath', 'pip')]),
  ]);

describe('WallChoreLanes', () => {
  it('opens the block happening now, with its rows, its ring and the Now tag', () => {
    const w = mountLanes({ pip: pipMorning() });
    const now = w.find('[data-testid="wall-chore-block"][data-block="morning"]');
    expect(now.attributes('data-state')).toBe('open');
    expect(now.attributes('data-now')).toBe('true');
    expect(now.find('[data-testid="wall-chore-now-tag"]').exists()).toBe(true);
    const rows = now.findComponent(WallJobList);
    expect(rows.exists()).toBe(true);
    expect((rows.props('jobs') as WallJob[]).map((j) => j.choreId)).toEqual(['bed', 'teeth']);
  });

  it('draws later blocks as quiet coloured counts with no rows, and opens one on tap', async () => {
    const w = mountLanes({ pip: pipMorning() });
    const later = w.find('[data-testid="wall-chore-block"][data-block="afternoon"]');
    expect(later.attributes('data-state')).toBe('quiet');
    const line = later.find('[data-testid="wall-chore-quiet"]');
    expect(line.classes()).toContain('chore-block-afternoon');
    expect(line.text()).toContain('choreboard.block.chores.other');
    expect(later.findComponent(WallJobList).exists()).toBe(false);
    await line.trigger('click');
    expect(line.attributes('aria-expanded')).toBe('true');
    expect(later.findComponent(WallJobList).exists()).toBe(true);
    // a one-chore block uses the singular
    const evening = w.find('[data-testid="wall-chore-block"][data-block="evening"]');
    expect(evening.text()).toContain('choreboard.block.chores.one');
  });

  it('says how the bean is doing in the block happening now', () => {
    const w = mountLanes({
      pip: pipMorning(),
      juno: lane('juno', [block('evening', [job('bath', 'juno')])]),
    });
    const [pip, juno] = w.findAll('[data-testid="wall-chore-lane-count"]');
    expect(pip!.text()).toBe('wall.chores.lane.progress.morning');
    expect(juno!.text()).toBe('wall.chores.lane.nothing.morning');
    expect(w.find('[data-member="juno"] [data-testid="wall-chore-lane-clear"]').exists()).toBe(
      true
    );
  });

  it('folds a finished block to one slim line in its own colour, with its star count', async () => {
    const w = mountLanes({
      pip: lane('pip', [
        block('morning', [job('bed', 'pip', true), job('teeth', 'pip', true)], { isNow: true }),
      ]),
    });
    const strip = w.find('[data-testid="wall-chore-done-strip"]');
    expect(strip.exists()).toBe(true);
    // A line, not the orange banner: the banner is the celebration only.
    expect(w.findComponent(CelebrationBanner).exists()).toBe(false);
    // Told apart by the block's own colour, and it says which block and that it is done.
    expect(strip.classes()).toContain('chore-block-morning');
    expect(strip.text()).toContain('wall.chores.lane.allDone');
    expect(strip.text()).toContain('⭐ 2');
    expect(strip.attributes('aria-expanded')).toBe('false');
    expect(w.find('[data-testid="wall-chore-lane-count"]').text()).toBe('wall.chores.lane.allDone');
    // The rows fold away, and a tap on the line reopens them to undo a mis-tick.
    expect(w.findComponent(WallJobList).exists()).toBe(false);
    await strip.trigger('click');
    expect(strip.attributes('aria-expanded')).toBe('true');
    expect(w.findComponent(WallJobList).exists()).toBe(true);
  });

  it('sinks finished blocks to the bottom of the lane, what is left to do first', () => {
    // Anytime is done and sits second in the lane's own order (now, Anytime, later): drawn
    // there it was an orange slab in the middle of the list.
    const w = mountLanes({
      pip: lane('pip', [
        block('morning', [job('bed', 'pip')], { isNow: true }),
        block('anytime', [job('plants', 'pip', true)]),
        block('evening', [job('bath', 'pip')]),
      ]),
    });
    const order = w
      .findAll('[data-testid="wall-chore-block"]')
      .map((b) => [b.attributes('data-block'), b.attributes('data-state')]);
    expect(order).toEqual([
      ['morning', 'open'],
      ['evening', 'quiet'],
      ['anytime', 'done'],
    ]);
  });

  it('draws several finished blocks in the order of the day, each in its own colour', () => {
    const w = mountLanes({
      pip: lane('pip', [
        block('evening', [job('bath', 'pip')], { isNow: true }),
        block('anytime', [job('plants', 'pip', true)]),
        block('morning', [job('bed', 'pip', true)]),
        block('afternoon', [job('toys', 'pip', true)]),
      ]),
    });
    const blocks = w.findAll('[data-testid="wall-chore-block"]');
    expect(blocks.map((b) => b.attributes('data-block'))).toEqual([
      'evening',
      'morning',
      'afternoon',
      'anytime',
    ]);
    const strips = w.findAll('[data-testid="wall-chore-done-strip"]');
    expect(strips.map((x) => x.classes().find((c) => c.startsWith('chore-block-')))).toEqual([
      'chore-block-morning',
      'chore-block-afternoon',
      'chore-block-anytime',
    ]);
  });

  it('pins the finished group to the lane’s foot under one rule, while something is left', () => {
    const w = mountLanes({
      pip: lane('pip', [
        block('evening', [job('bath', 'pip')], { isNow: true }),
        block('anytime', [job('plants', 'pip', true)]),
        block('morning', [job('bed', 'pip', true)]),
      ]),
    });
    const blocks = w.findAll('[data-testid="wall-chore-block"]');
    expect(w.findAll('[data-testid="wall-chore-done-rule"]')).toHaveLength(1);
    // The rule and the auto margin sit on the first finished line (morning, in day order).
    expect(
      blocks.map((b) => [b.attributes('data-block'), b.classes().includes('mt-auto')])
    ).toEqual([
      ['evening', false],
      ['morning', true],
      ['anytime', false],
    ]);
    expect(blocks[1]!.find('[data-testid="wall-chore-done-rule"]').exists()).toBe(true);
  });

  it('draws no rule when the whole lane is finished: there is one group, not two', () => {
    const w = mountLanes({
      pip: lane('pip', [
        block('morning', [job('bed', 'pip', true)]),
        block('anytime', [job('plants', 'pip', true)]),
      ]),
    });
    expect(w.find('[data-testid="wall-chore-done-rule"]').exists()).toBe(false);
    expect(
      w.findAll('[data-testid="wall-chore-block"]').some((b) => b.classes().includes('mt-auto'))
    ).toBe(false);
  });

  it('a tick carries its lane’s block as the celebration anchor, clipped to the lane', () => {
    const w = mountLanes({ pip: pipMorning() });
    const lane = w.get('[data-testid="wall-chore-lane"][data-member="pip"]');
    expect(lane.attributes('data-celebration-clip')).toBeDefined();
    const morning = pipMorning().blocks[0]!;
    // The rows are WallJobList's (stubbed here): its toggle is what the lane hears.
    w.findComponent(WallJobList).vm.$emit('toggle', morning.jobs[1]);
    const [job, anchor] = w.emitted('toggle')![0]! as [
      { ownerId: string },
      Record<string, unknown>,
    ];
    expect(job.ownerId).toBe('pip');
    expect(anchor).toMatchObject({
      block: lane.get('[data-testid="wall-chore-block"][data-block="morning"]').element,
      clip: lane.element,
      compact: true,
    });
  });

  it('the wall’s tick burst skips exactly the tick the store says will celebrate', async () => {
    const burst = vi.fn();
    const w = mount(WallChoreLanes, {
      props: {
        peripherals: {
          todosFor: () => [],
          unassignedTodos: [],
          allTodos: [],
          listsFor: () => [],
          orphanLists: [],
          visibleMemberIds: null,
          choreLaneFor: (id: string) =>
            id === 'pip'
              ? lane('pip', [
                  block('morning', [job('bed', 'pip'), job('teeth', 'pip')], { isNow: true }),
                ])
              : null,
        },
        isPending: () => false,
        backLabel: 'week',
      },
      global: { stubs: { BeanieAvatar: true }, provide: { [WALL_BURST as symbol]: burst } },
    });
    const tick = (choreId: string) =>
      w.get(`[data-job-key="chore:${choreId}:pip"] .wall-tick-hit`).trigger('click');

    // An ordinary tick: the burst plays, and the store was asked about THIS bean and chore.
    willCelebrate.mockReturnValue(false);
    await tick('bed');
    expect(burst).toHaveBeenCalledTimes(1);
    expect(willCelebrate).toHaveBeenCalledWith('pip', 'bed');
    // The finishing tick (the store counts a quick earlier tick still in flight): no burst.
    willCelebrate.mockReturnValue(true);
    await tick('teeth');
    expect(burst).toHaveBeenCalledTimes(1);
    expect(willCelebrate).toHaveBeenLastCalledWith('pip', 'teeth');
  });

  it('draws no star row: stars appear only on a finished block', () => {
    const w = mountLanes({ pip: pipMorning() });
    expect(w.text()).not.toContain('⭐');
    expect(w.find('.wall-stars').exists()).toBe(false);
  });

  it('offers the add row only while unlocked, and adds for that bean', async () => {
    expect(mountLanes({ pip: pipMorning() }).find('[data-testid="wall-chore-add"]').exists()).toBe(
      false
    );
    const addChore = vi.fn(async () => true);
    const w = mountLanes({ pip: pipMorning() }, { unlocked: true, edit: { addChore } });
    const add = w.find('[data-testid="wall-chore-add"]');
    expect(add.exists()).toBe(true);
    const row = add.findComponent(WallAddRow);
    expect(row.props('placeholder')).toBe('wall.chores.add.morning');
    await (row.props('submit') as (t: string) => Promise<boolean>)('feed the fish');
    expect(addChore).toHaveBeenCalledWith('pip', 'feed the fish');
  });

  it('offers no add row unlocked when the page provides no chore add', () => {
    const w = mountLanes({ pip: pipMorning() }, { unlocked: true });
    expect(w.find('[data-testid="wall-chore-add"]').exists()).toBe(false);
  });

  it('gives a bean with no chores today no lane, and one once unlocked', () => {
    const lanes = { pip: pipMorning(), juno: lane('juno', []) };
    const locked = mountLanes(lanes);
    expect(locked.findAll('[data-testid="wall-chore-lane"]')).toHaveLength(1);
    // No row is spent on who has nothing: the footer's chips name every bean.
    expect(locked.text()).not.toContain('Juno');
    expect(locked.find('[data-testid="wall-chores-empty"]').exists()).toBe(false);
    const unlocked = mountLanes(lanes, {
      unlocked: true,
      edit: { addChore: async () => true },
    });
    expect(unlocked.findAll('[data-testid="wall-chore-lane"]')).toHaveLength(2);
  });

  it('shows the morning count in the header, and one line when nobody has a chore', () => {
    const w = mountLanes({ pip: pipMorning() });
    expect(w.find('[data-testid="wall-chores-progress"]').text()).toBe(
      'wall.chores.progress.morning.other'
    );
    const none = mountLanes(null);
    expect(none.find('[data-testid="wall-chore-lanes"]').exists()).toBe(false);
    expect(none.find('[data-testid="wall-chores-empty"]').text()).toBe('wall.jobs.allClear');
  });

  it('brings a block opened at the bottom of a lane into view', async () => {
    // jsdom has no layout, so the boxes are stated: the Evening block ends 120px below the
    // lane body's bottom edge, with 300px of room above its own header.
    const w = mountLanes({ pip: pipMorning() });
    const later = w.find('[data-testid="wall-chore-block"][data-block="evening"]');
    const body = later.element.parentElement!;
    const box = (top: number, bottom: number) => ({ top, bottom }) as DOMRect;
    body.getBoundingClientRect = () => box(100, 500);
    later.element.getBoundingClientRect = () => box(400, 620);
    const scrollBy = vi.fn();
    body.scrollBy = scrollBy as unknown as typeof body.scrollBy;

    await later.find('[data-testid="wall-chore-quiet"]').trigger('click');
    await nextTick();
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy.mock.calls[0]![0]).toMatchObject({ top: 128 });

    // Closing it again scrolls nothing.
    await later.find('[data-testid="wall-chore-quiet"]').trigger('click');
    await nextTick();
    expect(scrollBy).toHaveBeenCalledTimes(1);
  });
});
