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

  it('renders 5 navigation tabs', () => {
    const wrapper = mount(MobileBottomNav);
    const buttons = wrapper.findAll('button');
    expect(buttons).toHaveLength(5);
  });

  it('highlights active tab based on current route', () => {
    mockRoute.path = '/nook';
    const wrapper = mount(MobileBottomNav);
    const buttons = wrapper.findAll('button');

    // First tab (nook) should have active pill background
    const firstPill = buttons[0]!.find('div');
    expect(firstPill.classes()).toContain('bg-[rgba(241,93,34,0.08)]');

    // First tab label should have active text color
    const firstLabel = buttons[0]!.find('span.font-outfit');
    expect(firstLabel.classes()).toContain('text-primary-500');

    // Second tab label should have inactive text color
    const secondLabel = buttons[1]!.find('span.font-outfit');
    expect(secondLabel.classes()).toContain('text-secondary-500/40');
  });

  it('navigates on tab click', async () => {
    const wrapper = mount(MobileBottomNav);
    const buttons = wrapper.findAll('button');

    await buttons[1]!.trigger('click');
    expect(mockPush).toHaveBeenCalledWith('/planner');
  });

  it('renders tab labels', () => {
    const wrapper = mount(MobileBottomNav);
    expect(wrapper.text()).toContain('mobile.nook');
    expect(wrapper.text()).toContain('mobile.planner');
    expect(wrapper.text()).toContain('mobile.piggyBank');
    expect(wrapper.text()).toContain('mobile.budget');
    expect(wrapper.text()).toContain('mobile.pod');
  });

  it('highlights tab for nested routes', () => {
    mockRoute.path = '/dashboard/accounts';
    const wrapper = mount(MobileBottomNav);
    const buttons = wrapper.findAll('button');

    // Third tab (Piggy Bank → /dashboard) should be active for /dashboard/accounts
    const piggyPill = buttons[2]!.find('div');
    expect(piggyPill.classes()).toContain('bg-[rgba(241,93,34,0.08)]');
  });
});
