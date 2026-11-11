import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

const hardReload = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/utils/hardReload', () => ({ hardReload }));
const reportError = vi.hoisted(() => vi.fn());
vi.mock('@/utils/errorReporter', () => ({ reportError }));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import StorageStallBanner from '../StorageStallBanner.vue';
import { markStorageStalled, clearStorageStall } from '@/utils/storageStall';

describe('StorageStallBanner', () => {
  afterEach(() => {
    clearStorageStall();
    hardReload.mockClear();
    reportError.mockClear();
  });

  it('is absent until storage stalls, then says what to do, then leaves by itself', async () => {
    const w = mount(StorageStallBanner);
    expect(w.text()).toBe('');
    markStorageStalled();
    await nextTick();
    expect(w.text()).toContain('storageStall.title');
    expect(w.text()).toContain('app.initError.registryBlocked');
    clearStorageStall();
    await nextTick();
    expect(w.find('[data-testid="storage-stall-reload"]').exists()).toBe(false);
  });

  it('Reload goes through hardReload', async () => {
    markStorageStalled();
    const w = mount(StorageStallBanner);
    await w.find('[data-testid="storage-stall-reload"]').trigger('click');
    expect(hardReload).toHaveBeenCalledTimes(1);
  });

  it('a failed hardReload is reported and falls back to a plain reload', async () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });
    hardReload.mockRejectedValueOnce(new Error('blocked'));
    markStorageStalled();
    const w = mount(StorageStallBanner);
    await w.find('[data-testid="storage-stall-reload"]').trigger('click');
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledTimes(1));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
