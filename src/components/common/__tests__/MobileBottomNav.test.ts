import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive, ref, computed } from 'vue';
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

// Mock the nav-badges composable directly. The composable's own tests
// cover its derivation logic; these tests only verify that the tab
// renders the attention dot when categoryAttention is true.
const mockCategoryAttention = reactive<Record<string, boolean>>({
  nook: false,
  planning: false,
  calendar: false,
  money: false,
  pod: false,
});
vi.mock('@/composables/useNavBadges', () => ({
  useNavBadges: () => ({
    badges: computed(() => ({})),
    badgeFor: () => null,
    categoryAttention: computed(() => mockCategoryAttention),
  }),
  ATTENTION_DOT: { kind: 'dot', severity: 'attention', active: true },
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
    mockCategoryAttention.nook = false;
    mockCategoryAttention.planning = false;
    mockCategoryAttention.calendar = false;
    mockCategoryAttention.money = false;
    mockCategoryAttention.pod = false;
  });

  it('renders 5 category tabs', () => {
    const wrapper = mount(MobileBottomNav);
    const buttons = wrapper.findAll('nav > button');
    expect(buttons).toHaveLength(5);
  });

  it('hides Money tab when finance permissions are off (4 tabs)', () => {
    canViewFinances.value = false;
    const wrapper = mount(MobileBottomNav);
    const buttons = wrapper.findAll('nav > button');
    expect(buttons).toHaveLength(4);
    expect(wrapper.text()).not.toContain('mobile.money');
  });

  it('renders all 5 tab labels with correct order (Calendar centred)', () => {
    const wrapper = mount(MobileBottomNav);
    const text = wrapper.text();
    expect(text.indexOf('mobile.nook')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('mobile.planning')).toBeGreaterThan(text.indexOf('mobile.nook'));
    expect(text.indexOf('mobile.calendar')).toBeGreaterThan(text.indexOf('mobile.planning'));
    expect(text.indexOf('mobile.money')).toBeGreaterThan(text.indexOf('mobile.calendar'));
    expect(text.indexOf('mobile.pod')).toBeGreaterThan(text.indexOf('mobile.money'));
  });

  it('Nook tap → router.push(/nook), no stack opens', async () => {
    const wrapper = mount(MobileBottomNav);
    await wrapper.findAll('nav > button')[0]!.trigger('click');
    expect(mockPush).toHaveBeenCalledWith('/nook');
    expect(wrapper.find('[data-testid=bean-stack-stub]').exists()).toBe(false);
  });

  it('Calendar tap → router.push(/activities), no stack opens (leaf)', async () => {
    const wrapper = mount(MobileBottomNav);
    await wrapper.findAll('nav > button')[2]!.trigger('click');
    expect(mockPush).toHaveBeenCalledWith('/activities');
    expect(wrapper.find('[data-testid=bean-stack-stub]').exists()).toBe(false);
  });

  it('Calendar hero renders INSIDE the Calendar button slot, not the nav root', () => {
    const wrapper = mount(MobileBottomNav);
    const calendarButton = wrapper.findAll('nav > button')[2]!;
    // Hero lives in its own flex slot so centring is per-slot (robust to the
    // 4-tab money-hidden case), never viewport-centred against the nav.
    expect(calendarButton.find('.calendar-hero').exists()).toBe(true);
    expect(wrapper.findAll('nav > .calendar-hero')).toHaveLength(0);
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

    await buttons[3]!.trigger('click'); // Money (index 3 — Calendar leaf sits at 2)
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
    await buttons[3]!.trigger('click'); // Money (index 3)
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
    // Pod is the 5th tab (index 4) — Calendar leaf sits at index 2.
    const podPill = buttons[4]!.find('div.relative');
    expect(podPill.classes()).toContain('bg-[rgba(241,93,34,0.08)]');
  });

  it('highlights Money tab for /accounts', () => {
    mockRoute.path = '/accounts';
    const wrapper = mount(MobileBottomNav);
    const buttons = wrapper.findAll('nav > button');
    const moneyPill = buttons[3]!.find('div.relative'); // Money is index 3
    expect(moneyPill.classes()).toContain('bg-[rgba(241,93,34,0.08)]');
  });

  it('renders ARIA attributes on category tabs', async () => {
    const wrapper = mount(MobileBottomNav);
    const buttons = wrapper.findAll('nav > button');

    // Leaves (Nook index 0, Calendar index 2) have no aria-haspopup/controls.
    expect(buttons[0]!.attributes('aria-haspopup')).toBeUndefined();
    expect(buttons[0]!.attributes('aria-expanded')).toBeUndefined();
    expect(buttons[2]!.attributes('aria-haspopup')).toBeUndefined();
    expect(buttons[2]!.attributes('aria-expanded')).toBeUndefined();

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
    // Leaves (Nook index 0, Calendar index 2) have no stack dot.
    expect(buttons[0]!.find('span.rounded-full').exists()).toBe(false);
    expect(buttons[2]!.find('span.rounded-full').exists()).toBe(false);
    // Planning (1), Money (3), Pod (4) have dots.
    expect(buttons[1]!.find('span.rounded-full').exists()).toBe(true);
    expect(buttons[3]!.find('span.rounded-full').exists()).toBe(true);
    expect(buttons[4]!.find('span.rounded-full').exists()).toBe(true);
  });

  describe('attention dot (category aggregate)', () => {
    it('renders no attention dot when categoryAttention is all false', () => {
      const wrapper = mount(MobileBottomNav);
      // The attention dot sits inside a `span.absolute.top-1.left-1`.
      // The existing open/closed state dot sits at `top-1.right-1`.
      expect(wrapper.find('span.absolute.top-1.left-1').exists()).toBe(false);
    });

    it('renders an attention dot at top-left of the Planning tab when planning is true', async () => {
      mockCategoryAttention.planning = true;
      const wrapper = mount(MobileBottomNav);
      const buttons = wrapper.findAll('nav > button');
      // Planning is at index 1 (after Nook). It should now have a
      // top-left attention dot.
      const dot = buttons[1]!.find('span.absolute.top-1.left-1');
      expect(dot.exists()).toBe(true);
      // Other tabs (Nook 0, Calendar 2, Money 3, Pod 4) should NOT have it.
      expect(buttons[0]!.find('span.absolute.top-1.left-1').exists()).toBe(false);
      expect(buttons[2]!.find('span.absolute.top-1.left-1').exists()).toBe(false);
      expect(buttons[3]!.find('span.absolute.top-1.left-1').exists()).toBe(false);
      expect(buttons[4]!.find('span.absolute.top-1.left-1').exists()).toBe(false);
    });

    it('renders an attention dot at top-left of the Money tab when money is true', () => {
      mockCategoryAttention.money = true;
      const wrapper = mount(MobileBottomNav);
      const buttons = wrapper.findAll('nav > button');
      // Money is at index 3 (Calendar leaf sits at index 2).
      expect(buttons[3]!.find('span.absolute.top-1.left-1').exists()).toBe(true);
    });
  });
});
