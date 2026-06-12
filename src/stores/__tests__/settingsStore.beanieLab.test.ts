/**
 * Unit tests for settingsStore.setBeanieLabEnabled — the per-device opt-in to
 * The Beanie Lab, persisted via the new persistGlobalSetting helper.
 *
 * Guards the report-on-failure contract (the reason we did NOT copy the silent
 * setSoundEnabled/setBeanieMode pattern): on a failed write the helper toasts,
 * leaves state unchanged, resets isLoading, and RE-THROWS so the toggle control
 * can revert its optimistic state.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockShowToast, mockSaveGlobalSettings } = vi.hoisted(() => ({
  mockShowToast: vi.fn(),
  mockSaveGlobalSettings: vi.fn(async (patch: Record<string, unknown>) => ({
    id: 'global_settings',
    theme: 'light',
    language: 'en',
    ...patch,
  })),
}));

vi.mock('@/composables/useToast', () => ({
  showToast: mockShowToast,
  useToast: () => ({ toasts: [], dismissToast: vi.fn() }),
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/services/indexeddb/repositories/globalSettingsRepository', () => ({
  getDefaultGlobalSettings: () => ({ id: 'global_settings', theme: 'light', language: 'en' }),
  getGlobalSettings: vi.fn(async () => ({ id: 'global_settings', theme: 'light', language: 'en' })),
  saveGlobalSettings: mockSaveGlobalSettings,
}));

vi.mock('@/services/automerge/repositories/settingsRepository', () => ({
  getDefaultSettings: () => ({ id: 'app_settings', language: 'en', theme: 'light' }),
  getSettings: vi.fn(async () => ({ id: 'app_settings', language: 'en', theme: 'light' })),
  saveSettings: vi.fn(async (patch: Record<string, unknown>) => ({ id: 'app_settings', ...patch })),
}));

vi.mock('@/services/automerge/docService', () => ({ isDocLoaded: vi.fn(() => true) }));

import { useSettingsStore } from '@/stores/settingsStore';

describe('settingsStore.setBeanieLabEnabled', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('defaults to false', () => {
    const store = useSettingsStore();
    expect(store.beanieLabEnabled).toBe(false);
  });

  it('persists the per-device flag and reflects it in the getter', async () => {
    const store = useSettingsStore();

    await store.setBeanieLabEnabled(true);

    expect(mockSaveGlobalSettings).toHaveBeenCalledWith({ beanieLabEnabled: true });
    expect(store.beanieLabEnabled).toBe(true);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('failure: toasts (settings-persist surface), leaves state unchanged, and re-throws', async () => {
    const failure = new Error('IndexedDB quota exceeded');
    mockSaveGlobalSettings.mockRejectedValueOnce(failure);
    const store = useSettingsStore();

    await expect(store.setBeanieLabEnabled(true)).rejects.toBe(failure);

    expect(store.beanieLabEnabled).toBe(false); // unchanged — no silent revert
    expect(store.isLoading).toBe(false); // reset in finally
    expect(mockShowToast).toHaveBeenCalledTimes(1);
    const [type, , , options] = mockShowToast.mock.calls[0];
    expect(type).toBe('error');
    expect(options).toMatchObject({
      surface: 'settings-persist',
      error: failure,
      context: { field: 'beanieLabEnabled' },
    });
  });
});
