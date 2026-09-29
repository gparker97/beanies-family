import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import LinkedActivityChip from '../LinkedActivityChip.vue';
import TodoItemRow from '../TodoItemRow.vue';
import { useActivityStore } from '@/stores/activityStore';
import type { FamilyActivity, TodoItem } from '@/types/models';

const push = vi.hoisted(() => vi.fn());
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

function seedActivity(overrides: Partial<FamilyActivity> = {}): void {
  useActivityStore().activities.push({
    id: 'act-1',
    title: 'Year 3 field trip',
    date: '2026-10-13',
    category: 'school',
    isActive: true,
    createdBy: 'm-1',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  } as FamilyActivity);
}

describe('LinkedActivityChip', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    push.mockClear();
  });

  it('renders nothing when the activity no longer resolves (soft reference)', () => {
    const wrapper = mount(LinkedActivityChip, { props: { activityId: 'gone' } });
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('shows the title and date, and opens the activity deep link', async () => {
    seedActivity();
    const wrapper = mount(LinkedActivityChip, { props: { activityId: 'act-1' } });

    expect(wrapper.text()).toContain('Year 3 field trip');
    expect(wrapper.text()).toContain('13 Oct');
    await wrapper.find('button').trigger('click');
    expect(push).toHaveBeenCalledWith({ path: '/activities', query: { activity: 'act-1' } });
    expect(wrapper.emitted('open')).toEqual([['act-1']]);
  });

  describe('session links (#114)', () => {
    function seedSeries(): void {
      seedActivity({
        id: 'series-1',
        title: 'Soccer practice',
        date: '2026-10-03',
        recurrence: 'weekly',
        daysOfWeek: [6],
      } as Partial<FamilyActivity>);
    }

    it('labels the chip with the session date and opens that session', async () => {
      seedSeries();
      const wrapper = mount(LinkedActivityChip, {
        props: { activityId: 'series-1', activityDate: '2026-10-10' },
      });
      expect(wrapper.text()).toContain('10 Oct');
      await wrapper.find('button').trigger('click');
      expect(push).toHaveBeenCalledWith({
        path: '/activities',
        query: { date: '2026-10-10', activity: 'series-1' },
      });
    });

    it('opens the edited session when that session was edited', async () => {
      seedSeries();
      seedActivity({
        id: 'child-1',
        title: 'Soccer practice (moved)',
        date: '2026-10-11',
        parentActivityId: 'series-1',
        originalOccurrenceDate: '2026-10-10',
      });
      const wrapper = mount(LinkedActivityChip, {
        props: { activityId: 'series-1', activityDate: '2026-10-10' },
      });
      await wrapper.find('button').trigger('click');
      expect(push).toHaveBeenCalledWith({
        path: '/activities',
        query: { date: '2026-10-11', activity: 'child-1' },
      });
    });

    it('renders nothing when that session was cancelled', () => {
      seedSeries();
      seedActivity({
        id: 'child-2',
        date: '2026-10-10',
        parentActivityId: 'series-1',
        isActive: false,
      });
      const wrapper = mount(LinkedActivityChip, {
        props: { activityId: 'series-1', activityDate: '2026-10-10' },
      });
      expect(wrapper.find('button').exists()).toBe(false);
    });
  });

  it('row variant shows the start time', () => {
    seedActivity({ startTime: '08:30' });
    const wrapper = mount(LinkedActivityChip, { props: { activityId: 'act-1', variant: 'row' } });
    expect(wrapper.text()).toContain('8:30am');
  });

  it('inside a to-do row, a tap opens the activity but not the row', async () => {
    seedActivity();
    const todo: TodoItem = {
      id: 't-1',
      title: 'Sign the permission slip',
      completed: false,
      activityId: 'act-1',
      createdBy: 'm-1',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    };
    const wrapper = mount(TodoItemRow, { props: { todo } });

    const chip = wrapper.findComponent(LinkedActivityChip);
    expect(chip.exists()).toBe(true);
    await chip.find('button').trigger('click');
    expect(push).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('view')).toBeUndefined();
  });
});
