import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ListTile from '../ListTile.vue';
import { useFamilyStore } from '@/stores/familyStore';
import type { FamilyList, FamilyMember } from '@/types/models';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (k: string) => (k === 'lists.progress' ? '{done}/{total}' : k),
  }),
}));
vi.mock('@/composables/useListCategoryLabel', () => ({
  useListCategoryLabel: () => ({ categoryLabel: (id: string) => `cat:${id}` }),
}));
vi.mock('@/composables/useToday', () => ({
  useToday: () => ({ today: { value: '2026-06-17' } }),
}));
vi.mock('@/composables/useMemberInfo', () => ({
  useMemberInfo: () => ({
    getMemberById: (id: string) => ({ id, name: 'Greg', color: '#2C3E50', isPet: false }),
  }),
}));

function list(overrides: Partial<FamilyList> = {}): FamilyList {
  return {
    id: 'l-1',
    title: 'Field-trip pack',
    emoji: '🎒',
    category: 'kids',
    ownerId: 'm-1',
    items: [
      { id: 'a', title: 'x', completed: true },
      { id: 'b', title: 'y', completed: true },
      { id: 'c', title: 'z', completed: false },
    ],
    lifecycle: 'oneoff',
    completed: false,
    createdBy: 'm-1',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => (document.body.innerHTML = ''));

describe('ListTile', () => {
  it('renders title, category label, and progress; emits open on click', async () => {
    const wrapper = mount(ListTile, { props: { list: list() } });
    expect(wrapper.text()).toContain('Field-trip pack');
    expect(wrapper.text()).toContain('cat:kids');
    expect(wrapper.text()).toContain('2/3'); // 2 of 3 items done
    // The root is an <article> now, not a <button> — a button root could not legally
    // contain the copy/delete buttons. The stretched overlay is the open affordance.
    await wrapper.get('[data-testid="list-tile-open"]').trigger('click');
    expect(wrapper.emitted('open')?.[0]).toEqual(['l-1']);
  });

  it('emits copy and delete from the tile actions without opening the list', async () => {
    const wrapper = mount(ListTile, { props: { list: list() } });
    const buttons = wrapper.findAll('button');
    // [copy, delete, open-overlay] — the overlay is last in the DOM on purpose.
    await buttons[0].trigger('click');
    await buttons[1].trigger('click');

    expect(wrapper.emitted('copy')?.[0]).toEqual(['l-1']);
    expect(wrapper.emitted('delete')?.[0]).toEqual(['l-1']);
    // The whole point of `@click.stop`: an action must never also open the drawer.
    expect(wrapper.emitted('open')).toBeUndefined();
  });

  it('gives the open overlay an inset focus ring, which the clipped root would hide', () => {
    // `ring-inset` is load-bearing: the root is `overflow-hidden`, so an outward ring
    // on an `inset-0` child is clipped to nothing and the primary action loses its
    // only focus indicator.
    const wrapper = mount(ListTile, { props: { list: list() } });
    const cls = wrapper.get('[data-testid="list-tile-open"]').classes();
    expect(cls).toContain('focus-visible:ring-inset');
    expect(cls).toContain('focus-visible:ring-2');
  });

  it('shows a recurring status pill describing the reset cadence', () => {
    // #70: was the bare legacy word (`lists.detail.freq.weekly`). It now renders
    // the canonical summary, so a cadence the legacy enum cannot express reads
    // correctly instead of collapsing to the nearest word.
    const wrapper = mount(ListTile, {
      props: { list: list({ lifecycle: 'recurring', frequency: 'weekly' }) },
    });
    expect(wrapper.text()).toContain('recurrence.desc.weeklyOn');
  });

  it('describes an every-2-weeks reset as such, not as "weekly"', () => {
    const wrapper = mount(ListTile, {
      props: {
        list: list({
          lifecycle: 'recurring',
          // No legacy `frequency` — the enum cannot express this cadence, and
          // `listShadowFromCadence` deliberately omits it.
          cadence: { unit: 'week', interval: 2, weekdays: [1] },
        }),
      },
    });
    expect(wrapper.text()).toContain('recurrence.desc.everyNWeeksOn');
  });

  it('shows a link pill when the list is attached to a trip', () => {
    const wrapper = mount(ListTile, { props: { list: list({ linkedVacationId: 'v-1' }) } });
    expect(wrapper.text()).toContain('lists.status.linked');
  });

  it('shows an overdue pill for a past-due one-off list', () => {
    const wrapper = mount(ListTile, { props: { list: list({ dueDate: '2026-06-10' }) } });
    expect(wrapper.text()).toContain('lists.status.overdue');
  });
});

describe('ListTile: people and when it shows (#147)', () => {
  const member = (id: string, name: string) =>
    ({ id, name, color: '#2C3E50', isPet: false }) as unknown as FamilyMember;

  it('stacks every assignee and names them all in the open label', () => {
    useFamilyStore().members = [member('m-1', 'Greg'), member('m-2', 'Jill')];
    const wrapper = mount(ListTile, {
      props: { list: list({ assigneeIds: ['m-1', 'm-2'] }) },
    });
    expect(wrapper.get('[data-testid="list-tile-people"]').attributes('aria-label')).toBe(
      'Greg, Jill'
    );
    expect(wrapper.get('[data-testid="list-tile-open"]').attributes('aria-label')).toBe(
      'lists.tile.openFor'
    );
  });

  it('reads a drifted pair owner first: everyone when the owner is listed, else the owner alone', () => {
    useFamilyStore().members = [member('m-1', 'Greg'), member('m-2', 'Jill'), member('m-3', 'Sam')];
    const people = (ownerId: string) =>
      mount(ListTile, { props: { list: list({ ownerId, assigneeIds: ['m-1', 'm-2'] }) } })
        .get('[data-testid="list-tile-people"]')
        .attributes('aria-label');
    expect(people('m-2')).toBe('Jill, Greg');
    expect(people('m-3')).toBe('Sam');
  });

  it('tags a dated list that is not showing yet, and only then', () => {
    const tag = '[data-testid="list-tile-show-tag"]';
    // A list's default: it shows on its due date, so a future one waits.
    expect(
      mount(ListTile, { props: { list: list({ dueDate: '2026-06-25' }) } })
        .get(tag)
        .text()
    ).toContain('todo.show.tag.due');
    expect(
      mount(ListTile, {
        props: { list: list({ dueDate: '2026-06-25', showFrom: '2026-06-20' }) },
      })
        .get(tag)
        .text()
    ).toContain('todo.show.tag.from');
    // Shows right away, due today, or undated: nothing to tag.
    expect(
      mount(ListTile, { props: { list: list({ dueDate: '2026-06-25', showOn: 'now' }) } })
        .find(tag)
        .exists()
    ).toBe(false);
    expect(
      mount(ListTile, { props: { list: list({ dueDate: '2026-06-17' }) } })
        .find(tag)
        .exists()
    ).toBe(false);
    expect(
      mount(ListTile, { props: { list: list() } })
        .find(tag)
        .exists()
    ).toBe(false);
  });
});
