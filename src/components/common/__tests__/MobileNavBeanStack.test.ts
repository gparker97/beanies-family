import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import MobileNavBeanStack from '@/components/common/MobileNavBeanStack.vue';
import { MOBILE_NAV_CATEGORIES } from '@/constants/navigation';

const mockRoute = { path: '/nook' };

vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const canViewFinances = { value: true };
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

const planning = MOBILE_NAV_CATEGORIES.find((c) => c.id === 'planning')!;
const money = MOBILE_NAV_CATEGORIES.find((c) => c.id === 'money')!;
const pod = MOBILE_NAV_CATEGORIES.find((c) => c.id === 'pod')!;

function makeAnchor(left: number, width = 80): HTMLElement {
  const el = document.createElement('button');
  el.getBoundingClientRect = () =>
    ({
      left,
      top: 600,
      width,
      height: 56,
      right: left + width,
      bottom: 656,
      x: left,
      y: 600,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

function mountStack(opts: {
  category: typeof planning;
  isOpen?: boolean;
  anchor?: HTMLElement | null;
  attach?: boolean;
}): VueWrapper {
  const anchor = opts.anchor ?? makeAnchor(40);
  return mount(MobileNavBeanStack, {
    attachTo: opts.attach ? document.body : undefined,
    props: {
      getAnchor: () => anchor,
      category: opts.category,
      isOpen: opts.isOpen ?? true,
    },
  });
}

describe('MobileNavBeanStack', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let originalInnerWidth: number;

  beforeEach(() => {
    mockRoute.path = '/nook';
    canViewFinances.value = true;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 400,
    });
  });

  afterEach(() => {
    warnSpy.mockRestore();
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: originalInnerWidth,
    });
    document.body.innerHTML = '';
  });

  it('renders no items when isOpen=false', () => {
    const wrapper = mountStack({ category: planning, isOpen: false });
    expect(wrapper.findAll('[role=menuitem]')).toHaveLength(0);
  });

  it('renders 3 beans for Planning', () => {
    const wrapper = mountStack({ category: planning });
    expect(wrapper.findAll('[role=menuitem]')).toHaveLength(3);
  });

  it('renders 6 beans for Money', () => {
    const wrapper = mountStack({ category: money });
    expect(wrapper.findAll('[role=menuitem]')).toHaveLength(6);
  });

  it('renders 5 beans for Pod', () => {
    const wrapper = mountStack({ category: pod });
    expect(wrapper.findAll('[role=menuitem]')).toHaveLength(5);
  });

  it('emits navigate with the bean path on tap', async () => {
    const wrapper = mountStack({ category: planning });
    const beans = wrapper.findAll('[role=menuitem]');
    // Items render in REVERSED order — first DOM item is the last category item.
    // For Planning, items are [/activities, /travel, /todo]; reversed = [/todo, /travel, /activities].
    await beans[0]!.trigger('click');
    expect(wrapper.emitted('navigate')).toBeTruthy();
    expect(wrapper.emitted('navigate')![0]).toEqual(['/todo']);
  });

  it('emits close on scrim tap', async () => {
    const wrapper = mountStack({ category: planning });
    await wrapper.find('button[aria-label="mobile.closeMenu"]').trigger('click');
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('marks the active route bean with is-current and aria-current="page"', () => {
    mockRoute.path = '/accounts';
    const wrapper = mountStack({ category: money });
    const current = wrapper.find('[role=menuitem][aria-current="page"]');
    expect(current.exists()).toBe(true);
    expect(current.classes()).toContain('is-current');
    expect(current.text()).toContain('nav.accounts');
  });

  it('marks parent bean active for nested routes', () => {
    mockRoute.path = '/pod/cookbook';
    const wrapper = mountStack({ category: pod });
    const current = wrapper.find('[role=menuitem][aria-current="page"]');
    expect(current.exists()).toBe(true);
    expect(current.text()).toContain('nav.pod.cookbook');
  });

  it('positions on left side when anchor is left-half', async () => {
    // window.innerWidth = 400, anchor at left=40 width=80 → tabCenter = 80 < 200
    const wrapper = mountStack({
      category: planning,
      anchor: makeAnchor(40, 80),
    });
    // Wait for the rAF that schedules updatePosition
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    const nav = wrapper.find('nav.bean-stack');
    expect(nav.classes()).toContain('side-left');
  });

  it('positions on right side when anchor is right-half', async () => {
    const wrapper = mountStack({
      category: planning,
      anchor: makeAnchor(280, 80),
    });
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    const nav = wrapper.find('nav.bean-stack');
    expect(nav.classes()).toContain('side-right');
  });

  it('defaults side to right and warns when anchor returns null', async () => {
    const wrapper = mount(MobileNavBeanStack, {
      props: {
        getAnchor: () => null,
        category: planning,
        isOpen: true,
      },
    });
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    const nav = wrapper.find('nav.bean-stack');
    expect(nav.classes()).toContain('side-right');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[MobileNavBeanStack] anchor unavailable; defaulting side to right')
    );
  });

  it('hides finance items when canViewFinances is false', () => {
    canViewFinances.value = false;
    const wrapper = mountStack({ category: money });
    expect(wrapper.findAll('[role=menuitem]')).toHaveLength(0);
  });

  it('renders one menu region with id matching aria-controls convention', () => {
    const wrapper = mountStack({ category: pod });
    const nav = wrapper.find('nav[role=menu]');
    expect(nav.attributes('id')).toBe('mobile-nav-stack-pod');
  });

  it('focuses the bottom bean on open when no active route matches', async () => {
    mockRoute.path = '/nook'; // not in Planning
    const wrapper = mountStack({ category: planning, attach: true });
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    // Bottom bean (DOM order index 0 since reversed) is /todo for Planning
    const focused = document.activeElement;
    expect(focused?.textContent).toContain('nav.todo');
    wrapper.unmount();
  });

  it('focuses the active bean on open when route matches', async () => {
    mockRoute.path = '/travel';
    const wrapper = mountStack({ category: planning, attach: true });
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    const focused = document.activeElement;
    expect(focused?.textContent).toContain('nav.travel');
    wrapper.unmount();
  });

  it('exposes hint text inside the same button so screen readers read both', () => {
    const wrapper = mountStack({ category: planning });
    const beans = wrapper.findAll('[role=menuitem]');
    // Reversed order: /todo first
    expect(beans[0]!.text()).toContain('nav.todo');
    expect(beans[0]!.text()).toContain('mobileNav.hint.todo');
  });
});
