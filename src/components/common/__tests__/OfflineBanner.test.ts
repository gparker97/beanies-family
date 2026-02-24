import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { mount } from '@vue/test-utils';
import OfflineBanner from '@/components/common/OfflineBanner.vue';

const isOnline = ref(true);

// Mock composables
vi.mock('@/composables/useOnline', () => ({
  useOnline: () => ({ isOnline }),
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('OfflineBanner', () => {
  beforeEach(() => {
    isOnline.value = true;
  });

  it('does not render when online', () => {
    const wrapper = mount(OfflineBanner);
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });

  it('renders banner when offline', () => {
    isOnline.value = false;
    const wrapper = mount(OfflineBanner);
    expect(wrapper.find('[role="status"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('pwa.offlineBanner');
  });

  it('hides banner when coming back online', async () => {
    isOnline.value = false;
    const wrapper = mount(OfflineBanner);
    expect(wrapper.find('[role="status"]').exists()).toBe(true);

    isOnline.value = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });
});
