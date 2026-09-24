/**
 * DurabilityBanner UI tests (#50) — the global "local durability broken" banner.
 * Bound to `syncStore.cachePersistFailed`; reuses the shared `ErrorBanner` chrome
 * with the Heritage-Orange `notice` tone; CTA deep-links to the Settings modal.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia, createPinia } from 'pinia';

const { pushMock, syncState } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  syncState: {
    cachePersistFailed: false as boolean,
    cachePersistCause: 'unknown' as 'other-tabs' | 'storage' | 'unknown',
  },
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => syncState,
}));

import DurabilityBanner from '@/components/common/DurabilityBanner.vue';

describe('DurabilityBanner', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    syncState.cachePersistFailed = false;
    syncState.cachePersistCause = 'unknown';
  });

  it('is hidden when cachePersistFailed is false', () => {
    const wrapper = mount(DurabilityBanner);
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('renders the notice banner + CTA when cachePersistFailed is true', () => {
    syncState.cachePersistFailed = true;
    const wrapper = mount(DurabilityBanner);
    const banner = wrapper.find('[role="status"]'); // notice tone → role=status, not alert
    expect(banner.exists()).toBe(true);
    expect(banner.classes().some((c) => c.startsWith('bg-primary'))).toBe(true);
    expect(banner.text()).toContain('sync.durabilityBannerTitle');
    expect(banner.text()).toContain('sync.durabilityBanner');
    expect(wrapper.find('button').text()).toContain('sync.durabilityBannerCta');
  });

  // #100: the message names the cause when it is known. Asserted on the MESSAGE element
  // alone: the title key `sync.durabilityBannerTitle` contains `sync.durabilityBanner`
  // as a substring, so a whole-banner `toContain` would pass without any message.
  it.each([
    ['other-tabs', 'sync.durabilityBanner.otherTabs'],
    ['storage', 'sync.durabilityBanner.storage'],
    ['unknown', 'sync.durabilityBanner'],
  ] as const)('cause %s shows %s', (cause, key) => {
    syncState.cachePersistFailed = true;
    syncState.cachePersistCause = cause;
    const wrapper = mount(DurabilityBanner);
    const text = wrapper.find('[role="status"]').text().replace('sync.durabilityBannerTitle', '');
    expect(text).toContain(key);
    for (const other of ['sync.durabilityBanner.otherTabs', 'sync.durabilityBanner.storage']) {
      if (other !== key) expect(text).not.toContain(other);
    }
  });

  it('CTA routes to the Settings family-data modal', async () => {
    syncState.cachePersistFailed = true;
    const wrapper = mount(DurabilityBanner);
    await wrapper.find('button').trigger('click');
    expect(pushMock).toHaveBeenCalledWith({ path: '/settings', query: { open: 'family-data' } });
  });
});
