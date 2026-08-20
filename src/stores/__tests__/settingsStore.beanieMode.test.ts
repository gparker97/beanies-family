/**
 * settingsStore.setBeanieMode + beanieMode getter — cross-device persistence.
 *
 * Beanie mode was device-only (GlobalSettings), so it reset to the default on a
 * new device / cleared cache / review-demo re-seed. It is now dual-persisted
 * (device GlobalSettings + the family Automerge doc), like textSize: the device
 * value wins on read, but a fresh device falls back to the family-synced doc
 * value instead of the default.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const {
  mockShowToast,
  mockSaveGlobalSettings,
  mockSaveSettings,
  mockGetGlobalSettings,
  mockGetSettings,
} = vi.hoisted(() => ({
  mockShowToast: vi.fn(),
  mockSaveGlobalSettings: vi.fn(
    async (patch: Record<string, unknown>): Promise<Record<string, unknown>> => ({
      id: 'global_settings',
      theme: 'light',
      language: 'en',
      ...patch,
    })
  ),
  mockSaveSettings: vi.fn(
    async (patch: Record<string, unknown>): Promise<Record<string, unknown>> => ({
      id: 'app_settings',
      theme: 'light',
      language: 'en',
      ...patch,
    })
  ),
  mockGetGlobalSettings: vi.fn(async (): Promise<Record<string, unknown>> => ({
    id: 'global_settings',
    theme: 'light',
    language: 'en',
  })),
  mockGetSettings: vi.fn(async (): Promise<Record<string, unknown>> => ({
    id: 'app_settings',
    theme: 'light',
    language: 'en',
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
  getGlobalSettings: mockGetGlobalSettings,
  saveGlobalSettings: mockSaveGlobalSettings,
}));
vi.mock('@/services/automerge/repositories/settingsRepository', () => ({
  getDefaultSettings: () => ({ id: 'app_settings', language: 'en', theme: 'light' }),
  getSettings: mockGetSettings,
  saveSettings: mockSaveSettings,
}));
vi.mock('@/services/automerge/docService', () => ({ isDocLoaded: vi.fn(() => true) }));

import { useSettingsStore } from '@/stores/settingsStore';

describe('settingsStore beanie mode — cross-device', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('dual-persists a toggle to BOTH the device and the family doc', async () => {
    const store = useSettingsStore();

    await store.setBeanieMode(false);

    // Device layer (survives on this device) AND the family doc (syncs to others).
    expect(mockSaveGlobalSettings).toHaveBeenCalledWith({ beanieMode: false });
    expect(mockSaveSettings).toHaveBeenCalledWith({ beanieMode: false });
    expect(store.beanieMode).toBe(false);
  });

  it('falls back to the family-synced doc value on a device with no local value', async () => {
    // Simulate a fresh device: GlobalSettings has no beanieMode, the doc says false.
    mockGetGlobalSettings.mockResolvedValueOnce({
      id: 'global_settings',
      theme: 'light',
      language: 'en',
    });
    mockGetSettings.mockResolvedValueOnce({
      id: 'app_settings',
      theme: 'light',
      language: 'en',
      beanieMode: false,
    });
    const store = useSettingsStore();

    await store.loadGlobalSettings();
    await store.loadSettings();

    // Without the doc fallback this would default to true (the bug).
    expect(store.beanieMode).toBe(false);
  });

  it('does not throw on a persist failure (already toasted upstream)', async () => {
    mockSaveGlobalSettings.mockRejectedValueOnce(new Error('IndexedDB quota exceeded'));
    const store = useSettingsStore();

    await expect(store.setBeanieMode(false)).resolves.toBeUndefined();
    expect(mockShowToast).toHaveBeenCalledTimes(1);
  });
});
