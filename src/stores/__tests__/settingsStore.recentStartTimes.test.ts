/**
 * The time picker's Recent row (family-scoped `Settings.recentStartTimes`):
 *   - settingsStore.recentStartTimes (getter) sanitizes on read: wall-clock only, deduped,
 *     newest first, at most four, so a CRDT merge of two devices' lists never renders badly,
 *   - settingsStore.rememberStartTime (background write) puts a time first, dedupes, caps,
 *     writes with `preserveTimestamp`, is silent on its guard paths (not a time, no
 *     authoritative doc, nothing changed) and reports a warning WITHOUT throwing on failure.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockSaveSettings, mockReportError, mockIsAuthoritative } = vi.hoisted(() => ({
  mockSaveSettings: vi.fn(async (patch: Record<string, unknown>) => ({
    id: 'app_settings',
    ...patch,
  })),
  mockReportError: vi.fn(),
  mockIsAuthoritative: vi.fn(() => true),
}));

vi.mock('@/composables/useToast', () => ({
  showToast: vi.fn(),
  useToast: () => ({ toasts: [], dismissToast: vi.fn() }),
}));
vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/services/indexeddb/repositories/globalSettingsRepository', () => ({
  getDefaultGlobalSettings: () => ({ id: 'global_settings', theme: 'light', language: 'en' }),
  getGlobalSettings: vi.fn(async () => ({ id: 'global_settings', theme: 'light', language: 'en' })),
  saveGlobalSettings: vi.fn(async (patch: Record<string, unknown>) => ({
    id: 'global_settings',
    ...patch,
  })),
}));
vi.mock('@/services/automerge/repositories/settingsRepository', () => ({
  getDefaultSettings: () => ({ id: 'app_settings', language: 'en', theme: 'light' }),
  getSettings: vi.fn(async () => ({ id: 'app_settings', language: 'en', theme: 'light' })),
  saveSettings: mockSaveSettings,
}));
vi.mock('@/services/automerge/docService', () => ({
  isDocLoaded: () => true,
  isAuthoritativeDocLoaded: mockIsAuthoritative,
}));
vi.mock('@/utils/errorReporter', () => ({ reportError: mockReportError }));

import { useSettingsStore } from '@/stores/settingsStore';
import type { Settings } from '@/types/models';

function storeWith(recent: unknown) {
  const store = useSettingsStore();
  store.settings = { ...store.settings, recentStartTimes: recent as string[] } as Settings;
  return store;
}

describe('settingsStore.recentStartTimes', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockIsAuthoritative.mockReturnValue(true);
  });

  it('is empty when nothing is stored', () => {
    expect(useSettingsStore().recentStartTimes).toEqual([]);
  });

  it('sanitizes a merged list on read: wall-clock only, deduped, capped at four', () => {
    const store = storeWith([
      '16:15',
      '9:00',
      '07:30',
      42,
      '16:15',
      '18:50',
      '24:00',
      '12:00',
      '06:00',
    ]);
    expect(store.recentStartTimes).toEqual(['16:15', '07:30', '18:50', '12:00']);
  });

  it('treats a non-array as empty', () => {
    expect(storeWith('16:15').recentStartTimes).toEqual([]);
  });
});

describe('settingsStore.rememberStartTime', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockIsAuthoritative.mockReturnValue(true);
  });

  it('puts the time first, without the bookkeeping write touching updatedAt', async () => {
    const store = storeWith(['07:30', '18:50']);
    await store.rememberStartTime('16:15');
    expect(mockSaveSettings).toHaveBeenCalledWith(
      { recentStartTimes: ['16:15', '07:30', '18:50'] },
      { preserveTimestamp: true }
    );
    expect(store.recentStartTimes).toEqual(['16:15', '07:30', '18:50']);
  });

  it('serializes quick picks so a slower first save is not dropped by the second', async () => {
    const store = storeWith(['18:50']);
    let releaseFirst!: () => void;
    mockSaveSettings.mockImplementationOnce(
      (patch: Record<string, unknown>) =>
        new Promise((resolve) => {
          releaseFirst = () => resolve({ ...store.settings, ...patch });
        })
    );
    const first = store.rememberStartTime('16:15');
    const second = store.rememberStartTime('07:30');
    await Promise.resolve();
    releaseFirst();
    await Promise.all([first, second]);
    expect(mockSaveSettings).toHaveBeenLastCalledWith(
      { recentStartTimes: ['07:30', '16:15', '18:50'] },
      { preserveTimestamp: true }
    );
    expect(store.recentStartTimes).toEqual(['07:30', '16:15', '18:50']);
  });

  it('moves an existing time to the front instead of duplicating it', async () => {
    const store = storeWith(['07:30', '16:15', '18:50']);
    await store.rememberStartTime('16:15');
    expect(store.recentStartTimes).toEqual(['16:15', '07:30', '18:50']);
  });

  it('keeps at most four, dropping the oldest', async () => {
    const store = storeWith(['07:30', '16:15', '18:50', '09:00']);
    await store.rememberStartTime('12:00');
    expect(store.recentStartTimes).toEqual(['12:00', '07:30', '16:15', '18:50']);
  });

  it('skips the write when the list would not change', async () => {
    const store = storeWith(['16:15', '07:30']);
    await store.rememberStartTime('16:15');
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it('is silent for a value that is not a wall-clock time', async () => {
    const store = useSettingsStore();
    for (const bad of ['', '9:00', '25:00', 'soon']) await store.rememberStartTime(bad);
    expect(mockSaveSettings).not.toHaveBeenCalled();
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it('is silent before the authoritative doc has loaded (snapshot fast-paint)', async () => {
    mockIsAuthoritative.mockReturnValue(false);
    await useSettingsStore().rememberStartTime('16:15');
    expect(mockSaveSettings).not.toHaveBeenCalled();
    expect(mockReportError).not.toHaveBeenCalled();
  });

  it('reports a warning and never throws when the write fails', async () => {
    const failure = new Error('write failed');
    mockSaveSettings.mockRejectedValueOnce(failure);
    const store = useSettingsStore();
    await expect(store.rememberStartTime('16:15')).resolves.toBeUndefined();
    expect(mockReportError).toHaveBeenCalledWith({
      surface: 'time-picker',
      severity: 'warning',
      message: 'failed to save recent start time',
      error: failure,
    });
    expect(store.recentStartTimes).toEqual([]);
  });
});
