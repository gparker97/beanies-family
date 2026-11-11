import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  native: false,
  platform: 'web' as 'web' | 'ios' | 'android',
  storeUrl: null as string | null,
  check: vi.fn(),
  showToast: vi.fn(),
  reportError: vi.fn(),
  openExternal: vi.fn(),
}));

vi.mock('@/services/sync/capabilities', () => ({
  isNative: () => h.native,
  getPlatform: () => h.platform,
}));
vi.mock('@/services/appUpdate/storeUrl', () => ({ storeUrlFor: () => h.storeUrl }));
vi.mock('@/utils/webUpdate', () => ({ runUpdateCheck: h.check }));
vi.mock('@/composables/useToast', () => ({ showToast: h.showToast }));
vi.mock('@/utils/errorReporter', () => ({ reportError: h.reportError }));
vi.mock('@/utils/openExternal', () => ({ openExternal: h.openExternal }));
vi.mock('@/stores/translationStore', () => ({
  useTranslationStore: () => ({ t: (k: string) => k }),
}));

import { runAppUpdateAction } from '../appUpdateAction';

beforeEach(() => {
  vi.clearAllMocks();
  h.native = false;
  h.platform = 'web';
  h.storeUrl = null;
});

describe('runAppUpdateAction', () => {
  it('native opens the store listing synchronously, before any await', () => {
    h.native = true;
    h.platform = 'ios';
    h.storeUrl = 'https://store.example/beanies';
    const p = runAppUpdateAction();
    expect(h.openExternal).toHaveBeenCalledWith('https://store.example/beanies');
    expect(h.check).not.toHaveBeenCalled();
    return p;
  });

  it('native with no store url reports and toasts', async () => {
    h.native = true;
    h.platform = 'android';
    await runAppUpdateAction();
    expect(h.openExternal).not.toHaveBeenCalled();
    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'app-update', severity: 'warning' })
    );
    expect(h.showToast).toHaveBeenCalledWith('warning', 'error.generic');
  });

  it('web: reloading does nothing further', async () => {
    h.check.mockResolvedValue('reloading');
    await runAppUpdateAction();
    expect(h.check).toHaveBeenCalledWith({ trigger: 'visible', userRequested: true });
    expect(h.showToast).not.toHaveBeenCalled();
    expect(h.reportError).not.toHaveBeenCalled();
  });

  it('web: current shows the already-up-to-date toast', async () => {
    h.check.mockResolvedValue('current');
    await runAppUpdateAction();
    expect(h.showToast).toHaveBeenCalledWith('info', 'appUpdate.alreadyCurrent');
    expect(h.reportError).not.toHaveBeenCalled();
  });

  it.each(['unavailable', 'deferred', 'failed'])(
    'web: %s reports and toasts generic',
    async (r) => {
      h.check.mockResolvedValue(r);
      await runAppUpdateAction();
      expect(h.reportError).toHaveBeenCalledWith(
        expect.objectContaining({ surface: 'app-update', severity: 'warning' })
      );
      expect(h.showToast).toHaveBeenCalledWith('warning', 'error.generic');
    }
  );

  it('never rejects when the check throws', async () => {
    h.check.mockRejectedValue(new Error('boom'));
    await expect(runAppUpdateAction()).resolves.toBeUndefined();
    expect(h.reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'update action failed', severity: 'warning' })
    );
    expect(h.showToast).toHaveBeenCalledWith('warning', 'error.generic');
  });
});
