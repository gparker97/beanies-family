/**
 * `ExternalTimedBlock` (plan 2026-11-17, C2): a timed view-only event on a planner grid.
 * Placed like `PlannerTimedBlock`, but never an activity: no resize handle, no drag
 * source, and its click never reaches the hour slot underneath (click-to-add).
 */
import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import ExternalTimedBlock from '../ExternalTimedBlock.vue';
import { externalEvent } from '@/test/monthCellFixtures';
import { UI_STRINGS } from '@/services/translation/uiStrings';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => (UI_STRINGS as Record<string, string>)[k] ?? k }),
}));

const getPosition = vi.fn((start: string, end?: string) => ({
  top: `${start}`,
  height: `${end ?? ''}`,
}));

function factory(over: Record<string, unknown> = {}) {
  return mount(ExternalTimedBlock, {
    props: {
      event: externalEvent('Babysitting', { start: '15:00', end: '17:00', color: '#3b82f6' }),
      startTime: '15:00',
      endTime: '17:00',
      laneIndex: 1,
      laneCount: 2,
      getPosition,
      ...over,
    },
  });
}

describe('ExternalTimedBlock', () => {
  it('takes its position from the grid and its lane, and paints only through the utility', () => {
    const w = factory();
    expect(getPosition).toHaveBeenCalledWith('15:00', '17:00');
    const style = w.attributes('style') ?? '';
    expect(style).toContain('left: 50%');
    expect(style).toContain('width: calc(50% - 2px)');
    expect(style).toContain('--vo-hue: #3b82f6');
    expect(style).not.toContain('background');
    expect(w.classes()).toContain('view-only-stripes');
    expect(w.classes().some((c) => c.startsWith('border-l'))).toBe(false);
  });

  it('shows the title, the time and the source calendar', () => {
    const text = factory().text();
    expect(text).toContain('Babysitting');
    expect(text).toContain('3pm-5pm');
    expect(text).toContain("Grandma's calendar");
  });

  it('reads "Busy" for a busy-only event', () => {
    const w = factory({ event: externalEvent('x', { busyOnly: true, title: undefined }) });
    expect(w.text()).toContain('Busy');
    expect(w.attributes('aria-label')).toContain('Busy, 3pm-5pm, view only');
  });

  it('is a button with no resize handle, no drag source and no activity hooks', () => {
    const w = factory();
    expect(w.element.tagName).toBe('BUTTON');
    expect(w.findComponent({ name: 'PlannerResizeHandle' }).exists()).toBe(false);
    expect(w.attributes('data-activity-id')).toBeUndefined();
    expect(w.attributes('draggable')).toBeUndefined();
  });

  it('a click opens the details and never reaches the hour slot underneath', async () => {
    const event = externalEvent('Babysitting');
    const addActivity = vi.fn();
    // The hour slot's click-to-add, standing in as an ancestor listener: the block stops
    // the click, so the slot never sees it.
    const w = mount(
      {
        components: { ExternalTimedBlock },
        props: ['event'],
        emits: ['open'],
        template: `<div data-testid="slot" @click="addActivity"><ExternalTimedBlock :event="event" start-time="15:00" end-time="16:00" :lane-index="0" :lane-count="1" :get-position="pos" @open="(e) => $emit('open', e)" /></div>`,
        methods: { addActivity, pos: () => ({ top: '0rem', height: '1rem' }) },
      },
      { props: { event } }
    );
    await w.find('[data-testid="external-timed-block"]').trigger('click');
    expect(w.emitted('open')?.[0]).toEqual([event]);
    expect(addActivity).not.toHaveBeenCalled();
  });

  it('a tail drawn to midnight reads "...-12am"', () => {
    const w = factory({ startTime: '22:00', endTime: '24:00' });
    expect(w.text()).toContain('10pm-12am');
  });
});
