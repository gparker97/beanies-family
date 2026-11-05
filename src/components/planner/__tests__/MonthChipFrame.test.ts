/**
 * `MonthChipFrame` (#141): one anatomy per density, read from the month chip context.
 * Tests provide the context as a ref, or nothing to get the comfortable default.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import MonthChipFrame from '../MonthChipFrame.vue';
import { DEFAULT_CELL_CHIPS, MONTH_CELL_CHIPS, type MonthCellChips } from '../monthCellChipsKey';
import { member } from '@/test/monthCellFixtures';

vi.mock('@/composables/useMemberAvatar', () => ({
  useMemberAvatarBindings: () => ({
    memberAvatarBindings: (m: { name: string }) => ({ ariaLabel: m.name, initials: m.name[0] }),
  }),
}));

const BASE = {
  color: '#6AA84F',
  wash: 'rgba(106, 168, 79, 0.15)',
  label: 'Soccer',
  emoji: '⚽',
  time: '4pm',
  spokenLabel: 'Aria, Soccer, 4pm',
  testid: 'frame',
  faces: [member('a', 'Aria'), member('b', 'Bo'), member('c', 'Cy')],
};

function factory(
  ctx: Partial<MonthCellChips> | null,
  props: Record<string, unknown> = {},
  attrs: Record<string, unknown> = {}
) {
  return mount(MonthChipFrame, {
    props: { ...BASE, ...props },
    attrs,
    slots: { default: '<i data-testid="slot-default" />', decor: '<i data-testid="slot-decor" />' },
    global: ctx
      ? { provide: { [MONTH_CELL_CHIPS as symbol]: ref({ ...DEFAULT_CELL_CHIPS, ...ctx }) } }
      : {},
  });
}

const faceCount = (w: ReturnType<typeof factory>) =>
  w.findAllComponents({ name: 'BeanieAvatar' }).length;

describe('MonthChipFrame anatomy per density', () => {
  it('compact: emoji, label, time, slots and at most two faces plus +N', () => {
    const w = factory({ density: 'compact' });
    expect(w.classes()).toContain('border-l-[3px]');
    expect(w.text()).toContain('⚽');
    expect(w.text()).toContain('Soccer');
    expect(w.text()).toContain('4pm');
    expect(w.find('[data-testid="slot-default"]').exists()).toBe(true);
    expect(w.find('[data-testid="slot-decor"]').exists()).toBe(true);
    expect(faceCount(w)).toBe(2);
    expect(w.text()).toContain('+1');
  });

  it('compact: the time shows only when the context says showTime', () => {
    expect(factory({ density: 'compact', showTime: false }).text()).not.toContain('4pm');
  });

  it('comfortable: the established chip, with the dense one-face stack', () => {
    const w = factory({ density: 'comfortable' });
    expect(w.classes()).toContain('py-0.5');
    expect(w.text()).toContain('Soccer');
    expect(faceCount(w)).toBe(1);
    expect(w.text()).toContain('+2');
  });

  it('comfortable: the time is shown only where the context asks (popover, day row)', () => {
    expect(factory({ density: 'comfortable', showTime: true }).text()).toContain('4pm');
    expect(factory({ density: 'comfortable', showTime: false }).text()).not.toContain('4pm');
  });

  it('titles: the label only, with no emoji, time, faces or slots', () => {
    const w = factory({ density: 'titles' });
    expect(w.classes()).toContain('border-l-2');
    expect(w.text()).toBe('Soccer');
    expect(faceCount(w)).toBe(0);
    expect(w.find('[data-testid="slot-default"]').exists()).toBe(false);
    expect(w.find('[data-testid="slot-decor"]').exists()).toBe(false);
  });

  it('bars: a plain colour bar with no children', () => {
    const w = factory({ density: 'bars' });
    expect(w.classes()).toContain('rounded-full');
    expect(w.element.children).toHaveLength(0);
    expect(w.text()).toBe('');
    expect(w.attributes('style')).toContain('background');
    expect(w.attributes('style')?.toLowerCase()).toContain('#6aa84f');
  });

  it('with no provider it renders the comfortable default', () => {
    const w = factory(null, { time: '4pm' });
    expect(w.element.tagName).toBe('BUTTON');
    expect(w.classes()).toContain('py-0.5');
    expect(w.text()).toContain('4pm'); // DEFAULT_CELL_CHIPS.showTime is true
    expect(faceCount(w)).toBe(1);
  });
});

describe('MonthChipFrame states', () => {
  it('draws the wash and the edge hue by default', () => {
    const style = factory({ density: 'compact' }).attributes('style')?.toLowerCase() ?? '';
    expect(style).toContain('border-left-color: #6aa84f');
    expect(style).toContain('background');
  });

  it('celebrating adds is-celebration on a rich density only', () => {
    expect(factory({ density: 'compact' }, { celebrating: true }).classes()).toContain(
      'is-celebration'
    );
    expect(factory({ density: 'titles' }, { celebrating: true }).classes()).not.toContain(
      'is-celebration'
    );
  });

  it('dashed gives a dashed edge', () => {
    expect(factory({ density: 'compact' }, { dashed: true }).classes()).toContain('border-dashed');
  });

  it('interactive: a button with the spoken label, which emits click and stops it bubbling', async () => {
    const parent = vi.fn();
    const w = mount(
      {
        components: { MonthChipFrame },
        setup: () => ({ BASE, parent }),
        template: '<div @click="parent"><MonthChipFrame v-bind="BASE" /></div>',
      },
      { global: {} }
    );
    const btn = w.get('[data-testid="frame"]');
    expect(btn.element.tagName).toBe('BUTTON');
    expect(btn.attributes('type')).toBe('button');
    expect(btn.attributes('aria-label')).toBe('Aria, Soccer, 4pm');
    await btn.trigger('click');
    expect(parent).not.toHaveBeenCalled();
    expect(w.findComponent(MonthChipFrame).emitted('click')).toHaveLength(1);
  });

  it('interactive: false renders an aria-hidden span that keeps its fallthrough data attributes', async () => {
    const w = factory(
      { density: 'compact', interactive: false },
      {},
      { 'data-activity-id': 'a-1', 'data-occurrence-date': '2026-05-19' }
    );
    expect(w.element.tagName).toBe('SPAN');
    expect(w.attributes('aria-hidden')).toBe('true');
    expect(w.attributes('aria-label')).toBeUndefined();
    expect(w.attributes('type')).toBeUndefined();
    expect(w.attributes('data-activity-id')).toBe('a-1');
    expect(w.attributes('data-occurrence-date')).toBe('2026-05-19');
    expect(w.attributes('data-testid')).toBe('frame');
    await w.trigger('click');
    expect(w.emitted('click')).toBeUndefined();
  });

  it('solo with hideSoloFace drops the faces; shared chips keep them', () => {
    const ctx = { density: 'compact', hideSoloFace: true } as const;
    expect(faceCount(factory(ctx, { solo: true, faces: [member('a', 'Aria')] }))).toBe(0);
    expect(faceCount(factory(ctx, { solo: false }))).toBe(2);
    expect(faceCount(factory({ density: 'compact', hideSoloFace: false }, { solo: true }))).toBe(2);
  });
});
