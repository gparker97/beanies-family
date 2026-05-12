import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import HolidayChip from '../HolidayChip.vue';
import type { HolidayOccurrence } from '@/types/models';

const holiday: HolidayOccurrence = { date: '2026-05-31', name: 'Vesak Day', countryCode: 'SG' };

describe('HolidayChip', () => {
  it('renders "<name> (<country code>)" in an italic clay-coloured chip (no flag emoji)', () => {
    const wrapper = mount(HolidayChip, { props: { holiday, isStart: true, isEnd: true } });
    expect(wrapper.text()).toContain('Vesak Day (SG)');
    expect(wrapper.attributes('data-testid')).toBe('holiday-chip');
    expect(wrapper.classes()).toContain('italic');
    // Border/text use the holiday clay CSS var (passed through AllDayChip's style binding).
    expect(wrapper.attributes('style') ?? '').toContain('--holiday-clay');
  });

  it('hides the name on a multi-day middle cell', () => {
    const wrapper = mount(HolidayChip, { props: { holiday, isStart: false, isEnd: false } });
    expect(wrapper.text()).not.toContain('Vesak Day');
  });

  it('emits click', async () => {
    const wrapper = mount(HolidayChip, { props: { holiday, isStart: true, isEnd: true } });
    await wrapper.trigger('click');
    expect(wrapper.emitted('click')).toHaveLength(1);
  });
});
