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

function mountMenu() {
  return mount(AppNavMenu, { props: { density: 'sidebar' } });
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
});
