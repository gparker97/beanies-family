/**
 * The choreboard page's §8 guards (#146) and its two views:
 *  - a non-adult always sees their OWN day (`?bean=` is forced to their id), with no grown-up
 *    controls; their day with no chores has its own empty state;
 *  - a grown-up's unknown or pet `?bean=` falls back to home and is stripped;
 *  - `?starter=<set>&for=<ids>` opens Add Chores preselected for grown-ups only: `starter`
 *    must be a known key, `for` is filtered to living people (no pets), and both are stripped
 *    after reading (ignored and stripped for a non-adult);
 *  - a bean's chore list (`ChoreBeanEditor`) opens from the card's ONE edit affordance (Edit
 *    Chores, or "+" with no chores), a chore's name, the day's Edit Chores and Quick Add on a
 *    day; the header, the empty state and the redirect open the multi-bean Add Chores sheet;
 *  - a bean's day only ticks: no pencils, handles, Select or Other Days;
 *  - "No one's" chores have a ✕ that deletes them;
 *  - ticking goes through the page's guarded tick path with `surface: 'app'`;
 *  - home lays the cards in ONE regular grid in family order, beans with none as chips in a
 *    "No Chores Yet" strip, the board below at every width; a bean's day has the "Today" summary (a tap opens that block) and
 *    the bean's own Chores Done week, for a child too, never the grown-ups' board.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { defineComponent } from 'vue';

vi.mock(
  '@/composables/useTranslation',
  async () => (await import('@/components/chores/__tests__/choreTestKit')).translationModule
);
vi.mock(
  '@/stores/familyStore',
  async () => (await import('@/components/chores/__tests__/choreTestKit')).familyStoreModule
);
vi.mock(
  '@/stores/choreStore',
  async () => (await import('@/components/chores/__tests__/choreTestKit')).choreStoreModule
);
vi.mock(
  '@/stores/starStore',
  async () => (await import('@/components/chores/__tests__/choreTestKit')).starStoreModule
);
vi.mock(
  '@/composables/usePermissions',
  async () => (await import('@/components/chores/__tests__/choreTestKit')).permissionsModule
);
vi.mock(
  '@/composables/useChoreClock',
  async () => (await import('@/components/chores/__tests__/choreTestKit')).choreClockModule
);
vi.mock(
  'vue-router',
  async () => (await import('@/components/chores/__tests__/choreTestKit')).routerModule
);
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: () => ({ weekStartDay: 1 }) }));
const logEvent = vi.hoisted(() => vi.fn());
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent }));
vi.mock('@/composables/useBreakpoint', async () => {
  const { ref } = await import('vue');
  const isMobile = ref(false);
  return { useBreakpoint: () => ({ isMobile, isTablet: ref(false), isDesktop: ref(true) }) };
});
vi.mock('@/composables/useMediaQuery', async () => {
  const { ref } = await import('vue');
  const wide = ref(false);
  return { useMediaQuery: () => wide };
});
const quickAdd = vi.hoisted(() => ({ handler: null as null | ((a: string) => void) }));
vi.mock('@/composables/useQuickAddIntent', () => ({
  useQuickAddIntent: (h: (a: string) => void) => {
    quickAdd.handler = h;
  },
}));

import ChoreboardPage from '../ChoreboardPage.vue';
import { repoFile } from '@/test/repoFile';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { useMediaQuery } from '@/composables/useMediaQuery';
import {
  bannerHosts,
  chore,
  choreActions,
  chores,
  family,
  resetKit,
  route,
  routerFns,
  starActions,
  stars,
} from '@/components/chores/__tests__/choreTestKit';
import { celebrateReward, resetChoreCelebrationForTest } from '@/composables/useCelebration';

const modalStub = (name: string, props: string[]) =>
  defineComponent({ name, props, template: '<div />' });
const StarterStub = modalStub('ChoreAddSheet', ['open', 'presetKey', 'presetMemberIds', 'carried']);
const EditorStub = modalStub('ChoreBeanEditor', ['open', 'memberId']);
const GiftStub = modalStub('StarGiftModal', ['open', 'memberId']);
const AwardStub = modalStub('ChoreAwardModal', ['open', 'award']);

const stubs = {
  ChoreAddSheet: StarterStub,
  ChoreBeanEditor: EditorStub,
  ChoreCopyModal: modalStub('ChoreCopyModal', ['open', 'sourceMemberId']),
  ChoreHoursModal: modalStub('ChoreHoursModal', ['open']),
  ChoreRewardsView: defineComponent({
    name: 'ChoreRewardsView',
    emits: ['open-award'],
    template: '<div data-testid="chore-rewards-view-stub" />',
  }),
  StarReportView: defineComponent({
    name: 'StarReportView',
    props: ['weeks', 'week'],
    emits: ['update:week', 'open-rewards', 'open-award'],
    template: '<div data-testid="star-report-view-stub" />',
  }),
  StarGiftModal: GiftStub,
  ChoreAwardModal: AwardStub,
  CardArt: true,
  BeanieAvatar: true,
};

/** A stub's props: the stubs declare their props at runtime only, so read them untyped. */
const propsOf = (w: VueWrapper, stub: ReturnType<typeof modalStub>) =>
  w.findComponent(stub).props() as Record<string, unknown>;

async function mountPage(query: Record<string, string> = {}): Promise<VueWrapper> {
  route.query = { ...query };
  const w = mount(ChoreboardPage, { global: { stubs } });
  await flushPromises();
  return w;
}

const guarded = () =>
  logEvent.mock.calls
    .map((c) => c[0] as { message: string; context?: { detail?: string } })
    .filter((e) => e.message === 'query-guarded')
    .map((e) => e.context?.detail);

const MANAGE = [
  'chore-open-add',
  'chore-open-hours',
  'chore-day-edit',
  'chore-day-copy',
  'chore-bean-add',
  'chore-bean-copy',
  'chore-bean-edit',
  'chore-edit',
  'chore-row-remove',
  'chore-empty-starters',
  'chore-day-empty-add',
  'chore-day-empty-edit',
];

/** Controls the old per-chore editing had, gone from every view. */
const GONE = [
  'chore-row-edit',
  'chore-drag-handle',
  'chore-day-add',
  'chore-day-select',
  'chore-day-other-days',
  'chore-row-select',
];

const setMobile = (v: boolean) => {
  (useBreakpoint().isMobile as unknown as { value: boolean }).value = v;
};
const setWide = (v: boolean) => {
  (useMediaQuery('') as unknown as { value: boolean }).value = v;
};

beforeEach(() => {
  resetKit();
  setMobile(false);
  setWide(false);
  logEvent.mockReset();
  quickAdd.handler = null;
  chores.list = [
    chore('k1', { assigneeIds: ['kid'], title: 'Make bed' }),
    chore('k2', { assigneeIds: ['kid'], title: 'Brush teeth', block: 'evening' }),
    chore('s1', { assigneeIds: ['sib'], title: 'Feed the dog' }),
  ];
  choreActions.toggleChore.mockResolvedValue({
    action: 'tick',
    completed: null,
    celebrated: false,
  });
});

describe('a child viewer', () => {
  beforeEach(() => {
    family.currentMemberId = 'kid';
  });

  it('lands on their own day: no ?bean= becomes their id', async () => {
    const w = await mountPage();
    expect(routerFns.replace).toHaveBeenCalledWith({ query: { bean: 'kid' } });
    expect(w.get('[data-testid="chore-day-head"]').attributes('data-member-id')).toBe('kid');
    // Arriving without ?bean= is not a guard event.
    expect(guarded()).toEqual([]);
  });

  it('a sibling’s ?bean= is forced back to their own, and logged', async () => {
    const w = await mountPage({ bean: 'sib' });
    expect(routerFns.replace).toHaveBeenCalledWith({ query: { bean: 'kid' } });
    expect(w.get('[data-testid="chore-day-head"]').attributes('data-member-id')).toBe('kid');
    expect(w.text()).not.toContain('Feed the dog');
    expect(guarded()).toContain('child-own-day');
  });

  it('sees no grown-up controls anywhere', async () => {
    const w = await mountPage({ bean: 'kid' });
    for (const id of MANAGE) expect(w.find(`[data-testid="${id}"]`).exists(), id).toBe(false);
    expect(w.find('[data-testid="chore-day-back"]').exists()).toBe(false);
    expect(w.find('[data-testid="chore-week-panel"]').exists()).toBe(false);
    // Their own summary and their own week, nobody else's.
    expect(w.find('[data-testid="chore-day-summary"]').exists()).toBe(true);
    const week = w.get('[data-testid="chore-week-row"]');
    const owners = new Set(
      week.findAll('[data-testid="chore-day-cell"]').map((c) => c.attributes('data-member-id'))
    );
    expect([...owners]).toEqual(['kid']);
    // But can tick their own chores.
    expect(w.findAll('[data-testid="chore-tick"]').length).toBeGreaterThan(0);
  });

  it('ticks through the page’s guarded path with surface app', async () => {
    const w = await mountPage({ bean: 'kid' });
    await w.get('[data-chore-id="k1"] [data-testid="chore-tick"]').trigger('click');
    await flushPromises();
    expect(choreActions.toggleChore).toHaveBeenCalledWith('k1', 'kid', {
      surface: 'app',
      // Where the all-done celebration plays if this tick finishes the block (#146).
      anchor: expect.objectContaining({ block: expect.any(HTMLElement) }),
    });
  });

  it('a ?starter= link is ignored and stripped, and the sheet never opens', async () => {
    const w = await mountPage({ starter: 'school-morning', for: 'kid', bean: 'kid' });
    expect(routerFns.replace).toHaveBeenCalledWith({ query: { bean: 'kid' } });
    expect(propsOf(w, StarterStub).open).toBe(false);
    expect(guarded()).toContain('starter-not-adult');
  });

  it('no chores at all: "Ask a grown-up"; none today: "Nothing to do today"', async () => {
    chores.list = [];
    const none = await mountPage({ bean: 'kid' });
    expect(none.get('[data-testid="chore-day-empty"]').text()).toContain('choreboard.empty.child');
    none.unmount();
    chores.list = [chore('sat', { assigneeIds: ['kid'], days: [6] })]; // today is a Friday
    const notToday = await mountPage({ bean: 'kid' });
    expect(notToday.get('[data-testid="chore-day-empty"]').text()).toContain(
      'choreboard.empty.childToday'
    );
    // The friendly card alone: no Add or Edit Chores for a child, in either case.
    for (const id of ['chore-day-empty-add', 'chore-day-empty-edit', 'chore-day-edit']) {
      expect(notToday.find(`[data-testid="${id}"]`).exists(), id).toBe(false);
    }
  });

  it('the quick-add intent does nothing for a child', async () => {
    const w = await mountPage({ bean: 'kid' });
    quickAdd.handler?.('add-chore');
    await flushPromises();
    expect(propsOf(w, EditorStub).open).toBe(false);
    expect(propsOf(w, StarterStub).open).toBe(false);
  });
});

describe('a grown-up viewer', () => {
  it("the reward banner's host is the kid's day head, never the home cards; ticks claim nothing", async () => {
    // (Pages mounted by earlier tests follow the shared route too, so the check is on the set.)
    const day = await mountPage({ bean: 'kid' });
    expect(new Set(bannerHosts)).toEqual(new Set(['kid:app']));
    const registered = starActions.hostRewardBanner.mock.calls.length;
    await day.get('[data-chore-id="k1"] [data-testid="chore-tick"]').trigger('click');
    await flushPromises();
    expect(starActions.hostRewardBanner.mock.calls.length).toBe(registered);
    // Home: no day head on screen, so every host is released, and a card tick registers none.
    const home = await mountPage();
    expect(bannerHosts).toEqual([]);
    await home.get('[data-chore-id="k1"] [data-testid="chore-tick"]').trigger('click');
    await flushPromises();
    expect(bannerHosts).toEqual([]);
  });

  it('home: one card per living person (never a pet), and the manage controls', async () => {
    const w = await mountPage();
    expect(routerFns.replace).not.toHaveBeenCalled();
    const cards = w.findAll('[data-testid="chore-bean-card"]');
    expect(cards.map((c) => c.attributes('data-member-id'))).toEqual(['kid', 'sib']);
    const chips = w.findAll('[data-testid="chore-slim-row"]');
    expect(chips.map((c) => c.attributes('data-member-id'))).toEqual(['mom', 'dad']);
    for (const id of ['chore-open-add', 'chore-open-hours']) {
      expect(w.find(`[data-testid="${id}"]`).exists(), id).toBe(true);
    }
    // ONE add entry point, and it is the Add Chores sheet.
    expect(w.find('[data-testid="chore-open-starters"]').exists()).toBe(false);
    expect(w.get('[data-testid="chore-open-add"]').text()).toContain('choreboard.addChores');
    await w.get('[data-testid="chore-open-add"]').trigger('click');
    expect(propsOf(w, StarterStub)).toMatchObject({ open: true, presetMemberIds: [] });
    expect(propsOf(w, EditorStub).open).toBe(false);
    expect(w.find('[data-testid="chore-week-panel"]').exists()).toBe(true);
    for (const id of GONE) expect(w.find(`[data-testid="${id}"]`).exists(), id).toBe(false);
  });

  it('home: ONE regular grid in family order; beans with none as chips in one strip', async () => {
    chores.list = [
      chore('k1', { assigneeIds: ['kid'] }),
      chore('k2', { assigneeIds: ['kid'] }),
      chore('k4', { assigneeIds: ['kid'], block: 'afternoon' }),
      chore('s1', { assigneeIds: ['sib'] }),
      chore('m1', { assigneeIds: ['mom'], block: 'evening' }),
    ];
    const w = await mountPage();
    const grid = w.get('[data-testid="chore-card-grid"]');
    // Every card in the one grid, in family order (Mama, Pip, Juno), however long each is.
    expect(
      grid.findAll('[data-testid="chore-bean-card"]').map((c) => c.attributes('data-member-id'))
    ).toEqual(['mom', 'kid', 'sib']);
    // Cards stretch to their row's height.
    expect(grid.get('[data-testid="chore-bean-card"]').classes()).toContain('h-full');
    // Papa has no chores: a chip in the "No Chores Yet" strip, with its own Add Chores.
    const strip = w.get('[data-testid="chore-no-chores"]');
    expect(strip.text()).toContain('choreboard.noChores.title');
    const chips = strip.findAll('[data-testid="chore-slim-row"]');
    expect(chips.map((c) => c.attributes('data-member-id'))).toEqual(['dad']);
    expect(chips[0]!.find('[data-testid="chore-bean-add"]').exists()).toBe(true);
    // The board sits below the cards.
    const html = w.html();
    expect(html.indexOf('chore-card-grid')).toBeLessThan(html.indexOf('chore-week-panel'));
  });

  it('the lower row: Chores Done then This Week, on the SAME grid as the cards', async () => {
    const w = await mountPage();
    const cards = w.get('[data-testid="chore-card-grid"]');
    const lower = w.get('[data-testid="chore-home-lower"]');
    // One grid class for both, so the columns (and the edges) are the same.
    expect(cards.classes()).toContain('chore-home-grid');
    expect(lower.classes()).toContain('chore-home-grid');
    const [board, summary] = lower.element.children;
    expect(board!.getAttribute('data-testid')).toBe('chore-week-panel');
    expect(summary!.getAttribute('data-testid')).toBe('chore-week-summary');
    expect(board!.classList).toContain('chore-home-board');
    expect(summary!.classList).toContain('chore-home-summary');
    // The legend lives in This Week now, not under the board.
    expect(summary!.querySelector('[data-testid="chore-week-legend"]')).not.toBeNull();
    expect(board!.querySelector('[data-testid="chore-week-legend"]')).toBeNull();
    // A row in This Week opens that bean's day.
    await lower
      .get('[data-testid="chore-week-summary-row"][data-member-id="sib"]')
      .trigger('click');
    expect(routerFns.push).toHaveBeenCalledWith({ query: { bean: 'sib' } });
  });

  it('the layout switch at the three widths (the page grid rules)', () => {
    // happy-dom does not lay out media queries, so the rules themselves are pinned: a phone
    // stacks (one column), 768px spans both columns for each, and from 1280px as many columns
    // as fit (three to five, about 20rem each), This Week in the last and the board across
    // the rest.
    const css = repoFile('src/pages/ChoreboardPage.vue').replace(/\s+/g, ' ');
    expect(css).toContain('.chore-home-grid { grid-template-columns: minmax(0, 1fr); }');
    expect(css).toMatch(
      /@media \(width >= 48rem\) \{ .chore-home-grid \{ grid-template-columns: repeat\(2, [^}]*\} .*?\.chore-home-lower > \.chore-home-summary \{ grid-column: 1 \/ -1; \}/
    );
    expect(css).toMatch(
      /@media \(width >= 80rem\) \{ .chore-home-grid \{ --chore-home-gap: 0\.875rem; grid-template-columns: repeat\( auto-fill, minmax\( clamp\( calc\(\(100% - 4 \* var\(--chore-home-gap\)\) \/ 5\), 20rem, calc\(\(100% - 2 \* var\(--chore-home-gap\)\) \/ 3 - 1px\) \), 1fr \) \); \} \.chore-home-lower > \.chore-home-board \{ grid-column: 1 \/ -2; \} \.chore-home-lower > \.chore-home-summary \{ grid-column: -2 \/ -1; \}/
    );
  });

  it('a child never sees the "No Chores Yet" strip, the board or This Week', async () => {
    family.currentMemberId = 'kid';
    const w = await mountPage();
    expect(w.find('[data-testid="chore-no-chores"]').exists()).toBe(false);
    expect(w.find('[data-testid="chore-week-summary"]').exists()).toBe(false);
    expect(w.find('[data-testid="chore-home-lower"]').exists()).toBe(false);
  });

  it('a card’s Edit Chores opens that bean’s chore list; Add Chores (no chores yet) opens it empty', async () => {
    const w = await mountPage();
    await w.get('[data-member-id="kid"] [data-testid="chore-bean-edit"]').trigger('click');
    expect(propsOf(w, EditorStub)).toMatchObject({ open: true, memberId: 'kid' });
    expect(propsOf(w, StarterStub).open).toBe(false);
    expect(routerFns.push).not.toHaveBeenCalled();
    // Mama Bean has no chores: her chip's one affordance is Add Chores.
    expect(w.find('[data-member-id="mom"] [data-testid="chore-bean-edit"]').exists()).toBe(false);
    await w.get('[data-member-id="mom"] [data-testid="chore-bean-add"]').trigger('click');
    expect(propsOf(w, EditorStub)).toMatchObject({ open: true, memberId: 'mom' });
    // The header opens the day.
    await w.get('[data-member-id="sib"] [data-testid="chore-bean-open"]').trigger('click');
    expect(routerFns.push).toHaveBeenCalledWith({ query: { bean: 'sib' } });
  });

  it('a chore’s name on a home card opens that bean’s chore list', async () => {
    const w = await mountPage();
    await w.get('[data-chore-id="k1"] [data-testid="chore-edit"]').trigger('click');
    expect(propsOf(w, EditorStub)).toMatchObject({ open: true, memberId: 'kid' });
  });

  it('an unknown ?bean= falls back to home and is stripped', async () => {
    const w = await mountPage({ bean: 'ghost', other: 'kept' });
    expect(routerFns.replace).toHaveBeenCalledWith({ query: { other: 'kept' } });
    expect(w.find('[data-testid="chore-day-head"]').exists()).toBe(false);
    expect(w.findAll('[data-testid="chore-bean-card"]').length).toBeGreaterThan(0);
    expect(guarded()).toEqual(['unknown-bean']);
  });

  it('a pet ?bean= falls back to home too', async () => {
    const w = await mountPage({ bean: 'rex' });
    expect(routerFns.replace).toHaveBeenCalledWith({ query: {} });
    expect(w.find('[data-testid="chore-day-head"]').exists()).toBe(false);
  });

  it('a living ?bean= opens that bean’s day: back, copy, and Edit Chores for their list', async () => {
    const w = await mountPage({ bean: 'sib' });
    expect(routerFns.replace).not.toHaveBeenCalled();
    expect(w.get('[data-testid="chore-day-head"]').attributes('data-member-id')).toBe('sib');
    expect(w.find('[data-testid="chore-day-back"]').exists()).toBe(true);
    expect(w.find('[data-testid="chore-day-copy"]').exists()).toBe(true);
    expect(w.find('[data-testid="chore-week-row"]').exists()).toBe(true);
    expect(w.find('[data-testid="chore-week-panel"]').exists()).toBe(false);
    await w.get('[data-testid="chore-day-edit"]').trigger('click');
    expect(propsOf(w, EditorStub)).toMatchObject({ open: true, memberId: 'sib' });
    expect(propsOf(w, StarterStub).open).toBe(false);
  });

  it('a bean with no chores at all: the day reads Add Chores, and so does its empty card', async () => {
    const w = await mountPage({ bean: 'mom' });
    const action = w.get('[data-testid="chore-day-edit"]');
    expect(action.text()).toContain('choreboard.addChores');
    expect(action.text()).not.toContain('choreboard.day.edit');
    expect(action.attributes('data-empty')).toBe('true');
    expect(w.find('[data-testid="chore-day-copy"]').exists()).toBe(false);
    const card = w.get('[data-testid="chore-day-empty"]');
    expect(card.text()).toContain('choreboard.empty.forBean');
    expect(card.text()).not.toContain('choreboard.empty.forBeanToday');
    expect(card.find('[data-testid="chore-day-empty-edit"]').exists()).toBe(false);
    await card.get('[data-testid="chore-day-empty-add"]').trigger('click');
    expect(propsOf(w, EditorStub)).toMatchObject({ open: true, memberId: 'mom' });
    expect(propsOf(w, StarterStub).open).toBe(false);
    // The top action opens the same list.
    w.findComponent(EditorStub).vm.$emit('close');
    await flushPromises();
    await action.trigger('click');
    expect(propsOf(w, EditorStub)).toMatchObject({ open: true, memberId: 'mom' });
  });

  it('a bean whose chores are all on other days: a plain "nothing today" card with Edit Chores', async () => {
    chores.list = [chore('sat', { assigneeIds: ['kid'], days: [6] })]; // today is a Friday
    const w = await mountPage({ bean: 'kid' });
    const action = w.get('[data-testid="chore-day-edit"]');
    expect(action.text()).toContain('choreboard.day.edit');
    expect(action.attributes('data-empty')).toBeUndefined();
    const card = w.get('[data-testid="chore-day-empty"]');
    expect(card.text()).toContain('choreboard.empty.forBeanToday');
    expect(card.find('[data-testid="chore-day-empty-add"]').exists()).toBe(false);
    const edit = card.get('[data-testid="chore-day-empty-edit"]');
    expect(edit.text()).toBe('choreboard.day.edit');
    await edit.trigger('click');
    expect(propsOf(w, EditorStub)).toMatchObject({ open: true, memberId: 'kid' });
  });

  it('the day: a Today summary row per block; a tap opens that block where it sits', async () => {
    const w = await mountPage({ bean: 'kid' });
    const summary = w.get('[data-testid="chore-day-summary"]');
    const rows = summary.findAll('[data-testid="chore-summary"]');
    expect(rows.map((r) => r.attributes('data-block'))).toEqual(['morning', 'evening']);
    // A tap on the Evening row opens Evening's section (whatever its default) and focuses it.
    const evening = () => w.get('[data-testid="chore-block"][data-block="evening"]');
    await rows[1]!.get('[data-testid="chore-summary-toggle"]').trigger('click');
    await flushPromises();
    expect(evening().find('[data-testid="chore-block-rows"]').exists()).toBe(true);
    expect(w.find('.day-grid-rail').exists()).toBe(false);
  });

  it('the day: every block opens with its chores; one folded by its header reopens from Today', async () => {
    const w = await mountPage({ bean: 'kid' });
    const states = w
      .findAll('[data-testid="chore-block"]')
      .map((b) => `${b.attributes('data-block')}:${b.attributes('data-state')}`);
    expect(states).toEqual(['morning:open', 'evening:open']);
    const evening = () => w.get('[data-testid="chore-block"][data-block="evening"]');
    expect(evening().find('[data-testid="chore-block-rows"]').exists()).toBe(true);
    await evening().get('[data-testid="chore-block-header"]').trigger('click');
    expect(evening().attributes('data-state')).toBe('later');
    const rows = w
      .get('[data-testid="chore-day-summary"]')
      .findAll('[data-testid="chore-summary"]');
    await rows[1]!.get('[data-testid="chore-summary-toggle"]').trigger('click');
    await flushPromises();
    expect(evening().attributes('data-state')).toBe('open');
  });

  it('the day on a phone: the summary is the tile strip; on a wide screen, a rail', async () => {
    setMobile(true);
    const phone = await mountPage({ bean: 'kid' });
    expect(
      phone.findAll('[data-testid="chore-day-summary"] button[data-testid="chore-summary"]')
    ).toHaveLength(2);
    phone.unmount();
    setMobile(false);
    setWide(true);
    const wide = await mountPage({ bean: 'kid' });
    expect(wide.find('.day-grid-rail').exists()).toBe(true);
  });

  it('a bean with no chores at all: no summary, no week, no rail', async () => {
    setWide(true);
    const w = await mountPage({ bean: 'mom' });
    expect(w.find('[data-testid="chore-day-summary"]').exists()).toBe(false);
    expect(w.find('[data-testid="chore-week-row"]').exists()).toBe(false);
    expect(w.find('.day-grid-rail').exists()).toBe(false);
  });

  it('a bean with chores today has no empty card and no data-empty', async () => {
    const w = await mountPage({ bean: 'kid' });
    expect(w.find('[data-testid="chore-day-empty"]').exists()).toBe(false);
    expect(w.get('[data-testid="chore-day-edit"]').attributes('data-empty')).toBeUndefined();
  });

  it('a bean’s day only ticks: no pencils, handles, Select or Other Days; a name opens the list', async () => {
    chores.list = [...chores.list, chore('sat', { assigneeIds: ['kid'], days: [6] })];
    const w = await mountPage({ bean: 'kid' });
    for (const id of GONE) expect(w.find(`[data-testid="${id}"]`).exists(), id).toBe(false);
    // A chore on another weekday is in the bean's list, not on today.
    expect(w.find('[data-chore-id="sat"]').exists()).toBe(false);
    expect(w.findAll('[data-testid="chore-tick"]').length).toBeGreaterThan(0);
    await w.get('[data-chore-id="k1"] [data-testid="chore-edit"]').trigger('click');
    expect(propsOf(w, EditorStub)).toMatchObject({ open: true, memberId: 'kid' });
  });

  it('?starter=&for= opens Starter Sets preselected with living people only, then strips both', async () => {
    const w = await mountPage({ starter: 'bedtime', for: 'kid,rex,ghost,sib' });
    const sheet = propsOf(w, StarterStub);
    expect(sheet.open).toBe(true);
    expect(sheet.presetKey).toBe('bedtime');
    expect(sheet.presetMemberIds).toEqual(['kid', 'sib']);
    expect(sheet.carried).toBe(true);
    expect(routerFns.replace).toHaveBeenCalledTimes(1);
    expect(routerFns.replace).toHaveBeenCalledWith({ query: {} });
  });

  it('an unknown ?starter= opens nothing, is stripped, and is logged', async () => {
    const w = await mountPage({ starter: 'free-ice-cream', for: 'kid' });
    expect(propsOf(w, StarterStub).open).toBe(false);
    expect(routerFns.replace).toHaveBeenCalledWith({ query: {} });
    expect(guarded()).toContain('starter-invalid');
  });

  it('a valid ?starter= with no living people opens with nobody carried', async () => {
    const w = await mountPage({ starter: 'tidy-up', for: 'rex' });
    const sheet = propsOf(w, StarterStub);
    expect(sheet.open).toBe(true);
    expect(sheet.presetMemberIds).toEqual([]);
    expect(sheet.carried).toBe(false);
  });

  it('the quick-add intent: on a bean’s day, their chore list; at home, Add Chores', async () => {
    const day = await mountPage({ bean: 'sib' });
    quickAdd.handler?.('add-chore');
    await flushPromises();
    expect(propsOf(day, EditorStub)).toMatchObject({ open: true, memberId: 'sib' });
    expect(propsOf(day, StarterStub).open).toBe(false);
    day.unmount();
    const home = await mountPage();
    quickAdd.handler?.('add-chore');
    await flushPromises();
    expect(propsOf(home, StarterStub)).toMatchObject({ open: true, presetMemberIds: [] });
    expect(propsOf(home, EditorStub).open).toBe(false);
  });

  it('an empty family shows the empty state with one way to start: Add Chores', async () => {
    chores.list = [];
    const w = await mountPage();
    expect(w.find('[data-testid="chore-home-empty"]').exists()).toBe(true);
    expect(w.find('[data-testid="chore-empty-add"]').exists()).toBe(false);
    await w.get('[data-testid="chore-empty-starters"]').trigger('click');
    expect(propsOf(w, StarterStub).open).toBe(true);
  });

  it('chores with nobody left show under "No one\'s", each with a ✕ that deletes it', async () => {
    chores.list = [...chores.list, chore('o1', { assigneeIds: ['gone'], title: 'Orphan' })];
    choreActions.deleteChore.mockResolvedValue(true);
    const w = await mountPage();
    const orphans = w.get('[data-testid="chore-orphans"]');
    expect(orphans.text()).toContain('Orphan');
    expect(orphans.find('[data-testid="chore-tick"]').exists()).toBe(false);
    expect(orphans.find('[data-testid="chore-edit"]').exists()).toBe(false);
    await orphans.get('[data-testid="chore-row-remove"]').trigger('click');
    expect(choreActions.deleteChore).toHaveBeenCalledWith('o1', 'mom');
  });
});

/**
 * Stars and rewards (#148). A grown-up's home has a view switch (Chores, the default, Star
 * Report while the feature is on, and Rewards, always), never remembered, with `?view=` honoured once and stripped; a kid never sees it
 * and their `?view=` is stripped and logged. Off means absent everywhere else. On: a kid's day
 * head gets the arc (with the badge once achieved) and the count, every kid's chore shows its
 * value, the achieved banner shows under the head while it is up, and "Give Stars" (a step-4
 * stub) sits at the right of the switch on Stars and Rewards and on a kid's day for a grown-up.
 */
describe('stars and rewards', () => {
  const STAR_IDS = [
    'star-count',
    'chore-day-ring',
    'chore-day-stars',
    'chore-day-badge',
    'chore-give-stars',
    'chore-day-give-stars',
    'chore-day-reward-banner',
  ];

  it("off: no star element anywhere, on a kid's day or a grown-up's home", async () => {
    family.currentMemberId = 'kid';
    const day = await mountPage({ bean: 'kid' });
    for (const id of STAR_IDS) expect(day.find(`[data-testid="${id}"]`).exists(), id).toBe(false);
    family.currentMemberId = 'mom';
    const home = await mountPage();
    for (const id of STAR_IDS) expect(home.find(`[data-testid="${id}"]`).exists(), id).toBe(false);
  });

  it("a grown-up's home: the switch above the home, on Chores, the home as it always was", async () => {
    const w = await mountPage();
    const sw = w.get('[data-testid="chore-home-views"]');
    expect(sw.text()).toContain('choreStars.view.chores');
    expect(sw.text()).toContain('choreStars.view.rewards');
    expect(w.find('[data-testid="chore-card-grid"]').exists()).toBe(true);
    expect(w.find('[data-testid="chore-open-hours"]').exists()).toBe(true);
    expect(w.find('[data-testid="chore-rewards-view-stub"]').exists()).toBe(false);
    // The switch is the first thing on the home, above the welcome row.
    const order = [...w.element.querySelectorAll('[data-testid]')].map((e) =>
      e.getAttribute('data-testid')
    );
    expect(order.indexOf('chore-home-views')).toBeLessThan(order.indexOf('chore-now-pill'));
  });

  it('the switch opens Stars and Rewards (feature off or on) and back to Chores', async () => {
    const w = await mountPage();
    await w.get('[data-testid="chore-home-views"] button:nth-child(2)').trigger('click');
    expect(w.find('[data-testid="chore-rewards-view-stub"]').exists()).toBe(true);
    expect(w.find('[data-testid="chore-card-grid"]').exists()).toBe(false);
    expect(w.find('[data-testid="chore-open-hours"]').exists()).toBe(false);
    // Off: no Give Stars.
    expect(w.find('[data-testid="chore-give-stars"]').exists()).toBe(false);
    await w.get('[data-testid="chore-home-views"] button:nth-child(1)').trigger('click');
    expect(w.find('[data-testid="chore-card-grid"]').exists()).toBe(true);
  });

  it('?view=rewards opens Stars and Rewards once, then is stripped', async () => {
    const w = await mountPage({ view: 'rewards' });
    expect(w.find('[data-testid="chore-rewards-view-stub"]').exists()).toBe(true);
    expect(routerFns.replace).toHaveBeenCalledWith({ query: {} });
    expect(guarded()).toEqual([]);
  });

  it('an unknown ?view= stays on Chores, is stripped and logged', async () => {
    const w = await mountPage({ view: 'nope' });
    expect(w.find('[data-testid="chore-card-grid"]').exists()).toBe(true);
    expect(routerFns.replace).toHaveBeenCalledWith({ query: {} });
    expect(guarded()).toContain('view-unknown');
  });

  it('a kid never sees the switch; their ?view= is ignored, stripped and logged', async () => {
    family.currentMemberId = 'kid';
    const w = await mountPage({ view: 'rewards' });
    expect(w.find('[data-testid="chore-home-views"]').exists()).toBe(false);
    expect(w.find('[data-testid="chore-rewards-view-stub"]').exists()).toBe(false);
    expect(routerFns.replace).toHaveBeenCalledWith({ query: { bean: 'kid' } });
    expect(guarded()).toContain('view-not-adult');
  });

  it("a bean's day has no switch, even for a grown-up", async () => {
    const w = await mountPage({ bean: 'kid' });
    expect(w.find('[data-testid="chore-home-views"]').exists()).toBe(false);
  });

  it('on: Give Stars at the right of the switch on Stars and Rewards and Star Report, opening the gift modal for no one', async () => {
    stars.on = true;
    const w = await mountPage();
    expect(propsOf(w, GiftStub)).toMatchObject({ open: false });
    expect(w.find('[data-testid="chore-give-stars"]').exists()).toBe(false);
    // On: Chores, Star Report, Rewards.
    await w.get('[data-testid="chore-home-views"] button:nth-child(3)').trigger('click');
    expect(w.find('[data-testid="chore-rewards-view-stub"]').exists()).toBe(true);
    await w.get('[data-testid="chore-give-stars"]').trigger('click');
    expect(propsOf(w, GiftStub)).toMatchObject({ open: true, memberId: null });
    w.findComponent(GiftStub).vm.$emit('close');
    await flushPromises();
    expect(propsOf(w, GiftStub).open).toBe(false);
    await w.get('[data-testid="chore-home-views"] button:nth-child(2)').trigger('click');
    expect(w.find('[data-testid="star-report-view-stub"]').exists()).toBe(true);
    expect(w.find('[data-testid="chore-give-stars"]').exists()).toBe(true);
  });

  it("on: a grown-up on a kid's day gets a small Give Stars, opening the modal for that kid; a kid does not", async () => {
    stars.on = true;
    stars.earners = ['kid', 'sib'];
    const grownUp = await mountPage({ bean: 'kid' });
    await grownUp.get('[data-testid="chore-day-give-stars"]').trigger('click');
    expect(propsOf(grownUp, GiftStub)).toMatchObject({ open: true, memberId: 'kid' });
    family.currentMemberId = 'kid';
    const kid = await mountPage({ bean: 'kid' });
    expect(kid.find('[data-testid="chore-day-give-stars"]').exists()).toBe(false);
    // Nor on a grown-up's day.
    family.currentMemberId = 'mom';
    chores.list = [...chores.list, chore('m1', { assigneeIds: ['dad'], title: 'Mow' })];
    const dad = await mountPage({ bean: 'dad' });
    expect(dad.find('[data-testid="chore-day-give-stars"]').exists()).toBe(false);
  });

  it('ONE special reward drawer, owned by the page, opened by either view’s open-award intent', async () => {
    stars.on = true;
    const w = await mountPage();
    expect(w.findAllComponents(AwardStub)).toHaveLength(1);
    expect(propsOf(w, AwardStub)).toMatchObject({ open: false });
    await w.get('[data-testid="chore-home-views"] button:nth-child(3)').trigger('click');
    w.findComponent({ name: 'ChoreRewardsView' }).vm.$emit('open-award', null);
    await flushPromises();
    expect(propsOf(w, AwardStub)).toMatchObject({ open: true, award: null });
    w.findComponent(AwardStub).vm.$emit('close');
    await flushPromises();
    expect(propsOf(w, AwardStub).open).toBe(false);
    await w.get('[data-testid="chore-home-views"] button:nth-child(2)').trigger('click');
    const award = { id: 'a1', title: 'Zoo' };
    w.findComponent({ name: 'StarReportView' }).vm.$emit('open-award', award);
    await flushPromises();
    expect(propsOf(w, AwardStub)).toMatchObject({ open: true, award });
    expect(w.findAllComponents(AwardStub)).toHaveLength(1);
  });

  it('the switch reads Chores, Star Report, Rewards; Star Report only while the feature is on', async () => {
    const off = await mountPage();
    expect(off.findAll('[data-testid="chore-home-views"] button').map((b) => b.text())).toEqual([
      'choreStars.view.chores',
      'choreStars.view.rewards',
    ]);
    stars.on = true;
    const on = await mountPage();
    expect(on.findAll('[data-testid="chore-home-views"] button').map((b) => b.text())).toEqual([
      'choreStars.view.chores',
      'choreStars.view.report',
      'choreStars.view.rewards',
    ]);
  });

  it('?view=report opens Star Report once while on; off, it is stripped and logged', async () => {
    stars.on = true;
    const on = await mountPage({ view: 'report' });
    expect(on.find('[data-testid="star-report-view-stub"]').exists()).toBe(true);
    expect(guarded()).toEqual([]);
    stars.on = false;
    logEvent.mockReset();
    const off = await mountPage({ view: 'report' });
    expect(off.find('[data-testid="star-report-view-stub"]').exists()).toBe(false);
    expect(off.find('[data-testid="chore-card-grid"]').exists()).toBe(true);
    expect(routerFns.replace).toHaveBeenCalledWith({ query: {} });
    expect(guarded()).toContain('view-feature-off');
  });

  it("the report's Rewards Settings intent switches the page to the Rewards view", async () => {
    stars.on = true;
    const w = await mountPage({ view: 'report' });
    w.findComponent({ name: 'StarReportView' }).vm.$emit('open-rewards');
    await flushPromises();
    expect(w.find('[data-testid="star-report-view-stub"]').exists()).toBe(false);
    expect(w.find('[data-testid="chore-rewards-view-stub"]').exists()).toBe(true);
    expect(w.findComponent({ name: 'TogglePillGroup' }).props('modelValue')).toBe('rewards');
  });

  it('turning the feature off while the report shows falls back to Chores', async () => {
    stars.on = true;
    const w = await mountPage({ view: 'report' });
    expect(w.find('[data-testid="star-report-view-stub"]').exists()).toBe(true);
    stars.on = false;
    await flushPromises();
    expect(w.find('[data-testid="star-report-view-stub"]').exists()).toBe(false);
    expect(w.find('[data-testid="chore-card-grid"]').exists()).toBe(true);
  });

  it('a kid never reaches the report: ?view=report is ignored, stripped and logged', async () => {
    stars.on = true;
    family.currentMemberId = 'kid';
    const w = await mountPage({ view: 'report' });
    expect(w.find('[data-testid="star-report-view-stub"]').exists()).toBe(false);
    expect(w.find('[data-testid="chore-week-stepper"]').exists()).toBe(false);
    expect(guarded()).toContain('view-not-adult');
  });

  it("a kid's own day: today's and yesterday's notes under the head, as the store hands them", async () => {
    stars.on = true;
    stars.earners = ['kid'];
    const gift = (id: string, n: number, date: string, note?: string) => ({
      id,
      memberId: 'kid',
      date,
      stars: n,
      by: 'dad',
      note,
      createdAt: `${date}T09:00:00.000Z`,
      updatedAt: `${date}T09:00:00.000Z`,
    });
    stars.notes = {
      kid: [gift('g2', -1, '2026-11-13', 'Bike left out'), gift('g1', 2, '2026-11-12', 'Helped')],
    };
    family.currentMemberId = 'kid';
    const w = await mountPage({ bean: 'kid' });
    const notes = w.findAll('[data-testid="star-note"]');
    expect(notes.map((n) => n.attributes('data-kind'))).toEqual(['take', 'bonus']);
    expect(notes[0]!.text()).toContain('choreStars.takeBack.note.title.one');
    // Off: no notes.
    stars.on = false;
    await flushPromises();
    expect(w.find('[data-testid="chore-day-notes"]').exists()).toBe(false);
  });

  it("a grown-up's home: a kid's card carries the path strip; a grown-up's card does not; off, none", async () => {
    stars.on = true;
    stars.earners = ['kid', 'sib'];
    stars.strips = {
      kid: {
        week: { total: 9, full: 20, bar: 16 },
        path: {
          stepSize: 1,
          steps: 20,
          earned: 9,
          next: 1,
          thinFrom: 20,
          barAt: 15,
          awardAt: null,
          toBar: 7,
          reached: false,
          reachable: true,
        },
        nearest: null,
        thisWeek: null,
      },
    };
    chores.list = [...chores.list, chore('m1', { assigneeIds: ['dad'], title: 'Mow' })];
    const w = await mountPage();
    const card = (id: string) => w.get(`[data-testid="chore-bean-card"][data-member-id="${id}"]`);
    expect(card('kid').find('[data-testid="star-path-strip"]').exists()).toBe(true);
    expect(card('sib').find('[data-testid="chore-bean-strip"]').exists()).toBe(false);
    expect(card('dad').find('[data-testid="chore-bean-strip"]').exists()).toBe(false);
    stars.on = false;
    await flushPromises();
    expect(w.find('[data-testid="chore-bean-strip"]').exists()).toBe(false);
  });

  describe('looking back: the stepper on the Chores Done board', () => {
    const WEEKS = ['2026-11-09', '2026-11-02', '2026-10-26', '2026-10-19', '2026-10-12'];
    const board = (w: VueWrapper) => w.get('[data-testid="chore-week-panel"]');
    const boardDays = (w: VueWrapper) => [
      ...new Set(
        board(w)
          .findAll('[data-testid="chore-day-cell"]')
          .map((c) => c.attributes('data-ymd'))
      ),
    ];
    const stepBack = async (w: VueWrapper) => {
      await board(w).get('[aria-label="planner.prevPeriod"]').trigger('click');
      await flushPromises();
    };

    it('feature off: the stepper is on the board, over this week and the four before it', async () => {
      const w = await mountPage();
      const stepper = board(w).get('[data-testid="chore-week-stepper"]');
      expect(stepper.attributes('data-week')).toBe(WEEKS[0]);
      // Not in the page's controls row any more: it belongs to the board.
      expect(w.findAll('[data-testid="chore-week-stepper"]')).toHaveLength(1);
      for (let i = 0; i < 6; i++) await stepBack(w);
      expect(board(w).attributes('data-week')).toBe(WEEKS[4]);
      expect(
        board(w).get('[aria-label="planner.prevPeriod"]').attributes('disabled')
      ).toBeDefined();
    });

    it("feature on: the stars' frozen-aware weeks; with nothing to step back to, no stepper", async () => {
      stars.on = true;
      stars.lookback = ['2026-11-09'];
      const one = await mountPage();
      expect(one.find('[data-testid="chore-week-stepper"]').exists()).toBe(false);
      stars.lookback = WEEKS;
      const w = await mountPage();
      expect(board(w).find('[data-testid="chore-week-stepper"]').exists()).toBe(true);
    });

    it("stepped back: only the board changes; today's cards stay live and This Week stays this week", async () => {
      const w = await mountPage();
      const ticks = w.findAll('[data-testid="chore-tick"]').length;
      expect(ticks).toBeGreaterThan(0);
      const summaryBefore = w.get('[data-testid="chore-week-summary"]').html();
      await stepBack(w);
      expect(board(w).attributes('data-week')).toBe('2026-11-02');
      expect(board(w).attributes('data-looking-back')).toBe('true');
      expect(board(w).find('[data-testid="chore-lookback-notice"]').exists()).toBe(true);
      expect(boardDays(w)).toEqual([
        '2026-11-02',
        '2026-11-03',
        '2026-11-04',
        '2026-11-05',
        '2026-11-06',
        '2026-11-07',
        '2026-11-08',
      ]);
      // The cards are all still there and tickable; This Week is unchanged.
      expect(w.find('[data-testid="chore-card-grid"]').exists()).toBe(true);
      expect(w.findAll('[data-testid="chore-tick"]')).toHaveLength(ticks);
      expect(w.get('[data-testid="chore-week-summary"]').html()).toBe(summaryBefore);
      // A tick on a card still ticks today.
      await w.findAll('[data-testid="chore-tick"]')[0]!.trigger('click');
      expect(choreActions.toggleChore).toHaveBeenCalled();
      // The board has nothing to tick, and no day of the past week opens the bean's day.
      expect(board(w).find('[data-testid="chore-tick"]').exists()).toBe(false);
      // The URL never carries the week.
      expect(route.query.week).toBeUndefined();
      await board(w).findAll('[data-testid="calendar-today"]')[0]!.trigger('click');
      await flushPromises();
      expect(board(w).attributes('data-looking-back')).toBeUndefined();
      expect(board(w).attributes('data-week')).toBe(WEEKS[0]);
    });

    it('a past day on the board opens its read-only summary, with no Open Day action', async () => {
      // Chores that were already there that week, so its days had something due.
      chores.list = chores.list.map((c) => ({ ...c, createdAt: '2026-10-01T12:00:00.000Z' }));
      const w = await mountPage();
      await stepBack(w);
      const cell = board(w)
        .findAll('[data-testid="chore-day-cell"]')
        .find((c) => c.element.tagName === 'BUTTON');
      expect(cell).toBeDefined();
      await cell!.trigger('click');
      await flushPromises();
      const pop = document.body.querySelector('[data-testid="chore-day-popover"]');
      expect(pop?.textContent ?? '').toContain('choreboard.pop.readOnly');
      expect(document.body.querySelector('[data-testid="chore-day-popover-open-day"]')).toBeNull();
    });

    it('the Star Report gets the same weeks and the same week', async () => {
      stars.on = true;
      stars.lookback = WEEKS;
      const w = await mountPage();
      await stepBack(w);
      await w.get('[data-testid="chore-home-views"] button:nth-child(2)').trigger('click');
      const report = w.findComponent({ name: 'StarReportView' });
      expect(report.props()).toMatchObject({ weeks: WEEKS, week: '2026-11-02' });
      report.vm.$emit('update:week', '2026-10-26');
      await flushPromises();
      expect(report.props('week')).toBe('2026-10-26');
    });

    it('a kid never sees the stepper', async () => {
      family.currentMemberId = 'kid';
      const w = await mountPage();
      expect(w.find('[data-testid="chore-week-stepper"]').exists()).toBe(false);
    });
  });

  it("a kid's own day: the arc and the count, a value on every chore, nothing new to tap", async () => {
    stars.on = true;
    stars.earners = ['kid', 'sib'];
    stars.arcs = { kid: { percent: 69, count: 22 } };
    chores.list = chores.list.map((c) => (c.id === 'k1' ? { ...c, stars: 2 } : c));
    family.currentMemberId = 'kid';
    const w = await mountPage({ bean: 'kid' });
    const ring = w.get('[data-testid="chore-day-ring"]');
    expect(ring.attributes('data-percent')).toBe('69');
    expect(w.get('[data-testid="chore-day-stars"]').text()).toBe('22');
    expect(w.find('[data-testid="chore-day-badge"]').exists()).toBe(false);
    const values = w
      .findAll('[data-testid="chore-row"]')
      .map((r) => [r.attributes('data-chore-id'), r.find('[data-testid="star-count"]').text()]);
    expect(values).toEqual(
      expect.arrayContaining([
        ['k1', '2'],
        ['k2', '1'],
      ])
    );
    expect(w.find('[data-testid="chore-day-give-stars"]').exists()).toBe(false);
    expect(starActions.setRewards).not.toHaveBeenCalled();
  });

  it('achieved: the badge on the avatar', async () => {
    stars.on = true;
    stars.earners = ['kid'];
    stars.arcs = { kid: { percent: 100, count: 33, badgeEmoji: '🍦' } };
    family.currentMemberId = 'kid';
    const w = await mountPage({ bean: 'kid' });
    expect(w.get('[data-testid="chore-day-badge"]').text()).toBe('🍦');
    expect(w.get('[data-testid="chore-day-ring"]').attributes('data-percent')).toBe('100');
    // #154: the star on top of the ring, for the rest of the week.
    expect(w.find('[data-testid="star-ring-star"]').exists()).toBe(true);
  });

  it("a grown-up's day (no arc) draws the head as before, and no values", async () => {
    stars.on = true;
    stars.earners = ['kid'];
    chores.list = [...chores.list, chore('m1', { assigneeIds: ['dad'], title: 'Mow' })];
    const w = await mountPage({ bean: 'dad' });
    expect(w.find('[data-testid="chore-day-ring"]').exists()).toBe(false);
    expect(w.find('[data-testid="star-count"]').exists()).toBe(false);
  });

  it("the achieved moment: the banner under the kid's head while it is up, nothing to press", async () => {
    vi.useFakeTimers();
    try {
      resetChoreCelebrationForTest();
      stars.on = true;
      stars.earners = ['kid'];
      stars.arcs = { kid: { percent: 100, count: 33, badgeEmoji: '🍦' } };
      family.currentMemberId = 'kid';
      const w = await mountPage({ bean: 'kid' });
      expect(w.find('[data-testid="chore-day-reward-banner"]').exists()).toBe(false);
      await celebrateReward({
        memberId: 'kid',
        beanName: 'Pip',
        title: 'Ice cream',
        emoji: '🍦',
        stillClaimable: () => true,
        claim: async () => true,
      });
      await flushPromises();
      const banner = w.get('[data-testid="chore-day-reward-banner"]');
      expect(banner.text()).toContain('choreStars.banner.title');
      expect(banner.find('button').exists()).toBe(false);
      vi.runAllTimers();
      await flushPromises();
      expect(w.find('[data-testid="chore-day-reward-banner"]').exists()).toBe(false);
    } finally {
      resetChoreCelebrationForTest();
      vi.useRealTimers();
    }
  });
});
