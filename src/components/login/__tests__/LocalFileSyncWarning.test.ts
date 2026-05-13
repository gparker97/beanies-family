import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick } from 'vue';
import LocalFileSyncWarning from '../LocalFileSyncWarning.vue';
import BaseModal from '@/components/ui/BaseModal.vue';

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function factory(googleDriveAvailable = true) {
  return mount(LocalFileSyncWarning, {
    props: { open: true, googleDriveAvailable },
    global: { stubs: { teleport: true } },
  });
}

describe('LocalFileSyncWarning', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('shows the title and the three body lines when open', async () => {
    const wrapper = factory();
    await nextTick();
    const text = wrapper.text();
    expect(text).toContain('storage.localFileWarningTitle');
    expect(text).toContain('storage.localFileWarning');
    expect(text).toContain('storage.localFileBestOnDesktop');
    expect(text).toContain('storage.localFileWarningEncryption');
  });

  it('emits "use-google-drive" from the primary button when Drive is available', async () => {
    const wrapper = factory(true);
    await nextTick();
    const driveBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes('storage.useGoogleDriveInstead'))!;
    expect(driveBtn).toBeTruthy();
    await driveBtn.trigger('click');
    expect(wrapper.emitted('use-google-drive')).toHaveLength(1);
    expect(wrapper.emitted('proceed')).toBeUndefined();
  });

  it('emits "proceed" from the "use a local file" button', async () => {
    const wrapper = factory(true);
    await nextTick();
    const localBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes('storage.localFileContinue'))!;
    await localBtn.trigger('click');
    expect(wrapper.emitted('proceed')).toHaveLength(1);
  });

  it('re-emits "close" when the modal closes (the × at the top)', async () => {
    const wrapper = factory(true);
    await nextTick();
    wrapper.findComponent(BaseModal).vm.$emit('close');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('hides the "Use Google Drive instead" button when Drive is unavailable', async () => {
    const wrapper = factory(false);
    await nextTick();
    expect(wrapper.text()).not.toContain('storage.useGoogleDriveInstead');
    // The "use a local file" action is still there (and is now the primary).
    expect(wrapper.text()).toContain('storage.localFileContinue');
  });
});
