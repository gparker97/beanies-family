/**
 * Unit tests for the #133 family-scoped AI consent-skip setting:
 * settingsStore.skipDocumentConsentPrompt (getter) + setSkipDocumentConsentPrompt (action).
 *
 * Contract:
 *   - getter defaults to `false` when the field is absent (old family docs / first use)
 *   - the action persists via settingsRepo.setSkipDocumentConsentPrompt and reflects in the getter
 *   - on a persist failure the action records `error` AND re-throws (so the consent flow can
 *     log it without leaving the wedge stranded — see FamilyPlannerPage.onConsentConfirm)
 */
import { setActivePinia, createPinia } from 'pinia';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockSetSkip } = vi.hoisted(() => ({
  mockSetSkip: vi.fn(async (skip: boolean) => ({
    id: 'app_settings',
    skipDocumentConsentPrompt: skip,
  })),
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
  saveSettings: vi.fn(async (patch: Record<string, unknown>) => ({ id: 'app_settings', ...patch })),
  setSkipDocumentConsentPrompt: mockSetSkip,
}));
vi.mock('@/services/automerge/docService', () => ({ isDocLoaded: vi.fn(() => true) }));

import { useSettingsStore } from '@/stores/settingsStore';

describe('settingsStore.skipDocumentConsentPrompt (#133)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockSetSkip.mockImplementation(async (skip: boolean) => ({
      id: 'app_settings',
      skipDocumentConsentPrompt: skip,
    }));
  });

  it('defaults to false when the field is absent', () => {
    const store = useSettingsStore();
    expect(store.skipDocumentConsentPrompt).toBe(false);
  });

  it('persists via the repo and reflects in the getter', async () => {
    const store = useSettingsStore();
    await store.setSkipDocumentConsentPrompt(true);

    expect(mockSetSkip).toHaveBeenCalledWith(true);
    expect(store.skipDocumentConsentPrompt).toBe(true);
  });

  it('on failure: records error AND re-throws (so callers never strand the wedge)', async () => {
    const failure = new Error('IndexedDB quota exceeded');
    mockSetSkip.mockRejectedValueOnce(failure);
    const store = useSettingsStore();

    await expect(store.setSkipDocumentConsentPrompt(true)).rejects.toBe(failure);
    expect(store.error).toBe('IndexedDB quota exceeded');
    expect(store.skipDocumentConsentPrompt).toBe(false); // unchanged
  });
});
