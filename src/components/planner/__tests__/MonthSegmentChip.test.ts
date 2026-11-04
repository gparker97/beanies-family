import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import MonthSegmentChip from '../MonthSegmentChip.vue';
import { segment } from '@/test/monthCellFixtures';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

beforeEach(() => setActivePinia(createPinia()));

const mountIt = (over = {}) =>
  mount(MonthSegmentChip, { props: { occurrence: segment('s1', over) } });

describe('MonthSegmentChip', () => {
  it('is the frame with the kind-prefixed label, time and spoken label', () => {
    const w = mountIt({ title: 'SQ 322', time: '09:00' });
    const chip = w.get('[data-testid="month-segment-chip"]');
    expect(chip.text()).toContain('planner.segmentDepartureShort SQ 322');
    expect(chip.text()).toContain('9am');
    expect(chip.attributes('aria-label')).toBe('planner.segmentDeparture: SQ 322');
    expect(chip.attributes('style')).toContain('border-left-color: var(--vacation-teal)');
  });

  it('a booked segment takes the 15% teal wash and a solid edge', () => {
    const chip = mountIt({ status: 'booked' }).get('[data-testid="month-segment-chip"]');
    expect(chip.attributes('style')).toContain('var(--vacation-teal-15)');
    expect(chip.classes()).not.toContain('border-dashed');
  });

  it('a pending segment takes the teal tint wash and a dashed edge', () => {
    const chip = mountIt({ status: 'pending' }).get('[data-testid="month-segment-chip"]');
    expect(chip.attributes('style')).toContain('var(--vacation-teal-tint)');
    expect(chip.classes()).toContain('border-dashed');
  });

  it('click emits [vacationId, segmentIndex]', async () => {
    const w = mountIt({ vacationId: 'v9', segmentIndex: 3 });
    await w.get('[data-testid="month-segment-chip"]').trigger('click');
    expect(w.emitted('click')).toEqual([['v9', 3]]);
  });
});
