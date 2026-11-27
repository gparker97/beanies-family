/**
 * Family flight arrivals (#143): the device switch and its lead, persisted through
 * `persistGlobalSetting` (device-scoped, never family-synced), defaults applied on read.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_ARRIVAL_LEAD } from '@/utils/reminderSchedule';

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

describe('settingsStore: family flight arrivals', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('on by default, one hour before landing', () => {
    const store = useSettingsStore();
    expect(store.familyArrivalAlerts).toBe(true);
    expect(store.familyArrivalLead).toBe(DEFAULT_ARRIVAL_LEAD);
    expect(DEFAULT_ARRIVAL_LEAD).toBe(60);
  });

  it('persists the switch and the lead on this device and reads them back', async () => {
    const store = useSettingsStore();
    await store.setFamilyArrivalAlerts(false);
    expect(mockSaveGlobalSettings).toHaveBeenCalledWith({ familyArrivalAlerts: false });
    expect(store.familyArrivalAlerts).toBe(false);
    await store.setFamilyArrivalLead(1440);
    expect(mockSaveGlobalSettings).toHaveBeenCalledWith({ familyArrivalLead: 1440 });
    expect(store.familyArrivalLead).toBe(1440);
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('a failed write toasts, leaves the value unchanged, and re-throws', async () => {
    const failure = new Error('IndexedDB quota exceeded');
    mockSaveGlobalSettings.mockRejectedValueOnce(failure);
    const store = useSettingsStore();
    await expect(store.setFamilyArrivalLead(15)).rejects.toBe(failure);
    expect(store.familyArrivalLead).toBe(DEFAULT_ARRIVAL_LEAD);
    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast.mock.calls[0]![3]).toMatchObject({
      surface: 'settings-persist',
      context: { field: 'familyArrivalLead' },
    });
  });
});
