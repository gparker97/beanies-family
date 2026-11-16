/**
 * Stars and rewards (#148): the Choreboard's "Stars and Rewards" view. What these pin:
 *  - off: the turn-on panel and nothing else;
 *  - on: each control is ONE intent to ONE store action, from the session grown-up: on/off, the
 *    weekly reward (on, with the default emoji when it has none), its name (on blur, only when it
 *    changed, never per keystroke), its emoji, the bar (after a pause), and a chore's value
 *    (`choreStore.updateChore` with `via: 'rewards'`); there is no take-back setting;
 *  - the bar shows each child's "N of M stars"; the chore values follow the picked child, with
 *    their full week and strip preview;
 *  - Add Special Reward asks for the page's ONE drawer empty (`open-award`); a special reward's
 *    row asks for it on that one; a special reward for chosen kids says who;
 *  - the weekly reward's emoji: a rename that changes the name's suggestion picks the new one
 *    (even over a hand pick), saved with the name; the same suggestion or none keeps it; opening
 *    never changes it;
 *  - nothing here toasts (every store action has already toasted its own `null`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { reactive } from 'vue';

vi.mock(
  '@/composables/useTranslation',
  async () => (await import('./choreTestKit')).translationModule
);
vi.mock('@/stores/familyStore', async () => (await import('./choreTestKit')).familyStoreModule);
vi.mock('@/stores/choreStore', async () => (await import('./choreTestKit')).choreStoreModule);
vi.mock('@/composables/useMemberAvatar', () => ({
  useMemberAvatarBindings: () => ({ memberAvatarBindings: () => ({}) }),
}));
const logEvent = vi.hoisted(() => vi.fn());
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/composables/useToast', () => ({
  useToast: () => ({ showToast: toast }),
  showToast: toast,
}));
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => ({ weekStartDay: 1 }) }));

/** The star store as the view reads it: getters from `rs`, actions as spies. */
const rs = vi.hoisted(() => ({
  state: null as null | {
    rewards: { on: boolean; weeklyOn: boolean; title?: string; emoji?: string; barPct: number };
    earners: string[];
    awards: unknown[];
  },
}));
const starSpies = vi.hoisted(() => ({
  setRewards: vi.fn(async (): Promise<true | null> => true),
}));
/** How many times a child's week was built (`weekFor`), per kid. */
const weekReads = vi.hoisted(() => vi.fn());
vi.mock('@/stores/starStore', async () => {
  const kit = await import('./choreTestKit');
  return {
    useStarStore: () => ({
      get rewards() {
        return rs.state!.rewards;
      },
      get isOn() {
        return rs.state!.rewards.on;
      },
      get earners() {
        return rs.state!.earners;
      },
      get earnerMembers() {
        return kit.earnerMembersOf(rs.state!.earners);
      },
      get awards() {
        return rs.state!.awards;
      },
      get sortedAwards() {
        return kit.sortedAwardsOf(rs.state!.awards as { createdAt?: string }[]);
      },
      weekFor: (id: string) =>
        (weekReads(id), id) === 'kid'
          ? { total: 9, full: 20, bar: 16, weekStart: '2026-11-09' }
          : id === 'sib'
            ? { total: 3, full: 10, bar: 8, weekStart: '2026-11-09' }
            : null,
      stripFor: (id: string) =>
        id === 'kid'
          ? {
              week: { total: 9, full: 20, bar: 16 },
              path: {
                stepSize: 1,
                steps: 20,
                earned: 9,
                next: 0,
                thinFrom: 20,
                barAt: 15,
                awardAt: null,
                toBar: 7,
                reached: false,
                reachable: true,
              },
              nearest: null,
              thisWeek: null,
            }
          : null,
      ...starSpies,
    }),
  };
});

import ChoreRewardsView from '../ChoreRewardsView.vue';

import NumberStepper from '@/components/ui/NumberStepper.vue';
import StarPathStrip from '../StarPathStrip.vue';
import { chore, choreActions, chores, resetKit } from './choreTestKit';

beforeEach(() => {
  resetKit();
  logEvent.mockReset();
  toast.mockReset();
  starSpies.setRewards.mockReset();
  starSpies.setRewards.mockResolvedValue(true);
  rs.state = reactive({
    rewards: { on: true, weeklyOn: true, title: 'Ice cream', emoji: '🍦', barPct: 80 },
    earners: ['kid', 'sib'],
    awards: [] as unknown[],
  });
  chores.list = [
    chore('k1', { assigneeIds: ['kid'], title: 'Make bed' }),
    chore('k2', { assigneeIds: ['kid'], title: 'Homework', block: 'afternoon', stars: 2 }),
    chore('s1', { assigneeIds: ['sib'], title: 'Feed the dog' }),
    chore('m1', { assigneeIds: ['dad'], title: 'Mow' }),
  ];
  choreActions.updateChore.mockResolvedValue({});
});

async function mountView(): Promise<VueWrapper> {
  const w = mount(ChoreRewardsView, {
    global: {
      stubs: {
        BeanieAvatar: true,
        CardArt: true,
        StarsTurnOnPanel: { template: '<div data-testid="stars-turn-on-panel" />' },
      },
    },
  });
  await flushPromises();
  return w;
}

describe('ChoreRewardsView: off', () => {
  it('the turn-on panel and nothing else', async () => {
    rs.state!.rewards.on = false;
    const w = await mountView();
    expect(w.find('[data-testid="stars-turn-on-panel"]').exists()).toBe(true);
    expect(w.find('[data-testid="chore-rewards-view"]').exists()).toBe(false);
  });
});

describe('ChoreRewardsView: each control calls its one store action', () => {
  it('the on/off switch sits at the top and turns it off', async () => {
    const w = await mountView();
    expect(w.find('[data-testid="stars-turn-on-panel"]').exists()).toBe(false);
    await w.get('[data-testid="chore-rewards-on-switch"]').trigger('click');
    expect(starSpies.setRewards).toHaveBeenCalledWith({ on: false }, 'mom');
  });

  it('the switch says what it does: "Enable Rewards", and its hint says what switching it off does', async () => {
    const { UI_STRINGS } = await import('@/services/translation/uiStrings');
    const en = UI_STRINGS as Record<string, string>;
    expect(en['choreStars.setup.on']).toBe('Enable Rewards');
    expect(en['choreStars.setup.onHint']).toContain('kids earn stars for their chores');
    expect(en['choreStars.setup.onHint']).toContain('pauses stars and rewards');
    expect(en['choreStars.setup.onHint']).toContain('keeps what was earned');
    const w = await mountView();
    const on = w.get('[data-testid="chore-rewards-on"]');
    expect(on.text()).toContain('choreStars.setup.on');
    expect(on.text()).toContain('choreStars.setup.onHint');
  });

  it('there is no take-back setting', async () => {
    const w = await mountView();
    expect(w.find('[data-testid="chore-rewards-take-back"]').exists()).toBe(false);
    expect(w.text()).not.toContain('takeBack');
  });

  it('the weekly reward on, with the default emoji when none is stored; and off', async () => {
    rs.state!.rewards.weeklyOn = false;
    rs.state!.rewards.emoji = undefined;
    const w = await mountView();
    await w.get('[data-testid="chore-rewards-weekly-switch"]').trigger('click');
    expect(starSpies.setRewards).toHaveBeenLastCalledWith({ weeklyOn: true, emoji: '🍦' }, 'mom');
    rs.state!.rewards.weeklyOn = true;
    rs.state!.rewards.emoji = '🍕';
    await flushPromises();
    await w.get('[data-testid="chore-rewards-weekly-switch"]').trigger('click');
    expect(starSpies.setRewards).toHaveBeenLastCalledWith({ weeklyOn: false }, 'mom');
  });

  it('the name saves on blur only, only when it changed, never per keystroke', async () => {
    const w = await mountView();
    const input = w.get('[data-testid="chore-rewards-title"]');
    await input.trigger('focus');
    await input.setValue('Ice cream sundae');
    expect(starSpies.setRewards).not.toHaveBeenCalled();
    await input.trigger('blur');
    expect(starSpies.setRewards).toHaveBeenCalledWith({ title: 'Ice cream sundae' }, 'mom');
    starSpies.setRewards.mockClear();
    await input.trigger('focus');
    await input.setValue('Ice cream');
    await input.trigger('blur');
    expect(starSpies.setRewards).not.toHaveBeenCalled();
  });

  it('the emoji', async () => {
    const w = await mountView();
    await w.get('[data-testid="chore-rewards-emoji"]').trigger('click');
    const options = w.findAll('[data-testid="chore-rewards-emoji-picker"] button');
    expect(options.length).toBeGreaterThan(8);
    const pizza = options.find((o) => o.text().includes('🍕'))!;
    await pizza.trigger('click');
    expect(starSpies.setRewards).toHaveBeenCalledWith({ emoji: '🍕' }, 'mom');
    expect(w.find('[data-testid="chore-rewards-emoji-picker"]').exists()).toBe(false);
  });

  it('the bar saves once, after the steps stop', async () => {
    vi.useFakeTimers();
    try {
      const w = await mountView();
      const bar = w.get('[data-testid="chore-rewards-weekly"]');
      await bar.get('[data-testid="stepper-decrease"]').trigger('click');
      await bar.get('[data-testid="stepper-decrease"]').trigger('click');
      expect(starSpies.setRewards).not.toHaveBeenCalled();
      vi.advanceTimersByTime(600);
      expect(starSpies.setRewards).toHaveBeenCalledTimes(1);
      expect(starSpies.setRewards).toHaveBeenCalledWith({ barPct: 70 }, 'mom');
      // The stepper moves in fives, 50 to 100.
      expect(bar.findComponent(NumberStepper).props()).toMatchObject({
        min: 50,
        max: 100,
        step: 5,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a bar changed just before leaving the view still saves', async () => {
    vi.useFakeTimers();
    try {
      const w = await mountView();
      await w
        .get('[data-testid="chore-rewards-weekly"] [data-testid="stepper-increase"]')
        .trigger('click');
      w.unmount();
      expect(starSpies.setRewards).toHaveBeenCalledWith({ barPct: 85 }, 'mom');
    } finally {
      vi.useRealTimers();
    }
  });

  it("a chore's value: choreStore.updateChore, via rewards; an unchanged value writes nothing", async () => {
    const w = await mountView();
    const row = w.get('[data-testid="chore-rewards-chore"][data-chore-id="k2"]');
    const stepper = row.findComponent(NumberStepper);
    expect(stepper.props()).toMatchObject({ modelValue: 2, min: 1, max: 5 });
    await row.get('[data-testid="stepper-increase"]').trigger('click');
    expect(choreActions.updateChore).toHaveBeenCalledWith('k2', { stars: 3 }, 'mom', {
      via: 'rewards',
    });
    choreActions.updateChore.mockClear();
    stepper.vm.$emit('update:modelValue', 2);
    expect(choreActions.updateChore).not.toHaveBeenCalled();
  });

  it('Add Special Reward asks the page for its one drawer, empty (no drawer of its own)', async () => {
    const w = await mountView();
    expect(w.findComponent({ name: 'ChoreAwardModal' }).exists()).toBe(false);
    await w.get('[data-testid="chore-rewards-add-award"]').trigger('click');
    expect(w.emitted('open-award')).toEqual([[null]]);
  });

  it('typing "Allowance" picks the money emoji, shown as it is typed and saved with the name', async () => {
    const w = await mountView();
    const input = w.get('[data-testid="chore-rewards-title"]');
    await input.trigger('focus');
    await input.setValue('Allowance');
    expect(w.get('[data-testid="chore-rewards-emoji"]').text()).toBe('💵');
    expect(starSpies.setRewards).not.toHaveBeenCalled();
    await input.trigger('blur');
    expect(starSpies.setRewards).toHaveBeenCalledWith({ title: 'Allowance', emoji: '💵' }, 'mom');
  });

  /** Picks an emoji by hand and lets the store answer with it. */
  async function pickByHand(w: VueWrapper, emoji: string): Promise<void> {
    await w.get('[data-testid="chore-rewards-emoji"]').trigger('click');
    await w
      .findAll('[data-testid="chore-rewards-emoji-picker"] button')
      .find((o) => o.text().includes(emoji))!
      .trigger('click');
    expect(starSpies.setRewards).toHaveBeenLastCalledWith({ emoji }, 'mom');
    rs.state!.rewards.emoji = emoji;
    await flushPromises();
  }

  async function rename(w: VueWrapper, name: string): Promise<string> {
    const input = w.get('[data-testid="chore-rewards-title"]');
    await input.trigger('focus');
    await input.setValue(name);
    const shown = w.get('[data-testid="chore-rewards-emoji"]').text();
    await input.trigger('blur');
    rs.state!.rewards.title = name;
    await flushPromises();
    return shown;
  }

  it('"Ice cream", the piggy bank by hand, then "Allowance": the money emoji, shown and saved with the name', async () => {
    rs.state!.rewards.title = 'Treat';
    rs.state!.rewards.emoji = '🎁';
    const w = await mountView();
    expect(await rename(w, 'Ice cream')).toBe('🍦');
    expect(starSpies.setRewards).toHaveBeenLastCalledWith(
      { title: 'Ice cream', emoji: '🍦' },
      'mom'
    );
    rs.state!.rewards.emoji = '🍦';
    await pickByHand(w, '🐷');
    expect(await rename(w, 'Allowance')).toBe('💵');
    expect(starSpies.setRewards).toHaveBeenLastCalledWith(
      { title: 'Allowance', emoji: '💵' },
      'mom'
    );
  });

  it('a hand pick stays through a rename with the same suggestion: "Allowance" to "Weekly allowance"', async () => {
    rs.state!.rewards.title = 'Allowance';
    rs.state!.rewards.emoji = '💵';
    const w = await mountView();
    await pickByHand(w, '🐷');
    expect(await rename(w, 'Weekly allowance')).toBe('🐷');
    expect(starSpies.setRewards).toHaveBeenLastCalledWith({ title: 'Weekly allowance' }, 'mom');
  });

  it('a hand pick stays through a rename to a name with no suggestion: the name only is saved', async () => {
    const w = await mountView();
    await pickByHand(w, '🐷');
    expect(await rename(w, 'Something nice')).toBe('🐷');
    expect(starSpies.setRewards).toHaveBeenLastCalledWith({ title: 'Something nice' }, 'mom');
  });

  it('opening an existing reward leaves its emoji, even one its name would not pick', async () => {
    rs.state!.rewards.title = 'Ice cream';
    rs.state!.rewards.emoji = '🐷';
    const w = await mountView();
    expect(w.get('[data-testid="chore-rewards-emoji"]').text()).toBe('🐷');
    // Focusing and leaving the name unchanged writes nothing.
    const input = w.get('[data-testid="chore-rewards-title"]');
    await input.trigger('focus');
    await input.trigger('blur');
    expect(starSpies.setRewards).not.toHaveBeenCalled();
    expect(w.get('[data-testid="chore-rewards-emoji"]').text()).toBe('🐷');
  });

  it('nothing here toasts, even when a store action answers null', async () => {
    starSpies.setRewards.mockResolvedValue(null);
    choreActions.updateChore.mockResolvedValue(null);
    const w = await mountView();
    await w.get('[data-testid="chore-rewards-weekly-switch"]').trigger('click');
    const row = w.get('[data-testid="chore-rewards-chore"][data-chore-id="k1"]');
    await row.get('[data-testid="stepper-increase"]').trigger('click');
    await flushPromises();
    expect(toast).not.toHaveBeenCalled();
  });
});

describe('ChoreRewardsView: what it shows', () => {
  it("typing the weekly reward's name never rebuilds the kids' weeks (the bar lines are one computed map)", async () => {
    const w = await mountView();
    weekReads.mockClear();
    const input = w.get('[data-testid="chore-rewards-title"]');
    await input.trigger('focus');
    for (const name of ['I', 'Ic', 'Ice', 'Ice c', 'Ice cr']) await input.setValue(name);
    expect(weekReads.mock.calls.filter(([id]) => id === 'sib')).toEqual([]);
  });

  it('each child\'s "N of M stars" under the bar, kids only', async () => {
    const w = await mountView();
    const lines = w
      .findAll('[data-testid="chore-rewards-bar-kid"]')
      .map((el) => [el.attributes('data-member-id'), el.text()]);
    expect(lines).toEqual([
      ['kid', 'choreStars.bar.child.other'],
      ['sib', 'choreStars.bar.child.other'],
    ]);
  });

  it('chore values follow the picked child, with the full week and their strip', async () => {
    const w = await mountView();
    const ids = () =>
      w.findAll('[data-testid="chore-rewards-chore"]').map((r) => r.attributes('data-chore-id'));
    expect(ids()).toEqual(['k1', 'k2']);
    expect(w.get('[data-testid="chore-rewards-full-week"]').text()).toContain('20');
    expect(w.findComponent(StarPathStrip).props('member')).toMatchObject({ id: 'kid' });
    await w.get('[data-testid="chore-rewards-kid"][data-member-id="sib"]').trigger('click');
    expect(ids()).toEqual(['s1']);
    // A grown-up's chore never shows here.
    expect(w.text()).not.toContain('Mow');
  });

  it("an award's row opens the award form on that award", async () => {
    rs.state!.awards = [
      {
        id: 'a1',
        title: 'Disneyland',
        emoji: '🏰',
        kind: 'saved',
        unit: 'weeks',
        price: 4,
        weekStart: '2026-11-09',
        createdBy: 'mom',
        createdAt: '2026-11-10',
        updatedAt: '2026-11-10',
      },
    ];
    const w = await mountView();
    const row = w.get('[data-testid="chore-rewards-award"]');
    expect(row.text()).toContain('Disneyland');
    expect(row.text()).toContain('choreStars.awards.oneTime');
    await row.trigger('click');
    expect(w.emitted('open-award')).toEqual([[expect.objectContaining({ id: 'a1' })]]);
  });

  it('a special reward for chosen kids says who it is for; one for every kid says nothing', async () => {
    const base = {
      emoji: '🦁',
      kind: 'saved',
      unit: 'weeks',
      price: 2,
      weekStart: '2026-11-09',
      createdBy: 'mom',
      updatedAt: '2026-11-10',
    };
    rs.state!.awards = [
      { ...base, id: 'all', title: 'Zoo', createdAt: '2026-11-10' },
      { ...base, id: 'one', title: 'Bike', memberIds: ['sib'], createdAt: '2026-11-11' },
      { ...base, id: 'gone', title: 'Beach', memberIds: ['left'], createdAt: '2026-11-12' },
    ];
    const w = await mountView();
    const rows = w.findAll('[data-testid="chore-rewards-award"]');
    expect(rows[0]!.text()).not.toContain('choreStars.awards.forKids');
    expect(rows[1]!.text()).toContain('choreStars.awards.forKids');
    expect(rows[2]!.text()).toContain('choreStars.awards.forNobody');
  });
});
