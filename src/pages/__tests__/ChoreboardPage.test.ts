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
 *  - ticking goes through the page's guarded tick path with `surface: 'app'`.
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
const quickAdd = vi.hoisted(() => ({ handler: null as null | ((a: string) => void) }));
vi.mock('@/composables/useQuickAddIntent', () => ({
  useQuickAddIntent: (h: (a: string) => void) => {
    quickAdd.handler = h;
  },
}));

import ChoreboardPage from '../ChoreboardPage.vue';
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

beforeEach(() => {
  resetKit();
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
    // But can tick their own chores.
    expect(w.findAll('[data-testid="chore-tick"]').length).toBeGreaterThan(0);
  });

  it('ticks through the page’s guarded path with surface app', async () => {
    const w = await mountPage({ bean: 'kid' });
    await w.get('[data-chore-id="k1"] [data-testid="chore-tick"]').trigger('click');
    await flushPromises();
    expect(choreActions.toggleChore).toHaveBeenCalledWith('k1', 'kid', { surface: 'app' });
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
    expect(cards.map((c) => c.attributes('data-member-id'))).toEqual(['kid', 'sib', 'mom', 'dad']);
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

  it('a card’s Edit Chores opens that bean’s chore list; "+" (no chores yet) opens it empty', async () => {
    const w = await mountPage();
    await w.get('[data-member-id="kid"] [data-testid="chore-bean-edit"]').trigger('click');
    expect(propsOf(w, EditorStub)).toMatchObject({ open: true, memberId: 'kid' });
    expect(propsOf(w, StarterStub).open).toBe(false);
    expect(routerFns.push).not.toHaveBeenCalled();
    // Mama Bean has no chores: her card's one affordance is "+".
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
    await w.get('[data-testid="chore-day-edit"]').trigger('click');
    expect(propsOf(w, EditorStub)).toMatchObject({ open: true, memberId: 'sib' });
    expect(propsOf(w, StarterStub).open).toBe(false);
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
