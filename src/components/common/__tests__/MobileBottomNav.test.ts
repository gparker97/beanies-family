import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import MobileBottomNav from '@/components/common/MobileBottomNav.vue';

// Mock vue-router
const mockRoute = { path: '/nook' };
const mockPush = vi.fn();

vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('MobileBottomNav', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockRoute.path = '/nook';
  });

  it('renders 4 navigation tabs', () => {
    const wrapper = mount(MobileBottomNav);
    const buttons = wrapper.findAll('button');
    expect(buttons).toHaveLength(4);
  });

  it('highlights active tab based on current route', () => {
    mockRoute.path = '/nook';
    const wrapper = mount(MobileBottomNav);
    const buttons = wrapper.findAll('button');

    // First tab (dashboard) should have active color
    expect(buttons[0]!.classes()).toContain('text-primary-500');
    // Other tabs should not
    expect(buttons[1]!.classes()).toContain('text-gray-400');
  });

  it('navigates on tab click', async () => {
    const wrapper = mount(MobileBottomNav);
    const buttons = wrapper.findAll('button');

    await buttons[1]!.trigger('click');
    expect(mockPush).toHaveBeenCalledWith('/accounts');
  });

  it('renders tab labels', () => {
    const wrapper = mount(MobileBottomNav);
    expect(wrapper.text()).toContain('mobile.nook');
    expect(wrapper.text()).toContain('nav.accounts');
    expect(wrapper.text()).toContain('nav.goals');
    expect(wrapper.text()).toContain('mobile.pod');
  });
});
