import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import CreatedMeta from '../CreatedMeta.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => (key === 'common.createdBy' ? 'Created by' : key) }),
}));

vi.mock('@/composables/useMemberInfo', () => ({
  useMemberInfo: () => ({
    getMemberName: (id?: string | null) => (id === 'm1' ? 'Greg' : 'Unknown'),
  }),
}));

describe('CreatedMeta', () => {
  it('renders the creator name and the formatted created timestamp', () => {
    const iso = new Date(2026, 3, 21, 8, 30).toISOString(); // 21 Apr 2026, 08:30 local
    const wrapper = mount(CreatedMeta, { props: { createdBy: 'm1', createdAt: iso } });
    expect(wrapper.text()).toContain('Created by Greg');
    expect(wrapper.text()).toContain('21 Apr 2026 at 8:30am');
  });

  it('renders nothing when given neither createdBy nor createdAt', () => {
    const wrapper = mount(CreatedMeta, { props: {} });
    expect(wrapper.find('div').exists()).toBe(false);
    expect(wrapper.text()).toBe('');
  });

  it('shows only the timestamp when there is no creator', () => {
    const iso = new Date(2026, 0, 5, 15, 0).toISOString(); // 5 Jan 2026, 15:00 local
    const wrapper = mount(CreatedMeta, { props: { createdAt: iso } });
    expect(wrapper.text()).toContain('5 Jan 2026 at 3pm');
    expect(wrapper.text()).not.toContain('Created by');
  });
});
