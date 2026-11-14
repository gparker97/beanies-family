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
  chore,
  choreActions,
  chores,
  family,
  resetKit,
  route,
  routerFns,
} from '@/components/chores/__tests__/choreTestKit';

const modalStub = (name: string, props: string[]) =>
  defineComponent({ name, props, template: '<div />' });
const StarterStub = modalStub('ChoreAddSheet', ['open', 'presetKey', 'presetMemberIds', 'carried']);
const EditorStub = modalStub('ChoreBeanEditor', ['open', 'memberId']);

const stubs = {
  ChoreAddSheet: StarterStub,
  ChoreBeanEditor: EditorStub,
  ChoreCopyModal: modalStub('ChoreCopyModal', ['open', 'sourceMemberId']),
  ChoreHoursModal: modalStub('ChoreHoursModal', ['open']),
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
    // stacks (one column), 768px spans both columns for each, 1280px puts the board across
    // columns 1-2 and This Week in column 3.
    const css = repoFile('src/pages/ChoreboardPage.vue').replace(/\s+/g, ' ');
    expect(css).toContain('.chore-home-grid { grid-template-columns: minmax(0, 1fr); }');
    expect(css).toMatch(
      /@media \(width >= 48rem\) \{ .chore-home-grid \{ grid-template-columns: repeat\(2, [^}]*\} .*?\.chore-home-lower > \.chore-home-summary \{ grid-column: 1 \/ -1; \}/
    );
    expect(css).toMatch(
      /@media \(width >= 80rem\) \{ .chore-home-grid \{ grid-template-columns: repeat\(3, [^}]*\} \.chore-home-lower > \.chore-home-board \{ grid-column: 1 \/ span 2; \} \.chore-home-lower > \.chore-home-summary \{ grid-column: 3; \}/
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
