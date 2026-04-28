import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive, ref } from 'vue';
import MobileBottomNav from '@/components/common/MobileBottomNav.vue';

const mockRoute = reactive({ path: '/nook' });
const mockPush = vi.fn(() => Promise.resolve());

vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const canViewFinances = ref(true);
vi.mock('@/composables/usePermissions', () => ({
  usePermissions: () => ({ canViewFinances }),
  FINANCE_ROUTES: [
    '/dashboard',
    '/accounts',
    '/budgets',
    '/transactions',
    '/goals',
    '/assets',
    '/reports',
    '/forecast',
  ],
}));

vi.mock('@/composables/useReducedMotion', () => ({
  useReducedMotion: () => ({ prefersReducedMotion: { value: false } }),
}));

// Stub the bean stack to keep the parent-component tests focused on the
// state machine and tab rendering. The stack itself has its own test file.
vi.mock('@/components/common/MobileNavBeanStack.vue', () => ({
  default: {
    name: 'MobileNavBeanStack',
    props: ['getAnchor', 'category', 'isOpen'],
    emits: ['close', 'navigate'],
    template:
      '<div data-testid="bean-stack-stub" :data-category="category.id" :data-open="isOpen"></div>',
  },
}));

describe('MobileBottomNav v3', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockRoute.path = '/nook';
    canViewFinances.value = true;
  });

  it('renders 4 category tabs', () => {
    const wrapper = mount(MobileBottomNav);
    const buttons = wrapper.findAll('nav > button');
    expect(buttons).toHaveLength(4);
  });

  it('hides Money tab when finance permissions are off (3 tabs)', () => {
    canViewFinances.value = false;
    const wrapper = mount(MobileBottomNav);
    const buttons = wrapper.findAll('nav > button');
    expect(buttons).toHaveLength(3);
    expect(wrapper.text()).not.toContain('mobile.money');
  });

  it('renders all 4 tab labels with correct order', () => {
    const wrapper = mount(MobileBottomNav);
    const text = wrapper.text();
    expect(text.indexOf('mobile.nook')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('mobile.planning')).toBeGreaterThan(text.indexOf('mobile.nook'));
    expect(text.indexOf('mobile.money')).toBeGreaterThan(text.indexOf('mobile.planning'));
    expect(text.indexOf('mobile.pod')).toBeGreaterThan(text.indexOf('mobile.money'));
  });

  it('Nook tap → router.push(/nook), no stack opens', async () => {
    const wrapper = mount(MobileBottomNav);
    await wrapper.findAll('nav > button')[0]!.trigger('click');
    expect(mockPush).toHaveBeenCalledWith('/nook');
    expect(wrapper.find('[data-testid=bean-stack-stub]').exists()).toBe(false);
  });

  it('Planning tap → opens stack with category=planning', async () => {
    const wrapper = mount(MobileBottomNav);
    await wrapper.findAll('nav > button')[1]!.trigger('click');
    const stub = wrapper.find('[data-testid=bean-stack-stub]');
    expect(stub.exists()).toBe(true);
    expect(stub.attributes('data-category')).toBe('planning');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('same-tab tap toggles stack closed', async () => {
    const wrapper = mount(MobileBottomNav);
    const planningTab = wrapper.findAll('nav > button')[1]!;
    await planningTab.trigger('click');
    expect(wrapper.find('[data-testid=bean-stack-stub]').exists()).toBe(true);

    await planningTab.trigger('click');
    expect(wrapper.find('[data-testid=bean-stack-stub]').exists()).toBe(false);
  });

  it('different-tab tap swaps category (stack stays mounted)', async () => {
    const wrapper = mount(MobileBottomNav);
    const buttons = wrapper.findAll('nav > button');
    await buttons[1]!.trigger('click'); // Planning
    expect(wrapper.find('[data-testid=bean-stack-stub]').attributes('data-category')).toBe(
      'planning'
    );

    await buttons[2]!.trigger('click'); // Money
    const stub = wrapper.find('[data-testid=bean-stack-stub]');
    expect(stub.exists()).toBe(true);
    expect(stub.attributes('data-category')).toBe('money');
  });

  it('Nook tap while stack open closes stack and navigates', async () => {
    const wrapper = mount(MobileBottomNav);
    const buttons = wrapper.findAll('nav > button');
    await buttons[1]!.trigger('click'); // open Planning
    expect(wrapper.find('[data-testid=bean-stack-stub]').exists()).toBe(true);

    await buttons[0]!.trigger('click'); // tap Nook
    expect(wrapper.find('[data-testid=bean-stack-stub]').exists()).toBe(false);
    expect(mockPush).toHaveBeenCalledWith('/nook');
  });

  it('bean navigate event closes stack and routes', async () => {
    const wrapper = mount(MobileBottomNav);
    await wrapper.findAll('nav > button')[1]!.trigger('click');
    const stub = wrapper.findComponent({ name: 'MobileNavBeanStack' });
    stub.vm.$emit('navigate', '/activities');
    await wrapper.vm.$nextTick();
    expect(mockPush).toHaveBeenCalledWith('/activities');
    expect(wrapper.find('[data-testid=bean-stack-stub]').exists()).toBe(false);
  });

  it('stack close event closes the stack', async () => {
    const wrapper = mount(MobileBottomNav);
    await wrapper.findAll('nav > button')[1]!.trigger('click');
    const stub = wrapper.findComponent({ name: 'MobileNavBeanStack' });
    stub.vm.$emit('close');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid=bean-stack-stub]').exists()).toBe(false);
  });

  it('route change closes the stack', async () => {
    const wrapper = mount(MobileBottomNav);
    await wrapper.findAll('nav > button')[1]!.trigger('click');
    expect(wrapper.find('[data-testid=bean-stack-stub]').exists()).toBe(true);

    mockRoute.path = '/activities';
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid=bean-stack-stub]').exists()).toBe(false);
  });

  it('canViewFinances flipping false while Money open closes stack', async () => {
    const wrapper = mount(MobileBottomNav);
    const buttons = wrapper.findAll('nav > button');
    await buttons[2]!.trigger('click'); // Money
    expect(wrapper.find('[data-testid=bean-stack-stub]').attributes('data-category')).toBe('money');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    canViewFinances.value = false;
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-testid=bean-stack-stub]').exists()).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      '[MobileBottomNav] finance permissions revoked; closing Money stack'
    );
    warnSpy.mockRestore();
  });

  it('highlights category for nested route', () => {
    mockRoute.path = '/pod/cookbook';
    const wrapper = mount(MobileBottomNav);
    const buttons = wrapper.findAll('nav > button');
    // Pod is the 4th tab (index 3)
    const podPill = buttons[3]!.find('div.relative');
    expect(podPill.classes()).toContain('bg-[rgba(241,93,34,0.08)]');
  });

  it('highlights Money tab for /accounts', () => {
    mockRoute.path = '/accounts';
    const wrapper = mount(MobileBottomNav);
    const buttons = wrapper.findAll('nav > button');
    const moneyPill = buttons[2]!.find('div.relative');
    expect(moneyPill.classes()).toContain('bg-[rgba(241,93,34,0.08)]');
  });

  it('renders ARIA attributes on category tabs', async () => {
    const wrapper = mount(MobileBottomNav);
    const buttons = wrapper.findAll('nav > button');

    // Nook is a leaf, no aria-haspopup or aria-controls.
    expect(buttons[0]!.attributes('aria-haspopup')).toBeUndefined();
    expect(buttons[0]!.attributes('aria-expanded')).toBeUndefined();

    // Planning has aria-haspopup="menu", aria-expanded="false"
    expect(buttons[1]!.attributes('aria-haspopup')).toBe('menu');
    expect(buttons[1]!.attributes('aria-expanded')).toBe('false');
    expect(buttons[1]!.attributes('aria-controls')).toBe('mobile-nav-stack-planning');

    // Open it; aria-expanded flips
    await buttons[1]!.trigger('click');
    expect(buttons[1]!.attributes('aria-expanded')).toBe('true');
  });

  it('renders the active dot on stackable tabs only', () => {
    const wrapper = mount(MobileBottomNav);
    const buttons = wrapper.findAll('nav > button');
    // Nook has no dot
    expect(buttons[0]!.find('span.rounded-full').exists()).toBe(false);
    // Planning, Money, Pod have dots
    expect(buttons[1]!.find('span.rounded-full').exists()).toBe(true);
    expect(buttons[2]!.find('span.rounded-full').exists()).toBe(true);
    expect(buttons[3]!.find('span.rounded-full').exists()).toBe(true);
  });
});
