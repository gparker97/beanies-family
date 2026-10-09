import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import TodoItemRow from '../TodoItemRow.vue';
import LinkedCardChip from '../LinkedCardChip.vue';
import type { TodoItem, TodoRepeat } from '@/types/models';

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

function todo(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 't-1',
    title: 'Repaint the fence',
    completed: false,
    createdBy: 'm-1',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

const titleText = (w: ReturnType<typeof mount>) => w.find('p.font-outfit').text();
const hoverButton = (w: ReturnType<typeof mount>, titleSubstr: string) =>
  w.findAll('button').find((b) => b.attributes('title')?.includes(titleSubstr));

describe('TodoItemRow', () => {
  beforeEach(() => {
    setActivePinia(createPinia()); // useTranslation reaches into stores
  });

  it('renders an active row plainly (white, no Sky-Silk wash); the hover action parks it as Someday', () => {
    const wrapper = mount(TodoItemRow, { props: { todo: todo() } });

    expect(titleText(wrapper)).toBe('Repaint the fence'); // no 💭 prefix
    expect(wrapper.classes()).toContain('bg-white');
    expect(wrapper.classes()).not.toContain('bg-gradient-to-br'); // no Sky-Silk daydream wash

    const btn = hoverButton(wrapper, 'someday'); // "move to someday" (test runs in beanie/lowercase mode)
    expect(btn?.text()).toContain('💭');
    btn!.trigger('click');
    expect(wrapper.emitted('set-someday')).toEqual([['t-1', true]]);
  });

  it('renders a someday row with the calm Sky-Silk wash (💭 marker, no date pill, still active); the hover action reactivates it', () => {
    const wrapper = mount(TodoItemRow, { props: { todo: todo({ someday: true }) } });

    expect(titleText(wrapper)).toContain('💭'); // marker prefix on the title
    // muted Sky-Silk daydream gradient, not the greyed "disabled" look
    expect(wrapper.classes()).toContain('bg-gradient-to-br');
    expect(wrapper.classes()).toContain('from-[var(--tint-silk-10)]');
    expect(wrapper.classes()).not.toContain('bg-white');
    expect(wrapper.text()).not.toContain('No date set'); // someday rows drop the "no date" filler

    const btn = hoverButton(wrapper, 'active');
    expect(btn?.text()).toContain('📋');
    btn!.trigger('click');
    expect(wrapper.emitted('set-someday')).toEqual([['t-1', false]]);
  });

  describe('due-today row', () => {
    beforeEach(() => {
      // Pin "now" to 15:00 LOCAL so the overdue/due-today branch behaves
      // identically in any timezone (CI runs UTC; the previous UTC-fixed
      // instant only worked east of UTC).
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 4, 16, 15, 0, 0));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('renders the outlined-glow treatment (Heritage Orange border + halo) and a tinted "Today" pill', () => {
      const wrapper = mount(TodoItemRow, { props: { todo: todo({ dueDate: '2026-05-16' }) } });

      // Card: orange border + halo shadow, NOT the red overdue treatment and NOT the someday wash
      expect(wrapper.classes()).toContain('border-[var(--color-primary-500)]');
      expect(wrapper.classes()).toContain('shadow-[0_0_0_3px_rgba(241,93,34,0.12)]');
      expect(wrapper.classes()).toContain('bg-white');
      expect(wrapper.classes()).not.toContain('bg-red-50');
      expect(wrapper.classes()).not.toContain('bg-gradient-to-br');

      // Pill: tinted orange chip reading "Today" (beanie/lowercase in tests)
      expect(wrapper.text()).toContain('today');
      expect(wrapper.text()).not.toContain('overdue');
    });

    it('overdue takes precedence over due-today when dueTime is in the past', () => {
      const wrapper = mount(TodoItemRow, {
        props: { todo: todo({ dueDate: '2026-05-16', dueTime: '10:00' }) },
      });

      // Reads as overdue, NOT due-today
      expect(wrapper.classes()).toContain('bg-red-50');
      expect(wrapper.classes()).not.toContain('border-[var(--color-primary-500)]');
      expect(wrapper.classes()).not.toContain('shadow-[0_0_0_3px_rgba(241,93,34,0.12)]');
    });
  });

  describe('inside its own activity (#114)', () => {
    const linked = todo({ activityId: 'act-1', activityDate: '2026-05-16' });
    const mountRow = (props: Record<string, unknown>) =>
      mount(TodoItemRow, {
        props: { todo: linked, compact: true, ...props },
        global: { stubs: { LinkedActivityChip: true, EverySessionTag: true } },
      });

    it('shows the chip (with its session date) only outside the activity', () => {
      const outside = mountRow({});
      expect(outside.findComponent({ name: 'LinkedActivityChip' }).props()).toMatchObject({
        activityId: 'act-1',
        activityDate: '2026-05-16',
      });

      const inside = mountRow({ activityScope: 'session' });
      expect(inside.findComponent({ name: 'LinkedActivityChip' }).exists()).toBe(false);
      expect(inside.findComponent({ name: 'EverySessionTag' }).exists()).toBe(false);
    });

    it('tags a to-do linked to the whole activity with "Every Session"', () => {
      const w = mountRow({ activityScope: 'every-session' });
      expect(w.findComponent({ name: 'EverySessionTag' }).exists()).toBe(true);
      expect(w.findComponent({ name: 'LinkedActivityChip' }).exists()).toBe(false);
    });

    it('draws a done to-do ticked and struck through, without its due date', () => {
      const w = mountRow({
        todo: todo({ completed: true, dueDate: '2020-01-01' }),
        activityScope: 'session',
      });
      const box = w.find('button');
      expect(box.attributes('aria-pressed')).toBe('true');
      expect(box.text()).toBe('✓');
      expect(titleText(w)).toBe('Repaint the fence');
      expect(w.find('p.font-outfit').classes()).toContain('line-through');
      expect(w.text()).not.toContain('overdue');
      expect(w.text()).not.toContain('📅');
      box.trigger('click');
      expect(w.emitted('toggle')).toEqual([['t-1']]);
    });
  });

  describe('repeating and card-made to-dos (#123)', () => {
    // 2026-10-07 is a Wednesday.
    const repeat: TodoRepeat = {
      rule: { unit: 'week', interval: 1, weekdays: [3], end: { kind: 'never' } },
      anchor: '2026-10-07',
    };
    const repeating = (o: Partial<TodoItem> = {}) =>
      todo({ repeat, dueDate: '2026-10-14', dueTime: '20:00', repeatLog: [], ...o });
    const badge = (w: ReturnType<typeof mount>) => w.find('[data-testid="todo-repeat-badge"]');
    const deleteButton = (w: ReturnType<typeof mount>) =>
      w.findAll('button').find((b) => b.text().includes('🗑️'));

    it('shows the ↻ cadence badge with its time, in the full and the compact row', () => {
      const full = mount(TodoItemRow, { props: { todo: repeating() } });
      expect(badge(full).text()).toContain('↻');
      expect(badge(full).text()).toMatch(/weekly on wed at 8pm/i);

      const compact = mount(TodoItemRow, { props: { todo: repeating(), compact: true } });
      expect(badge(compact).exists()).toBe(true);
    });

    it('shows no badge on a plain to-do', () => {
      const w = mount(TodoItemRow, { props: { todo: todo({ dueDate: '2026-10-14' }) } });
      expect(badge(w).exists()).toBe(false);
      expect(w.findComponent(LinkedCardChip).exists()).toBe(false);
    });

    it('a repeating to-do offers no someday action (it would clear the date) but can be deleted', () => {
      const w = mount(TodoItemRow, { props: { todo: repeating() } });
      expect(hoverButton(w, 'someday')).toBeUndefined();
      expect(deleteButton(w)).toBeDefined();
    });

    it('a card-made to-do hides delete and someday, and links its card (with the part)', () => {
      const w = mount(TodoItemRow, {
        props: { todo: repeating({ cardId: 'school-drop', cardPartKey: 'm-leo' }) },
      });
      expect(deleteButton(w)).toBeUndefined();
      expect(hoverButton(w, 'someday')).toBeUndefined();
      expect(w.findComponent(LinkedCardChip).props()).toMatchObject({
        cardId: 'school-drop',
        partKey: 'm-leo',
        variant: 'chip',
      });
    });
  });
});
