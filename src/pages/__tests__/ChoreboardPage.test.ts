/**
 * The choreboard page's §8 guards (#146) and its two views:
 *  - a non-adult always sees their OWN day (`?bean=` is forced to their id), with no grown-up
 *    controls; their day with no chores has its own empty state;
 *  - a grown-up's unknown or pet `?bean=` falls back to home and is stripped;
 *  - `?starter=<set>&for=<ids>` opens Add Chores preselected for grown-ups only: `starter`
 *    must be a known key, `for` is filtered to living people (no pets), and both are stripped
 *    after reading (ignored and stripped for a non-adult);
 *  - every add (header, empty state, a bean's "+", a bean's day, Quick Add) opens the ONE Add
 *    Chores sheet; the form is the edit screen;
 *  - a bean's day lists chores on other weekdays for a grown-up, and Select deletes several in
 *    one confirm and one store call;
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
const confirmFn = vi.hoisted(() => vi.fn());
vi.mock('@/composables/useConfirm', () => ({ confirm: confirmFn }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/composables/useToast', () => ({ showToast: toast }));
const quickAdd = vi.hoisted(() => ({ handler: null as null | ((a: string) => void) }));
vi.mock('@/composables/useQuickAddIntent', () => ({
  useQuickAddIntent: (h: (a: string) => void) => {
    quickAdd.handler = h;
  },
}));

import ChoreboardPage from '../ChoreboardPage.vue';
import ChoreBlockSection from '@/components/chores/ChoreBlockSection.vue';
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
const FormStub = modalStub('ChoreFormModal', ['open', 'choreId', 'beanId']);

const stubs = {
  ChoreAddSheet: StarterStub,
  ChoreFormModal: FormStub,
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
  'chore-day-add',
  'chore-day-copy',
  'chore-day-select',
  'chore-day-other-days',
  'chore-bean-add',
  'chore-bean-copy',
  'chore-bean-edit',
  'chore-edit',
  'chore-row-edit',
  'chore-empty-starters',
  'chore-drag-handle',
];

beforeEach(() => {
  resetKit();
  logEvent.mockReset();
  confirmFn.mockReset();
  toast.mockReset();
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
    expect(propsOf(w, FormStub).open).toBe(false);
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
    expect(propsOf(w, FormStub).open).toBe(false);
    expect(w.find('[data-testid="chore-week-panel"]').exists()).toBe(true);
  });

  it('a bean’s "+" opens Add Chores for that bean only; Edit Chores opens their day', async () => {
    const w = await mountPage();
    await w.get('[data-member-id="sib"] [data-testid="chore-bean-add"]').trigger('click');
    expect(propsOf(w, StarterStub)).toMatchObject({
      open: true,
      presetMemberIds: ['sib'],
      presetKey: null,
    });
    expect(propsOf(w, FormStub).open).toBe(false);
    await w.get('[data-member-id="kid"] [data-testid="chore-bean-edit"]').trigger('click');
    expect(routerFns.push).toHaveBeenCalledWith({ query: { bean: 'kid' } });
  });

  it('a pencil on a home card opens the edit form for that chore and bean', async () => {
    const w = await mountPage();
    await w.get('[data-chore-id="k1"] [data-testid="chore-row-edit"]').trigger('click');
    expect(propsOf(w, FormStub)).toMatchObject({ open: true, choreId: 'k1', beanId: 'kid' });
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

  it('a living ?bean= opens that bean’s day, with back, add and copy', async () => {
    const w = await mountPage({ bean: 'sib' });
    expect(routerFns.replace).not.toHaveBeenCalled();
    expect(w.get('[data-testid="chore-day-head"]').attributes('data-member-id')).toBe('sib');
    expect(w.find('[data-testid="chore-day-back"]').exists()).toBe(true);
    expect(w.find('[data-testid="chore-day-add"]').exists()).toBe(true);
    expect(w.find('[data-testid="chore-day-copy"]').exists()).toBe(true);
    expect(w.find('[data-testid="chore-week-row"]').exists()).toBe(true);
    await w.get('[data-testid="chore-day-add"]').trigger('click');
    expect(propsOf(w, StarterStub)).toMatchObject({ open: true, presetMemberIds: ['sib'] });
  });

  it('on a bean’s day, a dragged block reorders through the store and reports whether it landed', async () => {
    const w = await mountPage({ bean: 'kid' });
    const section = w.findComponent(ChoreBlockSection);
    expect(section.props('reorderable')).toBe(true);
    const reorder = section.props('reorder') as (ids: string[]) => Promise<boolean>;
    choreActions.reorderChores.mockResolvedValueOnce(true);
    await expect(reorder(['k2', 'k1'])).resolves.toBe(true);
    expect(choreActions.reorderChores).toHaveBeenCalledWith(['k2', 'k1'], 'mom');
    choreActions.reorderChores.mockResolvedValueOnce(null);
    await expect(reorder(['k2', 'k1'])).resolves.toBe(false);
  });

  it('a bean’s day lists chores on other weekdays, editable, with no tick', async () => {
    chores.list = [...chores.list, chore('sat', { assigneeIds: ['kid'], days: [6] })];
    const w = await mountPage({ bean: 'kid' });
    const other = w.get('[data-testid="chore-day-other-days"]');
    expect(
      other.findAll('[data-testid="chore-row"]').map((r) => r.attributes('data-chore-id'))
    ).toEqual(['sat']);
    expect(other.find('[data-testid="chore-tick"]').exists()).toBe(false);
    await other.get('[data-testid="chore-row-edit"]').trigger('click');
    expect(propsOf(w, FormStub)).toMatchObject({ open: true, choreId: 'sat', beanId: 'kid' });
  });

  it('Select: pick rows (Other Days too), Select All, one confirm, one store call', async () => {
    chores.list = [...chores.list, chore('sat', { assigneeIds: ['kid'], days: [6] })];
    const w = await mountPage({ bean: 'kid' });
    await w.get('[data-testid="chore-day-select"]').trigger('click');
    // Every row is selectable, collapsed blocks included; no ticks while selecting.
    expect(w.findAll('[data-testid="chore-row-select"]')).toHaveLength(3);
    expect(w.find('[data-testid="chore-tick"]').exists()).toBe(false);
    const del = w.get('[data-testid="chore-day-delete-selected"]');
    expect(del.attributes('disabled')).toBeDefined();

    await w.get('[data-chore-id="sat"] [data-testid="chore-row-select"]').trigger('click');
    expect(del.text()).toContain('choreboard.day.deleteSelected.one');
    await w.get('[data-testid="chore-day-select-all"]').trigger('click');
    expect(
      w.findAll('[data-testid="chore-row-select"]').map((b) => b.attributes('aria-checked'))
    ).toEqual(['true', 'true', 'true']);

    confirmFn.mockResolvedValueOnce(false);
    await del.trigger('click');
    await flushPromises();
    expect(confirmFn).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' }));
    expect(choreActions.removeChoresForMember).not.toHaveBeenCalled();

    confirmFn.mockResolvedValueOnce(true);
    choreActions.removeChoresForMember.mockResolvedValueOnce({ deleted: 3, unassigned: 0 });
    await del.trigger('click');
    await flushPromises();
    expect(choreActions.removeChoresForMember).toHaveBeenCalledTimes(1);
    const [ids, bean, actor] = choreActions.removeChoresForMember.mock.calls[0]!;
    expect([...ids].sort()).toEqual(['k1', 'k2', 'sat']);
    expect(bean).toBe('kid');
    expect(actor).toBe('mom');
    expect(toast).toHaveBeenCalledWith('success', 'choreboard.day.deleted.other');
    // Back out of select mode.
    expect(w.find('[data-testid="chore-day-select-bar"]').exists()).toBe(false);
  });

  it('Select: a refused or failed delete stays in select mode; Cancel leaves it', async () => {
    const w = await mountPage({ bean: 'kid' });
    await w.get('[data-testid="chore-day-select"]').trigger('click');
    await w.get('[data-chore-id="k1"] [data-testid="chore-row-select"]').trigger('click');
    confirmFn.mockResolvedValueOnce(true);
    choreActions.removeChoresForMember.mockResolvedValueOnce(null);
    await w.get('[data-testid="chore-day-delete-selected"]').trigger('click');
    await flushPromises();
    expect(toast).not.toHaveBeenCalled();
    expect(w.find('[data-testid="chore-day-select-bar"]').exists()).toBe(true);
    await w.get('[data-testid="chore-day-select-cancel"]').trigger('click');
    expect(w.find('[data-testid="chore-day-select-bar"]').exists()).toBe(false);
    expect(w.findAll('[data-testid="chore-tick"]').length).toBeGreaterThan(0);
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

  it('the quick-add intent opens Add Chores (for the bean whose day is showing)', async () => {
    const w = await mountPage({ bean: 'sib' });
    quickAdd.handler?.('add-chore');
    await flushPromises();
    expect(propsOf(w, StarterStub)).toMatchObject({ open: true, presetMemberIds: ['sib'] });
    expect(propsOf(w, FormStub).open).toBe(false);
  });

  it('an empty family shows the empty state with one way to start: Add Chores', async () => {
    chores.list = [];
    const w = await mountPage();
    expect(w.find('[data-testid="chore-home-empty"]').exists()).toBe(true);
    expect(w.find('[data-testid="chore-empty-add"]').exists()).toBe(false);
    await w.get('[data-testid="chore-empty-starters"]').trigger('click');
    expect(propsOf(w, StarterStub).open).toBe(true);
  });

  it('chores with nobody left show under "No one\'s", editable', async () => {
    chores.list = [...chores.list, chore('o1', { assigneeIds: ['gone'], title: 'Orphan' })];
    const w = await mountPage();
    const orphans = w.get('[data-testid="chore-orphans"]');
    expect(orphans.text()).toContain('Orphan');
    expect(orphans.find('[data-testid="chore-tick"]').exists()).toBe(false);
    await orphans.get('[data-testid="chore-edit"]').trigger('click');
    expect(propsOf(w, FormStub).choreId).toBe('o1');
  });
});
