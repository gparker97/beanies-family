import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';

const mockPush = vi.fn(() => Promise.resolve());
vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/nook' }),
  useRouter: () => ({ push: mockPush }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/composables/usePermissions', () => ({
  usePermissions: () => ({ canViewFinances: ref(true) }),
}));
vi.mock('@/composables/useNavBadges', () => ({ useNavBadges: () => ({ badgeFor: () => null }) }));
const openFeedback = vi.fn();
vi.mock('@/composables/useFeedbackModal', () => ({ useFeedbackModal: () => ({ openFeedback }) }));
const openExternal = vi.fn();
vi.mock('@/utils/openExternal', () => ({ openExternal: (url: string) => openExternal(url) }));
vi.mock('@/services/telemetry/logEvent', () => ({ logEvent: vi.fn() }));
vi.mock('@/composables/useMemberAvatar', () => ({
  useMemberAvatar: () => ({ variant: ref('dad'), color: ref('#aaa') }),
}));
const member = ref<{ name: string; role: string } | null>({ name: 'Sam', role: 'owner' });
vi.mock('@/stores/familyStore', () => ({
  useFamilyStore: () => ({
    get currentMember() {
      return member.value;
    },
    owner: null,
  }),
}));
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ isConfigured: false, fileName: null }),
}));
vi.mock('@/utils/diagnosticContext', () => ({ getProductVersionLabel: () => 'v0' }));

import AppSidebar from '@/components/common/AppSidebar.vue';

const stubs = {
  BeanieAvatar: true,
  CloudProviderBadge: true,
  SaveStatusIndicator: true,
  BeanieIcon: true,
  ImageGlyph: true,
};

describe('AppSidebar tools row', () => {
  beforeEach(() => {
    member.value = { name: 'Sam', role: 'owner' };
    mockPush.mockClear();
    openFeedback.mockClear();
    openExternal.mockClear();
  });

  it('renders Help then Discord as tools, with Share feedback and Settings in the fixed footer', () => {
    const wrapper = mount(AppSidebar, { global: { stubs } });
    const keys = wrapper
      .findAll('[data-testid^="sidebar-tool-"]')
      .map((b) => b.attributes('data-testid'));
    expect(keys).toEqual(['sidebar-tool-help', 'sidebar-tool-discord']);
    const footer = wrapper.find('[data-testid="sidebar-pinned"]');
    expect(footer.findAll('button').map((b) => b.attributes('aria-label'))).toEqual([
      'feedback.shareEntry',
      'nav.settings',
    ]);
    const scroll = wrapper.find('.sidebar-nav-scroll');
    expect(scroll.find('button[aria-label="feedback.shareEntry"]').exists()).toBe(false);
    expect(scroll.find('button[aria-label="nav.settings"]').exists()).toBe(false);
    expect(wrapper.find('button[aria-label="nav.help"]:not([data-testid])').exists()).toBe(false);
  });

  it('runs the shared select action for each tool', async () => {
    const wrapper = mount(AppSidebar, { global: { stubs } });
    await wrapper.find('[data-testid="sidebar-tool-help"]').trigger('click');
    expect(openExternal).toHaveBeenCalledTimes(1);
    await wrapper.find('[data-testid="sidebar-tool-discord"]').trigger('click');
    expect(openExternal).toHaveBeenCalledTimes(2);
  });

  it('runs the nav-row actions for Share feedback and Settings', async () => {
    const wrapper = mount(AppSidebar, { global: { stubs } });
    await wrapper
      .find('[data-testid="sidebar-pinned"] button[aria-label="feedback.shareEntry"]')
      .trigger('click');
    expect(openFeedback).toHaveBeenCalledWith('nav');
    await wrapper
      .find('[data-testid="sidebar-pinned"] button[aria-label="nav.settings"]')
      .trigger('click');
    expect(mockPush).toHaveBeenCalledWith('/settings');
  });

  it('still renders the tools when there is no current member', () => {
    member.value = null;
    const wrapper = mount(AppSidebar, { global: { stubs } });
    expect(wrapper.findAll('[data-testid^="sidebar-tool-"]')).toHaveLength(2);
    expect(wrapper.text()).not.toContain('Sam');
  });
});
