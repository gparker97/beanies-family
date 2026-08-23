import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ListTile from '../ListTile.vue';
import type { FamilyList } from '@/types/models';

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
    await wrapper.trigger('click');
    expect(wrapper.emitted('open')?.[0]).toEqual(['l-1']);
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
