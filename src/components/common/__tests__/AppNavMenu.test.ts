import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, reactive, ref } from 'vue';

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
}));
vi.mock('@/composables/useNavBadges', () => ({
  useNavBadges: () => ({
    badgeFor: (path: string) => (path === '/todo' ? { kind: 'count', count: 2 } : null),
  }),
}));
const openFeedback = vi.fn();
vi.mock('@/composables/useFeedbackModal', () => ({ useFeedbackModal: () => ({ openFeedback }) }));
const openExternal = vi.fn();
vi.mock('@/utils/openExternal', () => ({ openExternal: (url: string) => openExternal(url) }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));

import AppNavMenu from '@/components/common/AppNavMenu.vue';
import {
  useSidebarAccordion,
  __resetSidebarAccordionForTesting,
} from '@/composables/useSidebarAccordion';

function mountMenu(hidePinned?: string[], groups?: 'all' | 'sections' | 'pinned') {
  return mount(AppNavMenu, { props: { density: 'sidebar', hidePinned, groups } });
}

function sectionHeaders(wrapper: ReturnType<typeof mountMenu>) {
  return wrapper.findAll('button[aria-expanded]').map((b) => b.find('span.flex-1').text());
}

function row(wrapper: ReturnType<typeof mountMenu>, labelKey: string) {
  return wrapper.findAll('button:not([aria-expanded])').find((b) => b.text().includes(labelKey))!;
}

describe('AppNavMenu', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetSidebarAccordionForTesting();
    mockRoute.path = '/nook';
    canViewFinances.value = true;
    mockPush.mockClear();
    openFeedback.mockClear();
    openExternal.mockClear();
  });

  it('renders The Treehouse, The Piggy Bank and The Bean Pod in order', () => {
    expect(sectionHeaders(mountMenu())).toEqual([
      'nav.section.treehouse',
      'nav.section.piggyBank',
      'nav.section.beanPod',
    ]);
  });

  it('hides The Piggy Bank from a member without finance access', () => {
    canViewFinances.value = false;
    expect(sectionHeaders(mountMenu())).toEqual(['nav.section.treehouse', 'nav.section.beanPod']);
  });

  it('anchors The Bean Pod with the hugging beanies image', () => {
    const pod = mountMenu()
      .findAll('button[aria-expanded]')
      .find((b) => b.text().includes('nav.section.beanPod'))!;
    expect(pod.find('img').attributes('src')).toContain('hugging');
  });

  it('marks only the most specific row active', () => {
    mockRoute.path = '/pod/cookbook';
    const wrapper = mountMenu();
    const active = wrapper.findAll('[aria-current="page"]');
    expect(active).toHaveLength(1);
    expect(active[0]!.text()).toContain('nav.pod.cookbook');
  });

  it('announces a badge count in the row name', () => {
    expect(row(mountMenu(), 'nav.todo').attributes('aria-label')).not.toBe('nav.todo');
  });

  it('routes internal rows, opens external rows externally, and opens feedback', async () => {
    const wrapper = mountMenu();
    await row(wrapper, 'nav.pod.scrapbook').trigger('click');
    expect(mockPush).toHaveBeenCalledWith('/pod/scrapbook');

    await row(wrapper, 'nav.help').trigger('click');
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalledWith('/help');

    await row(wrapper, 'feedback.shareEntry').trigger('click');
    expect(openFeedback).toHaveBeenCalledWith('nav');
  });

  it('emits select before the row action runs', async () => {
    const order: string[] = [];
    mockPush.mockImplementationOnce(() => {
      order.push('push');
      return Promise.resolve();
    });
    const wrapper = mount(AppNavMenu, {
      props: { density: 'drawer', onSelect: () => order.push('select') },
    });
    await row(wrapper, 'nav.pod.safety').trigger('click');
    expect(order).toEqual(['select', 'push']);
  });

  it('opens a collapsed section on mount when the route lives in it', () => {
    useSidebarAccordion().toggle('beanPod');
    mockRoute.path = '/pod/scrapbook';
    mountMenu();
    expect(useSidebarAccordion().isOpen('beanPod')).toBe(true);
  });

  it('re-opens a collapsed section on navigation within it', async () => {
    mockRoute.path = '/pod/safety';
    mountMenu();
    useSidebarAccordion().toggle('beanPod');
    mockRoute.path = '/pod/contacts';
    await nextTick();
    expect(useSidebarAccordion().isOpen('beanPod')).toBe(true);
  });

  it('re-opens the current section after an unmount and remount (resize, drawer reopen)', () => {
    mockRoute.path = '/pod';
    mountMenu().unmount();
    useSidebarAccordion().toggle('beanPod');
    mountMenu();
    expect(useSidebarAccordion().isOpen('beanPod')).toBe(true);
  });

  it('renders text-base rows whose labels never wrap', () => {
    const r = row(mountMenu(), 'nav.pod.contacts');
    expect(r.classes()).toContain('text-base');
    expect(r.classes()).not.toContain('text-lg');
    expect(r.classes()).toContain('min-w-0');
    expect(
      r
        .findAll('span')
        .find((s) => s.text() === 'nav.pod.contacts')!
        .classes()
    ).toContain('whitespace-nowrap');
  });

  it('keeps the two pinned groups by default', () => {
    const wrapper = mountMenu();
    expect(row(wrapper, 'nav.help').exists()).toBe(true);
    expect(wrapper.findAll('.h-px')).toHaveLength(2);
  });

  it('omits hidePinned rows and merges the rest into one group under one divider', () => {
    const wrapper = mountMenu(['/help', '/discord']);
    expect(wrapper.text()).not.toContain('nav.help');
    expect(wrapper.text()).not.toContain('nav.community');
    expect(wrapper.findAll('.h-px')).toHaveLength(1);
    const labels = wrapper
      .findAll('button:not([aria-expanded])')
      .map((b) => b.attributes('aria-label'))
      .filter((l) => l === 'feedback.shareEntry' || l === 'nav.settings');
    expect(labels).toEqual(['feedback.shareEntry', 'nav.settings']);
  });

  it("starts with only the current route's section open and peek strips on the rest", () => {
    mockRoute.path = '/todo';
    const wrapper = mountMenu();
    const expanded = wrapper
      .findAll('button[aria-expanded]')
      .map((b) => [b.find('span.flex-1').text(), b.attributes('aria-expanded')]);
    expect(expanded).toEqual([
      ['nav.section.treehouse', 'true'],
      ['nav.section.piggyBank', 'false'],
      ['nav.section.beanPod', 'false'],
    ]);
    expect(wrapper.findAll('[data-testid="nav-peek-strip"]')).toHaveLength(2);
    expect(wrapper.find('[data-testid="nav-peek-/pod/contacts"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="nav-peek-/todo"]').exists()).toBe(false);
  });

  it('selects the row when a peek chip is clicked, with its label as the accessible name', async () => {
    const wrapper = mountMenu();
    const chip = wrapper.find('[data-testid="nav-peek-/pod/contacts"]');
    expect(chip.attributes('aria-label')).toBe('nav.pod.contacts');
    expect(chip.attributes('title')).toBe('nav.pod.contacts');
    await chip.trigger('click');
    expect(mockPush).toHaveBeenCalledWith('/pod/contacts');
  });

  it("rings the active page's chip when its section is collapsed, and drops the strip when open", async () => {
    mockRoute.path = '/pod/safety';
    const wrapper = mountMenu();
    useSidebarAccordion().toggle('beanPod');
    await nextTick();
    const chip = wrapper.find('[data-testid="nav-peek-/pod/safety"]');
    expect(chip.classes()).toContain('ring-2');
    expect(chip.attributes('aria-current')).toBe('page');
    useSidebarAccordion().toggle('beanPod');
    await nextTick();
    expect(wrapper.find('[data-testid="nav-peek-/pod/safety"]').exists()).toBe(false);
  });

  it("groups='sections' renders only the accordion sections: no pinned rows, no dividers", () => {
    const wrapper = mountMenu(undefined, 'sections');
    expect(wrapper.findAll('button[aria-expanded]')).toHaveLength(3);
    expect(wrapper.find('button[aria-label="feedback.shareEntry"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('nav.settings');
    expect(wrapper.text()).not.toContain('nav.help');
    expect(wrapper.findAll('.h-px')).toHaveLength(0);
  });

  it("groups='pinned' renders only pinned rows (honouring hidePinned) and no divider", () => {
    const wrapper = mountMenu(['/help', '/discord'], 'pinned');
    expect(wrapper.findAll('button[aria-expanded]')).toHaveLength(0);
    expect(wrapper.findAll('[data-testid="nav-peek-strip"]')).toHaveLength(0);
    expect(wrapper.findAll('.h-px')).toHaveLength(0);
    expect(wrapper.findAll('button').map((b) => b.attributes('aria-label'))).toEqual([
      'feedback.shareEntry',
      'nav.settings',
    ]);
  });

  it("groups='pinned' without hidePinned shows every pinned row", () => {
    const wrapper = mountMenu(undefined, 'pinned');
    expect(wrapper.text()).toContain('nav.help');
    expect(wrapper.text()).toContain('nav.community');
    expect(wrapper.find('button[aria-label="feedback.shareEntry"]').exists()).toBe(true);
  });

  it('uses the tighter py-1.5 rows and section headers in the sidebar, py-2.5 / py-2 in the drawer', () => {
    const side = mountMenu();
    expect(row(side, 'nav.pod.contacts').classes()).toContain('py-1.5');
    expect(side.find('button[aria-expanded]').classes()).toContain('py-1.5');
    const drawer = mount(AppNavMenu, { props: { density: 'drawer' } });
    expect(row(drawer, 'nav.pod.contacts').classes()).toContain('py-2.5');
    expect(drawer.find('button[aria-expanded]').classes()).toContain('py-2');
    expect(side.find('[data-testid="nav-peek-strip"]').classes()).toContain('pb-2');
  });
});
