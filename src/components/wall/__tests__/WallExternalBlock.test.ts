/**
 * A timed view-only event on the wall grid (plan 2026-11-17, C4): the shared stripes,
 * no owner bar, the title or "Busy", the time when there is room, the source calendar,
 * an accessible name that carries all three, and a tap that only asks to open.
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import WallExternalBlock from '../WallExternalBlock.vue';
import { externalEvent } from '@/test/monthCellFixtures';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function mountBlock(over: Record<string, unknown> = {}) {
  return mount(WallExternalBlock, {
    props: {
      event: externalEvent('Bridge club', { color: '#1a7f8e' }),
      width: 300,
      height: 120,
      timeRange: '15:00–16:00',
      ...over,
    },
  });
}

describe('WallExternalBlock', () => {
  it('is a button on the shared stripes in its calendar color, with no owner bar', () => {
    const root = mountBlock().get('[data-testid="wall-external-block"]');
    expect(root.element.tagName).toBe('BUTTON');
    expect(root.classes()).toContain('view-only-stripes');
    expect(root.attributes('style')).toContain('--vo-hue: #1a7f8e');
    expect(root.classes().some((c) => c.startsWith('border-l'))).toBe(false);
  });

  it('shows the title, the time and the source when the block is tall enough', () => {
    const w = mountBlock();
    expect(w.get('[data-testid="wall-external-title"]').text()).toBe('Bridge club');
    expect(w.get('[data-testid="wall-external-time"]').text()).toBe('15:00–16:00');
    expect(w.get('[data-testid="external-source-label"]').text()).toContain("Grandma's calendar");
  });

  it('sizes its text with the wall type scale, like WallTimeBlock', () => {
    const w = mountBlock();
    expect(w.get('[data-testid="wall-external-title"]').classes()).toContain('wall-block-title');
    expect(w.get('[data-testid="wall-external-time"]').classes()).toContain('wall-block-meta');
    expect(w.get('[data-testid="external-source-label"]').classes()).toContain('wall-block-meta');
  });

  it('drops the time first, then the source, as the block gets shorter', () => {
    const short = mountBlock({ height: 50 });
    expect(short.find('[data-testid="wall-external-time"]').exists()).toBe(false);
    expect(short.find('[data-testid="external-source-label"]').exists()).toBe(true);
    const shorter = mountBlock({ height: 34 });
    expect(shorter.find('[data-testid="external-source-label"]').exists()).toBe(false);
    expect(shorter.get('[data-testid="wall-external-title"]').text()).toBe('Bridge club');
  });

  it('reads "Busy" for a busy-only event', () => {
    const w = mountBlock({ event: externalEvent('x', { title: undefined, busyOnly: true }) });
    expect(w.get('[data-testid="wall-external-title"]').text()).toBe('calendarView.event.busy');
  });

  it('a sliver keeps only the hollow dot, and the accessible name keeps everything', () => {
    const w = mountBlock({ width: 60 });
    expect(w.find('[data-testid="wall-external-title"]').exists()).toBe(false);
    expect(w.find('.view-only-dot').exists()).toBe(true);
    // The real template is "{title}, {time}, view only, {calendar}"; the mock t returns keys.
    expect(w.get('button').attributes('aria-label')).toBe('calendarView.event.spokenTimed');
  });

  it('emits open on a tap', async () => {
    const w = mountBlock();
    await w.get('button').trigger('click');
    expect(w.emitted('open')).toHaveLength(1);
  });
});
