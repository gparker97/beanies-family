import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import MedicationDayHeader from '../MedicationDayHeader.vue';
import type { DailyDoseStatus } from '@/utils/doseLimit';

// Echo realistic strings so the component's `.replace('{token}', …)`
// interpolation is exercised end-to-end.
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'medicationLog.dose': 'dose',
        'medicationLog.doses': 'doses',
        'medicationLog.overNote': '{over} more than the recommended {limit} a day.',
      };
      return map[key] ?? key;
    },
  }),
}));

const within: DailyDoseStatus = { limit: 3, isOver: false, over: 0 };
const over: DailyDoseStatus = { limit: 3, isOver: true, over: 1 };

describe('MedicationDayHeader', () => {
  it('shows a pluralized count and no over-note when within the limit', () => {
    const wrapper = mount(MedicationDayHeader, {
      props: { label: 'Yesterday', count: 3, status: within },
    });
    expect(wrapper.text()).toContain('Yesterday');
    expect(wrapper.text()).toContain('3 doses');
    expect(wrapper.text()).not.toContain('more than the recommended');
    expect(wrapper.text()).not.toContain('⚠');
  });

  it('uses the singular noun for a count of 1', () => {
    const wrapper = mount(MedicationDayHeader, {
      props: { label: 'Mon, 21 Apr', count: 1, status: within },
    });
    expect(wrapper.text()).toContain('1 dose');
    expect(wrapper.text()).not.toContain('1 doses');
  });

  it('flags an over-limit day with the warning marker + interpolated over-note', () => {
    const wrapper = mount(MedicationDayHeader, {
      props: { label: 'Today', count: 4, status: over },
    });
    expect(wrapper.text()).toContain('4 doses');
    expect(wrapper.text()).toContain('⚠');
    expect(wrapper.text()).toContain('1 more than the recommended 3 a day.');
  });
});
