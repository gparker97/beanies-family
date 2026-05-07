/**
 * SaveFailureBanner UI tests.
 *
 * Auth-stuck branch (the new design):
 *   - "Refresh app" is the only action; clicking calls hardReload.
 *   - "Reconnect to Google Drive" button is removed (canonical reconnect
 *     surface is GoogleReconnectToast, gated by showGoogleReconnect).
 *   - "Download backup" button is removed (already in Settings).
 *
 * File-not-found branch (preserved):
 *   - "Reselect file" + "Go to Settings" buttons still render.
 *
 * See docs/plans/2026-05-07-quiet-save-failure-banner.md.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';
import { ref } from 'vue';

const { hardReloadMock } = vi.hoisted(() => ({
  hardReloadMock: vi.fn(async () => {}),
}));

vi.mock('@/utils/hardReload', () => ({
  hardReload: hardReloadMock,
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/composables/useToast', () => ({
  showToast: vi.fn(),
}));

vi.mock('@/utils/errorReporter', () => ({
  reportError: vi.fn(),
}));

vi.mock('@/composables/usePickBeanpodFile', () => ({
  usePickBeanpodFile: () => ({
    isPicking: ref(false),
    pick: vi.fn(),
  }),
}));

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({
    providerAccountEmail: 'test@example.com',
    recoverFromMissingFile: vi.fn(async () => ({ success: true })),
  }),
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import SaveFailureBanner from '@/components/google/SaveFailureBanner.vue';

describe('SaveFailureBanner', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('auth-stuck branch (fileNotFound=false)', () => {
    it('renders the Refresh button only', () => {
      const wrapper = mount(SaveFailureBanner, {
        props: { show: true, fileNotFound: false },
      });
      const buttons = wrapper.findAll('button');
      expect(buttons).toHaveLength(1);
      expect(buttons[0].text()).toContain('googleDrive.saveFailureRefresh');
    });

    it('does not render a Reconnect button (canonical surface is GoogleReconnectToast)', () => {
      const wrapper = mount(SaveFailureBanner, {
        props: { show: true, fileNotFound: false },
      });
      expect(wrapper.html()).not.toContain('saveFailureReconnect');
      expect(wrapper.html()).not.toContain('Reconnect');
    });

    it('does not render a Download backup button', () => {
      const wrapper = mount(SaveFailureBanner, {
        props: { show: true, fileNotFound: false },
      });
      expect(wrapper.html()).not.toContain('downloadBackup');
      expect(wrapper.html()).not.toContain('Download backup');
    });

    it('clicking Refresh calls hardReload', async () => {
      const wrapper = mount(SaveFailureBanner, {
        props: { show: true, fileNotFound: false },
      });
      await wrapper.find('button').trigger('click');
      expect(hardReloadMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('file-not-found branch (preserved unchanged)', () => {
    it('renders Reselect + Go to Settings buttons', () => {
      const wrapper = mount(SaveFailureBanner, {
        props: { show: true, fileNotFound: true },
      });
      const html = wrapper.html();
      expect(html).toContain('fileNotFoundReselect');
      expect(html).toContain('goToSettings');
    });

    it('does not render the Refresh button in file-not-found mode', () => {
      const wrapper = mount(SaveFailureBanner, {
        props: { show: true, fileNotFound: true },
      });
      expect(wrapper.html()).not.toContain('saveFailureRefresh');
    });
  });

  describe('show prop', () => {
    it('does not render when show=false', () => {
      const wrapper = mount(SaveFailureBanner, {
        props: { show: false, fileNotFound: false },
      });
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    });
  });
});
