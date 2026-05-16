/**
 * Unit tests for settingsStore.persistDualSetting — the dual-layer
 * (device + family-doc) persistence helper used by setTheme / setLanguage
 * / setTextSize / setCountry.
 *
 * Surfaces the three behavioral branches:
 *   1. post-pod happy path — both layers write
 *   2. pre-pod path — only the device layer writes, no toast, no re-throw
 *   3. genuine failure — toast fires + re-throws (existing contract preserved)
 *
 * The pre-pod branch is the fix from 2026-05-16: previously, calling
 * setLanguage from the welcome-gate language picker threw "No Automerge
 * document loaded" because the second write hit getDoc() with currentDoc===null.
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state — accessible inside vi.mock factories
// ---------------------------------------------------------------------------
const { mockShowToast, mockSaveGlobalSettings, mockSaveSettings, mockIsDocLoaded } = vi.hoisted(
  () => ({
    mockShowToast: vi.fn(),
    mockSaveGlobalSettings: vi.fn(async (patch: Record<string, unknown>) => ({
      id: 'global_settings',
      theme: 'light',
      language: 'en',
      ...patch,
    })),
    mockSaveSettings: vi.fn(async (patch: Record<string, unknown>) => ({
      id: 'app_settings',
      ...patch,
    })),
    mockIsDocLoaded: vi.fn(() => true),
  })
);

vi.mock('@/composables/useToast', () => ({
  showToast: mockShowToast,
  // useToast itself is unused by settingsStore but other modules may import it
  useToast: () => ({ toasts: [], dismissToast: vi.fn() }),
}));

vi.mock('@/composables/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/services/indexeddb/repositories/globalSettingsRepository', () => ({
  getDefaultGlobalSettings: () => ({
    id: 'global_settings',
    theme: 'light',
    language: 'en',
  }),
  getGlobalSettings: vi.fn(async () => ({
    id: 'global_settings',
    theme: 'light',
    language: 'en',
  })),
  saveGlobalSettings: mockSaveGlobalSettings,
}));

vi.mock('@/services/automerge/repositories/settingsRepository', () => ({
  getDefaultSettings: () => ({ id: 'app_settings', language: 'en', theme: 'light' }),
  getSettings: vi.fn(async () => ({ id: 'app_settings', language: 'en', theme: 'light' })),
  saveSettings: mockSaveSettings,
}));

vi.mock('@/services/automerge/docService', () => ({
  isDocLoaded: mockIsDocLoaded,
}));

// ---------------------------------------------------------------------------
// Real store imported AFTER mocks are set up
// ---------------------------------------------------------------------------
import { useSettingsStore } from '@/stores/settingsStore';

describe('settingsStore.persistDualSetting', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    // Re-establish the default isDocLoaded return after clearAllMocks
    mockIsDocLoaded.mockReturnValue(true);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('post-pod: writes to both layers and does not toast', async () => {
    mockIsDocLoaded.mockReturnValue(true);
    const store = useSettingsStore();

    await store.setLanguage('zh');

    expect(mockSaveGlobalSettings).toHaveBeenCalledWith({ language: 'zh' });
    expect(mockSaveSettings).toHaveBeenCalledWith({ language: 'zh' });
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('[settingsStore]'));
  });

  it('pre-pod: writes globalSettings only, no toast, no re-throw, logs a classified warn', async () => {
    mockIsDocLoaded.mockReturnValue(false);
    const store = useSettingsStore();

    // Must resolve, not reject — this is the bug fix.
    await expect(store.setLanguage('zh')).resolves.toBeUndefined();

    expect(mockSaveGlobalSettings).toHaveBeenCalledWith({ language: 'zh' });
    expect(mockSaveSettings).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(
      /\[settingsStore\] 'language' persisted to device only — no family doc loaded yet/
    );
  });

  it('genuine failure: globalSettings rejects → toast fires with settings-persist surface and the call re-throws', async () => {
    mockIsDocLoaded.mockReturnValue(true);
    const failure = new Error('IndexedDB quota exceeded');
    mockSaveGlobalSettings.mockRejectedValueOnce(failure);
    const store = useSettingsStore();

    await expect(store.setLanguage('zh')).rejects.toBe(failure);

    expect(mockSaveSettings).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledTimes(1);
    const [type, , , options] = mockShowToast.mock.calls[0];
    expect(type).toBe('error');
    expect(options).toMatchObject({
      surface: 'settings-persist',
      error: failure,
      context: { field: 'language' },
    });
  });

  it('post-pod: same gate works for setTheme / setTextSize / setCountry (all four wrappers share the helper)', async () => {
    mockIsDocLoaded.mockReturnValue(false);
    const store = useSettingsStore();

    await store.setTheme('dark');
    await store.setTextSize('large');
    await store.setCountry('SG');

    expect(mockSaveGlobalSettings).toHaveBeenCalledWith({ theme: 'dark' });
    expect(mockSaveGlobalSettings).toHaveBeenCalledWith({ textSize: 'large' });
    expect(mockSaveGlobalSettings).toHaveBeenCalledWith({ country: 'SG' });
    expect(mockSaveSettings).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });
});
