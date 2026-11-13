/**
 * ListDetailModal (#147): who a list is for and when it shows.
 *   - the people pill names every assignee and opens the multi picker;
 *   - a pick that would leave nobody (empty, or only members the roster no longer knows) keeps
 *     the current people, writes nothing and shows the inline hint; a real pick goes through
 *     `listStore.setAssignees`, never a raw `updateList({ ownerId })`;
 *   - a one-off list puts its due date beside `ShowRuleField kind="list"` and writes the rule
 *     through `listStore.setShowRule`; the meta band carries the "Shows ..." pill while waiting;
 *   - a repeating list gets a Show row from its reset day, and Days Before adds the wall note;
 *   - Keep Parents Posted is gated on every assignee being a child.
 */
import { mount } from '@vue/test-utils';
import { reactive } from 'vue';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FamilyList, FamilyMember } from '@/types/models';

const member = (id: string, name: string, ageGroup: 'adult' | 'child' = 'adult') =>
  ({
    id,
    name,
    color: '#2C3E50',
    isPet: false,
    ageGroup,
    role: 'admin',
  }) as unknown as FamilyMember;

const roster = [
  member('m-dad', 'Greg'),
  member('m-mom', 'Jill'),
  member('m-kid', 'Pip', 'child'),
  member('m-kid2', 'Juno', 'child'),
];

const listStore = reactive({
  lists: [] as FamilyList[],
  setAssignees: vi.fn(async () => null),
  setShowRule: vi.fn(async () => null),
  updateList: vi.fn(async () => null),
  setLifecycle: vi.fn(),
  setNotifyParents: vi.fn(),
});
vi.mock('@/stores/listStore', () => ({ useListStore: () => listStore }));
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({ members: roster, currentMember: roster[0], sortedHumans: roster }),
}));
vi.mock('@/stores/vacationStore', () => ({
  useVacationStore: () => ({ upcomingVacations: [], vacations: [] }),
}));
vi.mock('@/stores/activityStore', () => ({
  useActivityStore: () => ({ linkableActivities: [], activities: [] }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock('@/composables/useToday', async () => {
  const { ref } = await import('vue');
  return { useToday: () => ({ today: ref('2026-11-13') }) };
});
vi.mock('@/composables/useMemberInfo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/composables/useMemberInfo')>()),
  useMemberInfo: () => ({ getMemberById: (id: string) => roster.find((m) => m.id === id) }),
}));
vi.mock('@/composables/useListCategoryLabel', () => ({
  useListCategoryLabel: () => ({ categoryLabel: (id: string) => `cat:${id}` }),
}));
vi.mock('@/composables/useRecurrenceLabel', () => ({
  useRecurrenceLabel: () => ({ describe: () => 'every saturday' }),
}));
vi.mock('@/composables/useListDeletion', () => ({ confirmAndDeleteList: vi.fn() }));

import ListDetailModal from '../ListDetailModal.vue';

const stubs = {
  BeanieFormModal: { template: '<div><slot name="title-content" /><slot /></div>' },
  draggable: true,
  ListItemRow: true,
  ListCategoryPills: true,
  BaseInput: true,
  TogglePillGroup: true,
  RecurrencePicker: true,
  BeanieDatePicker: { name: 'BeanieDatePicker', props: ['modelValue'], template: '<input />' },
  ActivityOwnerStack: {
    props: ['members'],
    template: '<span data-testid="stack">{{ members.map((m) => m.id).join(",") }}</span>',
  },
  FamilyChipPicker: {
    name: 'FamilyChipPicker',
    props: ['modelValue', 'mode'],
    template: '<div data-testid="picker" />',
  },
  ShowRuleField: {
    name: 'ShowRuleField',
    props: ['modelValue', 'repeating', 'dueDate', 'cadence', 'kind'],
    template: '<div data-testid="show-field"><slot name="due" /></div>',
  },
  NotifyParentsToggle: { template: '<div data-testid="notify-parents" />' },
};

function makeList(overrides: Partial<FamilyList> = {}): FamilyList {
  return {
    id: 'l-1',
    title: 'Beach week packing',
    emoji: '🧳',
    category: 'trips',
    ownerId: 'm-mom',
    assigneeIds: ['m-mom', 'm-dad'],
    items: [],
    lifecycle: 'oneoff',
    completed: false,
    createdBy: 'm-dad',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  } as FamilyList;
}

function open(list: FamilyList) {
  listStore.lists = [list];
  return mount(ListDetailModal, { props: { listId: list.id }, global: { stubs } });
}

beforeEach(() => vi.clearAllMocks());

describe('ListDetailModal: people', () => {
  it('names every assignee in the pill and opens the multi picker with them', async () => {
    const w = open(makeList());
    const pill = w.get('[data-testid="list-people-pill"]');
    expect(pill.text()).toContain('Jill & Greg');
    expect(w.get('[data-testid="stack"]').text()).toBe('m-mom,m-dad');
    await pill.trigger('click');
    const picker = w.getComponent({ name: 'FamilyChipPicker' });
    expect(picker.props('mode')).toBe('multi');
    expect(picker.props('modelValue')).toEqual(['m-mom', 'm-dad']);
  });

  it('refuses a pick that leaves nobody, with the inline hint and no write', async () => {
    const w = open(makeList());
    await w.get('[data-testid="list-people-pill"]').trigger('click');
    const picker = w.getComponent({ name: 'FamilyChipPicker' });
    await picker.vm.$emit('update:modelValue', []);
    expect(w.get('[data-testid="list-people-hint"]').text()).toBe('lists.people.keepOne');
    // Only a member the roster no longer knows is as empty as nobody.
    await picker.vm.$emit('update:modelValue', ['m-gone']);
    expect(listStore.setAssignees).not.toHaveBeenCalled();
    expect(listStore.updateList).not.toHaveBeenCalled();
  });

  it('writes a real pick through setAssignees and clears the hint', async () => {
    const w = open(makeList());
    await w.get('[data-testid="list-people-pill"]').trigger('click');
    const picker = w.getComponent({ name: 'FamilyChipPicker' });
    await picker.vm.$emit('update:modelValue', []);
    await picker.vm.$emit('update:modelValue', ['m-mom', 'm-dad', 'm-kid']);
    expect(listStore.setAssignees).toHaveBeenCalledWith('l-1', ['m-mom', 'm-dad', 'm-kid']);
    expect(w.find('[data-testid="list-people-hint"]').exists()).toBe(false);
    expect(listStore.updateList).not.toHaveBeenCalled();
  });
});

describe('ListDetailModal: when it shows', () => {
  it("a one-off puts its due date beside Show From and starts on the list's default", () => {
    const w = open(makeList({ dueDate: '2026-12-11' }));
    const field = w.getComponent({ name: 'ShowRuleField' });
    expect(field.props('kind')).toBe('list');
    expect(field.props('repeating')).toBe(false);
    expect(field.props('dueDate')).toBe('2026-12-11');
    expect(field.props('modelValue')).toEqual({ kind: 'due' });
    // The due date control rides in the field's `due` slot.
    expect(field.findComponent({ name: 'BeanieDatePicker' }).props('modelValue')).toBe(
      '2026-12-11'
    );
    expect(w.get('[data-testid="list-show-pill"]').text()).toContain('todo.show.tag.due');
  });

  it('writes a show rule through setShowRule', async () => {
    const w = open(makeList({ dueDate: '2026-12-11' }));
    await w
      .getComponent({ name: 'ShowRuleField' })
      .vm.$emit('update:modelValue', { kind: 'from', date: '2026-12-04' });
    expect(listStore.setShowRule).toHaveBeenCalledWith('l-1', { kind: 'from', date: '2026-12-04' });
  });

  it('shows no Shows pill once the list is showing', () => {
    const w = open(makeList({ dueDate: '2026-12-11', showOn: 'now' }));
    expect(w.find('[data-testid="list-show-pill"]').exists()).toBe(false);
  });

  it('a repeating list gets a Show row from its reset day; Days Before adds the wall note', () => {
    const weekly = makeList({
      lifecycle: 'recurring',
      cadence: { unit: 'week', interval: 1, weekdays: [6] },
      lastResetDate: '2026-11-07',
    });
    const w = open(weekly);
    const field = w.getComponent({ name: 'ShowRuleField' });
    expect(field.props('repeating')).toBe(true);
    expect(field.props('dueDate')).toBe('2026-11-14');
    expect(field.props('cadence')).toMatchObject({ unit: 'week', interval: 1 });
    expect(w.find('[data-testid="list-show-lead-wall"]').exists()).toBe(false);

    const early = open({ ...weekly, showLeadDays: 2 });
    expect(early.getComponent({ name: 'ShowRuleField' }).props('modelValue')).toEqual({
      kind: 'lead',
      days: 2,
    });
    expect(early.get('[data-testid="list-show-lead-wall"]').text()).toBe(
      'lists.show.leadNotOnWall'
    );
  });
});

describe('ListDetailModal: Keep Parents Posted', () => {
  const weekly = {
    lifecycle: 'recurring' as const,
    cadence: { unit: 'week' as const, interval: 1, weekdays: [6] },
    lastResetDate: '2026-11-07',
  };

  it('offers the toggle when every assignee is a child', () => {
    const w = open(makeList({ ...weekly, ownerId: 'm-kid', assigneeIds: ['m-kid', 'm-kid2'] }));
    expect(w.find('[data-testid="notify-parents"]').exists()).toBe(true);
  });

  it('hides it when an adult is among the assignees', () => {
    const w = open(makeList({ ...weekly, ownerId: 'm-kid', assigneeIds: ['m-kid', 'm-dad'] }));
    expect(w.find('[data-testid="notify-parents"]').exists()).toBe(false);
  });
});
